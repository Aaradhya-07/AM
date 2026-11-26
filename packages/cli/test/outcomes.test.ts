import { createHash } from "node:crypto";
import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import {
  aggregateOutcomes,
  appendSliceOutcome,
  RepoOutcomesSummarySchema,
} from "../src/commands/outcomes.js";
import { cleanup, cli, scriptedIo } from "./helpers.js";
import { now, put, repo } from "./slice-fixture.js";

afterEach(cleanup);

it("aggregates reviewed sidecars and structured outcomes without exporting run content", async () => {
  const root = await repo();
  const checksum = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const run = {
    schema_version: 1,
    id: "my-run",
    plan_hash: "a".repeat(64),
    candidate_id: "gpt",
    configured_model: "gpt",
    model_events: [],
    base_commit: "base",
    prompt_sha256: "prompt",
    finished_at: now,
    approval_at_start: "current",
    approval_actor_at_start: "interactive_local_operator",
    agent_exit_code: 0,
    changed_paths: ["src/index.ts"],
    checks: [{ exit_code: 0 }],
    usage: { input_tokens: 14, output_tokens: 3 },
    agent_error: "private source content",
  };
  await put(root, ".anvilmark/development/runs/my-run.json", run);
  await put(root, ".anvilmark/development/reviews/my-run.json", {
    run_id: run.id,
    run_hash: checksum(run),
    decision: "accepted",
    actor: "interactive_local_operator",
  });
  const outcome = await appendSliceOutcome(
    root,
    {
      slice_id: "labels",
      configured_model: "gpt",
      served_model: "claude",
      provider: "OpenAI",
      status: "accepted",
      attempts: 3,
      retries: 2,
      input_tokens: 50,
      output_tokens: 12,
      rework_ratio: 0.2,
      observed_usd: 0.6,
    },
    true,
    now,
  );
  expect(outcome).toMatchObject({
    configured_model: "gpt",
    served_model: "claude",
  });
  const io = scriptedIo({ cwd: root, clock: () => now });
  expect(await cli(["outcomes", "--write", "--json"], io)).toBe(0);
  const summary = RepoOutcomesSummarySchema.parse(JSON.parse(io.out()));
  expect(summary).toEqual({
    schemaVersion: "anvilmark.outcomes-summary.v1",
    generatedAt: now,
    repoName: "label-service",
    totalRecordedRuns: 2,
    models: [
      {
        model: "claude",
        attempts: 3,
        acceptedFirstPass: 0,
        acceptedAfterRetry: 1,
        rejected: 0,
        meanRetries: 2,
        meanReworkRatio: 0.2,
        meanInputTokens: 50,
        meanOutputTokens: 12,
        observedUsdPerAccepted: 0.6,
        lastObservedAt: now,
      },
      {
        model: "gpt",
        taskCategory: "general",
        attempts: 1,
        acceptedFirstPass: 1,
        acceptedAfterRetry: 0,
        rejected: 0,
        meanRetries: 0,
        meanReworkRatio: 0,
        meanInputTokens: 14,
        meanOutputTokens: 3,
        observedUsdPerAccepted: null,
        lastObservedAt: now,
      },
    ],
  });
  expect(io.out()).not.toContain("private source");
  expect(
    await readFile(
      join(root, ".anvilmark/development/outcomes-summary.json"),
      "utf8",
    ),
  ).toBe(io.out());
});

it("returns a clean empty summary and refuses symlink writes and reads", async () => {
  const root = await repo();
  expect(await aggregateOutcomes(root, now)).toMatchObject({
    totalRecordedRuns: 0,
    models: [],
  });
  await put(root, "private.txt", "unchanged");
  await symlink(
    join(root, "private.txt"),
    join(root, ".anvilmark/development/outcomes-summary.json"),
  );
  expect(await cli(["outcomes", "--write"], scriptedIo({ cwd: root }))).toBe(1);
  expect(await readFile(join(root, "private.txt"), "utf8")).toBe("unchanged");
  await symlink(root, join(root, ".anvilmark/development/runs"));
  await expect(aggregateOutcomes(root)).rejects.toThrow(/symlink/);
});

it("does not record accepted outcomes without passing verification", async () => {
  const root = await repo();
  await expect(
    appendSliceOutcome(
      root,
      {
        slice_id: "labels",
        configured_model: "gpt",
        status: "accepted",
        attempts: 1,
        retries: 0,
      },
      false,
      now,
    ),
  ).rejects.toThrow(/accepted verification/);
  expect((await aggregateOutcomes(root)).totalRecordedRuns).toBe(0);
});
