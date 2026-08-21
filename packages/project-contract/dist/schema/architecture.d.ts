import { z } from "zod/v4";
export declare const NodeKindSchema: z.ZodEnum<{
    runtime: "runtime";
    actor: "actor";
    service: "service";
    external_system: "external_system";
    datastore: "datastore";
    queue: "queue";
}>;
export type NodeKind = z.infer<typeof NodeKindSchema>;
/**
 * Trust boundaries are the basis of the privacy rules. `local` is inside the
 * user's boundary; `remote_provider` is outside it.
 */
export declare const TrustBoundarySchema: z.ZodEnum<{
    local: "local";
    internal_network: "internal_network";
    remote_provider: "remote_provider";
    third_party: "third_party";
}>;
export type TrustBoundary = z.infer<typeof TrustBoundarySchema>;
export declare const ArchitectureNodeSchema: z.ZodObject<{
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
}, z.core.$strict>;
export type ArchitectureNode = z.infer<typeof ArchitectureNodeSchema>;
export declare const RelationshipKindSchema: z.ZodEnum<{
    connects: "connects";
    uses: "uses";
    deployed_in: "deployed_in";
    composed_of: "composed_of";
}>;
export declare const ArchitectureRelationshipSchema: z.ZodObject<{
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
}, z.core.$strict>;
export type ArchitectureRelationship = z.infer<typeof ArchitectureRelationshipSchema>;
/**
 * Paths to generated views. These are OUTPUTS, never authoritative inputs:
 * the ANVILMARK nodes and relationships above are the source of truth and
 * CALM 1.2 / Mermaid are exported from them. Generation itself is Milestone 4.
 */
export declare const GeneratedViewsSchema: z.ZodObject<{
    calm_1_2: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    mermaid: z.ZodDefault<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
export declare const DecisionBindingSchema: z.ZodObject<{
    decision_ref: z.ZodString;
    node_refs: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type DecisionBinding = z.infer<typeof DecisionBindingSchema>;
export declare const ArchitectureSchema: z.ZodObject<{
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
export type Architecture = z.infer<typeof ArchitectureSchema>;
//# sourceMappingURL=architecture.d.ts.map