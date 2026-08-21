import type { ProjectContract } from "./schema/contract.js";
import type { EvidenceTier } from "./schema/evidence.js";
export interface EvidenceGap {
    /** What is missing evidence, e.g. a workload quality gate or a hard constraint. */
    readonly subject: string;
    readonly path: string;
    readonly reason: string;
    /** The tier that would be needed to close the gap, when one is ratified. */
    readonly requiredFloor: EvidenceTier | null;
}
/**
 * Report where the contract honestly lacks evidence.
 *
 * A gap is not an error. A quality gate whose evaluation has not been run yet
 * is the expected state of a draft contract; what matters is that the gap is
 * visible and that the missing evidence yields `unknown` rather than `pass`.
 */
export declare function listEvidenceGaps(contract: ProjectContract): readonly EvidenceGap[];
//# sourceMappingURL=gaps.d.ts.map