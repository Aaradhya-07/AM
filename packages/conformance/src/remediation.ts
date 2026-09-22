import type { RemediationAlternative } from "./schemas.js";

/**
 * Suggested alternatives (Milestone 6):
 *
 * When a rule fails, suggest ONLY an already approved or explicitly proposed
 * alternative, such as:
 * - call the approved provider candidate;
 * - pass the declared sanitizer output rather than the raw source;
 * - restore the approved local candidate.
 *
 * Do not generate or present an unvalidated replacement as approved remediation.
 */

export function suggestProviderAlternatives(params: {
  readonly workloadRef: string;
  readonly approvedCandidateRef: string | null;
  readonly allowedCandidateRefs?: readonly string[];
  /** What the code was observed to call, e.g. "groq (chat.completions.create) at app/route.ts:26". */
  readonly observed: string;
  readonly provider: string;
  readonly isLocalApproved?: boolean;
}): RemediationAlternative[] {
  const alternatives: RemediationAlternative[] = [];

  if (params.approvedCandidateRef !== null) {
    if (params.isLocalApproved) {
      alternatives.push({
        kind: "restore_approved_local_candidate",
        summary: `Restore the approved local candidate '${params.approvedCandidateRef}' for workload '${params.workloadRef}'`,
        candidate_ref: params.approvedCandidateRef,
        component_ref: null,
        details: `The approved decision selects local candidate '${params.approvedCandidateRef}', but code invokes ${params.observed}.`,
      });
    } else {
      alternatives.push({
        kind: "call_approved_candidate",
        summary: `Call the approved candidate '${params.approvedCandidateRef}' for workload '${params.workloadRef}'`,
        candidate_ref: params.approvedCandidateRef,
        component_ref: null,
        details: `The approved decision selects candidate '${params.approvedCandidateRef}', but code invokes ${params.observed}.`,
      });
    }
  } else if (
    params.allowedCandidateRefs !== undefined &&
    params.allowedCandidateRefs.length > 0
  ) {
    for (const allowed of params.allowedCandidateRefs) {
      alternatives.push({
        kind: "use_allowed_candidate",
        summary: `Use allowed candidate '${allowed}' for workload '${params.workloadRef}'`,
        candidate_ref: allowed,
        component_ref: null,
        details: `Workload '${params.workloadRef}' allows candidate '${allowed}'.`,
      });
    }
  }

  return alternatives;
}

export function suggestDataflowAlternatives(params: {
  readonly dataClassification: string;
  readonly trustBoundary: string;
  readonly passesThroughComponents: readonly string[];
}): RemediationAlternative[] {
  const alternatives: RemediationAlternative[] = [];

  for (const component of params.passesThroughComponents) {
    alternatives.push({
      kind: "pass_through_sanitizer",
      summary: `Pass data through the declared sanitizer '${component}' before transmitting '${params.dataClassification}' to '${params.trustBoundary}'`,
      candidate_ref: null,
      component_ref: component,
      details: `Raw data of classification '${params.dataClassification}' must not reach '${params.trustBoundary}' without passing through declared sanitizer '${component}'.`,
    });
  }

  return alternatives;
}
