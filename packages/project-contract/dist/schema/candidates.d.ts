import { z } from "zod/v4";
export declare const ComponentKindSchema: z.ZodEnum<{
    model_runtime: "model_runtime";
    embedding_model: "embedding_model";
    vector_store: "vector_store";
    retrieval_service: "retrieval_service";
    sanitizer: "sanitizer";
    gateway: "gateway";
    infrastructure: "infrastructure";
}>;
export type ComponentKind = z.infer<typeof ComponentKindSchema>;
/**
 * Whether the model identifier pins an exact artifact. Doc 03 invariant 4
 * requires an exact version or an explicit mutability warning, so a null
 * version is only accepted when the author declares the reference floating.
 */
export declare const VersionMutabilitySchema: z.ZodEnum<{
    pinned: "pinned";
    floating: "floating";
}>;
export declare const ModelSchema: z.ZodObject<{
    family: z.ZodString;
    version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    version_mutability: z.ZodDefault<z.ZodEnum<{
        pinned: "pinned";
        floating: "floating";
    }>>;
    quantization: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    license_evidence_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type Model = z.infer<typeof ModelSchema>;
/**
 * Deployment mode. Provider and runtime names are free strings on purpose:
 * enumerating them here would couple the core schema to a fixed vendor list.
 */
export declare const DeploymentSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    mode: z.ZodLiteral<"local">;
    runtime: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>, z.ZodObject<{
    mode: z.ZodLiteral<"managed_api">;
    provider: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    region: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>, z.ZodObject<{
    mode: z.ZodLiteral<"self_hosted">;
    provider: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    region: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    runtime: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>], "mode">;
export type Deployment = z.infer<typeof DeploymentSchema>;
/**
 * Pointers to evidence records that MEASURED this candidate. Every reference
 * here must resolve to a real evidence record: claiming a measurement whose
 * record does not exist is exactly the failure mode the contract must catch.
 */
export declare const MeasurementsSchema: z.ZodObject<{
    quality_result_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    hardware_fit_evidence_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    latency_measurement_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    token_measurement_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    cost_measurement_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export type Measurements = z.infer<typeof MeasurementsSchema>;
/** Projected values. Every estimate must record what it was derived from. */
export declare const EstimatesSchema: z.ZodObject<{
    tokens_per_call: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    latency_p95_ms: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    monthly_effective_cost_usd: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
    basis: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    assumptions: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type Estimates = z.infer<typeof EstimatesSchema>;
/**
 * The recorded outcome of one constraint against this candidate. `status` is
 * an assertion made by whoever wrote it; validation independently re-checks
 * that a `pass` is backed by evidence at or above the ratified floor.
 */
export declare const ConstraintResultSchema: z.ZodObject<{
    constraint_ref: z.ZodString;
    status: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
        unknown: "unknown";
        not_applicable: "not_applicable";
    }>;
    evidence_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    determinism: z.ZodDefault<z.ZodEnum<{
        deterministic: "deterministic";
        inferred: "inferred";
    }>>;
    explanation: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    evaluated_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
}, z.core.$strict>;
export type ConstraintResult = z.infer<typeof ConstraintResultSchema>;
export declare const CandidateStatusSchema: z.ZodEnum<{
    discovered: "discovered";
    incompatible: "incompatible";
    unevaluated: "unevaluated";
    viable: "viable";
    proposed: "proposed";
    selected: "selected";
    rejected: "rejected";
    unavailable: "unavailable";
}>;
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;
/** One way to execute one workload or provide one component. */
export declare const CandidateSchema: z.ZodObject<{
    id: z.ZodString;
    workload_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    component_kind: z.ZodEnum<{
        model_runtime: "model_runtime";
        embedding_model: "embedding_model";
        vector_store: "vector_store";
        retrieval_service: "retrieval_service";
        sanitizer: "sanitizer";
        gateway: "gateway";
        infrastructure: "infrastructure";
    }>;
    model: z.ZodDefault<z.ZodNullable<z.ZodObject<{
        family: z.ZodString;
        version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        version_mutability: z.ZodDefault<z.ZodEnum<{
            pinned: "pinned";
            floating: "floating";
        }>>;
        quantization: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        license_evidence_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>>>;
    deployment: z.ZodDiscriminatedUnion<[z.ZodObject<{
        mode: z.ZodLiteral<"local">;
        runtime: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>, z.ZodObject<{
        mode: z.ZodLiteral<"managed_api">;
        provider: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        region: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>, z.ZodObject<{
        mode: z.ZodLiteral<"self_hosted">;
        provider: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        region: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        runtime: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>], "mode">;
    measurements: z.ZodPrefault<z.ZodObject<{
        quality_result_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        hardware_fit_evidence_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        latency_measurement_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        token_measurement_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        cost_measurement_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>>;
    estimates: z.ZodPrefault<z.ZodObject<{
        tokens_per_call: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        latency_p95_ms: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        monthly_effective_cost_usd: z.ZodDefault<z.ZodNullable<z.ZodNumber>>;
        basis: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        assumptions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    constraint_results: z.ZodDefault<z.ZodArray<z.ZodObject<{
        constraint_ref: z.ZodString;
        status: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
            unknown: "unknown";
            not_applicable: "not_applicable";
        }>;
        evidence_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
        determinism: z.ZodDefault<z.ZodEnum<{
            deterministic: "deterministic";
            inferred: "inferred";
        }>>;
        explanation: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        evaluated_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>>>;
    status: z.ZodEnum<{
        discovered: "discovered";
        incompatible: "incompatible";
        unevaluated: "unevaluated";
        viable: "viable";
        proposed: "proposed";
        selected: "selected";
        rejected: "rejected";
        unavailable: "unavailable";
    }>;
}, z.core.$strict>;
export type Candidate = z.infer<typeof CandidateSchema>;
//# sourceMappingURL=candidates.d.ts.map