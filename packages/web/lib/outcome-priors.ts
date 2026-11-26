import { z } from "zod";

import type { RoutableCandidate } from "./routing-types";

export const RepoOutcomesModelEntrySchema = z.strictObject({
  model: z.string().trim().min(1).max(120),
  provider: z.string().trim().max(120).optional(),
  taskCategory: z
    .enum(["architecture", "backend", "frontend", "tests", "general"])
    .optional(),
  attempts: z.number().int().nonnegative().max(100_000),
  acceptedFirstPass: z.number().int().nonnegative().max(100_000),
  acceptedAfterRetry: z.number().int().nonnegative().max(100_000),
  rejected: z.number().int().nonnegative().max(100_000),
  meanRetries: z.number().nonnegative().max(1000),
  meanReworkRatio: z.number().min(0).max(1),
  meanInputTokens: z.number().nonnegative().max(100_000_000),
  meanOutputTokens: z.number().nonnegative().max(10_000_000),
  observedUsdPerAccepted: z.number().nonnegative().nullable().optional(),
  lastObservedAt: z.string().trim().min(1).max(64),
});

export type RepoOutcomesModelEntry = z.infer<
  typeof RepoOutcomesModelEntrySchema
>;

export const RepoOutcomesSummarySchema = z.strictObject({
  schemaVersion: z.literal("anvilmark.outcomes-summary.v1"),
  generatedAt: z.string().trim().min(1).max(64),
  repoName: z.string().trim().min(1).max(200),
  totalRecordedRuns: z.number().int().nonnegative().max(1_000_000),
  models: z.array(RepoOutcomesModelEntrySchema).max(200),
});

export type RepoOutcomesSummary = z.infer<typeof RepoOutcomesSummarySchema>;

interface AggregatedModelOutcome {
  attempts: number;
  acceptedFirstPass: number;
  acceptedAfterRetry: number;
  rejected: number;
  weightedRetries: number;
  weightedRework: number;
}

const PRIOR_VIRTUAL_TRIALS = 6;

export function computeCatalogPriorMean(
  candidate: Pick<
    RoutableCandidate,
    "tier" | "arenaAgentRank" | "arenaCodingScore"
  >,
): number {
  let base =
    candidate.tier === "frontier"
      ? 0.82
      : candidate.tier === "balanced"
        ? 0.74
        : 0.64;

  if (candidate.arenaAgentRank !== null) {
    if (candidate.arenaAgentRank <= 3) base += 0.05;
    else if (candidate.arenaAgentRank <= 8) base += 0.025;
    else if (candidate.arenaAgentRank > 25) base -= 0.04;
  } else if (candidate.arenaCodingScore !== null) {
    if (candidate.arenaCodingScore >= 1520) base += 0.04;
    else if (candidate.arenaCodingScore < 1400) base -= 0.04;
  }

  return Math.min(0.92, Math.max(0.45, base));
}

function aggregateOutcomesByModel(
  outcomes: RepoOutcomesSummary,
): Map<string, AggregatedModelOutcome> {
  const map = new Map<string, AggregatedModelOutcome>();
  for (const row of outcomes.models) {
    if (row.attempts <= 0) continue;
    const key = row.model.toLowerCase();
    const existing = map.get(key) ?? {
      attempts: 0,
      acceptedFirstPass: 0,
      acceptedAfterRetry: 0,
      rejected: 0,
      weightedRetries: 0,
      weightedRework: 0,
    };
    existing.attempts += row.attempts;
    existing.acceptedFirstPass += Math.min(row.attempts, row.acceptedFirstPass);
    existing.acceptedAfterRetry += Math.min(
      row.attempts,
      row.acceptedAfterRetry,
    );
    existing.rejected += row.rejected;
    existing.weightedRetries += row.meanRetries * row.attempts;
    existing.weightedRework += row.meanReworkRatio * row.attempts;
    map.set(key, existing);
  }
  return map;
}

/**
 * Applies Empirical Bayes (Beta-Binomial shrinkage) over public catalog priors
 * and observed repository outcomes (`anvilmark.outcomes-summary.v1`).
 */
export function applyEmpiricalOutcomePriors(
  candidates: readonly RoutableCandidate[],
  outcomes?: RepoOutcomesSummary | null,
): RoutableCandidate[] {
  const byModel = outcomes ? aggregateOutcomesByModel(outcomes) : new Map();

  const scored = candidates.map((candidate) => {
    const priorMean = computeCatalogPriorMean(candidate);
    const alpha0 = priorMean * PRIOR_VIRTUAL_TRIALS;
    const obs = byModel.get(candidate.model.toLowerCase());

    if (!obs || obs.attempts === 0) {
      return {
        ...candidate,
        empiricalScore: Number(priorMean.toFixed(4)),
      };
    }

    const meanRetries = obs.weightedRetries / obs.attempts;
    const meanReworkRatio = Math.min(
      1,
      Math.max(0, obs.weightedRework / obs.attempts),
    );
    const firstPassRate = Math.min(
      1,
      Math.max(0, obs.acceptedFirstPass / obs.attempts),
    );

    const qualityAdjustedWins = Math.min(
      obs.attempts,
      (obs.acceptedFirstPass + 0.55 * obs.acceptedAfterRetry) *
        (1 - 0.5 * meanReworkRatio),
    );

    const posteriorMean =
      (alpha0 + qualityAdjustedWins) / (PRIOR_VIRTUAL_TRIALS + obs.attempts);

    const pct = Math.round(firstPassRate * 100);
    const reworkPct = Math.round(meanReworkRatio * 100);
    const empiricalNote = `Repo history: ${obs.acceptedFirstPass}/${obs.attempts} first-pass (${pct}%), ${reworkPct}% rework, ${meanRetries.toFixed(1)} avg retries.`;

    return {
      ...candidate,
      observedRuns: obs.attempts,
      observedFirstPassRate: Number(firstPassRate.toFixed(4)),
      observedMeanRetries: Number(meanRetries.toFixed(2)),
      observedMeanReworkRatio: Number(meanReworkRatio.toFixed(4)),
      empiricalScore: Number(posteriorMean.toFixed(4)),
      empiricalNote,
      strengths: `${empiricalNote} ${candidate.strengths}`.slice(0, 260),
    };
  });

  if (!outcomes || byModel.size === 0) {
    return scored;
  }

  return [...scored].sort(
    (a, b) => (b.empiricalScore ?? 0) - (a.empiricalScore ?? 0),
  );
}

export function formatOutcomesPromptSection(
  outcomes: RepoOutcomesSummary,
): string {
  if (outcomes.models.length === 0 || outcomes.totalRecordedRuns === 0) {
    return "";
  }
  const lines = outcomes.models.slice(0, 16).map((entry) => {
    const firstPct =
      entry.attempts > 0
        ? Math.round((entry.acceptedFirstPass / entry.attempts) * 100)
        : 0;
    const reworkPct = Math.round(entry.meanReworkRatio * 100);
    const cat = entry.taskCategory ? ` [${entry.taskCategory}]` : "";
    return `  - ${entry.model}${cat}: ${entry.acceptedFirstPass}/${entry.attempts} accepted first-pass (${firstPct}%), ${entry.rejected} rejected, ${reworkPct}% human rework, ${entry.meanRetries.toFixed(1)} avg retries`;
  });

  return [
    `Observed Local Repository Model Outcomes (${outcomes.schemaVersion}, ${outcomes.totalRecordedRuns} runs on ${outcomes.repoName}):`,
    ...lines,
    `- Empirical routing rule: Prefer models with strong first-pass acceptance and low rework on this repository over generic public assumptions, and avoid models that repeatedly failed or required heavy rework on similar slices.`,
  ].join("\n");
}
