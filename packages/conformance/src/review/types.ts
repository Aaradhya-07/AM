/**
 * Structural views of review-bundle data for code that runs in the browser as
 * well as in Node. They list only what review tooling reads, so a bundle
 * parsed by either the strict Node reader or a loose browser reader fits.
 */

export interface ReviewPosition {
  readonly line: number;
  readonly column: number;
}

export interface ReviewLocation {
  readonly path: string;
  readonly start: ReviewPosition;
  readonly end?: ReviewPosition | undefined;
  readonly symbol?: string | null | undefined;
  readonly source_sha256?: string | undefined;
}

export interface ReviewTraceStep {
  readonly kind: string;
  readonly path?: string | undefined;
  readonly start?: ReviewPosition | undefined;
  readonly end?: ReviewPosition | undefined;
  readonly symbol?: string | null | undefined;
  readonly declaration_ref?: string | null | undefined;
}

export interface ReviewAlternative {
  readonly kind?: string | undefined;
  readonly summary: string;
  readonly details?: string | undefined;
}

export interface ReviewResult {
  readonly id?: string | undefined;
  readonly rule_ref: string;
  readonly rule_kind?: string | undefined;
  readonly verdict: string;
  readonly explanation: string;
  readonly standing?: string | undefined;
  readonly evidence_tier?: string | undefined;
  readonly constraint_ref?: string | null | undefined;
  readonly decision_ref?: string | null | undefined;
  readonly workload_ref?: string | null | undefined;
  readonly candidate_ref?: string | null | undefined;
  readonly architecture_node_ref?: string | null | undefined;
  readonly locations: readonly ReviewLocation[];
  readonly trace: readonly ReviewTraceStep[];
  readonly supported_scope?: string | undefined;
  readonly caveats?: readonly string[] | undefined;
  readonly unknown_reasons?: readonly string[] | undefined;
  readonly suggested_alternatives: readonly ReviewAlternative[];
}

/** Where an evidence gap was recorded in the project facts. */
export type EvidenceGapScope = "project" | "workload" | "selected_candidate";

export interface ReviewEvidenceGap {
  readonly scope: EvidenceGapScope;
  readonly workload_ref: string | null;
  readonly candidate_ref: string | null;
  readonly code: string;
  readonly constraint_ref: string | null;
  readonly subject: string;
  readonly required_floor: string;
  readonly admissible_kinds: readonly string[];
  readonly reason: string;
}
