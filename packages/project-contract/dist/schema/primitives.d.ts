import { z } from "zod/v4";
/**
 * Identifiers are stable, human-authorable, and safe in file names, YAML keys,
 * Mermaid/CALM exports, and CLI arguments. Dots and dashes are permitted
 * because the ratified fixtures use namespaced ids such as
 * `candidate.classification.local_unselected` and `ticket-intake`.
 */
export declare const ID_PATTERN: RegExp;
export declare const IdSchema: z.ZodString;
export type Id = z.infer<typeof IdSchema>;
/** A reference to another subject in this contract. Same lexical shape as an id. */
export declare const RefSchema: z.ZodString;
/** ISO-8601 timestamp with an explicit offset, e.g. `2026-08-17T00:00:00Z`. */
export declare const TimestampSchema: z.ZodISODateTime;
export declare const NonEmptyStringSchema: z.ZodString;
/** A repository-relative or project-relative path. Never an absolute local path. */
export declare const RelativePathSchema: z.ZodString;
/**
 * A free-form data-classification label such as `raw_customer_ticket`.
 * Labels are project-defined vocabulary, not a fixed enum, but they must be
 * used consistently: referential integrity checks that every label referenced
 * by a constraint or conformance rule is actually declared somewhere.
 */
export declare const DataClassificationSchema: z.ZodString;
/** Outcome of evaluating one constraint against available evidence. */
export declare const OutcomeSchema: z.ZodEnum<{
    pass: "pass";
    fail: "fail";
    unknown: "unknown";
    not_applicable: "not_applicable";
}>;
export type Outcome = z.infer<typeof OutcomeSchema>;
/** Whether a claim was established deterministically or inferred. */
export declare const DeterminismSchema: z.ZodEnum<{
    deterministic: "deterministic";
    inferred: "inferred";
}>;
export type Determinism = z.infer<typeof DeterminismSchema>;
export declare const ConfidenceSchema: z.ZodEnum<{
    high: "high";
    medium: "medium";
    low: "low";
}>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
//# sourceMappingURL=primitives.d.ts.map