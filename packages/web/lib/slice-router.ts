import { predictLearnedSliceUtility } from "./learned-router";
import {
  computeHierarchicalSlicePosterior,
  extractTargetPathPrefix,
  type RepoOutcomesSummary,
  type StackFingerprintLike,
} from "./outcome-priors";
import {
  projectScales,
  sliceComplexities,
  sliceKinds,
  type ProjectScale,
  type SliceComplexity,
  type SliceKind,
} from "./planner";
import {
  estimateTaskUsd,
  type QuotaMode,
  type RoutableCandidate,
} from "./routing-types";

export interface RoutableModelLike {
  model: string;
  label?: string | undefined;
  provider?: string | undefined;
  tier: "frontier" | "balanced" | "fast";
  billing: "api" | "subscription" | "local";
  inputUsdPerMillion?: number | null | undefined;
  outputUsdPerMillion?: number | null | undefined;
  arenaAgentRank?: number | null | undefined;
  arenaCodingScore?: number | null | undefined;
  empiricalScore?: number | undefined;
  observedRuns?: number | undefined;
  observedFirstPassRate?: number | null | undefined;
  strengths?: string | undefined;
}

export interface SliceProfile {
  kind: SliceKind;
  complexity: SliceComplexity;
}

const SIMPLE_APP_RE =
  /\b(todo|to-do|task\s*list|checklist|notes?\s+app|habit\s+tracker|pomodoro|bookmark\s+manager|counter\s+app|calculator|weather\s+app|recipe\s+app|flashcard)\b/i;

const DEEP_SYSTEM_SIGNALS_RE =
  /\b(crdt|operational\s+transform|distributed\s+lock|raft|consensus|kafka|event\s+sourcing|multi-tenant\s+rbac|saml|oidc\s+provider|zero-knowledge|end-to-end\s+encrypt|stripe\s+webhook|ledger|double-entry|compiler|query\s+planner|websocket\s+cluster)\b/i;

const HIGH_RISK_SLICE_RE =
  /\b(auth|authentication|authorization|rbac|acl|permission|session\s+token|jwt|oauth|oidc|passkey|webauthn|hmac|signature|cryptograph|encrypt|tenant\s+isolation|row-level\s+security|rls|concurren|race\s+condition|deadlock|idempoten|serializable|distributed|lock|atomic\s+swap|crdt|conflict\s+resolution|rate\s+limit|csrf|xss|ssrf|sql\s+injection|webhook\s+verif|payment|billing|ledger)\b/i;

const CONCURRENCY_ALGO_RE =
  /\b(concurren|race\s+condition|deadlock|lock-free|crdt|operational\s+transform|dag|topological|scheduler|graph\s+algorithm|backpressure|streaming\s+parser|consensus|state\s+machine\s+invariant|optimistic\s+concurrency|retry\s+backoff|queue\s+worker)\b/i;

const AUTH_SECURITY_RE =
  /\b(auth|authentication|authorization|rbac|permission|jwt|oauth|oidc|session|cookie\s+security|hmac|signature|encrypt|secret|tenant\s+isolation|rls|csrf|ssrf|csp|audit\s+log)\b/i;

const SCHEMA_TYPES_RE =
  /\b(schema|migration|drizzle|prisma|sql\s+table|ddl|zod\s+schema|type\s+definition|typescript\s+types|interfaces|seed\s+data|scaffold|project\s+setup|config\s+wiring|boilerplate)\b/i;

const TESTS_DOCS_RE =
  /\b(unit\s+tests?|integration\s+tests?|e2e\s+tests?|playwright|vitest|jest|pytest|test\s+suite|regression\s+tests?|fixtures?|mock|readme|documentation)\b/i;

const MULTI_FILE_FEATURE_RE =
  /\b(workflow|pipeline|import|export|sync|webhook|realtime|real-time|sse|websocket|pagination|search|drag|kanban|optimistic|transaction|upsert|multi-step|orchestrat|adapter|bridge|api\s+integration)\b/i;

function isValidProjectScale(value: unknown): value is ProjectScale {
  return (
    typeof value === "string" &&
    (projectScales as readonly string[]).includes(value)
  );
}

function isValidSliceKind(value: unknown): value is SliceKind {
  return (
    typeof value === "string" &&
    (sliceKinds as readonly string[]).includes(value)
  );
}

function isValidSliceComplexity(value: unknown): value is SliceComplexity {
  return (
    typeof value === "string" &&
    (sliceComplexities as readonly string[]).includes(value)
  );
}

/**
 * Infers a model's tier when callers supply custom model IDs (such as `/plan`).
 */
export function inferCandidateTier(
  modelId: string,
  notes = "",
  allModelIds: readonly string[] = [],
): "frontier" | "balanced" | "fast" {
  const lower = `${modelId} ${notes}`.toLowerCase();
  if (
    /\b(haiku|luna|flash|mini|nano|lite|small|7b|8b|9b|12b|14b)\b/.test(lower)
  ) {
    return "fast";
  }
  if (
    /\b(opus|astra|argon|o1|o3|pro-preview|ultra|deep-research|frontier)\b/.test(
      lower,
    )
  ) {
    return "frontier";
  }
  if (/\bgpt-5\b/.test(modelId.toLowerCase())) {
    const hasMiniPeer = allModelIds.some((id) =>
      /mini|nano|lite|haiku|flash/i.test(id),
    );
    return hasMiniPeer ? "balanced" : "balanced";
  }
  if (/\b(sonnet|\bsol\b|coder|26b|27b|30b|32b|70b|balanced)\b/.test(lower)) {
    return "balanced";
  }
  return "balanced";
}

export function resolveProjectScale(params: {
  idea: string;
  title?: string | undefined;
  goal?: string | undefined;
  scope?: readonly string[] | undefined;
  rawScale?: unknown;
}): ProjectScale {
  const combined = [
    params.idea,
    params.title ?? "",
    params.goal ?? "",
    ...(params.scope ?? []),
  ].join(" ");

  const isSimpleDomain =
    SIMPLE_APP_RE.test(combined) && !DEEP_SYSTEM_SIGNALS_RE.test(combined);

  if (isValidProjectScale(params.rawScale)) {
    if (
      isSimpleDomain &&
      (params.rawScale === "complex_system" ||
        params.rawScale === "multi_feature")
    ) {
      // Allow multi_feature only if auth + team/workspace/sync are explicitly in scope.
      const hasMultiUserOrSync =
        /\b(multi-user|team|workspace|shared|auth|login|oauth|sync)\b/i.test(
          combined,
        );
      return hasMultiUserOrSync ? "multi_feature" : "small_app";
    }
    return params.rawScale;
  }

  if (DEEP_SYSTEM_SIGNALS_RE.test(combined)) {
    return "complex_system";
  }
  if (isSimpleDomain) {
    return /\b(multi-user|team|workspace|auth|login)\b/i.test(combined)
      ? "multi_feature"
      : "small_app";
  }
  if (
    /\b(fix\s+bug|typo|rename|add\s+flag|single\s+endpoint|health\s+route)\b/i.test(
      combined,
    ) &&
    (params.scope?.length ?? 0) <= 2
  ) {
    return "micro";
  }
  return "multi_feature";
}

export function resolveSliceProfile(params: {
  title: string;
  outcome: string;
  acceptance?: readonly string[] | undefined;
  rawKind?: unknown;
  rawComplexity?: unknown;
  projectScale: ProjectScale;
  strict: boolean;
}): SliceProfile {
  const titleAndOutcome = `${params.title} ${params.outcome}`;
  const fullText = `${titleAndOutcome} ${(params.acceptance ?? []).join(" ")}`;

  const hasHighRiskSignal = HIGH_RISK_SLICE_RE.test(fullText);
  const hasConcurrencySignal = CONCURRENCY_ALGO_RE.test(fullText);
  const hasAuthSecuritySignal = AUTH_SECURITY_RE.test(fullText);
  const hasMultiFileFeature = MULTI_FILE_FEATURE_RE.test(fullText);
  const isPrimarilyTests =
    TESTS_DOCS_RE.test(params.title) ||
    (TESTS_DOCS_RE.test(titleAndOutcome) &&
      !hasHighRiskSignal &&
      !hasMultiFileFeature);
  const isPrimarilySchemaOrSetup =
    SCHEMA_TYPES_RE.test(params.title) &&
    !hasAuthSecuritySignal &&
    !hasConcurrencySignal;

  // 1. Determine SliceKind (respect valid LLM tag unless clearly contradicted)
  let kind: SliceKind;
  if (isPrimarilyTests) {
    kind = "tests_docs";
  } else if (isPrimarilySchemaOrSetup && !hasMultiFileFeature) {
    kind = "schema_types";
  } else if (isValidSliceKind(params.rawKind)) {
    if (
      (params.rawKind === "concurrency_algorithms" ||
        params.rawKind === "auth_security") &&
      !hasHighRiskSignal &&
      params.projectScale === "small_app"
    ) {
      kind = hasMultiFileFeature ? "feature_integration" : "crud_ui";
    } else {
      kind = params.rawKind;
    }
  } else if (hasConcurrencySignal) {
    kind = "concurrency_algorithms";
  } else if (hasAuthSecuritySignal) {
    kind = "auth_security";
  } else if (isPrimarilySchemaOrSetup) {
    kind = "schema_types";
  } else if (hasMultiFileFeature) {
    kind = "feature_integration";
  } else {
    kind = "crud_ui";
  }

  // 2. Determine SliceComplexity (mindful of both quality and overkill)
  let complexity: SliceComplexity;
  if (isValidSliceComplexity(params.rawComplexity)) {
    complexity = params.rawComplexity;
  } else if (
    hasHighRiskSignal &&
    (kind === "auth_security" ||
      kind === "concurrency_algorithms" ||
      params.projectScale === "complex_system")
  ) {
    complexity = "high";
  } else if (isPrimarilyTests || isPrimarilySchemaOrSetup) {
    complexity = "low";
  } else if (
    kind === "feature_integration" ||
    hasHighRiskSignal ||
    hasMultiFileFeature
  ) {
    complexity = "medium";
  } else {
    complexity = params.projectScale === "micro" ? "low" : "medium";
  }

  // Clamp overkill: routine schema, CRUD/UI, or test slices in small/micro apps
  // without real security or concurrency signals should never be marked "high".
  if (
    complexity === "high" &&
    !hasHighRiskSignal &&
    (params.projectScale === "micro" ||
      params.projectScale === "small_app" ||
      kind === "schema_types" ||
      kind === "crud_ui" ||
      kind === "tests_docs")
  ) {
    complexity =
      kind === "schema_types" || kind === "tests_docs" ? "low" : "medium";
  }

  // Protect work quality: multi-file features, auth, or concurrency slices
  // should never be downgraded to "trivial".
  if (
    complexity === "trivial" &&
    (kind === "feature_integration" ||
      kind === "auth_security" ||
      kind === "concurrency_algorithms" ||
      hasMultiFileFeature)
  ) {
    complexity = "medium";
  }

  if (
    params.strict &&
    (kind === "auth_security" || hasAuthSecuritySignal) &&
    complexity === "low"
  ) {
    complexity = "medium";
  }

  return { kind, complexity };
}

function isHeavySpecialistModel(modelId: string): boolean {
  return /astra|\bo1\b|\bo3-pro\b/i.test(modelId);
}

function isWeakSmallLocalModel(candidate: RoutableModelLike): boolean {
  return (
    candidate.billing === "local" &&
    /\b(7b|8b|9b|12b)\b/i.test(candidate.model) &&
    !/coder/i.test(candidate.model)
  );
}

function targetTiersForProfile(
  profile: SliceProfile,
  projectScale: ProjectScale,
): {
  primaryTier: "frontier" | "balanced" | "fast";
  secondaryPreference: readonly ("frontier" | "balanced" | "fast")[];
} {
  const { kind, complexity } = profile;

  // High complexity: use frontier mindfully with NO artificial cap across slices!
  if (complexity === "high") {
    return {
      primaryTier: "frontier",
      secondaryPreference: ["balanced", "frontier", "fast"],
    };
  }

  // Auth/security or concurrency at medium complexity:
  // complex_system leans frontier; other apps use strong balanced + frontier step-up!
  if (
    complexity === "medium" &&
    (kind === "auth_security" || kind === "concurrency_algorithms")
  ) {
    if (projectScale === "complex_system") {
      return {
        primaryTier: "frontier",
        secondaryPreference: ["balanced", "frontier", "fast"],
      };
    }
    return {
      primaryTier: "balanced",
      secondaryPreference: ["frontier", "balanced", "fast"],
    };
  }

  // Trivial or narrow low-complexity mechanical slices (schemas, types, unit tests, fixtures):
  // fast tier is safe here, paired with a balanced quality step-up as Option 2.
  if (
    complexity === "trivial" ||
    (complexity === "low" &&
      (kind === "schema_types" || kind === "tests_docs"))
  ) {
    return {
      primaryTier: "fast",
      secondaryPreference: ["balanced", "fast"],
    };
  }

  // Low-complexity CRUD/UI (e.g. a Todo app's UI/CRUD slice):
  // Keep work quality high by defaulting to "balanced" workhorse (Sol / Sonnet / 30B Coder),
  // with "fast" (Luna / Haiku / Flash) offered as the leaner Option 2 — never Astra/Frontier!
  if (complexity === "low") {
    return {
      primaryTier: "balanced",
      secondaryPreference: ["fast", "balanced"],
    };
  }

  // Medium-complexity feature / integration / stateful UI:
  // Strong "balanced" workhorse as Option 1; if it's asmall_app (like a Todo app),
  // Option 2 prefers another balanced or fast model instead of heavy frontier overkill;
  // for multi_feature / complex_system, Option 2 offers a frontier quality step-up or balanced peer!
  if (projectScale === "micro" || projectScale === "small_app") {
    return {
      primaryTier: "balanced",
      secondaryPreference: ["fast", "balanced"],
    };
  }

  return {
    primaryTier: "balanced",
    secondaryPreference: ["frontier", "balanced", "fast"],
  };
}

function scoreCandidateForTier(params: {
  candidate: RoutableModelLike;
  desiredTier: "frontier" | "balanced" | "fast";
  profile: SliceProfile;
  projectScale: ProjectScale;
  llmPickedModel?: string | undefined;
  targetPathPrefix?: string | undefined;
  outcomes?: RepoOutcomesSummary | null | undefined;
  repoStack?: StackFingerprintLike | null | undefined;
  learnedBonus?: number | undefined;
}): number {
  const {
    candidate,
    desiredTier,
    profile,
    projectScale,
    llmPickedModel,
    targetPathPrefix,
    outcomes,
    repoStack,
    learnedBonus = 0,
  } = params;

  let score = 0;

  // 1. Tier match
  if (candidate.tier === desiredTier) {
    score += 40;
  } else if (
    (desiredTier === "balanced" && candidate.tier === "fast") ||
    (desiredTier === "fast" && candidate.tier === "balanced")
  ) {
    score += 18;
  } else if (desiredTier === "frontier" && candidate.tier === "balanced") {
    score += 22;
  } else if (desiredTier === "balanced" && candidate.tier === "frontier") {
    score += 10;
  } else {
    score -= 15;
  }

  // 2. Heavy specialist guardrail (e.g. GPT-6 Astra at $10/$50):
  // Mindful usage: great for high-complexity concurrency/algorithms/security,
  // heavily penalized for small apps, routine CRUD/UI, schemas, and tests.
  if (isHeavySpecialistModel(candidate.model)) {
    const warranted =
      profile.complexity === "high" &&
      projectScale !== "micro" &&
      projectScale !== "small_app";
    if (!warranted) {
      score -= 55;
    } else if (profile.kind === "concurrency_algorithms") {
      score += 8;
    } else {
      // Slightly prefer lower-burn frontier peers (Opus / Argon) when available,
      // while still selecting Astra cleanly when ChatGPT is the user's frontier pool.
      score -= 3;
    }
  }

  // 3. General frontier mindfulness on small/trivial work:
  if (
    candidate.tier === "frontier" &&
    desiredTier !== "frontier" &&
    (profile.complexity === "trivial" ||
      profile.complexity === "low" ||
      projectScale === "small_app" ||
      projectScale === "micro")
  ) {
    score -= 30;
  }

  // 4. Quality floor protection: avoid small 9B/12B general local models on
  // multi-file features, auth, or high-complexity tasks when stronger models exist.
  if (
    isWeakSmallLocalModel(candidate) &&
    (profile.complexity === "medium" ||
      profile.complexity === "high" ||
      profile.kind === "feature_integration" ||
      profile.kind === "auth_security" ||
      profile.kind === "concurrency_algorithms")
  ) {
    score -= 28;
  }

  // 5. 3-Level Hierarchical Empirical Bayes posterior (Catalog + Stack -> Repo -> Category & PathPrefix)
  const hierarchical = computeHierarchicalSlicePosterior({
    candidate,
    sliceKind: profile.kind,
    targetPathPrefix,
    outcomes,
    repoStack,
  });
  score += hierarchical.posteriorMean * 22;

  const hasDirectObs =
    hierarchical.matchedSliceAttempts > 0 ||
    hierarchical.repoAttempts > 0 ||
    (typeof candidate.observedRuns === "number" && candidate.observedRuns > 0);
  const effectiveWinRate =
    hierarchical.matchedSliceAttempts > 0 &&
    hierarchical.matchedFirstPassRate !== null
      ? hierarchical.matchedFirstPassRate
      : typeof candidate.observedFirstPassRate === "number"
        ? candidate.observedFirstPassRate
        : hierarchical.posteriorMean;

  if (
    hierarchical.matchedSliceAttempts > 0 &&
    hierarchical.matchedFirstPassRate !== null
  ) {
    // Direct category / package match on THIS repo strongly steers selection over generic Arena priors
    const confidence = Math.min(1, hierarchical.matchedSliceAttempts / 5);
    score +=
      (hierarchical.matchedFirstPassRate - 0.65) * 40 * (0.5 + 0.5 * confidence);
    if (hierarchical.matchedFirstPassRate >= 0.8 && confidence >= 0.6) {
      score += 4.5 * confidence;
    }
  } else if (
    typeof candidate.observedRuns === "number" &&
    candidate.observedRuns > 0 &&
    typeof candidate.observedFirstPassRate === "number"
  ) {
    score += (candidate.observedFirstPassRate - 0.65) * 22;
  }

  // 6. Learned CUDA-trained MLP Router head utility blend (`router-weights.v1.json`)
  const learnedUtility = predictLearnedSliceUtility({
    kind: profile.kind,
    complexity: profile.complexity,
    projectScale,
    candidate,
    repoStack,
    hasRepoObs: hasDirectObs,
    repoWinRate: effectiveWinRate,
  });
  score += (learnedUtility - 0.5) * 14 + learnedBonus;

  // 7. Arena rank & cost-efficiency tie-breakers within same tier
  if (
    typeof candidate.arenaAgentRank === "number" &&
    candidate.arenaAgentRank > 0
  ) {
    score += Math.max(0, 12 - candidate.arenaAgentRank) * 0.35;
  }
  const outUsd = candidate.outputUsdPerMillion;
  if (typeof outUsd === "number" && outUsd > 0) {
    score -= Math.min(6, outUsd * 0.1);
  }

  // 8. Respect LLM model affinity when no strong repo history overrides it
  const llmBonus =
    outcomes && outcomes.totalRecordedRuns >= 5 ? 2 : 6;
  if (llmPickedModel && candidate.model === llmPickedModel) {
    const llmTierReasonable =
      candidate.tier === desiredTier ||
      (desiredTier === "fast" &&
        candidate.billing === "local" &&
        candidate.tier === "balanced");
    if (llmTierReasonable && !isHeavySpecialistModel(candidate.model)) {
      score += llmBonus;
    } else if (
      desiredTier === "frontier" &&
      candidate.tier === "frontier" &&
      profile.complexity === "high"
    ) {
      score += llmBonus;
    }
  }

  return score;
}

function formatSliceKindPhrase(kind: SliceKind): string {
  switch (kind) {
    case "schema_types":
      return "bounded schema and type contract";
    case "crud_ui":
      return "UI and CRUD implementation";
    case "feature_integration":
      return "multi-file feature and integration";
    case "auth_security":
      return "security and trust-boundary";
    case "concurrency_algorithms":
      return "concurrency and state-invariant";
    case "tests_docs":
      return "verification and test";
  }
}

function buildSynthesizedWhy(
  chosen: RoutableModelLike,
  profile: SliceProfile,
): string {
  const label = chosen.label ?? chosen.model;
  const kindPhrase = formatSliceKindPhrase(profile.kind);
  if (
    typeof chosen.observedRuns === "number" &&
    chosen.observedRuns > 0 &&
    typeof chosen.observedFirstPassRate === "number"
  ) {
    const pct = Math.round(chosen.observedFirstPassRate * 100);
    return `${label} (${chosen.tier} tier) matches this ${profile.complexity}-complexity ${kindPhrase} slice with ${pct}% observed first-pass acceptance on this repo.`;
  }
  if (chosen.billing === "local") {
    return `${label} handles this ${profile.complexity}-complexity ${kindPhrase} slice locally at $0 API burn without sacrificing implementation accuracy.`;
  }
  if (chosen.tier === "frontier") {
    return `${label} brings frontier reasoning to this ${profile.complexity}-complexity ${kindPhrase} slice where subtle edge cases and invariants matter.`;
  }
  if (chosen.tier === "balanced") {
    return `${label} gives dependable multi-file coding quality on this ${kindPhrase} slice without unnecessary frontier token burn.`;
  }
  return `${label} executes this well-scoped ${kindPhrase} slice fast and cleanly at minimal token cost.`;
}

export function buildAlternativeTradeoff(params: {
  primary: RoutableModelLike;
  secondary: RoutableModelLike;
  taskTokens: { inputTokens: number; outputTokens: number };
  profile: SliceProfile;
}): string {
  const { primary, secondary, taskTokens, profile } = params;
  const primaryUsd = estimateTaskUsd(taskTokens, {
    billing: primary.billing,
    inputUsdPerMillion: primary.inputUsdPerMillion ?? null,
    outputUsdPerMillion: primary.outputUsdPerMillion ?? null,
  });
  const secondaryUsd = estimateTaskUsd(taskTokens, {
    billing: secondary.billing,
    inputUsdPerMillion: secondary.inputUsdPerMillion ?? null,
    outputUsdPerMillion: secondary.outputUsdPerMillion ?? null,
  });

  if (secondary.billing === "local" && primary.billing !== "local") {
    return "Zero-API-cost local OSS option on am-server if keeping cloud quota untouched.";
  }

  const tierRank = { fast: 1, balanced: 2, frontier: 3 } as const;
  const pRank = tierRank[primary.tier];
  const sRank = tierRank[secondary.tier];

  if (sRank > pRank) {
    const costHint =
      primaryUsd !== null && secondaryUsd !== null && secondaryUsd > primaryUsd
        ? ` (~$${secondaryUsd.toFixed(3)} vs ~$${primaryUsd.toFixed(3)})`
        : "";
    return secondary.tier === "frontier"
      ? `Quality step-up to frontier reasoning${costHint} if cross-cutting edge cases or tricky invariants surface.`
      : `Quality step-up to balanced workhorse${costHint} if slice scope expands across more files.`;
  }

  if (sRank < pRank) {
    const savePct =
      primaryUsd !== null &&
      secondaryUsd !== null &&
      primaryUsd > 0 &&
      secondaryUsd < primaryUsd
        ? Math.round(((primaryUsd - secondaryUsd) / primaryUsd) * 100)
        : null;
    const saveHint =
      savePct !== null && savePct >= 20 ? ` (~${savePct}% lower cost)` : "";
    return secondary.tier === "balanced"
      ? `High-reliability balanced option${saveHint} once ${formatSliceKindPhrase(profile.kind)} interfaces are locked.`
      : `Leaner fast-tier option${saveHint} if you keep this slice compact and straightforward.`;
  }

  return `Strong ${secondary.tier}-tier peer from ${secondary.provider ?? "an alternate model family"} with comparable quality and cost.`;
}

export function selectTwoModelsForSlice<T extends RoutableModelLike>(params: {
  candidates: readonly T[];
  profile: SliceProfile;
  projectScale: ProjectScale;
  taskTokens: { inputTokens: number; outputTokens: number };
  llmPickedModel?: string | undefined;
  llmAlternatives?:
    | readonly { model?: string; tradeoff?: string }[]
    | undefined;
  quotaMode?: QuotaMode | undefined;
  targetPathPrefix?: string | undefined;
  outcomes?: RepoOutcomesSummary | null | undefined;
  repoStack?: StackFingerprintLike | null | undefined;
}): {
  primary: T;
  secondary: T | null;
  secondaryTradeoff: string;
} {
  const {
    candidates,
    profile,
    projectScale,
    taskTokens,
    llmPickedModel,
    llmAlternatives,
    targetPathPrefix,
    outcomes,
    repoStack,
  } = params;

  const first = candidates[0];
  if (!first) {
    throw new Error("At least one candidate model is required.");
  }
  if (candidates.length === 1) {
    return {
      primary: first,
      secondary: null,
      secondaryTradeoff: "",
    };
  }

  const { primaryTier, secondaryPreference } = targetTiersForProfile(
    profile,
    projectScale,
  );

  const rankedPrimary = [...candidates].sort(
    (a, b) =>
      scoreCandidateForTier({
        candidate: b,
        desiredTier: primaryTier,
        profile,
        projectScale,
        llmPickedModel,
        targetPathPrefix,
        outcomes,
        repoStack,
      }) -
      scoreCandidateForTier({
        candidate: a,
        desiredTier: primaryTier,
        profile,
        projectScale,
        llmPickedModel,
        targetPathPrefix,
        outcomes,
        repoStack,
      }),
  );

  const primary = rankedPrimary[0]!;
  const remaining = candidates.filter((c) => c.model !== primary.model);
  const llmAltModel = llmAlternatives?.find(
    (alt) =>
      typeof alt.model === "string" &&
      alt.model !== primary.model &&
      remaining.some((c) => c.model === alt.model),
  )?.model;

  // Score remaining candidates for Option 2: give strong preference to secondaryPreference[0]
  // so the user gets a genuinely meaningful contrast (e.g. Balanced + Step-Up, or Balanced + Fast/Local)
  // while never offering GPT-6 Astra on simple apps!
  const desiredSecondaryTier = secondaryPreference[0] ?? "balanced";
  const rankedSecondary = [...remaining].sort((a, b) => {
    const scoreOne = (cand: T) => {
      let s = scoreCandidateForTier({
        candidate: cand,
        desiredTier: desiredSecondaryTier,
        profile,
        projectScale,
        llmPickedModel: llmAltModel,
        targetPathPrefix,
        outcomes,
        repoStack,
      });
      // Prefer a complementary tier or zero-cost local contrast when appropriate
      const prefIdx = secondaryPreference.indexOf(cand.tier);
      if (prefIdx === 0) s += 10;
      else if (prefIdx === 1) s += 4;
      if (cand.billing === "local" && primary.billing !== "local" && !isWeakSmallLocalModel(cand)) {
        s += 5;
      }
      return s;
    };
    return scoreOne(b) - scoreOne(a);
  });

  const secondary = rankedSecondary[0] ?? null;
  if (!secondary) {
    return { primary, secondary: null, secondaryTradeoff: "" };
  }

  const matchingLlmAlt = llmAlternatives?.find(
    (alt) =>
      alt.model === secondary.model &&
      typeof alt.tradeoff === "string" &&
      alt.tradeoff.trim().length >= 8,
  );

  const secondaryTradeoff =
    matchingLlmAlt?.tradeoff?.trim() ||
    buildAlternativeTradeoff({
      primary,
      secondary,
      taskTokens,
      profile,
    });

  return {
    primary,
    secondary,
    secondaryTradeoff,
  };
}

/**
 * Deterministically validates/calibrates `projectScale`, per-slice `kind` & `complexity`,
 * `task.model` (Option 1), and `task.alternatives` (Option 2) on a raw LLM plan object
 * before Zod `validatePlan()` runs.
 */
export function calibratePlanRouting(params: {
  raw: unknown;
  idea: string;
  candidates: readonly RoutableModelLike[];
  strict: boolean;
  quotaMode?: QuotaMode | undefined;
  outcomes?: RepoOutcomesSummary | null | undefined;
  repoStack?: StackFingerprintLike | null | undefined;
  preserveValidLlmPick?: boolean | undefined;
}): unknown {
  const {
    raw,
    idea,
    candidates,
    strict,
    quotaMode,
    outcomes,
    repoStack,
    preserveValidLlmPick = false,
  } = params;

  if (!raw || typeof raw !== "object" || candidates.length === 0) {
    return raw;
  }

  const clone = structuredClone(raw) as {
    title?: string;
    goal?: string;
    projectScale?: unknown;
    scope?: string[];
    tasks?: Array<{
      id?: string;
      title?: string;
      outcome?: string;
      acceptance?: string[];
      kind?: unknown;
      complexity?: unknown;
      model?: string;
      why?: string;
      alternatives?: Array<{ model?: string; tradeoff?: string }>;
      inputTokens?: number;
      outputTokens?: number;
    }>;
  };

  if (!Array.isArray(clone.tasks)) {
    return clone;
  }

  const resolvedScale = resolveProjectScale({
    idea,
    title: typeof clone.title === "string" ? clone.title : undefined,
    goal: typeof clone.goal === "string" ? clone.goal : undefined,
    scope: Array.isArray(clone.scope)
      ? clone.scope.filter((s): s is string => typeof s === "string")
      : undefined,
    rawScale: clone.projectScale,
  });

  if (clone.projectScale !== undefined) {
    clone.projectScale = resolvedScale;
  }

  const candidateById = new Map(candidates.map((c) => [c.model, c]));

  for (const task of clone.tasks) {
    if (!task || typeof task !== "object") continue;

    const title = typeof task.title === "string" ? task.title : "";
    const outcome = typeof task.outcome === "string" ? task.outcome : "";
    const acceptance = Array.isArray(task.acceptance)
      ? task.acceptance.filter((a): a is string => typeof a === "string")
      : [];

    const profile = resolveSliceProfile({
      title,
      outcome,
      acceptance,
      rawKind: task.kind,
      rawComplexity: task.complexity,
      projectScale: resolvedScale,
      strict,
    });

    if (task.kind !== undefined) {
      task.kind = profile.kind;
    }
    if (task.complexity !== undefined) {
      task.complexity = profile.complexity;
    }

    const inputTokens =
      typeof task.inputTokens === "number" && task.inputTokens > 0
        ? task.inputTokens
        : 12_000;
    const outputTokens =
      typeof task.outputTokens === "number" && task.outputTokens > 0
        ? task.outputTokens
        : 2_500;

    const originalModel = typeof task.model === "string" ? task.model : "";
    const originalCand = candidateById.get(originalModel);
    if (!originalCand) {
      // Leave unlisted/unknown model IDs untouched so validatePlan() rejects them cleanly.
      continue;
    }

    // In legacy `/api/plan` (`preserveValidLlmPick: true`), if the LLM already picked a
    // valid candidate AND valid alternatives without misrouting a specialist/frontier model
    // onto a simple task, leave its exact fields intact.
    if (preserveValidLlmPick && originalCand) {
      const { primaryTier } = targetTiersForProfile(profile, resolvedScale);
      const isOverkillPick =
        isHeavySpecialistModel(originalCand.model) &&
        (profile.complexity !== "high" ||
          resolvedScale === "small_app" ||
          resolvedScale === "micro");
      const hasValidAlts =
        candidates.length <= 1 ||
        (Array.isArray(task.alternatives) &&
          task.alternatives.length >= 1 &&
          task.alternatives.every(
            (a) =>
              typeof a?.model === "string" &&
              a.model !== originalModel &&
              candidateById.has(a.model) &&
              typeof a.tradeoff === "string" &&
              a.tradeoff.trim().length > 0,
          ));
      if (
        !isOverkillPick &&
        hasValidAlts &&
        (originalCand.tier === primaryTier || profile.complexity !== "low")
      ) {
        continue;
      }
    }

    const targetPathPrefix = extractTargetPathPrefix(
      `${title} ${outcome} ${acceptance.join(" ")}`,
    );

    const selection = selectTwoModelsForSlice({
      candidates,
      profile,
      projectScale: resolvedScale,
      taskTokens: { inputTokens, outputTokens },
      llmPickedModel: originalModel,
      llmAlternatives: Array.isArray(task.alternatives)
        ? task.alternatives
        : undefined,
      quotaMode,
      targetPathPrefix,
      outcomes,
      repoStack,
    });

    const modelChanged = selection.primary.model !== originalModel;
    task.model = selection.primary.model;
    if (
      modelChanged ||
      typeof task.why !== "string" ||
      task.why.trim().length < 5
    ) {
      task.why = buildSynthesizedWhy(selection.primary, profile);
    }

    if (selection.secondary) {
      const nextAlts: Array<{ model: string; tradeoff: string }> = [
        {
          model: selection.secondary.model,
          tradeoff: selection.secondaryTradeoff,
        },
      ];
      // Keep at most 1 extra distinct LLM alternative if valid and non-overkill,
      // while keeping `alternatives[0]` strictly as the curated Option 2!
      if (Array.isArray(task.alternatives)) {
        for (const rawAlt of task.alternatives) {
          if (nextAlts.length >= 2) break;
          if (
            !rawAlt ||
            typeof rawAlt.model !== "string" ||
            typeof rawAlt.tradeoff !== "string" ||
            !rawAlt.tradeoff.trim()
          ) {
            continue;
          }
          const altCand = candidateById.get(rawAlt.model);
          if (
            !altCand ||
            rawAlt.model === selection.primary.model ||
            rawAlt.model === selection.secondary.model
          ) {
            continue;
          }
          if (
            isHeavySpecialistModel(altCand.model) &&
            (profile.complexity !== "high" ||
              resolvedScale === "small_app" ||
              resolvedScale === "micro")
          ) {
            continue;
          }
          nextAlts.push({
            model: rawAlt.model,
            tradeoff: rawAlt.tradeoff.trim(),
          });
        }
      }
      task.alternatives = nextAlts;
    } else {
      task.alternatives = [];
    }
  }

  return clone;
}

/**
 * Derives the top 2 selectable options (`[optionA, optionB]`) for UI rendering,
 * ensuring even older saved plans always display two meaningful, non-duplicate choices
 * whenever >= 2 candidates exist.
 */
export function resolveTwoUiModelOptions(params: {
  task: {
    title: string;
    outcome: string;
    acceptance?: readonly string[] | undefined;
    kind?: SliceKind | undefined;
    complexity?: SliceComplexity | undefined;
    model: string;
    why: string;
    alternatives: readonly { model: string; tradeoff: string }[];
    inputTokens: number;
    outputTokens: number;
  };
  projectScale?: ProjectScale | undefined;
  planTitle?: string | undefined;
  planGoal?: string | undefined;
  candidates: readonly RoutableCandidate[];
  strict: boolean;
}): Array<{
  candidate: RoutableCandidate;
  roleLabel: string;
  reason: string;
}> {
  const { task, candidates, strict } = params;
  if (candidates.length === 0) return [];

  const primaryCand =
    candidates.find((c) => c.model === task.model) ?? candidates[0]!;

  if (candidates.length === 1) {
    return [
      {
        candidate: primaryCand,
        roleLabel: "Recommended",
        reason: task.why,
      },
    ];
  }

  const altEntry = task.alternatives.find((a) =>
    candidates.some((c) => c.model === a.model && c.model !== primaryCand.model),
  );

  let secondaryCand = altEntry
    ? candidates.find((c) => c.model === altEntry.model) ?? null
    : null;
  let secondaryReason = altEntry?.tradeoff ?? "";

  if (!secondaryCand) {
    const scale = resolveProjectScale({
      idea: `${params.planTitle ?? ""} ${params.planGoal ?? ""}`,
      title: params.planTitle,
      goal: params.planGoal,
      rawScale: params.projectScale,
    });
    const profile = resolveSliceProfile({
      title: task.title,
      outcome: task.outcome,
      acceptance: task.acceptance,
      rawKind: task.kind,
      rawComplexity: task.complexity,
      projectScale: scale,
      strict,
    });
    const computed = selectTwoModelsForSlice({
      candidates,
      profile,
      projectScale: scale,
      taskTokens: {
        inputTokens: task.inputTokens,
        outputTokens: task.outputTokens,
      },
      llmPickedModel: primaryCand.model,
    });
    secondaryCand =
      computed.secondary && computed.secondary.model !== primaryCand.model
        ? computed.secondary
        : (candidates.find((c) => c.model !== primaryCand.model) ?? null);
    secondaryReason =
      computed.secondaryTradeoff ||
      (secondaryCand
        ? buildAlternativeTradeoff({
            primary: primaryCand,
            secondary: secondaryCand,
            taskTokens: {
              inputTokens: task.inputTokens,
              outputTokens: task.outputTokens,
            },
            profile,
          })
        : "");
  }

  if (!secondaryCand) {
    return [
      {
        candidate: primaryCand,
        roleLabel: "Recommended",
        reason: task.why,
      },
    ];
  }

  const tierRank = { fast: 1, balanced: 2, frontier: 3 } as const;
  let secondaryRole = "Alternative";
  if (secondaryCand.billing === "local" && primaryCand.billing !== "local") {
    secondaryRole = "$0 Local OSS";
  } else if (tierRank[secondaryCand.tier] > tierRank[primaryCand.tier]) {
    secondaryRole =
      secondaryCand.tier === "frontier"
        ? "Frontier step-up"
        : "Quality step-up";
  } else if (tierRank[secondaryCand.tier] < tierRank[primaryCand.tier]) {
    secondaryRole =
      secondaryCand.tier === "fast" ? "Leaner & faster" : "Balanced value";
  } else {
    secondaryRole = "Peer option";
  }

  return [
    {
      candidate: primaryCand,
      roleLabel: "Recommended",
      reason: task.why,
    },
    {
      candidate: secondaryCand,
      roleLabel: secondaryRole,
      reason: secondaryReason,
    },
  ];
}
