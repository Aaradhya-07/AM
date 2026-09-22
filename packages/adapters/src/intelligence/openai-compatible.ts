import { createHash } from "node:crypto";

import type { ProjectContract } from "@anvilmark/project-contract";
import { findSecrets } from "@anvilmark/project-contract";

import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import type {
  AdapterError,
  AdapterIdentity,
  AdapterOutcome,
  AdapterStanding,
} from "../envelope.js";
import { adapterError, available, notAvailable } from "../envelope.js";
import { sanitizeErrorMessage } from "../sanitize.js";
import { ADAPTER_PROTOCOL_VERSION } from "../version.js";
import type { IntelligenceAdapter } from "./adapter.js";
import { parseProposalDocument } from "./adapter.js";
import type { OutboundConsentVerifier } from "./consent.js";
import type { OutboundProjection } from "./projection.js";
import type { IntelligenceProposal, IntelligenceRequest } from "./proposal.js";
import { IntelligenceRequestSchema } from "./proposal.js";
import type { ValidatedRegistration } from "./registration.js";
import {
  buildIntelligenceRequest,
  intelligenceRequestDigest,
} from "./request.js";

/** The fixed system message. Everything project-specific is in the request. */
export const OPENAI_COMPATIBLE_SYSTEM_MESSAGE =
  "You are an intelligence adapter for ANVILMARK. The user message is a JSON request. Follow its instructions field exactly and reply with only the JSON object it describes.";

type FetchLike = (
  input: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly redirect: "error";
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Read the one field a proposal can come from, checking every level of the
 * chat-completions envelope before touching it.
 *
 * The body is untrusted: `null`, an array, a string or a partial object all
 * parse as JSON. Each is a malformed response, reported as an outcome rather
 * than allowed to throw out of `propose`.
 */
export function readChatCompletion(
  envelope: unknown,
):
  | { readonly content: string; readonly model: string | null }
  | { readonly problem: string } {
  if (!isRecord(envelope)) {
    return {
      problem: `the provider response is JSON ${envelope === null ? "null" : Array.isArray(envelope) ? "array" : typeof envelope}, not a chat-completions object`,
    };
  }
  const choices = envelope.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return {
      problem: "the provider response has no non-empty choices array",
    };
  }
  const first: unknown = choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    return {
      problem: "the provider response has no choices[0].message object",
    };
  }
  const content = first.message.content;
  if (typeof content !== "string") {
    return {
      problem: "the provider response has no choices[0].message.content string",
    };
  }
  const model =
    typeof envelope.model === "string" && envelope.model.length > 0
      ? envelope.model.slice(0, 256)
      : null;
  return { content, model };
}

/** Accept the whole content as JSON, or one fenced JSON block and nothing else. */
export function extractJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return JSON.parse(fenced === null ? trimmed : (fenced[1] ?? ""));
}

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ readonly bytes: Buffer } | { readonly tooLarge: true }> {
  if (response.body === null) {
    return { bytes: Buffer.alloc(0) };
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { tooLarge: true };
    }
    chunks.push(Buffer.from(value));
  }
  return { bytes: Buffer.concat(chunks) };
}

/**
 * An intelligence mechanism that calls a user-configured OpenAI-compatible
 * chat-completions endpoint: a local runtime such as Ollama, LM Studio or vLLM,
 * or a remote API the user holds a key for.
 *
 * Constructed by the HOST from a validated registration and, for a remote
 * provider, a consent verifier. A request cannot name an endpoint, a model, a
 * credential or an authorization; the strict request schema refuses any field
 * beyond the provider-neutral four.
 *
 * Nothing here is an ANVILMARK model or service. With no registration there is
 * no adapter, and the deterministic workflow does not need one.
 */
export function createOpenAiCompatibleAdapter(options: {
  readonly provider: ValidatedRegistration;
  /** Required for reach `remote`; a remote adapter without one sends nothing. */
  readonly consent: OutboundConsentVerifier | null;
  readonly readEnv?: (name: string) => string | undefined;
  readonly fetch?: FetchLike;
  readonly clock?: Clock;
}): IntelligenceAdapter {
  const { provider } = options;
  const registration = provider.registration;
  const clock = options.clock ?? systemClock;
  const readEnv = options.readEnv ?? ((name: string) => process.env[name]);
  const doFetch: FetchLike =
    options.fetch ?? ((input, init) => fetch(input, init));
  const execution = registration.reach;

  const identity: AdapterIdentity = Object.freeze({
    id: registration.id,
    kind: "intelligence",
    version: null,
    execution,
    protocol_version: ADAPTER_PROTOCOL_VERSION,
  });

  const describeProjection = (contract: ProjectContract): OutboundProjection =>
    buildIntelligenceRequest(contract, { task: "clarify_intent", execution })
      .projection;

  const propose = async (
    request: IntelligenceRequest,
    proposeOptions: {
      readonly signal?: AbortSignal;
      readonly timeoutMs?: number;
    } = {},
  ): Promise<AdapterOutcome<IntelligenceProposal>> => {
    const startedAt = clock();
    let observedModel: string | null = null;
    let rawHash: string | null = null;
    const diagnostics: string[] = [];
    const meta = () => ({
      adapter: { ...identity, version: observedModel },
      started_at: startedAt,
      completed_at: clock(),
      provenance: {
        command_manifest: null,
        locator: null,
        raw_result_hash: rawHash,
      },
      diagnostics,
    });
    const refuse = (
      standing: Exclude<AdapterStanding, "available">,
      errors: readonly AdapterError[],
    ): AdapterOutcome<IntelligenceProposal> =>
      notAvailable(standing, errors, meta());

    const parsedRequest = IntelligenceRequestSchema.safeParse(request);
    if (!parsedRequest.success) {
      return refuse("failed", [
        adapterError(
          "schema_rejected",
          "the intelligence request does not match the provider-neutral request schema; a request cannot carry endpoints, credentials or authorizations",
          {
            problems: parsedRequest.error.issues.map((entry) =>
              entry.path.join("."),
            ),
          },
        ),
      ]);
    }
    const exact = parsedRequest.data;
    if (findSecrets(exact).length > 0) {
      return refuse("failed", [
        adapterError(
          "secret_detected",
          "the request contains a secret-shaped value and was not sent",
        ),
      ]);
    }

    let credential: string | null = null;
    if (registration.credential_env !== null) {
      const value = readEnv(registration.credential_env);
      if (value === undefined || value.length === 0) {
        return refuse("unavailable", [
          adapterError(
            "credential_missing",
            `the registered credential variable ${registration.credential_env} is not set, so nothing was sent`,
            { credential_env: registration.credential_env },
          ),
        ]);
      }
      credential = value;
    }

    // Consent is checked last, against what is about to be sent, so a refusal
    // for any other reason never uses it up.
    if (execution === "remote") {
      const problem =
        options.consent === null
          ? "this remote provider was constructed without a consent verifier, so it cannot send"
          : options.consent.consume({
              provider_id: registration.id,
              destination: provider.destination,
              registration_digest: provider.digest,
              request_digest: intelligenceRequestDigest(exact),
            });
      if (problem !== null) {
        return refuse("failed", [
          adapterError("authorization_required", problem, {
            provider_id: registration.id,
            destination: provider.destination,
          }),
        ]);
      }
    }

    const timeoutMs = Math.min(
      registration.timeout_ms,
      proposeOptions.timeoutMs ?? registration.timeout_ms,
    );
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    if (proposeOptions.signal?.aborted === true) {
      controller.abort();
    }
    proposeOptions.signal?.addEventListener("abort", onAbort, { once: true });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (credential !== null) {
      headers.authorization = `Bearer ${credential}`;
    }
    const body = JSON.stringify({
      model: registration.model,
      stream: false,
      messages: [
        { role: "system", content: OPENAI_COMPATIBLE_SYSTEM_MESSAGE },
        { role: "user", content: JSON.stringify(exact) },
      ],
      ...(registration.json_response_format
        ? { response_format: { type: "json_object" } }
        : {}),
    });

    const transportFailure = (error: unknown) => {
      if (timedOut) {
        return refuse("timed_out", [
          adapterError(
            "timed_out",
            `the provider did not answer within ${timeoutMs} ms`,
          ),
        ]);
      }
      if (proposeOptions.signal?.aborted === true) {
        return refuse("failed", [
          adapterError("cancelled", "the request was cancelled"),
        ]);
      }
      const message = error instanceof Error ? error.message : String(error);
      const cause =
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : "";
      if (/redirect/i.test(`${message} ${cause}`)) {
        return refuse("failed", [
          adapterError(
            "http_error",
            "the provider answered with a redirect, which is refused because it would change the declared destination",
          ),
        ]);
      }
      return refuse("unavailable", [
        adapterError(
          "endpoint_unreachable",
          `the provider at ${provider.destination} could not be reached: ${sanitizeErrorMessage(cause === "" ? message : cause)}`,
          { destination: provider.destination },
        ),
      ]);
    };

    try {
      let response: Response;
      try {
        response = await doFetch(provider.endpoint, {
          method: "POST",
          headers,
          body,
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        return transportFailure(error);
      }

      let read: Awaited<ReturnType<typeof readCapped>>;
      try {
        read = await readCapped(response, registration.max_response_bytes);
      } catch (error) {
        return transportFailure(error);
      }
      if ("tooLarge" in read) {
        return refuse("failed", [
          adapterError(
            "output_too_large",
            `the response exceeded ${registration.max_response_bytes} bytes`,
          ),
        ]);
      }
      rawHash = `sha256:${createHash("sha256").update(read.bytes).digest("hex")}`;
      const text = read.bytes.toString("utf8");

      if (response.status >= 300 && response.status < 400) {
        return refuse("failed", [
          adapterError(
            "http_error",
            "the provider answered with a redirect, which is refused because it would change the declared destination",
            { status: response.status },
          ),
        ]);
      }
      if (!response.ok) {
        return refuse("failed", [
          adapterError(
            "http_error",
            `the provider answered HTTP ${response.status}: ${sanitizeErrorMessage(text.slice(0, 300))}`,
            { status: response.status },
          ),
        ]);
      }

      let envelope: unknown;
      try {
        envelope = JSON.parse(text);
      } catch {
        return refuse("failed", [
          adapterError("malformed_output", "the provider response is not JSON"),
        ]);
      }
      const shape = readChatCompletion(envelope);
      if ("problem" in shape) {
        return refuse("failed", [
          adapterError("malformed_output", shape.problem),
        ]);
      }
      observedModel = shape.model;
      const content = shape.content;

      let document: unknown;
      try {
        document = extractJsonContent(content);
      } catch {
        return refuse("failed", [
          adapterError(
            "malformed_output",
            "the model reply is not a single JSON object; a proposal must be structured JSON, not prose",
          ),
        ]);
      }
      if (findSecrets(document).length > 0) {
        return refuse("failed", [
          adapterError(
            "secret_detected",
            "the proposal contains a secret-shaped value and was discarded",
          ),
        ]);
      }
      const parsed = parseProposalDocument(document);
      if (!parsed.ok) {
        return refuse("failed", parsed.errors);
      }
      return available(parsed.proposal, meta());
    } finally {
      clearTimeout(timer);
      proposeOptions.signal?.removeEventListener("abort", onAbort);
    }
  };

  return {
    identity,
    capabilities: {
      clarify_intent: true,
      propose_constraints: true,
      propose_candidates: true,
      explain_tradeoffs: true,
      propose_architecture: true,
    },
    describeProjection,
    propose,
  };
}
