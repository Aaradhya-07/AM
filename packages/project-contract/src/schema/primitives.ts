import { z } from "zod/v4";

/**
 * Identifiers are stable, human-authorable, and safe in file names, YAML keys,
 * Mermaid/CALM exports, and CLI arguments. Dots and dashes are permitted
 * because the ratified fixtures use namespaced ids such as
 * `candidate.classification.local_unselected` and `ticket-intake`.
 */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const IdSchema = z
  .string()
  .min(1, "an id must not be empty")
  .max(200, "an id must be at most 200 characters")
  .regex(
    ID_PATTERN,
    "an id must start alphanumerically and contain only letters, digits, '.', '_' or '-'",
  );

export type Id = z.infer<typeof IdSchema>;

/** A reference to another subject in this contract. Same lexical shape as an id. */
export const RefSchema = IdSchema;

/** ISO-8601 timestamp with an explicit offset, e.g. `2026-08-17T00:00:00Z`. */
export const TimestampSchema = z.iso.datetime({ offset: true });

export const NonEmptyStringSchema = z.string().min(1);

/** A repository-relative or project-relative path. Never an absolute local path. */
export const RelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), {
    message:
      "paths in a portable contract must be relative; absolute local paths are machine-identifying",
  })
  .refine((value) => !/^[A-Za-z]:[\\/]/.test(value), {
    message:
      "paths in a portable contract must be relative; drive-qualified paths are machine-identifying",
  });

/**
 * A free-form data-classification label such as `raw_customer_ticket`.
 * Labels are project-defined vocabulary, not a fixed enum, but they must be
 * used consistently: referential integrity checks that every label referenced
 * by a constraint or conformance rule is actually declared somewhere.
 */
export const DataClassificationSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9_]*$/,
    "a data classification must be lower_snake_case",
  );

/** Outcome of evaluating one constraint against available evidence. */
export const OutcomeSchema = z.enum([
  "pass",
  "fail",
  "unknown",
  "not_applicable",
]);

export type Outcome = z.infer<typeof OutcomeSchema>;

/** Whether a claim was established deterministically or inferred. */
export const DeterminismSchema = z.enum(["deterministic", "inferred"]);

export type Determinism = z.infer<typeof DeterminismSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);

export type Confidence = z.infer<typeof ConfidenceSchema>;
