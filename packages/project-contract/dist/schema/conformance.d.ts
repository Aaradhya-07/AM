import { z } from "zod/v4";
export declare const RuleSeveritySchema: z.ZodEnum<{
    error: "error";
    warning: "warning";
}>;
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>;
/**
 * Forbid data of a classification from reaching a trust boundary, optionally
 * unless it passes through a declared sanitizer. This is the rule that
 * expresses "raw tickets must never leave the local trust boundary".
 */
export declare const ForbidDataflowRuleSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodLiteral<"forbid_dataflow">;
    severity: z.ZodEnum<{
        error: "error";
        warning: "warning";
    }>;
    constraint_ref: z.ZodString;
    from: z.ZodObject<{
        data_classification: z.ZodString;
    }, z.core.$strict>;
    to: z.ZodObject<{
        trust_boundary: z.ZodEnum<{
            local: "local";
            internal_network: "internal_network";
            remote_provider: "remote_provider";
            third_party: "third_party";
        }>;
    }, z.core.$strict>;
    unless: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        passes_through: z.ZodArray<z.ZodObject<{
            component_ref: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** Only the approved candidate for a workload may be implemented. */
export declare const ApprovedCandidateOnlyRuleSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodLiteral<"approved_candidate_only">;
    severity: z.ZodEnum<{
        error: "error";
        warning: "warning";
    }>;
    workload_ref: z.ZodString;
    approved_decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
/** Only listed candidates may serve a workload. */
export declare const ProviderAllowlistRuleSchema: z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodLiteral<"provider_allowlist">;
    severity: z.ZodEnum<{
        error: "error";
        warning: "warning";
    }>;
    workload_ref: z.ZodString;
    allowed_candidate_refs: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const ConformanceRuleSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodLiteral<"forbid_dataflow">;
    severity: z.ZodEnum<{
        error: "error";
        warning: "warning";
    }>;
    constraint_ref: z.ZodString;
    from: z.ZodObject<{
        data_classification: z.ZodString;
    }, z.core.$strict>;
    to: z.ZodObject<{
        trust_boundary: z.ZodEnum<{
            local: "local";
            internal_network: "internal_network";
            remote_provider: "remote_provider";
            third_party: "third_party";
        }>;
    }, z.core.$strict>;
    unless: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        passes_through: z.ZodArray<z.ZodObject<{
            component_ref: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodLiteral<"approved_candidate_only">;
    severity: z.ZodEnum<{
        error: "error";
        warning: "warning";
    }>;
    workload_ref: z.ZodString;
    approved_decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    kind: z.ZodLiteral<"provider_allowlist">;
    severity: z.ZodEnum<{
        error: "error";
        warning: "warning";
    }>;
    workload_ref: z.ZodString;
    allowed_candidate_refs: z.ZodArray<z.ZodString>;
}, z.core.$strict>], "kind">;
export type ConformanceRule = z.infer<typeof ConformanceRuleSchema>;
//# sourceMappingURL=conformance.d.ts.map