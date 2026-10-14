import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import type {
  ArtificialAnalysisCatalog,
  PublicBenchmarkCatalog,
  PublicBenchmarkSnapshot,
  PublicModelEvals,
} from "@anvilmark/adapters";

import {
  huggingFaceLeaderboardSourceKey,
  huggingFaceModelEvalsSourceKey,
  openModelCatalog,
  SOURCE_KEYS,
  sourceKeyFor,
} from "../src/index.js";

const HASH = "a".repeat(64);

function leaderboard(
  fetchedAt = "2026-10-14T00:00:00.000Z",
  score = 42,
): PublicBenchmarkSnapshot {
  return {
    format: "anvilmark-public-benchmark/1",
    source: "huggingface-benchmark-leaderboard",
    benchmark_id: "cais/hle",
    source_url: "https://huggingface.co/api/datasets/cais/hle/leaderboard",
    fetched_at: fetchedAt,
    response_sha256: HASH,
    etag: "etag-1",
    results: [
      {
        rank: 1,
        model_id: "publisher/model-a",
        score,
        verified: false,
        lower_is_better: false,
        source_url: "https://example.com/result",
        source_name: "submission",
        result_file: "eval.yaml",
        notes: null,
      },
    ],
  };
}

describe("local model catalog", () => {
  it("keeps every source snapshot and computes freshness at read time", async () => {
    const catalog = await openModelCatalog(":memory:");
    try {
      expect(
        catalog.getLatest(huggingFaceLeaderboardSourceKey("cais/hle")),
      ).toBeNull();
      const first = catalog.storeSnapshot(leaderboard());
      const second = catalog.storeSnapshot(
        leaderboard("2026-10-15T00:00:00.000Z", 43),
      );
      const key = huggingFaceLeaderboardSourceKey("cais/hle");
      const history = catalog.getHistory(key, {
        now: new Date("2026-10-15T03:00:00.000Z"),
        maxAgeMs: 12 * 60 * 60 * 1000,
      });
      expect(history.map((entry) => entry.id)).toEqual([second.id, first.id]);
      expect(history.map((entry) => entry.freshness)).toEqual([
        "fresh",
        "stale",
      ]);
      expect(history[0]?.snapshot).toEqual(
        leaderboard("2026-10-15T00:00:00.000Z", 43),
      );
      expect(
        catalog.getLatest(key, { now: new Date("2026-10-17") })?.freshness,
      ).toBe("stale");
      expect(catalog.getHistory(key, { limit: 1 })).toHaveLength(1);
      const importedLater = catalog.storeSnapshot(
        leaderboard("2026-10-13T00:00:00.000Z", 40),
      );
      expect(importedLater.id).toBeGreaterThan(second.id);
      expect(catalog.getLatest(key)?.id).toBe(second.id);
      expect(catalog.getHistory(key).map((entry) => entry.id)).toEqual([
        second.id,
        first.id,
        importedLater.id,
      ]);
      expect(
        catalog.getLatest(key, { now: new Date("2026-10-14T00:00:00.000Z") })
          ?.freshness,
      ).toBe("stale");
    } finally {
      catalog.close();
    }
  });

  it("preserves source-scoped identity, verification, source URL, and empty polls", async () => {
    const catalog = await openModelCatalog(":memory:");
    try {
      const board = catalog.storeSnapshot(leaderboard());
      expect(catalog.getObservations(board.id)).toEqual([
        {
          snapshot_id: board.id,
          position: 0,
          kind: "benchmark_score",
          model_id: "publisher/model-a",
          benchmark_id: "cais/hle",
          score: 42,
          verified: false,
          result_source_url: "https://example.com/result",
          details: {
            rank: 1,
            lower_is_better: false,
            source_name: "submission",
            result_file: "eval.yaml",
            notes: null,
          },
        },
      ]);
      const empty: PublicModelEvals = {
        format: "anvilmark-public-model-evals/1",
        source: "huggingface-model-eval-results",
        model_id: "publisher/model-a",
        source_url:
          "https://huggingface.co/api/models/publisher/model-a?expand=evalResults",
        fetched_at: "2026-10-14T00:00:00.000Z",
        response_sha256: HASH,
        results: [],
      };
      const stored = catalog.storeSnapshot(empty);
      expect(stored.observation_count).toBe(0);
      expect(catalog.getObservations(stored.id)).toEqual([]);
      expect(sourceKeyFor(empty)).toBe(
        huggingFaceModelEvalsSourceKey("publisher/model-a"),
      );
      expect(
        catalog.getLatest(huggingFaceLeaderboardSourceKey("cais/hle"))?.id,
      ).toBe(board.id);
      expect(
        catalog.getLatest(SOURCE_KEYS.huggingFaceOfficialBenchmarks),
      ).toBeNull();
    } finally {
      catalog.close();
    }
  });

  it("stores benchmark discovery and AA profiles with usage rights and attribution", async () => {
    const catalog = await openModelCatalog(":memory:");
    try {
      const benchmarks: PublicBenchmarkCatalog = {
        format: "anvilmark-benchmark-catalog/1",
        source: "huggingface-official-benchmarks",
        source_url:
          "https://huggingface.co/api/datasets?filter=benchmark:official",
        fetched_at: "2026-10-14T00:00:00.000Z",
        response_sha256: HASH,
        benchmarks: [{ id: "cais/hle", last_modified: null }],
      };
      const savedBenchmarks = catalog.storeSnapshot(benchmarks);
      expect(catalog.getObservations(savedBenchmarks.id)[0]?.benchmark_id).toBe(
        "cais/hle",
      );
      const aa: ArtificialAnalysisCatalog = {
        format: "anvilmark-model-catalog/1",
        source: "artificial-analysis-language-models-free",
        source_url: "https://artificialanalysis.ai/api/v2/language/models/free",
        attribution: "Artificial Analysis",
        attribution_url: "https://artificialanalysis.ai/",
        usage_rights: "internal-use-with-attribution",
        fetched_at: "2026-10-14T00:00:00.000Z",
        response_sha256: HASH,
        intelligence_index_version: 3,
        tier: "free",
        pages_fetched: 1,
        rate_limit_remaining: 10,
        models: [
          {
            id: "aa-id-1",
            name: "Model A",
            slug: "model-a",
            creator_id: "creator-1",
            creator_name: "Creator",
            release_date: null,
            indices: { artificial_analysis_intelligence_index: 50 },
            price_1m_input_tokens: null,
            price_1m_output_tokens: null,
            median_output_tokens_per_second: null,
            median_time_to_first_token_seconds: null,
            median_time_to_first_answer_token_seconds: null,
            median_end_to_end_response_time_seconds: null,
          },
        ],
      };
      const inputWithUnexpectedSecret = Object.assign({}, aa, {
        apiKey: "must-not-be-stored",
      });
      const savedAA = catalog.storeSnapshot(inputWithUnexpectedSecret);
      expect(savedAA.usage_rights).toBe("internal-use-with-attribution");
      expect(savedAA.attribution).toBe("Artificial Analysis");
      expect(savedAA.snapshot).toEqual(aa);
      expect(JSON.stringify(savedAA.snapshot)).not.toContain(
        "must-not-be-stored",
      );
      expect(catalog.getObservations(savedAA.id)[0]).toMatchObject({
        kind: "model_profile",
        model_id: "aa-id-1",
        verified: null,
        details: { slug: "model-a" },
      });
      expect(catalog.getLatest(SOURCE_KEYS.artificialAnalysis)?.id).toBe(
        savedAA.id,
      );
    } finally {
      catalog.close();
    }
  });

  it("persists across opens and rejects an unknown future schema version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anvilmark-catalog-"));
    const path = join(directory, "catalog.sqlite");
    try {
      const catalog = await openModelCatalog(path);
      const stored = catalog.storeSnapshot(leaderboard());
      catalog.close();

      const reopened = await openModelCatalog(path);
      expect(
        reopened.getLatest(huggingFaceLeaderboardSourceKey("cais/hle"))?.id,
      ).toBe(stored.id);
      reopened.close();

      const sqlite = new DatabaseSync(path);
      sqlite.exec("PRAGMA user_version = 99");
      sqlite.close();
      await expect(openModelCatalog(path)).rejects.toThrow(
        "unsupported model catalog schema version 99",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
