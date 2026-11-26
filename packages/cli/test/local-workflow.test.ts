import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { run } from "../src/cli.js";
import type { CliIo } from "../src/io.js";
import { EXIT } from "../src/io.js";
import { appendSliceOutcome } from "../src/commands/outcomes.js";
import { applyPlan, parseBundle } from "../src/commands/apply-plan.js";
import { REPO_ROOT } from "./helpers.js";

const exec = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "anvilmark-local-wf-"));
  tempDirs.push(dir);
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "dev@anvilmark.local"], {
    cwd: dir,
  });
  await exec("git", ["config", "user.name", "AnvilMark Dev"], { cwd: dir });
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "local-wf-app",
        version: "0.1.0",
        dependencies: { zod: "^4.0.0" },
        scripts: { test: "vitest run" },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(join(dir, "src/index.ts"), "export const ok = true;\n");
  await exec("git", ["add", "."], { cwd: dir });
  await exec("git", ["commit", "-m", "chore: bootstrap"], { cwd: dir });
  return dir;
}

function makeIo(cwd: string) {
  let out = "";
  let err = "";
  const controller = new AbortController();
  const io: CliIo = {
    cwd,
    isTTY: false,
    signal: controller.signal,
    clock: () => "2026-11-27T03:30:00.000Z",
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    readLine: async () => null,
  };
  return {
    io,
    stdout: () => out,
    stderr: () => err,
  };
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("Local-first CLI workflow: connect, hooks, cockpit, and next", () => {
  it("connects Claude Code, Codex, Cursor, VS Code, and Antigravity non-destructively", async () => {
    const repo = await makeTempRepo();
    // Seed an existing MCP server in .mcp.json to verify non-destructive merge
    await writeFile(
      join(repo, ".mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            "existing-github": { command: "npx", args: ["github-mcp"] },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const { connectAgents } = await import("../src/commands/connect.js");
    const fakeMcpEntry = join(
      REPO_ROOT,
      "packages/mcp/bin/anvilmark-project-mcp.mjs",
    );
    const connected = await connectAgents(
      repo,
      ["claude", "codex", "cursor", "vscode", "antigravity"],
      fakeMcpEntry,
    );

    expect(connected.length).toBeGreaterThanOrEqual(8);

    const claudeMcp = JSON.parse(
      await readFile(join(repo, ".mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, { args: string[] }> };
    expect(claudeMcp.mcpServers["existing-github"]).toBeDefined();
    expect(claudeMcp.mcpServers["anvilmark-project"]?.args).toContain(
      "--local-studio",
    );
    expect(claudeMcp.mcpServers["anvilmark-project"]?.args).toContain(
      "--slice-execution",
    );

    const codexToml = await readFile(join(repo, ".codex/config.toml"), "utf8");
    expect(codexToml).toContain("[mcp_servers.anvilmark-project]");
    expect(codexToml).toContain("--local-studio");

    const vsCodeMcp = JSON.parse(
      await readFile(join(repo, ".vscode/mcp.json"), "utf8"),
    ) as { servers: Record<string, { type: string }> };
    expect(vsCodeMcp.servers["anvilmark-project"]?.type).toBe("stdio");

    const agySkill = await readFile(
      join(repo, ".agent/skills/anvilmark/SKILL.md"),
      "utf8",
    );
    expect(agySkill).toContain("prepare_planning_context");
    expect(agySkill).toContain("lock_execution_plan");
  });

  it("installs git pre-commit and Claude Stop hooks, blocks .env leaks & locked dep edits, and uninstalls cleanly", async () => {
    const repo = await makeTempRepo();
    const userHookLine = 'echo "custom user hook"\n';
    await mkdir(join(repo, ".git/hooks"), { recursive: true });
    await writeFile(
      join(repo, ".git/hooks/pre-commit"),
      `#!/usr/bin/env sh\n${userHookLine}`,
      "utf8",
    );

    const { installHooks, uninstallHooks } =
      await import("../src/commands/hooks.js");
    await installHooks(
      repo,
      ["git", "claude"],
      join(REPO_ROOT, "packages/cli/bin/anvilmark.mjs"),
    );

    const statusCapture = makeIo(repo);
    expect(await run(["hooks", "status", "--json"], statusCapture.io)).toBe(
      EXIT.ok,
    );
    const statusJson = JSON.parse(statusCapture.stdout()) as {
      gitPreCommitInstalled: boolean;
      claudeStopHookInstalled: boolean;
    };
    expect(statusJson.gitPreCommitInstalled).toBe(true);
    expect(statusJson.claudeStopHookInstalled).toBe(true);

    // Apply a plan whose slice locks package.json dependencies
    const bundle = parseBundle({
      version: "anvilmark.plan-handoff.v1",
      createdAt: "2026-11-27T03:30:00.000Z",
      plan: {
        title: "Strict Auth Slice",
        goal: "Add token validation without new packages.",
        users: "API clients",
        scope: ["Add token validator"],
        nonGoals: [],
        assumptions: [],
        questions: [],
        architecture: [
          {
            title: "HMAC check",
            decision: "Use node:crypto.",
            why: "Built-in.",
            alternative: "External JWT lib",
            tradeoff: "Fewer features.",
          },
        ],
        flows: [],
        tasks: [
          {
            id: "slice-1",
            title: "Build validator",
            outcome: "Validates HMAC.",
            dependsOn: [],
            acceptance: ["Passes unit tests."],
            checks: ["npm test"],
            model: "gpt-6.1-sol",
            why: "Fast and accurate.",
            alternatives: [],
            inputTokens: 5000,
            outputTokens: 1000,
            estimateBasis: "1 file",
            contract: {
              allowedGlobs: ["src/**"],
              forbiddenGlobs: [".env", ".env.*"],
              verificationCommands: [],
              allowDependencyChanges: false,
              expectedBoundaries: [],
              reviewerFamily: "anthropic",
            },
          },
        ],
        security: [],
      },
      candidates: [
        {
          model: "gpt-6.1-sol",
          label: "GPT-6.1 Sol",
          provider: "OpenAI",
          tier: "balanced",
          billing: "subscription",
        },
      ],
      strict: true,
      masterPrompt: "# Master prompt",
    });
    await applyPlan(repo, bundle);
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "chore: lock plan"], { cwd: repo });

    // Clean change in src/ passes hook gate
    await writeFile(join(repo, "src/index.ts"), "export const ok = 2;\n");
    const cleanRun = makeIo(repo);
    expect(await run(["hooks", "run"], cleanRun.io)).toBe(EXIT.ok);

    // Creating .env.production triggers exit 1 (and exit 2 with --claude-stop)
    await writeFile(join(repo, ".env.production"), "API_SECRET=xyz\n");
    const blockedGit = makeIo(repo);
    expect(await run(["hooks", "run"], blockedGit.io)).toBe(EXIT.failed);
    expect(blockedGit.stderr()).toContain(".env.production");

    const blockedClaude = makeIo(repo);
    expect(await run(["hooks", "run", "--claude-stop"], blockedClaude.io)).toBe(
      EXIT.usage,
    );

    // Uninstall preserves original user hook script
    await uninstallHooks(repo, ["git", "claude"]);
    const remainingHook = await readFile(
      join(repo, ".git/hooks/pre-commit"),
      "utf8",
    );
    expect(remainingHook).toContain(userHookLine.trim());
    expect(remainingHook).not.toContain("ANVILMARK PRE-COMMIT HOOK");
  });

  it("renders bare anvilmark cockpit and advances anvilmark next across DAG waves", async () => {
    const repo = await makeTempRepo();

    // Bare `anvilmark` (empty argv) renders Mission Control with exit 0
    const emptyArgsRun = makeIo(repo);
    expect(await run([], emptyArgsRun.io)).toBe(EXIT.ok);
    expect(emptyArgsRun.stdout()).toContain("ANVILMARK MISSION CONTROL");

    const bundle = parseBundle({
      version: "anvilmark.plan-handoff.v1",
      createdAt: "2026-11-27T03:30:00.000Z",
      quotaMode: "conserve",
      plan: {
        title: "Two-Wave Upgrade",
        goal: "Ship schema then route.",
        users: "Developers",
        scope: ["Schema", "Route"],
        nonGoals: [],
        assumptions: [],
        questions: [],
        architecture: [
          {
            title: "SQLite WAL",
            decision: "Enable WAL mode.",
            why: "Concurrent reads.",
            alternative: "Rollback journal",
            tradeoff: "WAL files.",
          },
        ],
        flows: [],
        tasks: [
          {
            id: "wave-1-schema",
            title: "Create schema",
            outcome: "Table created.",
            dependsOn: [],
            acceptance: ["Migration clean."],
            checks: ["npm test"],
            model: "qwen3-coder-30b",
            why: "Local OSS.",
            alternatives: [],
            inputTokens: 6000,
            outputTokens: 1200,
            estimateBasis: "Schema",
            contract: {
              allowedGlobs: ["src/**"],
              forbiddenGlobs: [".env"],
              verificationCommands: [],
              allowDependencyChanges: false,
              expectedBoundaries: [],
              reviewerFamily: "anthropic",
            },
          },
          {
            id: "wave-2-route",
            title: "Create API route",
            outcome: "Endpoint live.",
            dependsOn: ["wave-1-schema"],
            acceptance: ["Returns 200."],
            checks: ["npm test"],
            model: "claude-sonnet-5-5",
            why: "Balanced multi-file.",
            alternatives: [],
            inputTokens: 10000,
            outputTokens: 2000,
            estimateBasis: "Route",
            contract: {
              allowedGlobs: ["src/**"],
              forbiddenGlobs: [".env"],
              verificationCommands: [],
              allowDependencyChanges: false,
              expectedBoundaries: [],
              reviewerFamily: "openai",
            },
          },
        ],
        security: [],
      },
      candidates: [
        {
          model: "qwen3-coder-30b",
          label: "Qwen 3 Coder 30B",
          provider: "am-server",
          tier: "balanced",
          billing: "local",
        },
        {
          model: "claude-sonnet-5-5",
          label: "Claude Sonnet 5.5",
          provider: "Anthropic",
          tier: "balanced",
          billing: "subscription",
        },
      ],
      strict: false,
      masterPrompt: "# Master prompt",
    });
    await applyPlan(repo, bundle);

    // 1st `anvilmark next --json` selects wave-1-schema (am-server)
    const next1 = makeIo(repo);
    expect(await run(["next", "--json"], next1.io)).toBe(EXIT.ok);
    const parsed1 = JSON.parse(next1.stdout()) as {
      sliceId: string;
      recommendedRunner: string;
      reviewerFamily: string;
    };
    expect(parsed1.sliceId).toBe("wave-1-schema");
    expect(parsed1.recommendedRunner).toBe("am-server");
    expect(parsed1.reviewerFamily).toBe("anthropic");

    // Record wave-1-schema as accepted
    const { sliceDigest } = await import("../src/commands/slice-worktree.js");
    await appendSliceOutcome(
      repo,
      {
        slice_id: "wave-1-schema",
        status: "accepted",
        configured_model: "qwen3-coder-30b",
        attempts: 1,
        retries: 0,
      },
      true,
      "2026-11-27T03:31:00.000Z",
      {
        planSha256: sliceDigest(JSON.stringify(bundle)),
        verifiedAt: "2026-11-27T03:31:00.000Z",
      },
    );

    // 2nd `anvilmark next --json` advances to wave-2-route (claude)
    const next2 = makeIo(repo);
    expect(await run(["next", "--json"], next2.io)).toBe(EXIT.ok);
    const parsed2 = JSON.parse(next2.stdout()) as {
      sliceId: string;
      recommendedRunner: string;
      reviewerFamily: string;
    };
    expect(parsed2.sliceId).toBe("wave-2-route");
    expect(parsed2.recommendedRunner).toBe("claude");
    expect(parsed2.reviewerFamily).toBe("openai");
  });
});
