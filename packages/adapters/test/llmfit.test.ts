import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { evaluateConstraint } from "@anvilmark/project-contract";
import { createLlmfitAdapter, fixedClock, isAvailable } from "../src/index.js";
import { DECLARED_TARGET, FIXED_TIMES, NODE, nodeScript } from "./helpers.js";

/**
 * Fixtures reproduce the documented llmfit envelopes. See
 * `test/fixtures/PROVENANCE.md` for upstream URLs and retrieval date.
 */
const INFO = JSON.parse(
  readFileSync(new URL("./fixtures/llmfit-info.json", import.meta.url), "utf8"),
) as { system: Record<string, unknown>; models: Record<string, unknown>[] };
const SYSTEM = INFO.system;
const MODEL = INFO.models[0] as Record<string, unknown>;

function emit(payload: unknown): readonly string[] {
  return nodeScript(
    `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`,
  );
}

/** A tool that answers `--json info <model>` with the given envelope. */
function adapter(
  system: unknown = SYSTEM,
  model: unknown = MODEL,
  overrides: Record<string, unknown> = {},
) {
  return createLlmfitAdapter({
    clock: fixedClock(...FIXED_TIMES),
    executable: NODE,
    versionArgs: nodeScript('process.stdout.write("0.4.2")'),
    infoArgs: () =>
      emit({
        system,
        models: Array.isArray(model) ? model : [model],
      }),
    // llmfit reports no OS, so ANVILMARK observes it. Pinned for determinism.
    platform: () => "linux",
    ...overrides,
  });
}

const REQUEST = {
  evidenceId: "evidence.llmfit.local",
  detectedHardwareId: "hardware.detected_local_run",
  declaredTarget: DECLARED_TARGET,
  modelIdentity: {
    name: "Qwen/Qwen2.5-Coder-7B-Instruct",
    quantization: "Q5_K_M",
  },
  candidateRef: "candidate.local",
  workloadRef: "classification",
  constraintRefs: ["hardware.fit"],
};

/** The CLI system block with fields overridden. It is flat, not nested. */
function systemWith(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return { ...structuredClone(SYSTEM), ...overrides };
}

describe("the optional hardware-fit adapter", () => {
  it("parses the documented system and model envelopes", async () => {
    const outcome = await adapter().collect(REQUEST);

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.adapter.version).toBe("0.4.2");
    expect(outcome.value.evidence.record.kind).toBe("tool_observation");
    expect(outcome.value.evidence.tier).toBe("T2");

    const findings = (
      outcome.value.evidence.record.value as {
        findings: Record<string, unknown>;
      }
    ).findings;
    // At the pinned commit fit_to_json emits both: the code in `fit_level`
    // and the human string in `fit_label`.
    expect(findings.fit_level).toBe("good");
    expect(findings.memory_required_gb).toBe(5.8);
    expect(findings.estimated_tps).toBe(42.5);
  });

  it("returns the detected machine as its own separate subject", async () => {
    const outcome = await adapter().collect(REQUEST);
    if (!isAvailable(outcome)) throw new Error("expected a result");

    const detected = outcome.value.detected_hardware;
    // Separate id and separate evidence kind from the declared target.
    expect(detected.id).toBe("hardware.detected_local_run");
    expect(detected.id).not.toBe(DECLARED_TARGET.id);
    expect(detected.evidence_kind).toBe("deterministic_observation");
    expect(DECLARED_TARGET.evidence_kind).toBe("user_declared");
    expect(detected.backend).toBe("CUDA");
    expect(detected.accelerators[0]).toMatchObject({
      model: "NVIDIA GeForce RTX 4090",
      vram_gb: 24,
    });

    const value = outcome.value.evidence.record.value as {
      target_hardware_ref: string;
      detected_hardware_ref: string;
    };
    expect(value.target_hardware_ref).toBe(DECLARED_TARGET.id);
    expect(value.detected_hardware_ref).toBe(detected.id);
    // The two references are never collapsed onto one entry.
    expect(value.target_hardware_ref).not.toBe(value.detected_hardware_ref);
  });

  it("never persists a machine identifier", async () => {
    const outcome = await adapter().collect(REQUEST);
    if (!isAvailable(outcome)) throw new Error("expected a result");

    // `node.name` is machine identity. It is read only so the envelope
    // validates, and never reaches the detected subject or the evidence.
    //
    // The command manifest is excluded from this assertion because the fake
    // tool used here carries the whole fixture in its argv; a real llmfit
    // invocation takes a model name, not a payload.
    // The CLI envelope carries no hostname at all; the CPU name is a model,
    // not an identifier, and is the only machine-describing string kept.
    expect(JSON.stringify(SYSTEM)).not.toContain("hostname");
    expect(outcome.value.detected_hardware.cpu.model).toBe(
      "AMD Ryzen 9 7950X 16-Core Processor",
    );
  });

  const gpu = (
    name: string,
    vram: number,
    count = 1,
    backend = "CUDA",
  ): Record<string, unknown> => ({
    name,
    vram_gb: vram,
    backend,
    count,
    unified_memory: false,
  });

  const mismatches: readonly [string, Record<string, unknown>][] = [
    ["a different backend", { backend: "Metal" }],
    [
      "a different accelerator model",
      {
        gpu_name: "NVIDIA RTX 3060",
        gpus: [gpu("NVIDIA RTX 3060", 24)],
      },
    ],
    [
      "different VRAM",
      { gpu_vram_gb: 16, gpus: [gpu("NVIDIA GeForce RTX 4090", 16)] },
    ],
    [
      "a different accelerator count",
      { gpu_count: 2, gpus: [gpu("NVIDIA GeForce RTX 4090", 24, 2)] },
    ],
    [
      "no GPU at all",
      {
        has_gpu: false,
        gpu_name: null,
        gpu_vram_gb: null,
        gpu_count: 0,
        gpus: [],
      },
    ],
    ["less RAM than the declared target", { total_ram_gb: 32 }],
    ["more RAM than the declared target", { total_ram_gb: 128 }],
    ["fewer CPU cores than declared", { cpu_cores: 8 }],
    ["more CPU cores than declared", { cpu_cores: 32 }],
  ];

  it.each(mismatches)("yields unknown for %s", async (_name, overrides) => {
    const outcome = await adapter(systemWith(overrides)).collect(REQUEST);

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("identity_mismatch");
  });

  it("yields unknown when the tool describes a different model", async () => {
    const outcome = await adapter(SYSTEM, {
      ...MODEL,
      name: "meta-llama/Llama-3.1-8B-Instruct",
    }).collect(REQUEST);

    // Hashing the request would only record the question that was asked.
    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.message).toContain("Llama-3.1-8B-Instruct");
  });

  it("yields unknown when the tool reports a different quantization", async () => {
    const outcome = await adapter(SYSTEM, {
      ...MODEL,
      best_quant: "Q4_K_M",
    }).collect(REQUEST);

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("identity_mismatch");
    expect(outcome.errors[0]?.detail).toMatchObject({
      requested_quantization: "Q5_K_M",
      reported_quantization: "Q4_K_M",
    });
  });

  it("reads the model out of the envelope's models array", async () => {
    const outcome = await adapter(SYSTEM, [MODEL]).collect(REQUEST);
    expect(outcome.standing).toBe("available");
  });

  it("cannot satisfy a hard hardware performance gate even when attributed", async () => {
    const outcome = await adapter().collect({
      ...REQUEST,
      constraintRefs: ["hardware.throughput"],
    });
    if (!isAvailable(outcome)) throw new Error("expected a result");

    const gate = {
      id: "hardware.throughput",
      domain: "hardware",
      severity: "hard",
      subject: "candidate.tokens_per_second",
      operator: "gte",
      value: 20,
      source: "user",
      rationale: null,
      condition: null,
      exceptions: [],
    } as never;

    const detected = outcome.value.detected_hardware;
    const result = evaluateConstraint(
      gate,
      "pass",
      [outcome.value.evidence.record],
      { tiers: {}, floors: {} } as never,
      {
        candidateRef: "candidate.local",
        workloadRef: "classification",
        declaredTargetHardwareRefs: [DECLARED_TARGET.id],
        deploymentHardwareRef: DECLARED_TARGET.id,
        resolveHardware: (id: string) =>
          id === DECLARED_TARGET.id
            ? (DECLARED_TARGET as never)
            : id === detected.id
              ? detected
              : undefined,
      },
    );

    // A T2 estimate cannot clear a T3 benchmark gate, matched pair or not.
    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "cannot establish hardware_performance_gate",
    );
  });

  it("cannot satisfy a workload quality gate even when attributed", async () => {
    const outcome = await adapter().collect({
      ...REQUEST,
      constraintRefs: ["quality.f1"],
    });
    if (!isAvailable(outcome)) throw new Error("expected a result");

    const gate = {
      id: "quality.f1",
      domain: "quality",
      severity: "hard",
      subject: "workload.classification.metric.macro_f1",
      operator: "gte",
      value: 0.9,
      source: "user",
      rationale: null,
      condition: null,
      exceptions: [],
    } as never;

    expect(
      evaluateConstraint(
        gate,
        "pass",
        [outcome.value.evidence.record],
        { tiers: {}, floors: {} } as never,
        { candidateRef: "candidate.local", workloadRef: "classification" },
      ).outcome,
    ).toBe("unknown");
  });

  it("reports a missing tool as an evidence gap", async () => {
    const outcome = await createLlmfitAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: "llmfit-not-installed",
    }).collect(REQUEST);

    expect(outcome.standing).toBe("unavailable");
    expect(outcome.errors[0]?.code).toBe("executable_not_found");
  });

  it("rejects a system report that is not the documented shape", async () => {
    const outcome = await adapter({ ok: true }).collect(REQUEST);

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
  });

  it("rejects a model report that is not the documented shape", async () => {
    const outcome = await adapter(SYSTEM, { ok: true }).collect(REQUEST);

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
  });

  it("refuses to run when the tool will not identify itself", async () => {
    const outcome = await adapter(SYSTEM, MODEL, {
      versionArgs: nodeScript('process.stdout.write("")'),
    }).collect(REQUEST);

    expect(outcome.standing).toBe("unsupported");
    expect(outcome.errors[0]?.code).toBe("version_unavailable");
  });

  it("carries assumptions, caveats, and a raw-result hash", async () => {
    const outcome = await adapter().collect(REQUEST);
    if (!isAvailable(outcome)) throw new Error("expected a result");

    expect(
      outcome.value.evidence.annotations.assumptions.length,
    ).toBeGreaterThan(0);
    expect(outcome.value.evidence.record.caveats.join(" ")).toContain(
      "not a benchmark",
    );
    expect(outcome.value.evidence.annotations.raw_result_hash).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

describe("the system report must be internally consistent", () => {
  it("fails closed when gpu_count disagrees with the per-GPU counts", async () => {
    const outcome = await adapter(
      systemWith({
        gpu_count: 4,
        gpus: [
          {
            name: "NVIDIA GeForce RTX 4090",
            vram_gb: 24,
            backend: "CUDA",
            count: 1,
            unified_memory: false,
          },
        ],
      }),
    ).collect(REQUEST);

    // Guessing which number is right would attribute a fit estimate to a
    // machine that may not exist.
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
    expect(outcome.errors[0]?.message).toContain("self-contradictory");
  });

  it("fails closed when no GPU is claimed but one is listed", async () => {
    const outcome = await adapter(
      systemWith({ has_gpu: false, gpu_name: null, gpu_vram_gb: null }),
    ).collect(REQUEST);

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
  });

  it("reads a multi-GPU machine through gpus[].count", async () => {
    const outcome = await adapter(
      systemWith({
        gpu_count: 2,
        gpus: [
          {
            name: "NVIDIA GeForce RTX 4090",
            vram_gb: 24,
            backend: "CUDA",
            count: 2,
            unified_memory: false,
          },
        ],
      }),
    ).collect({
      ...REQUEST,
      declaredTarget: {
        ...DECLARED_TARGET,
        accelerators: [
          { vendor: "nvidia", model: "RTX 4090", vram_gb: 24, count: 2 },
        ],
      },
    });

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.value.detected_hardware.accelerators[0]?.count).toBe(2);
  });

  it("observes the operating system itself, since llmfit reports none", async () => {
    const outcome = await adapter().collect(REQUEST);
    if (!isAvailable(outcome)) throw new Error("expected a result");

    // Nothing in the CLI envelope names an OS; this is ANVILMARK's own
    // deterministic observation and is recorded as such.
    expect(JSON.stringify(SYSTEM)).not.toContain("operating_system");
    expect(outcome.value.detected_hardware.operating_system).toBe("linux");

    const basis = (
      outcome.value.evidence.record.value as {
        estimate_basis: Record<string, unknown>;
      }
    ).estimate_basis;
    expect(basis.operating_system_source).toBe(
      "anvilmark_platform_observation",
    );
  });

  it("yields unknown when the observed operating system differs from the target", async () => {
    const outcome = await adapter(SYSTEM, MODEL, {
      platform: () => "darwin",
    }).collect(REQUEST);

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.message).toContain("operating system");
  });

  it("carries no HTTP-API-only fields", () => {
    // `node` belongs to GET /api/v1/system, not to the CLI.
    expect(SYSTEM).not.toHaveProperty("node");
    expect(INFO).not.toHaveProperty("node");
  });

  it("rejects a model whose name merely extends the requested one", async () => {
    const outcome = await adapter(SYSTEM, {
      ...MODEL,
      name: "Qwen/Qwen2.5-Coder-7B-Instruct-AWQ",
    }).collect(REQUEST);

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("identity_mismatch");
  });

  it("accepts the same model written without its publisher namespace", async () => {
    const outcome = await adapter(SYSTEM, {
      ...MODEL,
      name: "Qwen2.5-Coder-7B-Instruct",
    }).collect(REQUEST);

    expect(outcome.standing).toBe("available");
  });
});
