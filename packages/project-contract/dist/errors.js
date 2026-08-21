/**
 * Structured, actionable validation errors.
 *
 * Every issue carries a stable machine-readable `code`, the `path` of the
 * offending subject, and a human-readable `message`. Codes are part of the
 * package's public surface: consumers may branch on them.
 */
import { compareCodeUnits } from "./canonical.js";
export const ISSUE_CODES = [
    /** The document could not be parsed as YAML. */
    "yaml_syntax_error",
    /** The document could not be parsed as JSON. */
    "json_syntax_error",
    /** The document parsed but is not a mapping/object at the root. */
    "document_not_an_object",
    /** A field violated its schema (type, format, enum, range). */
    "schema_violation",
    /** A field not declared by the draft schema was present. */
    "unknown_field",
    /** A required field was absent. */
    "missing_field",
    /** Two entries in one collection share an id. */
    "duplicate_id",
    /** A reference did not resolve to any declared subject. */
    "reference_not_found",
    /** A reference resolved, but to the wrong kind of subject. */
    "reference_wrong_type",
    /** A workload-scoped decision selected a candidate belonging to another workload. */
    "candidate_workload_mismatch",
    /** A decision scope was structurally invalid for its declared kind. */
    "decision_scope_invalid",
    /** A constraint subject path named a subject that does not exist. */
    "constraint_subject_unresolved",
    /** A declared evidence floor is weaker than the ratified baseline. */
    "evidence_floor_below_ratified_baseline",
    /** A constraint result asserts `pass` without evidence meeting the floor. */
    "pass_below_evidence_floor",
    /** A hardware-compatibility estimate was presented as a measurement. */
    "estimate_presented_as_measurement",
    /** Evidence was cited for something it does not describe. */
    "evidence_not_applicable",
    /** A candidate carries numeric estimates without recording their basis. */
    "estimate_missing_basis",
    /** A selected model lacks an exact version and no mutability warning was given. */
    "model_version_unpinned",
    /** A value that looks like a real secret was found in a persistent field. */
    "secret_value_detected",
    /** An approval references content that cannot be resolved. */
    "approval_content_unresolved",
    /** A stored approval hash does not match its resolved content. */
    "approval_hash_mismatch",
    /** Approval history was reordered or rewritten rather than appended to. */
    "approval_history_not_append_only",
    /** A field appears in both the remote allow and deny lists. */
    "remote_policy_conflict",
    /** A ratified default-deny field was placed in the remote allow list. */
    "remote_policy_denied_field_allowed",
    /** The document declared a schema version this package cannot read. */
    "unsupported_schema_version",
];
export function issue(code, path, message, details) {
    return details === undefined
        ? { code, path, message }
        : { code, path, message, details };
}
export function ok(value) {
    return { ok: true, value, issues: [] };
}
export function fail(issues) {
    return { ok: false, issues };
}
/** Thrown by the `*OrThrow` convenience wrappers. */
export class ContractValidationError extends Error {
    issues;
    constructor(issues) {
        const summary = issues
            .map((entry) => `  [${entry.code}] ${entry.path}: ${entry.message}`)
            .join("\n");
        super(`Project contract validation failed:\n${summary}`);
        this.name = "ContractValidationError";
        this.issues = issues;
    }
}
export function unwrap(result) {
    if (!result.ok) {
        throw new ContractValidationError(result.issues);
    }
    return result.value;
}
/** Sort issues into a stable order so error output is deterministic. */
export function sortIssues(issues) {
    return [...issues].sort((left, right) => compareCodeUnits(left.path, right.path) ||
        compareCodeUnits(left.code, right.code));
}
