import { z } from "zod/v4";
import { ConstraintDomainSchema } from "./project.js";
import { IdSchema, NonEmptyStringSchema, RefSchema, TimestampSchema, } from "./primitives.js";
/**
 * Comparison and policy operators. Kept small and explicit so that constraint
 * evaluation stays deterministic rather than interpreting free text.
 */
export const ConstraintOperatorSchema = z.enum([
    "lte",
    "gte",
    "lt",
    "gt",
    "eq",
    "neq",
    "in",
    "not_in",
    "must_not_leave",
    "must_remain_available_without",
    "must_pass_through",
]);
export const ConstraintValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
]);
export const ConstraintSourceSchema = z.enum([
    "user",
    "derived",
    "agent_proposed",
]);
/**
 * Direction for soft constraints. A soft constraint is a comparison input,
 * never a gate: `minimize` and `maximize` express preference, `target`
 * expresses a value to sit near.
 */
export const SoftDirectionSchema = z.enum(["minimize", "maximize", "target"]);
/**
 * A recorded exception to a hard constraint. Doc 03 section 6 requires an
 * exception to name the approving actor, the reason, and an expiry or review
 * date so that exceptions cannot quietly become permanent.
 */
export const ConstraintExceptionSchema = z
    .strictObject({
    id: IdSchema,
    reason: NonEmptyStringSchema,
    decision_ref: RefSchema.nullable().default(null),
    approved_by: NonEmptyStringSchema,
    expires_at: TimestampSchema.nullable().default(null),
    review_at: TimestampSchema.nullable().default(null),
})
    .refine((value) => value.expires_at !== null || value.review_at !== null, {
    message: "an exception must carry an expiry or a review date so it cannot silently become permanent",
    path: ["expires_at"],
});
const constraintBase = {
    id: IdSchema,
    domain: ConstraintDomainSchema,
    subject: NonEmptyStringSchema,
    operator: ConstraintOperatorSchema,
    value: ConstraintValueSchema,
    source: ConstraintSourceSchema,
    rationale: NonEmptyStringSchema.nullable().default(null),
    /** When the constraint applies. A separate field, never a new severity. */
    condition: NonEmptyStringSchema.nullable().default(null),
    /** Exceptions are a separate field, never a new severity. */
    exceptions: z.array(ConstraintExceptionSchema).default([]),
};
/**
 * A violating candidate cannot be approved without an explicit exception, and
 * satisfying a hard constraint requires evidence at or above its ratified
 * floor. Hard constraints carry no direction: they are gates, not preferences.
 */
export const HardConstraintSchema = z.strictObject({
    ...constraintBase,
    severity: z.literal("hard"),
});
/** Contributes to comparison through its direction; may be traded off. */
export const SoftConstraintSchema = z.strictObject({
    ...constraintBase,
    severity: z.literal("soft"),
    direction: SoftDirectionSchema,
});
/** Recorded but not scored. */
export const InformationalConstraintSchema = z.strictObject({
    ...constraintBase,
    severity: z.literal("informational"),
});
export const ConstraintSchema = z.discriminatedUnion("severity", [
    HardConstraintSchema,
    SoftConstraintSchema,
    InformationalConstraintSchema,
]);
