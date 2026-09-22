import {
  ConstraintDomainSchema,
  DataClassificationSchema,
  NodeKindSchema,
  RelationshipKindSchema,
  SoftDirectionSchema,
  TrustBoundarySchema,
} from "@anvilmark/project-contract";
import { z } from "zod/v4";

import { INTELLIGENCE_PROTOCOL_VERSIONS } from "../version.js";

const IdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/**
 * A constraint an intelligence adapter SUGGESTS.
 *
 * `source` is pinned to the literal `agent_proposed`. An adapter cannot record
 * a suggestion as a user declaration, which matters because `user_declared` is
 * T1 evidence and authoritative for hardware and budget, while an agent
 * inference is T0 and authoritative for nothing.
 */
export const ProposedConstraintSchema = z.strictObject({
  id: IdSchema,
  domain: ConstraintDomainSchema,
  severity: z.enum(["hard", "soft", "informational"]),
  direction: SoftDirectionSchema.nullable().default(null),
  subject: z.string().min(1),
  operator: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  source: z.literal("agent_proposed"),
  rationale: z.string().min(1).nullable().default(null),
});

/** A candidate an intelligence adapter suggests exploring. */
export const ProposedCandidateSchema = z.strictObject({
  id: IdSchema,
  workload_ref: IdSchema.nullable().default(null),
  component_kind: z.string().min(1),
  model_family: z.string().min(1).nullable().default(null),
  model_version: z.string().min(1).nullable().default(null),
  deployment_mode: z.enum(["local", "managed_api", "self_hosted"]),
  provider: z.string().min(1).nullable().default(null),
  rationale: z.string().min(1).nullable().default(null),
});

/**
 * Any evidence an intelligence adapter offers is, by definition, its own
 * inference. The kind is a literal so that a model cannot describe its own
 * output as a measurement, an official document, or a deterministic
 * observation.
 */
export const ProposedInferenceSchema = z.strictObject({
  subject: z.string().min(1),
  claim: z.string().min(1),
  kind: z.literal("agent_inference"),
  confidence: z.enum(["high", "medium", "low"]),
  caveats: z.array(z.string().min(1)).default([]),
});

/**
 * An architecture node an intelligence adapter proposes (protocol draft.2).
 *
 * Strict: a proposal cannot supply `origin`, confirmation fields or
 * interfaces. Import records the element as agent-proposed and unconfirmed;
 * only the user's interactive `architecture confirm` can confirm it.
 */
export const ProposedArchitectureNodeSchema = z.strictObject({
  id: IdSchema,
  kind: NodeKindSchema,
  name: z.string().min(1),
  trust_boundary: TrustBoundarySchema,
  description: z.string().min(1).nullable().default(null),
});

/** An architecture relationship an intelligence adapter proposes (draft.2). */
export const ProposedRelationshipSchema = z.strictObject({
  id: IdSchema,
  kind: RelationshipKindSchema,
  source: IdSchema,
  destination: IdSchema,
  workload_ref: IdSchema.nullable().default(null),
  data_classification: DataClassificationSchema.nullable().default(null),
});

/** A decision binding an intelligence adapter proposes (draft.2). */
export const ProposedDecisionBindingSchema = z.strictObject({
  decision_ref: IdSchema,
  node_refs: z.array(IdSchema).min(1),
});

const proposalFields = {
  proposed_constraints: z.array(ProposedConstraintSchema).default([]),
  proposed_candidates: z.array(ProposedCandidateSchema).default([]),
  /** Honest unknowns the adapter wants the user to resolve. */
  questions: z.array(z.string().min(1)).default([]),
  inferences: z.array(ProposedInferenceSchema).default([]),
  rationale: z
    .strictObject({
      summary: z.string().min(1),
      /** Which adapter wrote this. Recorded, never hidden. */
      generated_by: z.string().min(1),
    })
    .nullable()
    .default(null),
};

/** Protocol `0.1.0-draft.1`: the Milestone 3 fields exactly. */
export const IntelligenceProposalDraft1Schema = z.strictObject({
  protocol_version: z.literal(INTELLIGENCE_PROTOCOL_VERSIONS[0]),
  ...proposalFields,
});

/** Protocol `0.1.0-draft.2`: draft.1 plus proposed architecture. */
export const IntelligenceProposalDraft2Schema = z.strictObject({
  protocol_version: z.literal(INTELLIGENCE_PROTOCOL_VERSIONS[1]),
  ...proposalFields,
  proposed_architecture_nodes: z
    .array(ProposedArchitectureNodeSchema)
    .default([]),
  proposed_relationships: z.array(ProposedRelationshipSchema).default([]),
  proposed_decision_bindings: z
    .array(ProposedDecisionBindingSchema)
    .default([]),
});

/**
 * What an intelligence adapter returns.
 *
 * Validated strictly against the shape of the version it declares, so a field
 * that version does not define — `approvals`, `decisions`, `status`, or
 * architecture arrays in a draft.1 response — is rejected rather than ignored.
 * There is no shape in which an adapter can approve or confirm anything. A
 * parsed proposal keeps its version's shape, so parsing it again gives the same
 * answer; read architecture through `proposedArchitecture`.
 */
export const IntelligenceProposalSchema = z.discriminatedUnion(
  "protocol_version",
  [IntelligenceProposalDraft1Schema, IntelligenceProposalDraft2Schema],
);

export type IntelligenceProposal = z.infer<typeof IntelligenceProposalSchema>;

/** The proposed architecture of a proposal; empty for protocol draft.1. */
export function proposedArchitecture(proposal: IntelligenceProposal): {
  readonly nodes: readonly ProposedArchitectureNode[];
  readonly relationships: readonly ProposedRelationship[];
  readonly bindings: readonly ProposedDecisionBinding[];
} {
  return proposal.protocol_version === "0.1.0-draft.2"
    ? {
        nodes: proposal.proposed_architecture_nodes,
        relationships: proposal.proposed_relationships,
        bindings: proposal.proposed_decision_bindings,
      }
    : { nodes: [], relationships: [], bindings: [] };
}
export type ProposedArchitectureNode = z.infer<
  typeof ProposedArchitectureNodeSchema
>;
export type ProposedRelationship = z.infer<typeof ProposedRelationshipSchema>;
export type ProposedDecisionBinding = z.infer<
  typeof ProposedDecisionBindingSchema
>;
export type ProposedConstraint = z.infer<typeof ProposedConstraintSchema>;
export type ProposedCandidate = z.infer<typeof ProposedCandidateSchema>;

/** What an adapter is asked to do. Deliberately small and provider-neutral. */
export const IntelligenceRequestSchema = z.strictObject({
  protocol_version: z.enum(INTELLIGENCE_PROTOCOL_VERSIONS),
  task: z.enum([
    "clarify_intent",
    "propose_constraints",
    "propose_candidates",
    "explain_tradeoffs",
    "propose_architecture",
  ]),
  /** The exact projection the adapter is allowed to see. */
  projection: z.record(z.string(), z.unknown()),
  instructions: z.string().min(1),
});

export type IntelligenceRequest = z.infer<typeof IntelligenceRequestSchema>;
