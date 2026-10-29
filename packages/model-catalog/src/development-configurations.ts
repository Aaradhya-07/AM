import { createHash } from "node:crypto";
import { lstat, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface ConfigurationSource {
  readonly kind:
    | "provider_document"
    | "operator_attestation"
    | "local_observation"
    | "public_research";
  readonly ref: string;
  readonly observed_at: string;
  readonly expires_at: string;
}

export interface ConfigurationFact<T> {
  readonly value: T;
  readonly source: ConfigurationSource;
}

export type ConfigurationBilling =
  | { readonly mode: "subscription" }
  | {
      readonly mode: "api_estimate";
      readonly input_usd_per_million: number;
      readonly cached_input_usd_per_million?: number | undefined;
      readonly output_usd_per_million: number;
    };

/** One exact, import-reviewed agent/model/deployment offer. Missing facts stay missing. */
export interface DevelopmentConfigurationSnapshot {
  readonly format: "anvilmark-development-configuration/1";
  readonly id: string;
  readonly agent: string;
  readonly model: string;
  readonly deployment_id: string;
  readonly provider?: ConfigurationFact<string> | undefined;
  /** Complete set of regions where task data may be processed, as claimed by the source. */
  readonly data_regions?: ConfigurationFact<readonly string[]> | undefined;
  readonly billing?: ConfigurationFact<ConfigurationBilling> | undefined;
  readonly capabilities?:
    Readonly<Record<string, ConfigurationFact<boolean>>> | undefined;
}

export interface StoredDevelopmentConfiguration {
  readonly sequence: number;
  readonly snapshot_sha256: string;
  readonly imported_at: string;
  readonly snapshot: DevelopmentConfigurationSnapshot;
}

export type FactFreshness = "fresh" | "stale";

export function configurationFactFreshness(
  source: ConfigurationSource,
  now = new Date(),
): FactFreshness {
  const observed = Date.parse(source.observed_at);
  const expires = Date.parse(source.expires_at);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(expires) ||
    expires <= observed ||
    observed > now.getTime() ||
    now.getTime() >= expires
  )
    return "stale";
  return "fresh";
}

function sourceCopy(source: ConfigurationSource): ConfigurationSource {
  if (
    ![
      "provider_document",
      "operator_attestation",
      "local_observation",
      "public_research",
    ].includes(source.kind) ||
    !source.ref?.trim() ||
    !Number.isFinite(Date.parse(source.observed_at)) ||
    !Number.isFinite(Date.parse(source.expires_at)) ||
    Date.parse(source.expires_at) <= Date.parse(source.observed_at)
  )
    throw new Error(
      "configuration fact needs a source, observed time, and later expiry",
    );
  return {
    kind: source.kind,
    ref: source.ref,
    observed_at: source.observed_at,
    expires_at: source.expires_at,
  };
}

function factCopy<T>(
  fact: ConfigurationFact<T>,
  value: T,
): ConfigurationFact<T> {
  return { value, source: sourceCopy(fact.source) };
}

function normalizedSnapshot(
  input: DevelopmentConfigurationSnapshot,
): DevelopmentConfigurationSnapshot {
  if (
    input.format !== "anvilmark-development-configuration/1" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.id) ||
    !input.agent?.trim() ||
    !input.model?.trim() ||
    !input.deployment_id?.trim()
  )
    throw new Error(
      "configuration needs an exact id, agent, model, and deployment",
    );
  const capabilities: Record<string, ConfigurationFact<boolean>> = {};
  for (const key of Object.keys(input.capabilities ?? {}).sort()) {
    const fact = input.capabilities?.[key];
    if (
      !fact ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key) ||
      typeof fact.value !== "boolean"
    )
      throw new Error("capability needs a valid key and boolean sourced value");
    capabilities[key] = factCopy(fact, fact.value);
  }
  const billing = input.billing?.value;
  if (
    input.provider &&
    (typeof input.provider.value !== "string" || !input.provider.value.trim())
  )
    throw new Error("provider must be a nonempty sourced value");
  if (
    billing &&
    billing.mode !== "subscription" &&
    billing.mode !== "api_estimate"
  )
    throw new Error("unknown configuration billing mode");
  if (billing?.mode === "api_estimate") {
    if (
      billing.input_usd_per_million === undefined ||
      billing.output_usd_per_million === undefined
    )
      throw new Error("configuration API billing needs input and output rates");
    for (const value of [
      billing.input_usd_per_million,
      billing.cached_input_usd_per_million,
      billing.output_usd_per_million,
    ]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0))
        throw new Error(
          "configuration billing rates must be nonnegative finite numbers",
        );
    }
  }
  const regions = input.data_regions?.value;
  if (
    regions &&
    (!Array.isArray(regions) ||
      regions.length === 0 ||
      regions.some((value) => typeof value !== "string" || !value.trim()))
  )
    throw new Error(
      "processing regions must be a nonempty complete declaration",
    );
  return {
    format: input.format,
    id: input.id,
    agent: input.agent,
    model: input.model,
    deployment_id: input.deployment_id,
    ...(input.provider
      ? { provider: factCopy(input.provider, input.provider.value) }
      : {}),
    ...(input.data_regions
      ? {
          data_regions: factCopy(input.data_regions, [
            ...input.data_regions.value,
          ]),
        }
      : {}),
    ...(input.billing
      ? {
          billing: factCopy(
            input.billing,
            billing?.mode === "api_estimate"
              ? {
                  mode: "api_estimate",
                  input_usd_per_million: billing.input_usd_per_million,
                  ...(billing.cached_input_usd_per_million === undefined
                    ? {}
                    : {
                        cached_input_usd_per_million:
                          billing.cached_input_usd_per_million,
                      }),
                  output_usd_per_million: billing.output_usd_per_million,
                }
              : { mode: "subscription" },
          ),
        }
      : {}),
    ...(Object.keys(capabilities).length ? { capabilities } : {}),
  };
}

type DbRow = Record<string, unknown>;

/** Append-only local snapshots. Imports label claims; they do not verify source content. */
export class DevelopmentConfigurationCatalog {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(path: string): Promise<DevelopmentConfigurationCatalog> {
    if (!path.trim()) throw new Error("configuration catalog path is required");
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new Error("configuration catalog requires Node.js 24 or newer");
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
        throw new Error("configuration catalog path must be a regular file");
    }
    const db = new DatabaseSync(path);
    try {
      const catalog = new DevelopmentConfigurationCatalog(db);
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
    if (version !== 0 && version !== 1)
      throw new Error(
        `unsupported configuration catalog schema version ${version}`,
      );
    if (version === 1) return;
    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE configuration_snapshots (
        sequence INTEGER PRIMARY KEY,
        configuration_id TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        UNIQUE(configuration_id, snapshot_sha256)
      );
      CREATE INDEX configuration_snapshots_latest
        ON configuration_snapshots(configuration_id, sequence DESC);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  close(): void {
    this.db.close();
  }

  storeSnapshot(
    input: DevelopmentConfigurationSnapshot,
    now = new Date(),
  ): StoredDevelopmentConfiguration {
    const snapshot = normalizedSnapshot(input);
    const json = JSON.stringify(snapshot);
    const hash = createHash("sha256").update(json).digest("hex");
    const previous = this.getByHash(snapshot.id, hash);
    if (previous) return previous;
    this.db
      .prepare(
        "INSERT INTO configuration_snapshots (configuration_id, snapshot_sha256, imported_at, snapshot_json) VALUES (?, ?, ?, ?)",
      )
      .run(snapshot.id, hash, now.toISOString(), json);
    const stored = this.getByHash(snapshot.id, hash);
    if (!stored) throw new Error("configuration snapshot was not saved");
    return stored;
  }

  importSnapshots(
    inputs: readonly DevelopmentConfigurationSnapshot[],
    now = new Date(),
  ): StoredDevelopmentConfiguration[] {
    const normalized = inputs.map(normalizedSnapshot);
    if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length)
      throw new Error("configuration import contains a duplicate id");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const stored = normalized.map((entry) => this.storeSnapshot(entry, now));
      this.db.exec("COMMIT");
      return stored;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private row(raw: DbRow | undefined): StoredDevelopmentConfiguration | null {
    if (!raw) return null;
    const json = String(raw["snapshot_json"]);
    const hash = createHash("sha256").update(json).digest("hex");
    const snapshot = JSON.parse(json) as DevelopmentConfigurationSnapshot;
    if (
      hash !== raw["snapshot_sha256"] ||
      snapshot.id !== raw["configuration_id"]
    )
      throw new Error("configuration snapshot integrity check failed");
    return {
      sequence: Number(raw["sequence"]),
      snapshot_sha256: String(raw["snapshot_sha256"]),
      imported_at: String(raw["imported_at"]),
      snapshot,
    };
  }

  getByHash(id: string, hash: string): StoredDevelopmentConfiguration | null {
    return this.row(
      this.db
        .prepare(
          "SELECT * FROM configuration_snapshots WHERE configuration_id = ? AND snapshot_sha256 = ?",
        )
        .get(id, hash) as DbRow | undefined,
    );
  }

  getLatest(id: string): StoredDevelopmentConfiguration | null {
    return this.row(
      this.db
        .prepare(
          "SELECT * FROM configuration_snapshots WHERE configuration_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get(id) as DbRow | undefined,
    );
  }

  getHistory(id: string): StoredDevelopmentConfiguration[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM configuration_snapshots WHERE configuration_id = ? ORDER BY sequence DESC",
        )
        .all(id) as DbRow[]
    ).map((row) => this.row(row)!);
  }

  listLatest(): StoredDevelopmentConfiguration[] {
    return (
      this.db
        .prepare(
          `
      SELECT s.* FROM configuration_snapshots s
      WHERE s.sequence = (
        SELECT MAX(x.sequence) FROM configuration_snapshots x
        WHERE x.configuration_id = s.configuration_id
      ) ORDER BY s.configuration_id
    `,
        )
        .all() as DbRow[]
    ).map((row) => this.row(row)!);
  }
}
