import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GET } from "../app/api/models/route";
import { GET as GET_ARENA } from "../app/api/arena/route";
import { ModelExplorer } from "../app/models/ModelExplorer";
import { readArenaLeaderboard } from "../lib/arena-db";
import { readModelCatalog } from "../lib/model-catalog-db";

describe("Model Atlas public snapshot", () => {
  it("serves a substantial catalog with explicit source and no synthetic entries", () => {
    const { offers, releases, sources, arena_rating_count } =
      readModelCatalog();
    expect(Object.getPrototypeOf(offers[0])).toBe(Object.prototype);
    expect(Object.getPrototypeOf(sources[0])).toBe(Object.prototype);
    expect(offers.length).toBeGreaterThan(10_000);
    expect(releases.length).toBeGreaterThan(500);
    expect(sources).toHaveLength(4);
    expect(arena_rating_count).toBeGreaterThan(20_000);
    expect(new Set(offers.map((offer) => offer.id)).size).toBe(offers.length);
    expect(offers.some((offer) => offer.name.startsWith("Example "))).toBe(
      false,
    );
    expect(
      sources.every(
        (source) =>
          (source.id === "arena"
            ? source.license === "CC BY 4.0"
            : source.license === "MIT") && /^[a-f0-9]{64}$/.test(source.sha256),
      ),
    ).toBe(true);
    expect(
      offers.some(
        (offer) =>
          offer.source_id === "modelsdev_offers" && offer.canonical_model_id,
      ),
    ).toBe(true);
    expect(
      releases.some((release) =>
        release.benchmarks.some((benchmark) => benchmark.source_url),
      ),
    ).toBe(true);
    expect(offers.some((offer) => offer.status === "deprecated")).toBe(true);
    expect(
      offers.some((offer) => offer.source_url?.includes("artificialanalysis")),
    ).toBe(false);
    expect(
      releases.some((release) =>
        release.benchmarks.some((benchmark) =>
          benchmark.source_url?.includes("artificialanalysis"),
        ),
      ),
    ).toBe(false);
    expect(
      offers.some(
        (offer) =>
          offer.input_usd_per_million !== null &&
          offer.max_input_tokens !== null,
      ),
    ).toBe(true);
    expect(offers.some((offer) => offer.output_usd_per_image !== null)).toBe(
      true,
    );
    expect(offers.some((offer) => offer.output_usd_per_second !== null)).toBe(
      true,
    );
  });

  it("keeps official Arena scores separate from provider prices", async () => {
    const agent = readArenaLeaderboard({
      config: "agent",
      category: "overall",
    });
    expect(agent.source.license).toBe("CC BY 4.0");
    expect(agent.total).toBeGreaterThan(20);
    expect(agent.rows[0]!.score_kind).toBe("score");
    expect(agent.rows[0]!.score_lower).not.toBeNull();
    const text = readArenaLeaderboard({ config: "text", category: "overall" });
    expect(text.total).toBeGreaterThan(100);
    expect(text.rows[0]!.score_kind).toBe("rating");
    const response = GET_ARENA(
      new Request("http://localhost/api/arena?config=agent&category=overall"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).rows.length).toBeGreaterThan(20);
  });

  it("publishes the database through the models endpoint", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    const body = await response.json();
    expect(body.offers.length).toBeGreaterThan(10_000);
    expect(body.releases.length).toBeGreaterThan(500);
    expect(body.sources.map((source: { id: string }) => source.id)).toContain(
      "litellm",
    );
  });

  it("does not retain direct Artificial Analysis records in raw snapshot rows", () => {
    const db = new DatabaseSync(join(process.cwd(), "data", "models.sqlite"), {
      readOnly: true,
    });
    try {
      for (const table of ["model_offers", "model_releases"]) {
        const row = db
          .prepare(
            `SELECT COUNT(*) AS count FROM ${table} WHERE raw_json LIKE '%artificialanalysis%'`,
          )
          .get() as { count: number };
        expect(row.count).toBe(0);
      }
    } finally {
      db.close();
    }
  });

  it("renders real catalog rows on the first response", () => {
    const catalog = readModelCatalog();
    const html = renderToStaticMarkup(
      createElement(ModelExplorer, { initialCatalog: catalog }),
    );
    expect(html).toContain("Model Atlas");
    expect(html).toContain("Find the right model offer");
    expect(html).toContain("model listings");
    expect(html).toContain(catalog.offers.find((offer) => offer.mode === "chat")!.name);
    expect(html).not.toContain("Loading model listings");
    expect(html).not.toContain("Synthetic preview");
  });
});
