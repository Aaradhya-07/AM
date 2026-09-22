import type { EvidenceGapScope, ReviewEvidenceGap } from "./types.js";

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function gap(
  raw: unknown,
  scope: EvidenceGapScope,
  workload: string | null,
  candidate: string | null,
): ReviewEvidenceGap | null {
  if (!isObject(raw)) return null;
  const code = text(raw.code);
  const subject = text(raw.subject);
  const reason = text(raw.reason);
  if (code === null || subject === null || reason === null) return null;
  return {
    scope,
    workload_ref: workload,
    candidate_ref: candidate,
    code,
    constraint_ref: text(raw.constraint_ref),
    subject,
    required_floor: text(raw.required_floor) ?? "unspecified",
    admissible_kinds: array(raw.admissible_kinds).filter(
      (kind): kind is string => typeof kind === "string",
    ),
    reason,
  };
}

/**
 * The evidence gaps recorded in a bundle's project facts that apply to what
 * was decided: each workload's own gaps, the gaps of the candidate its
 * effective decision selected, then project-level gaps. Gaps of unselected
 * candidates describe alternatives, not the implementation, and are skipped.
 * Standings are read as recorded, never recomputed.
 */
export function collectEvidenceGaps(facts: unknown): ReviewEvidenceGap[] {
  if (!isObject(facts) || !isObject(facts.evidence_gaps)) return [];
  const gaps: ReviewEvidenceGap[] = [];
  const push = (entry: ReviewEvidenceGap | null) => {
    if (entry) gaps.push(entry);
  };

  const selected = new Map<string, string>();
  for (const workload of array(facts.workloads)) {
    if (!isObject(workload)) continue;
    const id = text(workload.id);
    const effective = text(workload.effective_decision);
    if (id === null || effective === null) continue;
    for (const decision of array(workload.decisions)) {
      if (
        isObject(decision) &&
        decision.id === effective &&
        isObject(decision.selected_candidate)
      ) {
        const candidate = text(decision.selected_candidate.id);
        if (candidate !== null) selected.set(id, candidate);
      }
    }
  }

  for (const workload of array(facts.evidence_gaps.workloads)) {
    if (!isObject(workload)) continue;
    const ref = text(workload.workload_ref);
    for (const raw of array(workload.gaps)) {
      push(gap(raw, "workload", ref, null));
    }
    const chosen = ref === null ? undefined : selected.get(ref);
    for (const candidate of array(workload.candidates)) {
      if (!isObject(candidate) || text(candidate.candidate_ref) !== chosen) {
        continue;
      }
      for (const raw of array(candidate.gaps)) {
        push(gap(raw, "selected_candidate", ref, chosen ?? null));
      }
    }
  }

  for (const raw of array(facts.evidence_gaps.project)) {
    push(gap(raw, "project", null, null));
  }

  return gaps;
}
