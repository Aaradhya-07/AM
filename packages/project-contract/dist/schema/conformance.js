import { z } from "zod/v4";
import { DataClassificationSchema, IdSchema, RefSchema } from "./primitives.js";
import { TrustBoundarySchema } from "./architecture.js";
export const RuleSeveritySchema = z.enum(["error", "warning"]);
const PassesThroughSchema = z.strictObject({
    /** An architecture node that sanitizes the data, e.g. a redactor. */
    component_ref: RefSchema,
});
/**
 * Forbid data of a classification from reaching a trust boundary, optionally
 * unless it passes through a declared sanitizer. This is the rule that
 * expresses "raw tickets must never leave the local trust boundary".
 */
export const ForbidDataflowRuleSchema = z.strictObject({
    id: IdSchema,
    kind: z.literal("forbid_dataflow"),
    severity: RuleSeveritySchema,
    constraint_ref: RefSchema,
    from: z.strictObject({ data_classification: DataClassificationSchema }),
    to: z.strictObject({ trust_boundary: TrustBoundarySchema }),
    unless: z
        .strictObject({
        passes_through: z.array(PassesThroughSchema).min(1),
    })
        .nullable()
        .default(null),
});
/** Only the approved candidate for a workload may be implemented. */
export const ApprovedCandidateOnlyRuleSchema = z.strictObject({
    id: IdSchema,
    kind: z.literal("approved_candidate_only"),
    severity: RuleSeveritySchema,
    workload_ref: RefSchema,
    /** Null until a decision for this workload has been approved. */
    approved_decision_ref: RefSchema.nullable().default(null),
});
/** Only listed candidates may serve a workload. */
export const ProviderAllowlistRuleSchema = z.strictObject({
    id: IdSchema,
    kind: z.literal("provider_allowlist"),
    severity: RuleSeveritySchema,
    workload_ref: RefSchema,
    allowed_candidate_refs: z.array(RefSchema).min(1),
});
export const ConformanceRuleSchema = z.discriminatedUnion("kind", [
    ForbidDataflowRuleSchema,
    ApprovedCandidateOnlyRuleSchema,
    ProviderAllowlistRuleSchema,
]);
