import {
  fetchArtificialAnalysisCatalog,
  type ArtificialAnalysisCatalog,
} from "@anvilmark/adapters";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import { writeJson } from "./common.js";

export interface CatalogOptions {
  readonly search?: string;
  readonly limit: number;
  readonly all: boolean;
  readonly json: boolean;
  /** Test seam; production reads ARTIFICIAL_ANALYSIS_API_KEY. */
  readonly apiKey?: string;
}

function score(value: number | null): string {
  return value === null ? "—" : String(value);
}

export function renderArtificialAnalysisCatalog(
  catalog: ArtificialAnalysisCatalog,
  options: Pick<CatalogOptions, "search" | "limit" | "all">,
): string {
  const needle = options.search?.toLowerCase();
  const matching = needle
    ? catalog.models.filter((model) =>
        [model.name, model.slug, model.creator_name].some((value) =>
          value.toLowerCase().includes(needle),
        ),
      )
    : catalog.models;
  const shown = options.all ? matching : matching.slice(0, options.limit);
  return (
    [
      "Language model catalog · Artificial Analysis",
      `Source: ${catalog.source_url}`,
      `Fetched: ${catalog.fetched_at} · response sha256:${catalog.response_sha256}`,
      `Coverage: ${catalog.models.length} models across ${catalog.pages_fetched} page${catalog.pages_fetched === 1 ? "" : "s"}; ${matching.length} match${matching.length === 1 ? "" : "es"}${shown.length < matching.length ? `; showing ${shown.length}` : ""}`,
      `Intelligence Index version: ${catalog.intelligence_index_version}`,
      "",
      "Intelligence  Coding  Agentic  Input $/1M  Output $/1M  Model · Creator",
      ...shown.map(
        (model) =>
          `${score(model.indices.artificial_analysis_intelligence_index ?? null).padStart(12)}  ${score(model.indices.artificial_analysis_coding_index ?? null).padStart(6)}  ${score(model.indices.artificial_analysis_agentic_index ?? null).padStart(7)}  ${score(model.price_1m_input_tokens).padStart(11)}  ${score(model.price_1m_output_tokens).padStart(12)}  ${model.name} · ${model.creator_name} (${model.slug})`,
      ),
      "",
      `Source attribution: ${catalog.attribution} (${catalog.attribution_url})`,
      "Free API data is for internal use with attribution. Customer-facing redistribution needs a separate Artificial Analysis license.",
      "Composite indices and median performance help screen models. They do not measure your project's workload or clear its quality gate. Null means unavailable.",
    ].join("\n") + "\n"
  );
}

export async function runArtificialAnalysisCatalog(
  context: CommandContext,
  options: CatalogOptions,
): Promise<ExitCode> {
  const apiKey =
    options.apiKey ?? context.io.env.ARTIFICIAL_ANALYSIS_API_KEY ?? "";
  const catalog = await fetchArtificialAnalysisCatalog(apiKey, {
    now: context.io.clock,
    signal: context.io.signal,
  });
  const needle = options.search?.toLowerCase();
  const matching = needle
    ? catalog.models.filter((model) =>
        [model.name, model.slug, model.creator_name].some((value) =>
          value.toLowerCase().includes(needle),
        ),
      )
    : catalog.models;
  if (options.json) {
    writeJson(context.io, { ...catalog, models: matching });
  } else {
    context.io.stdout(renderArtificialAnalysisCatalog(catalog, options));
  }
  return EXIT.ok;
}
