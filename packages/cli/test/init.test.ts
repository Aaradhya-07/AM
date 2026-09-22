import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  loadAtlasFixture,
  parseProjectContract,
  toNormalizedYaml,
} from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  ATLAS,
  FAKE_KEY,
  cleanup,
  cli,
  exists,
  projectText,
  readTree,
  scriptedIo,
  spawnCli,
  tempDir,
  writeHostConfig,
} from "./helpers.js";

afterEach(cleanup);

describe("anvilmark init (the built binary)", () => {
  it("turns an informal idea into a valid draft that invents nothing", async () => {
    const root = await tempDir();
    const idea =
      "Help support agents triage multilingual tickets with private redaction";
    const result = await spawnCli(
      ["init", "--idea", idea, "--name", "Ticket Helper"],
      {
        cwd: root,
      },
    );
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Saved state revision r1");

    const parsed = parseProjectContract(await projectText(root), "yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const contract = parsed.value;
    expect(contract.project.id).toBe("ticket-helper");
    expect(contract.project.state).toBe("draft");
    expect(contract.intent.summary).toBe(idea);
    // Nothing the user did not say is filled in.
    expect(contract.intent.users).toEqual([]);
    expect(contract.intent.outcomes).toEqual([]);
    expect(contract.workloads).toEqual([]);
    expect(contract.constraints).toEqual([]);
    expect(contract.resources.hardware).toEqual([]);
    expect(contract.resources.budgets).toEqual([]);
    expect(contract.candidates).toEqual([]);
    expect(contract.project.priority_order).toEqual([]);
    expect(contract.integrations).toEqual([
      expect.objectContaining({
        kind: "intelligence",
        adapter: "none",
        credential_ref: null,
      }),
    ]);

    expect(
      await exists(join(root, ".anvilmark", "history", "r000001.yaml")),
    ).toBe(true);
    const status = await spawnCli(["status"], { cwd: root });
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(
      "Not yet provided: users, outcomes, non-goals, workloads, constraints, priority order, hardware, budgets, candidates, decisions",
    );
  });

  it("records a repository reference without reading or sending its contents", async () => {
    const parent = await tempDir();
    const root = join(parent, "project");
    const repository = join(parent, "existing-service");
    await mkdir(root);
    await mkdir(join(repository, "src"), { recursive: true });
    await writeFile(
      join(repository, "src", "config.ts"),
      `export const key = "${FAKE_KEY}";\n`,
    );

    const result = await spawnCli(
      [
        "init",
        "--idea",
        "Add AI triage to the existing service",
        "--repo",
        "../existing-service",
      ],
      { cwd: root },
    );
    expect(result.code).toBe(0);
    const text = await projectText(root);
    const parsed = parseProjectContract(text, "yaml");
    expect(parsed.ok && parsed.value.project.repository_roots).toEqual([
      "../existing-service",
    ]);
    expect(
      JSON.stringify(await readTree(join(root, ".anvilmark"))),
    ).not.toContain(FAKE_KEY);
    expect(result.stdout).toContain(
      "repository reference(s) ../existing-service",
    );

    // Repository roots are default-denied to remote intelligence.
    const preview = await spawnCli(
      [
        "propose",
        "preview",
        "--task",
        "clarify_intent",
        "--via",
        "handoff",
        "--json",
      ],
      { cwd: root },
    );
    expect(preview.code).toBe(0);
    const payload = JSON.parse(preview.stdout) as {
      request: unknown;
      disclosure: { withheld_categories: string[] };
    };
    expect(JSON.stringify(payload.request)).not.toContain("existing-service");
    expect(payload.disclosure.withheld_categories).toContain(
      "repository_roots",
    );
  });

  it("refuses a repository path that does not exist and creates nothing", async () => {
    const root = await tempDir();
    const result = await spawnCli(
      ["init", "--idea", "x", "--repo", "../missing"],
      { cwd: root },
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("does not exist");
    expect(await exists(join(root, ".anvilmark", "project.yaml"))).toBe(false);
  });

  it("imports a reviewed contract file exactly as written", async () => {
    const root = await tempDir();
    const result = await spawnCli(["init", "--from-contract", ATLAS], {
      cwd: root,
    });
    expect(result.code).toBe(0);
    expect(await projectText(root)).toBe(
      toNormalizedYaml(await loadAtlasFixture()),
    );
  });

  it("refuses an invalid contract file and creates nothing", async () => {
    const root = await tempDir();
    const broken = join(root, "broken.yaml");
    const atlas = await readFile(ATLAS, "utf8");
    await writeFile(
      broken,
      atlas
        .replace("candidate_ref: null", "candidate_ref: nowhere")
        .replace(
          "current_decision_ref: null",
          "current_decision_ref: decision.missing",
        ),
    );
    const result = await spawnCli(["init", "--from-contract", broken], {
      cwd: root,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("reference_not_found");
    expect(await exists(join(root, ".anvilmark"))).toBe(false);
  });

  it("refuses a contract whose estimate is presented as a measurement", async () => {
    const root = await tempDir();
    const file = join(root, "estimate.yaml");
    const atlas = await readFile(ATLAS, "utf8");
    await writeFile(
      file,
      atlas
        .replace(
          "evidence_refs: []\ndecisions: []",
          [
            "evidence_refs:",
            "  - id: evidence.guess",
            "    kind: agent_inference",
            "    subject: candidate.classification.local_unselected.quality",
            "    producer: { name: some-agent }",
            "    observed_at: 2026-08-18T00:00:00Z",
            "    source: { type: manual }",
            "    confidence: low",
            "    refresh: { policy: never }",
            "    applies_to: { candidate_ref: candidate.classification.local_unselected }",
            "    value: { macro_f1: 0.95 }",
            "decisions: []",
          ].join("\n"),
        )
        .replace(
          "    measurements: {}\n    estimates: {}\n    constraint_results: []\n    status: unevaluated\n\n  - id: candidate.classification.remote_unselected",
          "    measurements:\n      quality_result_ref: evidence.guess\n    estimates: {}\n    constraint_results: []\n    status: unevaluated\n\n  - id: candidate.classification.remote_unselected",
        ),
    );
    const result = await spawnCli(["init", "--from-contract", file], {
      cwd: root,
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("estimate_presented_as_measurement");
    expect(await exists(join(root, ".anvilmark"))).toBe(false);
  });

  it("refuses to initialize twice", async () => {
    const root = await tempDir();
    expect(
      (await spawnCli(["init", "--idea", "one"], { cwd: root })).code,
    ).toBe(0);
    const before = await projectText(root);
    const again = await spawnCli(["init", "--idea", "two"], { cwd: root });
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("already an ANVILMARK project");
    expect(await projectText(root)).toBe(before);
  });

  it("asks for the idea only in a terminal, and explains the usage otherwise", async () => {
    const root = await tempDir();
    const piped = await spawnCli(["init"], { cwd: root });
    expect(piped.code).toBe(2);
    expect(piped.stderr).toContain("--idea is required");

    const io = scriptedIo({
      cwd: root,
      interactive: true,
      answers: ["An idea typed at the prompt"],
    });
    expect(await cli(["init"], io)).toBe(0);
    expect(io.prompts[0]).toContain("Describe the application idea");

    const other = await tempDir();
    const cancelled = scriptedIo({
      cwd: other,
      interactive: true,
      answers: [null],
    });
    expect(await cli(["init"], cancelled)).toBe(3);
    expect(await exists(join(other, ".anvilmark"))).toBe(false);
  });

  it("records the selected mechanism by id and never a credential", async () => {
    const root = await tempDir();
    const config = await tempDir("anvilmark-host-");
    await writeHostConfig(config, [
      {
        id: "remote-api",
        mechanism: "openai_compatible",
        base_url: "https://api.example.com/v1",
        model: "example-model",
        reach: "remote",
        credential_env: "EXAMPLE_API_KEY",
        cost: "may_incur_cost",
      },
    ]);
    const env = { ANVILMARK_CONFIG_HOME: config, EXAMPLE_API_KEY: FAKE_KEY };
    const unknown = await spawnCli(
      ["init", "--idea", "x", "--intelligence", "not-registered"],
      {
        cwd: root,
        env,
      },
    );
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("not registered");

    const result = await spawnCli(
      ["init", "--idea", "x", "--intelligence", "remote-api"],
      {
        cwd: root,
        env,
      },
    );
    expect(result.code).toBe(0);
    const tree = JSON.stringify(await readTree(join(root, ".anvilmark")));
    expect(tree).toContain("remote-api");
    expect(tree).not.toContain(FAKE_KEY);
    expect(tree).not.toContain("api.example.com");
    expect(result.stdout + result.stderr).not.toContain(FAKE_KEY);
  });

  it("refuses host configuration kept inside the project", async () => {
    const root = await tempDir();
    await writeHostConfig(join(root, "config"), [
      {
        id: "inside",
        mechanism: "openai_compatible",
        base_url: "http://127.0.0.1:9/v1",
        model: "m",
        reach: "local",
      },
    ]);
    const result = await spawnCli(
      ["init", "--idea", "x", "--intelligence", "inside"],
      {
        cwd: root,
        env: { ANVILMARK_CONFIG_HOME: join(root, "config") },
      },
    );
    expect(result.code).toBe(1);
    expect(await exists(join(root, ".anvilmark"))).toBe(false);
  });

  it("records a project whose remote intelligence may receive nothing", async () => {
    const root = await tempDir();
    const result = await spawnCli(
      [
        "init",
        "--idea",
        "offline project",
        "--remote-intelligence",
        "nothing",
        "--intelligence",
        "handoff",
      ],
      { cwd: root },
    );
    expect(result.code).toBe(0);
    const exported = await spawnCli(
      ["propose", "export", "--task", "clarify_intent"],
      { cwd: root },
    );
    expect(exported.code).toBe(1);
    expect(exported.stderr).toContain("allows no data categories");
    expect(await exists(join(root, ".anvilmark", "intelligence"))).toBe(false);
  });
});
