import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import { flag, parse, projectDirectory, writeJson } from "./common.js";
import { measureDrift } from "./drift.js";
import { exportRepoContext } from "./export-context.js";
import { inspectHookStatus } from "./hooks.js";
import { aggregateOutcomes, readSliceOutcomes } from "./outcomes.js";
import { sliceWaves } from "./slice-dag.js";
import { loadSlicePlan } from "./slice-storage.js";
import { sliceDigest } from "./slice-worktree.js";

export const COCKPIT_USAGE = `Usage:
  anvilmark [cockpit] [-C DIR] [--json]

Displays the local ANVILMARK Mission Control dashboard for this repository:
connected coding agents & IDEs, active guardrails, active plan slice DAG,
routed coding models, trust-boundary drift status, and observed model win-rates.`;

async function existsFile(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

export async function collectCockpitSnapshot(directory: string, now: string) {
  let root = directory;
  try {
    root = realpathSync(directory);
  } catch {
    // Keep provided directory if realpath fails before existence check.
  }

  const [
    repo,
    bundle,
    rawOutcomes,
    outcomesSummary,
    drift,
    hooks,
    hasClaudeMcp,
    hasCodexToml,
    hasCursorMcp,
    hasVsCodeMcp,
    hasAgySkill,
  ] = await Promise.all([
    exportRepoContext(root, { now }).catch(() => null),
    loadSlicePlan(root).catch(() => null),
    readSliceOutcomes(root).catch(() => []),
    aggregateOutcomes(root, now).catch(() => null),
    measureDrift(root, now).catch(() => null),
    inspectHookStatus(root).catch(() => ({
      gitPreCommitInstalled: false,
      claudeStopHookInstalled: false,
    })),
    existsFile(join(root, ".mcp.json")),
    existsFile(join(root, ".codex/config.toml")),
    existsFile(join(root, ".cursor/mcp.json")),
    existsFile(join(root, ".vscode/mcp.json")),
    existsFile(join(root, ".agent/skills/anvilmark/SKILL.md")),
  ]);

  const connections = {
    claude: hasClaudeMcp,
    codex: hasCodexToml,
    cursor: hasCursorMcp,
    vscode: hasVsCodeMcp,
    antigravity: hasAgySkill,
  };

  if (!bundle) {
    return {
      projectDir: root,
      repoName: repo?.repoName ?? root.split("/").pop() ?? "repository",
      languages: repo?.languages ?? [],
      frameworks: repo?.frameworks ?? [],
      totalTrackedFiles: repo?.totalTrackedFiles ?? 0,
      connections,
      hooks,
      activePlan: null,
      driftStatus: drift?.status ?? "no_active_plan",
      driftFindingsCount: drift?.items.length ?? 0,
      outcomes: outcomesSummary,
    };
  }

  const planSha = sliceDigest(JSON.stringify(bundle));
  const bySlice = new Map(
    rawOutcomes
      .filter((r) => r.plan_sha256 === undefined || r.plan_sha256 === planSha)
      .map((r) => [r.slice_id, r]),
  );
  const acceptedIds = new Set(
    [...bySlice.values()]
      .filter((r) => r.status === "accepted")
      .map((r) => r.slice_id),
  );

  let waveBySlice = new Map<string, number>();
  try {
    const waves = sliceWaves(bundle.plan.tasks);
    waves.forEach((wave, waveIdx) => {
      for (const sliceId of wave) {
        waveBySlice.set(sliceId, waveIdx + 1);
      }
    });
  } catch {
    waveBySlice = new Map();
  }

  const slices = bundle.plan.tasks.map((task, idx) => {
    const outcome = bySlice.get(task.id);
    const isAccepted = acceptedIds.has(task.id);
    const isReady =
      !isAccepted && task.dependsOn.every((dep) => acceptedIds.has(dep));
    const state = isAccepted
      ? "accepted"
      : outcome?.status === "failed" || outcome?.status === "rejected"
        ? outcome.status
        : isReady
          ? "ready"
          : "blocked";

    return {
      index: idx + 1,
      wave: waveBySlice.get(task.id) ?? 1,
      id: task.id,
      title: task.title,
      model: task.model,
      reviewerFamily: task.contract?.reviewerFamily ?? null,
      state,
    };
  });

  const nextReady = slices.find((s) => s.state === "ready") ?? null;

  return {
    projectDir: root,
    repoName: repo?.repoName ?? root.split("/").pop() ?? "repository",
    languages: repo?.languages ?? [],
    frameworks: repo?.frameworks ?? [],
    totalTrackedFiles: repo?.totalTrackedFiles ?? 0,
    connections,
    hooks,
    activePlan: {
      title: bundle.plan.title,
      goal: bundle.plan.goal,
      strict: bundle.strict,
      quotaMode: bundle.quotaMode ?? "plenty",
      acceptedCount: acceptedIds.size,
      totalSlices: slices.length,
      nextReadySliceId: nextReady?.id ?? null,
      slices,
    },
    driftStatus: drift?.status ?? "aligned",
    driftFindingsCount: drift?.items.length ?? 0,
    outcomes: outcomesSummary,
  };
}

export async function cockpitCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const { io } = context;
  const parsed = parse(context.args, {}, COCKPIT_USAGE);
  if (flag(parsed, "help")) {
    io.stdout(`${COCKPIT_USAGE}\n`);
    return EXIT.ok;
  }

  const root = projectDirectory(io, parsed);
  const snap = await collectCockpitSnapshot(root, io.clock());

  if (flag(parsed, "json")) {
    writeJson(io, snap);
    return EXIT.ok;
  }

  const connBadges = [
    `claude:${snap.connections.claude ? "on" : "off"}`,
    `codex:${snap.connections.codex ? "on" : "off"}`,
    `cursor:${snap.connections.cursor ? "on" : "off"}`,
    `vscode:${snap.connections.vscode ? "on" : "off"}`,
    `antigravity:${snap.connections.antigravity ? "on" : "off"}`,
  ].join("  ");

  const hookBadges = [
    `git-pre-commit:${snap.hooks.gitPreCommitInstalled ? "on" : "off"}`,
    `claude-stop:${snap.hooks.claudeStopHookInstalled ? "on" : "off"}`,
  ].join("  ");

  const lines: string[] = [
    `ANVILMARK MISSION CONTROL — ${snap.repoName} (${snap.totalTrackedFiles} files)`,
    `  Agents & IDEs:  ${connBadges}`,
    `  Guardrails:     ${hookBadges}`,
  ];

  if (!snap.activePlan) {
    lines.push(
      "",
      "  Active Plan:    none locked yet",
      "",
      "  Quickstart (100% local, no extra API key required):",
      "    1. anvilmark connect --with-hooks     # wire Claude Code, Codex, Cursor, VS Code & Antigravity",
      "    2. Inside your agent, run /anvilmark-plan (or ask to call prepare_planning_context)",
      "    3. anvilmark bridge --port 4317       # optional live sync with Web Studio",
      "    (Run `anvilmark --help` to see all commands.)",
    );
  } else {
    const p = snap.activePlan;
    const driftText =
      snap.driftStatus === "aligned"
        ? "ALIGNED ✓"
        : snap.driftStatus === "drifted"
          ? `DRIFTED (${snap.driftFindingsCount} finding(s))`
          : snap.driftStatus.toUpperCase();

    lines.push(
      `  Active Plan:    ${p.title} (${p.acceptedCount}/${p.totalSlices} accepted · quota:${p.quotaMode})`,
      `  Drift Radar:    ${driftText}`,
      "",
      "  Ordered Task Slices:",
      ...p.slices.map((s) => {
        const tag = s.state.toUpperCase().padEnd(8);
        const rev = s.reviewerFamily ? ` [review:${s.reviewerFamily}]` : "";
        return `    ${String(s.index).padStart(2, "0")} [W${s.wave}] ${tag} ${s.id} — ${s.title} -> ${s.model}${rev}`;
      }),
      "",
      p.nextReadySliceId
        ? `  Next Ready:     anvilmark next   (claim/run "${p.nextReadySliceId}")`
        : "  Status:         All slices accepted ✓",
    );
  }

  if (snap.outcomes && snap.outcomes.models.length > 0) {
    lines.push(
      "",
      `  Repo Model Evidence (${snap.outcomes.totalRecordedRuns} recorded runs):`,
      ...snap.outcomes.models.slice(0, 4).map((m) => {
        const pct =
          m.attempts > 0
            ? Math.round((m.acceptedFirstPass / m.attempts) * 100)
            : 0;
        return `    • ${m.model}: ${pct}% 1st-pass (${m.acceptedFirstPass}/${m.attempts}), ${Math.round(m.meanReworkRatio * 100)}% rework`;
      }),
    );
  }

  io.stdout(`${lines.join("\n")}\n`);
  return EXIT.ok;
}
