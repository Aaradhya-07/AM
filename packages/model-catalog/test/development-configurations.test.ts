import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DevelopmentConfigurationCatalog,
  configurationFactFreshness,
  type DevelopmentConfigurationSnapshot,
} from "../src/index.js";

const source = {
  kind: "operator_attestation" as const,
  ref: "reviewed deployment record",
  observed_at: "2026-09-01T00:00:00.000Z",
  expires_at: "2026-12-01T00:00:00.000Z",
};

const snapshot: DevelopmentConfigurationSnapshot = {
  format: "anvilmark-development-configuration/1",
  id: "example-deployment",
  agent: "codex_cli",
  model: "example-model",
  deployment_id: "account-a/region-one",
  provider: { value: "Example Provider", source },
  data_regions: { value: ["region-one"], source },
  billing: {
    value: {
      mode: "api_estimate",
      input_usd_per_million: 1,
      output_usd_per_million: 2,
    },
    source,
  },
  capabilities: { tools: { value: true, source } },
};

describe("development configuration catalog", () => {
  it("keeps exact immutable snapshots and deduplicates a repeated import", async () => {
    const catalog = await DevelopmentConfigurationCatalog.open(":memory:");
    try {
      const first = catalog.storeSnapshot(snapshot);
      expect(catalog.storeSnapshot(snapshot)).toEqual(first);
      const next = catalog.storeSnapshot({
        ...snapshot,
        data_regions: { value: ["region-two"], source },
      });
      expect(next.snapshot_sha256).not.toBe(first.snapshot_sha256);
      expect(catalog.getByHash(snapshot.id, first.snapshot_sha256)).toEqual(
        first,
      );
      expect(catalog.getLatest(snapshot.id)).toEqual(next);
      expect(catalog.getHistory(snapshot.id)).toEqual([next, first]);
      expect(catalog.listLatest()).toEqual([next]);
      expect(() => catalog.importSnapshots([snapshot, snapshot])).toThrow(
        "duplicate id",
      );
      expect(catalog.getLatest(snapshot.id)).toEqual(next);
    } finally {
      catalog.close();
    }
  });

  it("computes fact freshness at decision time", () => {
    expect(
      configurationFactFreshness(source, new Date("2026-10-24T00:00:00Z")),
    ).toBe("fresh");
    expect(
      configurationFactFreshness(source, new Date("2026-12-01T00:00:00Z")),
    ).toBe("stale");
    expect(
      configurationFactFreshness(source, new Date("2026-08-01T00:00:00Z")),
    ).toBe("stale");
  });

  it("rejects an altered stored claim even when its pinned hash was left in place", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anvilmark-config-"));
    const path = join(directory, "configurations.sqlite");
    try {
      const catalog = await DevelopmentConfigurationCatalog.open(path);
      catalog.storeSnapshot(snapshot);
      catalog.close();
      const db = new DatabaseSync(path);
      db.prepare(
        "UPDATE configuration_snapshots SET snapshot_json = replace(snapshot_json, 'Example Provider', 'Other Provider')",
      ).run();
      db.close();
      const reopened = await DevelopmentConfigurationCatalog.open(path);
      try {
        expect(() => reopened.getLatest(snapshot.id)).toThrow(
          "integrity check failed",
        );
      } finally {
        reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
