import { z } from "zod/v4";

import { sanitizeErrorMessage, sanitizeStructured } from "./sanitize.js";
import { ADAPTER_PROTOCOL_VERSION } from "./version.js";

/**
 * How an adapter invocation ended.
 *
 * These are deliberately distinct. "The tool is not installed" and "the tool
 * ran and failed" and "the tool ran but its answer does not apply to this
 * target" are different facts, and collapsing them would hide the difference
 * between an evidence gap and a broken environment. None of them is a pass.
 */
export const ADAPTER_STANDINGS = [
  /** Ran and produced a usable, validated result. */
  "available",
  /** The tool is not installed or not reachable. An evidence gap, not a failure. */
  "unavailable",
  /** Installed, but cannot answer this question (wrong version, missing capability). */
  "unsupported",
  /** Ran and failed: non-zero exit, malformed output, or rejected result. */
  "failed",
  /** Exceeded its deadline and was terminated. */
  "timed_out",
  /** Ran, but the result cannot be attributed to the requested subject. */
  "unknown",
] as const;

export const AdapterStandingSchema = z.enum(ADAPTER_STANDINGS);
export type AdapterStanding = z.infer<typeof AdapterStandingSchema>;

/** Where the adapter executed. Remote execution means data left the machine. */
export const ExecutionLocalitySchema = z.enum(["local", "remote"]);
export type ExecutionLocality = z.infer<typeof ExecutionLocalitySchema>;

export const AdapterKindSchema = z.enum([
  "intelligence",
  "evaluation",
  "hardware_fit",
  "manual_import",
]);
export type AdapterKind = z.infer<typeof AdapterKindSchema>;

/**
 * Who produced a result.
 *
 * `version` is the EXACT version observed at run time, not a declared or
 * expected one. A null version means the adapter could not establish it, which
 * is itself a reason to distrust the result.
 */
export const AdapterIdentitySchema = z.strictObject({
  id: z.string().min(1),
  kind: AdapterKindSchema,
  version: z.string().min(1).nullable(),
  execution: ExecutionLocalitySchema,
  protocol_version: z.literal(ADAPTER_PROTOCOL_VERSION),
});
export type AdapterIdentity = z.infer<typeof AdapterIdentitySchema>;

export const ADAPTER_ERROR_CODES = [
  "executable_not_found",
  "spawn_failed",
  "non_zero_exit",
  "timed_out",
  "cancelled",
  "output_too_large",
  "malformed_output",
  "schema_rejected",
  "version_unavailable",
  "version_unsupported",
  "identity_mismatch",
  /** An output path would escape the adapter-controlled directory. */
  "unsafe_output_path",
  /** A caller supplied an argument the adapter will not pass through. */
  "unsupported_argument",
  /** A credential name collides with an adapter-owned environment variable. */
  "reserved_environment_name",
  /** A result artifact exceeded the size the adapter will read. */
  "artifact_too_large",
  /** A result could not be attributed to exactly one candidate. */
  "ambiguous_attribution",
  /** An identity digest was not a well-formed algorithm-qualified digest. */
  "malformed_identity",
  /** The adapter could not confirm its own working directory was removed. */
  "cleanup_failed",
  /** The configuration is outside the supported subset this adapter parses. */
  "unsupported_configuration",
  "secret_detected",
  "attribution_missing",
  "forbidden_proposal",
  "projection_denied",
  /**
   * A remote provider was asked to run without a matching human authorization
   * for the exact outbound projection.
   */
  "authorization_required",
  /** The provider is not one this adapter was constructed to be allowed to run. */
  "provider_not_registered",
  /**
   * The evaluation names a credential variable that trusted provider policy
   * does not allow the provider to read.
   */
  "credential_not_permitted",
  /**
   * The adapter was constructed with policy it cannot enforce -- a malformed
   * provider registration, or a non-finite or negative time limit -- so it
   * refuses to run anything.
   */
  "invalid_adapter_policy",
  /**
   * The resolved launcher file no longer hashes to the digest taken when the
   * adapter was constructed -- before the probe, before the run, or after it.
   */
  "executable_changed",
  /**
   * A request asked for a resource limit that is not a positive integer or
   * exceeds the adapter's construction-time ceiling.
   */
  "invalid_resource_limit",
  "missing_attribution_source",
  /** A configured endpoint could not be reached at all. An availability gap. */
  "endpoint_unreachable",
  /** An endpoint answered with a non-success HTTP status or a redirect. */
  "http_error",
  /** A registered credential variable is not set in the environment. */
  "credential_missing",
  "adapter_internal_error",
] as const;

export const AdapterErrorCodeSchema = z.enum(ADAPTER_ERROR_CODES);
export type AdapterErrorCode = z.infer<typeof AdapterErrorCodeSchema>;

/** A structured, already-sanitized adapter error. */
export const AdapterErrorSchema = z.strictObject({
  code: AdapterErrorCodeSchema,
  message: z.string().min(1),
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type AdapterError = z.infer<typeof AdapterErrorSchema>;

/**
 * A command line with every argument value that could carry a credential
 * replaced. This is what gets persisted as an evidence source locator; the
 * real command line never is.
 */
export const CommandManifestSchema = z.strictObject({
  executable: z.string().min(1),
  arguments: z.array(z.string()),
  /** Names only. Values are never recorded. */
  environment_names: z.array(z.string()),
  working_directory: z.string().nullable(),
});
export type CommandManifest = z.infer<typeof CommandManifestSchema>;

export const ProvenanceSchema = z.strictObject({
  /** Redacted command line, when the adapter ran a subprocess. */
  command_manifest: CommandManifestSchema.nullable().default(null),
  /** Source locator, when the fact came from a document or endpoint. */
  locator: z.string().min(1).nullable().default(null),
  /** SHA-256 of the exact raw result the adapter saw, before any mapping. */
  raw_result_hash: z.string().min(1).nullable().default(null),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

interface OutcomeMeta {
  readonly adapter: AdapterIdentity;
  readonly started_at: string;
  readonly completed_at: string;
  readonly provenance: Provenance;
  /** Sanitized. Safe to persist and safe to show a user. */
  readonly diagnostics: readonly string[];
}

/**
 * The result of one adapter invocation.
 *
 * A discriminated union rather than an optional `value`: a caller cannot read
 * a result without first establishing that the adapter actually succeeded, and
 * there is no shape in which a failed adapter carries a usable value.
 */
export type AdapterOutcome<T> =
  | ({
      readonly standing: "available";
      readonly value: T;
      readonly errors: readonly [];
    } & OutcomeMeta)
  | ({
      readonly standing: Exclude<AdapterStanding, "available">;
      readonly errors: readonly AdapterError[];
    } & OutcomeMeta);

export function available<T>(value: T, meta: OutcomeMeta): AdapterOutcome<T> {
  return { standing: "available", value, errors: [], ...meta };
}

export function notAvailable<T>(
  standing: Exclude<AdapterStanding, "available">,
  errors: readonly AdapterError[],
  meta: OutcomeMeta,
): AdapterOutcome<T> {
  return { standing, errors, ...meta };
}

/**
 * Build a structured error with both halves sanitized.
 *
 * An error message is one of the likeliest places for a credential to escape:
 * it usually quotes whatever went wrong, and it usually ends up in a log or a
 * bug report. Sanitizing at construction means no caller has to remember to.
 */
export function adapterError(
  code: AdapterErrorCode,
  message: string,
  detail: Record<string, unknown> = {},
): AdapterError {
  return {
    code,
    message: sanitizeErrorMessage(message),
    detail: sanitizeStructured(detail, "detail") as Record<string, unknown>,
  };
}

/** Narrowing helper so callers do not reach for `value` on a failed outcome. */
export function isAvailable<T>(
  outcome: AdapterOutcome<T>,
): outcome is Extract<AdapterOutcome<T>, { standing: "available" }> {
  return outcome.standing === "available";
}

export type { OutcomeMeta };
