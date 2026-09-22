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
  /** Amendment 6: the monthly call volume is not known yet. */
  "unknown",
]);

/**
 * Amendment 6 (draft.4): a workload can be recorded before its volume is known.
 *
 * `calls_per_month` is a required key whose value may be `null`, and `null` is
 * allowed exactly when `basis` is `unknown`. Unknown is therefore always written
 * explicitly and can never be read as zero. Evidence rules accept only
 * `user_assumption` or `measured` as usage inputs, so a projected cost
 * comparison stays unknown for a workload whose usage is unknown.
 */
export const ExpectedUsageSchema = z
  .strictObject({
    basis: UsageBasisSchema,
    calls_per_month: z.number().nonnegative().nullable(),
    input_tokens_per_call: z.number().nonnegative().nullable().default(null),
    output_tokens_per_call: z.number().nonnegative().nullable().default(null),
    reasoning_tokens_per_call: z
      .number()
      .nonnegative()
      .nullable()
      .default(null),
  })
  .superRefine((value, context) => {
    if (value.calls_per_month === null && value.basis !== "unknown") {
      context.addIssue({
        code: "custom",
        path: ["basis"],
        message:
          'calls_per_month is null (unknown), so basis must be "unknown"; an unknown volume cannot have been assumed, measured or claimed',
      });
    }
    if (value.calls_per_month !== null && value.basis === "unknown") {
      context.addIssue({
        code: "custom",
        path: ["calls_per_month"],
        message:
          'basis is "unknown", so calls_per_month must be null; a number with an unknown basis would present a guess as data',
      });
    }
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
  /**
   * Amendment 7 (draft.4): the data classification of what the workload
   * produces. `null` means not declared, which is unknown -- never "not
   * sensitive". The output FORMAT is `output_contract`.
   */
  output_classification: DataClassificationSchema.nullable().default(null),
  output_contract: OutputContractSchema,
  expected_usage: ExpectedUsageSchema,
  latency: LatencyRequirementSchema.nullable().default(null),
  quality_gates: z.array(QualityGateSchema).default([]),
  fallback: FallbackSchema.nullable().default(null),
  current_decision_ref: RefSchema.nullable().default(null),
});

export type Workload = z.infer<typeof WorkloadSchema>;
