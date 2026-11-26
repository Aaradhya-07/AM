export const subscriptionIds = [
  "claude",
  "chatgpt",
  "gemini",
  "cursor",
  "local_oss",
] as const;

export type SubscriptionId = (typeof subscriptionIds)[number];

export interface SubscriptionOptionMeta {
  id: SubscriptionId;
  label: string;
  shortLabel: string;
  description: string;
}

export const subscriptionCatalog: readonly SubscriptionOptionMeta[] = [
  {
    id: "claude",
    label: "Claude Pro / Max",
    shortLabel: "Claude",
    description: "Claude Code · Opus 5.5, Sonnet 5.5, Haiku 5.5",
  },
  {
    id: "chatgpt",
    label: "ChatGPT Plus / Pro",
    shortLabel: "ChatGPT",
    description: "Codex · GPT-6 Astra, GPT-6.1 Sol, GPT-6 Luna",
  },
  {
    id: "gemini",
    label: "Gemini AI Pro",
    shortLabel: "Gemini",
    description: "Gemini 4 Argon, Gemini 3.8 Flash",
  },
  {
    id: "cursor",
    label: "Cursor Pro / Paid IDE",
    shortLabel: "Cursor",
    description: "Multi-model IDE routing across Claude, GPT & Gemini",
  },
  {
    id: "local_oss",
    label: "Local OSS (am-server)",
    shortLabel: "Local OSS",
    description: "Zero-API-cost Qwen 3 Coder 30B, Qwen 3.5 9B & Gemma 4",
  },
];

export interface RoutingPreferences {
  mode: "open" | "subscriptions";
  subscriptions: SubscriptionId[];
}

export const defaultRoutingPreferences: RoutingPreferences = {
  mode: "open",
  subscriptions: [],
};

export const routingPrefsStorageKey = "anvilmark.beta.routingPrefs";

export interface RoutableCandidate {
  model: string;
  label: string;
  provider: string;
  tier: "frontier" | "balanced" | "fast";
  billing: "api" | "subscription" | "local";
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
  sourceUrl: string | null;
  arenaAgentRank: number | null;
  arenaCodingScore: number | null;
  catalogDate: string;
  strengths: string;
  subscriptionGroup?: SubscriptionId;
}

export interface RoutingCatalogSnapshot {
  fetchedAt: string;
  candidates: RoutableCandidate[];
}

export function formatRoutingSummary(prefs: RoutingPreferences): string {
  if (prefs.mode === "open" || prefs.subscriptions.length === 0) {
    return "Open best-fit";
  }
  if (prefs.subscriptions.length === 1) {
    const found = subscriptionCatalog.find(
      (item) => item.id === prefs.subscriptions[0],
    );
    return found ? found.shortLabel : "1 subscription";
  }
  return `${prefs.subscriptions.length} tools`;
}

export function estimateTaskUsd(
  task: { inputTokens: number; outputTokens: number },
  candidate: Pick<
    RoutableCandidate,
    "inputUsdPerMillion" | "outputUsdPerMillion" | "billing"
  >,
): number | null {
  if (candidate.billing === "local") return 0;
  if (
    candidate.inputUsdPerMillion === null ||
    candidate.outputUsdPerMillion === null
  ) {
    return null;
  }
  return (
    (task.inputTokens * candidate.inputUsdPerMillion +
      task.outputTokens * candidate.outputUsdPerMillion) /
    1_000_000
  );
}

export function computePlanSavingsSummary(
  tasks: readonly {
    model: string;
    inputTokens: number;
    outputTokens: number;
  }[],
  candidates: readonly RoutableCandidate[],
): {
  routedUsd: number;
  frontierBaselineUsd: number;
  frontierModelLabel: string;
  savedUsd: number;
  savedPercent: number;
} | null {
  const priced = candidates.filter(
    (c) =>
      c.inputUsdPerMillion !== null &&
      c.outputUsdPerMillion !== null &&
      (c.inputUsdPerMillion > 0 || c.outputUsdPerMillion > 0),
  );
  if (priced.length === 0 || tasks.length === 0) return null;

  const frontier = [...priced].sort(
    (a, b) =>
      (b.outputUsdPerMillion ?? 0) +
      (b.inputUsdPerMillion ?? 0) -
      ((a.outputUsdPerMillion ?? 0) + (a.inputUsdPerMillion ?? 0)),
  )[0];
  if (!frontier) return null;

  let routedUsd = 0;
  let frontierBaselineUsd = 0;
  for (const task of tasks) {
    const chosen = candidates.find((c) => c.model === task.model);
    const taskCost = chosen ? estimateTaskUsd(task, chosen) : null;
    if (taskCost === null) return null;
    routedUsd += taskCost;

    const baselineCost = estimateTaskUsd(task, frontier);
    if (baselineCost === null) return null;
    frontierBaselineUsd += baselineCost;
  }

  const savedUsd = Math.max(0, frontierBaselineUsd - routedUsd);
  const savedPercent =
    frontierBaselineUsd > 0
      ? Math.round((savedUsd / frontierBaselineUsd) * 100)
      : 0;

  return {
    routedUsd,
    frontierBaselineUsd,
    frontierModelLabel: frontier.label,
    savedUsd,
    savedPercent,
  };
}
