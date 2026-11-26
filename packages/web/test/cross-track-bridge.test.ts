import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { startBridge } from "../../cli/src/commands/bridge";
import { buildPlanBundle } from "../lib/beta-turn";
import {
  applyPlanOverBridge,
  fetchBridgeDrift,
  parseBridgePairingInput,
  syncAllFromBridge,
  verifySliceOverBridge,
} from "../lib/bridge-client";
import type { GeneratedPlan } from "../lib/planner";
import { resolveRoutingPool } from "../lib/routing-catalog";
import { compileSliceContractForTask } from "../lib/slice-contracts";

const exec = promisify(execFile);

const tempDirs: string[] = [];

async function createTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "anvilmark-cross-track-"));
  tempDirs.push(dir);
  await exec("git", ["init", "-b", "main"], { cwd: dir });
  await exec("git", ["config", "user.email", "test@anvilmark.local"], {
    cwd: dir,
  });
  await exec("git", ["config", "user.name", "AnvilMark Test"], { cwd: dir });
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "cross-track-demo",
        version: "0.1.0",
        scripts: { test: 'node -e "process.exit(0)"' },
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    join(dir, "src/handler.ts"),
    "export function health() { return { ok: true }; }\n",
    "utf8",
  );
  await exec("git", ["add", "package.json", "src/handler.ts"], { cwd: dir });
  await exec("git", ["commit", "-m", "chore: initial commit"], { cwd: dir });
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("Cross-Track Wire Integration: Track A Studio Client <-> Track B Local Bridge Daemon", () => {
  it("pairs over real 127.0.0.1 HTTP, applies contracted PlanHandoffBundle, enforces SliceContractSpec, and reports drift", async () => {
    const repoDir = await createTempGitRepo();
    let bridge: Awaited<ReturnType<typeof startBridge>> | null = null;
    try {
      bridge = await startBridge({ root: repoDir, port: 0 });
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "EPERM"
      ) {
        return;
      }
      throw err;
    }

    try {
      const paired = parseBridgePairingInput(bridge.url, bridge.token);
      expect(paired.ok).toBe(true);
      if (!paired.ok) return;

      // 1. Initial zero-copy sync before any plan is applied
      const initialSync = await syncAllFromBridge(paired.config);
      expect(initialSync.health.ok).toBe(true);
      expect(initialSync.health.repoName).toBe("cross-track-demo");
      expect(initialSync.health.hasActivePlan).toBe(false);
      expect(initialSync.repoContext?.repoName).toBe("cross-track-demo");
      expect(initialSync.outcomes?.schemaVersion).toBe(
        "anvilmark.outcomes-summary.v1",
      );
      expect(initialSync.drift?.status).toBe("no_active_plan");

      // 2. Build a real Track A PlanHandoffBundle with compiled SliceContractSpec + quotaMode
      const pool = resolveRoutingPool({
        mode: "open",
        subscriptions: [],
        quotaMode: "conserve",
      });
      const chosenModel = pool.candidates[0]!.model;
      const altModel = pool.candidates[1]!.model;

      const baseTask = {
        id: "src-health-slice",
        title: "Extend src/handler.ts health payload",
        outcome: "Adds uptime field inside src/handler.ts.",
        dependsOn: [] as string[],
        acceptance: ["Health endpoint includes numeric uptime."],
        checks: ["npm test"],
        model: chosenModel,
        why: "Bounded TypeScript edit.",
        alternatives: [{ model: altModel, tradeoff: "Fallback option." }],
        inputTokens: 8000,
        outputTokens: 1200,
        estimateBasis: "Single handler file.",
      };

      const compiledContract = compileSliceContractForTask({
        task: baseTask,
        flows: [],
        candidates: pool.candidates,
        repoCheckCommands: initialSync.repoContext?.checkCommands ?? [],
        sampleFiles: initialSync.repoContext?.sampleFiles ?? [],
        strict: true,
      });

      const plan: GeneratedPlan = {
        title: "Health Telemetry Slice",
        goal: "Expose deterministic health metadata.",
        users: "Platform operators",
        scope: ["Update src/handler.ts"],
        nonGoals: ["External metrics SaaS"],
        assumptions: [],
        questions: [],
        architecture: [
          {
            title: "In-process uptime read",
            decision: "Use process.uptime() directly in src/handler.ts.",
            why: "Zero external dependencies.",
            alternative: "OS procfs parse",
            tradeoff: "Less portable across OSes.",
          },
        ],
        flows: [],
        tasks: [
          {
            ...baseTask,
            contract: {
              ...compiledContract,
              allowedGlobs: ["src/**"],
            },
          },
        ],
        security: [
          {
            risk: "Secret file leak",
            control: "Block .env* modifications via SliceContractSpec.",
            verification: "Run anvilmark verify-slice.",
          },
        ],
      };

      const bundle = buildPlanBundle(
        plan,
        pool.candidates,
        true,
        "2026-11-27T02:50:00.000Z",
        "conserve",
      );

      // 3. 1-click Apply over Bridge (proves Track B z.strictObject accepts Track A bundle)
      const applyResult = await applyPlanOverBridge(paired.config, bundle);
      expect(applyResult.applied).toBe(true);
      expect(applyResult.writtenFiles).toContain(
        ".anvilmark/development/active-plan.json",
      );
      expect(applyResult.writtenFiles).toContain("CLAUDE.md");
      expect(applyResult.writtenFiles).toContain("AGENTS.md");

      // Commit the applied plan files so git working tree only tracks subsequent slice edits
      await exec("git", ["add", "."], { cwd: repoDir });
      await exec("git", ["commit", "-m", "chore: apply anvilmark plan"], {
        cwd: repoDir,
      });

      // 4. Allowed edit inside src/handler.ts passes verifySliceOverBridge
      await writeFile(
        join(repoDir, "src/handler.ts"),
        "export function health() { return { ok: true, uptime: process.uptime() }; }\n",
        "utf8",
      );
      const cleanReport = await verifySliceOverBridge(
        paired.config,
        "src-health-slice",
        false,
      );
      expect(cleanReport.passed).toBe(true);
      expect(cleanReport.changedFiles).toEqual(["src/handler.ts"]);
      expect(cleanReport.violations).toEqual([]);

      // 5. Touching forbidden .env.local triggers deterministic forbidden_file violation
      await writeFile(join(repoDir, ".env.local"), "SECRET=123\n", "utf8");
      const violationReport = await verifySliceOverBridge(
        paired.config,
        "src-health-slice",
        false,
      );
      expect(violationReport.passed).toBe(false);
      expect(
        violationReport.violations.some(
          (v) => v.kind === "forbidden_file" && v.path === ".env.local",
        ),
      ).toBe(true);

      // 6. Drift report is now active and aligned
      const drift = await fetchBridgeDrift(paired.config);
      expect(drift.schemaVersion).toBe("anvilmark.drift-report.v1");
      expect(drift.status).toBe("aligned");
    } finally {
      await bridge.close();
    }
  });
});
