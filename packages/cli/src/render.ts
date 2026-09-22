import type { EvidenceGapEntry, OutboundDisclosure } from "@anvilmark/adapters";
import { sanitizeText } from "@anvilmark/adapters";
import type {
  ContractIssue,
  ProjectContract,
  ResolvedApprovalContent,
} from "@anvilmark/project-contract";
import {
  approvalState,
  prettyStringify,
  tierForEvidence,
} from "@anvilmark/project-contract";

import type { CandidateOrigin } from "./provenance.js";

import type {
  CandidateComparison,
  Comparison,
  ConstraintStanding,
} from "./workflow/compare.js";
import type { DecisionReview } from "./workflow/decisions.js";
import { selectedIntelligence } from "./workflow/edit.js";

/**
 * The limit every approval surface states. Doc 06 section 5.
 */
export const APPROVAL_LIMIT_STATEMENT =
  "Approval requires an interactive local terminal. This reduces accidental approval; it does not prove a human is present, and an agent with unrestricted shell access can drive a terminal. Rely on your agent's permission settings for that boundary.";

export function lines(
  ...parts: readonly (string | readonly string[])[]
): string {
  return `${parts.flat().join("\n")}\n`;
}

export function renderIssues(issues: readonly ContractIssue[]): string[] {
  return issues.map(
    (entry) =>
      `  [${entry.code}] ${entry.path}: ${sanitizeText(entry.message).text}`,
  );
}

function list(values: readonly string[], empty: string): string[] {
  return values.length === 0
    ? [`    ${empty}`]
    : values.map((value) => `    - ${value}`);
}

/** Sections that are still empty, so an incomplete draft says so. */
export function notYetProvided(contract: ProjectContract): string[] {
  const missing: string[] = [];
  if (contract.intent.users.length === 0) missing.push("users");
  if (contract.intent.outcomes.length === 0) missing.push("outcomes");
  if (contract.intent.non_goals.length === 0) missing.push("non-goals");
  if (contract.workloads.length === 0) missing.push("workloads");
  if (contract.constraints.length === 0) missing.push("constraints");
  if (contract.project.priority_order.length === 0)
    missing.push("priority order");
  if (contract.resources.hardware.length === 0) missing.push("hardware");
  if (contract.resources.budgets.length === 0) missing.push("budgets");
  if (contract.candidates.length === 0) missing.push("candidates");
  if (contract.decisions.length === 0) missing.push("decisions");
  return missing;
}

export function renderStatus(input: {
  readonly contract: ProjectContract;
  readonly root: string;
  readonly stateRevision: number | null;
  readonly editedOutsideCli: boolean;
}): string {
  const { contract } = input;
  const questions = contract.intent.unresolved_questions;
  const constraintCounts = ["hard", "soft", "informational"].map(
    (severity) =>
      `${contract.constraints.filter((entry) => entry.severity === severity).length} ${severity}`,
  );
  const decisions = contract.decisions.map((decision) => {
    const state = approvalState(contract, decision.id);
    const approval =
      state.state === "none"
        ? "no approval"
        : state.state === "current"
          ? "approval current"
          : state.state === "stale"
            ? "approval NOT current"
            : `approval unresolvable (${state.reason})`;
    return `${decision.id} r${decision.revision}: ${decision.status}, ${approval}`;
  });
  const missing = notYetProvided(contract);
  return lines(
    `Project ${contract.project.name} (${contract.project.id})`,
    `  directory:          ${input.root}`,
    `  state revision:     ${input.stateRevision === null ? "none committed" : `r${input.stateRevision}`}${input.editedOutsideCli ? " (project.yaml edited outside the CLI since)" : ""}`,
    `  contract revision:  ${contract.project.contract_revision} (${contract.project.state})`,
    `  schema:             ${contract.schema_version}`,
    `  intelligence:       ${selectedIntelligence(contract)}`,
    `  remote projection:  ${contract.remote_intelligence_policy.default_allow.length === 0 ? "nothing may be sent to remote intelligence" : contract.remote_intelligence_policy.default_allow.join(", ")}`,
    `  repositories:       ${contract.project.repository_roots.length === 0 ? "none referenced" : contract.project.repository_roots.join(", ")}`,
    "",
    `Intent: ${contract.intent.summary}`,
    `  users:      ${contract.intent.users.join(", ") || "not yet provided"}`,
    `  outcomes:   ${contract.intent.outcomes.map((entry) => `${entry.measure} ${entry.target}`).join("; ") || "not yet provided"}`,
    `  non-goals:  ${contract.intent.non_goals.join("; ") || "not yet provided"}`,
    `  priority:   ${contract.project.priority_order.join(" > ") || "not yet provided"}`,
    "",
    `Workloads (${contract.workloads.length}): ${contract.workloads.map((entry) => entry.id).join(", ") || "none"}`,
    `  monthly usage unknown: ${
      contract.workloads
        .filter((entry) => entry.expected_usage.calls_per_month === null)
        .map((entry) => entry.id)
        .join(", ") || "none"
    }`,
    `  output classification not declared: ${
      contract.workloads
        .filter((entry) => entry.output_classification === null)
        .map((entry) => entry.id)
        .join(", ") || "none"
    }`,
    `Constraints: ${constraintCounts.join(", ")}`,
    `Hardware: ${contract.resources.hardware.length}, budgets: ${contract.resources.budgets.length}`,
    `Candidates (${contract.candidates.length}): ${contract.candidates.map((entry) => `${entry.id} [${entry.status}]`).join(", ") || "none"}`,
    `Evidence records: ${contract.evidence_refs.length}`,
    "",
    "Decisions:",
    list(decisions, "none"),
    "",
    `Unresolved questions (${questions.length}):`,
    questions.length === 0
      ? ["    none recorded"]
      : questions.map((question, index) => `    ${index + 1}. ${question}`),
    "",
    `Not yet provided: ${missing.length === 0 ? "nothing" : missing.join(", ")}`,
  );
}

function renderStanding(entry: ConstraintStanding): string[] {
  const direction = entry.direction === null ? "" : `, ${entry.direction}`;
  const head = `      ${entry.constraint_ref} (${entry.severity}${direction}, ${entry.domain}): ${entry.explanation}`;
  const evidence = entry.evidence.map(
    (record) =>
      `        evidence ${record.id}: ${record.kind}, ${record.tier}, observed ${record.observed_at}, ${record.freshness}${record.freshness === "current" ? "" : ` (${record.freshness_reason})`}`,
  );
  return [head, ...evidence];
}

function renderGap(gap: EvidenceGapEntry): string {
  const floor =
    gap.required_floor === null ? "" : ` [needs ${gap.required_floor}]`;
  return `      ${gap.code}${floor} ${gap.subject}: ${gap.reason}`;
}

export function renderCandidate(candidate: CandidateComparison): string[] {
  const section = (
    title: string,
    entries: readonly ConstraintStanding[],
  ): string[] =>
    entries.length === 0
      ? [`    ${title}: none`]
      : [`    ${title}:`, ...entries.flatMap(renderStanding)];
  return [
    `  ${candidate.candidate_ref} [${candidate.status}]`,
    `    ${candidate.component_kind}, ${candidate.deployment}${candidate.model === null ? ", model not chosen" : `, model ${candidate.model}`}`,
    ...section("Satisfied", candidate.satisfied),
    ...section("Failed", candidate.failed),
    ...section("Unknown", candidate.unknown),
    ...section("Recorded, not scored", candidate.not_scored),
    "    Evidence on record for this candidate:",
    ...(candidate.evidence_on_record.length === 0
      ? ["      none"]
      : candidate.evidence_on_record.map(
          (record) =>
            `      ${record.id}: ${record.kind}, ${record.tier}, observed ${record.observed_at}, ${record.freshness}; ${record.cited_for.length === 0 ? "not cited for any constraint" : `cited for ${record.cited_for.join(", ")}`}`,
        )),
    "    Assumptions:",
    ...(candidate.assumptions.length === 0
      ? ["      none recorded"]
      : candidate.assumptions.map((value) => `      - ${value}`)),
    "    Incompatible or rejected because:",
    ...(candidate.incompatibility_reasons.length === 0
      ? ["      nothing recorded"]
      : candidate.incompatibility_reasons.map((value) => `      - ${value}`)),
    "    Evidence still required:",
    ...(candidate.evidence_required.length === 0
      ? ["      none"]
      : candidate.evidence_required.map(renderGap)),
  ];
}

export function renderComparison(comparison: Comparison): string {
  const out: string[] = [
    `Alternatives as of ${comparison.as_of}`,
    `Priority order for tie-breaking: ${comparison.priority_order.join(" > ") || "not yet provided"}`,
    "No overall score is computed. Each dimension is shown separately; missing evidence is unknown, never a pass.",
  ];
  for (const workload of comparison.workloads) {
    out.push(
      "",
      `Workload ${workload.workload_ref}: ${workload.name} — ${workload.usage}; output classification ${workload.output_classification ?? "not declared (unknown)"}`,
    );
    if (workload.candidates.length === 0) {
      out.push("  no candidates yet");
    } else if (workload.candidates.length === 1) {
      out.push("  only one candidate: there is nothing to compare it with yet");
    }
    for (const candidate of workload.candidates) {
      out.push(...renderCandidate(candidate));
    }
    if (workload.workload_gaps.length > 0) {
      out.push(
        "  Workload evidence gaps:",
        ...workload.workload_gaps.map(renderGap),
      );
    }
  }
  if (comparison.project_candidates.length > 0) {
    out.push("", "Project- or component-scope candidates:");
    for (const candidate of comparison.project_candidates) {
      out.push(...renderCandidate(candidate));
    }
  }
  if (comparison.project_gaps.length > 0) {
    out.push(
      "",
      "Project-level evidence gaps:",
      ...comparison.project_gaps.map(renderGap),
    );
  }
  if (comparison.adapter_gaps.length > 0) {
    out.push(
      "",
      "Optional tools:",
      ...comparison.adapter_gaps.map(
        (entry) => `  ${entry.adapter_id}: ${entry.standing} — ${entry.reason}`,
      ),
    );
  }
  out.push(
    "",
    `Unresolved questions: ${comparison.unresolved_questions.length === 0 ? "none" : ""}`,
    ...comparison.unresolved_questions.map((q, i) => `  ${i + 1}. ${q}`),
  );
  return lines(out);
}

function value(entry: unknown): string {
  return entry === null || entry === undefined
    ? "none"
    : typeof entry === "string"
      ? entry
      : JSON.stringify(entry);
}

/**
 * Every field of the selected candidate that the approval hash covers, in
 * readable form. The exact JSON follows separately; this block exists so a
 * consequential difference -- a quantization, a floating version, an estimate
 * -- is readable without parsing JSON.
 */
function renderCoveredCandidate(
  candidate: ResolvedApprovalContent["selected_candidate"],
  origin: CandidateOrigin | undefined,
): string[] {
  const model = candidate.model;
  const deployment = Object.entries(candidate.deployment).map(
    ([key, entry]) => `${key} ${value(entry)}`,
  );
  const measurements = candidate.measurements;
  const estimates = candidate.estimates;
  return [
    `  id: ${candidate.id} [${candidate.status}]`,
    `  workload: ${value(candidate.workload_ref)}, component kind: ${candidate.component_kind}`,
    `  deployment: ${deployment.join(", ")}`,
    model === null
      ? "  model: not chosen"
      : `  model: family ${model.family}, version ${value(model.version)}, version_mutability ${model.version_mutability}, quantization ${value(model.quantization)}, licence evidence ${value(model.license_evidence_ref)}`,
    ...(model !== null && model.version_mutability === "floating"
      ? [
          `  WARNING: the model reference is floating${model.version === null ? " (no version)" : ` ("${model.version}")`}. The approval covers this reference, not a fixed artifact: what it resolves to can change without the contract changing.`,
        ]
      : []),
    `  measurements: quality ${value(measurements.quality_result_ref)}, hardware fit ${value(measurements.hardware_fit_evidence_ref)}, latency ${value(measurements.latency_measurement_ref)}, tokens ${value(measurements.token_measurement_ref)}, cost ${value(measurements.cost_measurement_ref)}, expected evaluation ${value(measurements.expected_evaluation)}`,
    `  estimates: tokens/call ${value(estimates.tokens_per_call)}, latency p95 ms ${value(estimates.latency_p95_ms)}, monthly effective cost USD ${value(estimates.monthly_effective_cost_usd)}, basis ${value(estimates.basis)}`,
    `  assumptions: ${estimates.assumptions.length === 0 ? "none" : estimates.assumptions.join("; ")}`,
    `  constraint results recorded on the candidate: ${candidate.constraint_results.length}`,
    origin === undefined
      ? "  origin: not added by an intelligence proposal"
      : `  origin: added by proposal ${origin.proposal_id} via ${origin.adapter_id} in state r${origin.state_revision}; generated rationale (not evidence): ${origin.rationale ?? "none given"}`,
  ];
}

function renderCoveredEvidence(
  record: ResolvedApprovalContent["cited_evidence"][number],
): string[] {
  return [
    `  ${record.id}: ${record.kind}, tier ${tierForEvidence(record)}, confidence ${record.confidence}`,
    `    subject: ${record.subject}`,
    `    producer: ${record.producer.name}${record.producer.version === null ? "" : ` ${record.producer.version}`}; observed ${record.observed_at}; source ${record.source.type}${record.source.locator === null ? "" : ` ${record.source.locator}`}`,
    `    refresh: ${record.refresh.policy}${record.refresh.expires_at === null ? "" : `, expires ${record.refresh.expires_at}`}`,
    `    applies to: candidate ${value(record.applies_to.candidate_ref)}, workload ${value(record.applies_to.workload_ref)}, hardware ${value(record.applies_to.hardware_ref)}, constraints ${record.applies_to.constraint_refs.join(", ") || "none"}`,
    `    caveats: ${record.caveats.length === 0 ? "none" : record.caveats.join("; ")}`,
    `    value: ${JSON.stringify(record.value)}`,
  ];
}

export function renderReview(
  review: DecisionReview,
  options: {
    /** Which proposal added each candidate, from committed history. */
    readonly origins?: ReadonlyMap<string, CandidateOrigin>;
  } = {},
): string {
  const decision = review.decision;
  const scope =
    decision.scope.kind === "workload"
      ? `workload ${decision.scope.workload_ref}`
      : decision.scope.kind === "component"
        ? `component ${decision.scope.component_ref}`
        : "project";
  const state = review.approval_state;
  const resolved = review.resolved;
  const out: string[] = [
    `Decision ${decision.id} — revision ${decision.revision}, ${decision.status}`,
    `  scope: ${scope}`,
    `  selected candidate: ${decision.selected_candidate_ref ?? "none"}`,
    `  alternatives: ${decision.alternatives.join(", ") || "none"}`,
    `  claims satisfied: ${decision.satisfies_constraints.join(", ") || "none"}`,
    `  declared unresolved: ${decision.unresolved_constraints.join(", ") || "none"}`,
    `  rationale (${review.rationale.provenance}): ${review.rationale.summary}`,
    "",
  ];
  if (review.selected !== null) {
    out.push("Selected candidate:", ...renderCandidate(review.selected), "");
  }
  for (const alternative of review.alternatives) {
    const origin = options.origins?.get(alternative.candidate_ref);
    out.push(
      "Alternative:",
      ...renderCandidate(alternative),
      ...(origin === undefined
        ? []
        : [
            `    origin: added by proposal ${origin.proposal_id} via ${origin.adapter_id} in state r${origin.state_revision}; generated rationale (not evidence): ${origin.rationale ?? "none given"}`,
          ]),
      "",
    );
  }
  out.push(
    "Claimed satisfied constraints, as evaluated now:",
    ...(review.claimed_satisfied.length === 0
      ? ["  none claimed"]
      : review.claimed_satisfied.map(
          (entry) =>
            `  ${entry.constraint_ref}: ${entry.outcome} — ${entry.explanation}`,
        )),
    "",
    `Unresolved project questions (${review.unknowns.length}):`,
    ...(review.unknowns.length === 0
      ? ["  none"]
      : review.unknowns.map((q, i) => `  ${i + 1}. ${q}`)),
    "",
    "==== Content covered by the approval hash ====",
  );
  if (resolved === null) {
    out.push(
      "  the decision does not resolve, so there is no content to approve:",
      ...review.resolution_problems.map((entry) => `  - ${entry}`),
    );
  } else {
    out.push(
      `Decision ${resolved.decision_id}, revision ${resolved.decision_revision}`,
      "",
      "Selected candidate, every covered field:",
      ...renderCoveredCandidate(
        resolved.selected_candidate,
        options.origins?.get(resolved.selected_candidate.id),
      ),
      "",
      "Approved constraint results:",
      ...(resolved.constraint_results.length === 0
        ? ["  none (the decision claims no constraint as satisfied)"]
        : resolved.constraint_results.map(
            (result) =>
              `  ${result.constraint_ref}: recorded ${result.status}, ${result.determinism}, evidence ${result.evidence_refs.join(", ") || "none"}, evaluated ${value(result.evaluated_at)}, explanation ${value(result.explanation)}`,
          )),
      "",
      "Cited evidence, in full:",
      ...(resolved.cited_evidence.length === 0
        ? ["  none"]
        : resolved.cited_evidence.flatMap(renderCoveredEvidence)),
      "",
      "Exact approval content (the hash below is SHA-256 over the canonical compact form of exactly this JSON):",
      prettyStringify(resolved).trimEnd(),
    );
  }
  out.push(
    "==== End of covered content ====",
    "",
    `Approval hash (sha-256):`,
    `  ${review.approval_hash ?? "cannot be computed: the decision does not resolve"}`,
    `Approval state: ${state.state}${state.state === "stale" ? ` — the latest approval (${state.approval.approved_at}, revision ${state.approval.decision_revision}) no longer matches` : state.state === "current" ? ` — approved by ${state.approval.actor.ref} at ${state.approval.approved_at}` : ""}`,
    `Approval history: ${review.approval_history.length} record(s), append-only`,
    "",
    review.blockers.length === 0
      ? "Approvable: yes, interactively, with: anvilmark approve " + decision.id
      : "Not approvable yet:",
    ...review.blockers.map((entry) => `  - ${entry}`),
    "",
    APPROVAL_LIMIT_STATEMENT,
  );
  return lines(out);
}

export function renderDisclosure(disclosure: OutboundDisclosure): string {
  const category = {
    local_runtime: "local runtime on this machine (loopback)",
    remote_provider: "REMOTE provider — data leaves this machine",
    user_operated_agent:
      "a file for an agent you run; ANVILMARK sends nothing, but the agent may send it to its model provider",
  }[disclosure.destination_category];
  const cost = {
    may_incur_cost: "yes — using this provider may cost money",
    no_provider_charge: "no provider charge declared",
    unknown: "unknown",
  }[disclosure.cost];
  return lines(
    "Outbound intelligence request",
    `  adapter:               ${disclosure.adapter_id} (${disclosure.mechanism})`,
    `  destination:           ${category}`,
    `  declared destination:  ${disclosure.destination ?? "not applicable"}${disclosure.destination === null ? "" : " (declared in host configuration; not network-observed)"}`,
    `  model:                 ${disclosure.model ?? "chosen by your agent"}`,
    `  data categories sent:  ${disclosure.data_categories.join(", ") || "none"}`,
    `  withheld:              ${disclosure.withheld_categories.join(", ") || "none"}`,
    `  repository contents:   ${disclosure.includes_repository_contents ? "INCLUDED" : "not included"}`,
    `  evaluation rows:       ${disclosure.includes_evaluation_rows ? "INCLUDED" : "not included"}`,
    `  may cost money:        ${cost}`,
    `  credential variable:   ${disclosure.credential_env ?? "none"}${disclosure.credential_env === null ? "" : " (value read at send time; never stored or shown)"}`,
    `  request digest:        ${disclosure.request_digest} (${disclosure.request_bytes} bytes)`,
  );
}
