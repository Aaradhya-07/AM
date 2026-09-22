import type {
  Candidate,
  Constraint,
  ConstraintResult,
  EvidenceFloorSubject,
  EvidenceKind,
  EvidenceRecord,
  EvidenceTier,
  Outcome,
  ProjectContract,
} from "@anvilmark/project-contract";
import {
  ADMISSIBLE_EVIDENCE_KINDS,
  compareCodeUnits,
  effectiveFloor,
  floorSubjectForConstraint,
  tierForEvidence,
  tierMeets,
} from "@anvilmark/project-contract";

import type { AdapterIdentity, AdapterStanding } from "../envelope.js";
import type {
  FreshConstraintEvaluation,
  FreshnessOptions,
} from "./freshness.js";
import { evaluateConstraintFresh, partitionByFreshness } from "./freshness.js";

export const GAP_CODES = [
  /** Nothing at all has been recorded for this claim. */
  "missing_evidence",
  /** Evidence exists but does not reach the required tier. */
  "insufficient_tier",
  /** Evidence exists but cannot speak to this subject. */
  "inadmissible_evidence",
  /** Evidence exists but names no constraint, or the wrong one. */
  "attribution_missing",
  /** Evidence exists but is stale, expired, or superseded. */
  "stale_evidence",
  /** A licence fact is missing for a selected or candidate model. */
  "missing_licence",
  /** No benchmark or fit observation exists for the declared target machine. */
  "missing_hardware_benchmark",
  /** No official pricing is attributed to a candidate the project must cost. */
  "missing_pricing",
  /** A managed candidate does not say which region serves it. */
  "missing_provider_region",
  /** An optional tool that would close a gap is not installed. */
  "adapter_unavailable",
  /**
   * A workload's monthly call volume is recorded as unknown (draft.4,
   * amendment 6), so no projected cost or token comparison can settle.
   */
  "missing_usage",
] as const;

export type GapCode = (typeof GAP_CODES)[number];

export interface EvidenceGapEntry {
  readonly code: GapCode;
  readonly constraint_ref: string | null;
  readonly subject: string;
  readonly required_floor: EvidenceTier | null;
  readonly admissible_kinds: readonly EvidenceKind[];
  readonly resolved_outcome: Outcome;
  readonly reason: string;
}

export interface CandidateGapGroup {
  readonly candidate_ref: string;
  readonly gaps: readonly EvidenceGapEntry[];
}

export interface WorkloadGapGroup {
  readonly workload_ref: string;
  readonly gaps: readonly EvidenceGapEntry[];
  readonly candidates: readonly CandidateGapGroup[];
}

export interface AdapterGapEntry {
  readonly adapter_id: string;
  readonly standing: AdapterStanding;
  readonly reason: string;
}

export interface ProjectGapReport {
  readonly project_id: string;
  readonly contract_revision: number;
  readonly as_of: string;
  readonly workloads: readonly WorkloadGapGroup[];
  readonly project: readonly EvidenceGapEntry[];
  readonly adapters: readonly AdapterGapEntry[];
}

function sortGaps(
  gaps: readonly EvidenceGapEntry[],
): readonly EvidenceGapEntry[] {
  return [...gaps].sort(
    (left, right) =>
      compareCodeUnits(left.constraint_ref ?? "", right.constraint_ref ?? "") ||
      compareCodeUnits(left.subject, right.subject) ||
      compareCodeUnits(left.code, right.code),
  );
}

/** The workload a constraint speaks about, when its subject names one. */
function workloadOfConstraint(constraint: Constraint): string | null {
  const [head, second] = constraint.subject.split(".");
  return head === "workload" && second !== undefined ? second : null;
}

function floorFor(
  contract: ProjectContract,
  constraint: Constraint,
): { floor: EvidenceTier | null; kinds: readonly EvidenceKind[] } {
  const subject = floorSubjectForConstraint(constraint);
  if (subject === null) {
    return { floor: null, kinds: [] };
  }
  return {
    floor: effectiveFloor(contract.evidence_policy, subject),
    kinds: ADMISSIBLE_EVIDENCE_KINDS[subject],
  };
}

/**
 * Is there a usable fact of a given kind for this subject?
 *
 * Existence is not enough. A record only closes a category when it is the
 * right KIND, attributed to the right candidate or hardware, at or above the
 * required TIER, and CURRENT. Stale, expired, superseded, irrelevant, or
 * wrong-kind evidence leaves the gap open — reported as `stale_evidence` when
 * something relevant exists but is not current, and as the ordinary missing
 * category when nothing relevant exists at all.
 */
function relevantFact(
  contract: ProjectContract,
  options: {
    readonly kinds: readonly EvidenceKind[];
    readonly floorSubject: EvidenceFloorSubject;
    readonly matches: (record: EvidenceRecord) => boolean;
    readonly freshness: FreshnessOptions;
  },
): {
  readonly state: "usable" | "not_current" | "absent";
  readonly detail: string;
} {
  const floor = effectiveFloor(contract.evidence_policy, options.floorSubject);

  const relevant = contract.evidence_refs.filter(
    (record) =>
      options.kinds.includes(record.kind) &&
      tierMeets(tierForEvidence(record), floor) &&
      options.matches(record),
  );

  if (relevant.length === 0) {
    return { state: "absent", detail: "" };
  }

  const partition = partitionByFreshness(relevant, contract.evidence_refs, {
    ...options.freshness,
    contract,
  });
  if (partition.current.length > 0) {
    return { state: "usable", detail: "" };
  }

  const first = partition.excluded[0];
  return {
    state: "not_current",
    detail:
      first === undefined
        ? "the only relevant record is not current"
        : `"${first.record.id}" is ${first.verdict.state}: ${first.verdict.reason}`,
  };
}

/** One candidate's recorded result for one constraint, evaluated honestly. */
export interface CandidateConstraintEvaluation {
  /** The result the candidate records, or undefined when it records none. */
  readonly result: ConstraintResult | undefined;
  /** The cited records that exist in the contract. */
  readonly cited: readonly EvidenceRecord[];
  /** Null when no result is recorded, which resolves to `unknown`. */
  readonly evaluation: FreshConstraintEvaluation | null;
}

/**
 * Evaluate a candidate's recorded result for one constraint with the context
 * the contract implies: the candidate, its workload, the declared targets, its
 * deployment hardware and the cost and usage inputs it records.
 *
 * Exported so that a comparison view and the gap report cannot disagree about
 * a constraint's standing: both call this one function.
 */
export function evaluateCandidateConstraint(
  contract: ProjectContract,
  constraint: Constraint,
  candidate: Candidate,
  freshness: FreshnessOptions,
): CandidateConstraintEvaluation {
  const result = candidate.constraint_results.find(
    (entry) => entry.constraint_ref === constraint.id,
  );
  if (result === undefined) {
    return { result, cited: [], evaluation: null };
  }

  const evidenceById = new Map(
    contract.evidence_refs.map((entry) => [entry.id, entry]),
  );
  const cited = result.evidence_refs
    .map((ref) => evidenceById.get(ref))
    .filter((entry): entry is EvidenceRecord => entry !== undefined);

  const servingWorkload =
    candidate.workload_ref === null
      ? undefined
      : contract.workloads.find((entry) => entry.id === candidate.workload_ref);
  const usageBasis = servingWorkload?.expected_usage.basis;

  const evaluation = evaluateConstraintFresh(
    constraint,
    result.status,
    cited,
    contract.evidence_policy,
    {
      projectContract: contract,
      candidateRef: candidate.id,
      workloadRef: candidate.workload_ref,
      declaredTargetHardwareRefs: contract.resources.hardware
        .filter((entry) => entry.evidence_kind === "user_declared")
        .map((entry) => entry.id),
      deploymentHardwareRef:
        candidate.deployment.mode === "local"
          ? candidate.deployment.hardware_ref
          : null,
      resolveHardware: (id: string) =>
        contract.resources.hardware.find((entry) => entry.id === id),
      hasExplicitCostCalculation:
        candidate.estimates.monthly_effective_cost_usd !== null &&
        candidate.estimates.basis !== null,
      hasDeclaredUsageInputs:
        (usageBasis === "user_assumption" || usageBasis === "measured") &&
        (usageBasis === "measured" ||
          candidate.estimates.assumptions.length > 0),
    },
    freshness,
    contract.evidence_refs,
  );

  return { result, cited, evaluation };
}

/**
 * Evaluate one constraint against one candidate and describe what is missing.
 *
 * Returns `null` when the claim is genuinely settled. Everything else is a
 * gap with a reason, because the only two honest answers are "settled" and
 * "here is precisely what is still needed".
 */
function gapFor(
  contract: ProjectContract,
  constraint: Constraint,
  candidate: Candidate,
  freshness: FreshnessOptions,
): EvidenceGapEntry | null {
  const { floor, kinds } = floorFor(contract, constraint);
  const { result, cited, evaluation } = evaluateCandidateConstraint(
    contract,
    constraint,
    candidate,
    freshness,
  );

  if (result === undefined || evaluation === null) {
    return {
      code: "missing_evidence",
      constraint_ref: constraint.id,
      subject: constraint.subject,
      required_floor: floor,
      admissible_kinds: kinds,
      resolved_outcome: "unknown",
      reason: `candidate "${candidate.id}" records no result for "${constraint.id}"`,
    };
  }

  if (
    evaluation.outcome === "pass" ||
    evaluation.outcome === "not_applicable"
  ) {
    return null;
  }

  const code: GapCode =
    evaluation.staleExcluded.length > 0
      ? "stale_evidence"
      : cited.length === 0
        ? "missing_evidence"
        : evaluation.assessment.excluded.some((entry) =>
              entry.reason.includes("not attributed to any constraint"),
            )
          ? "attribution_missing"
          : evaluation.assessment.excluded.length > 0
            ? "inadmissible_evidence"
            : "insufficient_tier";

  return {
    code,
    constraint_ref: constraint.id,
    subject: constraint.subject,
    required_floor: floor,
    admissible_kinds: kinds,
    resolved_outcome: evaluation.outcome,
    reason: evaluation.explanation,
  };
}

/**
 * Produce the project's evidence-gap report.
 *
 * The report is deterministic: the same contract and the same `as_of` produce
 * byte-identical output, with every collection sorted by code unit rather than
 * by insertion or locale. It is meant to be committed and diffed.
 */
export function buildGapReport(
  contract: ProjectContract,
  options: {
    readonly freshness: FreshnessOptions;
    readonly adapters?: readonly {
      readonly identity: AdapterIdentity;
      readonly standing: AdapterStanding;
      readonly reason: string;
    }[];
  },
): ProjectGapReport {
  const evidenceById = new Map(
    contract.evidence_refs.map((entry) => [entry.id, entry]),
  );

  const gated = contract.constraints.filter(
    (constraint) => floorSubjectForConstraint(constraint) !== null,
  );

  const declaredTargets = new Set(
    contract.resources.hardware
      .filter((entry) => entry.evidence_kind === "user_declared")
      .map((entry) => entry.id),
  );
  const hasCostConstraint = contract.constraints.some(
    (constraint) => constraint.domain === "cost",
  );

  const workloadGroups: WorkloadGapGroup[] = [];
  const projectGaps: EvidenceGapEntry[] = [];

  for (const workload of [...contract.workloads].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  )) {
    const workloadConstraints = gated.filter(
      (constraint) => workloadOfConstraint(constraint) === workload.id,
    );
    const candidates = contract.candidates
      .filter((candidate) => candidate.workload_ref === workload.id)
      .sort((left, right) => compareCodeUnits(left.id, right.id));

    const groupGaps: EvidenceGapEntry[] = [];

    // A workload with no candidate at all cannot settle anything.
    if (candidates.length === 0 && workloadConstraints.length > 0) {
      for (const constraint of workloadConstraints) {
        const { floor, kinds } = floorFor(contract, constraint);
        groupGaps.push({
          code: "missing_evidence",
          constraint_ref: constraint.id,
          subject: constraint.subject,
          required_floor: floor,
          admissible_kinds: kinds,
          resolved_outcome: "unknown",
          reason: `no candidate serves workload "${workload.id}", so nothing can satisfy "${constraint.id}"`,
        });
      }
    }

    // Unknown usage is a gap of its own: it blocks every projected cost or
    // token conclusion for the workload's candidates, whatever else is known.
    if (workload.expected_usage.calls_per_month === null) {
      groupGaps.push({
        code: "missing_usage",
        constraint_ref: null,
        subject: `workload.${workload.id}.expected_usage.calls_per_month`,
        // Doc 06 section 6: a projected cost comparison rests on T1 usage
        // assumptions declared by the user. No floor subject names usage alone.
        required_floor: "T1",
        admissible_kinds: ["user_declared", "runtime_measurement"],
        resolved_outcome: "unknown",
        reason: `expected monthly calls for workload "${workload.id}" are unknown, so projected cost and token comparisons for its candidates stay unknown until a volume is declared or measured`,
      });
    }

    // Every quality gate whose evaluation has produced no evidence.
    for (const gate of workload.quality_gates) {
      if (!evidenceById.has(gate.evaluation_ref)) {
        groupGaps.push({
          code: "missing_evidence",
          constraint_ref: null,
          subject: `workload.${workload.id}.metric.${gate.metric}`,
          required_floor: effectiveFloor(
            contract.evidence_policy,
            "workload_quality_hard_gate",
          ),
          admissible_kinds:
            ADMISSIBLE_EVIDENCE_KINDS.workload_quality_hard_gate,
          resolved_outcome: "unknown",
          reason: `evaluation "${gate.evaluation_ref}" has produced no evidence record`,
        });
      }
    }

    const candidateGroups: CandidateGapGroup[] = [];
    for (const candidate of candidates) {
      const gaps: EvidenceGapEntry[] = [];

      for (const constraint of workloadConstraints) {
        const gap = gapFor(contract, constraint, candidate, options.freshness);
        if (gap !== null) {
          gaps.push(gap);
        }
      }

      // Licence and region are independent facts, not consequences of a gate.
      if (candidate.model !== null) {
        const licenceRef = candidate.model.license_evidence_ref;
        // The EXACT referenced record has to exist, be a licence-bearing kind,
        // reach the tier, and be current. A dangling or stale reference is not
        // licence evidence.
        const fact =
          licenceRef === null
            ? ({ state: "absent", detail: "" } as const)
            : relevantFact(contract, {
                kinds: ADMISSIBLE_EVIDENCE_KINDS.license,
                floorSubject: "license",
                freshness: options.freshness,
                matches: (record) => record.id === licenceRef,
              });
        if (fact.state !== "usable") {
          gaps.push({
            code:
              fact.state === "not_current"
                ? "stale_evidence"
                : "missing_licence",
            constraint_ref: null,
            subject: `${candidate.id}.licence`,
            required_floor: effectiveFloor(contract.evidence_policy, "license"),
            admissible_kinds: ADMISSIBLE_EVIDENCE_KINDS.license,
            resolved_outcome: "unknown",
            reason:
              fact.state === "not_current"
                ? `licence evidence for candidate "${candidate.id}" is no longer current: ${fact.detail}`
                : licenceRef === null
                  ? `candidate "${candidate.id}" cites no licence evidence; missing licence data is unknown, never permissive`
                  : `licence reference "${licenceRef}" on candidate "${candidate.id}" does not resolve to usable licence evidence`,
          });
        }
      }
      // A declared target with nothing measured or estimated on it.
      const deploymentHardware =
        candidate.deployment.mode === "local"
          ? candidate.deployment.hardware_ref
          : null;
      if (
        deploymentHardware !== null &&
        declaredTargets.has(deploymentHardware)
      ) {
        const fact = relevantFact(contract, {
          kinds: ADMISSIBLE_EVIDENCE_KINDS.hardware_compatibility_estimate,
          floorSubject: "hardware_compatibility_estimate",
          freshness: options.freshness,
          matches: (record) =>
            record.applies_to.hardware_ref === deploymentHardware &&
            record.applies_to.candidate_ref === candidate.id,
        });
        if (fact.state !== "usable") {
          gaps.push({
            code:
              fact.state === "not_current"
                ? "stale_evidence"
                : "missing_hardware_benchmark",
            constraint_ref: null,
            subject: `${candidate.id}.hardware_fit`,
            required_floor: effectiveFloor(
              contract.evidence_policy,
              "hardware_compatibility_estimate",
            ),
            admissible_kinds:
              ADMISSIBLE_EVIDENCE_KINDS.hardware_compatibility_estimate,
            resolved_outcome: "unknown",
            reason:
              fact.state === "not_current"
                ? `the hardware observation for candidate "${candidate.id}" is no longer current: ${fact.detail}`
                : `nothing usable has been observed or measured on declared target "${deploymentHardware}" for candidate "${candidate.id}"`,
          });
        }
      }

      // A project that constrains cost needs pricing for each candidate.
      if (hasCostConstraint) {
        const fact = relevantFact(contract, {
          kinds: ADMISSIBLE_EVIDENCE_KINDS.projected_cost_comparison,
          floorSubject: "projected_cost_comparison",
          freshness: options.freshness,
          matches: (record) => record.applies_to.candidate_ref === candidate.id,
        });
        if (fact.state !== "usable") {
          gaps.push({
            code:
              fact.state === "not_current"
                ? "stale_evidence"
                : "missing_pricing",
            constraint_ref: null,
            subject: `${candidate.id}.pricing`,
            required_floor: effectiveFloor(
              contract.evidence_policy,
              "projected_cost_comparison",
            ),
            admissible_kinds:
              ADMISSIBLE_EVIDENCE_KINDS.projected_cost_comparison,
            resolved_outcome: "unknown",
            reason:
              fact.state === "not_current"
                ? `pricing for candidate "${candidate.id}" is no longer current: ${fact.detail}`
                : `no current official pricing is attributed to candidate "${candidate.id}", so its cost cannot be projected`,
          });
        }
      }

      // Region is an independent fact, not a consequence of any gate.
      if (
        candidate.deployment.mode === "managed_api" &&
        candidate.deployment.region === null
      ) {
        gaps.push({
          code: "missing_provider_region",
          constraint_ref: null,
          subject: `${candidate.id}.region`,
          required_floor: effectiveFloor(
            contract.evidence_policy,
            "residency_provider_capability",
          ),
          admissible_kinds:
            ADMISSIBLE_EVIDENCE_KINDS.residency_provider_capability,
          resolved_outcome: "unknown",
          reason: `candidate "${candidate.id}" is served by a managed API but declares no region`,
        });
      }

      candidateGroups.push({
        candidate_ref: candidate.id,
        gaps: sortGaps(gaps),
      });
    }

    workloadGroups.push({
      workload_ref: workload.id,
      gaps: sortGaps(groupGaps),
      candidates: candidateGroups,
    });
  }

  // Constraints whose subject names no workload are project-level.
  for (const constraint of gated) {
    if (workloadOfConstraint(constraint) !== null) {
      continue;
    }
    const settled = contract.candidates.some((candidate) => {
      const gap = gapFor(contract, constraint, candidate, options.freshness);
      return gap === null;
    });
    if (settled) {
      continue;
    }
    const { floor, kinds } = floorFor(contract, constraint);
    projectGaps.push({
      code: "missing_evidence",
      constraint_ref: constraint.id,
      subject: constraint.subject,
      required_floor: floor,
      admissible_kinds: kinds,
      resolved_outcome: "unknown",
      reason: `no candidate satisfies project-level constraint "${constraint.id}"`,
    });
  }

  const adapters = [...(options.adapters ?? [])]
    .filter((entry) => entry.standing !== "available")
    .map((entry) => ({
      adapter_id: entry.identity.id,
      standing: entry.standing,
      reason: entry.reason,
    }))
    .sort((left, right) => compareCodeUnits(left.adapter_id, right.adapter_id));

  return {
    project_id: contract.project.id,
    contract_revision: contract.project.contract_revision,
    as_of: options.freshness.asOf,
    workloads: workloadGroups,
    project: sortGaps(projectGaps),
    adapters,
  };
}
