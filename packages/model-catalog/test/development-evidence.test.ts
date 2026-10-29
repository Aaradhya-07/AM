import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  DevelopmentEvidenceCatalog,
  type DevelopmentEvidenceRow,
} from "../src/index.js";

const row: DevelopmentEvidenceRow = {
  run_id: "run-one",
  run_hash: "run-hash",
  plan_hash: "plan-hash",
  profile_key: "profile",
  agent: "codex_cli",
  model: "model",
  configuration_key: "deployment-a@hash-one",
  model_identity: "tool_reported",
  outcome: "accepted",
  observed_at: "2026-10-24T00:00:00.000Z",
  billing: "api_rate_estimate",
  estimated_usd: 0.1,
  input_tokens: 100,
  output_tokens: 10,
};

describe("development outcome index", () => {
  it("keeps runs from different configuration snapshots separate", async () => {
    const catalog = await DevelopmentEvidenceCatalog.open(":memory:");
    try {
      catalog.replaceAll([
        row,
        {
          ...row,
          run_id: "run-two",
          configuration_key: "deployment-b@hash-two",
        },
      ]);
      expect(
        catalog.comparable(
          "profile",
          "codex_cli",
          "model",
          "deployment-a@hash-one",
        ),
      ).toHaveLength(1);
      expect(
        catalog.comparable(
          "profile",
          "codex_cli",
          "model",
          "deployment-b@hash-two",
        ),
      ).toHaveLength(1);
      expect(catalog.comparable("profile", "codex_cli", "model")).toHaveLength(
        0,
      );
    } finally {
      catalog.close();
    }
  });

  it("migrates an existing version 1 outcome index", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anvilmark-evidence-"));
    const path = join(directory, "evidence.sqlite");
    try {
      const old = new DatabaseSync(path);
      old.exec(`
        CREATE TABLE development_outcomes (
          run_id TEXT PRIMARY KEY, run_hash TEXT NOT NULL, plan_hash TEXT NOT NULL,
          profile_key TEXT NOT NULL, agent TEXT NOT NULL, model TEXT NOT NULL,
          model_identity TEXT NOT NULL, outcome TEXT NOT NULL,
          observed_at TEXT NOT NULL, billing TEXT NOT NULL,
          estimated_usd REAL, input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL
        );
        CREATE INDEX development_outcomes_match
          ON development_outcomes(profile_key, agent, model, outcome);
        PRAGMA user_version = 1;
      `);
      old.close();
      const catalog = await DevelopmentEvidenceCatalog.open(path);
      try {
        catalog.upsert(row);
        expect(
          catalog.comparable(
            "profile",
            "codex_cli",
            "model",
            row.configuration_key,
          ),
        ).toEqual([row]);
      } finally {
        catalog.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
