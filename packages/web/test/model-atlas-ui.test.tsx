// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { ModelExplorer } from "../app/models/ModelExplorer";
import type { ModelCatalogPayload } from "../lib/model-catalog-db";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const catalog: ModelCatalogPayload = {
  offers: [
    {
      id: "test/alpha",
      source_id: "test",
      canonical_model_id: "alpha",
      provider: "Northstar",
      name: "Alpha Chat",
      mode: "chat",
      status: "current",
      max_input_tokens: 128000,
      max_output_tokens: 8000,
      input_usd_per_million: 1,
      output_usd_per_million: 5,
      cache_read_usd_per_million: null,
      output_usd_per_image: null,
      input_usd_per_second: null,
      output_usd_per_second: null,
      vision: 1,
      tools: 1,
      reasoning: 0,
      audio_input: 0,
      audio_output: 0,
      deprecation_date: null,
      source_url: "https://example.com/alpha",
    },
  ],
  releases: [],
  sources: [
    {
      id: "test",
      url: "https://example.com/catalog",
      license: "MIT",
      license_url: "https://opensource.org/license/mit",
      fetched_at: "2026-10-27T00:00:00.000Z",
      sha256: "a".repeat(64),
    },
  ],
  arena_rating_count: 0,
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("Model Atlas interactions", () => {
  it("shows initial data and switches between the directory and comparison", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(ModelExplorer, { initialCatalog: catalog }));
    });
    expect(host.textContent).toContain("Alpha Chat");
    expect(host.textContent).toContain("1 matches");

    const compare = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Compare (0)",
    );
    expect(compare).toBeDefined();
    await act(async () => {
      compare!.click();
    });
    expect(host.textContent).toContain("Choose up to four provider listings");

    await act(async () => {
      root.unmount();
    });
  });
});
