import { z } from "zod/v4";

import { SHA256_HEX } from "./approvals.js";
import {
  DataClassificationSchema,
  IdSchema,
  NonEmptyStringSchema,
  RefSchema,
  RelativePathSchema,
  TimestampSchema,
} from "./primitives.js";

export const NodeKindSchema = z.enum([
  "service",
  "external_system",
  "datastore",
  "queue",
  "runtime",
  "actor",
]);

export type NodeKind = z.infer<typeof NodeKindSchema>;

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

export type TrustBoundary = z.infer<typeof TrustBoundarySchema>;

/**
 * Where an architecture element came from (amendment 8, draft.5).
 *
 * `user` elements were declared by the user. `agent_proposed` elements were
 * imported from an intelligence proposal named by `proposal_ref`; they stay
 * attributable after confirmation. `confirmed_at` and
 * `confirmed_content_hash` record a local interactive confirmation of exact
 * content (see `architectureContentHash`); the standing is derived by
 * recomputing the hash, never trusted from these fields alone.
 */
export const ArchitectureOriginSchema = z
  .strictObject({
    kind: z.enum(["user", "agent_proposed"]).default("user"),
    proposal_ref: RefSchema.nullable().default(null),
    confirmed_at: TimestampSchema.nullable().default(null),
    confirmed_content_hash: z
      .string()
      .regex(SHA256_HEX, "must be a lower-case hex sha-256 digest")
      .nullable()
      .default(null),
  })
  .superRefine((origin, context) => {
    if (origin.kind === "user") {
      for (const field of [
        "proposal_ref",
        "confirmed_at",
        "confirmed_content_hash",
      ] as const) {
        if (origin[field] !== null) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `a user-declared element has no ${field}; only agent-proposed elements carry proposal and confirmation fields`,
          });
        }
      }
      return;
    }
    if (origin.proposal_ref === null) {
      context.addIssue({
        code: "custom",
        path: ["proposal_ref"],
        message:
          "an agent-proposed element must name the proposal that added it",
      });
    }
    if (
      (origin.confirmed_at === null) !==
      (origin.confirmed_content_hash === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["confirmed_content_hash"],
        message:
          "confirmed_at and confirmed_content_hash are recorded together or not at all",
      });
    }
  });

export type ArchitectureOrigin = z.infer<typeof ArchitectureOriginSchema>;

export const InterfaceProtocolSchema = z.enum([
  "HTTP",
  "HTTPS",
  "gRPC",
  "AMQP",
  "TCP",
  "other",
]);

/**
 * A declared interface on a node (amendment 9, draft.5). Nothing infers one;
 * a null protocol means the protocol is unknown.
 */
export const ArchitectureInterfaceSchema = z.strictObject({
  id: IdSchema,
  protocol: InterfaceProtocolSchema.nullable().default(null),
  description: NonEmptyStringSchema.nullable().default(null),
});

export type ArchitectureInterface = z.infer<typeof ArchitectureInterfaceSchema>;

export const ArchitectureNodeSchema = z.strictObject({
  id: IdSchema,
  kind: NodeKindSchema,
  name: NonEmptyStringSchema,
  trust_boundary: TrustBoundarySchema,
  description: NonEmptyStringSchema.nullable().default(null),
  interfaces: z.array(ArchitectureInterfaceSchema).default([]),
  origin: ArchitectureOriginSchema.prefault({}),
});

export type ArchitectureNode = z.infer<typeof ArchitectureNodeSchema>;

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
  source_interface_ref: RefSchema.nullable().default(null),
  destination_interface_ref: RefSchema.nullable().default(null),
  origin: ArchitectureOriginSchema.prefault({}),
});

export type ArchitectureRelationship = z.infer<
  typeof ArchitectureRelationshipSchema
>;

/**
 * Paths to generated views. These are OUTPUTS, never authoritative inputs:
 * the ANVILMARK nodes and relationships above are the source of truth and
 * CALM 1.2 / Mermaid are exported from them.
 */
export const GeneratedViewsSchema = z.strictObject({
  calm_1_2: RelativePathSchema.nullable().default(null),
  mermaid: RelativePathSchema.nullable().default(null),
});

export const DecisionBindingSchema = z.strictObject({
  decision_ref: RefSchema,
  node_refs: z.array(RefSchema).min(1),
  origin: ArchitectureOriginSchema.prefault({}),
});

export type DecisionBinding = z.infer<typeof DecisionBindingSchema>;

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

export type Architecture = z.infer<typeof ArchitectureSchema>;
