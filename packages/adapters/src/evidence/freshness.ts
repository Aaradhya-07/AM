import { hardwareSizingEvidenceProblem } from "@anvilmark/project-contract";
import type { ProjectContract } from "@anvilmark/project-contract";
import type {
  Constraint,
  ConstraintEvaluation,
  EvidenceContext,
  EvidenceKind,
  EvidencePolicy,
  EvidenceRecord,
  Outcome,
} from "@anvilmark/project-contract";
import {
  compareCodeUnits,
  evaluateConstraint,
  stableStringify,
} from "@anvilmark/project-contract";

/**
 * How current a piece of evidence is.
 *
 * Old evidence is never deleted: history is part of what makes a decision
 * auditable. What must not happen is a measurement from six months ago quietly
 * satisfying today's hard gate, so freshness is evaluated separately from
 * admissibility and only `current` evidence is allowed to settle a constraint.
 */
export const FRESHNESS_STATES = [
  "current",
  "stale",
  "expired",
  "superseded",
  "unknown",
] as const;

export type Freshness = (typeof FRESHNESS_STATES)[number];

export interface FreshnessOptions {
  readonly contract?: ProjectContract;
  /** The moment being evaluated against. */
  readonly asOf: string;
  /** Per-kind age limit for records whose refresh policy is `periodic`. */
  readonly staleAfterMs?: Partial<Record<EvidenceKind, number>>;
  /** Fallback age limit for `periodic` records with no per-kind entry. */
  readonly defaultStaleAfterMs?: number | null;
}

export interface FreshnessVerdict {
  readonly state: Freshness;
  readonly reason: string;
  readonly age_ms: number | null;
  /** The record that replaced this one, when superseded. */
  readonly superseded_by: string | null;
}

/**
 * Two records describe the same fact when they share a kind, a subject, and an
 * attribution. The newer one supersedes the older.
 */
function supersessionKey(record: EvidenceRecord): string {
  return stableStringify({
    kind: record.kind,
    subject: record.subject,
    applies_to: record.applies_to,
  });
}

function parseTime(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Decide how current one record is, in the context of every other record.
 *
 * Precedence is superseded, then expired, then stale. Supersession comes first
 * because it is the most actionable answer: a newer record for the same fact
 * already exists and should be used instead.
 */
export function freshnessOf(
  record: EvidenceRecord,
  all: readonly EvidenceRecord[],
  options: FreshnessOptions,
): FreshnessVerdict {
  const asOf = parseTime(options.asOf);
  const observed = parseTime(record.observed_at);

  if (asOf === null || observed === null) {
    return {
      state: "unknown",
      reason: "the observation or evaluation time could not be read",
      age_ms: null,
      superseded_by: null,
    };
  }

  const ageMs = asOf - observed;

  // An observation dated after the moment being evaluated cannot describe
  // that moment. Clock skew, a typo, or a fabricated timestamp all land here,
  // and none of them is a reason to treat the record as current.
  if (ageMs < 0) {
    return {
      state: "unknown",
      reason: `the observation is dated ${record.observed_at}, which is after the evaluation moment ${options.asOf}`,
      age_ms: ageMs,
      superseded_by: null,
    };
  }

  const dependencyProblem = hardwareSizingEvidenceProblem(
    record,
    options.contract,
  );
  if (dependencyProblem !== null)
    return {
      state: options.contract ? "stale" : "unknown",
      reason: dependencyProblem,
      age_ms: ageMs,
      superseded_by: null,
    };

  const key = supersessionKey(record);

  const replacement = all
    .filter((other) => other.id !== record.id && supersessionKey(other) === key)
    .filter((other) => {
      const otherTime = parseTime(other.observed_at);
      // A record that does not exist yet cannot supersede one that does.
      if (otherTime === null || otherTime > asOf) {
        return false;
      }
      // A strictly later observation wins. Equal timestamps are broken by id
      // so the answer never depends on array order.
      return (
        otherTime > observed ||
        (otherTime === observed && compareCodeUnits(other.id, record.id) > 0)
      );
    })
    // Genuinely newest first; id is only the equal-time tie-break.
    .sort((left, right) => {
      const leftTime = parseTime(left.observed_at) ?? 0;
      const rightTime = parseTime(right.observed_at) ?? 0;
      return rightTime - leftTime || compareCodeUnits(left.id, right.id);
    })[0];

  if (replacement !== undefined) {
    return {
      state: "superseded",
      reason: `a newer observation of the same subject exists ("${replacement.id}")`,
      age_ms: ageMs,
      superseded_by: replacement.id,
    };
  }

  if (record.refresh.expires_at !== null) {
    const expires = parseTime(record.refresh.expires_at);
    // The boundary is inclusive: a record is usable up to and including the
    // instant it expires, and not after it.
    if (expires !== null && asOf > expires) {
      return {
        state: "expired",
        reason: `the record expired at ${record.refresh.expires_at}`,
        age_ms: ageMs,
        superseded_by: null,
      };
    }
  }

  if (record.refresh.policy === "periodic") {
    const window =
      options.staleAfterMs?.[record.kind] ??
      options.defaultStaleAfterMs ??
      null;
    if (window === null) {
      return {
        state: "unknown",
        reason:
          "this record refreshes periodically but no staleness window is configured, so its currency cannot be established",
        age_ms: ageMs,
        superseded_by: null,
      };
    }
    if (ageMs > window) {
      return {
        state: "stale",
        reason: `the record is ${ageMs}ms old, beyond the ${window}ms staleness window for ${record.kind}`,
        age_ms: ageMs,
        superseded_by: null,
      };
    }
  }

  return {
    state: "current",
    reason: "the record is current",
    age_ms: ageMs,
    superseded_by: null,
  };
}

/** Only `current` evidence may settle a constraint. */
export function isUsable(state: Freshness): boolean {
  return state === "current";
}

export interface FreshnessPartition {
  readonly current: readonly EvidenceRecord[];
  readonly excluded: readonly {
    readonly record: EvidenceRecord;
    readonly verdict: FreshnessVerdict;
  }[];
}

/** Split records into what may be used now and what is kept only as history. */
export function partitionByFreshness(
  records: readonly EvidenceRecord[],
  all: readonly EvidenceRecord[],
  options: FreshnessOptions,
): FreshnessPartition {
  const current: EvidenceRecord[] = [];
  const excluded: { record: EvidenceRecord; verdict: FreshnessVerdict }[] = [];

  for (const record of records) {
    const verdict = freshnessOf(record, all, options);
    if (isUsable(verdict.state)) {
      current.push(record);
    } else {
      excluded.push({ record, verdict });
    }
  }

  return { current, excluded };
}

export interface FreshConstraintEvaluation extends ConstraintEvaluation {
  /** Records dropped for being stale, expired, or superseded. */
  readonly staleExcluded: readonly {
    readonly record: EvidenceRecord;
    readonly verdict: FreshnessVerdict;
  }[];
}

/**
 * Evaluate a constraint using only evidence that is current.
 *
 * This composes with the contract's own evaluation rather than replacing it:
 * freshness filters the input, then admissibility, attribution, and the tier
 * floors apply exactly as Milestone 1 defined them. Stale evidence is removed
 * before it can raise a tier, so an out-of-date measurement produces `unknown`
 * rather than `pass`.
 */
export function evaluateConstraintFresh(
  constraint: Constraint,
  assertedStatus: Outcome,
  citedEvidence: readonly EvidenceRecord[],
  policy: EvidencePolicy,
  context: EvidenceContext,
  freshness: FreshnessOptions,
  allEvidence: readonly EvidenceRecord[] = citedEvidence,
): FreshConstraintEvaluation {
  const partition = partitionByFreshness(citedEvidence, allEvidence, {
    ...freshness,
    ...(context.projectContract ? { contract: context.projectContract } : {}),
  });
  const evaluation = evaluateConstraint(
    constraint,
    assertedStatus,
    partition.current,
    policy,
    context,
  );

  if (partition.excluded.length === 0) {
    return { ...evaluation, staleExcluded: [] };
  }

  const note = partition.excluded
    .map((entry) => `${entry.record.id} (${entry.verdict.state})`)
    .join(", ");

  return {
    ...evaluation,
    explanation: `${evaluation.explanation}; excluded as not current: ${note}`,
    staleExcluded: partition.excluded,
  };
}
