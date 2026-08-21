import { z } from "zod/v4";
/**
 * The project contract.
 *
 * Strict throughout: unknown fields are rejected during the draft phase so
 * that spelling mistakes and agent-generated inventions surface immediately
 * rather than being silently discarded. A namespaced extension mechanism is a
 * later, deliberate decision.
 *
 * `evidence_refs` holds the evidence RECORDS themselves. The name is the
 * ratified top-level key from doc 03 section 3 and is kept as authored.
 */
export declare const ProjectContractSchema: z.ZodObject<{
    schema: z.ZodLiteral<"https://anvilmark.dev/schemas/project/0.1.0-draft.1">;
    schema_version: z.ZodLiteral<"0.1.0-draft.1">;
    project: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        created_at: z.ZodISODateTime;
        updated_at: z.ZodISODateTime;
        contract_revision: z.ZodInt;
        state: z.ZodEnum<{
            draft: "draft";
            active: "active";
            superseded: "superseded";
            archived: "archived";
        }>;
        repository_roots: z.ZodDefault<z.ZodArray<z.ZodString>>;
        owners: z.ZodDefault<z.ZodArray<z.ZodObject<{
            ref: z.ZodString;
            role: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>>>;
        priority_order: z.ZodArray<z.ZodEnum<{
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
        }>>;
    }, z.core.$strict>;
    intent: z.ZodObject<{
        summary: z.ZodString;
        users: z.ZodDefault<z.ZodArray<z.ZodString>>;
        outcomes: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            measure: z.ZodString;
            target: z.ZodString;
        }, z.core.$strict>>>;
        non_goals: z.ZodDefault<z.ZodArray<z.ZodString>>;
        unresolved_questions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    constraints: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "severity">>>;
    workloads: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
    }, z.core.$strict>>>;
    resources: z.ZodPrefault<z.ZodObject<{
        hardware: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            evidence_kind: z.ZodEnum<{
                deterministic_observation: "deterministic_observation";
                user_declared: "user_declared";
            }>;
            cpu: z.ZodObject<{
                cores: z.ZodInt;
                model: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            }, z.core.$strict>;
            ram_gb: z.ZodNumber;
            accelerators: z.ZodDefault<z.ZodArray<z.ZodObject<{
                vendor: z.ZodString;
                model: z.ZodString;
                vram_gb: z.ZodNumber;
                count: z.ZodDefault<z.ZodInt>;
            }, z.core.$strict>>>;
            operating_system: z.ZodEnum<{
                linux: "linux";
                macos: "macos";
                windows: "windows";
                other: "other";
            }>;
            evidence_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>>>;
        budgets: z.ZodDefault<z.ZodArray<z.ZodObject<{
            currency: z.ZodString;
            period: z.ZodEnum<{
                day: "day";
                month: "month";
                year: "year";
            }>;
            amount: z.ZodNumber;
            scope: z.ZodString;
        }, z.core.$strict>>>;
    }, z.core.$strict>>;
    evidence_policy: z.ZodPrefault<z.ZodObject<{
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
    }, z.core.$strict>>;
    candidates: z.ZodDefault<z.ZodArray<z.ZodObject<{
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
    }, z.core.$strict>>>;
    evidence_refs: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>[]], "kind">>>;
    decisions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodInt;
        status: z.ZodEnum<{
            proposed: "proposed";
            rejected: "rejected";
            draft: "draft";
            superseded: "superseded";
            approved: "approved";
        }>;
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"workload">;
            workload_ref: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"component">;
            component_ref: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"project">;
        }, z.core.$strict>], "kind">;
        selected_candidate_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        alternatives: z.ZodDefault<z.ZodArray<z.ZodString>>;
        satisfies_constraints: z.ZodDefault<z.ZodArray<z.ZodString>>;
        unresolved_constraints: z.ZodDefault<z.ZodArray<z.ZodString>>;
        evidence_refs: z.ZodDefault<z.ZodArray<z.ZodString>>;
        rationale: z.ZodObject<{
            summary: z.ZodString;
            generated_by: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            reviewed_by_user: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>;
        created_at: z.ZodISODateTime;
        updated_at: z.ZodDefault<z.ZodNullable<z.ZodISODateTime>>;
    }, z.core.$strict>>>;
    architecture: z.ZodObject<{
        authority: z.ZodLiteral<"anvilmark">;
        nodes: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                runtime: "runtime";
                actor: "actor";
                service: "service";
                external_system: "external_system";
                datastore: "datastore";
                queue: "queue";
            }>;
            name: z.ZodString;
            trust_boundary: z.ZodEnum<{
                local: "local";
                internal_network: "internal_network";
                remote_provider: "remote_provider";
                third_party: "third_party";
            }>;
            description: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>>>;
        relationships: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                connects: "connects";
                uses: "uses";
                deployed_in: "deployed_in";
                composed_of: "composed_of";
            }>;
            source: z.ZodString;
            destination: z.ZodString;
            workload_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            data_classification: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>>>;
        generated: z.ZodPrefault<z.ZodObject<{
            calm_1_2: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            mermaid: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>>;
        decision_bindings: z.ZodDefault<z.ZodArray<z.ZodObject<{
            decision_ref: z.ZodString;
            node_refs: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
    }, z.core.$strict>;
    repository_bindings: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        decision_ref: z.ZodString;
        architecture_node_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        repository_root: z.ZodString;
        locations: z.ZodDefault<z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            symbol: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            line: z.ZodDefault<z.ZodNullable<z.ZodInt>>;
        }, z.core.$strict>>>;
        discovery: z.ZodObject<{
            kind: z.ZodEnum<{
                deterministic: "deterministic";
                agent_inferred: "agent_inferred";
                user_confirmed: "user_confirmed";
                runtime_confirmed: "runtime_confirmed";
            }>;
            detector: z.ZodDefault<z.ZodNullable<z.ZodString>>;
            observed_at: z.ZodISODateTime;
        }, z.core.$strict>;
        confidence: z.ZodEnum<{
            high: "high";
            medium: "medium";
            low: "low";
        }>;
    }, z.core.$strict>>>;
    conformance_rules: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
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
    }, z.core.$strict>], "kind">>>;
    integrations: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"intelligence">;
        credential_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        default_data_projection: z.ZodDefault<z.ZodEnum<{
            public_decision_layer: "public_decision_layer";
            local_full: "local_full";
        }>>;
        additional_data_requires_consent: z.ZodDefault<z.ZodArray<z.ZodString>>;
        id: z.ZodString;
        adapter: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"evaluation">;
        credential_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        data_directory: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        network_policy: z.ZodDefault<z.ZodEnum<{
            explicit_provider_only: "explicit_provider_only";
            offline: "offline";
            unrestricted: "unrestricted";
        }>>;
        id: z.ZodString;
        adapter: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"hardware_fit">;
        mode: z.ZodDefault<z.ZodEnum<{
            local: "local";
            remote: "remote";
        }>>;
        id: z.ZodString;
        adapter: z.ZodString;
    }, z.core.$strict>], "kind">>>;
    remote_intelligence_policy: z.ZodPrefault<z.ZodObject<{
        default_allow: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            repository_roots: "repository_roots";
            owners: "owners";
            intent: "intent";
            constraints: "constraints";
            workloads: "workloads";
            data_classification_labels: "data_classification_labels";
            budgets: "budgets";
            non_identifying_hardware_capabilities: "non_identifying_hardware_capabilities";
            candidates: "candidates";
            evidence_metadata_without_local_locators: "evidence_metadata_without_local_locators";
            decisions: "decisions";
            conformance_rule_definitions: "conformance_rule_definitions";
            repository_bindings: "repository_bindings";
            file_contents: "file_contents";
            local_machine_identifiers: "local_machine_identifiers";
            integration_credential_references: "integration_credential_references";
            integration_data_directories: "integration_data_directories";
            local_command_lines: "local_command_lines";
            evaluation_rows: "evaluation_rows";
            source_quoting_conformance_explanations: "source_quoting_conformance_explanations";
        }>>>;
        default_deny: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            repository_roots: "repository_roots";
            owners: "owners";
            intent: "intent";
            constraints: "constraints";
            workloads: "workloads";
            data_classification_labels: "data_classification_labels";
            budgets: "budgets";
            non_identifying_hardware_capabilities: "non_identifying_hardware_capabilities";
            candidates: "candidates";
            evidence_metadata_without_local_locators: "evidence_metadata_without_local_locators";
            decisions: "decisions";
            conformance_rule_definitions: "conformance_rule_definitions";
            repository_bindings: "repository_bindings";
            file_contents: "file_contents";
            local_machine_identifiers: "local_machine_identifiers";
            integration_credential_references: "integration_credential_references";
            integration_data_directories: "integration_data_directories";
            local_command_lines: "local_command_lines";
            evaluation_rows: "evaluation_rows";
            source_quoting_conformance_explanations: "source_quoting_conformance_explanations";
        }>>>;
        show_payload_before_remote_send: z.ZodDefault<z.ZodBoolean>;
        scan_outbound_payload_for_secrets: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
    approvals: z.ZodDefault<z.ZodArray<z.ZodObject<{
        decision_ref: z.ZodString;
        decision_revision: z.ZodInt;
        actor: z.ZodObject<{
            kind: z.ZodLiteral<"local_user">;
            ref: z.ZodString;
        }, z.core.$strict>;
        approved_at: z.ZodISODateTime;
        note: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        hash_algorithm: z.ZodDefault<z.ZodLiteral<"sha-256">>;
        content_hash: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
export type ProjectContract = z.infer<typeof ProjectContractSchema>;
//# sourceMappingURL=contract.d.ts.map