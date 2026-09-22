import { z } from "zod/v4";

import { IdSchema, NonEmptyStringSchema, RefSchema } from "./primitives.js";

export const AcceleratorSchema = z.strictObject({
  vendor: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  vram_gb: z.number().positive(),
  count: z.int().positive().default(1),
});

export type Accelerator = z.infer<typeof AcceleratorSchema>;

export const CpuSchema = z.strictObject({
  cores: z.int().positive(),
  model: NonEmptyStringSchema.nullable().default(null),
});

/**
 * How this hardware entry came to be known. This is the load-bearing
 * distinction from doc 06 section 6 and section 8: a machine the user
 * DECLARES they own or plan to buy is a different subject from a machine
 * ANVILMARK DETECTED while running. Detected hardware must never silently
 * replace a declared target, so the two are separate entries with separate
 * ids rather than one mutable record.
 */
export const HardwareEvidenceKindSchema = z.enum([
  /** T1 user declaration; authoritative for what the user owns or plans. */
  "user_declared",
  /** T3 deterministic observation of the machine ANVILMARK is running on. */
  "deterministic_observation",
]);

export type HardwareEvidenceKind = z.infer<typeof HardwareEvidenceKindSchema>;

export const HardwareSchema = z.strictObject({
  id: IdSchema,
  evidence_kind: HardwareEvidenceKindSchema,
  cpu: CpuSchema,
  ram_gb: z.number().positive(),
  accelerators: z.array(AcceleratorSchema).default([]),
  /**
   * The inference backend this machine offers, e.g. `cuda`, `metal`, `rocm`,
   * `cpu`. Decision 06 section 8 makes a backend mismatch produce `unknown`,
   * so the backend has to be recordable on both the declared target and the
   * detected machine for that rule to mean anything.
   */
  backend: NonEmptyStringSchema.nullable().default(null),
  operating_system: z.enum(["linux", "macos", "windows", "other"]),
  evidence_refs: z.array(RefSchema).default([]),
});

export type Hardware = z.infer<typeof HardwareSchema>;

export const BudgetSchema = z.strictObject({
  /** ISO 4217 alphabetic code. */
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 code"),
  period: z.enum(["day", "month", "year"]),
  amount: z.number().nonnegative(),
  /** What the budget covers, e.g. `ai_inference_and_ai_specific_infrastructure`. */
  scope: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_]*$/, "budget scope must be lower_snake_case"),
});

export type Budget = z.infer<typeof BudgetSchema>;

export const ResourcesSchema = z.strictObject({
  hardware: z.array(HardwareSchema).default([]),
  budgets: z.array(BudgetSchema).default([]),
});

export type Resources = z.infer<typeof ResourcesSchema>;
