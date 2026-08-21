import { z } from "zod/v4";
export declare const SourceLocationSchema: z.ZodObject<{
    path: z.ZodString;
    symbol: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    line: z.ZodDefault<z.ZodNullable<z.ZodInt>>;
}, z.core.$strict>;
export type SourceLocation = z.infer<typeof SourceLocationSchema>;
/**
 * How the binding was established. The source must remain visible so that an
 * agent-inferred binding is never mistaken for a deterministic observation.
 */
export declare const DiscoverySchema: z.ZodObject<{
    kind: z.ZodEnum<{
        deterministic: "deterministic";
        agent_inferred: "agent_inferred";
        user_confirmed: "user_confirmed";
        runtime_confirmed: "runtime_confirmed";
    }>;
    detector: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    observed_at: z.ZodISODateTime;
}, z.core.$strict>;
/** Connects an approved decision to observed implementation. */
export declare const RepositoryBindingSchema: z.ZodObject<{
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
}, z.core.$strict>;
export type RepositoryBinding = z.infer<typeof RepositoryBindingSchema>;
//# sourceMappingURL=bindings.d.ts.map