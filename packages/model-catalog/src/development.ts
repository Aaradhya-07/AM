import { lstat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface DevelopmentEvidenceRow {
  readonly run_id: string;
  readonly run_hash: string;
  readonly plan_hash: string;
  readonly profile_key: string;
  readonly agent: string;
  readonly model: string;
  readonly configuration_key: string;
  readonly model_identity: string;
  readonly outcome: "accepted" | "rejected" | "failed" | "unreviewed";
  readonly observed_at: string;
  readonly billing: "api_rate_estimate" | "subscription_allowance";
  readonly estimated_usd: number | null;
  readonly input_tokens: number;
  readonly output_tokens: number;
}

type DbRow = Record<string, unknown>;

/** Local metadata index for coding-agent runs. Source JSON remains authoritative. */
export class DevelopmentEvidenceCatalog {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(path: string): Promise<DevelopmentEvidenceCatalog> {
    if (!path.trim()) throw new Error("development evidence path is required");
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new Error(
        "development evidence storage requires Node.js 24 or newer",
      );
    const { DatabaseSync } = await import("node:sqlite");
    if (path !== ":memory:") {
      await mkdir(dirname(path), { recursive: true });
      const existing = await lstat(path).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      if (existing && (!existing.isFile() || existing.isSymbolicLink()))
        throw new Error("development evidence path must be a regular file");
    }
    const db = new DatabaseSync(path);
    try {
      const catalog = new DevelopmentEvidenceCatalog(db);
      catalog.initialize();
      return catalog;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private initialize(): void {
    const version = (this.db.prepare("PRAGMA user_version").get() as DbRow)[
      "user_version"
    ];
    if (version !== 0 && version !== 1 && version !== 2)
      throw new Error(
        `unsupported development evidence schema version ${version}`,
      );
    if (version === 2) return;
    if (version === 1) {
      this.db.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE development_outcomes ADD COLUMN configuration_key TEXT NOT NULL DEFAULT 'legacy';
        DROP INDEX development_outcomes_match;
        CREATE INDEX development_outcomes_match
          ON development_outcomes(profile_key, agent, model, configuration_key, outcome);
        PRAGMA user_version = 2;
        COMMIT;
      `);
      return;
    }
    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE development_outcomes (
        run_id TEXT PRIMARY KEY,
        run_hash TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        profile_key TEXT NOT NULL,
        agent TEXT NOT NULL,
        model TEXT NOT NULL,
        configuration_key TEXT NOT NULL,
        model_identity TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('accepted','rejected','failed','unreviewed')),
        observed_at TEXT NOT NULL,
        billing TEXT NOT NULL,
        estimated_usd REAL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL
      );
      CREATE INDEX development_outcomes_match
        ON development_outcomes(profile_key, agent, model, configuration_key, outcome);
      PRAGMA user_version = 2;
      COMMIT;
    `);
  }

  close(): void {
    this.db.close();
  }

  upsert(row: DevelopmentEvidenceRow): void {
    if (
      !row.run_id ||
      !row.profile_key ||
      !row.agent ||
      !row.model ||
      !row.configuration_key
    )
      throw new Error("development evidence has a missing identity");
    this.db
      .prepare(
        `
      INSERT INTO development_outcomes
        (run_id, run_hash, plan_hash, profile_key, agent, model, configuration_key,
         model_identity, outcome, observed_at, billing, estimated_usd,
         input_tokens, output_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        run_hash=excluded.run_hash, plan_hash=excluded.plan_hash,
        profile_key=excluded.profile_key, agent=excluded.agent,
        model=excluded.model, configuration_key=excluded.configuration_key,
        model_identity=excluded.model_identity,
        outcome=excluded.outcome, observed_at=excluded.observed_at,
        billing=excluded.billing, estimated_usd=excluded.estimated_usd,
        input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens
    `,
      )
      .run(
        row.run_id,
        row.run_hash,
        row.plan_hash,
        row.profile_key,
        row.agent,
        row.model,
        row.configuration_key,
        row.model_identity,
        row.outcome,
        row.observed_at,
        row.billing,
        row.estimated_usd,
        row.input_tokens,
        row.output_tokens,
      );
  }

  replaceAll(rows: readonly DevelopmentEvidenceRow[]): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec("DELETE FROM development_outcomes");
      for (const row of rows) this.upsert(row);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  comparable(
    profileKey: string,
    agent: string,
    model: string,
    configurationKey = "legacy",
  ): DevelopmentEvidenceRow[] {
    return this.db
      .prepare(
        `
      SELECT * FROM development_outcomes
      WHERE profile_key = ? AND agent = ? AND model = ? AND configuration_key = ?
      ORDER BY observed_at DESC, run_id DESC
    `,
      )
      .all(profileKey, agent, model, configurationKey)
      .map((raw) => {
        const row = raw as DbRow;
        return {
          run_id: String(row["run_id"]),
          run_hash: String(row["run_hash"]),
          plan_hash: String(row["plan_hash"]),
          profile_key: String(row["profile_key"]),
          agent: String(row["agent"]),
          model: String(row["model"]),
          configuration_key: String(row["configuration_key"]),
          model_identity: String(row["model_identity"]),
          outcome: row["outcome"] as DevelopmentEvidenceRow["outcome"],
          observed_at: String(row["observed_at"]),
          billing: row["billing"] as DevelopmentEvidenceRow["billing"],
          estimated_usd: row["estimated_usd"] as number | null,
          input_tokens: Number(row["input_tokens"]),
          output_tokens: Number(row["output_tokens"]),
        };
      });
  }
}
