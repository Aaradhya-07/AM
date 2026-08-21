import { z } from "zod/v4";
/**
 * Comparison and policy operators. Kept small and explicit so that constraint
 * evaluation stays deterministic rather than interpreting free text.
 */
export declare const ConstraintOperatorSchema: z.ZodEnum<{
    in: "in";
    lte: "lte";
    gte: "gte";
    lt: "lt";
    gt: "gt";
    eq: "eq";
    neq: "neq";
    not_in: "not_in";
    must_not_leave: "must_not_leave";
    must_remain_available_without: "must_remain_available_without";
    must_pass_through: "must_pass_through";
}>;
export type ConstraintOperator = z.infer<typeof ConstraintOperatorSchema>;
export declare const ConstraintValueSchema: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
export declare const ConstraintSourceSchema: z.ZodEnum<{
    user: "user";
    derived: "derived";
    agent_proposed: "agent_proposed";
}>;
/**
 * Direction for soft constraints. A soft constraint is a comparison input,
 * never a gate: `minimize` and `maximize` express preference, `target`
 * expresses a value to sit near.
 */
export declare const SoftDirectionSchema: z.ZodEnum<{
    minimize: "minimize";
    maximize: "maximize";
    target: "target";
}>;
export type SoftDirection = z.infer<typeof SoftDirectionSchema>;
/**
 * A recorded exception to a hard constraint. Doc 03 section 6 requires an
 * exception to name the approving actor, the reason, and an expiry or review
 * date so that exceptions cannot quietly become permanent.
 */
export declare const ConstraintExceptionSchema: z.ZodObject<{
    id: z.ZodString;
    reason: z.ZodString;
    decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    approved_by: z.ZodString;
    expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    review_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
}, z.core.$strict>;
export type ConstraintException = z.infer<typeof ConstraintExceptionSchema>;
/**
 * A violating candidate cannot be approved without an explicit exception, and
 * satisfying a hard constraint requires evidence at or above its ratified
 * floor. Hard constraints carry no direction: they are gates, not preferences.
 */
export declare const HardConstraintSchema: z.ZodObject<{
    severity: z.ZodLiteral<"hard">;
    id: z.ZodString;
    domain: z.ZodEnum<{
        functionality: "functionality";
        quality: "quality";
        cost: "cost";
        tokens: "tokens";
        latency: "latency";
        throughput: "throughput";
        privacy: "privacy";
        residency: "residency";
        provider_policy: "provider_policy";
        licensing: "licensing";
        hardware: "hardware";
        availability: "availability";
        operability: "operability";
        repository_policy: "repository_policy";
    }>;
    subject: z.ZodString;
    operator: z.ZodEnum<{
        in: "in";
        lte: "lte";
        gte: "gte";
        lt: "lt";
        gt: "gt";
        eq: "eq";
        neq: "neq";
        not_in: "not_in";
        must_not_leave: "must_not_leave";
        must_remain_available_without: "must_remain_available_without";
        must_pass_through: "must_pass_through";
    }>;
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
    source: z.ZodEnum<{
        user: "user";
        derived: "derived";
        agent_proposed: "agent_proposed";
    }>;
    rationale: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    condition: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    exceptions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        reason: z.ZodString;
        decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        approved_by: z.ZodString;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
        review_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** Contributes to comparison through its direction; may be traded off. */
export declare const SoftConstraintSchema: z.ZodObject<{
    severity: z.ZodLiteral<"soft">;
    direction: z.ZodEnum<{
        minimize: "minimize";
        maximize: "maximize";
        target: "target";
    }>;
    id: z.ZodString;
    domain: z.ZodEnum<{
        functionality: "functionality";
        quality: "quality";
        cost: "cost";
        tokens: "tokens";
        latency: "latency";
        throughput: "throughput";
        privacy: "privacy";
        residency: "residency";
        provider_policy: "provider_policy";
        licensing: "licensing";
        hardware: "hardware";
        availability: "availability";
        operability: "operability";
        repository_policy: "repository_policy";
    }>;
    subject: z.ZodString;
    operator: z.ZodEnum<{
        in: "in";
        lte: "lte";
        gte: "gte";
        lt: "lt";
        gt: "gt";
        eq: "eq";
        neq: "neq";
        not_in: "not_in";
        must_not_leave: "must_not_leave";
        must_remain_available_without: "must_remain_available_without";
        must_pass_through: "must_pass_through";
    }>;
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
    source: z.ZodEnum<{
        user: "user";
        derived: "derived";
        agent_proposed: "agent_proposed";
    }>;
    rationale: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    condition: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    exceptions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        reason: z.ZodString;
        decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        approved_by: z.ZodString;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
        review_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** Recorded but not scored. */
export declare const InformationalConstraintSchema: z.ZodObject<{
    severity: z.ZodLiteral<"informational">;
    id: z.ZodString;
    domain: z.ZodEnum<{
        functionality: "functionality";
        quality: "quality";
        cost: "cost";
        tokens: "tokens";
        latency: "latency";
        throughput: "throughput";
        privacy: "privacy";
        residency: "residency";
        provider_policy: "provider_policy";
        licensing: "licensing";
        hardware: "hardware";
        availability: "availability";
        operability: "operability";
        repository_policy: "repository_policy";
    }>;
    subject: z.ZodString;
    operator: z.ZodEnum<{
        in: "in";
        lte: "lte";
        gte: "gte";
        lt: "lt";
        gt: "gt";
        eq: "eq";
        neq: "neq";
        not_in: "not_in";
        must_not_leave: "must_not_leave";
        must_remain_available_without: "must_remain_available_without";
        must_pass_through: "must_pass_through";
    }>;
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
    source: z.ZodEnum<{
        user: "user";
        derived: "derived";
        agent_proposed: "agent_proposed";
    }>;
    rationale: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    condition: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    exceptions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        reason: z.ZodString;
        decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        approved_by: z.ZodString;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
        review_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export declare const ConstraintSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    severity: z.ZodLiteral<"hard">;
    id: z.ZodString;
    domain: z.ZodEnum<{
        functionality: "functionality";
        quality: "quality";
        cost: "cost";
        tokens: "tokens";
        latency: "latency";
        throughput: "throughput";
        privacy: "privacy";
        residency: "residency";
        provider_policy: "provider_policy";
        licensing: "licensing";
        hardware: "hardware";
        availability: "availability";
        operability: "operability";
        repository_policy: "repository_policy";
    }>;
    subject: z.ZodString;
    operator: z.ZodEnum<{
        in: "in";
        lte: "lte";
        gte: "gte";
        lt: "lt";
        gt: "gt";
        eq: "eq";
        neq: "neq";
        not_in: "not_in";
        must_not_leave: "must_not_leave";
        must_remain_available_without: "must_remain_available_without";
        must_pass_through: "must_pass_through";
    }>;
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
    source: z.ZodEnum<{
        user: "user";
        derived: "derived";
        agent_proposed: "agent_proposed";
    }>;
    rationale: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    condition: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    exceptions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        reason: z.ZodString;
        decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        approved_by: z.ZodString;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
        review_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>>>;
}, z.core.$strict>, z.ZodObject<{
    severity: z.ZodLiteral<"soft">;
    direction: z.ZodEnum<{
        minimize: "minimize";
        maximize: "maximize";
        target: "target";
    }>;
    id: z.ZodString;
    domain: z.ZodEnum<{
        functionality: "functionality";
        quality: "quality";
        cost: "cost";
        tokens: "tokens";
        latency: "latency";
        throughput: "throughput";
        privacy: "privacy";
        residency: "residency";
        provider_policy: "provider_policy";
        licensing: "licensing";
        hardware: "hardware";
        availability: "availability";
        operability: "operability";
        repository_policy: "repository_policy";
    }>;
    subject: z.ZodString;
    operator: z.ZodEnum<{
        in: "in";
        lte: "lte";
        gte: "gte";
        lt: "lt";
        gt: "gt";
        eq: "eq";
        neq: "neq";
        not_in: "not_in";
        must_not_leave: "must_not_leave";
        must_remain_available_without: "must_remain_available_without";
        must_pass_through: "must_pass_through";
    }>;
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
    source: z.ZodEnum<{
        user: "user";
        derived: "derived";
        agent_proposed: "agent_proposed";
    }>;
    rationale: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    condition: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    exceptions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        reason: z.ZodString;
        decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        approved_by: z.ZodString;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
        review_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>>>;
}, z.core.$strict>, z.ZodObject<{
    severity: z.ZodLiteral<"informational">;
    id: z.ZodString;
    domain: z.ZodEnum<{
        functionality: "functionality";
        quality: "quality";
        cost: "cost";
        tokens: "tokens";
        latency: "latency";
        throughput: "throughput";
        privacy: "privacy";
        residency: "residency";
        provider_policy: "provider_policy";
        licensing: "licensing";
        hardware: "hardware";
        availability: "availability";
        operability: "operability";
        repository_policy: "repository_policy";
    }>;
    subject: z.ZodString;
    operator: z.ZodEnum<{
        in: "in";
        lte: "lte";
        gte: "gte";
        lt: "lt";
        gt: "gt";
        eq: "eq";
        neq: "neq";
        not_in: "not_in";
        must_not_leave: "must_not_leave";
        must_remain_available_without: "must_remain_available_without";
        must_pass_through: "must_pass_through";
    }>;
    value: z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<readonly [z.ZodString, z.ZodNumber]>>]>;
    source: z.ZodEnum<{
        user: "user";
        derived: "derived";
        agent_proposed: "agent_proposed";
    }>;
    rationale: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    condition: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    exceptions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        reason: z.ZodString;
        decision_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        approved_by: z.ZodString;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
        review_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>>>;
}, z.core.$strict>], "severity">;
export type Constraint = z.infer<typeof ConstraintSchema>;
export type HardConstraint = z.infer<typeof HardConstraintSchema>;
export type SoftConstraint = z.infer<typeof SoftConstraintSchema>;
//# sourceMappingURL=constraints.d.ts.map