import { describe, expect, it } from "vitest";

import {
  fetchHuggingFaceBenchmarks,
  fetchHuggingFaceLeaderboard,
  fetchHuggingFaceModelEvals,
  huggingFaceLeaderboardUrl,
} from "../src/quality/huggingface.js";

const row = {
  rank: 1,
  modelId: "example/model-revision",
  value: 72.5,
  verified: false,
  lower_is_better: false,
  source: {
    url: "https://huggingface.co/example/model-revision",
    name: "Model card",
    isExternal: false,
  },
  filename: ".eval_results/example.yaml",
};

describe("Hugging Face public benchmark connector", () => {
  it("fetches scores with source identity and preserves an unverified submission", async () => {
    const fetcher = async (url: string | URL | Request) => {
      expect(String(url)).toBe(
        "https://huggingface.co/api/datasets/SWE-bench/SWE-bench_Verified/leaderboard",
      );
      return new Response(JSON.stringify([row]), {
        headers: { etag: 'W/"example"' },
      });
    };
    const snapshot = await fetchHuggingFaceLeaderboard(
      "SWE-bench/SWE-bench_Verified",
      { fetcher: fetcher as typeof fetch, now: () => "2026-10-14T00:00:00Z" },
    );
    expect(snapshot.results).toEqual([
      {
        rank: 1,
        model_id: "example/model-revision",
        score: 72.5,
        verified: false,
        lower_is_better: false,
        source_url: "https://huggingface.co/example/model-revision",
        source_name: "Model card",
        result_file: ".eval_results/example.yaml",
        notes: null,
      },
    ]);
    expect(snapshot.response_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.etag).toBe('W/"example"');
    expect(snapshot.fetched_at).toBe("2026-10-14T00:00:00Z");
  });

  it("keeps requests on the fixed API host and rejects invalid response shapes", async () => {
    expect(() => huggingFaceLeaderboardUrl("../private")).toThrow();
    expect(() =>
      huggingFaceLeaderboardUrl("https://other.example/data"),
    ).toThrow();
    await expect(
      fetchHuggingFaceLeaderboard("cais/hle", {
        fetcher: (async () =>
          new Response(
            JSON.stringify([{ ...row, value: "72.5" }]),
          )) as typeof fetch,
      }),
    ).rejects.toThrow("expected score format");
  });

  it("rejects failed HTTP responses and oversized bodies", async () => {
    await expect(
      fetchHuggingFaceLeaderboard("cais/hle", {
        fetcher: (async () =>
          new Response("missing", { status: 404 })) as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 404");
    await expect(
      fetchHuggingFaceLeaderboard("cais/hle", {
        fetcher: (async () =>
          new Response("x".repeat(8 * 1024 * 1024 + 1))) as typeof fetch,
      }),
    ).rejects.toThrow("exceeded 8 MiB");
  });

  it("discovers official benchmark IDs without treating their scores as one scale", async () => {
    const catalog = await fetchHuggingFaceBenchmarks({
      fetcher: (async () =>
        new Response(
          JSON.stringify([
            {
              id: "SWE-bench/SWE-bench_Verified",
              lastModified: "2026-08-16T04:23:43.000Z",
            },
            { id: "TIGER-Lab/MMLU-Pro" },
          ]),
        )) as typeof fetch,
      now: () => "2026-10-14T00:00:00Z",
    });
    expect(catalog.benchmarks.map((entry) => entry.id)).toEqual([
      "SWE-bench/SWE-bench_Verified",
      "TIGER-Lab/MMLU-Pro",
    ]);
    expect(catalog.source).toBe("huggingface-official-benchmarks");
    expect(catalog.response_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fetches one model's dated evaluations without aggregating unlike benchmarks", async () => {
    const result = await fetchHuggingFaceModelEvals("openai/gpt-oss-20b", {
      fetcher: (async () =>
        new Response(
          JSON.stringify({
            id: "openai/gpt-oss-20b",
            evalResults: [
              {
                filename: ".eval_results/sample.yaml",
                verified: false,
                data: {
                  dataset: {
                    id: "LiquidAI/ifstruct-v1.0",
                    task_id: "ifstruct_v1",
                  },
                  value: 91.95,
                  date: "2026-06-30",
                  source: { url: "https://www.liquid.ai/blog/ifstruct-v1.0" },
                },
              },
            ],
          }),
        )) as typeof fetch,
    });
    expect(result.results).toEqual([
      {
        benchmark_id: "LiquidAI/ifstruct-v1.0",
        task_id: "ifstruct_v1",
        score: 91.95,
        evaluation_date: "2026-06-30",
        verified: false,
        source_url: "https://www.liquid.ai/blog/ifstruct-v1.0",
        source_name: null,
        result_file: ".eval_results/sample.yaml",
      },
    ]);
  });
});
