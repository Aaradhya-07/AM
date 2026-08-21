import type { ContractResult } from "./errors.js";
import type { ResolvedApprovalContent } from "./resolve.js";
import type { Approval } from "./schema/approvals.js";
import type { ProjectContract } from "./schema/contract.js";
export declare const HASH_ALGORITHM: "sha-256";
/**
 * Hash the exact resolved content of an approval.
 *
 * The digest is taken over canonical bytes, so it is stable across machines,
 * key orderings, and repeated runs. Changing the decision revision, the
 * selected candidate, any cited evidence record, or any approved constraint
 * result changes the digest and makes an existing approval non-current.
 */
export declare function hashApprovalContent(content: ResolvedApprovalContent): string;
/** Compute the hash a fresh approval of `decisionId` would carry. */
export declare function computeApprovalHash(contract: ProjectContract, decisionId: string): ContractResult<string>;
export type ApprovalState = {
    readonly state: "none";
} | {
    readonly state: "current";
    readonly approval: Approval;
} | {
    readonly state: "stale";
    readonly approval: Approval;
    readonly expectedHash: string;
} | {
    readonly state: "unresolvable";
    readonly reason: string;
};
/**
 * Report whether the most recent approval for a decision still describes the
 * contract's current resolved content.
 *
 * History is never rewritten: a superseded approval remains in `approvals` and
 * is simply reported as `stale`.
 */
export declare function approvalState(contract: ProjectContract, decisionId: string): ApprovalState;
/** True when a current, matching approval exists for the decision. */
export declare function isApprovalCurrent(contract: ProjectContract, decisionId: string): boolean;
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
export declare function appendApproval(contract: ProjectContract, input: AppendApprovalInput): ContractResult<ProjectContract>;
//# sourceMappingURL=approval.d.ts.map