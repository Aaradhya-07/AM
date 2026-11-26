import { DatabaseSync } from "node:sqlite";

import { modelDatabasePath } from "./model-catalog-db";
import {
  computePlanSavingsSummary,
  defaultRoutingPreferences,
  estimateTaskUsd,
  subscriptionIds,
  type RoutableCandidate,
  type RoutingCatalogSnapshot,
  type RoutingPreferences,
  type SubscriptionId,
} from "./routing-types";
import type { SelfHostedModel } from "./self-hosted-models";

export {
  computePlanSavingsSummary,
  defaultRoutingPreferences,
  estimateTaskUsd,
  subscriptionIds,
  type RoutableCandidate,
  type RoutingCatalogSnapshot,
  type RoutingPreferences,
  type SubscriptionId,
};

interface CuratedModelSpec {
  model: string;
  label: string;
  providerLabel: string;
  offerNames: string[];
  arenaMatch: string[];
  tier: "frontier" | "balanced" | "fast";
  defaultInputUsd: number;
  defaultOutputUsd: number;
  defaultSourceUrl: string;
  strengths: string;
  groups: SubscriptionId[];
}

const curatedSpecs: readonly CuratedModelSpec[] = [
  {
    model: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    providerLabel: "Anthropic",
    offerNames: ["claude-opus-5-5", "Claude Opus 5.5"],
    arenaMatch: ["Claude Opus 5.5 (Max)", "Claude Opus 5.5 (High)"],
    tier: "frontier",
    defaultInputUsd: 4,
    defaultOutputUsd: 20,
    defaultSourceUrl:
      "https://platform.claude.com/docs/en/about-claude/pricing",
    strengths:
      "Top-ranked agent & coding model for ambiguous architecture, security boundaries, and cross-cutting refactors.",
    groups: ["claude", "cursor"],
  },
  {
    model: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    providerLabel: "Anthropic",
    offerNames: ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
    arenaMatch: ["Claude Sonnet 5.5 (Max)", "Claude Sonnet 5.5 (xHigh)"],
    tier: "balanced",
    defaultInputUsd: 2,
    defaultOutputUsd: 10,
    defaultSourceUrl:
      "https://platform.claude.com/docs/en/about-claude/pricing",
    strengths:
      "Strong daily coding workhorse (#2 Agent Arena) balancing multi-file accuracy and moderate token cost.",
    groups: ["claude", "cursor"],
  },
  {
    model: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    providerLabel: "Anthropic",
    offerNames: ["claude-haiku-5-5", "Claude Haiku 5.5"],
    arenaMatch: ["Claude Haiku 5.5"],
    tier: "fast",
    defaultInputUsd: 0.1,
    defaultOutputUsd: 0.5,
    defaultSourceUrl:
      "https://platform.claude.com/docs/en/models/haiku-5-5/overview",
    strengths:
      "Ultra-low-cost, fast execution for well-scoped schemas, boilerplate, types, and unit tests.",
    groups: ["claude", "cursor"],
  },
  {
    model: "gpt-6-astra",
    label: "GPT-6 Astra",
    providerLabel: "OpenAI",
    offerNames: ["gpt-6-astra", "GPT-6 Astra"],
    arenaMatch: ["GPT-6 Astra (Max)"],
    tier: "frontier",
    defaultInputUsd: 10,
    defaultOutputUsd: 50,
    defaultSourceUrl: "https://developers.openai.com/api/docs/pricing",
    strengths:
      "Heavy reasoning model (#3 Agent Arena) suited for tricky concurrency, algorithms, and state invariants.",
    groups: ["chatgpt"],
  },
  {
    model: "gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    providerLabel: "OpenAI",
    offerNames: ["gpt-6.1-sol", "GPT-6.1 Sol"],
    arenaMatch: ["GPT-6.1 Sol (Max)"],
    tier: "balanced",
    defaultInputUsd: 2,
    defaultOutputUsd: 10,
    defaultSourceUrl: "https://developers.openai.com/api/docs/pricing",
    strengths:
      "High-reliability Codex/OpenAI model (#5 Agent Arena) at 5x lower cost than Astra for feature slices.",
    groups: ["chatgpt", "cursor"],
  },
  {
    model: "gpt-6-luna",
    label: "GPT-6 Luna",
    providerLabel: "OpenAI",
    offerNames: ["gpt-6-luna", "GPT-6 Luna"],
    arenaMatch: ["GPT-6 Luna"],
    tier: "fast",
    defaultInputUsd: 0.1,
    defaultOutputUsd: 0.5,
    defaultSourceUrl: "https://developers.openai.com/api/docs/pricing",
    strengths:
      "Fast budget model for narrow CRUD endpoints, config wiring, fixtures, and straightforward tests.",
    groups: ["chatgpt"],
  },
  {
    model: "gemini-4-argon",
    label: "Gemini 4 Argon",
    providerLabel: "Google",
    offerNames: ["gemini/gemini-4-argon", "Gemini 4 Argon"],
    arenaMatch: ["Gemini 4 Argon (High)"],
    tier: "frontier",
    defaultInputUsd: 2,
    defaultOutputUsd: 10,
    defaultSourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    strengths:
      "#2 Coding Arena & #6 Agent Arena at $2/$10 per 1M tokens; strong full-stack & large-context synthesis.",
    groups: ["gemini", "cursor"],
  },
  {
    model: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    providerLabel: "Google",
    offerNames: ["gemini/gemini-3.8-flash", "Gemini 3.8 Flash"],
    arenaMatch: ["Gemini 3.8 Flash (High)"],
    tier: "fast",
    defaultInputUsd: 0.75,
    defaultOutputUsd: 3.75,
    defaultSourceUrl: "https://ai.google.dev/gemini-api/docs/pricing",
    strengths:
      "Top-15 Agent Arena flash model for rapid UI components, API glue, and iterative test passes.",
    groups: ["gemini"],
  },
  {
    model: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    providerLabel: "DeepSeek",
    offerNames: ["deepseek-v4-flash", "deepseek/deepseek-v4-flash"],
    arenaMatch: ["DeepSeek-V4-Flash"],
    tier: "fast",
    defaultInputUsd: 0.3,
    defaultOutputUsd: 1.2,
    defaultSourceUrl: "https://api-docs.deepseek.com/quick_start/pricing",
    strengths:
      "High-value open-weight API option for bounded backend tasks, SQL migrations, and test generation.",
    groups: [],
  },
];

let cachedCatalog: {
  fetchedAt: string;
  byModel: Map<
    string,
    Omit<RoutableCandidate, "billing" | "subscriptionGroup">
  >;
} | null = null;

function loadCatalogBase() {
  if (cachedCatalog) return cachedCatalog;

  let fetchedAt = "2026-10-27";
  const byModel = new Map<
    string,
    Omit<RoutableCandidate, "billing" | "subscriptionGroup">
  >();

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(modelDatabasePath(), { readOnly: true });
    const sourceRow = db
      .prepare(
        "SELECT fetched_at FROM catalog_sources ORDER BY fetched_at DESC LIMIT 1",
      )
      .get() as { fetched_at?: string } | undefined;
    if (sourceRow?.fetched_at) {
      fetchedAt = sourceRow.fetched_at.slice(0, 10);
    }

    const offerStmt = db.prepare(`
      SELECT input_usd_per_million, output_usd_per_million, source_url
      FROM model_offers
      WHERE lower(name) = lower(?) AND input_usd_per_million IS NOT NULL
      ORDER BY source_url IS NULL, input_usd_per_million ASC
      LIMIT 1
    `);

    const agentRankStmt = db.prepare(`
      SELECT rank FROM arena_ratings
      WHERE config = 'agent' AND category = 'overall' AND model_name = ?
      LIMIT 1
    `);

    const codingScoreStmt = db.prepare(`
      SELECT score FROM arena_ratings
      WHERE config = 'text' AND category = 'coding' AND model_name = ?
      LIMIT 1
    `);

    for (const spec of curatedSpecs) {
      let inputUsd = spec.defaultInputUsd;
      let outputUsd = spec.defaultOutputUsd;
      let sourceUrl: string | null = spec.defaultSourceUrl;

      for (const offerName of spec.offerNames) {
        const offer = offerStmt.get(offerName) as
          | {
              input_usd_per_million: number;
              output_usd_per_million: number | null;
              source_url: string | null;
            }
          | undefined;
        if (offer) {
          inputUsd = Number(offer.input_usd_per_million.toFixed(4));
          outputUsd = Number(
            (offer.output_usd_per_million ?? spec.defaultOutputUsd).toFixed(4),
          );
          if (offer.source_url) sourceUrl = offer.source_url;
          break;
        }
      }

      let arenaAgentRank: number | null = null;
      let arenaCodingScore: number | null = null;
      for (const arenaName of spec.arenaMatch) {
        if (arenaAgentRank === null) {
          const agentRow = agentRankStmt.get(arenaName) as
            { rank: number | null } | undefined;
          if (agentRow?.rank != null) arenaAgentRank = agentRow.rank;
        }
        if (arenaCodingScore === null) {
          const codingRow = codingScoreStmt.get(arenaName) as
            { score: number | null } | undefined;
          if (codingRow?.score != null) {
            arenaCodingScore = Math.round(codingRow.score);
          }
        }
      }

      byModel.set(spec.model, {
        model: spec.model,
        label: spec.label,
        provider: spec.providerLabel,
        tier: spec.tier,
        inputUsdPerMillion: inputUsd,
        outputUsdPerMillion: outputUsd,
        sourceUrl,
        arenaAgentRank,
        arenaCodingScore,
        catalogDate: fetchedAt,
        strengths: spec.strengths,
      });
    }
  } catch {
    for (const spec of curatedSpecs) {
      byModel.set(spec.model, {
        model: spec.model,
        label: spec.label,
        provider: spec.providerLabel,
        tier: spec.tier,
        inputUsdPerMillion: spec.defaultInputUsd,
        outputUsdPerMillion: spec.defaultOutputUsd,
        sourceUrl: spec.defaultSourceUrl,
        arenaAgentRank: null,
        arenaCodingScore: null,
        catalogDate: fetchedAt,
        strengths: spec.strengths,
      });
    }
  } finally {
    db?.close();
  }

  cachedCatalog = { fetchedAt, byModel };
  return cachedCatalog;
}

function buildLocalCandidates(
  selfHostedModels: readonly SelfHostedModel[],
  fetchedAt: string,
): RoutableCandidate[] {
  const picked: SelfHostedModel[] = [];
  const coder = selfHostedModels.find((m) => /coder|27b|26b/i.test(m.id));
  const fast = selfHostedModels.find((m) => /9b|12b/i.test(m.id));
  if (coder) picked.push(coder);
  if (fast && fast.id !== coder?.id) picked.push(fast);
  if (picked.length === 0 && selfHostedModels[0]) {
    picked.push(selfHostedModels[0]);
  }

  return picked.map((item) => ({
    model: item.id,
    label: `${item.label} (Local OSS)`,
    provider: "am-server",
    tier: /coder|27b|26b|20b/i.test(item.id) ? "balanced" : "fast",
    billing: "local",
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    sourceUrl: null,
    arenaAgentRank: null,
    arenaCodingScore: null,
    catalogDate: fetchedAt,
    strengths: /coder/i.test(item.id)
      ? "Zero-API-cost 30B MoE coding model on your Ubuntu server for private implementation tasks."
      : "Fast local open-weight model on your Ubuntu server for zero-cost scaffolding, fixtures, and unit tests.",
    subscriptionGroup: "local_oss",
  }));
}

export function resolveRoutingPool(
  prefs: RoutingPreferences,
  selfHostedModels: readonly SelfHostedModel[] = [],
): RoutingCatalogSnapshot {
  const { fetchedAt, byModel } = loadCatalogBase();
  const activeSubs = new Set(prefs.subscriptions);
  const isOpen = prefs.mode === "open" || activeSubs.size === 0;

  const selected: RoutableCandidate[] = [];

  if (isOpen) {
    const openOrder = [
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "gemini-4-argon",
      "gpt-6.1-sol",
      "claude-haiku-5-5",
      "gpt-6-luna",
      "deepseek-v4-flash",
    ];
    const localPool = buildLocalCandidates(selfHostedModels, fetchedAt).slice(
      0,
      1,
    );
    for (const modelId of openOrder) {
      if (selected.length + localPool.length >= 8) break;
      const base = byModel.get(modelId);
      if (base) {
        selected.push({ ...base, billing: "api" });
      }
    }
    selected.push(...localPool);
    return { fetchedAt, candidates: selected };
  }

  for (const spec of curatedSpecs) {
    const matchedGroup = spec.groups.find((group) => activeSubs.has(group));
    if (!matchedGroup) continue;
    const base = byModel.get(spec.model);
    if (!base) continue;
    selected.push({
      ...base,
      billing: "subscription",
      subscriptionGroup: matchedGroup,
    });
    if (selected.length >= 6 && !activeSubs.has("local_oss")) break;
  }

  if (activeSubs.has("local_oss")) {
    const remaining = Math.max(1, 8 - selected.length);
    selected.push(
      ...buildLocalCandidates(selfHostedModels, fetchedAt).slice(0, remaining),
    );
  }

  if (selected.length === 0) {
    return resolveRoutingPool(
      { mode: "open", subscriptions: [] },
      selfHostedModels,
    );
  }

  return { fetchedAt, candidates: selected.slice(0, 8) };
}
