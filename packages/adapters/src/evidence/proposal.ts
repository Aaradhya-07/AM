import {
  ConfidenceSchema,
  EvidenceKindSchema,
  RefreshSchema,
  EvidenceSourceSchema,
} from "@anvilmark/project-contract";
import { z } from "zod/v4";

import { AdapterStandingSchema, CommandManifestSchema } from "../envelope.js";

const IdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

/**
 * Where an evidence record points.
 *
 * `constraint_refs` is REQUIRED and non-empty here, stricter than the contract
 * schema allows. An adapter exists to settle a claim; a record it produces
 * that names no claim cannot settle anything, and accepting one would only
 * create an artifact that looks like evidence without being usable as any.
 */
export const ProposalAttributionSchema = z.strictObject({
  candidate_ref: IdSchema.nullable().default(null),
  workload_ref: IdSchema.nullable().default(null),
  hardware_ref: IdSchema.nullable().default(null),
  constraint_refs: z.array(IdSchema).min(1),
});

/**
 * What an evidence adapter returns.
 *
 * There is deliberately NO tier field. The tier is derived from `kind` by the
 * contract package, so an adapter cannot promote its own output: an inference
 * stays T0 no matter how confidently it is reported.
 */
export const EvidenceProposalSchema = z.strictObject({
  id: IdSchema,
  kind: EvidenceKindSchema,
  /** Human-readable subject, e.g. `candidate.classification.local.hardware_fit`. */
  subject: z.string().min(1),
  /** What this artifact asserts, in one sentence. */
  claim: z.string().min(1),
  producer: z.strictObject({
    name: z.string().min(1),
    /** The EXACT version observed at run time. Null means it was unobtainable. */
    version: z.string().min(1).nullable(),
  }),
  observed_at: z.iso.datetime({ offset: true }),
  source: EvidenceSourceSchema,
  /** Present when the fact came from a subprocess. Already redacted. */
  command_manifest: CommandManifestSchema.nullable().default(null),
  applies_to: ProposalAttributionSchema,
  /** Kind-specific payload, validated against the contract schema on build. */
  value: z.record(z.string(), z.unknown()),
  /** Units for the numeric members of `value`, e.g. `{ p95_ms: "ms" }`. */
  units: z.record(z.string(), z.string()).default({}),
  assumptions: z.array(z.string().min(1)).default([]),
  exclusions: z.array(z.string().min(1)).default([]),
  /** SHA-256 of the raw tool output or source document. */
  raw_result_hash: z.string().min(1).nullable().default(null),
  confidence: ConfidenceSchema,
  caveats: z.array(z.string().min(1)).default([]),
  refresh: RefreshSchema,
  standing: AdapterStandingSchema,
});

export type EvidenceProposal = z.infer<typeof EvidenceProposalSchema>;
export type ProposalAttribution = z.infer<typeof ProposalAttributionSchema>;
