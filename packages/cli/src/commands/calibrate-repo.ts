import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { EXIT, type ExitCode } from "../io.js";
import {
  PLAN_HANDOFF_VERSION,
  type PlanHandoffBundle,
  type SliceContractSpec,
} from "./apply-plan.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  stringOption,
  writeJson,
} from "./common.js";
import { exportRepoContext, isSensitivePath } from "./export-context.js";
import { runAmServerSliceAgent } from "./local-agent-runner.js";
import {
  aggregateOutcomes,
  appendSliceOutcome,
  inferDominantPathPrefix,
  inferOutcomeCategoryFromPaths,
  type OutcomeTaskCategory,
} from "./outcomes.js";
import { writeRepoJson } from "./slice-storage.js";
import { sliceDigest } from "./slice-worktree.js";
import { runSliceGit, sliceGitRoot } from "./verify-slice.js";

export const CALIBRATE_REPO_USAGE = `Usage:
  anvilmark calibrate-repo [--models m1,m2] [--endpoint URL] [--limit N] [--no-checks] [--dry-run] [-C DIR] [--json]

Back-tests candidate coding models against real, self-contained historical commits
from this repository inside isolated temporary Git worktrees (never mutating your
working tree), scores verification pass/fail and line-level rework against how the
commit was actually implemented, and updates .anvilmark/development/outcomes-summary.json.

Options
  --models LIST       Comma-separated model IDs to evaluate (default: qwen3-coder-30b-a3b,qwen3.5-9b)
  --endpoint URL      OpenAI-compatible /v1/chat/completions endpoint (or ANVILMARK_PLANNER_ENDPOINT)
  --limit N           Maximum historical commits to replay (default: 4, max: 15)
  --no-checks         Verify contract scope & diff rework without executing test commands
  --dry-run           Mine and display candidate historical commits without running models
  -C, --project-dir   Target Git repository root (default: current directory)
  --json              Emit structured JSON summary`;

const OUTCOMES_SUMMARY_PATH = ".anvilmark/development/outcomes-summary.json";

const LOCKFILE_NAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
]);

export interface MinedCalibrationCommit {
  commitSha: string;
  parentSha: string;
  committedAt: string;
  subject: string;
  changedFiles: string[];
  taskCategory: OutcomeTaskCategory;
  pathPrefix?: string | undefined;
  allowDependencyChanges: boolean;
}

export interface CalibrationTrialResult {
  commitSha: string;
  subject: string;
  model: string;
  taskCategory: OutcomeTaskCategory;
  pathPrefix?: string | undefined;
  passed: boolean;
  attempts: number;
  reworkRatio: number;
  inputTokens: number;
  outputTokens: number;
  recordedOutcomeId?: string | undefined;
}

export async function mineHistoricalCalibrationCommits(
  root: string,
  limit = 4,
): Promise<MinedCalibrationCommit[]> {
  const cappedLimit = Math.max(1, Math.min(15, limit));
  const rawLog = await runSliceGit(root, [
    "log",
    "--no-merges",
    "--max-count=60",
    "--format=%H%x00%P%x00%cI%x00%s",
  ]).catch(() => "");

  if (!rawLog.trim()) return [];

  const mined: MinedCalibrationCommit[] = [];
  const lines = rawLog.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    if (mined.length >= cappedLimit) break;
    const [commitSha, parentsRaw, committedAt, subject] = line.split("\0");
    if (!commitSha || !parentsRaw || !committedAt || !subject) continue;
    const parentSha = parentsRaw.trim().split(/\s+/)[0];
    if (!parentSha || !/^[a-f0-9]{40,64}$/.test(parentSha)) continue;

    // Skip trivial version bumps or merge-like commits
    if (/^(chore\(release\)|release:|bump version|wip\b)/i.test(subject.trim())) {
      continue;
    }

    const diffNamesRaw = await runSliceGit(root, [
      "diff",
      "--name-only",
      "--diff-filter=AMR",
      "--no-renames",
      "-z",
      parentSha,
      commitSha,
    ]).catch(() => "");

    const files = diffNamesRaw
      .split("\0")
      .map((f) => f.trim())
      .filter(Boolean);

    if (files.length === 0 || files.length > 6) continue;
    if (
      files.some(
        (f) =>
          isSensitivePath(f) ||
          f.startsWith(".anvilmark/") ||
          f.startsWith(".git/") ||
          /\.(png|jpg|jpeg|webp|gif|ico|woff2?|ttf|pdf|sqlite|db|pack)$/i.test(f),
      )
    ) {
      continue;
    }

    const nonLockFiles = files.filter((f) => !LOCKFILE_NAMES.has(basename(f)));
    if (nonLockFiles.length === 0) continue;

    const allowDeps = nonLockFiles.some((f) => basename(f) === "package.json");
    const taskCategory = inferOutcomeCategoryFromPaths(nonLockFiles, subject);
    const pathPrefix = inferDominantPathPrefix(nonLockFiles);

    mined.push({
      commitSha,
      parentSha,
      committedAt,
      subject: subject.trim().slice(0, 240),
      changedFiles: nonLockFiles,
      taskCategory,
      ...(pathPrefix ? { pathPrefix } : {}),
      allowDependencyChanges: allowDeps,
    });
  }

  return mined;
}

function normalizeSignificantLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && l !== "{" && l !== "}");
}

/**
 * Computes an objective [0, 1] rework ratio between the model's generated files
 * and the actual human commit's target files (`0` = identical significant lines,
 * `1` = completely disjoint).
 */
export function computeLineReworkRatio(
  generatedByPath: ReadonlyMap<string, string>,
  groundTruthByPath: ReadonlyMap<string, string>,
): number {
  if (groundTruthByPath.size === 0) return 0;

  let totalScore = 0;
  let fileCount = 0;

  for (const [path, truthText] of groundTruthByPath.entries()) {
    fileCount += 1;
    const genText = generatedByPath.get(path);
    if (genText === undefined) {
      totalScore += 1;
      continue;
    }
    const truthLines = normalizeSignificantLines(truthText);
    const genLines = normalizeSignificantLines(genText);
    if (truthLines.length === 0 && genLines.length === 0) {
      totalScore += 0;
      continue;
    }
    const truthCounts = new Map<string, number>();
    for (const l of truthLines) {
      truthCounts.set(l, (truthCounts.get(l) ?? 0) + 1);
    }
    let overlap = 0;
    for (const l of genLines) {
      const rem = truthCounts.get(l) ?? 0;
      if (rem > 0) {
        overlap += 1;
        truthCounts.set(l, rem - 1);
      }
    }
    const union = truthLines.length + genLines.length - overlap;
    const jaccard = union > 0 ? overlap / union : 1;
    totalScore += 1 - jaccard;
  }

  return Number(
    Math.min(1, Math.max(0, totalScore / Math.max(1, fileCount))).toFixed(4),
  );
}

function buildCalibrationBundle(params: {
  commit: MinedCalibrationCommit;
  model: string;
  checkCommands: readonly string[];
  runChecks: boolean;
  now: string;
}): { sliceId: string; bundle: PlanHandoffBundle; brief: string } {
  const { commit, model, checkCommands, runChecks, now } = params;
  const sliceId = `cal-${commit.commitSha.slice(0, 10)}`;
  const contract: SliceContractSpec = {
    allowedGlobs: commit.changedFiles,
    forbiddenGlobs: [".env", ".env.*", "**/*.pem", "**/*.key"],
    verificationCommands: runChecks ? checkCommands.slice(0, 4) : [],
    allowDependencyChanges: commit.allowDependencyChanges,
    expectedBoundaries: [],
  };

  const brief = [
    `# Repository Calibration Slice (${commit.commitSha.slice(0, 8)})`,
    `Objective: ${commit.subject}`,
    `Target files in scope: ${commit.changedFiles.map((f) => `\`${f}\``).join(", ")}`,
    `Implement this change cleanly following existing repository types, imports, and conventions in the scoped files.`,
  ].join("\n\n");

  const bundle: PlanHandoffBundle = {
    version: PLAN_HANDOFF_VERSION,
    createdAt: now,
    strict: false,
    candidates: [
      {
        model,
        label: model,
        provider: "calibration",
        tier: "balanced",
        billing: "local",
      },
    ],
    masterPrompt: brief,
    plan: {
      title: `Calibration: ${commit.subject.slice(0, 80)}`,
      goal: commit.subject,
      users: "Repository maintainers",
      scope: commit.changedFiles,
      nonGoals: [],
      assumptions: [],
      questions: [],
      architecture: [
        {
          title: "Match repository conventions",
          decision: "Modify only scoped files cleanly.",
          why: "Historical commit replay.",
          alternative: "Broad refactor",
          tradeoff: "Bounded scope.",
        },
      ],
      flows: [],
      tasks: [
        {
          id: sliceId,
          title: commit.subject.slice(0, 120),
          outcome: commit.subject,
          dependsOn: [],
          acceptance: ["Scoped files compile and pass checks."],
          checks:
            contract.verificationCommands.length > 0
              ? contract.verificationCommands
              : ["Verify file scope"],
          model,
          why: "Empirical repository calibration trial.",
          alternatives: [],
          inputTokens: 8000,
          outputTokens: 2000,
          estimateBasis: "Historical commit replay.",
          contract,
        },
      ],
      security: [],
    },
  };

  return { sliceId, bundle, brief };
}

async function loadGroundTruthFiles(
  root: string,
  commitSha: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const relPath of paths) {
    const text = await runSliceGit(root, [
      "show",
      `${commitSha}:${relPath}`,
    ]).catch(() => null);
    if (typeof text === "string") {
      map.set(relPath, text);
    }
  }
  return map;
}

export async function runRepoCalibration(options: {
  root: string;
  models: readonly string[];
  endpoint?: string | undefined;
  limit?: number | undefined;
  runChecks?: boolean | undefined;
  dryRun?: boolean | undefined;
  clock?: () => string;
}): Promise<{
  repoName: string;
  dryRun: boolean;
  commits: MinedCalibrationCommit[];
  trials: CalibrationTrialResult[];
}> {
  const {
    models,
    endpoint,
    limit = 4,
    runChecks = true,
    dryRun = false,
    clock = () => new Date().toISOString(),
  } = options;

  const gitRoot = await sliceGitRoot(options.root);
  const now = clock();
  const [repoCtx, commits] = await Promise.all([
    exportRepoContext(gitRoot, { now }),
    mineHistoricalCalibrationCommits(gitRoot, limit),
  ]);

  if (dryRun || commits.length === 0) {
    return {
      repoName: repoCtx.repoName,
      dryRun: true,
      commits,
      trials: [],
    };
  }

  if (!endpoint) {
    throw new UsageError(
      "Provide --endpoint <url> or set ANVILMARK_PLANNER_ENDPOINT (or pass --dry-run to preview mined commits).",
      CALIBRATE_REPO_USAGE,
    );
  }

  const trials: CalibrationTrialResult[] = [];
  const approvedSet = new Set(repoCtx.checkCommands);

  for (const commit of commits) {
    const groundTruth = await loadGroundTruthFiles(
      gitRoot,
      commit.commitSha,
      commit.changedFiles,
    );

    for (const model of models) {
      const tempParent = await mkdtemp(join(tmpdir(), "anvilmark-cal-"));
      const worktreeDir = join(tempParent, "wt");
      try {
        await runSliceGit(gitRoot, [
          "worktree",
          "add",
          "--detach",
          worktreeDir,
          commit.parentSha,
        ]);

        const { sliceId, bundle, brief } = buildCalibrationBundle({
          commit,
          model,
          checkCommands: repoCtx.checkCommands,
          runChecks,
          now: clock(),
        });

        const runResult = await runAmServerSliceAgent({
          root: worktreeDir,
          bundle,
          sliceId,
          sliceBrief: brief,
          endpoint,
          model,
          runChecks: runChecks && repoCtx.checkCommands.length > 0,
          approvedCommands: approvedSet,
          maxAttempts: 2,
          clock,
        });

        const generatedMap = new Map<string, string>();
        for (const relPath of commit.changedFiles) {
          const text = await readFile(join(worktreeDir, relPath), "utf8").catch(
            () => null,
          );
          if (typeof text === "string") {
            generatedMap.set(relPath, text);
          }
        }

        const reworkRatio =
          runResult.writtenFiles.length > 0
            ? computeLineReworkRatio(generatedMap, groundTruth)
            : 1;

        const passedAndModified =
          runResult.passed && runResult.writtenFiles.length > 0;
        const planSha256 = sliceDigest(JSON.stringify(bundle));
        const outcomeRecord = await appendSliceOutcome(
          gitRoot,
          {
            slice_id: sliceId,
            status: passedAndModified ? "accepted" : "failed",
            configured_model: model,
            served_model: model,
            provider: "am-server",
            task_category: commit.taskCategory,
            ...(commit.pathPrefix ? { path_prefix: commit.pathPrefix } : {}),
            attempts: runResult.attempts,
            retries: Math.max(0, runResult.attempts - 1),
            input_tokens: runResult.inputTokens,
            output_tokens: runResult.outputTokens,
            rework_ratio: reworkRatio,
            verification_passed: passedAndModified,
            observed_usd: 0,
          },
          passedAndModified,
          clock(),
          {
            planSha256,
            verifiedAt: runResult.verification.verifiedAt,
          },
        );

        trials.push({
          commitSha: commit.commitSha,
          subject: commit.subject,
          model,
          taskCategory: commit.taskCategory,
          ...(commit.pathPrefix ? { pathPrefix: commit.pathPrefix } : {}),
          passed: passedAndModified,
          attempts: runResult.attempts,
          reworkRatio,
          inputTokens: runResult.inputTokens,
          outputTokens: runResult.outputTokens,
          recordedOutcomeId: outcomeRecord.id,
        });
      } finally {
        await runSliceGit(gitRoot, [
          "worktree",
          "remove",
          "--force",
          worktreeDir,
        ]).catch(() => {});
        await rm(tempParent, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  const summary = await aggregateOutcomes(gitRoot, clock());
  await writeRepoJson(await realpath(gitRoot), OUTCOMES_SUMMARY_PATH, summary);

  return {
    repoName: repoCtx.repoName,
    dryRun: false,
    commits,
    trials,
  };
}

export async function calibrateRepoCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const { args, io } = context;
  const parsed = parse(
    args,
    {
      models: { type: "string" },
      endpoint: { type: "string" },
      limit: { type: "string" },
      "no-checks": { type: "boolean" },
      "dry-run": { type: "boolean" },
    },
    CALIBRATE_REPO_USAGE,
  );

  if (flag(parsed, "help")) {
    io.stdout(`${CALIBRATE_REPO_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected argument "${parsed.positionals[0]}"`,
      CALIBRATE_REPO_USAGE,
    );
  }

  const root = projectDirectory(io, parsed);
  const rawModels =
    stringOption(parsed, "models") ?? "qwen3-coder-30b-a3b,qwen3.5-9b";
  const models = rawModels
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new UsageError(
      "--models must list at least one model ID",
      CALIBRATE_REPO_USAGE,
    );
  }

  const limitRaw = stringOption(parsed, "limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 4;
  if (!Number.isInteger(limit) || limit < 1 || limit > 15) {
    throw new UsageError(
      "--limit must be an integer between 1 and 15",
      CALIBRATE_REPO_USAGE,
    );
  }

  const endpoint =
    stringOption(parsed, "endpoint") ??
    process.env.ANVILMARK_PLANNER_ENDPOINT?.trim();
  const dryRun = flag(parsed, "dry-run");
  const runChecks = !flag(parsed, "no-checks");

  const result = await runRepoCalibration({
    root,
    models,
    endpoint,
    limit,
    runChecks,
    dryRun,
    clock: () => io.clock(),
  });

  if (flag(parsed, "json")) {
    writeJson(io, result);
    return EXIT.ok;
  }

  if (result.dryRun) {
    io.stdout(
      `Mined ${result.commits.length} calibration commit(s) in ${result.repoName} (dry-run):\n` +
        result.commits
          .map(
            (c) =>
              `  ${c.commitSha.slice(0, 8)} [${c.taskCategory}${c.pathPrefix ? ` · ${c.pathPrefix}` : ""}] ${c.subject} (${c.changedFiles.length} file(s))`,
          )
          .join("\n") +
        "\n",
    );
    return EXIT.ok;
  }

  const passedCount = result.trials.filter((t) => t.passed).length;
  io.stdout(
    `Completed ${result.trials.length} calibration trial(s) across ${result.commits.length} commit(s) in ${result.repoName} (${passedCount}/${result.trials.length} passed).\n` +
      result.trials
        .map(
          (t) =>
            `  ${t.commitSha.slice(0, 8)} · ${t.model} [${t.taskCategory}${t.pathPrefix ? ` · ${t.pathPrefix}` : ""}]: ${t.passed ? "PASS" : "FAIL"} (${Math.round(t.reworkRatio * 100)}% rework, ${t.attempts} attempt(s))`,
        )
        .join("\n") +
      "\n",
  );
  return EXIT.ok;
}
