import { afterEach, describe, expect, it, vi } from "vitest";

import { cli, scriptedIo, tempDir, cleanup } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
  return cleanup();
});

describe("anvilmark quality", () => {
  it("reports live-source benchmark scores without a project or write", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              rank: 1,
              modelId: "example/model-one",
              value: 81.2,
              verified: false,
              lower_is_better: false,
            },
            {
              rank: 2,
              modelId: "example/model-two",
              value: 77,
              verified: true,
              lower_is_better: false,
            },
          ]),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const root = await tempDir();
    const io = scriptedIo({ cwd: root });
    expect(await cli(["quality", "leaderboard", "cais/hle"], io)).toBe(0);
    expect(io.out()).toContain("example/model-one");
    expect(io.out()).toContain("unverified");
    expect(io.out()).toContain("not a test of your project's workload");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://huggingface.co/api/datasets/cais/hle/leaderboard",
    );
  });

  it("filters exact output while retaining snapshot metadata in JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { rank: 1, modelId: "a/one", value: 8 },
              { rank: 2, modelId: "b/two", value: 7 },
            ]),
          ),
      ),
    );
    const io = scriptedIo({ cwd: await tempDir() });
    expect(
      await cli(
        ["quality", "leaderboard", "cais/hle", "--search", "TWO", "--json"],
        io,
      ),
    ).toBe(0);
    const parsed = JSON.parse(io.out()) as {
      benchmark_id: string;
      results: { model_id: string }[];
      response_sha256: string;
    };
    expect(parsed.benchmark_id).toBe("cais/hle");
    expect(parsed.results.map((entry) => entry.model_id)).toEqual(["b/two"]);
    expect(parsed.response_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("shows a model's cross-benchmark results as separate dated entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "example/model",
              evalResults: [
                {
                  verified: false,
                  data: {
                    dataset: { id: "publisher/benchmark" },
                    value: 42,
                    date: "2026-10-01",
                  },
                },
              ],
            }),
          ),
      ),
    );
    const io = scriptedIo({ cwd: await tempDir() });
    expect(await cli(["quality", "model", "example/model"], io)).toBe(0);
    expect(io.out()).toContain("publisher/benchmark");
    expect(io.out()).toContain("2026-10-01");
    expect(io.out()).toContain("must not be averaged");
  });

  it("fetches the optional Artificial Analysis catalog with attribution", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tier: "free",
            intelligence_index_version: 4.3,
            pagination: {
              page: 1,
              page_size: 200,
              total_pages: 1,
              has_more: false,
            },
            data: [
              {
                id: "model-id",
                slug: "sample-model",
                name: "Sample Model",
                model_creator: { id: "creator-id", name: "Sample Labs" },
                evaluations: {
                  artificial_analysis_intelligence_index: 42.5,
                },
                pricing: { price_1m_input_tokens: 0.5 },
                performance: { median_output_tokens_per_second: 100 },
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const io = scriptedIo({
      cwd: await tempDir(),
      env: { ARTIFICIAL_ANALYSIS_API_KEY: "test-key" },
    });
    expect(await cli(["quality", "catalog", "--search", "Sample"], io)).toBe(0);
    expect(io.out()).toContain("Sample Model");
    expect(io.out()).toContain("Artificial Analysis");
    expect(io.out()).toContain("internal use with attribution");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://artificialanalysis.ai/api/v2/language/models/free?page=1",
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: "application/json",
      "x-api-key": "test-key",
    });
  });
});
