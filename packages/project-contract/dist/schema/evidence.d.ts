import { z } from "zod/v4";
/**
 * Evidence tiers, ratified in doc 06 section 6.
 *
 * T3 directly observed or measured; T2 attributable authoritative evidence;
 * T1 declared or claimed; T0 inference or absence.
 */
export declare const EvidenceTierSchema: z.ZodEnum<{
    T0: "T0";
    T1: "T1";
    T2: "T2";
    T3: "T3";
}>;
export type EvidenceTier = z.infer<typeof EvidenceTierSchema>;
/**
 * The kind of evidence determines its tier. The tier is DERIVED, never
 * author-declared: an author cannot label an agent inference as a measurement
 * to clear a gate.
 */
export declare const EvidenceKindSchema: z.ZodEnum<{
    unknown: "unknown";
    deterministic_observation: "deterministic_observation";
    measured_evaluation: "measured_evaluation";
    runtime_measurement: "runtime_measurement";
    source_code: "source_code";
    official_documentation: "official_documentation";
    official_pricing: "official_pricing";
    tool_observation: "tool_observation";
    user_declared: "user_declared";
    vendor_claim: "vendor_claim";
    agent_inference: "agent_inference";
}>;
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;
export declare const ProducerSchema: z.ZodObject<{
    name: z.ZodString;
    version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const EvidenceSourceSchema: z.ZodObject<{
    type: z.ZodEnum<{
        file: "file";
        local_command: "local_command";
        url: "url";
        api: "api";
        manual: "manual";
    }>;
    locator: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
/**
 * What this evidence is attributable to.
 *
 * Tier alone cannot decide admissibility: a runtime measurement of one
 * candidate says nothing about a different candidate, and a benchmark run on
 * a laptop says nothing about a declared RTX 4090 target. `subject` is free
 * text for humans, so these structured references are what let validation
 * check relevance deterministically.
 *
 * `constraint_refs` names the CLAIMS this artifact supports. Subject and kind
 * together are not enough: a source-code observation of logging configuration
 * is a T3 observation admissible for privacy in the abstract, and a macro-F1
 * evaluation is a T3 measurement of the right candidate and workload, but
 * neither says anything about the specific constraint it gets cited for.
 * Evidence must state which claims it supports, and an artifact that supports
 * several claims must list each one.
 *
 * Everything here is optional except that omission has consequences: evidence
 * not attributed to a candidate cannot satisfy a candidate-scoped gate, and
 * evidence not attributed to a constraint cannot satisfy that constraint. It
 * is never silently accepted as if it were.
 */
export declare const AppliesToSchema: z.ZodObject<{
    candidate_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    workload_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    constraint_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type AppliesTo = z.infer<typeof AppliesToSchema>;
export declare const RefreshSchema: z.ZodObject<{
    policy: z.ZodEnum<{
        never: "never";
        on_hardware_or_model_change: "on_hardware_or_model_change";
        on_pricing_change: "on_pricing_change";
        periodic: "periodic";
    }>;
    expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
}, z.core.$strict>;
export declare const EvidenceRecordSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"measured_evaluation">;
    value: z.ZodObject<{
        dataset_ref: z.ZodString;
        dataset_version: z.ZodString;
        candidate_ref: z.ZodString;
        configuration_hash: z.ZodString;
        metrics: z.ZodRecord<z.ZodString, z.ZodNumber>;
        result_artifact_hash: z.ZodString;
    }, z.core.$strict>;
    id: z.ZodString;
    subject: z.ZodString;
    producer: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    observed_at: z.ZodISODateTime;
    source: z.ZodObject<{
        type: z.ZodEnum<{
            file: "file";
            local_command: "local_command";
            url: "url";
            api: "api";
            manual: "manual";
        }>;
        locator: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    confidence: z.ZodEnum<{
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    caveats: z.ZodDefault<z.ZodArray<z.ZodString>>;
    refresh: z.ZodObject<{
        policy: z.ZodEnum<{
            never: "never";
            on_hardware_or_model_change: "on_hardware_or_model_change";
            on_pricing_change: "on_pricing_change";
            periodic: "periodic";
        }>;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>;
    applies_to: z.ZodPrefault<z.ZodObject<{
        candidate_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        workload_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        constraint_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"official_pricing">;
    value: z.ZodObject<{
        currency: z.ZodString;
        unit: z.ZodString;
        amount: z.ZodNumber;
        region: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        tier: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        exclusions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    id: z.ZodString;
    subject: z.ZodString;
    producer: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    observed_at: z.ZodISODateTime;
    source: z.ZodObject<{
        type: z.ZodEnum<{
            file: "file";
            local_command: "local_command";
            url: "url";
            api: "api";
            manual: "manual";
        }>;
        locator: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    confidence: z.ZodEnum<{
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    caveats: z.ZodDefault<z.ZodArray<z.ZodString>>;
    refresh: z.ZodObject<{
        policy: z.ZodEnum<{
            never: "never";
            on_hardware_or_model_change: "on_hardware_or_model_change";
            on_pricing_change: "on_pricing_change";
            periodic: "periodic";
        }>;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>;
    applies_to: z.ZodPrefault<z.ZodObject<{
        candidate_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        workload_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        constraint_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"runtime_measurement">;
    value: z.ZodObject<{
        window_start: z.ZodISODateTime;
        window_end: z.ZodISODateTime;
        coverage: z.ZodNumber;
        metrics: z.ZodRecord<z.ZodString, z.ZodNumber>;
    }, z.core.$strict>;
    id: z.ZodString;
    subject: z.ZodString;
    producer: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    observed_at: z.ZodISODateTime;
    source: z.ZodObject<{
        type: z.ZodEnum<{
            file: "file";
            local_command: "local_command";
            url: "url";
            api: "api";
            manual: "manual";
        }>;
        locator: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    confidence: z.ZodEnum<{
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    caveats: z.ZodDefault<z.ZodArray<z.ZodString>>;
    refresh: z.ZodObject<{
        policy: z.ZodEnum<{
            never: "never";
            on_hardware_or_model_change: "on_hardware_or_model_change";
            on_pricing_change: "on_pricing_change";
            periodic: "periodic";
        }>;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>;
    applies_to: z.ZodPrefault<z.ZodObject<{
        candidate_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        workload_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        constraint_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"tool_observation">;
    value: z.ZodObject<{
        estimate_basis: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        target_hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        detected_hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        findings: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strict>;
    id: z.ZodString;
    subject: z.ZodString;
    producer: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    observed_at: z.ZodISODateTime;
    source: z.ZodObject<{
        type: z.ZodEnum<{
            file: "file";
            local_command: "local_command";
            url: "url";
            api: "api";
            manual: "manual";
        }>;
        locator: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    confidence: z.ZodEnum<{
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    caveats: z.ZodDefault<z.ZodArray<z.ZodString>>;
    refresh: z.ZodObject<{
        policy: z.ZodEnum<{
            never: "never";
            on_hardware_or_model_change: "on_hardware_or_model_change";
            on_pricing_change: "on_pricing_change";
            periodic: "periodic";
        }>;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>;
    applies_to: z.ZodPrefault<z.ZodObject<{
        candidate_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        workload_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        constraint_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>, ...z.ZodObject<{
    kind: z.ZodLiteral<"unknown" | "deterministic_observation" | "source_code" | "official_documentation" | "user_declared" | "vendor_claim" | "agent_inference">;
    value: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    id: z.ZodString;
    subject: z.ZodString;
    producer: z.ZodObject<{
        name: z.ZodString;
        version: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    observed_at: z.ZodISODateTime;
    source: z.ZodObject<{
        type: z.ZodEnum<{
            file: "file";
            local_command: "local_command";
            url: "url";
            api: "api";
            manual: "manual";
        }>;
        locator: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    confidence: z.ZodEnum<{
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    caveats: z.ZodDefault<z.ZodArray<z.ZodString>>;
    refresh: z.ZodObject<{
        policy: z.ZodEnum<{
            never: "never";
            on_hardware_or_model_change: "on_hardware_or_model_change";
            on_pricing_change: "on_pricing_change";
            periodic: "periodic";
        }>;
        expires_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>;
    applies_to: z.ZodPrefault<z.ZodObject<{
        candidate_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        workload_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        hardware_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        constraint_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>[]], "kind">;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
/**
 * Subjects with a ratified minimum evidence tier. Taken verbatim from the
 * table in doc 06 section 6.
 */
export declare const EvidenceFloorSubjectSchema: z.ZodEnum<{
    repository_policy: "repository_policy";
    workload_quality_hard_gate: "workload_quality_hard_gate";
    privacy_data_flow_hard_gate: "privacy_data_flow_hard_gate";
    latency_throughput_hard_gate: "latency_throughput_hard_gate";
    token_hard_gate: "token_hard_gate";
    projected_cost_comparison: "projected_cost_comparison";
    realized_cost_hard_gate: "realized_cost_hard_gate";
    license: "license";
    residency_provider_capability: "residency_provider_capability";
    target_hardware_inventory: "target_hardware_inventory";
    hardware_compatibility_estimate: "hardware_compatibility_estimate";
    hardware_performance_gate: "hardware_performance_gate";
    budget_amount: "budget_amount";
    availability_portability_structure: "availability_portability_structure";
}>;
export type EvidenceFloorSubject = z.infer<typeof EvidenceFloorSubjectSchema>;
/**
 * The evidence policy declared by a contract. Tier labels are descriptive.
 * Floors may be RAISED above the ratified baseline but never lowered: a
 * contract that could lower `workload_quality_hard_gate` to T0 would let an
 * agent inference satisfy a hard quality gate, which doc 06 forbids.
 */
export declare const EvidencePolicySchema: z.ZodObject<{
    tiers: z.ZodDefault<z.ZodObject<{
        T3: z.ZodOptional<z.ZodString>;
        T2: z.ZodOptional<z.ZodString>;
        T1: z.ZodOptional<z.ZodString>;
        T0: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    floors: z.ZodDefault<z.ZodRecord<z.ZodEnum<{
        repository_policy: "repository_policy";
        workload_quality_hard_gate: "workload_quality_hard_gate";
        privacy_data_flow_hard_gate: "privacy_data_flow_hard_gate";
        latency_throughput_hard_gate: "latency_throughput_hard_gate";
        token_hard_gate: "token_hard_gate";
        projected_cost_comparison: "projected_cost_comparison";
        realized_cost_hard_gate: "realized_cost_hard_gate";
        license: "license";
        residency_provider_capability: "residency_provider_capability";
        target_hardware_inventory: "target_hardware_inventory";
        hardware_compatibility_estimate: "hardware_compatibility_estimate";
        hardware_performance_gate: "hardware_performance_gate";
        budget_amount: "budget_amount";
        availability_portability_structure: "availability_portability_structure";
    }> & z.core.$partial, z.ZodEnum<{
        T0: "T0";
        T1: "T1";
        T2: "T2";
        T3: "T3";
    }>>>;
}, z.core.$strict>;
export type EvidencePolicy = z.infer<typeof EvidencePolicySchema>;
//# sourceMappingURL=evidence.d.ts.map