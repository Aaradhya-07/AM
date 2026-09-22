import type {
  AdapterIdentity,
  AdapterStanding,
  EvidenceGapEntry,
  Freshness,
  ProjectGapReport,
} from "@anvilmark/adapters";
import {
  buildGapReport,
  evaluateCandidateConstraint,
  freshnessOf,
} from "@anvilmark/adapters";
import type {
  Candidate,
  Constraint,
  EvidenceTier,
  Outcome,
  ProjectContract,
} from "@anvilmark/project-contract";
import { compareCodeUnits, tierForEvidence } from "@anvilmark/project-contract";

export interface EvidenceStanding {
  readonly id: string;
  readonly kind: string;
  readonly tier: EvidenceTier;
  readonly observed_at: string;
  readonly freshness: Freshness;
  readonly freshness_reason: string;
}

export interface ConstraintStanding {
  readonly constraint_ref: string;
  readonly severity: Constraint["severity"];
  readonly domain: Constraint["domain"];
  readonly subject: string;
  readonly direction: string | null;
  /** What the candidate records, or null when nothing is recorded. */
  readonly recorded_status: Outcome | null;
  /** The standing after evidence floors, attribution and freshness. */
  readonly outcome: Outcome;
  readonly explanation: string;
  readonly evidence: readonly EvidenceStanding[];
}

export interface CandidateComparison {
  readonly candidate_ref: string;
  readonly status: Candidate["status"];
  readonly workload_ref: string | null;
  readonly component_kind: Candidate["component_kind"];
  readonly deployment: string;
  readonly model: string | null;
  readonly satisfied: readonly ConstraintStanding[];
  readonly failed: readonly ConstraintStanding[];
  readonly unknown: readonly ConstraintStanding[];
  readonly not_scored: readonly ConstraintStanding[];
  /**
   * Every evidence record about this candidate, cited or not, with its tier and
   * freshness. An agent inference appears here as T0 and cannot satisfy anything.
   */
  readonly evidence_on_record: readonly (EvidenceStanding & {
    readonly cited_for: readonly string[];
  })[];
  /** Candidate estimates' assumptions and basis, and the workload's usage basis. */
  readonly assumptions: readonly string[];
  /** Why this candidate is incompatible, rejected or failing, as recorded. */
  readonly incompatibility_reasons: readonly string[];
  /** Evidence still required before the candidate can be viable or approved. */
  readonly evidence_required: readonly EvidenceGapEntry[];
}

export interface WorkloadComparison {
  readonly workload_ref: string;
  readonly name: string;
  readonly usage: string;
  /** Null when the output data classification is not declared (unknown). */
  readonly output_classification: string | null;
  readonly candidates: readonly CandidateComparison[];
  readonly workload_gaps: readonly EvidenceGapEntry[];
}

export interface Comparison {
  readonly as_of: string;
  readonly priority_order: readonly string[];
  readonly workloads: readonly WorkloadComparison[];
  readonly project_candidates: readonly CandidateComparison[];
  readonly project_gaps: readonly EvidenceGapEntry[];
  readonly adapter_gaps: ProjectGapReport["adapters"];
  readonly unresolved_questions: readonly string[];
}

/** A constraint speaks about a workload when its subject names that workload. */
export function constraintWorkload(constraint: Constraint): string | null {
  const [head, second] = constraint.subject.split(".");
  return head === "workload" && second !== undefined ? second : null;
}

/** Constraints relevant to a candidate: its workload's, and every project-level one. */
export function constraintsFor(
  contract: ProjectContract,
  candidate: Candidate,
): readonly Constraint[] {
  return contract.constraints.filter((constraint) => {
    const workload = constraintWorkload(constraint);
    return workload === null || workload === candidate.workload_ref;
  });
}

function describeDeployment(candidate: Candidate): string {
  const deployment = candidate.deployment;
  const unknown = (value: string | null) => value ?? "unknown";
  switch (deployment.mode) {
    case "local":
      return `local (runtime: ${unknown(deployment.runtime)}, hardware: ${unknown(deployment.hardware_ref)})`;
    case "managed_api":
      return `managed API (provider: ${unknown(deployment.provider)}, region: ${unknown(deployment.region)})`;
    case "self_hosted":
      return `self-hosted (provider: ${unknown(deployment.provider)}, region: ${unknown(deployment.region)}, runtime: ${unknown(deployment.runtime)})`;
  }
}

export function standingFor(
  contract: ProjectContract,
  constraint: Constraint,
  candidate: Candidate,
  asOf: string,
): ConstraintStanding {
  const { result, cited, evaluation } = evaluateCandidateConstraint(
    contract,
    constraint,
    candidate,
    { asOf, contract },
  );
  const evidence = cited.map((record) => {
    const verdict = freshnessOf(record, contract.evidence_refs, {
      asOf,
      contract,
    });
    return {
      id: record.id,
      kind: record.kind,
      tier: tierForEvidence(record),
      observed_at: record.observed_at,
      freshness: verdict.state,
      freshness_reason: verdict.reason,
    };
  });
  const base = {
    constraint_ref: constraint.id,
    severity: constraint.severity,
    domain: constraint.domain,
    subject: constraint.subject,
    direction: constraint.severity === "soft" ? constraint.direction : null,
    evidence,
  };
  if (constraint.severity === "informational") {
    return {
      ...base,
      recorded_status: result?.status ?? null,
      outcome: "not_applicable",
      explanation: "informational: recorded, never scored",
    };
  }
  if (result === undefined || evaluation === null) {
    return {
      ...base,
      recorded_status: null,
      outcome: "unknown",
      explanation: "no result is recorded for this candidate, so it is unknown",
    };
  }
  const recordedNote =
    result.explanation === null ? "" : ` Recorded: ${result.explanation}`;
  return {
    ...base,
    recorded_status: result.status,
    outcome: evaluation.outcome,
    explanation: `${evaluation.explanation}.${recordedNote}`,
  };
}

export function compareCandidate(
  contract: ProjectContract,
  candidate: Candidate,
  report: ProjectGapReport,
  asOf: string,
): CandidateComparison {
  const standings = constraintsFor(contract, candidate).map((constraint) =>
    standingFor(contract, constraint, candidate, asOf),
  );
  const by = (outcome: Outcome) =>
    standings.filter((entry) => entry.outcome === outcome);

  const workload = contract.workloads.find(
    (entry) => entry.id === candidate.workload_ref,
  );
  const assumptions = [
    ...candidate.estimates.assumptions,
    ...(candidate.estimates.basis === null
      ? []
      : [`estimate basis: ${candidate.estimates.basis}`]),
    ...(workload === undefined
      ? []
      : [
          workload.expected_usage.calls_per_month === null
            ? "workload monthly usage is unknown, so cost and token comparisons cannot settle"
            : `workload usage is ${workload.expected_usage.basis.replace(/_/g, " ")}: ${workload.expected_usage.calls_per_month} calls/month`,
        ]),
  ];

  const incompatibility = [
    ...(["incompatible", "rejected", "unavailable"].includes(candidate.status)
      ? [`status recorded as ${candidate.status}`]
      : []),
    ...by("fail").map(
      (entry) => `${entry.constraint_ref} fails: ${entry.explanation}`,
    ),
  ];

  const group = report.workloads
    .flatMap((entry) => entry.candidates)
    .find((entry) => entry.candidate_ref === candidate.id);
  const projectLevel = report.project;

  const evidenceOnRecord = contract.evidence_refs
    .filter(
      (record) =>
        record.applies_to.candidate_ref === candidate.id ||
        record.subject === candidate.id ||
        record.subject.startsWith(`${candidate.id}.`),
    )
    .map((record) => {
      const verdict = freshnessOf(record, contract.evidence_refs, {
        asOf,
        contract,
      });
      return {
        id: record.id,
        kind: record.kind,
        tier: tierForEvidence(record),
        observed_at: record.observed_at,
        freshness: verdict.state,
        freshness_reason: verdict.reason,
        cited_for: candidate.constraint_results
          .filter((result) => result.evidence_refs.includes(record.id))
          .map((result) => result.constraint_ref),
      };
    });

  const model =
    candidate.model === null
      ? null
      : `${candidate.model.family}${candidate.model.version === null ? " (no version)" : `@${candidate.model.version}`} [${candidate.model.version_mutability}]${candidate.model.quantization === null ? "" : `, quantization ${candidate.model.quantization}`}`;

  return {
    candidate_ref: candidate.id,
    status: candidate.status,
    workload_ref: candidate.workload_ref,
    component_kind: candidate.component_kind,
    deployment: describeDeployment(candidate),
    model,
    satisfied: by("pass"),
    failed: by("fail"),
    unknown: by("unknown"),
    not_scored: by("not_applicable"),
    evidence_on_record: evidenceOnRecord,
    assumptions,
    incompatibility_reasons: incompatibility,
    evidence_required: [
      ...(group?.gaps ?? []),
      ...(candidate.workload_ref === null ? projectLevel : []),
    ],
  };
}

/**
 * Compare every candidate, per workload, without an overall score.
 *
 * Each dimension is kept separate: satisfied, failed and unknown constraints,
 * the evidence behind each with its tier and freshness, the assumptions the
 * candidate rests on, and what evidence is still missing. Soft constraints are
 * shown with their direction; the project's priority order is shown for
 * tie-breaking. Nothing is summed, weighted or ranked.
 */
export function compareAlternatives(
  contract: ProjectContract,
  options: {
    readonly asOf: string;
    readonly adapters?: readonly {
      readonly identity: AdapterIdentity;
      readonly standing: AdapterStanding;
      readonly reason: string;
    }[];
  },
): Comparison {
  const report = buildGapReport(contract, {
    freshness: { asOf: options.asOf },
    ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
  });
  const sorted = [...contract.candidates].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
  const workloads = contract.workloads.map((workload) => {
    const group = report.workloads.find(
      (entry) => entry.workload_ref === workload.id,
    );
    return {
      workload_ref: workload.id,
      name: workload.name,
      usage:
        workload.expected_usage.calls_per_month === null
          ? "monthly usage unknown"
          : `${workload.expected_usage.calls_per_month} calls/month (${workload.expected_usage.basis})`,
      output_classification: workload.output_classification,
      candidates: sorted
        .filter((candidate) => candidate.workload_ref === workload.id)
        .map((candidate) =>
          compareCandidate(contract, candidate, report, options.asOf),
        ),
      workload_gaps: group?.gaps ?? [],
    };
  });
  return {
    as_of: options.asOf,
    priority_order: contract.project.priority_order,
    workloads,
    project_candidates: sorted
      .filter((candidate) => candidate.workload_ref === null)
      .map((candidate) =>
        compareCandidate(contract, candidate, report, options.asOf),
      ),
    project_gaps: report.project,
    adapter_gaps: report.adapters,
    unresolved_questions: contract.intent.unresolved_questions,
  };
}
