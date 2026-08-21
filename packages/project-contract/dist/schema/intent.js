import { z } from "zod/v4";
import { IdSchema, NonEmptyStringSchema } from "./primitives.js";
export const OutcomeTargetSchema = z.strictObject({
    id: IdSchema,
    measure: NonEmptyStringSchema,
    /** Expressed as authored, e.g. `<= 8 minutes`. Not machine-evaluated yet. */
    target: NonEmptyStringSchema,
});
export const IntentSchema = z.strictObject({
    summary: NonEmptyStringSchema,
    users: z.array(NonEmptyStringSchema).default([]),
    outcomes: z.array(OutcomeTargetSchema).default([]),
    non_goals: z.array(NonEmptyStringSchema).default([]),
    /**
     * Honest unknowns. The contract preserves open questions rather than
     * letting an intelligence adapter invent an answer.
     */
    unresolved_questions: z.array(NonEmptyStringSchema).default([]),
});
