import type { ContractResult } from "./errors.js";
import type { Candidate, ConstraintResult } from "./schema/candidates.js";
import type { ProjectContract } from "./schema/contract.js";
import type { Decision } from "./schema/decisions.js";
import type { EvidenceRecord } from "./schema/evidence.js";
/**
 * The exact content an approval covers, assembled from live contract state.
 *
 * Only these four groups are approval content. Project presentation such as
 * `project.name`, `project.updated_at`, or a decision's rationale prose is
 * deliberately excluded: editing a label must not invalidate a human approval,
 * and it must not silently make a stale approval look current either.
 */
export interface ResolvedApprovalContent {
    readonly decision_id: string;
    readonly decision_revision: number;
    readonly selected_candidate: Candidate;
    /**
     * Every evidence record the approval relies on, in a deterministic id order.
     *
     * This is the UNION of the decision's own `evidence_refs` and the evidence
     * cited by each approved constraint result. Relying on the decision list
     * alone would let a caller who forgot to duplicate an id approve content
     * whose supporting evidence could then be edited without invalidating the
     * approval.
     */
    readonly cited_evidence: readonly EvidenceRecord[];
    /** The constraint results being approved, in a deterministic order. */
    readonly constraint_results: readonly ConstraintResult[];
}
export interface ResolvedDecision {
    readonly decision: Decision;
    readonly content: ResolvedApprovalContent;
}
/**
 * Resolve everything an approval of `decisionId` would cover.
 *
 * Missing referenced content prevents resolution: a decision cannot be
 * approved when its selected candidate, one of its cited evidence records, or
 * a constraint result it claims to satisfy cannot be found.
 */
export declare function resolveDecision(contract: ProjectContract, decisionId: string): ContractResult<ResolvedDecision>;
//# sourceMappingURL=resolve.d.ts.map