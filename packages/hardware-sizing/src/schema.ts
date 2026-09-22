import { z } from "zod/v4";
import {
  SizingExtensionsSchema,
  DeviceEstimateSchema,
  EXTENDED_ESTIMATOR_VERSION,
} from "./extensions.js";

export const SIZING_FORMAT = "anvilmark-hardware-sizing/1" as const;
export const ESTIMATOR_VERSION = "0.1.0-draft.1" as const;
export const CATALOG_VERSION = "2026-09-17.1" as const;
export const MAX_ARTIFACT_BYTES = 1024 * 1024;

const text = z.string().trim().min(1).max(256);
export const BytesSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().positive();
export const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const RevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
const timestamp = z.iso.datetime({ offset: true });

export const AttentionGroupSchema = z.strictObject({
  layers: count.max(1024),
  kv_heads: count.max(1024),
  key_head_dimension: count.max(8192),
  value_head_dimension: count.max(8192),
  // Null means full attention. A window is an explicit retention policy.
  window_tokens: count.max(16_777_216).nullable(),
});
export type AttentionGroup = z.infer<typeof AttentionGroupSchema>;

export const ModelProfileSchema = z.strictObject({
  id: text,
  revision: RevisionSchema,
  label: text,
  architecture: z.enum(["dense_gqa", "moe_gqa"]),
  parameter_count: count.max(Number.MAX_SAFE_INTEGER),
  active_parameter_count: count.max(Number.MAX_SAFE_INTEGER),
  max_context_tokens: count.max(16_777_216),
  attention_groups: z.array(AttentionGroupSchema).min(1).max(1024),
  publisher_config_url: z.url().max(2048),
  publisher_index_url: z.url().max(2048),
  parameter_count_basis: z.string().min(1).max(2048),
  license_url: z.url().max(2048),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const WeightStorageSchema = z.strictObject({
  // Unknown named formats remain representable and are explicitly unsupported.
  format: text,
  // Used for hypothetical integer storage only; null means metadata is unknown.
  metadata_bytes: BytesSchema.nullable(),
});

export const SizingInputSchema = z
  .strictObject({
    catalog_version: text,
    extensions: SizingExtensionsSchema.optional(),
    model: z.strictObject({ id: text, revision: RevisionSchema }),
    weights: WeightStorageSchema,
    kv_cache: z.strictObject({ key_format: text, value_format: text }),
    workload: z.strictObject({
      // Includes prompt and generated tokens; output reserve is not added again.
      retained_tokens_per_sequence: count.max(16_777_216),
      concurrent_sequences: count.max(1024),
    }),
    hardware: z.strictObject({
      label: text,
      kind: z.enum(["discrete_gpu", "unified_memory", "cpu"]),
      backend: z.enum(["cuda", "rocm", "metal", "cpu"]),
      // The first slice describes a planning target, never an authenticated probe.
      evidence_kind: z.literal("user_declared"),
      capacity_bytes: BytesSchema.refine(
        (value) => value > 0,
        "capacity must be positive",
      ),
      // Explicit allocation limit BEFORE reserve; null does not mean all capacity.
      allocation_limit_bytes: BytesSchema.nullable(),
      reserve_bytes: BytesSchema,
      device_count: count.max(1024),
    }),
    placement: z.enum([
      "single_device",
      "unified_pool",
      "cpu_only",
      "tensor_parallel",
      "pipeline_parallel",
      "expert_parallel",
      "offload",
    ]),
    runtime: z.strictObject({
      name: text.nullable(),
      version: text.nullable(),
      basis: z.literal("user_assumption"),
      overhead_bytes: BytesSchema.nullable(),
      allocator_allowance_bytes: BytesSchema.nullable(),
    }),
    project_binding: z
      .strictObject({
        project_id: text,
        base_contract_digest: DigestSchema,
        workload_ref: text.nullable(),
        candidate_ref: text.nullable(),
        hardware_ref: text.nullable(),
      })
      .nullable(),
  })
  .superRefine((value, ctx) => {
    const hardware = value.hardware;
    if (
      hardware.allocation_limit_bytes !== null &&
      hardware.allocation_limit_bytes > hardware.capacity_bytes
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["hardware", "allocation_limit_bytes"],
        message: "allocation limit cannot exceed installed capacity",
      });
    }
    if (
      hardware.reserve_bytes >
      (hardware.allocation_limit_bytes ?? hardware.capacity_bytes)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["hardware", "reserve_bytes"],
        message:
          "reserve cannot exceed the selected allocation limit or installed capacity",
      });
    }
    const expectedBackend =
      hardware.kind === "unified_memory"
        ? "metal"
        : hardware.kind === "cpu"
          ? "cpu"
          : null;
    if (
      (expectedBackend !== null && hardware.backend !== expectedBackend) ||
      (hardware.kind === "discrete_gpu" &&
        !["cuda", "rocm"].includes(hardware.backend))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["hardware", "backend"],
        message: "backend does not match the selected memory type",
      });
    }
    if (
      ["fp32", "fp16", "bf16"].includes(value.weights.format) &&
      value.weights.metadata_bytes !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["weights", "metadata_bytes"],
        message:
          "floating-point tensor storage does not use the hypothetical quantization metadata input",
      });
    }
  });
export type SizingInput = z.infer<typeof SizingInputSchema>;

export const IssueSchema = z.strictObject({
  code: text,
  message: z.string().min(1).max(2048),
});
export type SizingIssue = z.infer<typeof IssueSchema>;

export const SizingResultSchema = z.strictObject({
  estimator_version: z.enum([ESTIMATOR_VERSION, EXTENDED_ESTIMATOR_VERSION]),
  catalog_version: z.literal(CATALOG_VERSION),
  status: z.enum(["calculated", "incomplete", "unsupported"]),
  model_profile: ModelProfileSchema.nullable(),
  memory: z.strictObject({
    weights_bytes: BytesSchema.nullable(),
    weights_lower_bound_bytes: BytesSchema.nullable(),
    kv_cache_bytes: BytesSchema.nullable(),
    runtime_overhead_bytes: BytesSchema.nullable(),
    allocator_allowance_bytes: BytesSchema.nullable(),
    known_lower_bound_bytes: BytesSchema,
    required_bytes: BytesSchema.nullable(),
    usable_budget_bytes: BytesSchema.nullable(),
    headroom_bytes: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    assessment: z.enum([
      "estimated_within_budget",
      "estimated_over_budget",
      "unknown",
    ]),
    pool_count: z.number().int().positive().max(16),
    unit: z.literal("bytes"),
  }),
  runtime_compatibility: z.literal("unknown"),
  contract_evidence: z.literal("unattached"),
  devices: z.array(DeviceEstimateSchema).min(2).max(16).optional(),
  performance: z.strictObject({
    status: z.enum(["unverified", "advisory_calibrated"]),
    estimated_decode_tokens_per_second: z.number().positive().nullable(),
    reason: z.string().min(1).max(2048),
  }),
  assumptions: z.array(z.string().min(1).max(2048)).max(64),
  exclusions: z.array(z.string().min(1).max(2048)).max(64),
  issues: z.array(IssueSchema).max(64),
});
export type SizingResult = z.infer<typeof SizingResultSchema>;

export const SizingArtifactSchema = z.strictObject({
  format: z.literal(SIZING_FORMAT),
  evaluated_at: timestamp,
  input: SizingInputSchema,
  input_digest: DigestSchema,
  dependency_digest: DigestSchema,
  result: SizingResultSchema,
  integrity_hash: DigestSchema,
});
export type SizingArtifact = z.infer<typeof SizingArtifactSchema>;

// A collection envelope for future detectors, never a project-contract Hardware.
const ObservedBytesSchema = z.strictObject({
  bytes: BytesSchema,
  evidence_kind: z.literal("deterministic_observation"),
  source: text,
});
export const ProbeArtifactSchema = z
  .strictObject({
    format: z.literal("anvilmark-hardware-probe/1"),
    observed_at: timestamp,
    detector_version: text,
    scope: z.enum(["host", "container", "process", "remote"]),
    status: z.enum([
      "complete",
      "partial",
      "unavailable",
      "unsupported",
      "failed",
    ]),
    cpu_cores: count.max(1_048_576).nullable(),
    physical_memory: ObservedBytesSchema.nullable(),
    devices: z
      .array(
        z.strictObject({
          // Opaque identifiers are local to this snapshot; never serial numbers.
          id: text,
          model: text,
          backend: z.enum(["cuda", "rocm", "metal", "unknown"]),
          memory_kind: z.enum(["dedicated", "shared", "unknown"]),
          installed_memory: ObservedBytesSchema.nullable(),
          available_memory: ObservedBytesSchema.nullable(),
          recommended_working_set: ObservedBytesSchema.nullable(),
        }),
      )
      .max(1024),
    diagnostics: z.array(IssueSchema).max(128),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === "complete" &&
      (value.cpu_cores === null || value.physical_memory === null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message: "complete inventory requires observed CPU and physical memory",
      });
    }
    if (
      new Set(value.devices.map((device) => device.id)).size !==
      value.devices.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["devices"],
        message: "device ids must be unique within a snapshot",
      });
    }
  });
export type ProbeArtifact = z.infer<typeof ProbeArtifactSchema>;
