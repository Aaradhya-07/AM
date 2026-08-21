import type { ContractIssue } from "../errors.js";
import type { ProjectContract } from "../schema/contract.js";
/** The named collections a reference can point into. */
export type SubjectType = "constraint" | "workload" | "hardware" | "candidate" | "evidence" | "decision" | "architecture_node" | "architecture_relationship" | "repository_binding" | "conformance_rule" | "integration" | "outcome";
interface Index {
    readonly tables: Readonly<Record<SubjectType, ReadonlyMap<string, unknown>>>;
    /** Every id in the contract, with the collections it appears in. */
    readonly global: ReadonlyMap<string, readonly SubjectType[]>;
    readonly dataClassifications: ReadonlySet<string>;
}
declare function buildIndex(contract: ProjectContract): {
    index: Index;
    issues: ContractIssue[];
};
interface RefCheck {
    readonly path: string;
    readonly value: string;
    readonly expected: SubjectType;
    readonly label: string;
}
declare function checkRef(index: Index, check: RefCheck): ContractIssue | null;
declare function checkIntegrityInner(contract: ProjectContract, index: Index): ContractIssue[];
/**
 * Run every referential-integrity and cross-field invariant over a
 * schema-valid contract. Issues are returned rather than thrown so that a
 * caller sees ALL problems at once instead of only the first.
 */
export declare function checkIntegrity(contract: ProjectContract): ContractIssue[];
export { buildIndex, checkIntegrityInner, checkRef };
export type { Index, RefCheck };
//# sourceMappingURL=integrity.d.ts.map