import { z } from "zod/v4";
/**
 * The shape a workload must produce. `json_schema` carries a path to the
 * schema document; the other kinds are self-describing.
 */
export declare const OutputContractSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"json_schema">;
    ref: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"ranked_document_refs">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"cited_text">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"plain_text">;
}, z.core.$strict>], "kind">;
export type OutputContract = z.infer<typeof OutputContractSchema>;
/**
 * How the usage figures were arrived at. This is the difference between a
 * planning assumption and a measurement, and it is never inferred silently.
 */
export declare const UsageBasisSchema: z.ZodEnum<{
    vendor_claim: "vendor_claim";
    agent_inference: "agent_inference";
    user_assumption: "user_assumption";
    measured: "measured";
}>;
export declare const ExpectedUsageSchema: z.ZodObject<{
    basis: z.ZodEnum<{
        vendor_claim: "vendor_claim";
        agent_inference: "agent_inference";
        user_assumption: "user_assumption";
        measured: "measured";
    }>;
    calls_per_month: z.ZodNumber;
    input_tokens_per_call: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    output_tokens_per_call: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    reasoning_tokens_per_call: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
}, z.core.$strict>;
export type ExpectedUsage = z.infer<typeof ExpectedUsageSchema>;
export declare const LatencyPercentileSchema: z.ZodEnum<{
    p50: "p50";
    p90: "p90";
    p95: "p95";
    p99: "p99";
}>;
export declare const LatencyRequirementSchema: z.ZodObject<{
    percentile: z.ZodEnum<{
        p50: "p50";
        p90: "p90";
        p95: "p95";
        p99: "p99";
    }>;
    maximum_ms: z.ZodNumber;
}, z.core.$strict>;
export type LatencyRequirement = z.infer<typeof LatencyRequirementSchema>;
/**
 * A workload-specific quality gate. `evaluation_ref` names the evaluation
 * manifest expected to produce the evidence. It is deliberately a soft
 * reference: an unproduced evaluation is an evidence gap, not a broken
 * contract, and an absent result yields `unknown` rather than `pass`.
 */
export declare const QualityGateSchema: z.ZodObject<{
    metric: z.ZodString;
    minimum: z.ZodNumber;
    evaluation_ref: z.ZodString;
}, z.core.$strict>;
export type QualityGate = z.infer<typeof QualityGateSchema>;
export declare const FallbackSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        queue: "queue";
        degrade: "degrade";
        human_handoff: "human_handoff";
        fail_closed: "fail_closed";
    }>;
    description: z.ZodString;
}, z.core.$strict>;
/**
 * The workload is the primary unit of model and deployment choice. There is
 * deliberately no global "best model" field anywhere in this contract.
 */
export declare const WorkloadSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    input_classification: z.ZodString;
    output_contract: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"json_schema">;
        ref: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"ranked_document_refs">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"cited_text">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"plain_text">;
    }, z.core.$strict>], "kind">;
    expected_usage: z.ZodObject<{
        basis: z.ZodEnum<{
            vendor_claim: "vendor_claim";
            agent_inference: "agent_inference";
            user_assumption: "user_assumption";
            measured: "measured";
        }>;
        calls_per_month: z.ZodNumber;
        input_tokens_per_call: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        output_tokens_per_call: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        reasoning_tokens_per_call: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    }, z.core.$strict>;
    latency: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        percentile: z.ZodEnum<{
            p50: "p50";
            p90: "p90";
            p95: "p95";
            p99: "p99";
        }>;
        maximum_ms: z.ZodNumber;
    }, z.core.$strict>>>;
    quality_gates: z.ZodDefault<z.ZodArray<z.ZodObject<{
        metric: z.ZodString;
        minimum: z.ZodNumber;
        evaluation_ref: z.ZodString;
    }, z.core.$strict>>>;
    fallback: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        kind: z.ZodEnum<{
            queue: "queue";
            degrade: "degrade";
            human_handoff: "human_handoff";
            fail_closed: "fail_closed";
        }>;
        description: z.ZodString;
    }, z.core.$strict>>>;
    current_decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type Workload = z.infer<typeof WorkloadSchema>;
//# sourceMappingURL=workloads.d.ts.map