import { z } from "zod/v4";
import { DataClassificationSchema, IdSchema, NonEmptyStringSchema, RefSchema, RelativePathSchema, } from "./primitives.js";
export const NodeKindSchema = z.enum([
    "service",
    "external_system",
    "datastore",
    "queue",
    "runtime",
    "actor",
]);
/**
 * Trust boundaries are the basis of the privacy rules. `local` is inside the
 * user's boundary; `remote_provider` is outside it.
 */
export const TrustBoundarySchema = z.enum([
    "local",
    "internal_network",
    "remote_provider",
    "third_party",
]);
export const ArchitectureNodeSchema = z.strictObject({
    id: IdSchema,
    kind: NodeKindSchema,
    name: NonEmptyStringSchema,
    trust_boundary: TrustBoundarySchema,
    description: NonEmptyStringSchema.nullable().default(null),
});
export const RelationshipKindSchema = z.enum([
    "connects",
    "uses",
    "deployed_in",
    "composed_of",
]);
export const ArchitectureRelationshipSchema = z.strictObject({
    id: IdSchema,
    kind: RelationshipKindSchema,
    source: RefSchema,
    destination: RefSchema,
    workload_ref: RefSchema.nullable().default(null),
    data_classification: DataClassificationSchema.nullable().default(null),
});
/**
 * Paths to generated views. These are OUTPUTS, never authoritative inputs:
 * the ANVILMARK nodes and relationships above are the source of truth and
 * CALM 1.2 / Mermaid are exported from them. Generation itself is Milestone 4.
 */
export const GeneratedViewsSchema = z.strictObject({
    calm_1_2: RelativePathSchema.nullable().default(null),
    mermaid: RelativePathSchema.nullable().default(null),
});
export const DecisionBindingSchema = z.strictObject({
    decision_ref: RefSchema,
    node_refs: z.array(RefSchema).min(1),
});
export const ArchitectureSchema = z.strictObject({
    /**
     * ANVILMARK's own graph is authoritative. The literal is fixed so that a
     * contract cannot quietly declare an imported view to be the source of truth.
     */
    authority: z.literal("anvilmark"),
    nodes: z.array(ArchitectureNodeSchema).default([]),
    relationships: z.array(ArchitectureRelationshipSchema).default([]),
    generated: GeneratedViewsSchema.prefault({}),
    decision_bindings: z.array(DecisionBindingSchema).default([]),
});
