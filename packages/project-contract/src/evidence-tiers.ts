import type { Constraint } from "./schema/constraints.js";
import type {
  EvidenceFloorSubject,
  EvidenceKind,
  EvidencePolicy,
  EvidenceRecord,
  EvidenceTier,
} from "./schema/evidence.js";
import type { Outcome } from "./schema/primitives.js";

/** Total ordering of evidence tiers, weakest first. */
export const TIER_ORDER: readonly EvidenceTier[] = ["T0", "T1", "T2", "T3"];

const TIER_RANK: Readonly<Record<EvidenceTier, number>> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
};

export function tierRank(tier: EvidenceTier): number {
  return TIER_RANK[tier];
}

/** True when `tier` is at least as strong as `floor`. */
export function tierMeets(tier: EvidenceTier, floor: EvidenceTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[floor];
}

/**
 * The tier of a piece of evidence is DERIVED from its kind, never declared.
 * This is what stops a vendor claim or an agent inference from being labelled
 * a measurement in order to clear a hard gate.
 *
 * Ratified in doc 06 section 6.
 */
const KIND_TIER: Readonly<Record<EvidenceKind, EvidenceTier>> = {
  // T3 — directly observed or measured.
  deterministic_observation: "T3",
  measured_evaluation: "T3",
  runtime_measurement: "T3",
  source_code: "T3",
  // T2 — attributable authoritative evidence.
  official_documentation: "T2",
  official_pricing: "T2",
  tool_observation: "T2",
  // T1 — declared or claimed.
  user_declared: "T1",
  vendor_claim: "T1",
  // T0 — inference or absence.
  agent_inference: "T0",
  unknown: "T0",
};

export function tierForEvidenceKind(kind: EvidenceKind): EvidenceTier {
  return KIND_TIER[kind];
}

export function tierForEvidence(record: EvidenceRecord): EvidenceTier {
  return tierForEvidenceKind(record.kind);
}

/**
 * The ratified per-subject evidence floors, taken verbatim from the amended
 * table in doc 06 section 6.
 *
 * The separation matters: a projected cost comparison may proceed on T2
 * official pricing plus T1 usage assumptions, while a HARD realized-cost gate
 * demands T3 billing measurement. Collapsing the two would let an estimate be
 * presented as a measurement.
 */
export const RATIFIED_EVIDENCE_FLOORS: Readonly<
  Record<EvidenceFloorSubject, EvidenceTier>
> = {
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
};

/**
 * Which evidence KINDS can speak to each subject.
 *
 * The tier ladder answers "how strong is this evidence"; it does not answer
 * "is this evidence about the right thing". Decision 06 section 6 states a
 * requirement per subject, not a universal rule that any T3 record satisfies
 * any T3 floor. Reading source code is a T3 observation, but it is not a
 * measured evaluation of a workload's quality, and a runtime latency trace is
 * not a deterministic observation of where data flows.
 *
 * Two entries are deliberately narrow rather than tier-driven:
 *
 *   - `target_hardware_inventory` admits only `user_declared`, because the
 *     user's declaration is authoritative for what they own or plan. A
 *     detected machine must never overwrite a declared target.
 *   - `budget_amount` admits only `user_declared` for the same reason.
 *
 * `privacy_data_flow_hard_gate` admits deterministic and source observation.
 * Decision 06 says runtime "may add confirmation": it can corroborate a
 * finding, but it cannot establish the gate on its own, so it is not listed.
 */
export const ADMISSIBLE_EVIDENCE_KINDS: Readonly<
  Record<EvidenceFloorSubject, readonly EvidenceKind[]>
> = {
  workload_quality_hard_gate: ["measured_evaluation"],
  privacy_data_flow_hard_gate: ["deterministic_observation", "source_code"],
  latency_throughput_hard_gate: ["measured_evaluation", "runtime_measurement"],
  token_hard_gate: [
    "deterministic_observation",
    "measured_evaluation",
    "runtime_measurement",
  ],
  projected_cost_comparison: ["official_pricing"],
  realized_cost_hard_gate: ["runtime_measurement"],
  license: ["official_documentation", "source_code"],
  residency_provider_capability: [
    "official_documentation",
    "deterministic_observation",
  ],
  target_hardware_inventory: ["user_declared"],
  hardware_compatibility_estimate: [
    "tool_observation",
    "measured_evaluation",
    "runtime_measurement",
  ],
  hardware_performance_gate: ["measured_evaluation", "runtime_measurement"],
  budget_amount: ["user_declared"],
  availability_portability_structure: ["deterministic_observation"],
  repository_policy: ["deterministic_observation", "source_code"],
};

/**
 * Subjects whose evidence must describe one specific candidate. A measurement
 * of a different candidate is not weaker evidence, it is evidence about
 * something else.
 */
const CANDIDATE_SCOPED_SUBJECTS: ReadonlySet<EvidenceFloorSubject> = new Set([
  "workload_quality_hard_gate",
  "latency_throughput_hard_gate",
  "token_hard_gate",
  "realized_cost_hard_gate",
  "projected_cost_comparison",
  "hardware_compatibility_estimate",
  "hardware_performance_gate",
  "license",
]);

/**
 * What the evidence is being asked to speak about.
 *
 * Every field is optional in the TYPE but required in EFFECT for the subjects
 * that need it. A missing field is treated as insufficient evidence, never as
 * permission to skip a check: relaxing a gate because the caller forgot to say
 * which candidate it was asking about is exactly the failure this contract
 * exists to prevent.
 *
 * The parameter itself is mandatory on `assessEvidence` and
 * `evaluateConstraint` so that a Milestone 2 adapter cannot reach a `pass` by
 * simply omitting it.
 */
export interface EvidenceContext {
  /** The candidate whose result is being evaluated. */
  readonly candidateRef?: string | null;
  /** The workload that candidate serves. */
  readonly workloadRef?: string | null;
  /** Ids of hardware entries the user DECLARED, as opposed to detected ones. */
  readonly declaredTargetHardwareRefs?: readonly string[];
  /** The hardware this candidate actually deploys to. */
  readonly deploymentHardwareRef?: string | null;
  /**
   * True only when the citing candidate records BOTH a projected monthly cost
   * and the arithmetic behind it. Must be explicitly `true`.
   */
  readonly hasExplicitCostCalculation?: boolean;
  /**
   * True only when the workload's `expected_usage.basis` is declared or
   * stronger, and any assumption the calculation rests on is written down.
   * Must be explicitly `true`.
   */
  readonly hasDeclaredUsageInputs?: boolean;
}

/**
 * Subjects whose evidence must describe one specific workload. A quality or
 * latency figure is meaningless without knowing which workload produced it.
 */
const WORKLOAD_SCOPED_SUBJECTS: ReadonlySet<EvidenceFloorSubject> = new Set([
  "workload_quality_hard_gate",
  "latency_throughput_hard_gate",
  "token_hard_gate",
]);

/** Subjects that can only be settled against the candidate's real hardware. */
const HARDWARE_SCOPED_SUBJECTS: ReadonlySet<EvidenceFloorSubject> = new Set([
  "hardware_compatibility_estimate",
  "hardware_performance_gate",
]);

export interface AdmissionVerdict {
  readonly admitted: boolean;
  readonly reason: string;
}

const ADMITTED: AdmissionVerdict = { admitted: true, reason: "" };

/**
 * Decide whether one evidence record may speak to one constraint.
 *
 * This runs BEFORE the tier comparison. Inadmissible evidence is excluded
 * entirely rather than counted at a lower tier, because its tier is
 * irrelevant: it is not about the thing being gated.
 *
 * The constraint id is taken from `constraint.id` rather than from the
 * context, so a caller cannot accidentally assess evidence against one
 * constraint while claiming another.
 */
export function admitEvidence(
  record: EvidenceRecord,
  constraint: Constraint,
  context: EvidenceContext,
): AdmissionVerdict {
  // Defensive: a JavaScript caller can still omit the argument. An absent
  // context is an EMPTY context, which fails closed below, never a bypass.
  const supplied: EvidenceContext = context ?? {};

  const reject = (reason: string): AdmissionVerdict => ({
    admitted: false,
    reason,
  });

  // Defensive: a hand-built record may omit the field entirely. Absent
  // attribution is empty attribution, which is excluded below, not a bypass.
  const appliesToConstraints = record.applies_to?.constraint_refs ?? [];

  // Which CLAIM does this artifact support? Kind and subject cannot answer
  // that, so the record must say so explicitly. This is what stops evidence
  // gathered for one constraint from being reused for another in the same
  // domain.
  if (!appliesToConstraints.includes(constraint.id)) {
    return reject(
      appliesToConstraints.length === 0
        ? `this evidence is not attributed to any constraint, so it cannot support "${constraint.id}"`
        : `this evidence supports ${appliesToConstraints.map((entry) => `"${entry}"`).join(", ")}, not "${constraint.id}"`,
    );
  }

  const floorSubject = floorSubjectForConstraint(constraint);
  if (floorSubject === null) {
    return ADMITTED;
  }

  const admissibleKinds = ADMISSIBLE_EVIDENCE_KINDS[floorSubject];
  if (!admissibleKinds.includes(record.kind)) {
    return reject(
      `evidence of kind "${record.kind}" cannot establish ${floorSubject}; that subject requires ${admissibleKinds.join(" or ")}`,
    );
  }

  const appliesTo = record.applies_to ?? {
    candidate_ref: null,
    workload_ref: null,
    hardware_ref: null,
    constraint_refs: [],
  };

  // --- candidate scope: fails closed when the caller supplied no candidate --
  if (CANDIDATE_SCOPED_SUBJECTS.has(floorSubject)) {
    const candidateRef = supplied.candidateRef;
    if (candidateRef === undefined || candidateRef === null) {
      return reject(
        `${floorSubject} is candidate-specific, but no candidate context was supplied; missing context is insufficient evidence, not permission to skip the check`,
      );
    }
    if (appliesTo.candidate_ref === null) {
      return reject(
        `${floorSubject} is candidate-specific, but this evidence is not attributed to any candidate`,
      );
    }
    if (appliesTo.candidate_ref !== candidateRef) {
      return reject(
        `this evidence describes candidate "${appliesTo.candidate_ref}", not "${candidateRef}"`,
      );
    }
    if (
      record.kind === "measured_evaluation" &&
      record.value.candidate_ref !== candidateRef
    ) {
      return reject(
        `the evaluation was run against candidate "${record.value.candidate_ref}", not "${candidateRef}"`,
      );
    }
  }

  // --- workload scope: fails closed when the caller supplied no workload ---
  if (WORKLOAD_SCOPED_SUBJECTS.has(floorSubject)) {
    const workloadRef = supplied.workloadRef;
    if (workloadRef === undefined || workloadRef === null) {
      return reject(
        `${floorSubject} is workload-specific, but no workload context was supplied`,
      );
    }
    if (
      appliesTo.workload_ref !== null &&
      appliesTo.workload_ref !== workloadRef
    ) {
      return reject(
        `this evidence describes workload "${appliesTo.workload_ref}", not "${workloadRef}"`,
      );
    }
  } else if (
    appliesTo.workload_ref !== null &&
    supplied.workloadRef !== undefined &&
    supplied.workloadRef !== null &&
    appliesTo.workload_ref !== supplied.workloadRef
  ) {
    return reject(
      `this evidence describes workload "${appliesTo.workload_ref}", not "${supplied.workloadRef}"`,
    );
  }

  // --- hardware scope ------------------------------------------------------
  //
  // A benchmark is only evidence about the machine the candidate actually
  // deploys to. Being *a* declared machine somewhere in the contract is not
  // enough: the evidence must name the candidate's own deployment target.
  if (HARDWARE_SCOPED_SUBJECTS.has(floorSubject)) {
    const declared = supplied.declaredTargetHardwareRefs;
    if (declared === undefined) {
      return reject(
        `${floorSubject} needs the declared-target hardware context, and none was supplied`,
      );
    }
    const deployment = supplied.deploymentHardwareRef;
    if (deployment === undefined || deployment === null) {
      return reject(
        `${floorSubject} needs the candidate's deployment hardware, and none was supplied`,
      );
    }
    if (!declared.includes(deployment)) {
      return reject(
        `deployment hardware "${deployment}" is not a user-declared target, so nothing measured on it can settle a target gate`,
      );
    }

    if (record.kind === "tool_observation") {
      const { target_hardware_ref: target, detected_hardware_ref: detected } =
        record.value;
      if (target === null || detected === null) {
        return reject(
          "a hardware observation must name both the target it describes and the machine it inspected",
        );
      }
      if (target !== detected) {
        return reject(
          `declared target "${target}" and detected hardware "${detected}" differ, so this observation is not evidence about the target`,
        );
      }
      if (target !== deployment) {
        return reject(
          `this observation describes hardware "${target}", not the candidate's deployment target "${deployment}"`,
        );
      }
    } else if (appliesTo.hardware_ref === null) {
      return reject("a hardware measurement must name the hardware it ran on");
    } else if (appliesTo.hardware_ref !== deployment) {
      return reject(
        `this measurement ran on hardware "${appliesTo.hardware_ref}", not the candidate's deployment target "${deployment}"`,
      );
    }
  }

  // Belt and braces for any hardware-shaped record reaching a non-hardware
  // subject: a mismatched observation is never evidence about its target.
  if (isHardwareIdentityMismatch(record)) {
    return reject(
      "declared target hardware and detected hardware differ, so this observation is not evidence about the target",
    );
  }

  return ADMITTED;
}

/**
 * The floor actually in force for a subject: the contract's declaration when
 * present, otherwise the ratified baseline. A contract may raise a floor but
 * never lower it, and validation rejects an attempt to lower one rather than
 * silently repairing it.
 */
export function effectiveFloor(
  policy: EvidencePolicy,
  subject: EvidenceFloorSubject,
): EvidenceTier {
  const declared = policy.floors[subject];
  const ratified = RATIFIED_EVIDENCE_FLOORS[subject];
  if (declared === undefined) {
    return ratified;
  }
  return tierRank(declared) > tierRank(ratified) ? declared : ratified;
}

/**
 * Map a constraint to the ratified floor subject that governs it.
 *
 * Returns `null` for soft and informational constraints that doc 06 does not
 * assign a floor to. Those are directional comparison inputs, never gates, so
 * inventing a floor for them would be product design rather than
 * implementation. The one soft constraint doc 06 DOES name is cost, which maps
 * to `projected_cost_comparison`.
 */
export function floorSubjectForConstraint(
  constraint: Constraint,
): EvidenceFloorSubject | null {
  const hard = constraint.severity === "hard";

  switch (constraint.domain) {
    case "quality":
      return hard ? "workload_quality_hard_gate" : null;
    case "privacy":
      return hard ? "privacy_data_flow_hard_gate" : null;
    case "latency":
    case "throughput":
      return hard ? "latency_throughput_hard_gate" : null;
    case "tokens":
      return hard ? "token_hard_gate" : null;
    case "cost":
      return hard ? "realized_cost_hard_gate" : "projected_cost_comparison";
    case "licensing":
      return "license";
    case "residency":
    case "provider_policy":
      return "residency_provider_capability";
    case "hardware":
      return hard
        ? "hardware_performance_gate"
        : "hardware_compatibility_estimate";
    case "availability":
      return hard ? "availability_portability_structure" : null;
    case "repository_policy":
      return hard ? "repository_policy" : null;
    case "functionality":
    case "operability":
      return null;
    default: {
      const exhaustive: never = constraint.domain;
      return exhaustive;
    }
  }
}

/**
 * A hardware-fit tool observation can only speak for the target it actually
 * inspected. When the declared target and the detected machine differ, the
 * observation is not evidence about the target at all.
 *
 * Ratified in doc 06 section 8.
 */
export function isHardwareIdentityMismatch(record: EvidenceRecord): boolean {
  if (record.kind !== "tool_observation") {
    return false;
  }
  const { target_hardware_ref, detected_hardware_ref } = record.value;
  if (target_hardware_ref === null || detected_hardware_ref === null) {
    return false;
  }
  return target_hardware_ref !== detected_hardware_ref;
}

export interface EvidenceAssessment {
  /** The strongest tier among ADMISSIBLE evidence, or `T0` when there is none. */
  readonly bestTier: EvidenceTier;
  /** The floor in force, or `null` when the subject has no ratified floor. */
  readonly floor: EvidenceTier | null;
  /** The governing floor subject, or `null` for comparison-only constraints. */
  readonly floorSubject: EvidenceFloorSubject | null;
  /** True when admissible evidence reaches the floor. */
  readonly meetsFloor: boolean;
  /** Evidence ids excluded as inadmissible, with the reason. */
  readonly excluded: readonly {
    readonly id: string;
    readonly reason: string;
  }[];
  /** Why the floor was not met, or `null` when it was. */
  readonly shortfall: string | null;
}

/**
 * Assess the evidence cited for one constraint.
 *
 * `context` is REQUIRED. Passing `{}` is legal but is not a way to bypass a
 * check: every subject that needs a context field treats its absence as
 * insufficient evidence.
 *
 * Evidence is first filtered for ADMISSIBILITY: the wrong kind of evidence, or
 * evidence about a different candidate, workload, or machine, is excluded
 * entirely rather than counted at its tier. Only what survives contributes to
 * `bestTier`, which is then compared against the floor.
 */
export function assessEvidence(
  constraint: Constraint,
  citedEvidence: readonly EvidenceRecord[],
  policy: EvidencePolicy,
  context: EvidenceContext,
): EvidenceAssessment {
  const supplied: EvidenceContext = context ?? {};
  const floorSubject = floorSubjectForConstraint(constraint);
  const floor =
    floorSubject === null ? null : effectiveFloor(policy, floorSubject);

  const excluded: { id: string; reason: string }[] = [];
  let bestTier: EvidenceTier = "T0";

  for (const record of citedEvidence) {
    const verdict = admitEvidence(record, constraint, supplied);
    if (!verdict.admitted) {
      excluded.push({ id: record.id, reason: verdict.reason });
      continue;
    }
    const tier = tierForEvidence(record);
    if (tierRank(tier) > tierRank(bestTier)) {
      bestTier = tier;
    }
  }

  let meetsFloor = floor === null ? true : tierMeets(bestTier, floor);
  let shortfall: string | null = meetsFloor
    ? null
    : `admissible evidence reaches only ${bestTier} but ${floorSubject ?? "this subject"} requires ${floor ?? "none"}`;

  // Official pricing alone is a price list, not a comparison. Decision 06
  // requires official pricing PLUS explicit arithmetic PLUS declared usage
  // assumptions. Both flags must be explicitly true; `undefined` fails closed,
  // because a caller that never computed them has not established anything.
  if (meetsFloor && floorSubject === "projected_cost_comparison") {
    const missing: string[] = [];
    if (supplied.hasExplicitCostCalculation !== true) {
      missing.push(
        "a recorded projected monthly cost and the arithmetic behind it",
      );
    }
    if (supplied.hasDeclaredUsageInputs !== true) {
      missing.push(
        "declared-or-stronger workload usage inputs with their assumptions written down",
      );
    }
    if (missing.length > 0) {
      meetsFloor = false;
      shortfall = `a projected cost comparison needs official pricing plus ${missing.join(" and ")}`;
    }
  }

  return { bestTier, floor, floorSubject, meetsFloor, excluded, shortfall };
}

export interface ConstraintEvaluation {
  readonly outcome: Outcome;
  readonly assessment: EvidenceAssessment;
  /** Present when the asserted status was downgraded. */
  readonly downgradedFrom?: Outcome;
  readonly explanation: string;
}

/**
 * Determine the trustworthy outcome for one constraint.
 *
 * The critical rule, ratified in doc 06 section 6: evidence below the
 * applicable floor yields `unknown` and can never satisfy a hard constraint.
 * An asserted `pass` that is not backed by sufficient evidence is downgraded,
 * never accepted.
 *
 * `fail` is preserved regardless of tier. Weak evidence is a reason to doubt a
 * success claim, not a reason to ignore a reported problem, and a `fail`
 * blocks approval either way.
 */
export function evaluateConstraint(
  constraint: Constraint,
  assertedStatus: Outcome,
  citedEvidence: readonly EvidenceRecord[],
  policy: EvidencePolicy,
  context: EvidenceContext,
): ConstraintEvaluation {
  const assessment = assessEvidence(
    constraint,
    citedEvidence,
    policy,
    context ?? {},
  );

  if (constraint.severity === "informational") {
    return {
      outcome: "not_applicable",
      assessment,
      explanation:
        "informational constraints are recorded but not scored, so they are never a gate",
    };
  }

  if (assertedStatus === "not_applicable" || assertedStatus === "fail") {
    return {
      outcome: assertedStatus,
      assessment,
      explanation:
        assertedStatus === "fail"
          ? "a reported failure is preserved regardless of evidence tier"
          : "the constraint does not apply to this subject",
    };
  }

  if (assertedStatus === "unknown") {
    return {
      outcome: "unknown",
      assessment,
      explanation: "the recorded result is already unknown",
    };
  }

  if (!assessment.meetsFloor) {
    const excludedNote =
      assessment.excluded.length === 0
        ? ""
        : ` (${assessment.excluded.length} record(s) excluded as inadmissible: ${assessment.excluded
            .map((entry) => `${entry.id} — ${entry.reason}`)
            .join("; ")})`;
    return {
      outcome: "unknown",
      assessment,
      downgradedFrom: "pass",
      explanation:
        `${assessment.shortfall ?? "the evidence floor was not met"}${excludedNote}; ` +
        "insufficient evidence yields unknown and never satisfies a hard constraint",
    };
  }

  return {
    outcome: "pass",
    assessment,
    explanation: `admissible evidence reaches ${assessment.bestTier}, meeting the required floor`,
  };
}
