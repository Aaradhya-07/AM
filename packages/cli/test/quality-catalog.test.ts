import { expect, it } from "vitest";

import type { ArtificialAnalysisCatalog } from "@anvilmark/adapters";

import { renderArtificialAnalysisCatalog } from "../src/commands/quality-catalog.js";

it("renders source attribution, missing values, and internal-use scope", () => {
  const catalog: ArtificialAnalysisCatalog = {
    format: "anvilmark-model-catalog/1",
    source: "artificial-analysis-language-models-free",
    source_url: "https://artificialanalysis.ai/api/v2/language/models/free",
    attribution: "Artificial Analysis",
    attribution_url: "https://artificialanalysis.ai/",
    usage_rights: "internal-use-with-attribution",
    fetched_at: "2026-10-14T00:00:00Z",
    response_sha256: "f".repeat(64),
    intelligence_index_version: 4.1,
    tier: "free",
    pages_fetched: 1,
    rate_limit_remaining: 99,
    models: [
      {
        id: "id-1",
        name: "Example Model",
        slug: "example-model",
        creator_id: "creator-1",
        creator_name: "Example Labs",
        release_date: null,
        indices: {
          artificial_analysis_intelligence_index: 24.5,
          artificial_analysis_coding_index: null,
          artificial_analysis_agentic_index: 10.1,
        },
        price_1m_input_tokens: 0.1,
        price_1m_output_tokens: null,
        median_output_tokens_per_second: 100,
        median_time_to_first_token_seconds: null,
        median_time_to_first_answer_token_seconds: null,
        median_end_to_end_response_time_seconds: null,
      },
    ],
  };
  const rendered = renderArtificialAnalysisCatalog(catalog, {
    limit: 20,
    all: false,
  });
  expect(rendered).toContain("Artificial Analysis");
  expect(rendered).toContain("Example Model · Example Labs");
  expect(rendered).toContain("Customer-facing redistribution needs a separate");
  expect(rendered).toContain("Null means unavailable");
});
