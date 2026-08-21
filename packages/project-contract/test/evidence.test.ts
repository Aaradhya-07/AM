import { describe, expect, it } from "vitest";

import type {
  ContractIssue,
  EvidenceKind,
  EvidenceRecord,
  EvidenceTier,
} from "../src/index.js";
import {
  ADMISSIBLE_EVIDENCE_KINDS,
  RATIFIED_EVIDENCE_FLOORS,
  evaluateConstraint,
  floorSubjectForConstraint,
  tierForEvidenceKind,
  tierMeets,
  validateProjectContract,
} from "../src/index.js";
import { at, baseDocument } from "./helpers.js";

function issuesFor(
  mutate: (document: Record<string, unknown>) => void,
): readonly ContractIssue[] {
  const document = baseDocument();
  mutate(document);
  const result = validateProjectContract(document);
  return result.ok ? [] : result.issues;
}

const tierCases: readonly [EvidenceKind, EvidenceTier][] = [
  ["deterministic_observation", "T3"],
  ["measured_evaluation", "T3"],
  ["runtime_measurement", "T3"],
  ["source_code", "T3"],
  ["official_documentation", "T2"],
  ["official_pricing", "T2"],
  ["tool_observation", "T2"],
  ["user_declared", "T1"],
  ["vendor_claim", "T1"],
  ["agent_inference", "T0"],
  ["unknown", "T0"],
];

describe("evidence tiers are derived from the kind, never declared", () => {
  it.each(tierCases)("%s is %s", (kind, tier) => {
    expect(tierForEvidenceKind(kind)).toBe(tier);
  });

  it("orders the tiers T0 < T1 < T2 < T3", () => {
    expect(tierMeets("T3", "T3")).toBe(true);
    expect(tierMeets("T2", "T3")).toBe(false);
    expect(tierMeets("T1", "T0")).toBe(true);
    expect(tierMeets("T0", "T1")).toBe(false);
  });

  it("matches the ratified floor table from decision 06", () => {
    expect(RATIFIED_EVIDENCE_FLOORS).toEqual({
      workload_quality_hard_gate: "T3",
      privacy_data_flow_hard_gate: "T3",
      latency_throughput_hard_gate: "T3",
      token_hard_gate: "T3",
      projected_cost_comparison: "T2",
      realized_cost_hard_gate: "T3",
      license: "T2",
      residency_provider_capability: "T2",
      target_hardware_inventory: "T1",
      hardware_compatibility_estimate: "T2",
      hardware_performance_gate: "T3",
      budget_amount: "T1",
      availability_portability_structure: "T3",
      repository_policy: "T3",
    });
  });
});

describe("floor subjects separate facts that must not be conflated", () => {
  const hard = (domain: string) =>
    ({
      id: "c",
      domain,
      severity: "hard",
      subject: "s",
      operator: "gte",
      value: 1,
      source: "user",
      rationale: null,
      condition: null,
      exceptions: [],
    }) as never;
  const soft = (domain: string) =>
    ({
      id: "c",
      domain,
      severity: "soft",
      direction: "minimize",
      subject: "s",
      operator: "lte",
      value: 1,
      source: "user",
      rationale: null,
      condition: null,
      exceptions: [],
    }) as never;

  it("separates projected cost from a realized-cost hard gate", () => {
    expect(floorSubjectForConstraint(soft("cost"))).toBe(
      "projected_cost_comparison",
    );
    expect(floorSubjectForConstraint(hard("cost"))).toBe(
      "realized_cost_hard_gate",
    );
  });

  it("separates a hardware compatibility estimate from a performance gate", () => {
    expect(floorSubjectForConstraint(soft("hardware"))).toBe(
      "hardware_compatibility_estimate",
    );
    expect(floorSubjectForConstraint(hard("hardware"))).toBe(
      "hardware_performance_gate",
    );
  });

  it("gives soft latency no hard-gate floor", () => {
    expect(floorSubjectForConstraint(hard("latency"))).toBe(
      "latency_throughput_hard_gate",
    );
    expect(floorSubjectForConstraint(soft("latency"))).toBeNull();
  });
});

function evidence(
  id: string,
  kind: EvidenceKind,
  value: Record<string, unknown> = {},
  appliesTo: Record<string, unknown> = {},
  subject = "subject",
): EvidenceRecord {
  return {
    id,
    kind,
    subject,
    producer: { name: "producer", version: null },
    observed_at: "2026-08-17T00:00:00Z",
    source: { type: "manual", locator: null },
    confidence: "medium",
    caveats: [],
    refresh: { policy: "never", expires_at: null },
    applies_to: {
      candidate_ref: null,
      workload_ref: null,
      hardware_ref: null,
      constraint_refs: [],
      ...appliesTo,
    },
    value,
  } as EvidenceRecord;
}

const hardQuality = {
  id: "quality.gate",
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

const emptyPolicy = { tiers: {}, floors: {} } as never;

const CANDIDATE = "candidate.classification.local";
const WORKLOAD = "classification";
const TARGET_HARDWARE = "hardware.declared_target";

/** The context a real caller supplies for a candidate-scoped quality gate. */
const qualityContext = { candidateRef: CANDIDATE, workloadRef: WORKLOAD };

/** Evidence correctly attributed to the candidate and workload under test. */
function attributed(id: string, kind: EvidenceKind): EvidenceRecord {
  const value =
    kind === "measured_evaluation"
      ? {
          dataset_ref: "dataset.classification",
          dataset_version: "v1",
          candidate_ref: CANDIDATE,
          configuration_hash: "cfg",
          metrics: { macro_f1: 0.95 },
          result_artifact_hash: "artifact",
        }
      : kind === "runtime_measurement"
        ? {
            window_start: "2026-08-01T00:00:00Z",
            window_end: "2026-08-02T00:00:00Z",
            coverage: 1,
            metrics: { p95_ms: 800 },
          }
        : {};
  return evidence(id, kind, value, {
    candidate_ref: CANDIDATE,
    workload_ref: WORKLOAD,
    constraint_refs: ["quality.gate"],
  });
}

describe("evidence below the floor yields unknown and never satisfies a hard constraint", () => {
  const belowFloorKinds: readonly EvidenceKind[] = [
    "agent_inference",
    "unknown",
    "vendor_claim",
    "user_declared",
    "official_documentation",
    "tool_observation",
  ];

  it.each(belowFloorKinds)(
    "downgrades an asserted pass backed only by %s",
    (kind) => {
      const result = evaluateConstraint(
        hardQuality,
        "pass",
        [attributed("e", kind)],
        emptyPolicy,
      );

      expect(result.outcome).toBe("unknown");
      expect(result.downgradedFrom).toBe("pass");
      expect(result.explanation).toContain("never satisfies a hard constraint");
    },
  );

  it("admits only measured evaluation for a workload quality gate", () => {
    const allKinds: readonly EvidenceKind[] = [
      "deterministic_observation",
      "measured_evaluation",
      "runtime_measurement",
      "source_code",
      "official_documentation",
      "official_pricing",
      "tool_observation",
      "user_declared",
      "vendor_claim",
      "agent_inference",
      "unknown",
    ];

    const satisfying = allKinds.filter(
      (kind) =>
        evaluateConstraint(
          hardQuality,
          "pass",
          [attributed("e", kind)],
          emptyPolicy,
          qualityContext,
        ).outcome === "pass",
    );

    // Not "every T3 kind". Reading source code is a T3 observation but it is
    // not a measured evaluation of this workload's quality.
    expect(satisfying).toEqual(["measured_evaluation"]);
  });

  it("does not let source-code observation satisfy workload quality", () => {
    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [attributed("src", "source_code")],
      emptyPolicy,
      qualityContext,
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "cannot establish workload_quality_hard_gate",
    );
  });

  it("accepts a pass backed by a measured evaluation", () => {
    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [attributed("e", "measured_evaluation")],
      emptyPolicy,
      qualityContext,
    );

    expect(result.outcome).toBe("pass");
    expect(result.assessment.bestTier).toBe("T3");
  });

  it("yields unknown when nothing at all is cited", () => {
    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [],
      emptyPolicy,
      qualityContext,
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.bestTier).toBe("T0");
  });

  it("takes the strongest tier among several cited records", () => {
    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [
        attributed("weak", "agent_inference"),
        attributed("strong", "measured_evaluation"),
      ],
      emptyPolicy,
      qualityContext,
    );

    expect(result.outcome).toBe("pass");
  });

  it("preserves a reported failure regardless of tier", () => {
    const result = evaluateConstraint(
      hardQuality,
      "fail",
      [attributed("e", "agent_inference")],
      emptyPolicy,
      qualityContext,
    );

    expect(result.outcome).toBe("fail");
  });

  it("never scores an informational constraint", () => {
    const informational = {
      ...(hardQuality as unknown as Record<string, unknown>),
      severity: "informational",
    } as never;

    expect(
      evaluateConstraint(informational, "pass", [], emptyPolicy, qualityContext)
        .outcome,
    ).toBe("not_applicable");
  });

  it("rejects a contract that persists an unsupported pass", () => {
    const issues = issuesFor((d) => {
      at(d, "candidates", 0, "constraint_results", 0).evidence_refs = [
        "evidence.vendor.claim",
      ];
    });

    const match = issues.find(
      (entry) => entry.code === "pass_below_evidence_floor",
    );
    expect(match?.path).toBe("candidates[0].constraint_results[0].status");
    // The vendor claim is not merely too weak, it is inadmissible for a
    // quality gate, so it contributes no tier at all.
    expect(match?.details).toMatchObject({
      best_tier: "T0",
      required_floor: "T3",
      floor_subject: "workload_quality_hard_gate",
      resolved_outcome: "unknown",
    });
  });
});

describe("evidence floors may be raised but never lowered", () => {
  it("rejects a contract that weakens a ratified floor", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_policy").floors = { workload_quality_hard_gate: "T0" };
    });

    const match = issues.find(
      (entry) => entry.code === "evidence_floor_below_ratified_baseline",
    );
    expect(match?.details).toMatchObject({ declared: "T0", ratified: "T3" });
  });

  it("applies the ratified floor when a contract declares none", () => {
    const issues = issuesFor((d) => {
      delete (at(d, "evidence_policy") as Record<string, unknown>).floors;
      at(d, "candidates", 0, "constraint_results", 0).evidence_refs = [
        "evidence.vendor.claim",
      ];
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "pass_below_evidence_floor" &&
          (entry.details as { required_floor?: string }).required_floor ===
            "T3",
      ),
    ).toBe(true);
  });

  it("accepts a contract that raises a floor", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_policy").floors = { projected_cost_comparison: "T3" };
    });

    expect(issues).toEqual([]);
  });
});

describe("declared target and detected local hardware stay separate subjects", () => {
  it("keeps both machines as independent entries", () => {
    const document = baseDocument();
    const result = validateProjectContract(document);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [target, detected] = result.value.resources.hardware;
    expect(target?.evidence_kind).toBe("user_declared");
    expect(detected?.evidence_kind).toBe("deterministic_observation");
    // The detected machine has no GPU; the declared target must not inherit it.
    expect(target?.accelerators).toHaveLength(1);
    expect(detected?.accelerators).toHaveLength(0);
  });

  it("refuses hardware-fit evidence whose target and detected machines differ", () => {
    const issues = issuesFor((d) => {
      (d.evidence_refs as unknown[]).push({
        id: "evidence.fit.mismatched",
        kind: "tool_observation",
        subject: "candidate.classification.local.hardware_fit",
        producer: { name: "example-fit-tool", version: "1.1.0" },
        observed_at: "2026-08-17T00:00:00Z",
        source: { type: "local_command", locator: "redacted-command-manifest" },
        applies_to: { candidate_ref: "candidate.classification.local" },
        value: {
          target_hardware_ref: "hardware.declared_target",
          detected_hardware_ref: "hardware.detected_local",
          findings: { fit_level: "good" },
        },
        confidence: "medium",
        caveats: [],
        refresh: { policy: "on_hardware_or_model_change" },
      });
      at(d, "candidates", 0).measurements = {
        quality_result_ref: "evidence.eval.classification",
        hardware_fit_evidence_ref: "evidence.fit.mismatched",
      };
    });

    const match = issues.find(
      (entry) => entry.code === "estimate_presented_as_measurement",
    );
    expect(match?.path).toBe(
      "candidates[0].measurements.hardware_fit_evidence_ref",
    );
    expect(match?.details).toMatchObject({
      target_hardware_ref: "hardware.declared_target",
      detected_hardware_ref: "hardware.detected_local",
    });
  });

  it("accepts hardware-fit evidence that inspected the declared target", () => {
    const issues = issuesFor((d) => {
      (d.evidence_refs as unknown[]).push({
        id: "evidence.fit.matched",
        kind: "tool_observation",
        subject: "candidate.classification.local.hardware_fit",
        producer: { name: "example-fit-tool", version: "1.1.0" },
        observed_at: "2026-08-17T00:00:00Z",
        source: { type: "local_command", locator: "redacted-command-manifest" },
        applies_to: { candidate_ref: "candidate.classification.local" },
        value: {
          target_hardware_ref: "hardware.declared_target",
          detected_hardware_ref: "hardware.declared_target",
          findings: { fit_level: "good" },
        },
        confidence: "medium",
        caveats: [],
        refresh: { policy: "on_hardware_or_model_change" },
      });
      at(d, "candidates", 0).measurements = {
        quality_result_ref: "evidence.eval.classification",
        hardware_fit_evidence_ref: "evidence.fit.matched",
      };
    });

    expect(issues).toEqual([]);
  });

  it("excludes mismatched evidence from raising a tier", () => {
    const mismatched = evidence(
      "fit",
      "tool_observation",
      {
        estimate_basis: {},
        target_hardware_ref: "hardware.a",
        detected_hardware_ref: "hardware.b",
        findings: {},
      },
      { candidate_ref: "cand", constraint_refs: ["hw"] },
    );
    const softHardware = {
      id: "hw",
      domain: "hardware",
      severity: "soft",
      direction: "maximize",
      subject: "s",
      operator: "gte",
      value: 1,
      source: "user",
      rationale: null,
      condition: null,
      exceptions: [],
    } as never;

    const result = evaluateConstraint(
      softHardware,
      "pass",
      [mismatched],
      emptyPolicy,
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.bestTier).toBe("T0");
    expect(result.assessment.excluded[0]?.id).toBe("fit");
  });
});

describe("an estimate cannot be presented as a measurement", () => {
  const badMeasurementCases: readonly [string, EvidenceKind][] = [
    ["quality_result_ref", "vendor_claim"],
    ["quality_result_ref", "agent_inference"],
    ["quality_result_ref", "tool_observation"],
    ["latency_measurement_ref", "official_documentation"],
    ["cost_measurement_ref", "official_pricing"],
  ];

  it.each(badMeasurementCases)(
    "rejects %s citing %s evidence",
    (field, kind) => {
      const issues = issuesFor((d) => {
        (d.evidence_refs as unknown[]).push({
          id: "evidence.not_a_measurement",
          kind,
          subject: "candidate.classification.local",
          producer: { name: "source" },
          observed_at: "2026-08-17T00:00:00Z",
          source: { type: "url", locator: "https://example.invalid/doc" },
          value:
            kind === "official_pricing"
              ? { currency: "USD", unit: "1k_tokens", amount: 0.5 }
              : kind === "tool_observation"
                ? { findings: {} }
                : { claim: true },
          confidence: "low",
          caveats: [],
          refresh: { policy: "periodic" },
        });
        at(d, "candidates", 0).measurements = {
          [field]: "evidence.not_a_measurement",
        };
      });

      expect(
        issues.some(
          (entry) =>
            entry.code === "estimate_presented_as_measurement" &&
            entry.path === `candidates[0].measurements.${field}`,
        ),
      ).toBe(true);
    },
  );

  it("requires evaluation evidence to carry a dataset, configuration, and artifact hash", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 0).value = { metrics: { macro_f1: 0.93 } };
    });

    expect(
      issues.some((entry) => entry.path.startsWith("evidence_refs[0].value")),
    ).toBe(true);
  });

  it("requires runtime evidence to state its collection window", () => {
    const issues = issuesFor((d) => {
      (d.evidence_refs as unknown[]).push({
        id: "evidence.runtime.partial",
        kind: "runtime_measurement",
        subject: "candidate.classification.local",
        producer: { name: "collector" },
        observed_at: "2026-08-17T00:00:00Z",
        source: { type: "api", locator: null },
        value: { metrics: { p95_ms: 800 } },
        confidence: "high",
        caveats: [],
        refresh: { policy: "periodic" },
      });
    });

    expect(
      issues.some((entry) => entry.path.startsWith("evidence_refs[2].value")),
    ).toBe(true);
  });
});

describe("informational constraints are recorded, never scored", () => {
  it("does not report an evidence shortfall for an informational constraint", () => {
    const issues = issuesFor((d) => {
      at(d, "constraints", 0).severity = "informational";
      at(d, "candidates", 0, "constraint_results", 0).evidence_refs = [];
    });

    expect(
      issues.some((entry) => entry.code === "pass_below_evidence_floor"),
    ).toBe(false);
  });

  it("still reports an evidence shortfall for the equivalent hard constraint", () => {
    const issues = issuesFor((d) => {
      at(d, "candidates", 0, "constraint_results", 0).evidence_refs = [];
    });

    expect(
      issues.some((entry) => entry.code === "pass_below_evidence_floor"),
    ).toBe(true);
  });
});

const runtimeValue = {
  window_start: "2026-08-01T00:00:00Z",
  window_end: "2026-08-02T00:00:00Z",
  coverage: 1,
  metrics: { tps: 42 },
};

const hardwareGate = {
  id: "hw",
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

/** Full hardware context: declared targets plus the candidate's deployment. */
const hardwareContext = {
  candidateRef: CANDIDATE,
  workloadRef: WORKLOAD,
  declaredTargetHardwareRefs: [TARGET_HARDWARE],
  deploymentHardwareRef: TARGET_HARDWARE,
};

const softCost = {
  id: "cost",
  domain: "cost",
  severity: "soft",
  direction: "minimize",
  subject: "project.ai_effective_cost_monthly_usd",
  operator: "lte",
  value: 500,
  source: "user",
  rationale: null,
  condition: null,
  exceptions: [],
} as never;

function pricingEvidence(): EvidenceRecord {
  return evidence(
    "price",
    "official_pricing",
    {
      currency: "USD",
      unit: "1k_tokens",
      amount: 0.5,
      region: null,
      tier: null,
      exclusions: [],
    },
    { candidate_ref: CANDIDATE, constraint_refs: ["cost"] },
  );
}

describe("evidence must be about the thing it is cited for", () => {
  const softLatency = {
    id: "lat",
    domain: "latency",
    severity: "hard",
    subject: "workload.classification.latency_p95_ms",
    operator: "lte",
    value: 1000,
    source: "user",
    rationale: null,
    condition: null,
    exceptions: [],
  } as never;

  const hardPrivacy = {
    id: "priv",
    domain: "privacy",
    severity: "hard",
    subject: "data.raw_ticket",
    operator: "must_not_leave",
    value: "local_trust_boundary",
    source: "user",
    rationale: null,
    condition: null,
    exceptions: [],
  } as never;

  it("does not let a runtime measurement satisfy a privacy data-flow gate", () => {
    const result = evaluateConstraint(
      hardPrivacy,
      "pass",
      [
        evidence(
          "rt",
          "runtime_measurement",
          {
            window_start: "2026-08-01T00:00:00Z",
            window_end: "2026-08-02T00:00:00Z",
            coverage: 1,
            metrics: { p95_ms: 800 },
          },
          { constraint_refs: ["priv"] },
        ),
      ],
      emptyPolicy,
      {},
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "cannot establish privacy_data_flow_hard_gate",
    );
  });

  it("does let a deterministic source observation satisfy a privacy gate", () => {
    const result = evaluateConstraint(
      hardPrivacy,
      "pass",
      [
        evidence(
          "obs",
          "deterministic_observation",
          {},
          { constraint_refs: ["priv"] },
        ),
      ],
      emptyPolicy,
      {},
    );

    expect(result.outcome).toBe("pass");
  });

  it("does not let a measurement of another candidate satisfy a latency gate", () => {
    const result = evaluateConstraint(
      softLatency,
      "pass",
      [
        evidence(
          "rt",
          "runtime_measurement",
          {
            window_start: "2026-08-01T00:00:00Z",
            window_end: "2026-08-02T00:00:00Z",
            coverage: 1,
            metrics: { p95_ms: 800 },
          },
          { candidate_ref: "candidate.other", constraint_refs: ["lat"] },
        ),
      ],
      emptyPolicy,
      { candidateRef: "candidate.classification.local" },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      'describes candidate "candidate.other"',
    );
  });

  it("does not let unattributed evidence satisfy a candidate-scoped gate", () => {
    const result = evaluateConstraint(
      softLatency,
      "pass",
      [
        evidence(
          "rt",
          "runtime_measurement",
          {
            window_start: "2026-08-01T00:00:00Z",
            window_end: "2026-08-02T00:00:00Z",
            coverage: 1,
            metrics: { p95_ms: 800 },
          },
          { constraint_refs: ["lat"] },
        ),
      ],
      emptyPolicy,
      { candidateRef: "candidate.classification.local", workloadRef: WORKLOAD },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "not attributed to any candidate",
    );
  });

  it("rejects an evaluation run against a different candidate than it claims", () => {
    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [
        evidence(
          "eval",
          "measured_evaluation",
          {
            dataset_ref: "d",
            dataset_version: "v1",
            candidate_ref: "candidate.other",
            configuration_hash: "cfg",
            metrics: { macro_f1: 0.95 },
            result_artifact_hash: "art",
          },
          {
            candidate_ref: "candidate.classification.local",
            constraint_refs: ["quality.gate"],
          },
        ),
      ],
      emptyPolicy,
      {
        candidateRef: "candidate.classification.local",
        workloadRef: WORKLOAD,
      },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      'run against candidate "candidate.other"',
    );
  });

  it("requires a hardware benchmark to run on the deployment target", () => {
    const onDetected = evaluateConstraint(
      hardwareGate,
      "pass",
      [
        evidence("bench", "runtime_measurement", runtimeValue, {
          candidate_ref: CANDIDATE,
          hardware_ref: "hardware.detected_local",
          constraint_refs: ["hw"],
        }),
      ],
      emptyPolicy,
      hardwareContext,
    );

    expect(onDetected.outcome).toBe("unknown");
    expect(onDetected.assessment.excluded[0]?.reason).toContain(
      "not the candidate's deployment target",
    );
  });

  it("keeps a user declaration authoritative for declared target inventory", () => {
    // A detected machine is T3, but it can never establish what the user owns.
    expect(ADMISSIBLE_EVIDENCE_KINDS.target_hardware_inventory).toEqual([
      "user_declared",
    ]);
    expect(ADMISSIBLE_EVIDENCE_KINDS.target_hardware_inventory).not.toContain(
      "deterministic_observation",
    );
  });
});

describe("evidence records carry verified references of their own", () => {
  it("rejects an evaluation naming a candidate that does not exist", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 0, "value").candidate_ref = "candidate.ghost";
      at(d, "evidence_refs", 0, "applies_to").candidate_ref = "candidate.ghost";
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "reference_not_found" &&
          entry.path === "evidence_refs[0].value.candidate_ref",
      ),
    ).toBe(true);
  });

  it("rejects an evaluation that claims to apply to a candidate it did not run against", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 0, "applies_to").candidate_ref =
        "candidate.classification.remote";
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "reference_wrong_type" &&
          entry.path === "evidence_refs[0].value.candidate_ref",
      ),
    ).toBe(true);
  });

  it("rejects tool-observation hardware refs that do not resolve", () => {
    const issues = issuesFor((d) => {
      (d.evidence_refs as unknown[]).push({
        id: "evidence.fit.ghost",
        kind: "tool_observation",
        subject: "fit",
        producer: { name: "tool" },
        observed_at: "2026-08-17T00:00:00Z",
        source: { type: "local_command", locator: "redacted" },
        applies_to: { candidate_ref: "candidate.classification.local" },
        value: {
          target_hardware_ref: "hardware.ghost",
          detected_hardware_ref: "hardware.declared_target",
          findings: {},
        },
        confidence: "medium",
        caveats: [],
        refresh: { policy: "never" },
      });
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "reference_not_found" &&
          entry.path === "evidence_refs[2].value.target_hardware_ref",
      ),
    ).toBe(true);
  });

  it("rejects evidence applies_to refs that do not resolve", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 1, "applies_to").workload_ref = "workload.ghost";
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "reference_not_found" &&
          entry.path === "evidence_refs[1].applies_to.workload_ref",
      ),
    ).toBe(true);
  });

  it("rejects a measurement citing evidence about a different candidate", () => {
    const issues = issuesFor((d) => {
      at(d, "candidates", 1).measurements = {
        quality_result_ref: "evidence.eval.classification",
      };
    });

    const match = issues.find(
      (entry) => entry.code === "evidence_not_applicable",
    );
    expect(match?.path).toBe("candidates[1].measurements.quality_result_ref");
    expect(match?.details).toMatchObject({
      describes: "candidate.classification.local",
      candidate: "candidate.classification.remote",
    });
  });
});

/**
 * Missing validation context must never relax a gate.
 *
 * These call the exported API the way a Milestone 2 adapter would, including
 * the careless ways, and assert that every omission lands on `unknown`.
 */
describe("the evidence API fails closed on missing context", () => {
  it("returns unknown for a quality evaluation with no context at all", () => {
    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [attributed("e", "measured_evaluation")],
      emptyPolicy,
      {},
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "no candidate context was supplied",
    );
  });

  it("returns unknown when the evaluation is attributed to another candidate", () => {
    const otherCandidate = evidence(
      "e",
      "measured_evaluation",
      {
        dataset_ref: "d",
        dataset_version: "v1",
        candidate_ref: "candidate.someone_else",
        configuration_hash: "cfg",
        metrics: { macro_f1: 0.99 },
        result_artifact_hash: "artifact",
      },
      {
        candidate_ref: "candidate.someone_else",
        workload_ref: WORKLOAD,
        constraint_refs: ["quality.gate"],
      },
    );

    expect(
      evaluateConstraint(
        hardQuality,
        "pass",
        [otherCandidate],
        emptyPolicy,
        qualityContext,
      ).outcome,
    ).toBe("unknown");

    // And with no context at all it must still not pass.
    expect(
      evaluateConstraint(hardQuality, "pass", [otherCandidate], emptyPolicy, {})
        .outcome,
    ).toBe("unknown");
  });

  it("returns unknown when workload context is required but absent", () => {
    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [attributed("e", "measured_evaluation")],
      emptyPolicy,
      { candidateRef: CANDIDATE },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "no workload context was supplied",
    );
  });

  const costContext = { candidateRef: CANDIDATE, workloadRef: WORKLOAD };

  it("returns unknown for projected cost with no context", () => {
    expect(
      evaluateConstraint(softCost, "pass", [pricingEvidence()], emptyPolicy, {})
        .outcome,
    ).toBe("unknown");
  });

  it("returns unknown for pricing with only a calculation basis", () => {
    const result = evaluateConstraint(
      softCost,
      "pass",
      [pricingEvidence()],
      emptyPolicy,
      { ...costContext, hasExplicitCostCalculation: true },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.shortfall).toContain("usage inputs");
  });

  it("returns unknown for pricing with only declared usage inputs", () => {
    const result = evaluateConstraint(
      softCost,
      "pass",
      [pricingEvidence()],
      emptyPolicy,
      { ...costContext, hasDeclaredUsageInputs: true },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.shortfall).toContain("projected monthly cost");
  });

  it("returns pass only for complete pricing, arithmetic, and usage inputs", () => {
    const result = evaluateConstraint(
      softCost,
      "pass",
      [pricingEvidence()],
      emptyPolicy,
      {
        ...costContext,
        hasExplicitCostCalculation: true,
        hasDeclaredUsageInputs: true,
      },
    );

    expect(result.outcome).toBe("pass");
  });

  it("returns unknown for a hardware observation with null target and detected refs", () => {
    const result = evaluateConstraint(
      hardwareGate,
      "pass",
      [
        evidence(
          "fit",
          "tool_observation",
          {
            estimate_basis: {},
            target_hardware_ref: null,
            detected_hardware_ref: null,
            findings: {},
          },
          { candidate_ref: CANDIDATE, constraint_refs: ["hw"] },
        ),
      ],
      emptyPolicy,
      { ...hardwareContext },
    );

    expect(result.outcome).toBe("unknown");
  });

  it("returns unknown for a benchmark on a different declared machine", () => {
    const result = evaluateConstraint(
      hardwareGate,
      "pass",
      [
        evidence("bench", "runtime_measurement", runtimeValue, {
          candidate_ref: CANDIDATE,
          hardware_ref: "hardware.other_declared",
          constraint_refs: ["hw"],
        }),
      ],
      emptyPolicy,
      {
        ...hardwareContext,
        // Both machines are declared; only one is this candidate's target.
        declaredTargetHardwareRefs: [
          TARGET_HARDWARE,
          "hardware.other_declared",
        ],
      },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "not the candidate's deployment target",
    );
  });

  it("returns unknown when declared-target context is missing entirely", () => {
    const result = evaluateConstraint(
      hardwareGate,
      "pass",
      [
        evidence("bench", "runtime_measurement", runtimeValue, {
          candidate_ref: CANDIDATE,
          hardware_ref: TARGET_HARDWARE,
          constraint_refs: ["hw"],
        }),
      ],
      emptyPolicy,
      { candidateRef: CANDIDATE, workloadRef: WORKLOAD },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "declared-target hardware context",
    );
  });

  it("returns pass for a benchmark with complete matching hardware context", () => {
    const result = evaluateConstraint(
      hardwareGate,
      "pass",
      [
        evidence("bench", "runtime_measurement", runtimeValue, {
          candidate_ref: CANDIDATE,
          hardware_ref: TARGET_HARDWARE,
          constraint_refs: ["hw"],
        }),
      ],
      emptyPolicy,
      hardwareContext,
    );

    expect(result.outcome).toBe("pass");
  });

  it("fails closed rather than throwing when a JavaScript caller omits context", () => {
    const unsafe = evaluateConstraint as unknown as (...args: unknown[]) => {
      outcome: string;
    };

    expect(
      unsafe(
        hardQuality,
        "pass",
        [attributed("e", "measured_evaluation")],
        emptyPolicy,
      ).outcome,
    ).toBe("unknown");
  });
});

/**
 * Evidence must name the CLAIM it supports.
 *
 * Kind and subject cannot express this: a source-code observation of logging
 * configuration is a T3 record admissible for privacy in the abstract, and a
 * macro-F1 evaluation is a T3 measurement of the right candidate and workload.
 * Neither says anything about the specific constraint it gets cited for.
 */
describe("evidence must be attributed to the constraint it supports", () => {
  const privacyGate = {
    id: "privacy.raw_ticket",
    domain: "privacy",
    severity: "hard",
    subject: "data.raw_ticket",
    operator: "must_not_leave",
    value: "local_trust_boundary",
    source: "user",
    rationale: null,
    condition: null,
    exceptions: [],
  } as never;

  const latencyGate = {
    id: "latency.classification_p95",
    domain: "latency",
    severity: "hard",
    subject: "workload.classification.latency_p95_ms",
    operator: "lte",
    value: 1000,
    source: "user",
    rationale: null,
    condition: null,
    exceptions: [],
  } as never;

  it("does not let an unrelated source-code observation satisfy privacy", () => {
    const unrelated = evidence(
      "logging",
      "source_code",
      {},
      {},
      "unrelated.logging.config",
    );

    const result = evaluateConstraint(
      privacyGate,
      "pass",
      [unrelated],
      emptyPolicy,
      {},
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      "not attributed to any constraint",
    );
  });

  it("does let a source-code observation attributed to privacy satisfy it", () => {
    const attributedToPrivacy = evidence(
      "redaction",
      "source_code",
      {},
      { constraint_refs: ["privacy.raw_ticket"] },
      "src/redaction/redactor.ts",
    );

    expect(
      evaluateConstraint(
        privacyGate,
        "pass",
        [attributedToPrivacy],
        emptyPolicy,
        {},
      ).outcome,
    ).toBe("pass");
  });

  it("does not let a macro_f1 evaluation satisfy latency when candidate and workload match", () => {
    const qualityOnly = evidence(
      "eval",
      "measured_evaluation",
      {
        dataset_ref: "dataset.classification",
        dataset_version: "v1",
        candidate_ref: CANDIDATE,
        configuration_hash: "cfg",
        metrics: { macro_f1: 0.93 },
        result_artifact_hash: "artifact",
      },
      {
        candidate_ref: CANDIDATE,
        workload_ref: WORKLOAD,
        constraint_refs: ["quality.classification_f1"],
      },
    );

    const result = evaluateConstraint(
      latencyGate,
      "pass",
      [qualityOnly],
      emptyPolicy,
      { candidateRef: CANDIDATE, workloadRef: WORKLOAD },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain(
      'not "latency.classification_p95"',
    );
  });

  it("lets one artifact support two constraints only when both ids are listed", () => {
    const value = {
      dataset_ref: "dataset.classification",
      dataset_version: "v1",
      candidate_ref: CANDIDATE,
      configuration_hash: "cfg",
      metrics: { macro_f1: 0.93, p95_ms: 800 },
      result_artifact_hash: "artifact",
    };
    const context = { candidateRef: CANDIDATE, workloadRef: WORKLOAD };

    const onlyQuality = evidence("both", "measured_evaluation", value, {
      candidate_ref: CANDIDATE,
      workload_ref: WORKLOAD,
      constraint_refs: ["quality.gate"],
    });
    expect(
      evaluateConstraint(
        hardQuality,
        "pass",
        [onlyQuality],
        emptyPolicy,
        context,
      ).outcome,
    ).toBe("pass");
    expect(
      evaluateConstraint(
        latencyGate,
        "pass",
        [onlyQuality],
        emptyPolicy,
        context,
      ).outcome,
    ).toBe("unknown");

    const both = evidence("both", "measured_evaluation", value, {
      candidate_ref: CANDIDATE,
      workload_ref: WORKLOAD,
      constraint_refs: ["quality.gate", "latency.classification_p95"],
    });
    expect(
      evaluateConstraint(hardQuality, "pass", [both], emptyPolicy, context)
        .outcome,
    ).toBe("pass");
    expect(
      evaluateConstraint(latencyGate, "pass", [both], emptyPolicy, context)
        .outcome,
    ).toBe("pass");
  });
});

describe("constraint attribution is validated", () => {
  it("rejects a constraint_ref that does not resolve", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 0, "applies_to").constraint_refs = [
        "constraint.ghost",
      ];
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "reference_not_found" &&
          entry.path === "evidence_refs[0].applies_to.constraint_refs[0]",
      ),
    ).toBe(true);
  });

  it("rejects a constraint_ref of the wrong subject type", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 0, "applies_to").constraint_refs = [
        "classification",
      ];
    });

    const match = issues.find(
      (entry) =>
        entry.path === "evidence_refs[0].applies_to.constraint_refs[0]",
    );
    expect(match?.code).toBe("reference_wrong_type");
    expect(match?.details).toHaveProperty("found_as");
  });

  it("rejects duplicate constraint refs", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 0, "applies_to").constraint_refs = [
        "quality.classification_f1",
        "quality.classification_f1",
      ];
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "duplicate_id" &&
          entry.path === "evidence_refs[0].applies_to.constraint_refs[1]",
      ),
    ).toBe(true);
  });

  it("rejects a constraint result citing evidence attributed elsewhere", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 0, "applies_to").constraint_refs = [
        "privacy.raw_remote",
      ];
    });

    const match = issues.find(
      (entry) => entry.code === "evidence_not_applicable",
    );
    expect(match?.path).toBe(
      "candidates[0].constraint_results[0].evidence_refs[0]",
    );
    expect(match?.details).toMatchObject({
      constraint: "quality.classification_f1",
      attributed_to: ["privacy.raw_remote"],
    });
  });

  it("rejects a constraint result citing evidence with no attribution", () => {
    const issues = issuesFor((d) => {
      at(d, "evidence_refs", 0, "applies_to").constraint_refs = [];
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "evidence_not_applicable" &&
          entry.path === "candidates[0].constraint_results[0].evidence_refs[0]",
      ),
    ).toBe(true);
  });

  it("leaves direct measurement references exempt from constraint attribution", () => {
    // The candidate cites the evaluation as a measurement AND supports a
    // constraint result with it. Only the latter needs constraint attribution.
    const issues = issuesFor((d) => {
      at(d, "candidates", 0).constraint_results = [];
      at(d, "decisions", 0).satisfies_constraints = [];
      at(d, "evidence_refs", 0, "applies_to").constraint_refs = [];
    });

    expect(issues).toEqual([]);
  });
});

describe("usage inputs must come from the user, not a vendor", () => {
  const costResult = (basis: string) =>
    issuesFor((d) => {
      at(d, "workloads", 0, "expected_usage").basis = basis;
      at(d, "candidates", 0).estimates = {
        monthly_effective_cost_usd: 120,
        basis: "official pricing multiplied by declared monthly call volume",
        assumptions: ["40k calls per month at 900 input tokens"],
      };
      (d.evidence_refs as unknown[]).push({
        id: "evidence.pricing",
        kind: "official_pricing",
        subject: "candidate pricing",
        producer: { name: "publisher" },
        observed_at: "2026-08-17T00:00:00Z",
        source: { type: "url", locator: "https://example.invalid/pricing" },
        applies_to: {
          candidate_ref: "candidate.classification.local",
          constraint_refs: ["cost.monthly"],
        },
        value: {
          currency: "USD",
          unit: "1k_tokens",
          amount: 0.5,
          exclusions: [],
        },
        confidence: "high",
        caveats: [],
        refresh: { policy: "on_pricing_change" },
      });
      (
        at(d, "candidates", 0).constraint_results as Record<string, unknown>[]
      ).push({
        constraint_ref: "cost.monthly",
        status: "pass",
        evidence_refs: ["evidence.pricing"],
        determinism: "deterministic",
      });
    });

  it("accepts a user assumption as usage evidence", () => {
    expect(costResult("user_assumption")).toEqual([]);
  });

  it("accepts a measured usage basis", () => {
    expect(costResult("measured")).toEqual([]);
  });

  it("rejects a vendor claim as the user's usage assumption", () => {
    // A model or provider vendor cannot establish how many calls the user's
    // application will make.
    expect(
      costResult("vendor_claim").some(
        (entry) => entry.code === "pass_below_evidence_floor",
      ),
    ).toBe(true);
  });

  it("rejects an agent-inferred usage basis", () => {
    expect(
      costResult("agent_inference").some(
        (entry) => entry.code === "pass_below_evidence_floor",
      ),
    ).toBe(true);
  });
});
