import { createHash } from "node:crypto";

import { stableStringify } from "./canonical.js";
import type { ContractResult } from "./errors.js";
import { fail, issue, ok } from "./errors.js";
import { resolveDecision } from "./resolve.js";
import type { ResolvedApprovalContent } from "./resolve.js";
import type { Approval } from "./schema/approvals.js";
import type { ProjectContract } from "./schema/contract.js";

export const HASH_ALGORITHM = "sha-256" as const;

/**
 * Hash the exact resolved content of an approval.
 *
 * The digest is taken over canonical bytes, so it is stable across machines,
 * key orderings, and repeated runs. Changing the decision revision, the
 * selected candidate, any cited evidence record, or any approved constraint
 * result changes the digest and makes an existing approval non-current.
 */
export function hashApprovalContent(content: ResolvedApprovalContent): string {
  return createHash("sha256")
    .update(stableStringify(content), "utf8")
    .digest("hex");
}

/** Compute the hash a fresh approval of `decisionId` would carry. */
export function computeApprovalHash(
  contract: ProjectContract,
  decisionId: string,
): ContractResult<string> {
  const resolved = resolveDecision(contract, decisionId);
  if (!resolved.ok) {
    return fail(resolved.issues);
  }
  return ok(hashApprovalContent(resolved.value.content));
}

export type ApprovalState =
  | { readonly state: "none" }
  | { readonly state: "current"; readonly approval: Approval }
  | {
      readonly state: "stale";
      readonly approval: Approval;
      readonly expectedHash: string;
    }
  | { readonly state: "unresolvable"; readonly reason: string };

/**
 * Report whether the most recent approval for a decision still describes the
 * contract's current resolved content.
 *
 * History is never rewritten: a superseded approval remains in `approvals` and
 * is simply reported as `stale`.
 */
export function approvalState(
  contract: ProjectContract,
  decisionId: string,
): ApprovalState {
  const history = contract.approvals.filter(
    (entry) => entry.decision_ref === decisionId,
  );
  if (history.length === 0) {
    return { state: "none" };
  }
  const latest = history[history.length - 1];
  if (latest === undefined) {
    return { state: "none" };
  }

  const expected = computeApprovalHash(contract, decisionId);
  if (!expected.ok) {
    const first = expected.issues[0];
    return {
      state: "unresolvable",
      reason: first === undefined ? "resolution failed" : first.message,
    };
  }

  return latest.content_hash === expected.value
    ? { state: "current", approval: latest }
    : { state: "stale", approval: latest, expectedHash: expected.value };
}

/** True when a current, matching approval exists for the decision. */
export function isApprovalCurrent(
  contract: ProjectContract,
  decisionId: string,
): boolean {
  return approvalState(contract, decisionId).state === "current";
}

export interface AppendApprovalInput {
  readonly decisionId: string;
  /** A local identity or role. Approval is always a local human action. */
  readonly actorRef: string;
  readonly approvedAt: string;
  readonly note?: string | null;
}

/**
 * Append an approval to the history.
 *
 * This never mutates the input contract and never removes or rewrites an
 * existing approval: it returns a new contract whose `approvals` array has one
 * more entry. There is deliberately no delete or amend operation.
 */
export function appendApproval(
  contract: ProjectContract,
  input: AppendApprovalInput,
): ContractResult<ProjectContract> {
  const hash = computeApprovalHash(contract, input.decisionId);
  if (!hash.ok) {
    return fail(hash.issues);
  }

  const last = contract.approvals[contract.approvals.length - 1];
  if (
    last !== undefined &&
    Date.parse(input.approvedAt) < Date.parse(last.approved_at)
  ) {
    return fail([
      issue(
        "approval_history_not_append_only",
        "approvals",
        "a new approval must not predate the last entry; history is append-only and ordered oldest first",
        { approved_at: input.approvedAt, previous: last.approved_at },
      ),
    ]);
  }

  const decision = contract.decisions.find(
    (entry) => entry.id === input.decisionId,
  );
  if (decision === undefined) {
    return fail([
      issue(
        "reference_not_found",
        "approvals",
        `no decision with id "${input.decisionId}" exists in this contract`,
        { decision: input.decisionId },
      ),
    ]);
  }

  const approval: Approval = {
    decision_ref: input.decisionId,
    decision_revision: decision.revision,
    actor: { kind: "local_user", ref: input.actorRef },
    approved_at: input.approvedAt,
    note: input.note ?? null,
    hash_algorithm: HASH_ALGORITHM,
    content_hash: hash.value,
  };

  return ok({ ...contract, approvals: [...contract.approvals, approval] });
}
