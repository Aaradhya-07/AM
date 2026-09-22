import { createHash } from "node:crypto";

import type { ProjectContract } from "@anvilmark/project-contract";
import {
  PROJECT_SCHEMA_VERSION,
  stableStringify,
} from "@anvilmark/project-contract";

/**
 * The generator identity recorded in every artifact and MCP response.
 *
 * Bump the version whenever the facts, a projection or a renderer changes
 * output for the same contract: freshness checks compare it, so a generator
 * change marks existing artifacts stale instead of silently leaving old output
 * labelled current.
 */
export const GENERATOR_ID = "anvilmark-context" as const;
export const GENERATOR_VERSION = "0.1.0-draft.2" as const;

export type ProjectionName = "remote-default" | "local-disclosed";

/**
 * `sha256:` over the canonical bytes of the parsed contract.
 *
 * Canonical rather than the file bytes: a YAML comment or re-indentation does
 * not change any fact, so it does not make generated output stale, while any
 * change to any field -- approved or not, recorded in `contract_revision` or
 * not -- changes the hash.
 */
export function contractHash(contract: ProjectContract): string {
  return `sha256:${createHash("sha256").update(stableStringify(contract), "utf8").digest("hex")}`;
}

export function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * What an output was generated from, and how.
 *
 * `as_of` is the instant at which time-dependent standings -- evidence
 * freshness and exception expiry -- were evaluated. It is supplied explicitly
 * by the caller; it is never read from the clock inside a renderer and it is
 * not `project.updated_at`. The same contract, generator, projection and
 * `as_of` always produce the same bytes.
 */
export interface SourceMarker {
  readonly project_id: string;
  readonly contract_revision: number;
  /**
   * The committed CLI state revision (`rN`) whose snapshot `project.yaml`
   * matches, or null when it matches none (edited outside the CLI, or read
   * without history). `contract_revision` only advances on approval, so this is
   * the finer-grained revision; `contract_hash` identifies the content either way.
   */
  readonly state_revision: number | null;
  readonly contract_hash: string;
  readonly schema_version: string;
  readonly generator: string;
  readonly projection: ProjectionName;
  readonly as_of: string;
}

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * An `as_of` is written into comments, headers and metadata verbatim, so it
 * must be a plain RFC 3339 timestamp with an explicit offset -- nothing a
 * renderer would have to escape.
 */
export function assertTimestamp(value: string): void {
  if (!TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(
      `as_of ${JSON.stringify(value)} is not an RFC 3339 timestamp with an explicit offset, e.g. 2026-09-14T00:00:00Z`,
    );
  }
}

export function sourceMarker(
  contract: ProjectContract,
  options: {
    readonly asOf: string;
    readonly projection: ProjectionName;
    readonly stateRevision?: number | null;
  },
): SourceMarker {
  assertTimestamp(options.asOf);
  return {
    project_id: contract.project.id,
    contract_revision: contract.project.contract_revision,
    state_revision: options.stateRevision ?? null,
    contract_hash: contractHash(contract),
    schema_version: PROJECT_SCHEMA_VERSION,
    generator: `${GENERATOR_ID}/${GENERATOR_VERSION}`,
    projection: options.projection,
    as_of: options.asOf,
  };
}
