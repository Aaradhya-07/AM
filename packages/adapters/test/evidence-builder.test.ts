import { describe, expect, it } from "vitest";

import {
  attachEvidence,
  buildEvidenceRecord,
  tierOf,
} from "./evidence-helpers.js";
import { fixtureContract } from "./helpers.js";

const BASE = {
  id: "evidence.example",
  kind: "measured_evaluation",
  subject: "candidate.local.quality",
  claim: "measured macro_f1 on the classification dataset",
  producer: { name: "example-runner", version: "1.2.3" },
  observed_at: "2026-08-10T00:00:00Z",
  source: { type: "local_command", locator: "redacted-command-manifest" },
  applies_to: {
    candidate_ref: "candidate.local",
    workload_ref: "classification",
    constraint_refs: ["quality.classification_f1"],
  },
  value: {
    dataset_ref: "dataset.classification",
    dataset_version: "v1",
    candidate_ref: "candidate.local",
    configuration_hash: "cfg-1",
    identity: {
      workload_ref: "classification",
      dataset_hash: `sha256:${"a".repeat(64)}`,
      prompt_hash: `sha256:${"b".repeat(64)}`,
      evaluator_hash: `sha256:${"c".repeat(64)}`,
      model_configuration_hash: `sha256:${"d".repeat(64)}`,
      config_digest: `sha256:${"e".repeat(64)}`,
      provider_id: "example:model-a",
    },
    metrics: { macro_f1: 0.93 },
    result_artifact_hash: "artifact-1",
  },
  confidence: "high",
  refresh: { policy: "never" },
  standing: "available",
} as const;

function proposal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return structuredClone({ ...BASE, ...overrides });
}

describe("building evidence from an adapter proposal", () => {
  it("accepts a complete, attributed proposal", () => {
    const built = buildEvidenceRecord(proposal());

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.record.id).toBe("evidence.example");
    expect(built.value.tier).toBe("T3");
    expect(built.value.annotations.claim).toContain("macro_f1");
  });

  it("derives the tier from the kind rather than accepting one", () => {
    const inference = buildEvidenceRecord(
      proposal({ kind: "agent_inference", value: { note: "probably fine" } }),
    );

    expect(inference.ok).toBe(true);
    if (!inference.ok) return;
    // An adapter's own reasoning is T0 no matter how it is described.
    expect(inference.value.tier).toBe("T0");
  });

  it("rejects a proposal that tries to declare its own tier", () => {
    const built = buildEvidenceRecord(proposal({ tier: "T3" }));

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.code).toBe("schema_rejected");
  });

  it("rejects a proposal that names no constraint", () => {
    const built = buildEvidenceRecord(
      proposal({
        applies_to: {
          candidate_ref: "candidate.local",
          workload_ref: "classification",
          constraint_refs: [],
        },
      }),
    );

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.code).toBe("attribution_missing");
  });

  it("rejects an inference dressed up as a measurement", () => {
    // `measured_evaluation` demands a dataset, configuration, and artifact
    // hash. An adapter that has only an opinion cannot supply them.
    const built = buildEvidenceRecord(
      proposal({ value: { note: "the model seems accurate" } }),
    );

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.code).toBe("schema_rejected");
  });

  it("discards a result carrying a credential", () => {
    const built = buildEvidenceRecord(
      proposal({
        caveats: ["ran with sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD"],
      }),
    );

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors[0]?.code).toBe("secret_detected");
  });

  it("refuses to treat a failed adapter result as evidence", () => {
    for (const standing of [
      "unavailable",
      "unsupported",
      "failed",
      "timed_out",
      "unknown",
    ]) {
      const built = buildEvidenceRecord(proposal({ standing }));
      expect(built.ok).toBe(false);
    }
  });

  it("reports the tier of every kind consistently with the contract", () => {
    expect(tierOf("measured_evaluation")).toBe("T3");
    expect(tierOf("tool_observation")).toBe("T2");
    expect(tierOf("user_declared")).toBe("T1");
    expect(tierOf("agent_inference")).toBe("T0");
  });
});

describe("attaching evidence to a contract", () => {
  it("appends a valid record and revalidates the whole contract", () => {
    const contract = fixtureContract();
    const built = buildEvidenceRecord(proposal());
    if (!built.ok) throw new Error("expected a valid proposal");

    const result = attachEvidence(contract, [built.value.record]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidence_refs).toHaveLength(1);
    // The input contract is never mutated.
    expect(contract.evidence_refs).toHaveLength(0);
  });

  it("leaves the contract untouched when the merged result would be invalid", () => {
    const contract = fixtureContract();
    const built = buildEvidenceRecord(
      proposal({
        applies_to: {
          candidate_ref: "candidate.ghost",
          workload_ref: "classification",
          constraint_refs: ["quality.classification_f1"],
        },
        value: { ...BASE.value, candidate_ref: "candidate.ghost" },
      }),
    );
    if (!built.ok) throw new Error("expected a schema-valid proposal");

    const result = attachEvidence(contract, [built.value.record]);

    // A dangling reference is caught by the contract, and nothing is written.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((entry) => entry.code === "reference_not_found"),
    ).toBe(true);
    expect(contract.evidence_refs).toHaveLength(0);
  });

  it("refuses to reuse an evidence id", () => {
    const contract = fixtureContract();
    const built = buildEvidenceRecord(proposal());
    if (!built.ok) throw new Error("expected a valid proposal");

    const once = attachEvidence(contract, [built.value.record]);
    if (!once.ok) throw new Error("expected the first attach to succeed");
    const twice = attachEvidence(once.value, [built.value.record]);

    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.issues[0]?.code).toBe("duplicate_id");
  });
});

describe("no adapter output can clear a gate it has not earned", () => {
  const hardQuality = {
    id: "quality.classification_f1",
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
  const policy = { tiers: {}, floors: {} } as never;
  const context = {
    candidateRef: "candidate.local",
    workloadRef: "classification",
  };

  it("refuses a confident inference", async () => {
    const { evaluateConstraint } = await import("@anvilmark/project-contract");
    const built = buildEvidenceRecord(
      proposal({ kind: "agent_inference", value: { verdict: "excellent" } }),
    );
    if (!built.ok) throw new Error("expected a valid proposal");

    expect(
      evaluateConstraint(
        hardQuality,
        "pass",
        [built.value.record],
        policy,
        context,
      ).outcome,
    ).toBe("unknown");
  });

  it("refuses a tool observation reporting the very metric under test", async () => {
    const { evaluateConstraint } = await import("@anvilmark/project-contract");
    const built = buildEvidenceRecord(
      proposal({
        kind: "tool_observation",
        value: {
          estimate_basis: {},
          target_hardware_ref: null,
          detected_hardware_ref: null,
          findings: { macro_f1: 0.99 },
        },
      }),
    );
    if (!built.ok) throw new Error("expected a valid proposal");

    // Reporting the number is not measuring it.
    expect(
      evaluateConstraint(
        hardQuality,
        "pass",
        [built.value.record],
        policy,
        context,
      ).outcome,
    ).toBe("unknown");
  });
});
