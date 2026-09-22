import { z } from "zod/v4";

import {
  ConfidenceSchema,
  IdSchema,
  NonEmptyStringSchema,
  RefSchema,
  TimestampSchema,
} from "./primitives.js";

/**
 * Evidence tiers, ratified in doc 06 section 6.
 *
 * T3 directly observed or measured; T2 attributable authoritative evidence;
 * T1 declared or claimed; T0 inference or absence.
 */
export const EvidenceTierSchema = z.enum(["T0", "T1", "T2", "T3"]);

export type EvidenceTier = z.infer<typeof EvidenceTierSchema>;

/**
 * The kind of evidence determines its tier. The tier is DERIVED, never
 * author-declared: an author cannot label an agent inference as a measurement
 * to clear a gate.
 */
export const EvidenceKindSchema = z.enum([
  "deterministic_observation",
  "measured_evaluation",
  "runtime_measurement",
  "source_code",
  "official_documentation",
  "official_pricing",
  "tool_observation",
  "user_declared",
  "vendor_claim",
  "agent_inference",
  "unknown",
]);

export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const ProducerSchema = z.strictObject({
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema.nullable().default(null),
});

export const EvidenceSourceSchema = z.strictObject({
  type: z.enum(["local_command", "url", "file", "api", "manual"]),
  /**
   * Where the evidence came from. Local locators are default-denied to remote
   * intelligence, so a redacted manifest reference is acceptable here.
   */
  locator: NonEmptyStringSchema.nullable().default(null),
});

/**
 * What this evidence is attributable to.
 *
 * Tier alone cannot decide admissibility: a runtime measurement of one
 * candidate says nothing about a different candidate, and a benchmark run on
 * a laptop says nothing about a declared RTX 4090 target. `subject` is free
 * text for humans, so these structured references are what let validation
 * check relevance deterministically.
 *
 * `constraint_refs` names the CLAIMS this artifact supports. Subject and kind
 * together are not enough: a source-code observation of logging configuration
 * is a T3 observation admissible for privacy in the abstract, and a macro-F1
 * evaluation is a T3 measurement of the right candidate and workload, but
 * neither says anything about the specific constraint it gets cited for.
 * Evidence must state which claims it supports, and an artifact that supports
 * several claims must list each one.
 *
 * Everything here is optional except that omission has consequences: evidence
 * not attributed to a candidate cannot satisfy a candidate-scoped gate, and
 * evidence not attributed to a constraint cannot satisfy that constraint. It
 * is never silently accepted as if it were.
 */
export const AppliesToSchema = z.strictObject({
  candidate_ref: RefSchema.nullable().default(null),
  workload_ref: RefSchema.nullable().default(null),
  hardware_ref: RefSchema.nullable().default(null),
  constraint_refs: z.array(RefSchema).default([]),
});

export type AppliesTo = z.infer<typeof AppliesToSchema>;

export const RefreshSchema = z.strictObject({
  policy: z.enum([
    "on_hardware_or_model_change",
    "on_pricing_change",
    "periodic",
    "never",
  ]),
  expires_at: TimestampSchema.nullable().default(null),
});

const metricsSchema = z.record(z.string(), z.number());

/**
 * The individual identities an evaluation result depends on.
 *
 * `configuration_hash` alone can say THAT something changed but never WHICH
 * thing, and "the dataset was revised" and "the prompt was reworded" have very
 * different consequences for whether an old result still applies. Each
 * identity is therefore recorded separately, in the contract rather than in an
 * adapter annotation that would vanish the moment the evidence is attached.
 */
/**
 * A content digest, carrying its algorithm.
 *
 * `sha256:` plus lower-case hex. An opaque string cannot serve as proof of
 * what was executed: without a stated algorithm and a fixed representation,
 * "not-a-digest" and a real hash are indistinguishable to a reader and to a
 * later comparison.
 */
export const DigestSchema = z
  .string()
  .regex(
    /^sha256:[0-9a-f]{64}$/,
    "a digest must be `sha256:` followed by 64 lower-case hex characters",
  );

export type Digest = z.infer<typeof DigestSchema>;

export const EvaluationIdentitySchema = z.strictObject({
  workload_ref: RefSchema.nullable().default(null),
  dataset_hash: DigestSchema,
  prompt_hash: DigestSchema,
  evaluator_hash: DigestSchema,
  model_configuration_hash: DigestSchema,
  /** Digest of the exact configuration bytes handed to the tool. */
  config_digest: DigestSchema,
  /**
   * The single provider the run actually used, as reported by the tool.
   *
   * REQUIRED and non-null. A result aggregated over several providers, or one
   * whose provider could not be established, is not a measurement of one
   * candidate — and a nullable field made "we never found out" look like a
   * legitimate recorded value.
   */
  provider_id: NonEmptyStringSchema,
});

export type EvaluationIdentity = z.infer<typeof EvaluationIdentitySchema>;

/**
 * Evaluation evidence must identify the dataset, the exact candidate
 * configuration, the metrics, and a result artifact hash. Without these a
 * result is not reproducible and cannot be treated as a measurement.
 */
const MeasuredEvaluationValueSchema = z.strictObject({
  dataset_ref: NonEmptyStringSchema,
  dataset_version: NonEmptyStringSchema,
  candidate_ref: RefSchema,
  /** Combined digest over every member of `identity`. */
  configuration_hash: NonEmptyStringSchema,
  identity: EvaluationIdentitySchema,
  metrics: metricsSchema,
  result_artifact_hash: NonEmptyStringSchema,
});

/** Pricing needs currency, unit, region/tier where applicable, and exclusions. */
const OfficialPricingValueSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  unit: NonEmptyStringSchema,
  amount: z.number().nonnegative(),
  region: NonEmptyStringSchema.nullable().default(null),
  tier: NonEmptyStringSchema.nullable().default(null),
  exclusions: z.array(NonEmptyStringSchema).default([]),
});

/** Runtime data must identify its collection window and coverage. */
const RuntimeMeasurementValueSchema = z.strictObject({
  window_start: TimestampSchema,
  window_end: TimestampSchema,
  coverage: z.number().min(0).max(1),
  metrics: metricsSchema,
});

/**
 * Tool output such as llmfit. `target_hardware_ref` names the DECLARED target
 * the estimate is meant to describe; `detected_hardware_ref` names what the
 * tool actually inspected. When they disagree the observation cannot speak for
 * the target and evaluation yields `unknown` (doc 06 section 8).
 */
const ToolObservationValueSchema = z.strictObject({
  estimate_basis: z.record(z.string(), z.unknown()).default({}),
  target_hardware_ref: RefSchema.nullable().default(null),
  detected_hardware_ref: RefSchema.nullable().default(null),
  findings: z.record(z.string(), z.unknown()).default({}),
});

const GenericValueSchema = z.record(z.string(), z.unknown());

const evidenceBase = {
  id: IdSchema,
  /** What this evidence is about, e.g. `candidate.classification.local_a.hardware_fit`. */
  subject: NonEmptyStringSchema,
  producer: ProducerSchema,
  observed_at: TimestampSchema,
  source: EvidenceSourceSchema,
  confidence: ConfidenceSchema,
  caveats: z.array(NonEmptyStringSchema).default([]),
  refresh: RefreshSchema,
  applies_to: AppliesToSchema.prefault({}),
};

export const EvidenceRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...evidenceBase,
    kind: z.literal("measured_evaluation"),
    value: MeasuredEvaluationValueSchema,
  }),
  z.strictObject({
    ...evidenceBase,
    kind: z.literal("official_pricing"),
    value: OfficialPricingValueSchema,
  }),
  z.strictObject({
    ...evidenceBase,
    kind: z.literal("runtime_measurement"),
    value: RuntimeMeasurementValueSchema,
  }),
  z.strictObject({
    ...evidenceBase,
    kind: z.literal("tool_observation"),
    value: ToolObservationValueSchema,
  }),
  ...(
    [
      "deterministic_observation",
      "source_code",
      "official_documentation",
      "user_declared",
      "vendor_claim",
      "agent_inference",
      "unknown",
    ] as const
  ).map((kind) =>
    z.strictObject({
      ...evidenceBase,
      kind: z.literal(kind),
      value: GenericValueSchema,
    }),
  ),
]);

export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/**
 * Subjects with a ratified minimum evidence tier. Taken verbatim from the
 * table in doc 06 section 6.
 */
export const EvidenceFloorSubjectSchema = z.enum([
  "workload_quality_hard_gate",
  "privacy_data_flow_hard_gate",
  "latency_throughput_hard_gate",
  "token_hard_gate",
  "projected_cost_comparison",
  "realized_cost_hard_gate",
  "license",
  "residency_provider_capability",
  "target_hardware_inventory",
  "hardware_compatibility_estimate",
  "hardware_performance_gate",
  "budget_amount",
  "availability_portability_structure",
  "repository_policy",
]);

export type EvidenceFloorSubject = z.infer<typeof EvidenceFloorSubjectSchema>;

/**
 * The evidence policy declared by a contract. Tier labels are descriptive.
 * Floors may be RAISED above the ratified baseline but never lowered: a
 * contract that could lower `workload_quality_hard_gate` to T0 would let an
 * agent inference satisfy a hard quality gate, which doc 06 forbids.
 */
export const EvidencePolicySchema = z.strictObject({
  tiers: z
    .strictObject({
      T3: NonEmptyStringSchema,
      T2: NonEmptyStringSchema,
      T1: NonEmptyStringSchema,
      T0: NonEmptyStringSchema,
    })
    .partial()
    .default({}),
  floors: z
    .partialRecord(EvidenceFloorSubjectSchema, EvidenceTierSchema)
    .default({}),
});

export type EvidencePolicy = z.infer<typeof EvidencePolicySchema>;
