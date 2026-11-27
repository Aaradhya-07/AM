import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { run } from "../src/cli.js";
import {
  computeLineReworkRatio,
  mineHistoricalCalibrationCommits,
  runRepoCalibration,
} from "../src/commands/calibrate-repo.js";
import {
  aggregateOutcomes,
  syncGitAttributedOutcomes,
} from "../src/commands/outcomes.js";
import { cleanup, scriptedIo, tempDir } from "./helpers.js";

afterEach(cleanup);

function git(cwd: string, args: string[]) {
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Dev",
      GIT_AUTHOR_EMAIL: "dev@example.com",
      GIT_COMMITTER_NAME: "Test Dev",
      GIT_COMMITTER_EMAIL: "dev@example.com",
    },
    stdio: "ignore",
  });
}

async function createSampleGitRepo(): Promise<string> {
  const dir = await tempDir("anvilmark-cal-repo-");
  const root = join(dir, "sample-repo");
  await mkdir(join(root, "packages/cli"), { recursive: true });
  await mkdir(join(root, "packages/web"), { recursive: true });

  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "sample-monorepo", private: true }, null, 2) + "\n",
  );
  await writeFile(
    join(root, "packages/cli/parser.ts"),
    "export function parseCount(raw: string): number {\n  return Number(raw);\n}\n",
  );
  await writeFile(
    join(root, "packages/web/Card.tsx"),
    "export function Card() {\n  return <div>Hello</div>;\n}\n",
  );

  git(root, ["init", "-q"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "Initial scaffold"]);

  // Historical commit 1: CLI backend improvement
  await writeFile(
    join(root, "packages/cli/parser.ts"),
    "export function parseCount(raw: string): number {\n  const n = Number.parseInt(raw.trim(), 10);\n  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid count');\n  return n;\n}\n",
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "Validate non-negative integer in CLI parser"]);

  // Historical commit 2: Git-attributed frontend commit followed by small human tweak
  await writeFile(
    join(root, "packages/web/Card.tsx"),
    "export function Card({ title }: { title: string }) {\n  return <section className=\"card\"><h3>{title}</h3></section>;\n}\n",
  );
  git(root, ["add", "."]);
  git(root, [
    "commit",
    "-q",
    "-m",
    "Render Card title prop\n\nAnvilMark-Model: claude-sonnet-5-5",
  ]);

  return root;
}

describe("anvilmark calibrate-repo & git-attributed outcome sync", () => {
  it("mines historical commits cleanly in --dry-run mode and computes line rework ratios", async () => {
    const root = await createSampleGitRepo();
    const mined = await mineHistoricalCalibrationCommits(root, 5);
    expect(mined.length).toBeGreaterThanOrEqual(2);
    expect(mined.some((c) => c.pathPrefix === "packages/cli")).toBe(true);
    expect(mined.some((c) => c.pathPrefix === "packages/web")).toBe(true);

    const exact = computeLineReworkRatio(
      new Map([["a.ts", "const x = 1;\nreturn x;"]]),
      new Map([["a.ts", "const x = 1;\nreturn x;"]]),
    );
    expect(exact).toBe(0);

    const io = scriptedIo({ cwd: root });
    const code = await run(["calibrate-repo", "--dry-run", "--json"], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out());
    expect(parsed.dryRun).toBe(true);
    expect(parsed.commits.length).toBeGreaterThanOrEqual(2);
  });

  it("replays historical commits in isolated temporary worktrees against an am-server endpoint without dirtying HEAD", async () => {
    const root = await createSampleGitRepo();

    // Stand up a local loopback mock OpenAI-compatible am-server
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        messages: Array<{ content: string }>;
      };
      const promptText = body.messages.map((m) => m.content).join("\n");
      const touchesCli = promptText.includes("packages/cli/parser.ts");

      // Simulate `qwen3-coder-30b-a3b` succeeding cleanly and `weak-model` violating scope
      const edits =
        body.model === "qwen3-coder-30b-a3b"
          ? [
              {
                path: touchesCli
                  ? "packages/cli/parser.ts"
                  : "packages/web/Card.tsx",
                content: touchesCli
                  ? "export function parseCount(raw: string): number {\n  const n = Number.parseInt(raw.trim(), 10);\n  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid count');\n  return n;\n}\n"
                  : "export function Card({ title }: { title: string }) {\n  return <section className=\"card\"><h3>{title}</h3></section>;\n}\n",
              },
            ]
          : [{ path: ".env.secret", content: "LEAK=1" }];

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Applied calibration edit",
                  edits,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 900, completion_tokens: 180 },
        }),
      );
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    try {
      const cal = await runRepoCalibration({
        root,
        models: ["qwen3-coder-30b-a3b", "weak-model"],
        endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
        limit: 2,
        runChecks: false,
        clock: () => "2026-11-27T23:30:00.000Z",
      });

      expect(cal.dryRun).toBe(false);
      expect(cal.trials).toHaveLength(4);

      const qwenTrials = cal.trials.filter(
        (t) => t.model === "qwen3-coder-30b-a3b",
      );
      const weakTrials = cal.trials.filter((t) => t.model === "weak-model");
      expect(qwenTrials.every((t) => t.passed && t.reworkRatio === 0)).toBe(
        true,
      );
      expect(weakTrials.every((t) => !t.passed)).toBe(true);

      // Verify outcomes-summary.json was written with package pathPrefix specialization
      const summaryRaw = JSON.parse(
        await readFile(
          join(root, ".anvilmark/development/outcomes-summary.json"),
          "utf8",
        ),
      );
      expect(
        summaryRaw.models.some(
          (m: { model: string; pathPrefix?: string }) =>
            m.model === "qwen3-coder-30b-a3b" && m.pathPrefix === "packages/cli",
        ),
      ).toBe(true);

      // Verify git-attributed trailer sync is idempotent
      const syncedFirst = await syncGitAttributedOutcomes(
        root,
        "2026-11-27T23:35:00.000Z",
      );
      const syncedSecond = await syncGitAttributedOutcomes(
        root,
        "2026-11-27T23:36:00.000Z",
      );
      expect(syncedFirst).toBe(1);
      expect(syncedSecond).toBe(0);

      const postSync = await aggregateOutcomes(
        root,
        "2026-11-27T23:37:00.000Z",
      );
      expect(
        postSync.models.some(
          (m) =>
            m.model === "claude-sonnet-5-5" && m.pathPrefix === "packages/web",
        ),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
