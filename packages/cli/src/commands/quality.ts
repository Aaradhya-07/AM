import {
  fetchHuggingFaceBenchmarks,
  fetchHuggingFaceLeaderboard,
  fetchHuggingFaceModelEvals,
  type PublicBenchmarkCatalog,
  type PublicBenchmarkSnapshot,
  type PublicModelEvals,
} from "@anvilmark/adapters";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  numberOption,
  parse,
  stringOption,
  writeJson,
} from "./common.js";
import { runArtificialAnalysisCatalog } from "./quality-catalog.js";
import { qualityCacheCommand } from "./quality-cache.js";

export const QUALITY_USAGE = `Usage:
  anvilmark quality benchmarks [--search TEXT] [--limit N | --all] [--json]
  anvilmark quality leaderboard BENCHMARK_ID [--search TEXT] [--limit N | --all] [--json]
  anvilmark quality model PUBLISHER/MODEL [--limit N | --all] [--json]
  anvilmark quality catalog [--search TEXT] [--limit N | --all] [--json]
  anvilmark quality cache ACTION KIND [ID] --db FILE [options]

Discover official benchmark datasets, submitted scores for one benchmark,
published scores for a Hub model, or the Artificial Analysis language-model
catalog. Examples:
  anvilmark quality benchmarks --search coding
  anvilmark quality leaderboard SWE-bench/SWE-bench_Verified
  anvilmark quality model openai/gpt-oss-20b
  anvilmark quality catalog --search openai
  anvilmark quality cache --help

Direct source commands are read-only and need no Anvilmark project. The
Hugging Face commands need no key; catalog needs ARTIFICIAL_ANALYSIS_API_KEY
in the environment and its Free API data is for internal use with attribution.
The cache subcommand writes only to the SQLite path supplied with --db. Outputs
preserve source, retrieval time, and response hash. Published scores and
indices do not measure your workload's quality or clear a contract quality gate.

  --search TEXT  filter benchmark IDs or model names (case-insensitive)
  --limit N      show at most N rows in text output (default 20, maximum 200)
  --all          show every matching row in text output
  --json         emit the complete matching snapshot as JSON`;

function displayScore(score: number): string {
  return Number.isInteger(score)
    ? String(score)
    : String(Number(score.toPrecision(6)));
}

function verification(value: boolean | null): string {
  return value === true
    ? "verified"
    : value === false
      ? "unverified"
      : "unknown";
}

export function renderLeaderboard(
  snapshot: PublicBenchmarkSnapshot,
  options: { readonly search?: string; readonly limit?: number } = {},
): string {
  const matching = options.search
    ? snapshot.results.filter((entry) =>
        entry.model_id.toLowerCase().includes(options.search!.toLowerCase()),
      )
    : snapshot.results;
  const shown = matching.slice(0, options.limit ?? matching.length);
  const verified = snapshot.results.filter(
    (entry) => entry.verified === true,
  ).length;
  const directions = new Set(
    snapshot.results.map((entry) => entry.lower_is_better),
  );
  const direction =
    directions.size === 1 && directions.has(true)
      ? "lower is better"
      : directions.size === 1 && directions.has(false)
        ? "higher is better"
        : "varies or is unknown; inspect the JSON rows";
  const lines = [
    `Public benchmark: ${snapshot.benchmark_id}`,
    `Source: ${snapshot.source_url}`,
    `Fetched: ${snapshot.fetched_at} · response sha256:${snapshot.response_sha256}`,
    `Coverage: ${snapshot.results.length} submitted results (${verified} verified); ${matching.length} match${matching.length === 1 ? "" : "es"}${shown.length < matching.length ? `; showing ${shown.length}` : ""}`,
    `Score direction: ${direction}`,
    "",
    "Rank     Score  Verification  Model",
    ...shown.flatMap((entry) => [
      `${String(entry.rank).padStart(4)}  ${displayScore(entry.score).padStart(8)}  ${verification(entry.verified).padEnd(12)}  ${entry.model_id}${entry.notes ? ` (${entry.notes})` : ""}`,
      ...(entry.source_url === null
        ? []
        : [`      Submission: ${entry.source_url}`]),
    ]),
    "",
    "Each score belongs to this benchmark and its linked submission. A leaderboard score is not a test of your project's workload or a contract quality-gate pass.",
  ];
  if (matching.length === 0) lines.push("No model IDs matched this search.");
  return `${lines.join("\n")}\n`;
}

export function renderBenchmarks(
  catalog: PublicBenchmarkCatalog,
  options: { readonly search?: string; readonly limit?: number } = {},
): string {
  const matching = options.search
    ? catalog.benchmarks.filter((entry) =>
        entry.id.toLowerCase().includes(options.search!.toLowerCase()),
      )
    : catalog.benchmarks;
  const shown = matching.slice(0, options.limit ?? matching.length);
  return (
    [
      "Official benchmark datasets on Hugging Face",
      `Source: ${catalog.source_url}`,
      `Fetched: ${catalog.fetched_at} · response sha256:${catalog.response_sha256}`,
      `Coverage: ${catalog.benchmarks.length} datasets; ${matching.length} match${matching.length === 1 ? "" : "es"}${shown.length < matching.length ? `; showing ${shown.length}` : ""}`,
      "",
      ...shown.map((entry) => `  ${entry.id}`),
      "",
      "Use: anvilmark quality leaderboard PUBLISHER/DATASET",
    ].join("\n") + "\n"
  );
}

export function renderModelEvals(
  model: PublicModelEvals,
  limit: number,
): string {
  const shown = model.results.slice(0, limit);
  const verified = model.results.filter(
    (entry) => entry.verified === true,
  ).length;
  return (
    [
      `Published evaluations: ${model.model_id}`,
      `Source: ${model.source_url}`,
      `Fetched: ${model.fetched_at} · response sha256:${model.response_sha256}`,
      `Coverage: ${model.results.length} published results (${verified} verified)${shown.length < model.results.length ? `; showing ${shown.length}` : ""}`,
      "",
      "   Score  Verification  Evaluation date  Benchmark / task",
      ...shown.flatMap((entry) => [
        `${displayScore(entry.score).padStart(8)}  ${verification(entry.verified).padEnd(12)}  ${(entry.evaluation_date?.slice(0, 10) ?? "unknown").padEnd(15)}  ${entry.benchmark_id}${entry.task_id ? ` / ${entry.task_id}` : ""}`,
        ...(entry.source_url === null
          ? []
          : [`       Result: ${entry.source_url}`]),
      ]),
      "",
      "Scores from different benchmarks have different meanings and must not be averaged. Published results do not by themselves pass a project's workload quality gate.",
    ].join("\n") + "\n"
  );
}

export async function qualityCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  if (sub === "cache") return qualityCacheCommand(context);
  const parsed = parse(
    context.args,
    {
      search: { type: "string" },
      limit: { type: "string" },
      all: { type: "boolean" },
    },
    QUALITY_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${QUALITY_USAGE}\n`);
    return EXIT.ok;
  }
  if (
    (sub !== "leaderboard" &&
      sub !== "model" &&
      sub !== "benchmarks" &&
      sub !== "catalog") ||
    parsed.positionals.length !==
      (sub === "benchmarks" || sub === "catalog" ? 0 : 1)
  ) {
    throw new UsageError(
      "give benchmarks, leaderboard BENCHMARK_ID, model PUBLISHER/MODEL, or catalog",
      QUALITY_USAGE,
    );
  }
  if (flag(parsed, "all") && stringOption(parsed, "limit") !== undefined) {
    throw new UsageError("use --all or --limit, not both", QUALITY_USAGE);
  }
  const limit = numberOption(parsed, "limit", QUALITY_USAGE) ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new UsageError(
      "--limit must be an integer from 1 to 200",
      QUALITY_USAGE,
    );
  }
  const search = stringOption(parsed, "search");
  if (sub === "catalog") {
    return runArtificialAnalysisCatalog(context, {
      ...(search === undefined ? {} : { search }),
      limit,
      all: flag(parsed, "all"),
      json: flag(parsed, "json"),
    });
  }
  if (sub === "benchmarks") {
    const catalog = await fetchHuggingFaceBenchmarks({
      now: context.io.clock,
      signal: context.io.signal,
    });
    const matching = search
      ? catalog.benchmarks.filter((entry) =>
          entry.id.toLowerCase().includes(search.toLowerCase()),
        )
      : catalog.benchmarks;
    if (flag(parsed, "json")) {
      writeJson(context.io, { ...catalog, benchmarks: matching });
    } else {
      context.io.stdout(
        renderBenchmarks(catalog, {
          ...(search === undefined ? {} : { search }),
          ...(flag(parsed, "all") ? {} : { limit }),
        }),
      );
    }
  } else if (sub === "model") {
    if (search !== undefined) {
      throw new UsageError(
        "--search applies to benchmarks and leaderboard only",
        QUALITY_USAGE,
      );
    }
    const model = await fetchHuggingFaceModelEvals(parsed.positionals[0]!, {
      now: context.io.clock,
      signal: context.io.signal,
    });
    if (flag(parsed, "json")) {
      writeJson(context.io, model);
    } else {
      context.io.stdout(
        renderModelEvals(
          model,
          flag(parsed, "all") ? model.results.length : limit,
        ),
      );
    }
  } else {
    const snapshot = await fetchHuggingFaceLeaderboard(parsed.positionals[0]!, {
      now: context.io.clock,
      signal: context.io.signal,
    });
    const matching = search
      ? snapshot.results.filter((entry) =>
          entry.model_id.toLowerCase().includes(search.toLowerCase()),
        )
      : snapshot.results;
    if (flag(parsed, "json")) {
      writeJson(context.io, { ...snapshot, results: matching });
    } else {
      context.io.stdout(
        renderLeaderboard(snapshot, {
          ...(search === undefined ? {} : { search }),
          ...(flag(parsed, "all") ? {} : { limit }),
        }),
      );
    }
  }
  return EXIT.ok;
}
