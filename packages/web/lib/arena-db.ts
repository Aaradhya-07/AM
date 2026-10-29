import { DatabaseSync } from "node:sqlite";
import { modelDatabasePath, type CatalogSource } from "./model-catalog-db";

export interface ArenaRating {
  id: string;
  config: string;
  category: string;
  model_name: string;
  organization: string | null;
  model_license: string | null;
  score: number;
  score_lower: number | null;
  score_upper: number | null;
  score_kind: "rating" | "score";
  sample_count: number | null;
  sample_kind: string | null;
  observation_count: number | null;
  rank: number | null;
  published_date: string;
}

export interface ArenaLeaderboardPayload {
  rows: ArenaRating[];
  config: string;
  category: string;
  query: string;
  configs: Array<{ config: string; overall_count: number }>;
  categories: Array<{ category: string; count: number }>;
  total: number;
  page: number;
  page_size: number;
  source: CatalogSource;
}

export function readArenaLeaderboard(
  requested: {
    config?: string;
    category?: string;
    query?: string;
    page?: number;
  } = {},
): ArenaLeaderboardPayload {
  const db = new DatabaseSync(modelDatabasePath(), { readOnly: true });
  try {
    const configs = db
      .prepare(
        "SELECT config, SUM(CASE WHEN category = 'overall' THEN 1 ELSE 0 END) AS overall_count FROM arena_ratings GROUP BY config ORDER BY config",
      )
      .all() as unknown as ArenaLeaderboardPayload["configs"];
    const config = configs.some((entry) => entry.config === requested.config)
      ? requested.config!
      : "text";
    const categories = db
      .prepare(
        "SELECT category, COUNT(*) AS count FROM arena_ratings WHERE config = ? GROUP BY category ORDER BY category",
      )
      .all(config) as unknown as ArenaLeaderboardPayload["categories"];
    const category = categories.some(
      (entry) => entry.category === requested.category,
    )
      ? requested.category!
      : categories.some((entry) => entry.category === "overall")
        ? "overall"
        : (categories[0]?.category ?? "overall");
    const query = (requested.query ?? "").trim().slice(0, 100);
    const where =
      "config = ? AND category = ? AND instr(lower(model_name || ' ' || coalesce(organization, '')), lower(?)) > 0";
    const total = (
      db
        .prepare("SELECT COUNT(*) AS count FROM arena_ratings WHERE " + where)
        .get(config, category, query) as { count: number }
    ).count;
    const pageSize = 100;
    const page = Math.min(
      Math.max(Math.trunc(requested.page ?? 1), 1),
      Math.max(1, Math.ceil(total / pageSize)),
    );
    const rows = db
      .prepare(
        "SELECT id, config, category, model_name, organization, model_license, score, score_lower, score_upper, score_kind, sample_count, sample_kind, observation_count, rank, published_date FROM arena_ratings WHERE " +
          where +
          " ORDER BY rank IS NULL, rank, score DESC LIMIT ? OFFSET ?",
      )
      .all(
        config,
        category,
        query,
        pageSize,
        (page - 1) * pageSize,
      ) as unknown as ArenaRating[];
    const source = db
      .prepare(
        "SELECT id, url, license, license_url, fetched_at, sha256 FROM catalog_sources WHERE id = 'arena'",
      )
      .get();
    if (!source) throw new Error("Arena source metadata is missing");
    return {
      rows,
      config,
      category,
      query,
      configs,
      categories,
      total,
      page,
      page_size: pageSize,
      source: source as unknown as CatalogSource,
    };
  } finally {
    db.close();
  }
}
