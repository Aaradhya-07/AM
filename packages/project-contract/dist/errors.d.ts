/**
 * Structured, actionable validation errors.
 *
 * Every issue carries a stable machine-readable `code`, the `path` of the
 * offending subject, and a human-readable `message`. Codes are part of the
 * package's public surface: consumers may branch on them.
 */
export declare const ISSUE_CODES: readonly ["yaml_syntax_error", "json_syntax_error", "document_not_an_object", "schema_violation", "unknown_field", "missing_field", "duplicate_id", "reference_not_found", "reference_wrong_type", "candidate_workload_mismatch", "decision_scope_invalid", "constraint_subject_unresolved", "evidence_floor_below_ratified_baseline", "pass_below_evidence_floor", "estimate_presented_as_measurement", "evidence_not_applicable", "estimate_missing_basis", "model_version_unpinned", "secret_value_detected", "approval_content_unresolved", "approval_hash_mismatch", "approval_history_not_append_only", "remote_policy_conflict", "remote_policy_denied_field_allowed", "unsupported_schema_version"];
export type IssueCode = (typeof ISSUE_CODES)[number];
export interface ContractIssue {
    /** Stable machine-readable identifier for this class of problem. */
    readonly code: IssueCode;
    /** Dotted/indexed path to the offending subject, e.g. `decisions[0].scope`. */
    readonly path: string;
    /** Human-readable explanation of what is wrong and what is expected. */
    readonly message: string;
    /** Optional structured context (expected type, observed value, and so on). */
    readonly details?: Readonly<Record<string, unknown>>;
}
export declare function issue(code: IssueCode, path: string, message: string, details?: Readonly<Record<string, unknown>>): ContractIssue;
/** Discriminated result carried by every fallible entry point. */
export type ContractResult<T> = {
    readonly ok: true;
    readonly value: T;
    readonly issues: readonly [];
} | {
    readonly ok: false;
    readonly issues: readonly ContractIssue[];
};
export declare function ok<T>(value: T): ContractResult<T>;
export declare function fail<T>(issues: readonly ContractIssue[]): ContractResult<T>;
/** Thrown by the `*OrThrow` convenience wrappers. */
export declare class ContractValidationError extends Error {
    readonly issues: readonly ContractIssue[];
    constructor(issues: readonly ContractIssue[]);
}
export declare function unwrap<T>(result: ContractResult<T>): T;
/** Sort issues into a stable order so error output is deterministic. */
export declare function sortIssues(issues: readonly ContractIssue[]): readonly ContractIssue[];
//# sourceMappingURL=errors.d.ts.map