#!/usr/bin/env node
// Rebuild the read-only web catalog from attributed public feeds.
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFile, mkdir, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parquetReadObjects } from "hyparquet";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const MODELSDEV_OFFERS_URL = "https://models.dev/api.json?type=all";
const MODELSDEV_RELEASES_URL = "https://models.dev/models.json?type=all";
const ARENA_META_URL =
  "https://datasets-server.huggingface.co/parquet?dataset=lmarena-ai/leaderboard-dataset";
const ARENA_DATASET_URL =
  "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset";
const TRANSFORM_VERSION = 11;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/models.sqlite",
);
async function sourceBytes(url, inputFlag) {
  const index = process.argv.indexOf(inputFlag);
  if (index >= 0) {
    if (!process.argv[index + 1]) throw new Error(`${inputFlag} needs a path`);
    return readFile(resolve(process.argv[index + 1]));
  }
  const response = await globalThis.fetch(url, {
    signal: globalThis.AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const [litellmBytes, offerBytes, releaseBytes, arenaMetaBytes] =
  await Promise.all([
    sourceBytes(LITELLM_URL, "--input"),
    sourceBytes(MODELSDEV_OFFERS_URL, "--modelsdev-offers-input"),
    sourceBytes(MODELSDEV_RELEASES_URL, "--modelsdev-releases-input"),
    sourceBytes(ARENA_META_URL, "--arena-meta-input"),
  ]);
const registry = JSON.parse(litellmBytes.toString("utf8"));
const modelsDevProviders = JSON.parse(offerBytes.toString("utf8"));
const modelsDevReleases = JSON.parse(releaseBytes.toString("utf8"));
const arenaFilesMetadata = JSON.parse(arenaMetaBytes.toString("utf8"))
  .parquet_files?.filter(
    (file) =>
      file.split === "latest" &&
      typeof file.config === "string" &&
      typeof file.url === "string",
  )
  .sort((a, b) => a.config.localeCompare(b.config));
if (!arenaFilesMetadata || arenaFilesMetadata.length < 10)
  throw new Error("Arena latest snapshot file list is missing or too small");
const arenaFiles = [];
for (let index = 0; index < arenaFilesMetadata.length; index += 6) {
  const batch = arenaFilesMetadata.slice(index, index + 6);
  arenaFiles.push(
    ...(await Promise.all(
      batch.map(async (file) => {
        const bytes = await sourceBytes(
          file.url,
          `--arena-${file.config}-input`,
        );
        return { ...file, bytes, sha256: sha256(bytes) };
      }),
    )),
  );
}
const fetchedAt = new Date().toISOString();
const sourceDigests = {
  litellm: sha256(litellmBytes),
  modelsdev_offers: sha256(offerBytes),
  modelsdev_releases: sha256(releaseBytes),
  arena: sha256(
    arenaFiles.map((file) => `${file.config}:${file.sha256}`).join("|"),
  ),
};
const temp = `${output}.next`;
await mkdir(dirname(output), { recursive: true });
let existing;
try {
  existing = new DatabaseSync(output, { readOnly: true });
  const current = existing
    .prepare("SELECT id, sha256, transform_version FROM catalog_sources")
    .all();
  if (
    current.length === 4 &&
    current.every(
      (row) =>
        sourceDigests[row.id] === row.sha256 &&
        row.transform_version === TRANSFORM_VERSION,
    )
  ) {
    console.log("Catalog sources unchanged; no database update needed.");
    process.exit(0);
  }
} catch {
  // A missing or older database is replaced by the validated new snapshot.
} finally {
  existing?.close();
}
await unlink(temp).catch(() => {});
const db = new DatabaseSync(temp);
db.exec(`
  PRAGMA journal_mode=DELETE;
  PRAGMA foreign_keys=ON;
  CREATE TABLE catalog_sources (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, license TEXT NOT NULL,
    license_url TEXT NOT NULL, fetched_at TEXT NOT NULL, sha256 TEXT NOT NULL,
    transform_version INTEGER NOT NULL
  );
  CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE model_releases (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES catalog_sources(id),
    name TEXT NOT NULL, description TEXT, family TEXT, model_type TEXT, creator TEXT,
    release_date TEXT, last_updated TEXT, open_weights INTEGER,
    weight_license TEXT, context_tokens INTEGER, max_output_tokens INTEGER,
    input_modalities TEXT, output_modalities TEXT, source_url TEXT,
    raw_json TEXT NOT NULL
  );
  CREATE TABLE model_benchmarks (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL REFERENCES model_releases(id),
    name TEXT NOT NULL, score REAL NOT NULL, metric TEXT,
    variant TEXT, source_url TEXT
  );
  CREATE TABLE model_offers (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES providers(id),
    source_id TEXT NOT NULL REFERENCES catalog_sources(id),
    canonical_model_id TEXT,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT,
    max_input_tokens INTEGER,
    max_output_tokens INTEGER,
    input_usd_per_million REAL,
    output_usd_per_million REAL,
    cache_read_usd_per_million REAL,
    output_usd_per_image REAL,
    input_usd_per_second REAL,
    output_usd_per_second REAL,
    vision INTEGER,
    tools INTEGER,
    reasoning INTEGER,
    audio_input INTEGER,
    audio_output INTEGER,
    deprecation_date TEXT,
    source_url TEXT,
    raw_json TEXT NOT NULL
  );
  CREATE TABLE offer_metrics (
    offer_id TEXT NOT NULL REFERENCES model_offers(id),
    metric_key TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES catalog_sources(id),
    measured_at TEXT,
    PRIMARY KEY (offer_id, metric_key, source_id)
  );
  CREATE TABLE arena_source_files (
    config TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES catalog_sources(id),
    url TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL
  );
  CREATE TABLE arena_ratings (
    id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES catalog_sources(id),
    config TEXT NOT NULL, category TEXT NOT NULL,
    model_name TEXT NOT NULL, organization TEXT, model_license TEXT,
    score REAL NOT NULL, score_lower REAL, score_upper REAL,
    score_kind TEXT NOT NULL, sample_count INTEGER, sample_kind TEXT,
    observation_count INTEGER, rank INTEGER, published_date TEXT NOT NULL,
    raw_json TEXT NOT NULL
  );
  CREATE INDEX offers_provider ON model_offers(provider_id);
  CREATE INDEX offers_canonical ON model_offers(canonical_model_id);
  CREATE INDEX releases_date ON model_releases(release_date);
  CREATE INDEX benchmarks_name ON model_benchmarks(name);
  CREATE INDEX offers_mode ON model_offers(mode);
  CREATE INDEX offers_input_price ON model_offers(input_usd_per_million);
  CREATE INDEX offers_context ON model_offers(max_input_tokens);
  CREATE INDEX offers_name ON model_offers(name);
  CREATE INDEX metrics_key ON offer_metrics(metric_key, value);
  CREATE INDEX arena_category_rank ON arena_ratings(config, category, rank);
  CREATE INDEX arena_model ON arena_ratings(model_name);
`);
const insertSource = db.prepare(
  "INSERT INTO catalog_sources VALUES (?, ?, ?, ?, ?, ?, ?)",
);
for (const [id, url, licenseUrl] of [
  [
    "litellm",
    LITELLM_URL,
    "https://github.com/BerriAI/litellm/blob/main/LICENSE",
  ],
  [
    "modelsdev_offers",
    MODELSDEV_OFFERS_URL,
    "https://github.com/anomalyco/models.dev/blob/dev/LICENSE",
  ],
  [
    "modelsdev_releases",
    MODELSDEV_RELEASES_URL,
    "https://github.com/anomalyco/models.dev/blob/dev/LICENSE",
  ],
  ["arena", ARENA_DATASET_URL, "https://creativecommons.org/licenses/by/4.0/"],
])
  insertSource.run(
    id,
    url,
    id === "arena" ? "CC BY 4.0" : "MIT",
    licenseUrl,
    fetchedAt,
    sourceDigests[id],
    TRANSFORM_VERSION,
  );
const providerInsert = db.prepare(
  "INSERT INTO providers VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
);
const insert = db.prepare(`INSERT INTO model_offers VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const releaseInsert = db.prepare(`INSERT INTO model_releases VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const benchmarkInsert = db.prepare(
  `INSERT OR IGNORE INTO model_benchmarks VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const arenaFileInsert = db.prepare(
  "INSERT INTO arena_source_files VALUES (?, ?, ?, ?, ?)",
);
const arenaRatingInsert = db.prepare(`INSERT INTO arena_ratings VALUES
  (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const number = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const safeUrl = (value) =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;
const artificialAnalysisUrl = (value) =>
  typeof value === "string" &&
  /https?:\/\/(?:[^/]*\.)?artificialanalysis(?:\.ai|cdn\.com)(?:\/|$)/i.test(
    value,
  );
const perMillion = (value) => {
  const n = number(value);
  return n === null ? null : n * 1_000_000;
};
const flag = (value) => (typeof value === "boolean" ? Number(value) : null);
let count = 0;
let releaseCount = 0;
let benchmarkCount = 0;
let arenaCount = 0;
db.exec("BEGIN");
try {
  for (const file of arenaFiles) {
    arenaFileInsert.run(
      file.config,
      "arena",
      file.url,
      file.sha256,
      file.bytes.length,
    );
    const arrayBuffer = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    );
    const rows = await parquetReadObjects({ file: arrayBuffer });
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const scoreKind =
        number(row.rating) !== null
          ? "rating"
          : number(row.score) !== null
            ? "score"
            : null;
      if (
        !scoreKind ||
        typeof row.model_name !== "string" ||
        typeof row.category !== "string" ||
        typeof row.leaderboard_publish_date !== "string"
      )
        continue;
      const lower =
        scoreKind === "rating" ? row.rating_lower : row.score_ci_lower;
      const upper =
        scoreKind === "rating" ? row.rating_upper : row.score_ci_upper;
      const sample =
        scoreKind === "rating" ? row.vote_count : row.session_count;
      arenaRatingInsert.run(
        `${file.config}:${index}`,
        "arena",
        file.config,
        row.category,
        row.model_name,
        typeof row.organization === "string" ? row.organization : null,
        typeof row.license === "string" ? row.license : null,
        row[scoreKind],
        number(lower),
        number(upper),
        scoreKind,
        number(sample),
        scoreKind === "rating" ? "votes" : "sessions",
        number(row.observation_count),
        number(typeof row.rank === "bigint" ? Number(row.rank) : row.rank),
        row.leaderboard_publish_date,
        JSON.stringify(row, (_, value) =>
          typeof value === "bigint" ? Number(value) : value,
        ),
      );
      arenaCount++;
    }
  }
  for (const [id, value] of Object.entries(modelsDevReleases)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const publishableBenchmarks = (value.benchmarks ?? []).filter(
      (benchmark) =>
        safeUrl(benchmark.source) &&
        !artificialAnalysisUrl(benchmark.source) &&
        typeof benchmark.name === "string" &&
        number(benchmark.score) !== null,
    );
    const publishableLinks = (value.links ?? []).filter(
      (item) => safeUrl(item.url) && !artificialAnalysisUrl(item.url),
    );
    const link = Array.isArray(value.links) ? publishableLinks[0] : null;
    releaseInsert.run(
      id,
      "modelsdev_releases",
      value.name || id,
      value.description ?? null,
      value.family ?? null,
      typeof value.type === "string" ? value.type : null,
      id.split("/")[0],
      value.release_date ?? null,
      value.last_updated ?? null,
      flag(value.open_weights),
      value.license ?? null,
      number(value.limit?.context),
      number(value.limit?.output),
      JSON.stringify(value.modalities?.input ?? []),
      JSON.stringify(value.modalities?.output ?? []),
      link?.url ?? null,
      JSON.stringify({
        ...value,
        links: publishableLinks,
        benchmarks: publishableBenchmarks,
      }),
    );
    releaseCount++;
    for (const benchmark of publishableBenchmarks) {
      const benchmarkUrl = safeUrl(benchmark.source);
      const benchmarkKey = sha256(
        JSON.stringify([
          id,
          benchmark.name,
          benchmark.score,
          benchmark.metric ?? null,
          benchmark.variant ?? null,
          benchmarkUrl,
        ]),
      );
      benchmarkCount += benchmarkInsert.run(
        benchmarkKey,
        id,
        benchmark.name,
        benchmark.score,
        benchmark.metric ?? null,
        benchmark.variant ?? null,
        benchmarkUrl,
      ).changes;
    }
  }
  for (const [id, value] of Object.entries(registry)) {
    if (
      id === "sample_spec" ||
      id === "fallback_generalizations" ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      artificialAnalysisUrl(value.source)
    )
      continue;
    const provider =
      typeof value.litellm_provider === "string"
        ? value.litellm_provider
        : "unknown";
    providerInsert.run(provider, provider.replaceAll("_", " "));
    // LiteLLM's legacy max_tokens can mean output limit, so it is not context.
    const context = number(value.max_input_tokens);
    insert.run(
      id,
      provider,
      "litellm",
      null,
      id,
      typeof value.mode === "string" ? value.mode : "unknown",
      null,
      context,
      number(value.max_output_tokens),
      perMillion(value.input_cost_per_token),
      perMillion(value.output_cost_per_token),
      perMillion(value.cache_read_input_token_cost),
      number(value.output_cost_per_image),
      number(value.input_cost_per_second),
      number(value.output_cost_per_second),
      flag(value.supports_vision),
      flag(value.supports_function_calling),
      flag(value.supports_reasoning),
      flag(value.supports_audio_input),
      flag(value.supports_audio_output),
      typeof value.deprecation_date === "string"
        ? value.deprecation_date
        : null,
      safeUrl(value.source),
      JSON.stringify(value),
    );
    count++;
  }
  for (const [providerId, provider] of Object.entries(modelsDevProviders)) {
    if (!provider || typeof provider !== "object") continue;
    providerInsert.run(providerId, provider.name || providerId);
    for (const [modelId, value] of Object.entries(provider.models ?? {})) {
      if (!value || typeof value !== "object") continue;
      const inputModalities = value.modalities?.input ?? [];
      const outputModalities = value.modalities?.output ?? [];
      const mode =
        value.type === "decision"
          ? "decision"
          : outputModalities.includes("video")
            ? "video_generation"
            : outputModalities.includes("image") &&
                !outputModalities.includes("text")
              ? "image_generation"
              : outputModalities.includes("audio") &&
                  !outputModalities.includes("text")
                ? "audio_generation"
                : "chat";
      const modelUrl = Array.isArray(value.links)
        ? value.links.find((item) => safeUrl(item.url))?.url
        : null;
      insert.run(
        `modelsdev:${providerId}/${modelId}`,
        providerId,
        "modelsdev_offers",
        typeof value.canonical_model_id === "string" &&
          modelsDevReleases[value.canonical_model_id]
          ? value.canonical_model_id
          : null,
        value.name || modelId,
        mode,
        typeof value.status === "string" ? value.status : null,
        number(value.limit?.context),
        number(value.limit?.output),
        mode === "chat" || mode === "decision"
          ? number(value.cost?.input)
          : null,
        mode === "chat" ? number(value.cost?.output) : null,
        mode === "chat" || mode === "decision"
          ? number(value.cost?.cache_read)
          : null,
        null,
        null,
        null,
        Array.isArray(inputModalities)
          ? flag(inputModalities.includes("image"))
          : null,
        flag(value.tool_call),
        flag(value.reasoning),
        Array.isArray(inputModalities)
          ? flag(inputModalities.includes("audio"))
          : null,
        Array.isArray(outputModalities)
          ? flag(outputModalities.includes("audio"))
          : null,
        null,
        safeUrl(modelUrl) ?? safeUrl(provider.doc),
        JSON.stringify(value),
      );
      count++;
    }
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  db.close();
  throw error;
}
const integrity = db.prepare("PRAGMA integrity_check").get();
if (
  integrity.integrity_check !== "ok" ||
  count < 1000 ||
  releaseCount < 100 ||
  arenaCount < 1000
)
  throw new Error("Catalog integrity or size check failed");
db.close();
await rename(temp, output);
console.log(
  `Refreshed ${count} offers, ${releaseCount} releases, ${benchmarkCount} source-linked benchmark records, and ${arenaCount} Arena ratings in ${output} (${fetchedAt})`,
);
