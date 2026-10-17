import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { openModelCatalog } from "@anvilmark/model-catalog";

import { collectCodexMetadata } from "../src/commands/development.js";
import { cleanup, cli, scriptedIo, tempDir } from "./helpers.js";

afterEach(cleanup);

const plan = {
  schema_version: 1,
  architecture: {
    id: "arch.slug",
    summary: "Normalize labels before storing them.",
  },
  task: {
    id: "task.slug",
    summary: "Fix repeated punctuation in labels.",
    profile: { kind: "bug", languages: ["typescript"], risk: "low" },
    checks: [{ name: "check", argv: ["node", "check.mjs"] }],
  },
  restrictions: {
    allowed_models: ["gpt-6-luna", "gpt-6-sol"],
    max_estimated_usd: null,
  },
  candidates: [
    {
      id: "fast",
      agent: "codex_cli",
      model: "gpt-6-luna",
      expected_input_tokens: 2000,
      expected_output_tokens: 500,
      billing: { mode: "subscription" },
      quality_evidence: "none",
      evidence_note: "No comparable project run yet.",
    },
    {
      id: "strong",
      agent: "codex_cli",
      model: "gpt-6-sol",
      expected_input_tokens: 3000,
      expected_output_tokens: 800,
      billing: { mode: "subscription" },
      quality_evidence: "none",
      evidence_note: "No comparable project run yet.",
    },
  ],
};

async function repository() {
  const dir = await tempDir();
  const root = join(dir, "project");
  await mkdir(root);
  await mkdir(join(root, ".anvilmark"));
  await writeFile(
    join(root, ".anvilmark", "input-plan.json"),
    JSON.stringify(plan),
  );
  return { dir, root };
}

describe("development pilot", () => {
  it("does not infer a served model from the configured model or count message content", () => {
    const metadata = collectCodexMetadata([
      '{"type":"thread.started","thread_id":"thread-1"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"private prompt text"}}',
      '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":40,"output_tokens":15,"reasoning_output_tokens":2}}',
      "not json",
    ]);
    expect(metadata).toEqual({
      threadId: "thread-1",
      modelEvents: [],
      eventCount: 3,
      parseErrors: 1,
      usage: {
        input_tokens: 120,
        cached_input_tokens: 40,
        output_tokens: 15,
        reasoning_output_tokens: 2,
      },
    });
  });

  it("preserves model-switch events in order", () => {
    const metadata = collectCodexMetadata([
      '{"type":"model.changed","model":"first"}',
      '{"type":"model.changed","model":"second"}',
    ]);
    expect(metadata.modelEvents).toEqual([
      { event_index: 1, model: "first" },
      { event_index: 2, model: "second" },
    ]);
  });

  it("connects a plan, comparison and exact approval", async () => {
    const { root } = await repository();
    const input = ".anvilmark/input-plan.json";
    const planned = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "plan", "--file", input], planned),
      planned.err(),
    ).toBe(0);
    expect(planned.out()).toContain(
      "Provisional allowance-use starting point: fast",
    );

    const saved = JSON.parse(
      await readFile(join(root, ".anvilmark/development/plan.json"), "utf8"),
    );
    const hash = createHash("sha256")
      .update(JSON.stringify(saved))
      .digest("hex");
    expect(
      await readFile(
        join(root, ".anvilmark/development/plans", `${hash}.json`),
        "utf8",
      ),
    ).toContain("arch.slug");
    const approved = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [hash.slice(0, 12)],
    });
    expect(
      await cli(["development", "approve"], approved),
      approved.err(),
    ).toBe(0);

    const report = scriptedIo({ cwd: root });
    expect(await cli(["development", "report"], report), report.err()).toBe(0);
    expect(report.out()).toContain("Approval: current. Recorded runs: 0.");
  });

  it("marks an approval stale after a changed plan", async () => {
    const { root } = await repository();
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const saved = JSON.parse(
      await readFile(join(root, ".anvilmark/development/plan.json"), "utf8"),
    );
    const hash = createHash("sha256")
      .update(JSON.stringify(saved))
      .digest("hex");
    expect(
      await cli(
        ["development", "approve"],
        scriptedIo({
          cwd: root,
          interactive: true,
          answers: [hash.slice(0, 12)],
        }),
      ),
    ).toBe(0);
    saved.task.summary = "A revised task";
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(saved),
    );
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const report = scriptedIo({ cwd: root });
    expect(await cli(["development", "report"], report)).toBe(0);
    expect(report.out()).toContain("Approval: missing_or_stale");
  });

  it("keeps a hard cash budget unknown for subscription candidates", async () => {
    const { root } = await repository();
    const budgeted = structuredClone(plan) as unknown as {
      restrictions: { max_estimated_usd: number | null };
    };
    budgeted.restrictions.max_estimated_usd = 1;
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(budgeted),
    );
    const result = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        result,
      ),
    ).toBe(0);
    expect(result.out()).toContain(
      "cash budget cannot be checked against subscription billing",
    );
    expect(result.out()).toContain("No eligible candidate");
  });

  it("refuses a development storage symlink", async () => {
    const root = await tempDir();
    const outside = await tempDir();
    const input = join(root, "plan.json");
    await writeFile(input, JSON.stringify(plan));
    await symlink(outside, join(root, ".anvilmark"));
    const result = scriptedIo({ cwd: root });
    expect(await cli(["development", "plan", "--file", input], result)).toBe(1);
    expect(result.err()).toContain("not a real directory");
    expect(await readdir(outside)).toEqual([]);
  });

  it("uses reviewed comparable runs and drops tampered review evidence", async () => {
    const { dir, root } = await repository();
    const candidatePlan = structuredClone(plan);
    for (const candidate of candidatePlan.candidates) {
      candidate.billing = {
        mode: "api_estimate",
        input_usd_per_million: candidate.id === "fast" ? 1 : 4,
        output_usd_per_million: candidate.id === "fast" ? 2 : 8,
        source: "test rates",
      } as typeof candidate.billing;
    }
    Object.assign(candidatePlan.candidates[0]!, {
      research_mapping: {
        source_key: "huggingface-benchmark-leaderboard:cais/hle",
        source_model_id: "publisher/model-a",
        relevance_note:
          "General reasoning signal only; not a coding-task gate.",
        identity_note: "Curated test mapping; served identity is unknown.",
      },
    });
    const publicCatalogPath = join(dir, "public-models.sqlite");
    const publicCatalog = await openModelCatalog(publicCatalogPath);
    publicCatalog.storeSnapshot({
      format: "anvilmark-public-benchmark/1",
      source: "huggingface-benchmark-leaderboard",
      benchmark_id: "cais/hle",
      source_url: "https://huggingface.co/api/datasets/cais/hle/leaderboard",
      fetched_at: "2026-10-14T00:00:00.000Z",
      response_sha256: "a".repeat(64),
      etag: null,
      results: [
        {
          rank: 1,
          model_id: "publisher/model-a",
          score: 42,
          verified: false,
          lower_is_better: false,
          source_url: "https://example.com/result",
          source_name: "submission",
          result_file: "eval.yaml",
          notes: null,
        },
      ],
    });
    publicCatalog.close();
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(candidatePlan),
    );
    await writeFile(join(root, ".anvilmark/prompt.txt"), "Fix the label.");
    await writeFile(join(root, "label.txt"), "broken\n");
    await writeFile(
      join(root, "check.mjs"),
      'import { readFileSync } from "node:fs"; if (readFileSync("label.txt", "utf8") !== "fixed\\n") process.exit(1);',
    );
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", ["-C", root, "add", "label.txt", "check.mjs"]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "baseline",
    ]);
    const fake = join(dir, "fake-codex.mjs");
    await writeFile(
      fake,
      '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync("label.txt", "fixed\\n");\nconsole.log(JSON.stringify({type:"thread.started",thread_id:"fake"}));\nconsole.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1000,output_tokens:100}}));\n',
    );
    await chmod(fake, 0o755);
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const saved = JSON.parse(
      await readFile(join(root, ".anvilmark/development/plan.json"), "utf8"),
    );
    const planHash = createHash("sha256")
      .update(JSON.stringify(saved))
      .digest("hex");
    expect(
      await cli(
        ["development", "approve"],
        scriptedIo({
          cwd: root,
          interactive: true,
          answers: [planHash.slice(0, 12)],
        }),
      ),
    ).toBe(0);

    const runIds: string[] = [];
    for (const model of ["gpt-6-luna", "gpt-6-sol"]) {
      const io = scriptedIo({
        cwd: root,
        env: { ANVILMARK_CODEX_EXECUTABLE: fake },
      });
      expect(
        await cli(
          [
            "development",
            "run",
            "--model",
            model,
            "--prompt-file",
            ".anvilmark/prompt.txt",
          ],
          io,
        ),
        io.err(),
      ).toBe(0);
      const files = await readdir(join(root, ".anvilmark/development/runs"));
      const runId = files
        .map((file) => file.replace(/\.json$/, ""))
        .find((id) => !runIds.includes(id));
      expect(runId).toBeDefined();
      runIds.push(runId!);
      const run = JSON.parse(
        await readFile(
          join(root, ".anvilmark/development/runs", `${runId}.json`),
          "utf8",
        ),
      );
      const runHash = createHash("sha256")
        .update(JSON.stringify(run))
        .digest("hex");
      const reviewed = scriptedIo({
        cwd: root,
        interactive: true,
        answers: [runHash.slice(0, 12)],
      });
      expect(
        await cli(["development", "review", "--run", runId!], reviewed),
        reviewed.err(),
      ).toBe(0);
      execFileSync("git", ["-C", root, "restore", "label.txt"]);
    }

    const rejectIo = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: fake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--model",
          "gpt-6-sol",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        rejectIo,
      ),
      rejectIo.err(),
    ).toBe(0);
    const rejectedId = (
      await readdir(join(root, ".anvilmark/development/runs"))
    )
      .map((file) => file.replace(/\.json$/, ""))
      .find((id) => !runIds.includes(id));
    expect(rejectedId).toBeDefined();
    const rejectedRun = JSON.parse(
      await readFile(
        join(root, ".anvilmark/development/runs", `${rejectedId}.json`),
        "utf8",
      ),
    );
    const rejectedHash = createHash("sha256")
      .update(JSON.stringify(rejectedRun))
      .digest("hex");
    const rejection = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [rejectedHash.slice(0, 12)],
    });
    expect(
      await cli(
        [
          "development",
          "review",
          "--run",
          rejectedId!,
          "--decision",
          "reject",
          "--reason",
          "Did not meet the task requirement",
        ],
        rejection,
      ),
      rejection.err(),
    ).toBe(0);
    execFileSync("git", ["-C", root, "restore", "label.txt"]);

    const switchedFake = join(dir, "switched-codex.mjs");
    await writeFile(
      switchedFake,
      '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync("label.txt", "fixed\\n");\nconsole.log(JSON.stringify({type:"model.changed",model:"different-model"}));\nconsole.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1000,output_tokens:100}}));\n',
    );
    await chmod(switchedFake, 0o755);
    const switchedIo = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: switchedFake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--model",
          "gpt-6-sol",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        switchedIo,
      ),
      switchedIo.err(),
    ).toBe(0);
    expect(switchedIo.out()).toContain(
      "reported model differs from configured rate",
    );
    execFileSync("git", ["-C", root, "restore", "label.txt"]);

    const cachedFake = join(dir, "cached-codex.mjs");
    await writeFile(
      cachedFake,
      '#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync("label.txt", "fixed\\n");\nconsole.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1000,cached_input_tokens:500,output_tokens:100}}));\n',
    );
    await chmod(cachedFake, 0o755);
    const cachedIo = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: cachedFake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--model",
          "gpt-6-luna",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        cachedIo,
      ),
      cachedIo.err(),
    ).toBe(0);
    expect(cachedIo.out()).toContain("cached-input usage or rate unavailable");
    execFileSync("git", ["-C", root, "restore", "label.txt"]);

    const recommended = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "development",
          "recommend",
          "--json",
          "--catalog-db",
          publicCatalogPath,
        ],
        recommended,
      ),
      recommended.err(),
    ).toBe(0);
    const first = JSON.parse(recommended.out());
    expect(first.research[0].standing).toBe("stale");
    expect(first.research[0].observations).toHaveLength(1);
    expect(first.research[1].standing).toBe("unmapped");
    expect(
      first.options.map(
        (item: { comparable: { accepted: number } }) =>
          item.comparable.accepted,
      ),
    ).toEqual([1, 1]);
    expect(first.options[1].comparable.rejected).toBe(1);
    expect(first.options[0].comparable.unreviewed).toBe(1);
    expect(first.excluded_historical_runs).toBe(1);
    expect(first.selection).toContain(
      "Exploratory sample cost-per-accepted starting point: fast",
    );

    const reviewPath = join(
      root,
      ".anvilmark/development/reviews",
      `${runIds[0]}.json`,
    );
    const review = JSON.parse(await readFile(reviewPath, "utf8"));
    review.run_hash = "0".repeat(64);
    await writeFile(reviewPath, JSON.stringify(review));
    const refreshed = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "recommend", "--json"], refreshed),
      refreshed.err(),
    ).toBe(0);
    expect(JSON.parse(refreshed.out()).options[0].comparable.accepted).toBe(0);
  });
});
