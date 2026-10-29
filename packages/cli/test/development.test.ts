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
  it("requires a declared fixed baseline and exposes matched-evidence abstention", async () => {
    const { root } = await repository();
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify({
        ...plan,
        evaluation: { baseline_candidate_id: "missing" },
      }),
    );
    const invalid = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        invalid,
      ),
    ).toBe(1);
    expect(invalid.err()).toContain("evaluation baseline candidate");

    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify({
        ...plan,
        evaluation: {
          baseline_candidate_id: "strong",
          max_acceptance_drop: 0,
        },
      }),
    );
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const output = scriptedIo({ cwd: root });
    expect(await cli(["development", "recommend", "--json"], output)).toBe(0);
    const result = JSON.parse(output.out());
    expect(result.matched_evidence.baseline_candidate_id).toBe("strong");
    expect(result.matched_evidence.standing).toBe(
      "insufficient_matched_tasks",
    );
    expect(result.matched_evidence.trial_candidate_id).toBeNull();
  });

  it("permits two candidates for one model and requires candidate selection to run", async () => {
    const { root } = await repository();
    const duplicated = structuredClone(plan);
    duplicated.candidates[1]!.model = duplicated.candidates[0]!.model;
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(duplicated),
    );
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const result = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "development",
          "run",
          "--model",
          duplicated.candidates[0]!.model,
          "--prompt-file",
          ".anvilmark/input-plan.json",
        ],
        result,
      ),
    ).toBe(1);
    expect(result.err()).toContain("use --candidate ID");
  });

  it("does not use public research as proof of a hard provider restriction", async () => {
    const { root } = await repository();
    const imported = scriptedIo({ cwd: root });
    const source = {
      kind: "public_research",
      ref: "synthetic research entry",
      observed_at: "2026-09-01T00:00:00.000Z",
      expires_at: "2026-12-01T00:00:00.000Z",
    };
    await writeFile(
      join(root, ".anvilmark/configurations.json"),
      JSON.stringify({
        format: "anvilmark-development-catalog/1",
        configurations: plan.candidates.map((candidate) => ({
          format: "anvilmark-development-configuration/1",
          id: candidate.id,
          agent: candidate.agent,
          model: candidate.model,
          deployment_id: `example/${candidate.id}`,
          provider: { value: "Example Provider", source },
          billing: {
            value: { mode: "subscription" },
            source: { ...source, kind: "operator_attestation" },
          },
        })),
      }),
    );
    expect(
      await cli(
        [
          "development",
          "catalog",
          "import",
          "--file",
          ".anvilmark/configurations.json",
          "--json",
        ],
        imported,
      ),
      imported.err(),
    ).toBe(0);
    const entries = JSON.parse(imported.out()) as Array<{
      snapshot_sha256: string;
    }>;
    const mapped = {
      ...plan,
      restrictions: {
        ...plan.restrictions,
        provider: {
          allowed: ["Example Provider"],
          source: "organization policy",
        },
        required_capabilities: ["tools"],
      },
      candidates: plan.candidates.map((candidate, index) => ({
        ...candidate,
        catalog_ref: {
          configuration_id: candidate.id,
          snapshot_sha256: entries[index]!.snapshot_sha256,
        },
      })),
    };
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(mapped),
    );
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const report = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "report", "--json"], report),
      report.err(),
    ).toBe(0);
    const first = JSON.parse(report.out()).comparison[0];
    expect(first.standing).toBe("unknown");
    expect(
      first.restriction_standings.map(
        (entry: { standing: string }) => entry.standing,
      ),
    ).toEqual(["unknown", "unknown"]);
  });

  it("uses pinned configuration facts for restrictions and blocks a superseded run", async () => {
    const { root } = await repository();
    const source = {
      kind: "operator_attestation",
      ref: "reviewed deployment record",
      observed_at: "2026-09-01T00:00:00.000Z",
      expires_at: "2026-12-01T00:00:00.000Z",
    };
    const configuration = (id: string, model: string, region: string) => ({
      format: "anvilmark-development-configuration/1",
      id,
      agent: "codex_cli",
      model,
      deployment_id: `example-account/${region}`,
      provider: { value: "Example Provider", source },
      data_regions: { value: [region], source },
      billing: {
        value: {
          mode: "api_estimate",
          input_usd_per_million: 1,
          output_usd_per_million: 2,
        },
        source,
      },
      capabilities: { tools: { value: true, source } },
    });
    const fast = configuration("fast-deployment", "gpt-6-luna", "eu-west-1");
    const strong = configuration("strong-deployment", "gpt-6-sol", "us-east-1");
    const importFile = ".anvilmark/configurations.json";
    await writeFile(
      join(root, importFile),
      JSON.stringify({
        format: "anvilmark-development-catalog/1",
        configurations: [fast, strong],
      }),
    );
    const imported = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["development", "catalog", "import", "--file", importFile, "--json"],
        imported,
      ),
      imported.err(),
    ).toBe(0);
    const entries = JSON.parse(imported.out()) as Array<{
      snapshot_sha256: string;
    }>;
    const mapped = {
      ...plan,
      restrictions: {
        ...plan.restrictions,
        max_estimated_usd: 0.01,
        provider: {
          allowed: ["Example Provider"],
          source: "organization policy",
        },
        data_region: { allowed: ["eu-west-1"], source: "organization policy" },
        required_capabilities: ["tools"],
      },
      candidates: plan.candidates.map((candidate, index) => ({
        ...candidate,
        catalog_ref: {
          configuration_id: index === 0 ? fast.id : strong.id,
          snapshot_sha256: entries[index]!.snapshot_sha256,
        },
      })),
    };
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(mapped),
    );
    const planned = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        planned,
      ),
      planned.err(),
    ).toBe(0);
    const report = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "report", "--json"], report),
      report.err(),
    ).toBe(0);
    const options = JSON.parse(report.out()).comparison;
    expect(options[0].standing).toBe("eligible");
    expect(options[0].projected_usd).toBe(0.003);
    expect(
      options[0].restriction_standings.map(
        (item: { standing: string }) => item.standing,
      ),
    ).toEqual(["satisfied", "satisfied", "satisfied"]);
    expect(options[1].standing).toBe("excluded");

    const expired = scriptedIo({
      cwd: root,
      clock: () => "2026-12-02T00:00:00.000Z",
    });
    expect(
      await cli(["development", "report", "--json"], expired),
      expired.err(),
    ).toBe(0);
    expect(JSON.parse(expired.out()).comparison[0].standing).toBe("unknown");

    await writeFile(
      join(root, importFile),
      JSON.stringify({
        format: "anvilmark-development-catalog/1",
        configurations: [
          { ...fast, provider: { value: "Other Provider", source } },
        ],
      }),
    );
    expect(
      await cli(
        ["development", "catalog", "import", "--file", importFile],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const superseded = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "report", "--json"], superseded),
      superseded.err(),
    ).toBe(0);
    expect(
      JSON.parse(superseded.out()).comparison[0].configuration.standing,
    ).toBe("superseded");
    expect(JSON.parse(superseded.out()).comparison[0].standing).toBe("unknown");
    const history = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["development", "catalog", "history", "--id", fast.id, "--json"],
        history,
      ),
      history.err(),
    ).toBe(0);
    expect(JSON.parse(history.out())).toHaveLength(2);
    const run = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "development",
          "run",
          "--model",
          "gpt-6-luna",
          "--prompt-file",
          importFile,
        ],
        run,
      ),
    ).toBe(1);
    expect(run.err()).toContain("unresolved hard restriction");
  });

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

  it("labels assistant approval as test evidence", async () => {
    const { root } = await repository();
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const approved = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "approve", "--agent-test"], approved),
      approved.err(),
    ).toBe(0);
    expect(approved.out()).toContain("Test approved plan");
    const approval = JSON.parse(
      await readFile(
        join(root, ".anvilmark/development/approval.json"),
        "utf8",
      ),
    );
    expect(approval.actor).toBe("agent_test_operator");
    const report = scriptedIo({ cwd: root });
    expect(await cli(["development", "report", "--json"], report)).toBe(0);
    expect(JSON.parse(report.out()).approval_actor).toBe("agent_test_operator");
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

  it("uses sourced provider and data-region facts for allowed, excluded, and unknown standings", async () => {
    const { root } = await repository();
    const base = structuredClone(plan);
    const restricted = {
      ...base,
      restrictions: {
        ...base.restrictions,
        provider: {
          allowed: ["Example Provider"],
          excluded: ["Blocked Provider"],
          source: "operator provider policy",
        },
        data_region: {
          allowed: ["eu-west-1"],
          source: "operator residency policy",
        },
      },
      candidates: [
        {
          ...base.candidates[0],
          provider_evidence: {
            value: "Example Provider",
            source: "service contract A",
          },
          data_region_evidence: {
            values: ["eu-west-1"],
            source: "service contract A, processing terms",
          },
        },
        {
          ...base.candidates[1],
          provider_evidence: {
            value: "Blocked Provider",
            source: "service contract B",
          },
          data_region_evidence: {
            values: ["eu-west-1"],
            source: "service contract B, processing terms",
          },
        },
        {
          ...base.candidates[0],
          id: "outside-region",
          model: "third-model",
          provider_evidence: {
            value: "Example Provider",
            source: "service contract C",
          },
          data_region_evidence: {
            values: ["eu-west-1", "us-east-1"],
            source: "service contract C, processing terms",
          },
        },
        {
          ...base.candidates[0],
          id: "region-unknown",
          model: "fourth-model",
          provider_evidence: {
            value: "Example Provider",
            source: "service contract D",
          },
        },
        {
          ...base.candidates[0],
          id: "provider-unknown",
          model: "fifth-model",
          data_region_evidence: {
            values: ["eu-west-1"],
            source: "service contract E, processing terms",
          },
        },
      ],
    };
    restricted.restrictions.allowed_models.push(
      "third-model",
      "fourth-model",
      "fifth-model",
    );
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(restricted),
    );
    const planned = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        planned,
      ),
      planned.err(),
    ).toBe(0);
    expect(planned.out()).toContain("source: operator residency policy");
    expect(planned.out()).toContain("evidence: service contract A");
    expect(planned.out()).toContain("data-region evidence is missing");

    const report = scriptedIo({ cwd: root });
    expect(await cli(["development", "report", "--json"], report)).toBe(0);
    const options = JSON.parse(report.out()).comparison;
    expect(options.map((item: { standing: string }) => item.standing)).toEqual([
      "eligible",
      "excluded",
      "excluded",
      "unknown",
      "unknown",
    ]);
    expect(options[0].restriction_standings).toMatchObject([
      {
        restriction: "provider_allowlist",
        standing: "satisfied",
        restriction_source: "operator provider policy",
        evidence_source: "service contract A",
      },
      {
        restriction: "provider_exclusion",
        standing: "satisfied",
      },
      {
        restriction: "data_region_allowlist",
        standing: "satisfied",
        restriction_source: "operator residency policy",
        evidence_source: "service contract A, processing terms",
      },
    ]);
    expect(options[1].restriction_standings[1].standing).toBe("failed");
    expect(options[2].restriction_standings[2].standing).toBe("failed");
    expect(options[3].restriction_standings[2]).toMatchObject({
      standing: "unknown",
      evidence_source: null,
      observed: null,
    });
    expect(options[4].restriction_standings[0].standing).toBe("unknown");

    for (const model of ["gpt-6-sol", "fourth-model", "fifth-model"]) {
      const run = scriptedIo({ cwd: root });
      expect(
        await cli(
          [
            "development",
            "run",
            "--model",
            model,
            "--prompt-file",
            "unused.txt",
          ],
          run,
        ),
      ).toBe(1);
      expect(run.err()).toContain("unresolved hard restriction");
    }
  });

  it("requires a source label for each provider restriction and candidate fact", async () => {
    const { root } = await repository();
    const restricted = {
      ...structuredClone(plan),
      restrictions: {
        ...plan.restrictions,
        provider: { allowed: ["Example Provider"], source: "" },
      },
    };
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(restricted),
    );
    const result = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        result,
      ),
    ).toBe(1);
    expect(result.err()).toContain("source");
    restricted.restrictions.provider.source = "operator policy";
    Object.assign(restricted.candidates[0]!, {
      provider_evidence: { value: "Example Provider", source: "" },
    });
    await writeFile(
      join(root, ".anvilmark/input-plan.json"),
      JSON.stringify(restricted),
    );
    expect(
      await cli(
        ["development", "plan", "--file", ".anvilmark/input-plan.json"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(1);
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
            model === "gpt-6-luna" ? "--candidate" : "--model",
            model === "gpt-6-luna" ? "fast" : model,
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
    expect(first.selection).toContain("No evidence-backed model choice");
    expect(first.matched_evidence.standing).toBe("baseline_missing");
    expect(first.matched_evidence.trial_candidate_id).toBeNull();

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

    expect(
      await cli(
        ["development", "approve", "--agent-test"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const beforeTestRun = new Set(
      await readdir(join(root, ".anvilmark/development/runs")),
    );
    const testRunIo = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: fake },
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
        testRunIo,
      ),
      testRunIo.err(),
    ).toBe(0);
    const testRunId = (await readdir(join(root, ".anvilmark/development/runs")))
      .find((file) => !beforeTestRun.has(file))
      ?.replace(/\.json$/, "");
    expect(testRunId).toBeDefined();
    expect(
      await cli(
        ["development", "review", "--run", testRunId!, "--agent-test"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const testReport = scriptedIo({ cwd: root });
    expect(await cli(["development", "report", "--json"], testReport)).toBe(0);
    expect(
      JSON.parse(testReport.out()).runs.find(
        (run: { id: string }) => run.id === testRunId,
      ).review_status,
    ).toBe("agent_test_accepted_current");
    const afterTestReview = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "recommend", "--json"], afterTestReview),
    ).toBe(0);
    const agentTestResult = JSON.parse(afterTestReview.out());
    expect(agentTestResult.options[0].comparable.accepted).toBe(0);
    expect(agentTestResult.excluded_historical_runs).toBe(
      first.excluded_historical_runs + 2,
    );
  });
});
