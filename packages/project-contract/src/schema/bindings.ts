import { z } from "zod/v4";

import {
  ConfidenceSchema,
  IdSchema,
  NonEmptyStringSchema,
  RefSchema,
  RelativePathSchema,
  TimestampSchema,
} from "./primitives.js";

export const SourceLocationSchema = z.strictObject({
  path: RelativePathSchema,
  symbol: NonEmptyStringSchema.nullable().default(null),
  line: z.int().positive().nullable().default(null),
});

export type SourceLocation = z.infer<typeof SourceLocationSchema>;

/**
 * How the binding was established. The source must remain visible so that an
 * agent-inferred binding is never mistaken for a deterministic observation.
 */
export const DiscoverySchema = z.strictObject({
  kind: z.enum([
    "deterministic",
    "agent_inferred",
    "user_confirmed",
    "runtime_confirmed",
  ]),
  detector: NonEmptyStringSchema.nullable().default(null),
  observed_at: TimestampSchema,
});

/** Connects an approved decision to observed implementation. */
export const RepositoryBindingSchema = z.strictObject({
  id: IdSchema,
  decision_ref: RefSchema,
  architecture_node_ref: RefSchema.nullable().default(null),
  repository_root: RelativePathSchema,
  locations: z.array(SourceLocationSchema).default([]),
  discovery: DiscoverySchema,
  confidence: ConfidenceSchema,
});

export type RepositoryBinding = z.infer<typeof RepositoryBindingSchema>;
