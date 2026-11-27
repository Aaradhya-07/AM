import { z } from "zod";

import type { SliceKind } from "./planner";
import type { RoutableCandidate } from "./routing-types";

export const RepoOutcomesModelEntrySchema = z.strictObject({
  model: z.string().trim().min(1).max(120),
  provider: z.string().trim().max(120).optional(),
  taskCategory: z
    .enum(["architecture", "backend", "frontend", "tests", "general"])
    .optional(),
  pathPrefix: z.string().trim().min(1).max(120).optional(),
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
  const lines = outcomes.models.slice(0, 20).map((entry) => {
    const firstPct =
      entry.attempts > 0
        ? Math.round((entry.acceptedFirstPass / entry.attempts) * 100)
        : 0;
    const reworkPct = Math.round(entry.meanReworkRatio * 100);
    const scopeParts = [entry.taskCategory, entry.pathPrefix].filter(Boolean);
    const cat = scopeParts.length > 0 ? ` [${scopeParts.join(" · ")}]` : "";
    return `  - ${entry.model}${cat}: ${entry.acceptedFirstPass}/${entry.attempts} accepted first-pass (${firstPct}%), ${entry.rejected} rejected, ${reworkPct}% human rework, ${entry.meanRetries.toFixed(1)} avg retries`;
  });

  return [
    `Observed Local Repository Model Outcomes (${outcomes.schemaVersion}, ${outcomes.totalRecordedRuns} runs on ${outcomes.repoName}):`,
    ...lines,
    `- Empirical routing rule: Prefer models with strong first-pass acceptance and low rework on matching slice categories and package paths in this repository over generic public assumptions.`,
  ].join("\n");
}

export interface StackFingerprintLike {
  languages?: readonly string[] | undefined;
  frameworks?: readonly string[] | undefined;
  totalTrackedFiles?: number | undefined;
}

export function mapSliceKindToOutcomeCategory(
  kind: SliceKind,
): "architecture" | "backend" | "frontend" | "tests" | "general" {
  switch (kind) {
    case "auth_security":
    case "concurrency_algorithms":
      return "architecture";
    case "crud_ui":
      return "frontend";
    case "schema_types":
    case "feature_integration":
      return "backend";
    case "tests_docs":
      return "tests";
  }
}

export function extractTargetPathPrefix(text: string): string | undefined {
  const pkgMatch = text.match(
    /\b(?:packages|apps|services|libs|crates)\/[a-zA-Z0-9._-]+/,
  );
  if (pkgMatch?.[0]) return pkgMatch[0];
  const srcMatch = text.match(/\bsrc\/[a-zA-Z0-9._-]+/);
  if (srcMatch?.[0] && !/\.[a-z0-9]+$/i.test(srcMatch[0])) {
    return srcMatch[0];
  }
  return undefined;
}

/**
 * Cold-start adjustment based on the repository's language, framework, and scale fingerprint
 * before any repository-specific runs exist.
 */
export function computeStackFingerprintAdjustment(params: {
  model: string;
  tier: "frontier" | "balanced" | "fast";
  billing: "api" | "subscription" | "local";
  sliceKind: SliceKind;
  repoStack?: StackFingerprintLike | null | undefined;
}): number {
  const { model, tier, billing, sliceKind, repoStack } = params;
  if (!repoStack) return 0;

  const id = model.toLowerCase();
  const langs = (repoStack.languages ?? []).map((l) => l.toLowerCase());
  const fws = (repoStack.frameworks ?? []).map((f) => f.toLowerCase());
  const files = repoStack.totalTrackedFiles ?? 0;

  let bonus = 0;

  // Large monorepo synthesis (>100 files) favors large-context / multi-file workhorses
  if (
    files >= 100 &&
    (sliceKind === "feature_integration" ||
      sliceKind === "auth_security" ||
      sliceKind === "concurrency_algorithms")
  ) {
    if (/argon|opus|sonnet|\bsol\b/.test(id)) bonus += 0.03;
    if (tier === "fast" && billing !== "local") bonus -= 0.025;
  }

  // TypeScript / Next.js / React frontend & full-stack affinity
  const isWebTs =
    langs.some((l) => l.includes("typescript") || l.includes("javascript")) ||
    fws.some((f) => /next|react|vue|svelte|tailwind|vite/.test(f));
  if (isWebTs && (sliceKind === "crud_ui" || sliceKind === "feature_integration")) {
    if (/sonnet|\bsol\b|argon/.test(id)) bonus += 0.025;
  }

  // Systems / Rust / Go / Python / SQL backend & CLI affinity
  const isBackendSystems =
    langs.some((l) => /rust|go|python|sql|c\+\+/.test(l)) ||
    fws.some((f) => /drizzle|prisma|fastapi|django|pytorch|tokio|vitest/.test(f));
  if (
    isBackendSystems &&
    (sliceKind === "schema_types" ||
      sliceKind === "feature_integration" ||
      sliceKind === "tests_docs")
  ) {
    if (/coder|\bsol\b|sonnet|opus/.test(id)) bonus += 0.025;
  }

  return Math.max(-0.06, Math.min(0.06, bonus));
}

/**
 * 3-Level Hierarchical Empirical Bayes posterior for a specific `(model, sliceKind, pathPrefix)`:
 *   Level 0: Public catalog + stack-fingerprint prior (`tau0 = 6` virtual trials)
 *   Level 1: Repository-wide outcomes for this model (`tau1 = 4` virtual trials)
 *   Level 2: Category-matched + package `pathPrefix`-matched outcomes on this repository
 */
export function computeHierarchicalSlicePosterior(params: {
  candidate: {
    model: string;
    tier: "frontier" | "balanced" | "fast";
    billing: "api" | "subscription" | "local";
    arenaAgentRank?: number | null | undefined;
    arenaCodingScore?: number | null | undefined;
    empiricalScore?: number | undefined;
  };
  sliceKind: SliceKind;
  targetPathPrefix?: string | undefined;
  outcomes?: RepoOutcomesSummary | null | undefined;
  repoStack?: StackFingerprintLike | null | undefined;
}): {
  posteriorMean: number;
  repoAttempts: number;
  matchedSliceAttempts: number;
  matchedFirstPassRate: number | null;
} {
  const { candidate, sliceKind, targetPathPrefix, outcomes, repoStack } =
    params;

  const basePrior = computeCatalogPriorMean({
    tier: candidate.tier,
    arenaAgentRank: candidate.arenaAgentRank ?? null,
    arenaCodingScore: candidate.arenaCodingScore ?? null,
  });
  const stackDelta = computeStackFingerprintAdjustment({
    model: candidate.model,
    tier: candidate.tier,
    billing: candidate.billing,
    sliceKind,
    repoStack,
  });
  const level0Prior = Math.min(0.94, Math.max(0.4, basePrior + stackDelta));

  if (!outcomes || outcomes.models.length === 0) {
    const fallbackPrior =
      typeof candidate.empiricalScore === "number"
        ? Math.min(0.94, Math.max(0.4, candidate.empiricalScore + stackDelta))
        : level0Prior;
    return {
      posteriorMean: Number(fallbackPrior.toFixed(4)),
      repoAttempts: 0,
      matchedSliceAttempts: 0,
      matchedFirstPassRate: null,
    };
  }

  const key = candidate.model.toLowerCase();
  const modelRows = outcomes.models.filter(
    (r) => r.attempts > 0 && r.model.toLowerCase() === key,
  );
  if (modelRows.length === 0) {
    return {
      posteriorMean: Number(level0Prior.toFixed(4)),
      repoAttempts: 0,
      matchedSliceAttempts: 0,
      matchedFirstPassRate: null,
    };
  }

  const rowWins = (r: (typeof modelRows)[number]) =>
    Math.min(
      r.attempts,
      (r.acceptedFirstPass + 0.55 * r.acceptedAfterRetry) *
        (1 - 0.5 * r.meanReworkRatio),
    );

  // Level 1: All repository runs for this model
  let repoAttempts = 0;
  let repoWins = 0;
  for (const r of modelRows) {
    repoAttempts += r.attempts;
    repoWins += rowWins(r);
  }
  const tau0 = PRIOR_VIRTUAL_TRIALS;
  const repoPosterior =
    (level0Prior * tau0 + repoWins) / (tau0 + repoAttempts);

  // Level 2: Category & pathPrefix matched runs
  const desiredCategory = mapSliceKindToOutcomeCategory(sliceKind);
  let weightedAttempts = 0;
  let weightedWins = 0;
  let matchedRawAttempts = 0;
  let matchedRawFirstPass = 0;

  for (const r of modelRows) {
    const catMatch = r.taskCategory === desiredCategory;
    const prefixMatch =
      Boolean(targetPathPrefix) &&
      Boolean(r.pathPrefix) &&
      (r.pathPrefix === targetPathPrefix ||
        targetPathPrefix!.startsWith(`${r.pathPrefix}/`) ||
        r.pathPrefix!.startsWith(`${targetPathPrefix}/`));

    if (!catMatch && !prefixMatch) continue;

    // Package + category match carries 2.0x specificity weight; package-only 1.5x; category-only 1.0x
    const weight = catMatch && prefixMatch ? 2.0 : prefixMatch ? 1.5 : 1.0;
    weightedAttempts += r.attempts * weight;
    weightedWins += rowWins(r) * weight;
    matchedRawAttempts += r.attempts;
    matchedRawFirstPass += Math.min(r.attempts, r.acceptedFirstPass);
  }

  if (weightedAttempts === 0) {
    return {
      posteriorMean: Number(repoPosterior.toFixed(4)),
      repoAttempts,
      matchedSliceAttempts: 0,
      matchedFirstPassRate: null,
    };
  }

  const tau1 = 4;
  const slicePosterior =
    (repoPosterior * tau1 + weightedWins) / (tau1 + weightedAttempts);

  return {
    posteriorMean: Number(slicePosterior.toFixed(4)),
    repoAttempts,
    matchedSliceAttempts: matchedRawAttempts,
    matchedFirstPassRate:
      matchedRawAttempts > 0
        ? Number((matchedRawFirstPass / matchedRawAttempts).toFixed(4))
        : null,
  };
}
