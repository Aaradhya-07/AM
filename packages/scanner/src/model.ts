import { createHash } from "node:crypto";

import { stableStringify } from "@anvilmark/project-contract";

/**
 * Shared vocabulary of the scanner. Every location is repository-relative,
 * with 1-based lines and columns; no absolute path is ever part of a result.
 */

export interface Position {
  readonly line: number;
  readonly column: number;
}

export interface Span {
  readonly path: string;
  readonly start: Position;
  readonly end: Position;
}

export interface SourceLocation {
  readonly span: Span;
  /** The enclosing named declaration, e.g. `classify` or `Service.send`; null at module level. */
  readonly symbol: string | null;
  /** `sha256:` of the observed file's exact bytes. */
  readonly source_sha256: string;
}

/**
 * Why the scanner could not establish a fact. These are analysis unknowns,
 * separate from read, parse and configuration errors.
 */
export const UNKNOWN_REASONS = [
  "unresolved_any",
  "unresolved_import",
  "runtime_selected_import",
  "runtime_selected_provider",
  "runtime_selected_endpoint",
  "runtime_selected_model",
  "request_transport_unresolved",
  "dynamic_property_access",
  "dynamic_dispatch",
  "call_depth_exceeded",
  "recursive_call",
  "callback_not_followed",
  "reflection_or_code_generation",
  "unmodelled_handoff",
  "unmodelled_network_hop",
  "unsupported_provider_sdk",
  "external_call_not_modelled",
  "parameter_value_from_caller",
  "captured_variable_not_tracked",
  "property_not_tracked",
  "unsupported_construct",
  "possible_provider_operation_unresolved",
  "analysis_budget_exceeded",
] as const;

export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

/**
 * How a result was established. This is the LOCAL scanner taxonomy; see
 * `contractDiscoveryKind` for the only mapping onto the draft.5
 * `RepositoryBinding.discovery.kind` enumeration.
 */
export const DISCOVERY_KINDS = [
  /** Established by the compiler: resolved module, symbol, signature and span. */
  "deterministic_observation",
  /** A user-authored scan declaration applied to resolved files and symbols. */
  "declared_mapping",
  /** A structural guess with no declaration behind it. Never an agent assertion. */
  "heuristic_association",
  /** Nothing could be established. */
  "unresolved",
] as const;

export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];

export function sha256(text: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** A stable id from its defining parts: same parts, same id, on every run. */
export function stableId(prefix: string, parts: unknown): string {
  const digest = createHash("sha256")
    .update(stableStringify(parts), "utf8")
    .digest("hex");
  return `${prefix}.${digest.slice(0, 20)}`;
}

export function compareSpans(left: Span, right: Span): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  return (
    left.start.line - right.start.line ||
    left.start.column - right.start.column ||
    left.end.line - right.end.line ||
    left.end.column - right.end.column
  );
}

export function spanKey(span: Span): string {
  return `${span.path}:${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}

export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
