import { z } from "zod";

// A read-only projection of the local CLI's DevelopmentRun v1. This deliberately
// does not accept application contracts, reviews or generic report JSON. Parsing
// establishes display compatibility, never authenticity or current approval.
const text = z.string().min(1).max(4096);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const check = z.object({
  name: text,
  argv: z.array(text).min(1).max(100),
  exit_code: z.number().int().nullable(),
  duration_ms: z.number().nonnegative(),
});
const recordSchema = z.object({
  schema_version: z.literal(1),
  id: text,
  plan_hash: hash,
  architecture_id: text,
  task_id: text,
  candidate_id: text,
  configured_model: text,
  model_identity: z.enum([
    "tool_reported",
    "tool_reported_multiple",
    "configured_only",
  ]),
  model_events: z
    .array(
      z.object({ event_index: z.number().int().nonnegative(), model: text }),
    )
    .max(10000),
  approval_at_start: z.enum(["current", "missing_or_stale"]),
  approval_actor_at_start: z
    .enum(["interactive_local_operator", "agent_test_operator"])
    .nullable()
    .optional(),
  started_at: z.string().datetime({ offset: true }),
  finished_at: z.string().datetime({ offset: true }),
  agent_exit_code: z.number().int().nullable(),
  base_commit: z.string().regex(/^[a-f0-9]{40,64}$/),
  change_sha256: hash,
  changed_paths: z.array(text).max(10000),
  checks: z.array(check).max(1000),
  billing: z.enum(["subscription_allowance", "api_rate_estimate"]),
  estimated_usd_from_observed_tokens: z.number().nonnegative().nullable(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    cached_input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    reasoning_output_tokens: z.number().int().nonnegative(),
  }),
  architecture_check: z
    .object({ violations: z.array(text).max(10000) })
    .optional(),
  diff_check: check.optional(),
});

export type DevelopmentRecord = z.infer<typeof recordSchema>;
export const MAX_RECORD_BYTES = 2 * 1024 * 1024;

export function parseDevelopmentRecord(raw: unknown): DevelopmentRecord {
  const result = recordSchema.safeParse(raw);
  if (!result.success)
    throw new Error(
      "This is not a supported development-run v1 file. Select a run from .anvilmark/development/runs/. Application-contract bundles and development reports use different formats.",
    );
  return result.data;
}

export function recordedCheckStanding(
  run: DevelopmentRecord,
): "failed" | "passed" | "unknown" {
  const checks = [...run.checks, ...(run.diff_check ? [run.diff_check] : [])];
  if (
    (run.agent_exit_code !== null && run.agent_exit_code !== 0) ||
    checks.some((c) => c.exit_code !== null && c.exit_code !== 0) ||
    run.architecture_check?.violations.length
  )
    return "failed";
  if (
    run.agent_exit_code === null ||
    checks.length === 0 ||
    checks.some((c) => c.exit_code === null)
  )
    return "unknown";
  return "passed";
}

export function recordedCost(run: DevelopmentRecord): string {
  // A declared subscription can never become a cash measurement merely because
  // an imported payload also carries a numeric estimate.
  if (
    run.billing === "subscription_allowance" ||
    run.estimated_usd_from_observed_tokens === null
  )
    return "Unknown";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(run.estimated_usd_from_observed_tokens);
}
