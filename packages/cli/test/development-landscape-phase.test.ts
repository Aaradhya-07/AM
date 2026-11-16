import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanup, cli, scriptedIo, tempDir } from "./helpers.js";

afterEach(cleanup);

const hash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
  }).trim();
}

async function project() {
  const parent = await tempDir();
  const root = join(parent, "project");
  await mkdir(root);
  await mkdir(join(root, ".anvilmark"));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "docs"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "example-app",
      scripts: { test: "node check.mjs" },
      dependencies: { openai: "1.0.0" },
    }),
  );
  await writeFile(
    join(root, "README.md"),
    "# Example\n\nThis package handles labels for the local example application.\n",
  );
  await writeFile(
    join(root, "src", "label.mjs"),
    "export const value = 'old';\n",
  );
  await writeFile(
    join(root, "check.mjs"),
    "import { value } from './src/label.mjs'; if (value !== 'new') process.exit(1);\n",
  );
  await writeFile(
    join(root, "check2.mjs"),
    "import { value } from './src/label.mjs'; if (value !== 'next') process.exit(1);\n",
  );
  await writeFile(
    join(root, "integration.mjs"),
    "import { value } from './src/label.mjs'; if (!value.startsWith('n')) process.exit(1);\n",
  );
  await writeFile(join(root, "docs", "ADR-001.md"), "# Keep labels stable\n");
  await writeFile(join(root, "src", "label.test.mjs"), "// test location\n");
  git(root, "init", "-q");
  git(
    root,
    "add",
    "README.md",
    "package.json",
    "src",
    "check.mjs",
    "check2.mjs",
    "integration.mjs",
    "docs",
  );
  git(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "baseline",
  );
  return { parent, root };
}

function plan(phaseId: string, dependsOn: string[] = [], maxAttempts = 2) {
  return {
    schema_version: 1,
    architecture: { id: "arch.labels", summary: "Label processing" },
    task: {
      id: `task.${phaseId}`,
      summary: "Change label behavior",
      profile: { kind: "feature", languages: ["javascript"], risk: "low" },
      checks: [{ name: "unit", argv: ["node", "check.mjs"] }],
    },
    phase: {
      id: phaseId,
      outcome: "Label behavior is usable",
      required_inputs: ["Current label module"],
      interface_commitments: ["Exported value remains a string"],
      non_goals: ["No public API change"],
      depends_on: dependsOn,
      integration_checks: [
        { name: "integration", argv: ["node", "integration.mjs"] },
      ],
      max_attempts: maxAttempts,
      escalation: "Review the architecture and change the plan",
    },
    restrictions: {
      allowed_models: ["model-a", "model-b"],
      max_estimated_usd: null,
    },
    candidates: ["model-a", "model-b"].map((model, index) => ({
      id: `option-${index}`,
      agent: "codex_cli",
      model,
      expected_input_tokens: 100,
      expected_output_tokens: 20,
      billing: { mode: "subscription" },
      quality_evidence: "none",
      evidence_note: "No comparable accepted tasks yet",
    })),
  };
}

async function saveAndApprove(root: string, value: ReturnType<typeof plan>) {
  await writeFile(
    join(root, ".anvilmark", "input-plan.json"),
    JSON.stringify(value),
  );
  const planned = scriptedIo({ cwd: root });
  expect(
    await cli(
      ["development", "plan", "--file", ".anvilmark/input-plan.json"],
      planned,
    ),
    planned.err(),
  ).toBe(0);
  const approved = scriptedIo({
    cwd: root,
    interactive: true,
    answers: [hash(value).slice(0, 12)],
  });
  expect(await cli(["development", "approve"], approved), approved.err()).toBe(
    0,
  );
}

async function fakeAgent(parent: string, content: string): Promise<string> {
  const path = join(parent, `fake-${content}.mjs`);
  await writeFile(
    path,
    `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('src/label.mjs', ${JSON.stringify(content)});\nconsole.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:20}}));\n`,
  );
  await chmod(path, 0o755);
  return path;
}

describe("development landscape and phases", () => {
  it("reports repository structure and makes historical authoring provenance explicitly unknown", async () => {
    const { root } = await project();
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["development", "landscape", "--goal", "Change label value", "--json"],
        io,
      ),
      io.err(),
    ).toBe(0);
    const report = JSON.parse(io.out());
    expect(report.format).toBe("anvilmark-development-landscape/1");
    expect(report.design.components[0].name).toBe("example-app");
    expect(report.design.components[0].declared_purpose.text).toContain(
      "handles labels",
    );
    expect(report.design.decision_documents).toContain("docs/ADR-001.md");
    expect(report.working_style.test_file_examples).toContain(
      "src/label.test.mjs",
    );
    expect(
      report.design.source_areas.some(
        (area: { directory: string }) => area.directory === "src",
      ),
    ).toBe(true);
    expect(
      report.change_readiness.file_leads.some(
        (lead: { path: string }) => lead.path === "src/label.mjs",
      ),
    ).toBe(true);
    expect(report.development_provenance.recorded_runs).toBe(0);
    expect(report.development_provenance.historical_authoring_model).toBe(
      "unknown_without_session_evidence",
    );
    expect(io.out()).not.toContain("openai is the author");
  });

  it("runs integration checks, enforces the attempt limit, and closes only the reviewed committed result", async () => {
    const { parent, root } = await project();
    const value = plan("phase.labels", [], 1);
    await saveAndApprove(root, value);
    await writeFile(
      join(root, ".anvilmark", "prompt.txt"),
      "Change the label value to new.",
    );
    const fake = await fakeAgent(parent, "export const value = 'new';\n");
    const ran = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: fake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--candidate",
          "option-0",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        ran,
      ),
      ran.err(),
    ).toBe(0);
    expect(ran.out()).toContain("unit=0, integration=0");
    const runFile = (
      await readdir(join(root, ".anvilmark", "development", "runs"))
    )[0]!;
    const run = JSON.parse(
      await readFile(
        join(root, ".anvilmark", "development", "runs", runFile),
        "utf8",
      ),
    );

    git(root, "restore", "src/label.mjs");
    const exhausted = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: fake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--candidate",
          "option-0",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        exhausted,
      ),
    ).toBe(1);
    expect(exhausted.err()).toContain("phase attempt limit reached");

    await writeFile(
      join(root, "src", "label.mjs"),
      "export const value = 'new';\n",
    );
    const reviewed = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [hash(run).slice(0, 12)],
    });
    expect(
      await cli(["development", "review", "--run", run.id], reviewed),
      reviewed.err(),
    ).toBe(0);
    const premature = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "close", "--run", run.id], premature),
    ).toBe(1);
    expect(premature.err()).toContain("commit the reviewed result");
    await writeFile(
      join(root, "src", "label.mjs"),
      "export const value = 'next';\n",
    );
    git(root, "add", "src/label.mjs");
    git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "different result",
    );
    const altered = scriptedIo({ cwd: root });
    expect(await cli(["development", "close", "--run", run.id], altered)).toBe(
      1,
    );
    expect(altered.err()).toContain("differs from the reviewed phase result");
    git(root, "reset", "--hard", "HEAD~1");
    await writeFile(
      join(root, "src", "label.mjs"),
      "export const value = 'new';\n",
    );
    git(root, "add", "src/label.mjs");
    git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "phase result",
    );
    const closed = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "close", "--run", run.id], closed),
      closed.err(),
    ).toBe(0);
    expect(closed.out()).toContain("Closed phase phase.labels");
    const report = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "report", "--json"], report),
      report.err(),
    ).toBe(0);
    expect(JSON.parse(report.out()).phase_closure.phase_id).toBe(
      "phase.labels",
    );
    const landscape = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "landscape", "--json"], landscape),
      landscape.err(),
    ).toBe(0);
    expect(
      JSON.parse(landscape.out()).development_provenance.recent_runs[0].review,
    ).toBe("human_accepted");

    const next = plan("phase.next", ["phase.labels"], 2);
    next.task.checks = [{ name: "unit", argv: ["node", "check2.mjs"] }];
    await saveAndApprove(root, next);
    const nextFake = await fakeAgent(parent, "export const value = 'next';\n");
    const closurePath = join(
      root,
      ".anvilmark",
      "development",
      "phases",
      "phase.labels.json",
    );
    const originalClosure = await readFile(closurePath, "utf8");
    const tamperedClosure = JSON.parse(originalClosure);
    tamperedClosure.commit = run.base_commit;
    await writeFile(closurePath, JSON.stringify(tamperedClosure));
    const tamperedRun = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: nextFake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--candidate",
          "option-0",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        tamperedRun,
      ),
    ).toBe(1);
    expect(tamperedRun.err()).toContain(
      "commit differs from its reviewed result",
    );
    await writeFile(closurePath, originalClosure);
    const nextRun = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: nextFake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--candidate",
          "option-0",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        nextRun,
      ),
      nextRun.err(),
    ).toBe(0);
    expect(nextRun.out()).toContain("unit=0, integration=0");
  });

  it("does not start a dependent phase before its prerequisite is closed", async () => {
    const { parent, root } = await project();
    await saveAndApprove(root, plan("phase.next", ["phase.labels"]));
    await writeFile(
      join(root, ".anvilmark", "prompt.txt"),
      "Change label value to new.",
    );
    const fake = await fakeAgent(parent, "export const value = 'new';\n");
    const io = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: fake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--candidate",
          "option-0",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        io,
      ),
    ).toBe(1);
    expect(io.err()).toContain("prerequisite phase phase.labels is not closed");
    expect(await readFile(join(root, "src", "label.mjs"), "utf8")).toContain(
      "old",
    );
  });

  it("keeps both paths of a staged rename in phase closure evidence", async () => {
    const { parent, root } = await project();
    const value = plan("phase.rename");
    value.task.checks = [
      {
        name: "unit",
        argv: [
          "node",
          "-e",
          "if (!require('node:fs').existsSync('src/renamed.mjs')) process.exit(1)",
        ],
      },
    ];
    value.phase.integration_checks = [
      {
        name: "integration",
        argv: [
          "node",
          "-e",
          "if (require('node:fs').existsSync('src/label.mjs')) process.exit(1)",
        ],
      },
    ];
    await saveAndApprove(root, value);
    await writeFile(
      join(root, ".anvilmark", "prompt.txt"),
      "Rename the label module.",
    );
    const fake = join(parent, "fake-rename.mjs");
    await writeFile(
      fake,
      "#!/usr/bin/env node\nimport { execFileSync } from 'node:child_process';\nexecFileSync('git', ['mv','src/label.mjs','src/renamed.mjs']);\nconsole.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:20}}));\n",
    );
    await chmod(fake, 0o755);
    const io = scriptedIo({
      cwd: root,
      env: { ANVILMARK_CODEX_EXECUTABLE: fake },
    });
    expect(
      await cli(
        [
          "development",
          "run",
          "--candidate",
          "option-0",
          "--prompt-file",
          ".anvilmark/prompt.txt",
        ],
        io,
      ),
      io.err(),
    ).toBe(0);
    const runFile = (
      await readdir(join(root, ".anvilmark", "development", "runs"))
    )[0]!;
    const run = JSON.parse(
      await readFile(
        join(root, ".anvilmark", "development", "runs", runFile),
        "utf8",
      ),
    );
    expect([...run.changed_paths].sort()).toEqual([
      "src/label.mjs",
      "src/renamed.mjs",
    ]);
    const reviewed = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [hash(run).slice(0, 12)],
    });
    expect(
      await cli(["development", "review", "--run", run.id], reviewed),
      reviewed.err(),
    ).toBe(0);
    git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "rename phase",
    );
    const closed = scriptedIo({ cwd: root });
    expect(
      await cli(["development", "close", "--run", run.id], closed),
      closed.err(),
    ).toBe(0);
  });
});
