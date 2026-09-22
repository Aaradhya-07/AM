import { z } from "zod/v4";

import {
  DeterminismSchema,
  IdSchema,
  NonEmptyStringSchema,
  OutcomeSchema,
  RefSchema,
  TimestampSchema,
} from "./primitives.js";

export const ComponentKindSchema = z.enum([
  "model_runtime",
  "embedding_model",
  "vector_store",
  "retrieval_service",
  "sanitizer",
  "gateway",
  "infrastructure",
]);

export type ComponentKind = z.infer<typeof ComponentKindSchema>;

/**
 * Whether the model identifier pins an exact artifact. Doc 03 invariant 4
 * requires an exact version or an explicit mutability warning, so a null
 * version is only accepted when the author declares the reference floating.
 */
export const VersionMutabilitySchema = z.enum(["pinned", "floating"]);

export const ModelSchema = z
  .strictObject({
    family: NonEmptyStringSchema,
    version: NonEmptyStringSchema.nullable().default(null),
    version_mutability: VersionMutabilitySchema.default("pinned"),
    quantization: NonEmptyStringSchema.nullable().default(null),
    license_evidence_ref: RefSchema.nullable().default(null),
  })
  .refine(
    (value) =>
      value.version !== null || value.version_mutability === "floating",
    {
      message:
        "a model without an exact version must declare version_mutability: floating as an explicit mutability warning",
      path: ["version"],
    },
  );

export type Model = z.infer<typeof ModelSchema>;

/**
 * Deployment mode. Provider and runtime names are free strings on purpose:
 * enumerating them here would couple the core schema to a fixed vendor list.
 */
export const DeploymentSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("local"),
    runtime: NonEmptyStringSchema.nullable().default(null),
    hardware_ref: RefSchema.nullable().default(null),
  }),
  z.strictObject({
    mode: z.literal("managed_api"),
    provider: NonEmptyStringSchema.nullable().default(null),
    region: NonEmptyStringSchema.nullable().default(null),
  }),
  z.strictObject({
    mode: z.literal("self_hosted"),
    provider: NonEmptyStringSchema.nullable().default(null),
    region: NonEmptyStringSchema.nullable().default(null),
    runtime: NonEmptyStringSchema.nullable().default(null),
  }),
]);

export type Deployment = z.infer<typeof DeploymentSchema>;

/**
 * Pointers to evidence records that MEASURED this candidate. Every reference
 * here must resolve to a real evidence record: claiming a measurement whose
 * record does not exist is exactly the failure mode the contract must catch.
 */
/**
 * The evaluation identity a candidate expects its measurements to carry.
 *
 * Without this the contract can check that an evaluation is internally
 * complete but not that it describes THIS candidate's current configuration:
 * a measurement of a superseded prompt or a different provider would still
 * look like a valid T3 record.
 */
export const ExpectedEvaluationSchema = z.strictObject({
  provider_id: NonEmptyStringSchema,
  configuration_hash: NonEmptyStringSchema,
});

export type ExpectedEvaluation = z.infer<typeof ExpectedEvaluationSchema>;

export const MeasurementsSchema = z.strictObject({
  quality_result_ref: RefSchema.nullable().default(null),
  hardware_fit_evidence_ref: RefSchema.nullable().default(null),
  latency_measurement_ref: RefSchema.nullable().default(null),
  token_measurement_ref: RefSchema.nullable().default(null),
  cost_measurement_ref: RefSchema.nullable().default(null),
  /**
   * What a cited measured evaluation must match. Required for a measured
   * evaluation to be admitted; its absence fails closed.
   */
  expected_evaluation: ExpectedEvaluationSchema.nullable().default(null),
});

export type Measurements = z.infer<typeof MeasurementsSchema>;

/** Projected values. Every estimate must record what it was derived from. */
export const EstimatesSchema = z
  .strictObject({
    tokens_per_call: z.number().nonnegative().nullable().default(null),
    latency_p95_ms: z.number().nonnegative().nullable().default(null),
    monthly_effective_cost_usd: z
      .number()
      .nonnegative()
      .nullable()
      .default(null),
    basis: NonEmptyStringSchema.nullable().default(null),
    assumptions: z.array(NonEmptyStringSchema).default([]),
  })
  .refine(
    (value) =>
      (value.tokens_per_call === null &&
        value.latency_p95_ms === null &&
        value.monthly_effective_cost_usd === null) ||
      value.basis !== null ||
      value.assumptions.length > 0,
    {
      message:
        "an estimate must record its basis or assumptions; an unexplained number is not usable evidence",
      path: ["basis"],
    },
  );

export type Estimates = z.infer<typeof EstimatesSchema>;

/**
 * The recorded outcome of one constraint against this candidate. `status` is
 * an assertion made by whoever wrote it; validation independently re-checks
 * that a `pass` is backed by evidence at or above the ratified floor.
 */
export const ConstraintResultSchema = z.strictObject({
  constraint_ref: RefSchema,
  status: OutcomeSchema,
  evidence_refs: z.array(RefSchema).default([]),
  determinism: DeterminismSchema.default("deterministic"),
  explanation: NonEmptyStringSchema.nullable().default(null),
  evaluated_at: TimestampSchema.nullable().default(null),
});

export type ConstraintResult = z.infer<typeof ConstraintResultSchema>;

export const CandidateStatusSchema = z.enum([
  "discovered",
  "incompatible",
  "unevaluated",
  "viable",
  "proposed",
  "selected",
  "rejected",
  "unavailable",
]);

export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

/** One way to execute one workload or provide one component. */
export const CandidateSchema = z.strictObject({
  id: IdSchema,
  /** Null for candidates that serve a component or project scope. */
  workload_ref: RefSchema.nullable().default(null),
  component_kind: ComponentKindSchema,
  model: ModelSchema.nullable().default(null),
  deployment: DeploymentSchema,
  measurements: MeasurementsSchema.prefault({}),
  estimates: EstimatesSchema.prefault({}),
  constraint_results: z.array(ConstraintResultSchema).default([]),
  status: CandidateStatusSchema,
});

export type Candidate = z.infer<typeof CandidateSchema>;
