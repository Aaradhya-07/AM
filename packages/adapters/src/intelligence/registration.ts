import { createHash } from "node:crypto";

import { findSecrets, stableStringify } from "@anvilmark/project-contract";
import { z } from "zod/v4";

/**
 * A user-configured intelligence provider, as registered by TRUSTED HOST
 * configuration.
 *
 * This is the vetted, host-owned catalogue Milestone 2 required before any
 * outbound execution is exposed: reach, destination and the credential name a
 * provider may read come from here and nowhere else. A project contract, an
 * intelligence request and an intelligence proposal have no field that can
 * register a provider, change its destination or grant it a credential.
 *
 * `destination` is DECLARED POLICY, derived from `base_url`. ANVILMARK does not
 * observe the network; it refuses redirects so the declared host is at least
 * the host it connects to, and it says so rather than claiming a sandbox.
 */
export const OpenAiCompatibleRegistrationSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/,
      "a provider id is lower-case letters, digits, '.', '_' or '-'",
    ),
  mechanism: z.literal("openai_compatible"),
  /** Chat-completions base URL, e.g. `http://127.0.0.1:11434/v1`. */
  base_url: z.string().min(1).max(2048),
  model: z.string().min(1).max(256),
  /** `local` is only accepted for a loopback destination. */
  reach: z.enum(["local", "remote"]),
  /**
   * The ONE environment variable whose value is sent as a bearer token, or
   * null. Its value is read at send time and never stored or logged.
   */
  credential_env: z
    .string()
    .regex(
      /^[A-Z_][A-Z0-9_]*$/,
      "credential_env must be an environment variable name",
    )
    .nullable()
    .default(null),
  /** Whether using this provider may cost the user money. Shown before sending. */
  cost: z
    .enum(["may_incur_cost", "no_provider_charge", "unknown"])
    .default("unknown"),
  timeout_ms: z.int().min(1_000).max(600_000).default(120_000),
  max_response_bytes: z
    .int()
    .min(1_024)
    .max(8 * 1024 * 1024)
    .default(1024 * 1024),
  /** Send `response_format: { type: "json_object" }`. Not every server supports it. */
  json_response_format: z.boolean().default(false),
});

export type OpenAiCompatibleRegistration = z.infer<
  typeof OpenAiCompatibleRegistrationSchema
>;

/** Environment names a registration may never nominate as its credential. */
const FORBIDDEN_CREDENTIAL_NAMES = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "PWD",
  "TMPDIR",
  "NODE_OPTIONS",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export interface ValidatedRegistration {
  readonly registration: OpenAiCompatibleRegistration;
  /** Lower-case `host[:port]`: the declared destination. */
  readonly destination: string;
  /** `sha256:` over the canonical registration, which consent binds. */
  readonly digest: string;
  /** The exact chat-completions endpoint the adapter will call. */
  readonly endpoint: string;
}

/**
 * Validate one registration and derive what outbound checks bind to.
 *
 * Refused: a malformed shape; a non-http(s) URL; credentials, a query or a
 * fragment in the URL; plain http to a non-loopback host (a bearer token would
 * cross the network in clear text); `reach: local` for a non-loopback host,
 * which would skip consent for data that leaves the machine; a credential name
 * the process itself depends on; and any secret-shaped value.
 */
export function validateRegistration(
  raw: unknown,
):
  | { readonly ok: true; readonly value: ValidatedRegistration }
  | { readonly ok: false; readonly problems: readonly string[] } {
  const parsed = OpenAiCompatibleRegistrationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map(
        (entry) =>
          `${entry.path.length === 0 ? "<registration>" : entry.path.join(".")}: ${entry.message}`,
      ),
    };
  }
  const registration = parsed.data;
  const problems: string[] = [];

  if (findSecrets(registration).length > 0) {
    problems.push(
      "the registration contains a secret-shaped value; name the credential with credential_env instead of pasting it",
    );
  }

  let url: URL | null = null;
  try {
    url = new URL(registration.base_url);
  } catch {
    problems.push("base_url is not a valid URL");
  }

  if (url !== null) {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      problems.push("base_url must use http or https");
    }
    if (url.username !== "" || url.password !== "") {
      problems.push("base_url must not embed credentials");
    }
    if (url.search !== "" || url.hash !== "") {
      problems.push("base_url must not carry a query string or fragment");
    }
    const loopback = isLoopbackHost(url.hostname);
    if (url.protocol === "http:" && !loopback) {
      problems.push(
        "plain http is only accepted for a loopback host; use https for a remote provider",
      );
    }
    if (registration.reach === "local" && !loopback) {
      problems.push(
        `reach "local" requires a loopback host, but base_url names "${url.hostname}"; a provider on another machine is remote and needs consent before anything is sent`,
      );
    }
  }

  if (
    registration.credential_env !== null &&
    (FORBIDDEN_CREDENTIAL_NAMES.has(registration.credential_env) ||
      registration.credential_env.startsWith("ANVILMARK_"))
  ) {
    problems.push(
      `credential_env "${registration.credential_env}" is not a credential variable ANVILMARK will read`,
    );
  }

  if (problems.length > 0 || url === null) {
    return { ok: false, problems };
  }

  const base = url.href.endsWith("/") ? url.href : `${url.href}/`;
  return {
    ok: true,
    value: {
      registration,
      destination: url.host.toLowerCase(),
      digest: `sha256:${createHash("sha256").update(stableStringify(registration), "utf8").digest("hex")}`,
      endpoint: new URL("chat/completions", base).href,
    },
  };
}
