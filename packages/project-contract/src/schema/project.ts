import { z } from "zod/v4";

import {
  IdSchema,
  NonEmptyStringSchema,
  RelativePathSchema,
  TimestampSchema,
} from "./primitives.js";

/**
 * Constraint domains. These double as the vocabulary of `priority_order`,
 * so the user's declared tie-breaking order is checked against real domains
 * rather than free text.
 */
export const ConstraintDomainSchema = z.enum([
  "functionality",
  "quality",
  "cost",
  "tokens",
  "latency",
  "throughput",
  "privacy",
  "residency",
  "provider_policy",
  "licensing",
  "hardware",
  "availability",
  "operability",
  "repository_policy",
]);

export type ConstraintDomain = z.infer<typeof ConstraintDomainSchema>;

export const ProjectStateSchema = z.enum([
  "draft",
  "active",
  "superseded",
  "archived",
]);

export type ProjectState = z.infer<typeof ProjectStateSchema>;

/**
 * An owner is a local identity or role. No email address is required, and
 * owners are default-denied to remote intelligence.
 */
export const OwnerSchema = z.strictObject({
  ref: NonEmptyStringSchema,
  role: NonEmptyStringSchema.nullable().default(null),
});

export type Owner = z.infer<typeof OwnerSchema>;

export const ProjectSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyStringSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
  /** Incremented when approved content changes. */
  contract_revision: z.int().min(1),
  state: ProjectStateSchema,
  repository_roots: z.array(RelativePathSchema).default([]),
  owners: z.array(OwnerSchema).default([]),
  /**
   * Ordered constraint domains used for transparent tie-breaking. This is
   * deliberately an explicit ordering rather than an opaque weighted score,
   * and its array order is semantically meaningful: serialization preserves it.
   */
  priority_order: z.array(ConstraintDomainSchema),
});

export type Project = z.infer<typeof ProjectSchema>;
