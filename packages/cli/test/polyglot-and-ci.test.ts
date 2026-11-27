import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import { run } from "../src/cli.js";
import { applyPlan, parseBundle } from "../src/commands/apply-plan.js";
import { observeArchitecture } from "../src/commands/architecture-observations.js";
import { measureDrift } from "../src/commands/drift.js";
import type { CliIo } from "../src/io.js";
import { EXIT } from "../src/io.js";

const exec = promisify(execFile);
const tempDirs: string[] = [];

async function makeGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "anvilmark-polyglot-ci-"));
  tempDirs.push(dir);
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "ci@anvilmark.local"], {
    cwd: dir,
  });
  await exec("git", ["config", "user.name", "AnvilMark CI"], { cwd: dir });
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
    clock: () => "2026-11-27T06:10:00.000Z",
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    readLine: async () => null,
  };
  return { io, stdout: () => out, stderr: () => err };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("Polyglot drift scanner, contract-jailed am-server runner, and ci-report", () => {
  it("observes Python, Go, and Rust internal edges, boundaries, and unapproved AI SDKs in drift reports", async () => {
    const repo = await makeGitRepo();
    await mkdir(join(repo, "app/routes"), { recursive: true });
    await mkdir(join(repo, "app/db"), { recursive: true });
    await mkdir(join(repo, "cmd/server"), { recursive: true });
    await mkdir(join(repo, "internal/store"), { recursive: true });
    await mkdir(join(repo, "src"), { recursive: true });

    // Python FastAPI + OpenAI + internal import
    await writeFile(
      join(repo, "app/db/store.py"),
      "import sqlite3\n\ndef fetch_items():\n    return []\n",
      "utf8",
    );
    await writeFile(
      join(repo, "app/routes/api.py"),
      "from fastapi import APIRouter\nfrom app.db import store\nimport openai\n",
      "utf8",
    );

    // Go module + internal package + anthropic-sdk-go
    await writeFile(
      join(repo, "go.mod"),
      "module example.com/polyservice\n\ngo 1.23\n",
      "utf8",
    );
    await writeFile(
      join(repo, "internal/store/repo.go"),
      "package store\n\nfunc Ping() bool { return true }\n",
      "utf8",
    );
    await writeFile(
      join(repo, "cmd/server/main.go"),
      'package main\n\nimport (\n  "example.com/polyservice/internal/store"\n  "github.com/anthropics/anthropic-sdk-go"\n)\n',
      "utf8",
    );

    // Rust crate + async_openai + crate::worker
    await writeFile(
      join(repo, "Cargo.toml"),
      '[package]\nname = "polyrust"\nversion = "0.1.0"\n\n[dependencies]\nasync-openai = "0.28"\n',
      "utf8",
    );
    await writeFile(join(repo, "src/worker.rs"), "pub fn run() {}\n", "utf8");
    await writeFile(
      join(repo, "src/lib.rs"),
      "pub mod worker;\nuse crate::worker::run;\nuse async_openai::Client;\n",
      "utf8",
    );

    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "chore: polyglot baseline"], {
      cwd: repo,
    });

    const edges = observeArchitecture(repo);
    // Python edges
    expect(edges).toContainEqual({
      from: "app/routes/api.py",
      to: "app/db/store.py",
      kind: "import",
    });
    expect(edges).toContainEqual({
      from: "app/routes/api.py",
      to: "openai",
      kind: "sdk",
    });
    expect(edges).toContainEqual({
      from: "app/routes/api.py",
      to: "fastapi",
      kind: "boundary",
      boundary: "http-api",
    });
    // Go edges
    expect(edges).toContainEqual({
      from: "cmd/server/main.go",
      to: "internal/store/repo.go",
      kind: "import",
    });
    expect(edges).toContainEqual({
      from: "cmd/server/main.go",
      to: "anthropic-sdk-go",
      kind: "sdk",
    });
    // Rust edges
    expect(edges).toContainEqual({
      from: "src/lib.rs",
      to: "src/worker.rs",
      kind: "import",
    });
    expect(edges).toContainEqual({
      from: "src/lib.rs",
      to: "async-openai",
      kind: "sdk",
    });

    // Lock a plan that declares the internal Python flow, but NOT the OpenAI / Anthropic / Rust AI SDKs
    const bundle = parseBundle({
      version: "anvilmark.plan-handoff.v1",
      createdAt: "2026-11-27T06:10:00.000Z",
      plan: {
        title: "Polyglot Service",
        goal: "Local-only service without external cloud AI SDKs.",
        users: "Internal services",
        scope: ["API route to DB store"],
        nonGoals: ["External cloud LLMs"],
        assumptions: [],
        questions: [],
        architecture: [
          {
            title: "SQLite store",
            decision: "Keep data local.",
            why: "Zero external dependencies.",
            alternative: "Cloud DB",
            tradeoff: "Single node.",
          },
        ],
        flows: [
          {
            from: "app/routes/api.py",
            to: "app/db/store.py",
            data: "Item queries",
            boundary: "Internal DB module",
          },
        ],
        tasks: [
          {
            id: "py-store",
            title: "Wire Python store",
            outcome: "Reads items.",
            dependsOn: [],
            acceptance: ["Returns items."],
            checks: ["pytest"],
            model: "qwen3-coder-30b-a3b",
            why: "Local OSS.",
            alternatives: [],
            inputTokens: 4000,
            outputTokens: 800,
            estimateBasis: "2 files",
          },
        ],
        security: [],
      },
      candidates: [
        {
          model: "qwen3-coder-30b-a3b",
          label: "Qwen 3 Coder 30B",
          provider: "am-server",
          tier: "balanced",
          billing: "local",
        },
      ],
      strict: true,
      masterPrompt: "# Master",
    });
    await applyPlan(repo, bundle);

    const drift = await measureDrift(repo, "2026-11-27T06:10:00.000Z");
    expect(drift.status).toBe("drifted");
    expect(drift.items.some((i) => i.kind === "unapproved_ai_sdk")).toBe(true);
  });

  it("blocks out-of-scope and .env edits pre-write in contract-jailed am-server runner and self-heals on retry", async () => {
    const repo = await makeGitRepo();
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(
      join(repo, "src/math.ts"),
      "export function add(a: number, b: number) { return a; }\n",
      "utf8",
    );
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "chore: initial"], { cwd: repo });

    const bundle = parseBundle({
      version: "anvilmark.plan-handoff.v1",
      createdAt: "2026-11-27T06:10:00.000Z",
      plan: {
        title: "Fix Addition",
        goal: "Return a + b in src/math.ts.",
        users: "Callers",
        scope: ["Fix src/math.ts"],
        nonGoals: [],
        assumptions: [],
        questions: [],
        architecture: [
          {
            title: "Pure function",
            decision: "Keep add pure.",
            why: "Deterministic.",
            alternative: "Class",
            tradeoff: "Simple.",
          },
        ],
        flows: [],
        tasks: [
          {
            id: "fix-add",
            title: "Fix add in src/math.ts",
            outcome: "add(2, 3) returns 5.",
            dependsOn: [],
            acceptance: ["Returns sum."],
            checks: ["npm test"],
            model: "qwen3-coder-30b-a3b",
            why: "Zero-cost local coder.",
            alternatives: [],
            inputTokens: 3000,
            outputTokens: 600,
            estimateBasis: "Single function.",
            contract: {
              allowedGlobs: ["src/**"],
              forbiddenGlobs: [".env", ".env.*"],
              verificationCommands: ["git diff --check"],
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
          model: "qwen3-coder-30b-a3b",
          label: "Qwen 3 Coder 30B",
          provider: "am-server",
          tier: "balanced",
          billing: "local",
        },
      ],
      strict: false,
      masterPrompt: "# Master",
    });
    await applyPlan(repo, bundle);
    await exec("git", ["add", "."], { cwd: repo });
    await exec("git", ["commit", "-m", "chore: lock plan"], { cwd: repo });

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        callCount += 1;
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ content: string }>;
        };
        if (callCount === 1) {
          // Attempt 1 tries to write a forbidden .env.production file AND outside-scope README.md
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: "Attempted bad writes",
                      edits: [
                        { path: ".env.production", content: "LEAK=1\n" },
                        { path: "README.md", content: "# Out of scope\n" },
                      ],
                    }),
                  },
                },
              ],
              usage: { prompt_tokens: 400, completion_tokens: 80 },
            }),
          );
        }
        // Attempt 2 receives jail violation feedback and writes clean src/math.ts
        expect(body.messages[1]?.content).toContain("contract_jail_blocked");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "Updated src/math.ts cleanly inside allowedGlobs",
                    edits: [
                      {
                        path: "src/math.ts",
                        content:
                          "export function add(a: number, b: number) { return a + b; }\n",
                      },
                    ],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 520, completion_tokens: 90 },
          }),
        );
      }),
    );

    const execCapture = makeIo(repo);
    const code = await run(
      [
        "next",
        "--exec",
        "--runner",
        "am-server",
        "--endpoint",
        "http://127.0.0.1:8080/v1/chat/completions",
        "--max-attempts",
        "2",
        "--json",
      ],
      execCapture.io,
    );
    expect(code).toBe(EXIT.ok);

    // Forbidden & out-of-scope files were NEVER created on disk
    expect(existsSync(join(repo, ".env.production"))).toBe(false);
    expect(existsSync(join(repo, "README.md"))).toBe(false);

    // Allowed file was updated and verified
    const mathContent = await readFile(join(repo, "src/math.ts"), "utf8");
    expect(mathContent).toContain("return a + b;");

    const jsonOut = JSON.parse(execCapture.stdout()) as {
      status: string;
      attempts: number;
      writtenFiles: string[];
      rejectedPaths: string[];
      inputTokens: number;
    };
    expect(jsonOut.status).toBe("passed");
    expect(jsonOut.attempts).toBe(2);
    expect(jsonOut.writtenFiles).toEqual(["src/math.ts"]);
    expect(jsonOut.rejectedPaths).toEqual([".env.production", "README.md"]);
    expect(jsonOut.inputTokens).toBe(920);

    // Verify `anvilmark ci-report --strict-gate` passes on the clean slice edit
    const ciPass = makeIo(repo);
    expect(await run(["ci-report", "--strict-gate"], ciPass.io)).toBe(EXIT.ok);
    expect(ciPass.stdout()).toContain("PASSED ✓");
    expect(ciPass.stdout()).toContain("`fix-add`");

    // Touching .env.secret causes `anvilmark ci-report --strict-gate` to fail with exit 1
    await writeFile(join(repo, ".env.secret"), "KEY=123\n", "utf8");
    const ciFail = makeIo(repo);
    expect(await run(["ci-report", "--strict-gate"], ciFail.io)).toBe(
      EXIT.failed,
    );
    expect(ciFail.stdout()).toContain("VIOLATIONS DETECTED ✗");
  });
});
