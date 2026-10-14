import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  huggingFaceLeaderboardUrl,
  huggingFaceModelEvalsUrl,
} from "@anvilmark/adapters";
import type {
  ArtificialAnalysisCatalog,
  PublicBenchmarkCatalog,
  PublicBenchmarkSnapshot,
  PublicModelEvals,
} from "@anvilmark/adapters";

export type CatalogSnapshot =
  | PublicBenchmarkCatalog
  | PublicBenchmarkSnapshot
  | PublicModelEvals
  | ArtificialAnalysisCatalog;

export type ObservationKind =
  "benchmark" | "benchmark_score" | "model_evaluation" | "model_profile";

export interface CatalogObservation {
  readonly snapshot_id: number;
  readonly position: number;
  readonly kind: ObservationKind;
  /** Source-scoped identity. No cross-source name or alias matching is inferred. */
  readonly model_id: string | null;
  readonly benchmark_id: string | null;
  readonly score: number | null;
  readonly verified: boolean | null;
  readonly result_source_url: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface StoredSnapshot {
  readonly id: number;
  readonly source_key: string;
  readonly source: CatalogSnapshot["source"];
  readonly source_url: string;
  readonly fetched_at: string;
  readonly response_sha256: string;
  readonly usage_rights: string | null;
  readonly attribution: string | null;
  readonly attribution_url: string | null;
  readonly observation_count: number;
  readonly freshness: "fresh" | "stale";
  readonly age_ms: number;
  /** The exact normalized adapter result supplied at ingestion time. */
  readonly snapshot: CatalogSnapshot;
}

export interface ReadOptions {
  /** Defaults to the current clock. */
  readonly now?: Date;
  /** Defaults to 24 hours. A result older than this is stale. */
  readonly maxAgeMs?: number;
}

export interface HistoryOptions extends ReadOptions {
  /** Defaults to 20, at most 1000. */
  readonly limit?: number;
}

export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SCHEMA_VERSION = 1;
const AA_INDEX_KEYS = new Set([
  "artificial_analysis_intelligence_index",
  "artificial_analysis_coding_index",
  "artificial_analysis_agentic_index",
  "artificial_analysis_finance_and_accounting_index",
  "artificial_analysis_strategy_and_ops_index",
  "artificial_analysis_legal_index",
  "artificial_analysis_healthcare_and_medical_index",
  "artificial_analysis_engineering_index",
  "artificial_analysis_economics_index",
]);

export const SOURCE_KEYS = {
  huggingFaceOfficialBenchmarks: "huggingface-official-benchmarks",
  artificialAnalysis: "artificial-analysis-language-models-free",
} as const;

export function huggingFaceLeaderboardSourceKey(benchmarkId: string): string {
  if (benchmarkId.trim() === "") throw new Error("benchmark ID is required");
  return `huggingface-benchmark-leaderboard:${benchmarkId}`;
}

export function huggingFaceModelEvalsSourceKey(modelId: string): string {
  if (modelId.trim() === "") throw new Error("model ID is required");
  return `huggingface-model-eval-results:${modelId}`;
}

export function sourceKeyFor(snapshot: CatalogSnapshot): string {
  switch (snapshot.source) {
    case "huggingface-official-benchmarks":
      return SOURCE_KEYS.huggingFaceOfficialBenchmarks;
    case "huggingface-benchmark-leaderboard":
      return huggingFaceLeaderboardSourceKey(snapshot.benchmark_id);
    case "huggingface-model-eval-results":
      return huggingFaceModelEvalsSourceKey(snapshot.model_id);
    case "artificial-analysis-language-models-free":
      return SOURCE_KEYS.artificialAnalysis;
  }
}

type ObservationInput = Omit<CatalogObservation, "snapshot_id" | "position">;

function observationsFor(snapshot: CatalogSnapshot): ObservationInput[] {
  switch (snapshot.source) {
    case "huggingface-official-benchmarks":
      return snapshot.benchmarks.map((row) => ({
        kind: "benchmark",
        model_id: null,
        benchmark_id: row.id,
        score: null,
        verified: null,
        result_source_url: null,
        details: { last_modified: row.last_modified },
      }));
    case "huggingface-benchmark-leaderboard":
      return snapshot.results.map((row) => ({
        kind: "benchmark_score",
        model_id: row.model_id,
        benchmark_id: snapshot.benchmark_id,
        score: row.score,
        verified: row.verified,
        result_source_url: row.source_url,
        details: {
          rank: row.rank,
          lower_is_better: row.lower_is_better,
          source_name: row.source_name,
          result_file: row.result_file,
          notes: row.notes,
        },
      }));
    case "huggingface-model-eval-results":
      return snapshot.results.map((row) => ({
        kind: "model_evaluation",
        model_id: snapshot.model_id,
        benchmark_id: row.benchmark_id,
        score: row.score,
        verified: row.verified,
        result_source_url: row.source_url,
        details: {
          task_id: row.task_id,
          evaluation_date: row.evaluation_date,
          source_name: row.source_name,
          result_file: row.result_file,
        },
      }));
    case "artificial-analysis-language-models-free":
      return snapshot.models.map((row) => ({
        kind: "model_profile",
        model_id: row.id,
        benchmark_id: null,
        score: null,
        verified: null,
        result_source_url: null,
        details: { ...row },
      }));
  }
}

/** Copy only adapter-defined fields, so unexpected input fields cannot enter the database. */
function knownSnapshotFields(snapshot: CatalogSnapshot): CatalogSnapshot {
  switch (snapshot.source) {
    case "huggingface-official-benchmarks":
      return {
        format: snapshot.format,
        source: snapshot.source,
        source_url: snapshot.source_url,
        fetched_at: snapshot.fetched_at,
        response_sha256: snapshot.response_sha256,
        benchmarks: snapshot.benchmarks.map((row) => ({
          id: row.id,
          last_modified: row.last_modified,
        })),
      };
    case "huggingface-benchmark-leaderboard":
      return {
        format: snapshot.format,
        source: snapshot.source,
        benchmark_id: snapshot.benchmark_id,
        source_url: snapshot.source_url,
        fetched_at: snapshot.fetched_at,
        response_sha256: snapshot.response_sha256,
        etag: snapshot.etag,
        results: snapshot.results.map((row) => ({
          rank: row.rank,
          model_id: row.model_id,
          score: row.score,
          verified: row.verified,
          lower_is_better: row.lower_is_better,
          source_url: row.source_url,
          source_name: row.source_name,
          result_file: row.result_file,
          notes: row.notes,
        })),
      };
    case "huggingface-model-eval-results":
      return {
        format: snapshot.format,
        source: snapshot.source,
        model_id: snapshot.model_id,
        source_url: snapshot.source_url,
        fetched_at: snapshot.fetched_at,
        response_sha256: snapshot.response_sha256,
        results: snapshot.results.map((row) => ({
          benchmark_id: row.benchmark_id,
          task_id: row.task_id,
          score: row.score,
          evaluation_date: row.evaluation_date,
          verified: row.verified,
          source_url: row.source_url,
          source_name: row.source_name,
          result_file: row.result_file,
        })),
      };
    case "artificial-analysis-language-models-free":
      return {
        format: snapshot.format,
        source: snapshot.source,
        source_url: snapshot.source_url,
        attribution: snapshot.attribution,
        attribution_url: snapshot.attribution_url,
        usage_rights: snapshot.usage_rights,
        fetched_at: snapshot.fetched_at,
        response_sha256: snapshot.response_sha256,
        intelligence_index_version: snapshot.intelligence_index_version,
        tier: snapshot.tier,
        pages_fetched: snapshot.pages_fetched,
        rate_limit_remaining: snapshot.rate_limit_remaining,
        models: snapshot.models.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          creator_id: row.creator_id,
          creator_name: row.creator_name,
          release_date: row.release_date,
          indices: Object.fromEntries(
            Object.entries(row.indices).filter(([key]) =>
              AA_INDEX_KEYS.has(key),
            ),
          ),
          price_1m_input_tokens: row.price_1m_input_tokens,
          price_1m_output_tokens: row.price_1m_output_tokens,
          median_output_tokens_per_second: row.median_output_tokens_per_second,
          median_time_to_first_token_seconds:
            row.median_time_to_first_token_seconds,
          median_time_to_first_answer_token_seconds:
            row.median_time_to_first_answer_token_seconds,
          median_end_to_end_response_time_seconds:
            row.median_end_to_end_response_time_seconds,
        })),
      };
  }
}

function checkedReadOptions(options: ReadOptions): {
  nowMs: number;
  maxAgeMs: number;
} {
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid date");
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new Error("maxAgeMs must be a nonnegative finite number");
  }
  return { nowMs, maxAgeMs };
}

function validateSnapshot(snapshot: CatalogSnapshot): void {
  const fetchedAtMs = Date.parse(snapshot.fetched_at);
  if (
    !Number.isFinite(fetchedAtMs) ||
    new Date(fetchedAtMs).toISOString() !== snapshot.fetched_at
  ) {
    throw new Error("snapshot fetched_at must be a canonical UTC ISO date");
  }
  const sourceUrl = new URL(snapshot.source_url);
  if (
    sourceUrl.protocol !== "https:" ||
    sourceUrl.username ||
    sourceUrl.password
  ) {
    throw new Error("snapshot source_url must be HTTPS without credentials");
  }
  if (
    snapshot.source === "artificial-analysis-language-models-free" &&
    snapshot.source_url !==
      "https://artificialanalysis.ai/api/v2/language/models/free"
  ) {
    throw new Error("Artificial Analysis source URL must match the Free API");
  }
  if (snapshot.source === "huggingface-official-benchmarks") {
    if (
      snapshot.source_url !==
      "https://huggingface.co/api/datasets?filter=benchmark:official"
    ) {
      throw new Error("Hugging Face benchmark catalog URL did not match");
    }
  } else if (snapshot.source === "huggingface-benchmark-leaderboard") {
    if (
      snapshot.source_url !== huggingFaceLeaderboardUrl(snapshot.benchmark_id)
    ) {
      throw new Error("Hugging Face leaderboard URL did not match its ID");
    }
  } else if (snapshot.source === "huggingface-model-eval-results") {
    if (snapshot.source_url !== huggingFaceModelEvalsUrl(snapshot.model_id)) {
      throw new Error("Hugging Face model URL did not match its ID");
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(snapshot.response_sha256)) {
    throw new Error("snapshot response_sha256 must be a SHA-256 hex digest");
  }
  if (
    snapshot.source === "artificial-analysis-language-models-free" &&
    snapshot.usage_rights !== "internal-use-with-attribution"
  ) {
    throw new Error("Artificial Analysis usage rights must be preserved");
  }
}

type Database = DatabaseSync;
type DbRow = Record<string, string | number | bigint | Uint8Array | null>;

function requiredString(row: DbRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`invalid catalog ${key}`);
  return value;
}

function requiredNumber(row: DbRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`invalid catalog ${key}`);
  return value;
}

function optionalString(row: DbRow, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`invalid catalog ${key}`);
  return value;
}

export class ModelCatalog {
  private constructor(private readonly db: Database) {}

  static async open(path: string): Promise<ModelCatalog> {
    if (path.trim() === "")
      throw new Error("catalog database path is required");
    const major = Number(process.versions.node.split(".")[0]);
    if (major < 24) {
      throw new Error(
        "local model catalog storage requires Node.js 24 or newer",
      );
    }
    const { DatabaseSync } = await import("node:sqlite");
    if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
    const db = new DatabaseSync(path);
    try {
      const catalog = new ModelCatalog(db);
      catalog.initialize();
      return catalog;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private initialize(): void {
    const version = requiredNumber(
      this.db.prepare("PRAGMA user_version").get() as DbRow,
      "user_version",
    );
    if (version !== 0 && version !== SCHEMA_VERSION) {
      throw new Error(`unsupported model catalog schema version ${version}`);
    }
    if (version === SCHEMA_VERSION) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS source_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_key TEXT NOT NULL,
          source TEXT NOT NULL,
          source_url TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          response_sha256 TEXT NOT NULL,
          usage_rights TEXT,
          attribution TEXT,
          attribution_url TEXT,
          observation_count INTEGER NOT NULL,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS source_snapshots_by_key
          ON source_snapshots(source_key, id DESC);
        CREATE TABLE IF NOT EXISTS observations (
          snapshot_id INTEGER NOT NULL REFERENCES source_snapshots(id),
          position INTEGER NOT NULL,
          kind TEXT NOT NULL,
          model_id TEXT,
          benchmark_id TEXT,
          score REAL,
          verified INTEGER,
          result_source_url TEXT,
          details_json TEXT NOT NULL,
          PRIMARY KEY(snapshot_id, position)
        );
        CREATE INDEX IF NOT EXISTS observations_by_model
          ON observations(model_id, snapshot_id);
        CREATE INDEX IF NOT EXISTS observations_by_benchmark
          ON observations(benchmark_id, snapshot_id);
        PRAGMA user_version = 1;
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  storeSnapshot(snapshot: CatalogSnapshot): StoredSnapshot {
    validateSnapshot(snapshot);
    const storedPayload = knownSnapshotFields(snapshot);
    const sourceKey = sourceKeyFor(storedPayload);
    const observations = observationsFor(storedPayload);
    const usageRights =
      storedPayload.source === "artificial-analysis-language-models-free"
        ? storedPayload.usage_rights
        : null;
    const attribution =
      storedPayload.source === "artificial-analysis-language-models-free"
        ? storedPayload.attribution
        : null;
    const attributionUrl =
      storedPayload.source === "artificial-analysis-language-models-free"
        ? storedPayload.attribution_url
        : null;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = this.db
        .prepare(
          `INSERT INTO source_snapshots
           (source_key, source, source_url, fetched_at, response_sha256,
            usage_rights, attribution, attribution_url, observation_count, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sourceKey,
          storedPayload.source,
          storedPayload.source_url,
          storedPayload.fetched_at,
          storedPayload.response_sha256,
          usageRights,
          attribution,
          attributionUrl,
          observations.length,
          JSON.stringify(storedPayload),
        );
      const id = Number(inserted.lastInsertRowid);
      const insertObservation = this.db.prepare(
        `INSERT INTO observations
         (snapshot_id, position, kind, model_id, benchmark_id, score,
          verified, result_source_url, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [position, observation] of observations.entries()) {
        insertObservation.run(
          id,
          position,
          observation.kind,
          observation.model_id,
          observation.benchmark_id,
          observation.score,
          observation.verified === null ? null : Number(observation.verified),
          observation.result_source_url,
          JSON.stringify(observation.details),
        );
      }
      this.db.exec("COMMIT");
      return this.getById(id) as StoredSnapshot;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private toStored(row: DbRow, options: ReadOptions): StoredSnapshot {
    const { nowMs, maxAgeMs } = checkedReadOptions(options);
    const fetchedAt = requiredString(row, "fetched_at");
    const signedAgeMs = nowMs - Date.parse(fetchedAt);
    const ageMs = Math.max(0, signedAgeMs);
    return {
      id: requiredNumber(row, "id"),
      source_key: requiredString(row, "source_key"),
      source: requiredString(row, "source") as CatalogSnapshot["source"],
      source_url: requiredString(row, "source_url"),
      fetched_at: fetchedAt,
      response_sha256: requiredString(row, "response_sha256"),
      usage_rights: optionalString(row, "usage_rights"),
      attribution: optionalString(row, "attribution"),
      attribution_url: optionalString(row, "attribution_url"),
      observation_count: requiredNumber(row, "observation_count"),
      freshness: signedAgeMs < 0 || signedAgeMs > maxAgeMs ? "stale" : "fresh",
      age_ms: ageMs,
      snapshot: JSON.parse(
        requiredString(row, "payload_json"),
      ) as CatalogSnapshot,
    };
  }

  getById(id: number, options: ReadOptions = {}): StoredSnapshot | null {
    const row = this.db
      .prepare("SELECT * FROM source_snapshots WHERE id = ?")
      .get(id) as DbRow | undefined;
    return row === undefined ? null : this.toStored(row, options);
  }

  getLatest(
    sourceKey: string,
    options: ReadOptions = {},
  ): StoredSnapshot | null {
    const row = this.db
      .prepare(
        "SELECT * FROM source_snapshots WHERE source_key = ? ORDER BY fetched_at DESC, id DESC LIMIT 1",
      )
      .get(sourceKey) as DbRow | undefined;
    return row === undefined ? null : this.toStored(row, options);
  }

  getHistory(
    sourceKey: string,
    options: HistoryOptions = {},
  ): readonly StoredSnapshot[] {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error("history limit must be an integer from 1 to 1000");
    }
    const rows = this.db
      .prepare(
        "SELECT * FROM source_snapshots WHERE source_key = ? ORDER BY fetched_at DESC, id DESC LIMIT ?",
      )
      .all(sourceKey, limit) as DbRow[];
    return rows.map((row) => this.toStored(row, options));
  }

  getObservations(snapshotId: number): readonly CatalogObservation[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM observations WHERE snapshot_id = ? ORDER BY position",
      )
      .all(snapshotId) as DbRow[];
    return rows.map((row) => {
      const verified = row.verified;
      return {
        snapshot_id: requiredNumber(row, "snapshot_id"),
        position: requiredNumber(row, "position"),
        kind: requiredString(row, "kind") as ObservationKind,
        model_id: optionalString(row, "model_id"),
        benchmark_id: optionalString(row, "benchmark_id"),
        score: row.score === null ? null : requiredNumber(row, "score"),
        verified:
          verified === null ? null : requiredNumber(row, "verified") === 1,
        result_source_url: optionalString(row, "result_source_url"),
        details: JSON.parse(requiredString(row, "details_json")) as Record<
          string,
          unknown
        >,
      };
    });
  }
}

export async function openModelCatalog(path: string): Promise<ModelCatalog> {
  return ModelCatalog.open(path);
}
