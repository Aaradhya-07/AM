import { z } from "zod/v4";
import { ProbeSnapshotSchema } from "./probe.js";

const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(256);
export const EXTENDED_ESTIMATOR_VERSION = "0.2.0-draft.1" as const;
export const CalibrationSchema = z
  .strictObject({
    format: z.literal("anvilmark-decode-calibration/1"),
    id: text,
    source_url: z
      .url()
      .max(2048)
      .refine(
        (value) => /^https:\/\//.test(value),
        "Calibration sources must be HTTPS references",
      ),
    source_revision: text,
    methodology: z.string().min(20).max(2048),
    observed_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }),
    model_id: text,
    model_revision: z.string().regex(/^[a-f0-9]{40}$/),
    weight_format: z.enum(["bf16", "fp16", "fp32"]),
    key_format: z.enum(["bf16", "fp16", "fp32"]),
    value_format: z.enum(["bf16", "fp16", "fp32"]),
    hardware_sku: text,
    capacity_bytes: bytes.refine((n) => n > 0),
    backend: z.enum(["cuda", "rocm", "metal", "cpu"]),
    runtime: text,
    runtime_version: text,
    retained_tokens: z.number().int().positive().max(16_777_216),
    concurrent_sequences: z.literal(1),
    samples: z
      .array(
        z.strictObject({
          output_tokens: z.number().int().positive().max(1_048_576),
          decode_duration_ms: z.number().positive().max(86_400_000),
        }),
      )
      .min(3)
      .max(256),
  })
  .superRefine((value, context) => {
    if (Date.parse(value.expires_at) <= Date.parse(value.observed_at))
      context.addIssue({
        code: "custom",
        path: ["expires_at"],
        message: "Calibration needs a positive validity window",
      });
  });
export type DecodeCalibration = z.infer<typeof CalibrationSchema>;

export const PlacementDeviceSchema = z
  .strictObject({
    id: z.string().regex(/^device-[0-9]{1,4}$/),
    model: text,
    capacity_bytes: bytes.refine((n) => n > 0),
    allocation_limit_bytes: bytes.nullable(),
    reserve_bytes: bytes,
    layers: z.number().int().positive().max(1024),
    runtime_overhead_bytes: bytes.nullable(),
    allocator_allowance_bytes: bytes.nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.allocation_limit_bytes !== null &&
      value.allocation_limit_bytes > value.capacity_bytes
    )
      context.addIssue({
        code: "custom",
        path: ["allocation_limit_bytes"],
        message: "Allocation exceeds installed capacity",
      });
    if (
      value.reserve_bytes >
      (value.allocation_limit_bytes ?? value.capacity_bytes)
    )
      context.addIssue({
        code: "custom",
        path: ["reserve_bytes"],
        message: "Reserve exceeds allocation",
      });
  });
export const SizingExtensionsSchema = z
  .strictObject({
    format: z.literal("anvilmark-sizing-extensions/1"),
    observation: z
      .strictObject({
        snapshot: ProbeSnapshotSchema,
        selected_device_id: z
          .string()
          .regex(/^device-[0-9]{1,4}$/)
          .nullable(),
        trust: z.literal("unverified_import"),
      })
      .optional(),
    placement_profile: z.literal("contiguous-layer-residency/1").optional(),
    devices: z.array(PlacementDeviceSchema).min(2).max(16).optional(),
    hardware_sku: text.optional(),
    calibration: CalibrationSchema.optional(),
    calibration_as_of: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.placement_profile !== undefined) !==
      (value.devices !== undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "A placement profile and per-device budgets must be supplied together",
      });
    if (
      value.devices &&
      new Set(value.devices.map((d) => d.id)).size !== value.devices.length
    )
      context.addIssue({
        code: "custom",
        message: "Selected devices must be unique",
      });
    if (value.calibration && (!value.hardware_sku || !value.calibration_as_of))
      context.addIssue({
        code: "custom",
        message: "Calibration needs explicit hardware SKU and evaluation time",
      });
  });
export type SizingExtensions = z.infer<typeof SizingExtensionsSchema>;
export const DeviceEstimateSchema = z.strictObject({
  id: text,
  model: text,
  layers: z.number().int().positive(),
  weights_bytes: bytes,
  kv_cache_bytes: bytes,
  runtime_overhead_bytes: bytes.nullable(),
  allocator_allowance_bytes: bytes.nullable(),
  known_lower_bound_bytes: bytes,
  required_bytes: bytes.nullable(),
  usable_budget_bytes: bytes.nullable(),
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
});
