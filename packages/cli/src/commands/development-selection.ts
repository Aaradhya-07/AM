import type { DevelopmentEvidenceRow } from "@anvilmark/model-catalog";

export interface SelectionEvidenceRecord {
  readonly row: DevelopmentEvidenceRow;
  readonly task_id: string;
  readonly base_commit: string;
  readonly prompt_sha256: string;
  readonly cached_input_tokens: number;
  readonly elapsed_ms: number;
  readonly reviewed_by_human: boolean;
}

export interface SelectionCandidate {
  readonly id: string;
  readonly agent: string;
  readonly model: string;
  readonly configuration_key: string;
}

interface MatchedGroup {
  readonly task_id: string;
  readonly records: Map<string, SelectionEvidenceRecord>;
}

const MIN_MATCHED_TASKS = 30;
const BOOTSTRAP_SAMPLES = 2_000;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? Number.NaN;
}

function pairedIntervals(
  groups: readonly MatchedGroup[],
  candidateId: string,
  baselineId: string,
): {
  acceptance_delta_95: [number, number];
  estimated_cost_per_accepted_delta_95: [number, number] | null;
} {
  // Fixed seed keeps a given evidence snapshot's advisory output reproducible.
  let state = 0x9e3779b9;
  const randomIndex = (length: number): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % length;
  };
  const acceptanceDeltas: number[] = [];
  const costDeltas: number[] = [];
  for (let sample = 0; sample < BOOTSTRAP_SAMPLES; sample += 1) {
    let candidateAccepted = 0;
    let baselineAccepted = 0;
    let candidateCost = 0;
    let baselineCost = 0;
    for (let draw = 0; draw < groups.length; draw += 1) {
      const group = groups[randomIndex(groups.length)]!;
      const candidate = group.records.get(candidateId)!.row;
      const baseline = group.records.get(baselineId)!.row;
      candidateAccepted += Number(candidate.outcome === "accepted");
      baselineAccepted += Number(baseline.outcome === "accepted");
      candidateCost += candidate.estimated_usd ?? 0;
      baselineCost += baseline.estimated_usd ?? 0;
    }
    acceptanceDeltas.push(
      (candidateAccepted - baselineAccepted) / groups.length,
    );
    costDeltas.push(
      candidateAccepted > 0 && baselineAccepted > 0
        ? candidateCost / candidateAccepted - baselineCost / baselineAccepted
        : Number.POSITIVE_INFINITY,
    );
  }
  return {
    acceptance_delta_95: [
      percentile(acceptanceDeltas, 0.025),
      percentile(acceptanceDeltas, 0.975),
    ],
    estimated_cost_per_accepted_delta_95: costDeltas.every(Number.isFinite)
      ? [percentile(costDeltas, 0.025), percentile(costDeltas, 0.975)]
      : null,
  };
}

/** Same plan, source commit and prompt; one independently reviewed run per setup. */
export function matchedDevelopmentEvidence(
  candidates: readonly SelectionCandidate[],
  records: readonly SelectionEvidenceRecord[],
  profileKey: string | null,
  baselineCandidateId: string | null,
  maxAcceptanceDrop = 0,
) {
  const candidateKeys = new Map<string, string>();
  for (const candidate of candidates) {
    const key = JSON.stringify([
      candidate.agent,
      candidate.model,
      candidate.configuration_key,
    ]);
    if (candidateKeys.has(key))
      return {
        standing: "duplicate_configuration" as const,
        reason: "eligible candidates share one exact configuration",
        matched_tasks: 0,
        excluded_repeated_task_ids: 0,
        candidates: [],
        comparisons: [],
        trial_candidate_id: null,
      };
    candidateKeys.set(key, candidate.id);
  }

  const grouped = new Map<
    string,
    { taskIds: Set<string>; byCandidate: Map<string, SelectionEvidenceRecord[]> }
  >();
  if (profileKey && candidates.length >= 2) {
    for (const record of records) {
      if (
        record.row.profile_key !== profileKey ||
        record.row.outcome === "unreviewed" ||
        !record.reviewed_by_human ||
        !record.base_commit ||
        !record.prompt_sha256
      )
        continue;
      const identity = JSON.stringify([
        record.row.agent,
        record.row.model,
        record.row.configuration_key,
      ]);
      const candidateId = candidateKeys.get(identity);
      if (!candidateId) continue;
      const key = JSON.stringify([
        record.row.plan_hash,
        record.base_commit,
        record.prompt_sha256,
      ]);
      let group = grouped.get(key);
      if (!group) {
        group = { taskIds: new Set(), byCandidate: new Map() };
        grouped.set(key, group);
      }
      group.taskIds.add(record.task_id);
      const attempts = group.byCandidate.get(candidateId) ?? [];
      attempts.push(record);
      group.byCandidate.set(candidateId, attempts);
    }
  }

  const matched: MatchedGroup[] = [];
  for (const group of grouped.values()) {
    if (
      group.taskIds.size !== 1 ||
      candidates.some((candidate) => group.byCandidate.get(candidate.id)?.length !== 1)
    )
      continue;
    matched.push({
      task_id: [...group.taskIds][0]!,
      records: new Map(
        candidates.map((candidate) => [
          candidate.id,
          group.byCandidate.get(candidate.id)![0]!,
        ]),
      ),
    });
  }
  const taskCounts = new Map<string, number>();
  for (const group of matched)
    taskCounts.set(group.task_id, (taskCounts.get(group.task_id) ?? 0) + 1);
  const unique = matched.filter((group) => taskCounts.get(group.task_id) === 1);
  const excludedRepeated = matched.length - unique.length;
  const summaries = candidates.map((candidate) => {
    const selected = unique.map((group) => group.records.get(candidate.id)!);
    const accepted = selected.filter(
      (record) => record.row.outcome === "accepted",
    ).length;
    const allCostsKnown = selected.every(
      (record) =>
        record.row.billing === "api_rate_estimate" &&
        record.row.estimated_usd !== null &&
        Number.isFinite(record.row.estimated_usd),
    );
    const totalCost = allCostsKnown
      ? selected.reduce((sum, record) => sum + record.row.estimated_usd!, 0)
      : null;
    return {
      candidate_id: candidate.id,
      accepted,
      rejected: selected.filter((record) => record.row.outcome === "rejected")
        .length,
      failed: selected.filter((record) => record.row.outcome === "failed")
        .length,
      configured_only: selected.filter(
        (record) => record.row.model_identity !== "tool_reported",
      ).length,
      total_input_tokens: selected.reduce(
        (sum, record) => sum + record.row.input_tokens,
        0,
      ),
      total_cached_input_tokens: selected.reduce(
        (sum, record) => sum + record.cached_input_tokens,
        0,
      ),
      total_output_tokens: selected.reduce(
        (sum, record) => sum + record.row.output_tokens,
        0,
      ),
      total_elapsed_ms: selected.reduce(
        (sum, record) => sum + record.elapsed_ms,
        0,
      ),
      estimated_api_usd: totalCost,
      sample_estimated_usd_per_accepted:
        totalCost !== null && accepted > 0 ? totalCost / accepted : null,
      run_ids: selected.map((record) => record.row.run_id),
    };
  });
  const baseline = summaries.find(
    (summary) => summary.candidate_id === baselineCandidateId,
  );
  const completeCash = summaries.every(
    (summary) => summary.estimated_api_usd !== null,
  );
  const confirmedModels = summaries.every(
    (summary) => summary.configured_only === 0,
  );
  const comparisons =
    baseline && completeCash && unique.length >= MIN_MATCHED_TASKS
      ? summaries
          .filter((summary) => summary.candidate_id !== baselineCandidateId)
          .map((summary) => {
            const intervals = pairedIntervals(
              unique,
              summary.candidate_id,
              baseline.candidate_id,
            );
            return {
              candidate_id: summary.candidate_id,
              baseline_candidate_id: baseline.candidate_id,
              ...intervals,
              passes_sample_gate:
                confirmedModels &&
                summary.accepted > 0 &&
                baseline.accepted > 0 &&
                intervals.acceptance_delta_95[0] >= -maxAcceptanceDrop &&
                intervals.estimated_cost_per_accepted_delta_95 !== null &&
                intervals.estimated_cost_per_accepted_delta_95[1] < 0,
            };
          })
      : [];
  const passing = comparisons
    .filter((comparison) => comparison.passes_sample_gate)
    .sort((left, right) => {
      const leftCost = summaries.find(
        (summary) => summary.candidate_id === left.candidate_id,
      )!.sample_estimated_usd_per_accepted!;
      const rightCost = summaries.find(
        (summary) => summary.candidate_id === right.candidate_id,
      )!.sample_estimated_usd_per_accepted!;
      return leftCost - rightCost;
    });
  const standing = !profileKey
    ? "profile_missing"
    : candidates.length < 2
      ? "not_enough_eligible_candidates"
      : !baseline
        ? "baseline_missing"
        : unique.length < MIN_MATCHED_TASKS
          ? "insufficient_matched_tasks"
          : !confirmedModels
            ? "model_identity_unverified"
            : !completeCash
              ? "cash_cost_unknown"
              : baseline.accepted === 0
                ? "baseline_has_no_acceptance"
                : passing.length
                  ? "shadow_trial_candidate"
                  : "baseline_retained";
  const reason =
    standing === "shadow_trial_candidate"
      ? "paired bootstrap intervals meet the declared quality tolerance and show lower declared-rate cost per accepted task; validate on new held-out work before claiming savings"
      : standing === "baseline_retained"
        ? "no challenger clears both the paired quality and cost gates"
        : standing === "insufficient_matched_tasks"
          ? `need at least ${MIN_MATCHED_TASKS} distinct frozen tasks with one human-reviewed run per eligible setup`
          : standing === "model_identity_unverified"
            ? "a matched run reports only the configured model, not a tool-confirmed model"
            : standing === "cash_cost_unknown"
              ? "a matched run has subscription billing or no complete API-rate estimate"
              : standing === "baseline_missing"
                ? "declare an eligible fixed baseline candidate in the plan"
                : standing === "profile_missing"
                  ? "add a task profile to match local outcomes"
                  : standing === "not_enough_eligible_candidates"
                    ? "at least two eligible configurations are needed"
                    : "the fixed baseline has no accepted task in the matched cohort";
  return {
    standing,
    reason,
    matched_tasks: unique.length,
    minimum_matched_tasks: MIN_MATCHED_TASKS,
    excluded_repeated_task_ids: excludedRepeated,
    baseline_candidate_id: baselineCandidateId,
    max_acceptance_drop: maxAcceptanceDrop,
    candidates: summaries,
    comparisons,
    trial_candidate_id: passing[0]?.candidate_id ?? null,
    basis:
      "same archived plan, Git base commit, and prompt; one independently human-reviewed run per setup and task id; API costs are declared-rate estimates",
  };
}
