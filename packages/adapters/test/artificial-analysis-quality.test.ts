import { describe, expect, it } from "vitest";

import { fetchArtificialAnalysisCatalog } from "../src/quality/artificial-analysis.js";

const model = {
  id: "36f73aaf-d38a-4b56-a2b3-d04d17186910",
  name: "gpt-oss-20B (high)",
  slug: "gpt-oss-20b",
  release_date: "2025-08-05",
  model_creator: { id: "creator-1", name: "OpenAI" },
  evaluations: {
    artificial_analysis_intelligence_index: 24.5,
    artificial_analysis_coding_index: 18.5,
    artificial_analysis_agentic_index: null,
    artificial_analysis_engineering_index: 11.7,
  },
  pricing: { price_1m_input_tokens: 0.06, price_1m_output_tokens: 0.2 },
  performance: {
    median_output_tokens_per_second: 296.47,
    median_time_to_first_token_seconds: 0.65,
    median_time_to_first_answer_token_seconds: 7.4,
    median_end_to_end_response_time_seconds: 9.09,
  },
};

function page(number: number, hasMore: boolean, data: unknown[] = [model]) {
  return {
    tier: "free",
    intelligence_index_version: 4.1,
    pagination: {
      page: number,
      page_size: 200,
      total_pages: hasMore ? 2 : number,
      has_more: hasMore,
    },
    data,
  };
}

describe("Artificial Analysis Free catalog connector", () => {
  it("uses the fixed paginated endpoint, authenticates server-side, and preserves provenance", async () => {
    const requests: string[] = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      requests.push(String(url));
      expect(init?.headers).toEqual({
        Accept: "application/json",
        "x-api-key": "test-secret",
      });
      expect(init?.redirect).toBe("error");
      const isFirst = requests.length === 1;
      return new Response(
        JSON.stringify(
          page(isFirst ? 1 : 2, isFirst, [
            { ...model, slug: isFirst ? "gpt-oss-20b" : "gpt-oss-120b" },
          ]),
        ),
        { headers: { "x-ratelimit-remaining": isFirst ? "99" : "98" } },
      );
    };
    const catalog = await fetchArtificialAnalysisCatalog("test-secret", {
      fetcher: fetcher as typeof fetch,
      now: () => "2026-10-14T00:00:00Z",
    });
    expect(requests).toEqual([
      "https://artificialanalysis.ai/api/v2/language/models/free?page=1",
      "https://artificialanalysis.ai/api/v2/language/models/free?page=2",
    ]);
    expect(catalog.models).toHaveLength(2);
    expect(
      catalog.models[0]?.indices.artificial_analysis_intelligence_index,
    ).toBe(24.5);
    expect(
      catalog.models[0]?.indices.artificial_analysis_agentic_index,
    ).toBeNull();
    expect(
      catalog.models[0]?.indices.artificial_analysis_legal_index,
    ).toBeNull();
    expect(catalog.models[0]?.median_output_tokens_per_second).toBe(296.47);
    expect(catalog.fetched_at).toBe("2026-10-14T00:00:00Z");
    expect(catalog.response_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(catalog.rate_limit_remaining).toBe(98);
    expect(catalog.usage_rights).toBe("internal-use-with-attribution");
    expect(catalog.attribution).toBe("Artificial Analysis");
  });

  it("rejects missing credentials, nonnumeric scores, and changing index versions", async () => {
    await expect(fetchArtificialAnalysisCatalog(" ")).rejects.toThrow(
      "required",
    );
    await expect(
      fetchArtificialAnalysisCatalog("key", {
        fetcher: (async () =>
          new Response(
            JSON.stringify(
              page(1, false, [
                {
                  ...model,
                  evaluations: {
                    artificial_analysis_intelligence_index: "24.5",
                  },
                },
              ]),
            ),
          )) as typeof fetch,
      }),
    ).rejects.toThrow("documented Free catalog shape");
    let count = 0;
    await expect(
      fetchArtificialAnalysisCatalog("key", {
        fetcher: (async () => {
          count += 1;
          return new Response(
            JSON.stringify({
              ...page(count, count === 1, [
                { ...model, slug: `model-${count}` },
              ]),
              intelligence_index_version: count === 1 ? 4.1 : 4.2,
            }),
          );
        }) as typeof fetch,
      }),
    ).rejects.toThrow("index version changed");
  });

  it("reports HTTP and size errors without echoing the credential", async () => {
    await expect(
      fetchArtificialAnalysisCatalog("secret-never-echo", {
        fetcher: (async () =>
          new Response("quota", {
            status: 429,
            headers: { "retry-after": "60" },
          })) as typeof fetch,
      }),
    ).rejects.toThrow("HTTP 429; retry after 60 seconds");
    await expect(
      fetchArtificialAnalysisCatalog("secret-never-echo", {
        fetcher: (async () =>
          new Response("x".repeat(8 * 1024 * 1024 + 1))) as typeof fetch,
      }),
    ).rejects.toThrow("exceeded 8 MiB");
  });
});
