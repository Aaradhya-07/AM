import { describe, expect, it } from "vitest";

import {
  PROVIDER_CONFIG_ALLOWLIST,
  deriveExpectedEvaluation,
  evaluationIdentityHash,
  planEvaluation,
  validateEvaluationSpec,
  verifiedIdentityOf,
} from "../src/index.js";
import { TEST_PROVIDERS, evaluationSpec, planFor } from "./promptfoo-inputs.js";

/** The expectation is for a spec UNDER provider policy, so policy is passed. */
const POLICY = { providers: TEST_PROVIDERS };

function specWith(mutate: (spec: Record<string, unknown>) => void) {
  const spec = JSON.parse(JSON.stringify(evaluationSpec())) as Record<
    string,
    unknown
  >;
  mutate(spec);
  return spec;
}

function rejectionReasons(input: unknown): string[] {
  const result = validateEvaluationSpec(input);
  if ("spec" in result) {
    throw new Error("expected the spec to be refused");
  }
  return [...result.reasons];
}

describe("provider configuration is a closed allowlist", () => {
  /**
   * Every one of these was ACCEPTED by `z.record(z.string(), z.unknown())`.
   * Each either changes what runs -- a file the identity never covered, an
   * executable transform -- or cannot be represented portably at all.
   */
  const hostile: readonly (readonly [string, unknown])[] = [
    [
      "a request template read from a file",
      { request: "file:///tmp/request.txt" },
    ],
    [
      "a response parser read from a file",
      { transformResponse: "file:///tmp/parser.js" },
    ],
    [
      "an executable transform expression",
      { transformResponse: "output.split().reverse()" },
    ],
    ["a literal credential", { apiKey: "hunter2" }],
    ["tools loaded from a file", { tools: "file:///tmp/tools.json" }],
    ["a function", { transformResponse: () => "x" }],
    ["a symbol", { temperature: Symbol("t") }],
    ["a bigint", { max_tokens: 10n }],
    ["NaN", { temperature: Number.NaN }],
    ["positive infinity", { temperature: Number.POSITIVE_INFINITY }],
    ["negative infinity", { temperature: Number.NEGATIVE_INFINITY }],
    ["a temperature above the stated bound", { temperature: 99 }],
    ["a negative temperature", { temperature: -1 }],
    ["a top_p above one", { top_p: 1.5 }],
    ["a fractional seed", { seed: 1.5 }],
    ["a zero max_tokens", { max_tokens: 0 }],
    [
      "a stop list that is a file reference",
      { stop: ["file:///tmp/stop.txt"] },
    ],
    ["a stop list that is a URL", { stop: ["https://example.test/stop"] }],
    ["an empty stop list", { stop: [] }],
    ["a nested object", { temperature: { value: 1 } }],
    ["an unknown key", { totally_unknown: 1 }],
  ];

  it.each(hostile)("refuses %s", (_label, config) => {
    const reasons = rejectionReasons(
      specWith((spec) => {
        (spec.provider as Record<string, unknown>).config = config;
      }),
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("refuses a cyclic provider configuration without throwing", () => {
    const cyclic: Record<string, unknown> = { temperature: 1 };
    cyclic.self = cyclic;

    const build = () =>
      validateEvaluationSpec(
        specWith((spec) => {
          (spec.provider as Record<string, unknown>).config = cyclic;
        }),
      );

    expect(build).not.toThrow();
    expect("reasons" in build()).toBe(true);
  });

  it("refuses a cyclic spec without throwing", () => {
    const spec = specWith(() => undefined);
    spec.self = spec;

    expect(() => validateEvaluationSpec(spec)).not.toThrow();
    expect("reasons" in validateEvaluationSpec(spec)).toBe(true);
  });

  it("returns a rejection rather than throwing when reading the input throws", () => {
    const hostileInput = {};
    Object.defineProperty(hostileInput, "dataset", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });

    const result = validateEvaluationSpec(hostileInput);
    expect("reasons" in result).toBe(true);
    if (!("reasons" in result)) return;
    expect(result.reasons.join(" ")).toContain("could not be read as data");
  });

  it("planEvaluation returns a rejection rather than throwing for hostile input", () => {
    for (const input of [
      undefined,
      null,
      42,
      "a string",
      [],
      { spec_version: "wrong" },
    ]) {
      expect(() => planEvaluation(input)).not.toThrow();
      expect("reasons" in planEvaluation(input)).toBe(true);
    }
  });

  it("treats an explicitly undefined parameter as absent, not as a value", () => {
    // `{ temperature: undefined }` is the same configuration as `{}`. Zod keeps
    // the key in its raw output, but canonicalising into the plan drops it, so
    // the bytes that run and the digest taken over them are identical to the
    // empty-config case. That is the comparison that matters: the plan is what
    // executes.
    const planned = planEvaluation(
      specWith((spec) => {
        (spec.provider as Record<string, unknown>).config = {
          temperature: undefined,
        };
      }),
    );
    if (!("plan" in planned)) {
      throw new Error(`unexpected rejection: ${planned.reasons.join("; ")}`);
    }

    expect(Object.keys(planned.plan.spec.provider.config)).toEqual([]);
    expect(planned.plan.configBytes).toBe(planFor().configBytes);
    expect(planned.plan.identities).toEqual(planFor().identities);
  });

  it("refuses an unknown key even when its value is undefined", () => {
    const reasons = rejectionReasons(
      specWith((spec) => {
        (spec.provider as Record<string, unknown>).config = {
          transformResponse: undefined,
        };
      }),
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("accepts every allowlisted sampling parameter", () => {
    const result = validateEvaluationSpec(
      specWith((spec) => {
        (spec.provider as Record<string, unknown>).config = {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          seed: 12345,
          max_tokens: 512,
          frequency_penalty: 0.5,
          presence_penalty: -0.5,
          stop: ["STOP"],
        };
      }),
    );

    expect("spec" in result).toBe(true);
    if (!("spec" in result)) return;
    // The documented allowlist and the accepted keys are the same set.
    expect(Object.keys(result.spec.provider.config).sort()).toEqual([
      ...PROVIDER_CONFIG_ALLOWLIST,
    ]);
  });
});

describe("credentials have exactly one declaration", () => {
  it("hashes the same names the run would receive", () => {
    const names = ["EXAMPLE_API_KEY", "SECOND_TOKEN"];
    const plan = planFor({ credentialEnvNames: names });

    // The plan is the single source: the list the subprocess is built from IS
    // the list that went into model_configuration_hash. They cannot be
    // different lists, because there is only one list.
    expect([...plan.credentialEnvNames]).toEqual(names);
    expect(plan.identities.model_configuration_hash).not.toBe(
      planFor({ credentialEnvNames: ["EXAMPLE_API_KEY"] }).identities
        .model_configuration_hash,
    );
  });

  it("hashes a name set independently of the order it was written in", () => {
    expect(
      planFor({ credentialEnvNames: ["A_TOKEN", "B_TOKEN"] }).identities
        .model_configuration_hash,
    ).toBe(
      planFor({ credentialEnvNames: ["B_TOKEN", "A_TOKEN"] }).identities
        .model_configuration_hash,
    );
  });

  it("refuses a duplicate credential name", () => {
    const reasons = rejectionReasons(
      evaluationSpec({ credentialEnvNames: ["SAME_KEY", "SAME_KEY"] }),
    );
    expect(reasons.join(" ")).toContain("declared more than once");
  });

  it.each([
    ["an embedded equals sign", "BAD=NAME"],
    ["a leading digit", "1BAD"],
    ["a hyphen", "BAD-NAME"],
    ["a space", "BAD NAME"],
    ["a NUL byte", `BAD${String.fromCharCode(0)}NAME`],
    ["an empty name", ""],
    ["a dot", "bad.name"],
  ])("refuses %s as an environment-variable name", (_label, name) => {
    const reasons = rejectionReasons(
      evaluationSpec({ credentialEnvNames: [name] }),
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("refuses an adapter-owned PROMPTFOO_ name", () => {
    const reasons = rejectionReasons(
      evaluationSpec({ credentialEnvNames: ["PROMPTFOO_DISABLE_SHARING"] }),
    );
    expect(reasons.join(" ")).toContain("PROMPTFOO_");
  });
});

describe("the plan is computed once and cannot move afterwards", () => {
  it("produces identical bytes regardless of key insertion order", () => {
    const forward = evaluationSpec();
    // The same data, with every object's keys written in reverse order.
    const reversed = JSON.parse(
      JSON.stringify(forward, (_key, value: unknown) => {
        if (value === null || typeof value !== "object" || Array.isArray(value))
          return value;
        const entries = Object.entries(value as Record<string, unknown>);
        entries.reverse();
        return Object.fromEntries(entries);
      }),
    ) as Record<string, unknown>;

    expect(Object.keys(reversed)).not.toEqual(Object.keys(forward));

    const a = planEvaluation(forward);
    const b = planEvaluation(reversed);
    if (!("plan" in a) || !("plan" in b)) throw new Error("expected plans");

    expect(b.plan.configBytes).toBe(a.plan.configBytes);
    expect(b.plan.identities).toEqual(a.plan.identities);
  });

  it("is unaffected by mutation of the caller's nested objects", () => {
    const input = evaluationSpec();
    const planned = planEvaluation(input);
    if (!("plan" in planned)) throw new Error("expected a plan");
    const before = {
      bytes: planned.plan.configBytes,
      identities: { ...planned.plan.identities },
      candidate: planned.plan.candidateRef,
    };

    // Reach deep into the object the caller still holds and change it.
    const dataset = input.dataset as Record<string, unknown>;
    const rows = dataset.rows as unknown as {
      vars: Record<string, unknown>;
      assert: Record<string, unknown>[];
    }[];
    rows[0]!.vars.ticket = "tampered";
    rows[0]!.assert[0]!.value = "tampered";
    (input.prompts as string[])[0] = "tampered";
    input.candidate_ref = "candidate.tampered";
    (input.provider as Record<string, unknown>).id = "example:tampered";

    expect(planned.plan.configBytes).toBe(before.bytes);
    expect(planned.plan.identities).toEqual(before.identities);
    expect(planned.plan.candidateRef).toBe(before.candidate);
    expect(planned.plan.configBytes).not.toContain("tampered");
  });

  it("digests exactly the bytes it captured", () => {
    const plan = planFor();
    const again = planEvaluation(evaluationSpec());
    if (!("plan" in again)) throw new Error("expected a plan");
    expect(again.plan.configBytes).toBe(plan.configBytes);
    expect(again.plan.identities.config_digest).toBe(
      plan.identities.config_digest,
    );
  });

  it("freezes the plan and its spec", () => {
    const plan = planFor();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.spec)).toBe(true);
    expect(Object.isFrozen(plan.spec.dataset.rows[0])).toBe(true);
  });
});

describe("the expected-evaluation helper", () => {
  it("derives what the adapter will record", () => {
    const plan = planFor();
    const derived = deriveExpectedEvaluation(evaluationSpec(), POLICY);
    if (!("expected_evaluation" in derived)) {
      throw new Error(`unexpected rejection: ${derived.reasons.join("; ")}`);
    }

    expect(derived.expected_evaluation.provider_id).toBe(plan.providerId);
    expect(derived.expected_evaluation.configuration_hash).toBe(
      evaluationIdentityHash(verifiedIdentityOf(plan, TEST_PROVIDERS[0]!)),
    );
  });

  it("moves when the spec moves", () => {
    const base = deriveExpectedEvaluation(evaluationSpec(), POLICY);
    const moved = deriveExpectedEvaluation(
      evaluationSpec({ prompt: "A different prompt: {{ticket}}" }),
      POLICY,
    );
    if (!("expected_evaluation" in base) || !("expected_evaluation" in moved)) {
      throw new Error("expected both to derive");
    }
    expect(moved.expected_evaluation.configuration_hash).not.toBe(
      base.expected_evaluation.configuration_hash,
    );
  });

  it("returns a rejection for an unusable spec rather than throwing", () => {
    const result = deriveExpectedEvaluation({ nope: true }, POLICY);
    expect("reasons" in result).toBe(true);
  });

  it("refuses to derive an expectation without provider policy", () => {
    // Reach and destination are part of the identity, so an expectation made
    // without knowing them would describe no particular endpoint.
    const result = deriveExpectedEvaluation(evaluationSpec());
    expect("reasons" in result).toBe(true);
  });
});
