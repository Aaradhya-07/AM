import type { ProjectContract } from "@anvilmark/project-contract";
import { prettyStringify } from "@anvilmark/project-contract";

import type { ProjectFacts } from "./facts.js";
import { buildProjectFacts } from "./facts.js";
import type { ProjectionName } from "./source.js";

/**
 * Present freshness of a snapshot (Milestone 4 correction R3).
 *
 * `as_of` is the persisted, reproducible evaluation instant of a snapshot. Its
 * bytes can stay identical while the world moves on: evidence expires, an
 * exception lapses, a review falls due. Byte equality therefore never says a
 * snapshot is current. This compares the time-dependent facts at `as_of` with
 * the same facts at `now` and names what differs.
 */

export interface PresentFreshness {
  readonly status: "current" | "stale_time";
  readonly as_of: string;
  readonly evaluated_at: string;
  readonly differences: readonly string[];
}

function stripAsOf(facts: ProjectFacts): string {
  return prettyStringify({
    ...facts,
    source: { ...facts.source, as_of: null },
  });
}

function evidenceStandings(facts: ProjectFacts): Map<string, string> {
  const result = new Map<string, string>();
  for (const decision of [
    ...facts.workloads.flatMap((workload) => workload.decisions),
    ...facts.project_decisions,
  ]) {
    for (const evidence of decision.evidence) {
      result.set(evidence.id, evidence.freshness);
    }
  }
  return result;
}

function exceptionStandings(facts: ProjectFacts): Map<string, string> {
  const result = new Map<string, string>();
  for (const constraint of facts.constraints) {
    for (const exception of constraint.exceptions) {
      result.set(
        `${constraint.id}/${exception.id}`,
        `${exception.active_at_as_of ? "active" : "expired"}${exception.review_due_at_as_of ? ", review due" : ""}`,
      );
    }
  }
  return result;
}

/** What time-dependent facts differ between two evaluations of one contract. */
export function timeSensitiveDifferences(
  earlier: ProjectFacts,
  later: ProjectFacts,
): string[] {
  const differences: string[] = [];
  const evidenceBefore = evidenceStandings(earlier);
  for (const [id, standing] of evidenceStandings(later)) {
    const previous = evidenceBefore.get(id);
    if (previous !== undefined && previous !== standing) {
      differences.push(
        `evidence ${id} was ${previous} at ${earlier.source.as_of} and is ${standing} at ${later.source.as_of}`,
      );
    }
  }
  const exceptionsBefore = exceptionStandings(earlier);
  for (const [id, standing] of exceptionStandings(later)) {
    const previous = exceptionsBefore.get(id);
    if (previous !== undefined && previous !== standing) {
      differences.push(
        `exception ${id} was ${previous} at ${earlier.source.as_of} and is ${standing} at ${later.source.as_of}`,
      );
    }
  }
  if (differences.length === 0 && stripAsOf(earlier) !== stripAsOf(later)) {
    differences.push(
      `time-dependent standings (evidence gaps or constraint outcomes) differ between ${earlier.source.as_of} and ${later.source.as_of}`,
    );
  }
  return differences;
}

export function presentFreshness(
  contract: ProjectContract,
  options: {
    readonly asOf: string;
    readonly now: string;
    readonly projection?: ProjectionName;
    readonly stateRevision?: number | null;
  },
): PresentFreshness {
  const common = {
    projection: options.projection ?? ("remote-default" as const),
    stateRevision: options.stateRevision ?? null,
  };
  const earlier = buildProjectFacts(contract, {
    ...common,
    asOf: options.asOf,
  });
  const later = buildProjectFacts(contract, { ...common, asOf: options.now });
  const differences =
    stripAsOf(earlier) === stripAsOf(later)
      ? []
      : timeSensitiveDifferences(earlier, later);
  return {
    status: differences.length === 0 ? "current" : "stale_time",
    as_of: options.asOf,
    evaluated_at: options.now,
    differences,
  };
}
