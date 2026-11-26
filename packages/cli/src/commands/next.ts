import { spawn } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { PlanHandoffBundle } from "./apply-plan.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  stringOption,
  writeJson,
} from "./common.js";
import { readSliceOutcomes } from "./outcomes.js";
import { sliceWaves } from "./slice-dag.js";
import { loadSlicePlan } from "./slice-storage.js";
import { sliceDigest } from "./slice-worktree.js";
import { verifySlice } from "./verify-slice.js";

export const NEXT_USAGE = `Usage:
  anvilmark next [--slice <id>] [--exec] [--runner auto|claude|codex|am-server] [--endpoint URL] [-C DIR] [--json]

Selects the next unblocked task slice from .anvilmark/development/active-plan.json
(whose prerequisites are accepted), writes .anvilmark/development/current-slice.md,
and prints or executes the slice with its routed coding model and deterministic
verification gate.

Options
  --slice ID         target a specific slice ID instead of the next ready slice
  --exec             invoke the routed local agent CLI (claude, codex, or am-server)
                     and automatically run anvilmark verify-slice afterwards
  --runner NAME      auto (default), claude, codex, or am-server
  --endpoint URL     OpenAI-compatible endpoint when runner is am-server
  -C, --project-dir  repository root (default: current directory)
  --json             emit structured JSON output`;

export type RunnerKind = "claude" | "codex" | "am-server";

export function inferRunnerForModel(modelId: string): RunnerKind {
  const lower = modelId.toLowerCase();
  if (/claude|anthropic|opus|sonnet|haiku/.test(lower)) return "claude";
  if (/gpt-|openai|codex|astra|\bsol\b|luna|\bo[134]\b/.test(lower)) {
    return "codex";
  }
  return "am-server";
}

export function renderExecutableSliceBrief(
  bundle: PlanHandoffBundle,
  sliceId: string,
): string {
  const idx = bundle.plan.tasks.findIndex((t) => t.id === sliceId);
  const task = bundle.plan.tasks[idx];
  if (!task) throw new Error(`Unknown slice "${sliceId}"`);

  const contract = task.contract;
  const lines: string[] = [
    `# Slice ${String(idx + 1).padStart(2, "0")} of ${bundle.plan.tasks.length}: ${task.title} (\`${task.id}\`)`,
    `**Plan:** ${bundle.plan.title} — ${bundle.plan.goal}`,
    `**Routed coding model:** \`${task.model}\` (${task.why})`,
    task.dependsOn.length > 0
      ? `**Completed prerequisites:** ${task.dependsOn.join(", ")}`
      : `**Prerequisites:** None (entry slice)`,
    "",
    `## Slice Objective`,
    task.outcome,
    "",
    `## Acceptance Criteria`,
    ...task.acceptance.map((a) => `- ${a}`),
    "",
    `## Required Checks`,
    ...task.checks.map((c) => `- ${c}`),
  ];

  if (contract) {
    lines.push(
      "",
      `## Enforced Slice Contract (\`anvilmark verify-slice --slice ${task.id}\`)`,
      `- **Allowed scope globs:** ${contract.allowedGlobs.length > 0 ? contract.allowedGlobs.join(", ") : "unrestricted"}`,
      `- **Forbidden globs:** ${contract.forbiddenGlobs.length > 0 ? contract.forbiddenGlobs.join(", ") : "none"}`,
      `- **Package dependency changes:** ${contract.allowDependencyChanges ? "allowed" : "DISALLOWED"}`,
      contract.verificationCommands.length > 0
        ? `- **Executable check commands:** ${contract.verificationCommands.join(" && ")}`
        : "",
      contract.reviewerFamily
        ? `- **Cross-vendor reviewer family:** ${contract.reviewerFamily}`
        : "",
    );
  }

  lines.push(
    "",
    `Implement ONLY this slice cleanly without scope creep, run its checks, and ensure \`anvilmark verify-slice --slice ${task.id}\` passes with zero violations.`,
  );

  return lines.filter((l) => l !== "").join("\n") + "\n";
}

async function runCliAgentSubprocess(
  runner: "claude" | "codex",
  cwd: string,
  promptText: string,
  modelId: string,
): Promise<{ exitCode: number; summary: string }> {
  const args =
    runner === "claude"
      ? ["-p", promptText, "--model", modelId]
      : ["exec", "--model", modelId, promptText];

  return new Promise((resolve) => {
    const child = spawn(runner, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let output = "";
    const append = (chunk: Buffer) => {
      if (output.length < 32_000) {
        output += chunk.toString("utf8");
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (err) => {
      resolve({
        exitCode: 127,
        summary: `Could not launch "${runner}" CLI (${err.message}). Ensure "${runner}" is installed on PATH.`,
      });
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        summary: output.trim().slice(-2000),
      });
    });
  });
}

async function queryAmServerGuidance(
  endpoint: string,
  modelId: string,
  promptText: string,
): Promise<{ exitCode: number; summary: string }> {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: "system",
            content:
              "You are an implementation coding assistant. Provide concise patch steps and exact file changes for this AnvilMark slice.",
          },
          { role: "user", content: promptText },
        ],
        max_tokens: 2400,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!resp.ok) {
      return {
        exitCode: 1,
        summary: `am-server returned HTTP ${resp.status} at ${endpoint}`,
      };
    }
    const payload = (await resp.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    return {
      exitCode: 0,
      summary: typeof content === "string" ? content.trim().slice(0, 4000) : "",
    };
  } catch (err) {
    return {
      exitCode: 1,
      summary: `Could not reach am-server at ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function selectNextSlice(
  directory: string,
  explicitSliceId?: string,
) {
  const root = await realpath(directory);
  const bundle = await loadSlicePlan(root);
  if (!bundle) {
    return { root, status: "no_active_plan" as const };
  }

  const planSha = sliceDigest(JSON.stringify(bundle));
  const outcomes = await readSliceOutcomes(root).catch(() => []);
  const acceptedIds = new Set(
    outcomes
      .filter(
        (r) =>
          r.status === "accepted" &&
          (r.plan_sha256 === undefined || r.plan_sha256 === planSha),
      )
      .map((r) => r.slice_id),
  );

  const waves = sliceWaves(bundle.plan.tasks);
  const taskById = new Map(bundle.plan.tasks.map((t) => [t.id, t]));
  const orderedTasks = waves
    .flat()
    .map((id) => taskById.get(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);

  if (explicitSliceId) {
    const task = bundle.plan.tasks.find((t) => t.id === explicitSliceId);
    if (!task) {
      throw new Error(`Slice "${explicitSliceId}" not found in active plan.`);
    }
    return {
      root,
      status: "ready" as const,
      bundle,
      task,
      acceptedCount: acceptedIds.size,
      totalSlices: bundle.plan.tasks.length,
    };
  }

  const readyTask = orderedTasks.find(
    (t) =>
      !acceptedIds.has(t.id) &&
      t.dependsOn.every((dep) => acceptedIds.has(dep)),
  );

  if (!readyTask) {
    if (acceptedIds.size >= bundle.plan.tasks.length) {
      return {
        root,
        status: "all_accepted" as const,
        bundle,
        acceptedCount: acceptedIds.size,
        totalSlices: bundle.plan.tasks.length,
      };
    }
    return {
      root,
      status: "blocked" as const,
      bundle,
      acceptedCount: acceptedIds.size,
      totalSlices: bundle.plan.tasks.length,
    };
  }

  return {
    root,
    status: "ready" as const,
    bundle,
    task: readyTask,
    acceptedCount: acceptedIds.size,
    totalSlices: bundle.plan.tasks.length,
  };
}

export async function nextCommand(context: CommandContext): Promise<ExitCode> {
  const { io } = context;
  const parsed = parse(
    context.args,
    {
      slice: { type: "string" },
      exec: { type: "boolean" },
      runner: { type: "string" },
      endpoint: { type: "string" },
    },
    NEXT_USAGE,
  );

  if (flag(parsed, "help")) {
    io.stdout(`${NEXT_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected argument "${parsed.positionals[0]}"`,
      NEXT_USAGE,
    );
  }

  const root = projectDirectory(io, parsed);
  const explicitSlice = stringOption(parsed, "slice");
  const runnerOpt = (stringOption(parsed, "runner") ?? "auto").toLowerCase();
  if (!["auto", "claude", "codex", "am-server"].includes(runnerOpt)) {
    throw new UsageError(
      `--runner must be auto, claude, codex, or am-server, got "${runnerOpt}"`,
      NEXT_USAGE,
    );
  }

  const selection = await selectNextSlice(root, explicitSlice);

  if (selection.status === "no_active_plan") {
    if (flag(parsed, "json")) {
      writeJson(io, { status: "no_active_plan", project_dir: root });
    } else {
      io.stderr(
        "No active plan in .anvilmark/development/active-plan.json. Run /anvilmark-plan in your agent or `anvilmark apply-plan` first.\n",
      );
    }
    return EXIT.failed;
  }

  if (selection.status === "all_accepted") {
    if (flag(parsed, "json")) {
      writeJson(io, {
        status: "all_accepted",
        planTitle: selection.bundle.plan.title,
        acceptedCount: selection.acceptedCount,
        totalSlices: selection.totalSlices,
      });
    } else {
      io.stdout(
        `All ${selection.totalSlices} slices in "${selection.bundle.plan.title}" are accepted ✓\n`,
      );
    }
    return EXIT.ok;
  }

  if (selection.status === "blocked") {
    if (flag(parsed, "json")) {
      writeJson(io, {
        status: "blocked",
        planTitle: selection.bundle.plan.title,
        acceptedCount: selection.acceptedCount,
        totalSlices: selection.totalSlices,
      });
    } else {
      io.stderr(
        `Remaining slices in "${selection.bundle.plan.title}" have unaccepted prerequisites.\n`,
      );
    }
    return EXIT.failed;
  }

  const { bundle, task } = selection;
  const brief = renderExecutableSliceBrief(bundle, task.id);
  const currentSlicePath = join(
    selection.root,
    ".anvilmark",
    "development",
    "current-slice.md",
  );
  await mkdir(join(selection.root, ".anvilmark", "development"), {
    recursive: true,
  });
  await writeFile(currentSlicePath, brief, "utf8");

  const resolvedRunner: RunnerKind =
    runnerOpt === "auto"
      ? inferRunnerForModel(task.model)
      : (runnerOpt as RunnerKind);

  if (!flag(parsed, "exec")) {
    const payload = {
      status: "ready",
      planTitle: bundle.plan.title,
      sliceId: task.id,
      title: task.title,
      routedModel: task.model,
      recommendedRunner: resolvedRunner,
      reviewerFamily: task.contract?.reviewerFamily ?? null,
      contract: task.contract ?? null,
      promptFile: ".anvilmark/development/current-slice.md",
    };

    if (flag(parsed, "json")) {
      writeJson(io, payload);
      return EXIT.ok;
    }

    io.stdout(
      [
        `Next Ready Slice: ${task.title} (${task.id})`,
        `  Plan:             ${bundle.plan.title} (${selection.acceptedCount}/${selection.totalSlices} accepted)`,
        `  Routed Model:     ${task.model} (runner: ${resolvedRunner})`,
        task.contract?.reviewerFamily
          ? `  Adversarial Rev:  ${task.contract.reviewerFamily} (cross-vendor)`
          : "",
        `  Allowed Globs:    ${task.contract?.allowedGlobs.length ? task.contract.allowedGlobs.join(", ") : "unrestricted"}`,
        `  Prompt Saved:     .anvilmark/development/current-slice.md`,
        "",
        "Run or verify:",
        `  • Auto-dispatch:  anvilmark next --slice ${task.id} --exec`,
        `  • In Claude/Codex/Antigravity: /anvilmark-next ${task.id}`,
        `  • Verify changes: anvilmark verify-slice --slice ${task.id}`,
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );
    return EXIT.ok;
  }

  // --exec mode: dispatch to resolved runner and verify conformance immediately
  const endpoint =
    stringOption(parsed, "endpoint") ??
    process.env.ANVILMARK_PLANNER_ENDPOINT?.trim() ??
    "http://am-server:8080/v1/chat/completions";

  const execResult =
    resolvedRunner === "am-server"
      ? await queryAmServerGuidance(endpoint, task.model, brief)
      : await runCliAgentSubprocess(
          resolvedRunner,
          selection.root,
          brief,
          task.model,
        );

  const report = await verifySlice({
    root: selection.root,
    bundle,
    sliceId: task.id,
    runChecks: false,
    clock: io.clock,
  });

  if (flag(parsed, "json")) {
    writeJson(io, {
      status: execResult.exitCode === 0 && report.passed ? "passed" : "failed",
      sliceId: task.id,
      runner: resolvedRunner,
      runnerExitCode: execResult.exitCode,
      runnerSummary: execResult.summary,
      verification: report,
    });
  } else {
    io.stdout(
      [
        `Executed slice "${task.id}" via ${resolvedRunner} (exit ${execResult.exitCode})`,
        execResult.summary ? `\n${execResult.summary}\n` : "",
        `Verification: ${report.passed ? "PASSED ✓" : `FAILED (${report.violations.length} violation(s))`}`,
        ...report.violations.map(
          (v) => `  - [${v.kind}] ${v.path ? `${v.path}: ` : ""}${v.detail}`,
        ),
      ]
        .filter(Boolean)
        .join("\n") + "\n",
    );
  }

  return execResult.exitCode === 0 && report.passed ? EXIT.ok : EXIT.failed;
}
