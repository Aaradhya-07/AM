import routerWeightsJson from "../data/router-weights.v1.json";
import type { StackFingerprintLike } from "./outcome-priors";
import type { ProjectScale, SliceComplexity, SliceKind } from "./planner";
import type { RoutableModelLike } from "./slice-router";

interface RouterWeightsPayload {
  schemaVersion: string;
  architecture: readonly number[];
  weights: {
    W1: readonly (readonly number[])[];
    b1: readonly number[];
    W2: readonly (readonly number[])[];
    b2: readonly number[];
    W3: readonly number[];
    b3: number;
  };
}

const SLICE_KIND_ORDER: readonly SliceKind[] = [
  "schema_types",
  "crud_ui",
  "feature_integration",
  "auth_security",
  "concurrency_algorithms",
  "tests_docs",
];

const COMPLEXITY_ORDER: readonly SliceComplexity[] = [
  "trivial",
  "low",
  "medium",
  "high",
];

const SCALE_ORDER: readonly ProjectScale[] = [
  "micro",
  "small_app",
  "multi_feature",
  "complex_system",
];

const parsedWeights = routerWeightsJson as unknown as RouterWeightsPayload;

export function encodeLearnedRouterFeatures(params: {
  kind: SliceKind;
  complexity: SliceComplexity;
  projectScale: ProjectScale;
  candidate: RoutableModelLike;
  repoStack?: StackFingerprintLike | null | undefined;
  hasRepoObs: boolean;
  repoWinRate: number;
}): number[] {
  const {
    kind,
    complexity,
    projectScale,
    candidate,
    repoStack,
    hasRepoObs,
    repoWinRate,
  } = params;

  const langs = (repoStack?.languages ?? []).map((l) => l.toLowerCase());
  const fws = (repoStack?.frameworks ?? []).map((f) => f.toLowerCase());
  const files = repoStack?.totalTrackedFiles ?? 0;

  const isWebTs =
    langs.some((l) => l.includes("typescript") || l.includes("javascript")) ||
    fws.some((f) => /next|react|vue|svelte|tailwind|vite/.test(f))
      ? 1
      : 0;
  const isSystems =
    langs.some((l) => /rust|go|python|sql|c\+\+/.test(l)) ||
    fws.some((f) => /drizzle|prisma|fastapi|django|pytorch|tokio|vitest/.test(f))
      ? 1
      : 0;
  const isMonorepo = files >= 100 ? 1 : 0;

  const isLocal = candidate.billing === "local" ? 1 : 0;
  const isHeavySpecialist = /astra|\bo1\b|\bo3-pro\b/i.test(candidate.model)
    ? 1
    : 0;
  const isWeakLocal =
    candidate.billing === "local" &&
    /\b(7b|8b|9b|12b)\b/i.test(candidate.model) &&
    !/coder/i.test(candidate.model)
      ? 1
      : 0;

  const outUsd = candidate.outputUsdPerMillion ?? 0;
  const costNorm = Math.min(1, Math.max(0, outUsd / 50));

  let arenaNorm =
    candidate.tier === "frontier"
      ? 0.92
      : candidate.tier === "balanced"
        ? 0.85
        : 0.65;
  if (
    typeof candidate.arenaAgentRank === "number" &&
    candidate.arenaAgentRank > 0
  ) {
    arenaNorm = Math.min(
      0.99,
      Math.max(0.55, 1 - (candidate.arenaAgentRank - 1) * 0.02),
    );
  }

  return [
    ...SLICE_KIND_ORDER.map((k) => (k === kind ? 1 : 0)),
    Math.max(0, COMPLEXITY_ORDER.indexOf(complexity)) / 3,
    complexity === "high" ? 1 : 0,
    Math.max(0, SCALE_ORDER.indexOf(projectScale)) / 3,
    projectScale === "micro" || projectScale === "small_app" ? 1 : 0,
    isWebTs,
    isSystems,
    isMonorepo,
    candidate.tier === "fast" ? 1 : 0,
    candidate.tier === "balanced" ? 1 : 0,
    candidate.tier === "frontier" ? 1 : 0,
    isLocal,
    isHeavySpecialist,
    isWeakLocal,
    costNorm,
    arenaNorm,
    hasRepoObs ? 1 : 0,
    Math.min(1, Math.max(0, repoWinRate)),
  ];
}

/**
 * Runs the CUDA-trained 23 -> 32 -> 16 -> 1 MLP router head in pure TypeScript (<0.02ms),
 * returning predicted slice utility in `[0, 1]`.
 */
export function predictLearnedSliceUtility(params: {
  kind: SliceKind;
  complexity: SliceComplexity;
  projectScale: ProjectScale;
  candidate: RoutableModelLike;
  repoStack?: StackFingerprintLike | null | undefined;
  hasRepoObs: boolean;
  repoWinRate: number;
}): number {
  const x = encodeLearnedRouterFeatures(params);
  const { W1, b1, W2, b2, W3, b3 } = parsedWeights.weights;

  const h1Len = b1.length;
  const a1 = new Array<number>(h1Len);
  for (let i = 0; i < h1Len; i += 1) {
    let sum = b1[i] ?? 0;
    const row = W1[i] ?? [];
    for (let j = 0; j < x.length; j += 1) {
      sum += (row[j] ?? 0) * (x[j] ?? 0);
    }
    a1[i] = sum > 0 ? sum : 0;
  }

  const h2Len = b2.length;
  const a2 = new Array<number>(h2Len);
  for (let i = 0; i < h2Len; i += 1) {
    let sum = b2[i] ?? 0;
    const row = W2[i] ?? [];
    for (let j = 0; j < h1Len; j += 1) {
      sum += (row[j] ?? 0) * (a1[j] ?? 0);
    }
    a2[i] = sum > 0 ? sum : 0;
  }

  let z3 = b3;
  for (let j = 0; j < h2Len; j += 1) {
    z3 += (W3[j] ?? 0) * (a2[j] ?? 0);
  }

  const prob = 1 / (1 + Math.exp(-z3));
  return Number(prob.toFixed(4));
}
