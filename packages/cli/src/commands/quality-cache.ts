import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  fetchArtificialAnalysisCatalog,
  fetchHuggingFaceBenchmarks,
  fetchHuggingFaceLeaderboard,
  fetchHuggingFaceModelEvals,
} from "@anvilmark/adapters";
import type { CatalogSnapshot } from "@anvilmark/model-catalog";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  numberOption,
  parse,
  requiredOption,
  writeJson,
} from "./common.js";

export const QUALITY_CACHE_USAGE = `Usage:
  anvilmark quality cache refresh benchmarks --db FILE
  anvilmark quality cache refresh leaderboard PUBLISHER/DATASET --db FILE
  anvilmark quality cache refresh model PUBLISHER/MODEL --db FILE
  anvilmark quality cache refresh catalog --db FILE
  anvilmark quality cache show KIND [ID] --db FILE [--max-age-hours N] [--json]
  anvilmark quality cache history KIND [ID] --db FILE [--limit N] [--max-age-hours N] [--json]

KIND is benchmarks, leaderboard, model, or catalog. Refresh fetches one live
source and saves an append-only snapshot. Show and history read saved snapshots
and label data older than the age limit stale (default 24 hours). No source
score is converted into a project workload measurement. Local storage requires
Node.js 24 or newer. Catalog refresh also needs ARTIFICIAL_ANALYSIS_API_KEY.

  --db FILE          path to the local SQLite catalog
  --max-age-hours N  freshness window for reads (default 24)
  --limit N          history rows (default 20, maximum 200)
  --json             emit complete snapshot metadata as JSON`;

type Kind = "benchmarks" | "leaderboard" | "model" | "catalog";

function parseKind(positionals: readonly string[]): {
  action: "refresh" | "show" | "history";
  kind: Kind;
  id: string | null;
} {
  const [action, kind, id] = positionals;
  if (
    (action !== "refresh" && action !== "show" && action !== "history") ||
    (kind !== "benchmarks" &&
      kind !== "leaderboard" &&
      kind !== "model" &&
      kind !== "catalog") ||
    positionals.length !== (kind === "leaderboard" || kind === "model" ? 3 : 2)
  ) {
    throw new UsageError(
      "give an action, source kind, and required ID",
      QUALITY_CACHE_USAGE,
    );
  }
  if ((kind === "leaderboard" || kind === "model") && !id?.trim()) {
    throw new UsageError(
      "model or benchmark ID is required",
      QUALITY_CACHE_USAGE,
    );
  }
  return { action, kind, id: id ?? null };
}

async function fetchSnapshot(
  context: CommandContext,
  kind: Kind,
  id: string | null,
): Promise<CatalogSnapshot> {
  const options = { now: context.io.clock, signal: context.io.signal };
  switch (kind) {
    case "benchmarks":
      return fetchHuggingFaceBenchmarks(options);
    case "leaderboard":
      return fetchHuggingFaceLeaderboard(id!, options);
    case "model":
      return fetchHuggingFaceModelEvals(id!, options);
    case "catalog":
      return fetchArtificialAnalysisCatalog(
        context.io.env.ARTIFICIAL_ANALYSIS_API_KEY ?? "",
        options,
      );
  }
}

export async function qualityCacheCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      db: { type: "string" },
      "max-age-hours": { type: "string" },
      limit: { type: "string" },
    },
    QUALITY_CACHE_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${QUALITY_CACHE_USAGE}\n`);
    return EXIT.ok;
  }
  const { action, kind, id } = parseKind(parsed.positionals);
  const dbPath = resolve(
    context.io.cwd,
    requiredOption(parsed, "db", QUALITY_CACHE_USAGE),
  );
  const maxAgeHours =
    numberOption(parsed, "max-age-hours", QUALITY_CACHE_USAGE) ?? 24;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 0) {
    throw new UsageError(
      "--max-age-hours must be a nonnegative number",
      QUALITY_CACHE_USAGE,
    );
  }
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const limit = numberOption(parsed, "limit", QUALITY_CACHE_USAGE) ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new UsageError(
      "--limit must be an integer from 1 to 200",
      QUALITY_CACHE_USAGE,
    );
  }
  if (
    action === "refresh" &&
    (flag(parsed, "json") ||
      parsed.values.limit !== undefined ||
      parsed.values["max-age-hours"] !== undefined)
  ) {
    throw new UsageError(
      "refresh does not take --json, --limit, or --max-age-hours",
      QUALITY_CACHE_USAGE,
    );
  }
  if (action === "show" && parsed.values.limit !== undefined) {
    throw new UsageError(
      "--limit applies to history only",
      QUALITY_CACHE_USAGE,
    );
  }
  if (action !== "refresh") {
    try {
      await stat(dbPath);
    } catch {
      throw new Error(
        `no model catalog database at ${dbPath}; run quality cache refresh first`,
      );
    }
  }
  const catalogModule = await import("@anvilmark/model-catalog");
  const sourceKey =
    kind === "benchmarks"
      ? catalogModule.SOURCE_KEYS.huggingFaceOfficialBenchmarks
      : kind === "catalog"
        ? catalogModule.SOURCE_KEYS.artificialAnalysis
        : kind === "leaderboard"
          ? catalogModule.huggingFaceLeaderboardSourceKey(id!)
          : catalogModule.huggingFaceModelEvalsSourceKey(id!);
  const catalog = await catalogModule.openModelCatalog(dbPath);
  try {
    if (action === "refresh") {
      const snapshot = await fetchSnapshot(context, kind, id);
      const stored = catalog.storeSnapshot(snapshot);
      context.io.stdout(
        `Saved ${stored.observation_count} ${kind} observation${stored.observation_count === 1 ? "" : "s"} as snapshot ${stored.id} (${stored.source_key})\nSource: ${stored.source_url}\nFetched: ${stored.fetched_at} · sha256:${stored.response_sha256}\n${stored.attribution === null ? "" : `Attribution: ${stored.attribution} (${stored.attribution_url})\nUsage rights: ${stored.usage_rights}\n`}`,
      );
      return EXIT.ok;
    }
    const readOptions = { now: new Date(context.io.clock()), maxAgeMs };
    if (action === "history") {
      const history = catalog.getHistory(sourceKey, { ...readOptions, limit });
      if (flag(parsed, "json")) writeJson(context.io, history);
      else {
        context.io.stdout(
          history.length === 0
            ? `No saved snapshots for ${sourceKey}.\n`
            : `Saved history: ${sourceKey}\n${history.map((entry) => `  ${entry.id}  ${entry.fetched_at}  ${entry.freshness}  ${entry.observation_count} observations  sha256:${entry.response_sha256}`).join("\n")}\n`,
        );
      }
      return EXIT.ok;
    }
    const stored = catalog.getLatest(sourceKey, readOptions);
    if (stored === null) {
      context.io.stdout(`No saved snapshot for ${sourceKey}.\n`);
      return EXIT.ok;
    }
    const observations = catalog.getObservations(stored.id);
    if (flag(parsed, "json")) {
      writeJson(context.io, { ...stored, observations });
    } else {
      context.io.stdout(
        `Saved snapshot ${stored.id}: ${stored.source_key}\nStatus: ${stored.freshness} (${Math.round(stored.age_ms / 3_600_000)} hours old; limit ${maxAgeHours} hours)\nSource: ${stored.source_url}\nFetched: ${stored.fetched_at} · sha256:${stored.response_sha256}\nCoverage: ${stored.observation_count} observations\n${stored.attribution === null ? "" : `Attribution: ${stored.attribution} (${stored.attribution_url})\nUsage rights: ${stored.usage_rights}\n`}${observations
          .slice(0, 20)
          .map(
            (entry) =>
              `  ${entry.kind}  ${entry.model_id ?? entry.benchmark_id ?? "unknown"}${entry.score === null ? "" : `  score ${entry.score}`}${entry.verified === null ? "" : `  ${entry.verified ? "verified" : "unverified"}`}`,
          )
          .join(
            "\n",
          )}${observations.length > 20 ? `\n  … ${observations.length - 20} more (use --json)` : ""}\n`,
      );
    }
    return EXIT.ok;
  } finally {
    catalog.close();
  }
}
