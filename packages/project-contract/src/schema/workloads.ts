import { z } from "zod/v4";

import {
  DataClassificationSchema,
  IdSchema,
  NonEmptyStringSchema,
  RefSchema,
  RelativePathSchema,
} from "./primitives.js";

/**
 * The shape a workload must produce. `json_schema` carries a path to the
 * schema document; the other kinds are self-describing.
 */
export const OutputContractSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("json_schema"),
    ref: RelativePathSchema,
  }),
  z.strictObject({ kind: z.literal("ranked_document_refs") }),
  z.strictObject({ kind: z.literal("cited_text") }),
  z.strictObject({ kind: z.literal("plain_text") }),
]);

export type OutputContract = z.infer<typeof OutputContractSchema>;

/**
 * How the usage figures were arrived at. This is the difference between a
 * planning assumption and a measurement, and it is never inferred silently.
 */
export const UsageBasisSchema = z.enum([
  "user_assumption",
  "measured",
  "vendor_claim",
  "agent_inference",
]);

export const ExpectedUsageSchema = z.strictObject({
  basis: UsageBasisSchema,
  calls_per_month: z.number().nonnegative(),
  input_tokens_per_call: z.number().nonnegative().nullable().default(null),
  output_tokens_per_call: z.number().nonnegative().nullable().default(null),
  reasoning_tokens_per_call: z.number().nonnegative().nullable().default(null),
});

export type ExpectedUsage = z.infer<typeof ExpectedUsageSchema>;

export const LatencyPercentileSchema = z.enum(["p50", "p90", "p95", "p99"]);

export const LatencyRequirementSchema = z.strictObject({
  percentile: LatencyPercentileSchema,
  maximum_ms: z.number().positive(),
});

export type LatencyRequirement = z.infer<typeof LatencyRequirementSchema>;

/**
 * A workload-specific quality gate. `evaluation_ref` names the evaluation
 * manifest expected to produce the evidence. It is deliberately a soft
 * reference: an unproduced evaluation is an evidence gap, not a broken
 * contract, and an absent result yields `unknown` rather than `pass`.
 */
export const QualityGateSchema = z.strictObject({
  metric: NonEmptyStringSchema,
  minimum: z.number(),
  evaluation_ref: RefSchema,
});

export type QualityGate = z.infer<typeof QualityGateSchema>;

export const FallbackSchema = z.strictObject({
  kind: z.enum(["degrade", "queue", "human_handoff", "fail_closed"]),
  description: NonEmptyStringSchema,
});

/**
 * The workload is the primary unit of model and deployment choice. There is
 * deliberately no global "best model" field anywhere in this contract.
 */
export const WorkloadSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyStringSchema,
  input_classification: DataClassificationSchema,
  output_contract: OutputContractSchema,
  expected_usage: ExpectedUsageSchema,
  latency: LatencyRequirementSchema.nullable().default(null),
  quality_gates: z.array(QualityGateSchema).default([]),
  fallback: FallbackSchema.nullable().default(null),
  current_decision_ref: RefSchema.nullable().default(null),
});

export type Workload = z.infer<typeof WorkloadSchema>;
