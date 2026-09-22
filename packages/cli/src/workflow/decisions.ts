import type {
  Approval,
  ApprovalState,
  Decision,
  DecisionScope,
  ProjectContract,
  ResolvedApprovalContent,
} from "@anvilmark/project-contract";
import {
  appendApproval,
  approvalState,
  hashApprovalContent,
  resolveDecision,
  stableStringify,
} from "@anvilmark/project-contract";

import type { CandidateComparison, ConstraintStanding } from "./compare.js";
import { compareAlternatives, constraintsFor, standingFor } from "./compare.js";
import { WorkflowError, clone, requireId } from "./edit.js";

export interface DecisionInput {
  readonly id: string;
  readonly scope: DecisionScope;
  readonly selectedCandidate: string;
  readonly alternatives: readonly string[];
  readonly satisfies: readonly string[];
  readonly unresolved: readonly string[];
  readonly evidence: readonly string[];
  readonly rationale: {
    readonly summary: string;
    /** Null when the user wrote it; the generator's name when it did not. */
    readonly generated_by: string | null;
  };
}

function decisionIn(contract: ProjectContract, id: string): Decision {
  const decision = contract.decisions.find((entry) => entry.id === id);
  if (decision === undefined) {
    throw new WorkflowError(`decision "${id}" does not exist`);
  }
  return decision;
}

/** Create a decision in `draft`. Drafts are free to be incomplete. */
export function draftDecision(
  contract: ProjectContract,
  input: DecisionInput,
  now: string,
): ProjectContract {
  requireId(input.id, "decision id");
  const next = clone(contract);
  if (next.decisions.some((entry) => entry.id === input.id)) {
    throw new WorkflowError(`decision "${input.id}" already exists`);
  }
  next.decisions.push({
    id: input.id,
    revision: 1,
    status: "draft",
    scope: input.scope,
    selected_candidate_ref: input.selectedCandidate,
    alternatives: [...input.alternatives],
    satisfies_constraints: [...input.satisfies],
    unresolved_constraints: [...input.unresolved],
    evidence_refs: [...input.evidence],
    rationale: {
      summary: input.rationale.summary,
      generated_by: input.rationale.generated_by,
      reviewed_by_user: false,
    },
    created_at: now,
    updated_at: null,
  });
  next.project.updated_at = now;
  return next;
}

export interface DecisionRevision {
  readonly selectedCandidate?: string;
  readonly alternatives?: readonly string[];
  readonly satisfies?: readonly string[];
  readonly unresolved?: readonly string[];
  readonly evidence?: readonly string[];
  readonly rationale?: DecisionInput["rationale"];
}

/**
 * Proposed -> Draft (or Approved -> Draft), with a new decision revision.
 *
 * The earlier revision stays in the state history and any approval of it stays
 * in the append-only approval list, where it is reported as not current.
 */
export function reviseDecision(
  contract: ProjectContract,
  id: string,
  change: DecisionRevision,
  now: string,
): { readonly contract: ProjectContract; readonly notices: readonly string[] } {
  const next = clone(contract);
  const decision = decisionIn(next, id);
  if (decision.status === "rejected" || decision.status === "superseded") {
    throw new WorkflowError(
      `decision "${id}" is ${decision.status}; draft a new decision instead of reviving it`,
    );
  }
  const notices: string[] = [];
  if (decision.status === "approved") {
    notices.push(
      `decision "${id}" revision ${decision.revision} was approved; that approval stays in the history and is no longer current for revision ${decision.revision + 1}`,
    );
  }
  if (change.selectedCandidate !== undefined)
    decision.selected_candidate_ref = change.selectedCandidate;
  if (change.alternatives !== undefined)
    decision.alternatives = [...change.alternatives];
  if (change.satisfies !== undefined)
    decision.satisfies_constraints = [...change.satisfies];
  if (change.unresolved !== undefined)
    decision.unresolved_constraints = [...change.unresolved];
  if (change.evidence !== undefined)
    decision.evidence_refs = [...change.evidence];
  if (change.rationale !== undefined) {
    decision.rationale = {
      summary: change.rationale.summary,
      generated_by: change.rationale.generated_by,
      reviewed_by_user: false,
    };
  }
  decision.rationale.reviewed_by_user = false;
  decision.revision += 1;
  decision.status = "draft";
  decision.updated_at = now;
  next.project.updated_at = now;
  return { contract: next, notices };
}

export function rejectDecision(
  contract: ProjectContract,
  id: string,
  now: string,
): ProjectContract {
  const next = clone(contract);
  const decision = decisionIn(next, id);
  if (decision.status !== "proposed") {
    throw new WorkflowError(
      `only a proposed decision can be rejected; "${id}" is ${decision.status}`,
    );
  }
  decision.status = "rejected";
  decision.updated_at = now;
  next.project.updated_at = now;
  return next;
}

// --- review ----------------------------------------------------------------

export interface DecisionReview {
  readonly decision: Decision;
  readonly as_of: string;
  readonly resolved: ResolvedApprovalContent | null;
  readonly resolution_problems: readonly string[];
  /** SHA-256 over the resolved content, computed by the contract package. */
  readonly approval_hash: string | null;
  readonly approval_state: ApprovalState;
  readonly approval_history: readonly Approval[];
  readonly selected: CandidateComparison | null;
  readonly alternatives: readonly CandidateComparison[];
  /** Each constraint the decision claims to satisfy, with its real standing. */
  readonly claimed_satisfied: readonly ConstraintStanding[];
  readonly declared_unresolved: readonly string[];
  readonly rationale: {
    readonly summary: string;
    readonly provenance: string;
    readonly reviewed_by_user: boolean;
  };
  readonly unknowns: readonly string[];
  /** Why an approval would be refused now. Empty means approvable. */
  readonly blockers: readonly string[];
}

function exceptionCovers(
  contract: ProjectContract,
  constraintRef: string,
  decisionId: string,
  asOf: string,
): boolean {
  const constraint = contract.constraints.find(
    (entry) => entry.id === constraintRef,
  );
  const now = Date.parse(asOf);
  return (
    constraint?.exceptions.some(
      (exception) =>
        exception.decision_ref === decisionId &&
        (exception.expires_at === null ||
          Date.parse(exception.expires_at) > now),
    ) ?? false
  );
}

/**
 * Everything an approval of this decision would cover, and every reason it
 * cannot be approved yet.
 *
 * Resolution and hashing are `resolveDecision` and `hashApprovalContent`;
 * currentness is `approvalState`. Constraint standing is the same evaluation
 * the gap report uses. Nothing here re-implements those rules.
 */
export function reviewDecision(
  contract: ProjectContract,
  id: string,
  asOf: string,
): DecisionReview {
  const decision = decisionIn(contract, id);
  const resolution = resolveDecision(contract, id);
  const resolved = resolution.ok ? resolution.value.content : null;
  const comparison = compareAlternatives(contract, { asOf });
  const all = [
    ...comparison.workloads.flatMap((entry) => entry.candidates),
    ...comparison.project_candidates,
  ];
  const selected =
    all.find(
      (entry) => entry.candidate_ref === decision.selected_candidate_ref,
    ) ?? null;
  const alternatives = decision.alternatives
    .map((ref) => all.find((entry) => entry.candidate_ref === ref))
    .filter((entry): entry is CandidateComparison => entry !== undefined);

  const selectedCandidate = contract.candidates.find(
    (entry) => entry.id === decision.selected_candidate_ref,
  );
  const claimed =
    selectedCandidate === undefined
      ? []
      : decision.satisfies_constraints.flatMap((ref) => {
          const constraint = contract.constraints.find(
            (entry) => entry.id === ref,
          );
          return constraint === undefined
            ? []
            : [standingFor(contract, constraint, selectedCandidate, asOf)];
        });

  const blockers: string[] = [];
  if (decision.status !== "proposed") {
    blockers.push(
      decision.status === "draft"
        ? `decision is a draft; run "anvilmark decision propose ${id}" first`
        : `decision is ${decision.status}; only a proposed decision can be approved`,
    );
  }
  if (!resolution.ok) {
    blockers.push(
      ...resolution.issues.map((entry) => `unresolvable: ${entry.message}`),
    );
  }
  for (const standing of claimed) {
    if (standing.outcome !== "pass" && standing.outcome !== "not_applicable") {
      blockers.push(
        `the decision claims "${standing.constraint_ref}" is satisfied, but its standing is ${standing.outcome}: ${standing.explanation}`,
      );
    }
  }
  if (selectedCandidate !== undefined) {
    for (const constraint of constraintsFor(contract, selectedCandidate)) {
      if (constraint.severity !== "hard") continue;
      const standing = standingFor(
        contract,
        constraint,
        selectedCandidate,
        asOf,
      );
      if (
        standing.outcome === "fail" &&
        !exceptionCovers(contract, constraint.id, id, asOf)
      ) {
        blockers.push(
          `hard constraint "${constraint.id}" fails for the selected candidate and no exception covers this decision`,
        );
      }
      if (
        standing.outcome === "unknown" &&
        !decision.unresolved_constraints.includes(constraint.id) &&
        !decision.satisfies_constraints.includes(constraint.id)
      ) {
        blockers.push(
          `hard constraint "${constraint.id}" is unknown for the selected candidate; list it with --unresolved so the approval records it as an open question rather than hiding it`,
        );
      }
    }
  }
  const state = approvalState(contract, id);
  if (state.state === "current" && decision.status === "approved") {
    blockers.push("this exact content is already approved and current");
  }

  return {
    decision,
    as_of: asOf,
    resolved,
    resolution_problems: resolution.ok
      ? []
      : resolution.issues.map((entry) => entry.message),
    approval_hash: resolved === null ? null : hashApprovalContent(resolved),
    approval_state: state,
    approval_history: contract.approvals.filter(
      (entry) => entry.decision_ref === id,
    ),
    selected,
    alternatives,
    claimed_satisfied: claimed,
    declared_unresolved: decision.unresolved_constraints,
    rationale: {
      summary: decision.rationale.summary,
      provenance:
        decision.rationale.generated_by === null
          ? "written by the user"
          : `generated by ${decision.rationale.generated_by}; generated prose is not evidence`,
      reviewed_by_user: decision.rationale.reviewed_by_user,
    },
    unknowns: contract.intent.unresolved_questions,
    blockers,
  };
}

/** Draft -> Proposed. Refused while the review has blockers other than status. */
export function proposeDecision(
  contract: ProjectContract,
  id: string,
  now: string,
): ProjectContract {
  const decision = decisionIn(contract, id);
  if (decision.status !== "draft") {
    throw new WorkflowError(
      `only a draft decision can be proposed; "${id}" is ${decision.status}`,
    );
  }
  const next = clone(contract);
  const target = decisionIn(next, id);
  target.status = "proposed";
  target.updated_at = now;
  next.project.updated_at = now;
  const review = reviewDecision(next, id, now);
  if (review.blockers.length > 0) {
    throw new WorkflowError(
      `decision "${id}" cannot be proposed yet:\n  - ${review.blockers.join("\n  - ")}`,
    );
  }
  return next;
}

/**
 * Keep approval honest after any change.
 *
 * An approved decision whose resolved content no longer matches its latest
 * approval moves to `proposed` under a new revision, and the project's
 * contract revision advances. The old approval is not touched: it remains in
 * the append-only history and `approvalState` reports it stale.
 */
export function reconcileApprovals(
  contract: ProjectContract,
  now: string,
): { readonly contract: ProjectContract; readonly notices: readonly string[] } {
  const notices: string[] = [];
  let next: ProjectContract | null = null;
  for (const decision of contract.decisions) {
    if (decision.status !== "approved") continue;
    const state = approvalState(contract, decision.id);
    if (state.state === "current") continue;
    next ??= clone(contract);
    const target = decisionIn(next, decision.id);
    target.revision += 1;
    target.status = "proposed";
    target.rationale.reviewed_by_user = false;
    target.updated_at = now;
    notices.push(
      `decision "${decision.id}" was approved, but this change alters the content that approval covered; it is now proposed revision ${target.revision} and needs a new interactive approval (the earlier approval is kept, not current)`,
    );
  }
  if (next === null) {
    return { contract, notices };
  }
  next.project.contract_revision += 1;
  next.project.updated_at = now;
  return { contract: next, notices };
}

/**
 * Proposed -> Approved, given a hash the user confirmed.
 *
 * Refuses unless the content resolved NOW hashes to exactly the hash that was
 * displayed and confirmed. Appends one approval record; supersedes any other
 * approved decision for the same scope.
 */
export function approveDecision(
  contract: ProjectContract,
  input: {
    readonly id: string;
    readonly confirmedHash: string;
    readonly actorRef: string;
    readonly note: string | null;
    readonly now: string;
  },
): {
  readonly contract: ProjectContract;
  readonly superseded: readonly string[];
} {
  const review = reviewDecision(contract, input.id, input.now);
  if (review.blockers.length > 0) {
    throw new WorkflowError(
      `decision "${input.id}" cannot be approved:\n  - ${review.blockers.join("\n  - ")}`,
    );
  }
  if (review.approval_hash !== input.confirmedHash) {
    throw new WorkflowError(
      "the decision's resolved content changed after it was displayed; nothing was approved, review it again",
    );
  }

  const next = clone(contract);
  const decision = decisionIn(next, input.id);
  decision.status = "approved";
  decision.rationale.reviewed_by_user = true;
  decision.updated_at = input.now;

  const superseded: string[] = [];
  for (const other of next.decisions) {
    if (
      other.id !== input.id &&
      other.status === "approved" &&
      stableStringify(other.scope) === stableStringify(decision.scope)
    ) {
      other.status = "superseded";
      other.updated_at = input.now;
      superseded.push(other.id);
    }
  }
  if (decision.scope.kind === "workload") {
    const workloadRef = decision.scope.workload_ref;
    const workload = next.workloads.find((entry) => entry.id === workloadRef);
    if (workload !== undefined) workload.current_decision_ref = decision.id;
  }
  next.project.updated_at = input.now;

  const appended = appendApproval(next, {
    decisionId: input.id,
    actorRef: input.actorRef,
    approvedAt: input.now,
    note: input.note,
  });
  if (!appended.ok) {
    throw new WorkflowError(
      `the approval could not be recorded: ${appended.issues.map((entry) => entry.message).join("; ")}`,
    );
  }
  const recorded =
    appended.value.approvals[appended.value.approvals.length - 1];
  if (recorded?.content_hash !== input.confirmedHash) {
    throw new WorkflowError(
      "the recorded approval hash does not match the confirmed hash; nothing was approved",
    );
  }
  return { contract: appended.value, superseded };
}
