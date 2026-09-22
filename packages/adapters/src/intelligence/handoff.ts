import { createHash } from "node:crypto";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";

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
import { ADAPTER_PROTOCOL_VERSION } from "../version.js";
import type { IntelligenceAdapter } from "./adapter.js";
import { parseProposalDocument } from "./adapter.js";
import type { OutboundProjection } from "./projection.js";
import type { IntelligenceProposal, IntelligenceRequest } from "./proposal.js";
import { IntelligenceRequestSchema } from "./proposal.js";
import {
  buildIntelligenceRequest,
  intelligenceRequestDigest,
} from "./request.js";

export const HANDOFF_FORMAT = "anvilmark-intelligence-handoff/0.1" as const;

export const HANDOFF_ADAPTER_ID = "handoff" as const;

export const DEFAULT_HANDOFF_MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * The file a user gives to Claude Code, Codex or any other agent.
 *
 * It is self-describing so the agent needs no ANVILMARK knowledge: the exact
 * request, where to write the answer, and how the answer will be checked. The
 * response is a bare intelligence proposal -- the same document an HTTP
 * provider returns -- so both mechanisms go through one validation path.
 */
export interface HandoffDocument {
  readonly format: typeof HANDOFF_FORMAT;
  readonly request_id: string;
  readonly request_digest: string;
  readonly created_at: string;
  /** Project-relative path the response must be written to. */
  readonly response_file: string;
  readonly how_to_respond: readonly string[];
  readonly request: IntelligenceRequest;
}

export function buildHandoffDocument(input: {
  readonly request: IntelligenceRequest;
  readonly requestId: string;
  readonly responseFile: string;
  readonly createdAt: string;
}): HandoffDocument {
  return {
    format: HANDOFF_FORMAT,
    request_id: input.requestId,
    request_digest: intelligenceRequestDigest(input.request),
    created_at: input.createdAt,
    response_file: input.responseFile,
    how_to_respond: [
      "Read request.instructions and request.projection below.",
      `Write ONE JSON object, exactly as the instructions describe, to ${input.responseFile}.`,
      "Do not edit .anvilmark/project.yaml or any other ANVILMARK file. The user imports your response, and ANVILMARK validates it before anything changes.",
      "Your response can only propose. It cannot approve, decide, set statuses, record measurements or change existing constraints; a response that tries is rejected as a whole.",
    ],
    request: input.request,
  };
}

/**
 * The structured file handoff mechanism.
 *
 * ANVILMARK writes a request file and later reads a response file; the
 * filesystem is the transport. This is how a coding agent the user already runs
 * -- Claude Code, Codex -- takes part without ANVILMARK holding its
 * credentials or calling its provider. ANVILMARK sends nothing itself, but the
 * agent may, so the request is projected under the REMOTE rules and the
 * identity reports `remote` execution.
 */
export function createHandoffAdapter(options: {
  /** Where the response is read from. */
  readonly responsePath: string;
  /** The digest of the request this response was exported for. */
  readonly expectedRequestDigest: string;
  readonly maxResponseBytes?: number;
  readonly clock?: Clock;
  readonly fs?: {
    readonly readFile?: (path: string) => Promise<Buffer>;
    readonly size?: (path: string) => Promise<number | null>;
  };
}): IntelligenceAdapter {
  const clock = options.clock ?? systemClock;
  const maxBytes =
    options.maxResponseBytes ?? DEFAULT_HANDOFF_MAX_RESPONSE_BYTES;
  const readFile = options.fs?.readFile ?? ((path: string) => fsReadFile(path));
  const size =
    options.fs?.size ??
    (async (path: string) => {
      try {
        return (await fsStat(path)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return null;
        }
        throw error;
      }
    });

  const identity: AdapterIdentity = Object.freeze({
    id: HANDOFF_ADAPTER_ID,
    kind: "intelligence",
    version: ADAPTER_PROTOCOL_VERSION,
    execution: "remote",
    protocol_version: ADAPTER_PROTOCOL_VERSION,
  });

  const describeProjection = (contract: ProjectContract): OutboundProjection =>
    buildIntelligenceRequest(contract, {
      task: "clarify_intent",
      execution: "remote",
    }).projection;

  const propose = async (
    request: IntelligenceRequest,
    proposeOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<AdapterOutcome<IntelligenceProposal>> => {
    const startedAt = clock();
    let rawHash: string | null = null;
    const meta = () => ({
      adapter: identity,
      started_at: startedAt,
      completed_at: clock(),
      provenance: {
        command_manifest: null,
        locator: null,
        raw_result_hash: rawHash,
      },
      diagnostics: [] as string[],
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
          "the intelligence request does not match the provider-neutral request schema",
        ),
      ]);
    }
    if (
      intelligenceRequestDigest(parsedRequest.data) !==
      options.expectedRequestDigest
    ) {
      return refuse("failed", [
        adapterError(
          "identity_mismatch",
          "the response was exported for a different request; export a new request instead of reusing a response",
        ),
      ]);
    }
    if (proposeOptions.signal?.aborted === true) {
      return refuse("failed", [
        adapterError("cancelled", "the import was cancelled"),
      ]);
    }

    let bytes: Buffer;
    try {
      const length = await size(options.responsePath);
      if (length === null) {
        return refuse("unavailable", [
          adapterError(
            "endpoint_unreachable",
            "no response file has been written yet; give the request file to your agent, then import again",
          ),
        ]);
      }
      if (length > maxBytes) {
        return refuse("failed", [
          adapterError(
            "output_too_large",
            `the response file exceeds ${maxBytes} bytes`,
          ),
        ]);
      }
      bytes = await readFile(options.responsePath);
    } catch {
      return refuse("failed", [
        adapterError("malformed_output", "the response file could not be read"),
      ]);
    }
    if (bytes.byteLength > maxBytes) {
      return refuse("failed", [
        adapterError(
          "output_too_large",
          `the response file exceeds ${maxBytes} bytes`,
        ),
      ]);
    }
    rawHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

    let document: unknown;
    try {
      document = JSON.parse(bytes.toString("utf8"));
    } catch {
      return refuse("failed", [
        adapterError(
          "malformed_output",
          "the response file is not a single JSON document",
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
