import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  AttentionGroupSchema,
  CATALOG_VERSION,
  ProbeArtifactSchema,
  SizingInputSchema,
  canonicalSizingJson,
  createPlanningInput,
  createSizingArtifact,
  estimateKvBytes,
  estimateModelFit,
  estimateWeightBytes,
  listModelProfiles,
  verifySizingArtifact,
} from "../src/index.js";

const hashText = (text: string) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
const evaluatedAt = "2026-09-17T00:00:00.000Z";
const GiB = 2 ** 30;
function fullyBudgeted(modelId?: string) {
  const input = createPlanningInput(modelId);
  input.hardware.allocation_limit_bytes = input.hardware.capacity_bytes;
  input.hardware.reserve_bytes = 2 * GiB;
  input.runtime.overhead_bytes = GiB;
  input.runtime.allocator_allowance_bytes = GiB / 4;
  return input;
}
const mixtral = "mistralai/Mixtral-8x7B-Instruct-v0.1";

describe("published architecture fixtures", () => {
  it.each(["qwen", "mixtral"])(
    "derives %s parameter counts independently from publisher dimensions",
    async (name) => {
      const config = JSON.parse(
        await readFile(
          new URL(`./fixtures/${name}-config.json`, import.meta.url),
          "utf8",
        ),
      );
      const hidden = config.hidden_size;
      const kvDimension =
        (config.num_key_value_heads * hidden) / config.num_attention_heads;
      const attention = 2 * hidden * hidden + 2 * hidden * kvDimension;
      const norms = 2 * hidden;
      const experts = name === "mixtral" ? config.num_local_experts : 1;
      const routerOrBias =
        name === "mixtral" ? hidden * experts : hidden + 2 * kvDimension;
      const feedforward = 3 * hidden * config.intermediate_size;
      const shared =
        2 * config.vocab_size * hidden +
        hidden +
        config.num_hidden_layers * (attention + norms + routerOrBias);
      const total = shared + config.num_hidden_layers * experts * feedforward;
      const profile = listModelProfiles().find(
        (entry) =>
          entry.architecture === (name === "mixtral" ? "moe_gqa" : "dense_gqa"),
      )!;
      expect(profile.parameter_count).toBe(total);
      const activeExperts = name === "mixtral" ? config.num_experts_per_tok : 1;
      expect(profile.active_parameter_count).toBe(
        shared + config.num_hidden_layers * activeExperts * feedforward,
      );
    },
  );
  it.each([
    ["Qwen/Qwen2.5-Coder-7B-Instruct", "qwen", 1_879_048_192, 15_231_233_024],
    [mixtral, "mixtral", 4_294_967_296, 93_405_585_408],
  ] as const)(
    "matches %s pinned attention dimensions and independent byte totals",
    async (id, name, expectedKv, expectedWeights) => {
      const config = JSON.parse(
        await readFile(
          new URL(`./fixtures/${name}-config.json`, import.meta.url),
          "utf8",
        ),
      );
      const input = fullyBudgeted(id);
      input.workload.retained_tokens_per_sequence = 32768;
      const result = estimateModelFit(input);
      expect(result.memory.kv_cache_bytes).toBe(expectedKv);
      expect(result.memory.weights_bytes).toBe(expectedWeights);
      expect(result.model_profile?.attention_groups[0]).toEqual({
        layers: config.num_hidden_layers,
        kv_heads: config.num_key_value_heads,
        key_head_dimension: config.hidden_size / config.num_attention_heads,
        value_head_dimension: config.hidden_size / config.num_attention_heads,
        window_tokens: null,
      });
    },
  );

  it("counts every MoE expert in resident weights and scales KV with sequences", () => {
    const input = fullyBudgeted(mixtral);
    input.workload.retained_tokens_per_sequence = 32768;
    input.workload.concurrent_sequences = 2;
    input.weights = { format: "nominal_int4", metadata_bytes: 0 };
    const result = estimateModelFit(input);
    expect(result.memory.kv_cache_bytes).toBe(8_589_934_592);
    expect(result.memory.weights_bytes).toBe(23_351_396_352);
    expect(result.memory.assessment).toBe("estimated_over_budget");
    const model = result.model_profile!;
    expect(
      estimateWeightBytes(
        { ...model, active_parameter_count: 1 } as typeof model,
        input.weights,
      ).bytes,
    ).toBe(23_351_396_352);
  });

  it("isolates the pinned catalog from caller mutation", () => {
    const profiles = listModelProfiles();
    profiles[0]!.parameter_count = 1;
    profiles[0]!.attention_groups[0]!.kv_heads = 1;
    expect(estimateModelFit(fullyBudgeted()).memory.weights_bytes).toBe(
      15_231_233_024,
    );
    expect(listModelProfiles()[0]!.attention_groups[0]!.kv_heads).toBe(4);
  });
});

describe("memory semantics", () => {
  it("leaves missing overhead and usable allocation unknown", () => {
    const result = estimateModelFit(createPlanningInput());
    expect(result.status).toBe("incomplete");
    expect(result.memory.required_bytes).toBeNull();
    expect(result.memory.usable_budget_bytes).toBeNull();
    expect(result.memory.assessment).toBe("unknown");
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "runtime_overhead_unknown",
      "allocator_allowance_unknown",
      "allocation_budget_unknown",
    ]);
  });

  it("recognizes lower-bound overflow even with unknown metadata/overhead", () => {
    const input = createPlanningInput(mixtral);
    input.weights = { format: "nominal_int4", metadata_bytes: null };
    input.hardware.allocation_limit_bytes = 8 * GiB;
    const result = estimateModelFit(input);
    expect(result.status).toBe("incomplete");
    expect(result.memory.required_bytes).toBeNull();
    expect(result.memory.headroom_bytes).toBeNull();
    expect(result.memory.known_lower_bound_bytes).toBeGreaterThan(8 * GiB);
    expect(result.memory.assessment).toBe("estimated_over_budget");
  });

  it("does not call incomplete integer storage a fit", () => {
    const input = fullyBudgeted();
    input.weights = { format: "nominal_int4", metadata_bytes: null };
    const result = estimateModelFit(input);
    expect(result.memory.assessment).toBe("unknown");
    expect(result.memory.weights_bytes).toBeNull();
    expect(result.assumptions.join(" ")).toContain("hypothetical");
  });

  it("uses one pool on Apple Silicon and subtracts reserve exactly once", () => {
    const input = fullyBudgeted();
    input.hardware.kind = "unified_memory";
    input.hardware.backend = "metal";
    input.placement = "unified_pool";
    input.hardware.capacity_bytes = 32 * GiB;
    input.hardware.allocation_limit_bytes = 24 * GiB;
    input.hardware.reserve_bytes = 4 * GiB;
    const result = estimateModelFit(input);
    expect(result.memory.pool_count).toBe(1);
    expect(result.memory.usable_budget_bytes).toBe(20 * GiB);
    expect(result.memory.headroom_bytes).toBe(
      20 * GiB - result.memory.required_bytes!,
    );
    input.hardware.allocation_limit_bytes = null;
    expect(estimateModelFit(input).memory.assessment).toBe("unknown");
  });

  it("supports CPU memory without inventing throughput or spilling", () => {
    const input = fullyBudgeted();
    input.hardware.kind = "cpu";
    input.hardware.backend = "cpu";
    input.placement = "cpu_only";
    const result = estimateModelFit(input);
    expect(result.status).toBe("calculated");
    expect(result.performance.estimated_decode_tokens_per_second).toBeNull();
    expect(result.runtime_compatibility).toBe("unknown");
  });

  it("keeps exact-byte boundaries and distinguishes GB from GiB", () => {
    const input = fullyBudgeted();
    const required = estimateModelFit(input).memory.required_bytes!;
    input.hardware.reserve_bytes = 0;
    input.hardware.allocation_limit_bytes = required;
    expect(estimateModelFit(input).memory.headroom_bytes).toBe(0);
    expect(estimateModelFit(input).memory.assessment).toBe(
      "estimated_within_budget",
    );
    input.hardware.allocation_limit_bytes = required - 1;
    expect(estimateModelFit(input).memory.assessment).toBe(
      "estimated_over_budget",
    );
    input.hardware.allocation_limit_bytes = 20_000_000_000;
    const decimal = estimateModelFit(input).memory.headroom_bytes!;
    input.hardware.allocation_limit_bytes = 20 * GiB;
    expect(estimateModelFit(input).memory.headroom_bytes! - decimal).toBe(
      1_474_836_480,
    );
  });

  it("calculates layer-wise MQA/GQA retention with independent key/value precision", () => {
    const groups = [
      {
        layers: 1,
        kv_heads: 1,
        key_head_dimension: 64,
        value_head_dimension: 128,
        window_tokens: 512,
      },
      {
        layers: 1,
        kv_heads: 4,
        key_head_dimension: 128,
        value_head_dimension: 128,
        window_tokens: null,
      },
    ];
    expect(
      estimateKvBytes({
        groups,
        retained_tokens: 1024,
        concurrent_sequences: 2,
        key_format: "fp16",
        value_format: "fp32",
      }),
    ).toBe(6_946_816);
  });

  it("does not change weight memory when only context or KV precision changes", () => {
    const input = fullyBudgeted();
    const before = estimateModelFit(input);
    input.workload.retained_tokens_per_sequence *= 2;
    input.kv_cache.key_format = "fp32";
    input.kv_cache.value_format = "fp32";
    const after = estimateModelFit(input);
    expect(after.memory.weights_bytes).toBe(before.memory.weights_bytes);
    expect(after.memory.kv_cache_bytes).toBe(before.memory.kv_cache_bytes! * 4);
  });

  it("never promotes a complete memory estimate into compatibility or performance evidence", () => {
    const result = estimateModelFit(fullyBudgeted());
    expect(result.status).toBe("calculated");
    expect(result.contract_evidence).toBe("unattached");
    expect(result.runtime_compatibility).toBe("unknown");
    expect(result.performance.status).toBe("unverified");
    expect(JSON.stringify(result)).not.toContain("latency_p95_ms");
  });
});

describe("unsupported and invalid inputs", () => {
  it.each([
    "tensor_parallel",
    "pipeline_parallel",
    "expert_parallel",
    "offload",
  ] as const)("rejects implicit %s placement", (placement) => {
    const input = fullyBudgeted();
    input.placement = placement;
    const result = estimateModelFit(input);
    expect(result.status).toBe("unsupported");
    expect(result.memory.assessment).toBe("unknown");
  });

  it("does not pool multiple devices", () => {
    const input = fullyBudgeted();
    input.hardware.device_count = 2;
    expect(estimateModelFit(input).issues[0]?.code).toBe(
      "multi_device_unsupported",
    );
  });

  it.each(["model", "revision", "catalog", "context", "weights", "cache"])(
    "preserves unsupported %s without silent fallback",
    (field) => {
      const input = fullyBudgeted();
      if (field === "model") input.model.id = "unknown/model";
      if (field === "revision") input.model.revision = "a".repeat(40);
      if (field === "catalog") input.catalog_version = "future";
      if (field === "context")
        input.workload.retained_tokens_per_sequence = 65536;
      if (field === "weights") input.weights.format = "Q4_K_M";
      if (field === "cache") input.kv_cache.key_format = "fp8";
      const original = structuredClone(input);
      const result = estimateModelFit(input);
      expect(input).toEqual(original);
      expect(result.status).toBe("unsupported");
      expect(result.memory.assessment).toBe("unknown");
    },
  );

  it.each([NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid capacity %s",
    (capacity) => {
      const input = fullyBudgeted();
      input.hardware.capacity_bytes = capacity;
      expect(() => estimateModelFit(input)).toThrow();
    },
  );

  it("rejects incompatible backends, excessive reserves, and T3 input claims", () => {
    const input = fullyBudgeted();
    expect(
      SizingInputSchema.safeParse({
        ...input,
        hardware: { ...input.hardware, backend: "metal" },
      }).success,
    ).toBe(false);
    expect(
      SizingInputSchema.safeParse({
        ...input,
        hardware: { ...input.hardware, reserve_bytes: 99 * GiB },
      }).success,
    ).toBe(false);
    expect(
      SizingInputSchema.safeParse({
        ...input,
        hardware: {
          ...input.hardware,
          evidence_kind: "deterministic_observation",
        },
      }).success,
    ).toBe(false);
    expect(
      SizingInputSchema.safeParse({ ...input, command: "anything" }).success,
    ).toBe(false);
  });

  it("returns unknown on unsafe summed byte totals", () => {
    const input = fullyBudgeted();
    input.runtime.overhead_bytes = Number.MAX_SAFE_INTEGER;
    const result = estimateModelFit(input);
    expect(result.status).toBe("unsupported");
    expect(result.memory.assessment).toBe("unknown");
    expect(result.issues.at(-1)?.code).toBe("numeric_range_exceeded");
  });

  it("checks integer range before converting a huge cache product to Number", () => {
    const group = AttentionGroupSchema.parse({
      layers: 1024,
      kv_heads: 1024,
      key_head_dimension: 8192,
      value_head_dimension: 8192,
      window_tokens: null,
    });
    expect(() =>
      estimateKvBytes({
        groups: [group],
        retained_tokens: 16_777_216,
        concurrent_sequences: 1024,
        key_format: "fp32",
        value_format: "fp32",
      }),
    ).toThrow(RangeError);
  });
});

describe("portable artifacts", () => {
  it.each(["standalone-qwen", "project-bound-qwen"])(
    "validates and recomputes the %s example without admitting evidence",
    async (name) => {
      const input = JSON.parse(
        await readFile(
          new URL(`../examples/${name}.json`, import.meta.url),
          "utf8",
        ),
      );
      const artifact = await createSizingArtifact(input, {
        evaluatedAt,
        hashText,
      });
      expect(artifact.result.memory.assessment).toBe("estimated_within_budget");
      expect(artifact.result.contract_evidence).toBe("unattached");
      expect((await verifySizingArtifact(artifact, hashText)).ok).toBe(true);
    },
  );
  it("round-trips and agrees between Node and Web Crypto", async () => {
    const artifact = await createSizingArtifact(fullyBudgeted(), {
      evaluatedAt,
      hashText,
    });
    const browserHash = async (text: string) => {
      const bytes = await webcrypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
      );
      return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    };
    expect(
      await verifySizingArtifact(
        JSON.parse(JSON.stringify(artifact)),
        browserHash,
      ),
    ).toEqual({ ok: true, artifact });
    expect(artifact.input.catalog_version).toBe(CATALOG_VERSION);
  });

  it("changes dependency identity for every material input while excluding the clock", async () => {
    const input = fullyBudgeted();
    const baseline = await createSizingArtifact(input, {
      evaluatedAt,
      hashText,
    });
    const later = await createSizingArtifact(input, {
      evaluatedAt: "2026-09-18T00:00:00Z",
      hashText,
    });
    expect(later.input_digest).toBe(baseline.input_digest);
    expect(later.dependency_digest).toBe(baseline.dependency_digest);
    expect(later.integrity_hash).not.toBe(baseline.integrity_hash);
    const changes = [
      () => {
        input.workload.retained_tokens_per_sequence++;
      },
      () => {
        input.workload.concurrent_sequences++;
      },
      () => {
        input.kv_cache.key_format = "fp32";
      },
      () => {
        input.hardware.reserve_bytes++;
      },
      () => {
        input.weights.format = "fp16";
      },
      () => {
        input.runtime.version = "test-runtime-v2";
      },
    ];
    let previous = baseline.dependency_digest;
    for (const change of changes) {
      change();
      const next = await createSizingArtifact(input, { evaluatedAt, hashText });
      expect(next.dependency_digest).not.toBe(previous);
      previous = next.dependency_digest;
    }
  });

  it("rejects edited result numbers even when an attacker reseals the artifact", async () => {
    const artifact = await createSizingArtifact(fullyBudgeted(), {
      evaluatedAt,
      hashText,
    });
    artifact.result.memory.required_bytes = 1;
    const { integrity_hash: oldHash, ...content } = artifact;
    void oldHash;
    artifact.integrity_hash = hashText(canonicalSizingJson(content));
    const result = await verifySizingArtifact(artifact, hashText);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues).toContain(
        "Stored result differs from local recomputation.",
      );
  });

  it("rejects unsupported versions, arbitrary fields and unversioned content", async () => {
    const artifact = await createSizingArtifact(fullyBudgeted(), {
      evaluatedAt,
      hashText,
    });
    expect(
      (
        await verifySizingArtifact(
          { ...artifact, format: "anvilmark-hardware-sizing/2" },
          hashText,
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await verifySizingArtifact(
          { ...artifact, execute: "anything" },
          hashText,
        )
      ).ok,
    ).toBe(false);
    expect((await verifySizingArtifact({}, hashText)).ok).toBe(false);
  });

  it("rejects non-JSON canonical values and normalizes key order", () => {
    expect(canonicalSizingJson({ b: 2, a: 1 })).toBe(
      canonicalSizingJson({ a: 1, b: 2 }),
    );
    expect(() => canonicalSizingJson({ bad: undefined })).toThrow();
    expect(() => canonicalSizingJson({ bad: NaN })).toThrow();
  });
});

describe("probe artifact boundary", () => {
  it("does not let partial data masquerade as complete inventory", () => {
    const partial = {
      format: "anvilmark-hardware-probe/1",
      observed_at: evaluatedAt,
      detector_version: "test",
      scope: "process",
      status: "partial",
      cpu_cores: null,
      physical_memory: null,
      devices: [],
      diagnostics: [
        { code: "unavailable", message: "No permission to inspect memory" },
      ],
    };
    expect(ProbeArtifactSchema.safeParse(partial).success).toBe(true);
    expect(
      ProbeArtifactSchema.safeParse({ ...partial, status: "complete" }).success,
    ).toBe(false);
    expect(
      ProbeArtifactSchema.safeParse({ ...partial, command: "anything" })
        .success,
    ).toBe(false);
  });
});
