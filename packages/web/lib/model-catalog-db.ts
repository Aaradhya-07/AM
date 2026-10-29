import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ModelOffer {
  id: string;
  source_id: string;
  canonical_model_id: string | null;
  provider: string;
  name: string;
  mode: string;
  status: string | null;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  input_usd_per_million: number | null;
  output_usd_per_million: number | null;
  cache_read_usd_per_million: number | null;
  output_usd_per_image: number | null;
  input_usd_per_second: number | null;
  output_usd_per_second: number | null;
  vision: number | null;
  tools: number | null;
  reasoning: number | null;
  audio_input: number | null;
  audio_output: number | null;
  deprecation_date: string | null;
  source_url: string | null;
}

export interface ModelBenchmark {
  name: string;
  score: number;
  metric: string | null;
  variant: string | null;
  source_url: string | null;
}

export interface ModelRelease {
  id: string;
  name: string;
  description: string | null;
  family: string | null;
  model_type: string | null;
  creator: string;
  release_date: string | null;
  last_updated: string | null;
  open_weights: number | null;
  weight_license: string | null;
  context_tokens: number | null;
  max_output_tokens: number | null;
  input_modalities: string[];
  output_modalities: string[];
  source_url: string | null;
  benchmarks: ModelBenchmark[];
}

export interface CatalogSource {
  id: string;
  url: string;
  license: string;
  license_url: string;
  fetched_at: string;
  sha256: string;
}

export interface ModelCatalogPayload {
  offers: ModelOffer[];
  releases: ModelRelease[];
  sources: CatalogSource[];
  arena_rating_count: number;
}

export function modelDatabasePath() {
  const cwd = process.cwd();
  const candidate = join(cwd, "data", "models.sqlite");
  return existsSync(candidate)
    ? candidate
    : join(cwd, "packages", "web", "data", "models.sqlite");
}

export function readModelCatalog(): ModelCatalogPayload {
  const db = new DatabaseSync(modelDatabasePath(), { readOnly: true });
  try {
    const sourceRows = db
      .prepare(
        "SELECT id, url, license, license_url, fetched_at, sha256 FROM catalog_sources ORDER BY id",
      )
      .all() as unknown as CatalogSource[];
    const offerRows = db
      .prepare(
        `SELECT model_offers.id, model_offers.source_id, canonical_model_id,
      providers.name AS provider, model_offers.name, mode, status,
      max_input_tokens, max_output_tokens, input_usd_per_million,
      output_usd_per_million, cache_read_usd_per_million,
      output_usd_per_image, input_usd_per_second, output_usd_per_second, vision, tools,
      reasoning, audio_input, audio_output, deprecation_date, source_url
      FROM model_offers JOIN providers ON providers.id = model_offers.provider_id
      ORDER BY model_offers.name`,
      )
      .all() as unknown as ModelOffer[];
    const releases = db
      .prepare(
        `SELECT id, name, description, family, model_type, creator,
      release_date, last_updated, open_weights, weight_license, context_tokens,
      max_output_tokens, input_modalities, output_modalities, source_url
      FROM model_releases ORDER BY release_date DESC, name`,
      )
      .all() as unknown as Array<
      Omit<
        ModelRelease,
        "benchmarks" | "input_modalities" | "output_modalities"
      > & { input_modalities: string; output_modalities: string }
    >;
    const benchmarks = db
      .prepare(
        `SELECT release_id, name, score, metric, variant, source_url
      FROM model_benchmarks ORDER BY name`,
      )
      .all() as unknown as Array<ModelBenchmark & { release_id: string }>;
    const benchmarksByRelease = new Map<string, ModelBenchmark[]>();
    for (const { release_id, ...benchmark } of benchmarks) {
      const list = benchmarksByRelease.get(release_id) ?? [];
      list.push(benchmark);
      benchmarksByRelease.set(release_id, list);
    }
    return {
      // node:sqlite produces rows with a null prototype. React Server
      // Components require plain objects when passing data to a client view.
      offers: offerRows.map((offer) => ({ ...offer })),
      releases: releases.map((release) => ({
        ...release,
        input_modalities: JSON.parse(release.input_modalities) as string[],
        output_modalities: JSON.parse(release.output_modalities) as string[],
        benchmarks: benchmarksByRelease.get(release.id) ?? [],
      })),
      sources: sourceRows.map((source) => ({ ...source })),
      arena_rating_count: (
        db.prepare("SELECT COUNT(*) AS count FROM arena_ratings").get() as {
          count: number;
        }
      ).count,
    };
  } finally {
    db.close();
  }
}
