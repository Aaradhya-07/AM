import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  writeJson,
} from "./common.js";
import { measureDrift } from "./drift.js";
import { readSliceOutcomes } from "./outcomes.js";
import { loadSlicePlan } from "./slice-storage.js";
import { sliceDigest } from "./slice-worktree.js";
import { runSliceGit } from "./verify-slice.js";

export const HOOKS_USAGE = `Usage:
  anvilmark hooks <install|uninstall|status|run> [--target git|claude|all] [--claude-stop] [-C DIR] [--json]

Active deterministic guardrails for local Git commits and coding-agent turns:
  install     wire pre-commit (Git) and/or Stop hook (.claude/settings.local.json)
  uninstall   cleanly remove AnvilMark hook blocks while preserving user hooks
  status      inspect installed hook targets in this repository
  run         execute fast (<300ms) conformance & secret/boundary gate over current changes`;

const GIT_HOOK_START = "# BEGIN ANVILMARK PRE-COMMIT HOOK";
const GIT_HOOK_END = "# END ANVILMARK PRE-COMMIT HOOK";
const CLAUDE_HOOK_MARKER = "anvilmark-guardrail";

export type HookTarget = "git" | "claude";
const ALL_HOOK_TARGETS: readonly HookTarget[] = ["git", "claude"];

function parseHookTargets(
  raw: string | boolean | string[] | undefined,
): HookTarget[] {
  const values = (
    Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  )
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0 || values.includes("all")) {
    return [...ALL_HOOK_TARGETS];
  }
  const out: HookTarget[] = [];
  for (const item of values) {
    if (item !== "git" && item !== "claude") {
      throw new UsageError(
        `--target must be git, claude, or all, got "${item}"`,
        HOOKS_USAGE,
      );
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

async function resolveCliEntryPath(): Promise<string> {
  const invoked = process.argv[1];
  if (!invoked) {
    throw new Error("Cannot locate the ANVILMARK CLI entry script.");
  }
  return realpath(invoked);
}

async function assertNotSymlinkChain(root: string, targetPath: string) {
  const rel = targetPath.slice(root.length).replace(/^\/+/, "");
  const parts = rel.split("/").filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    cursor = join(cursor, part);
    const st = await lstat(cursor).catch(() => null);
    if (st?.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${cursor}`);
    }
  }
}

async function atomicWriteText(path: string, content: string, mode?: number) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.anvilmark-${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, { encoding: "utf8", mode: mode ?? 0o644 });
    if (mode !== undefined) {
      await chmod(tmp, mode);
    }
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

function buildGitHookBlock(cliEntry: string, root: string): string {
  const quotedNode = JSON.stringify(process.execPath);
  const quotedCli = JSON.stringify(cliEntry);
  const quotedRoot = JSON.stringify(root);
  return [
    GIT_HOOK_START,
    `${quotedNode} ${quotedCli} hooks run -C ${quotedRoot}`,
    GIT_HOOK_END,
  ].join("\n");
}

function stripMarkedBlock(
  text: string,
  startMarker: string,
  endMarker: string,
): string {
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx < 0 || endIdx < startIdx) return text;
  const before = text.slice(0, startIdx).replace(/\n+$/, "");
  const after = text.slice(endIdx + endMarker.length).replace(/^\n+/, "");
  if (!before) return after;
  if (!after) return `${before}\n`;
  return `${before}\n\n${after}`;
}

export async function installHooks(
  directory: string,
  targets: readonly HookTarget[],
  cliEntryOverride?: string,
): Promise<Array<{ target: HookTarget; path: string; action: string }>> {
  const root = await realpath(directory);
  const cliEntry = cliEntryOverride ?? (await resolveCliEntryPath());
  const results: Array<{ target: HookTarget; path: string; action: string }> =
    [];

  if (targets.includes("git")) {
    const gitMarker = await lstat(join(root, ".git")).catch(() => null);
    if (gitMarker && gitMarker.isDirectory() && !gitMarker.isSymbolicLink()) {
      const hookPath = join(root, ".git", "hooks", "pre-commit");
      await assertNotSymlinkChain(root, hookPath);
      const existing = await readFile(hookPath, "utf8").catch(() => null);
      const block = buildGitHookBlock(cliEntry, root);

      let nextContent: string;
      if (existing === null || existing.trim().length === 0) {
        nextContent = `#!/usr/bin/env sh\nset -e\n\n${block}\n`;
      } else {
        const cleaned = stripMarkedBlock(
          existing,
          GIT_HOOK_START,
          GIT_HOOK_END,
        );
        nextContent = `${cleaned.replace(/\s*$/, "")}\n\n${block}\n`;
      }

      const action =
        existing === nextContent
          ? "unchanged"
          : existing === null
            ? "created"
            : "updated";
      if (action !== "unchanged") {
        await atomicWriteText(hookPath, nextContent, 0o755);
      }
      results.push({
        target: "git",
        path: ".git/hooks/pre-commit",
        action,
      });
    }
  }

  if (targets.includes("claude")) {
    const settingsPath = join(root, ".claude", "settings.local.json");
    await assertNotSymlinkChain(root, settingsPath);
    const existingRaw = await readFile(settingsPath, "utf8").catch(() => null);
    let parsed: Record<string, unknown> = {};
    if (existingRaw !== null && existingRaw.trim()) {
      const json: unknown = JSON.parse(existingRaw);
      if (typeof json !== "object" || json === null || Array.isArray(json)) {
        throw new Error(".claude/settings.local.json must be a JSON object");
      }
      parsed = { ...(json as Record<string, unknown>) };
    }

    const hooksObj =
      typeof parsed.hooks === "object" &&
      parsed.hooks !== null &&
      !Array.isArray(parsed.hooks)
        ? { ...(parsed.hooks as Record<string, unknown>) }
        : {};

    const existingStop = Array.isArray(hooksObj.Stop)
      ? hooksObj.Stop.filter((entry) => {
          const str = JSON.stringify(entry);
          return !str.includes(CLAUDE_HOOK_MARKER);
        })
      : [];

    const hookCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(cliEntry)} hooks run --claude-stop -C ${JSON.stringify(root)} # ${CLAUDE_HOOK_MARKER}`;
    existingStop.push({
      hooks: [
        {
          type: "command",
          command: hookCommand,
        },
      ],
    });
    hooksObj.Stop = existingStop;
    parsed.hooks = hooksObj;

    const nextText = `${JSON.stringify(parsed, null, 2)}\n`;
    const action =
      existingRaw === nextText
        ? "unchanged"
        : existingRaw === null
          ? "created"
          : "updated";
    if (action !== "unchanged") {
      await atomicWriteText(settingsPath, nextText);
    }
    results.push({
      target: "claude",
      path: ".claude/settings.local.json",
      action,
    });
  }

  return results;
}

export async function uninstallHooks(
  directory: string,
  targets: readonly HookTarget[],
): Promise<Array<{ target: HookTarget; path: string; action: string }>> {
  const root = await realpath(directory);
  const results: Array<{ target: HookTarget; path: string; action: string }> =
    [];

  if (targets.includes("git")) {
    const hookPath = join(root, ".git", "hooks", "pre-commit");
    const existing = await readFile(hookPath, "utf8").catch(() => null);
    if (existing !== null && existing.includes(GIT_HOOK_START)) {
      const stripped = stripMarkedBlock(existing, GIT_HOOK_START, GIT_HOOK_END);
      const onlyShebang =
        stripped
          .replace(/^#!.*\n?/, "")
          .replace(/^set -e\s*\n?/, "")
          .trim().length === 0;
      if (onlyShebang) {
        await rm(hookPath, { force: true });
        results.push({
          target: "git",
          path: ".git/hooks/pre-commit",
          action: "removed",
        });
      } else {
        await atomicWriteText(hookPath, stripped, 0o755);
        results.push({
          target: "git",
          path: ".git/hooks/pre-commit",
          action: "updated",
        });
      }
    } else {
      results.push({
        target: "git",
        path: ".git/hooks/pre-commit",
        action: "absent",
      });
    }
  }

  if (targets.includes("claude")) {
    const settingsPath = join(root, ".claude", "settings.local.json");
    const existingRaw = await readFile(settingsPath, "utf8").catch(() => null);
    if (existingRaw !== null && existingRaw.includes(CLAUDE_HOOK_MARKER)) {
      const parsed = JSON.parse(existingRaw) as Record<string, unknown>;
      const hooksObj = (parsed.hooks ?? {}) as Record<string, unknown>;
      if (Array.isArray(hooksObj.Stop)) {
        hooksObj.Stop = hooksObj.Stop.filter(
          (entry) => !JSON.stringify(entry).includes(CLAUDE_HOOK_MARKER),
        );
        if ((hooksObj.Stop as unknown[]).length === 0) {
          delete hooksObj.Stop;
        }
      }
      if (Object.keys(hooksObj).length === 0) {
        delete parsed.hooks;
      } else {
        parsed.hooks = hooksObj;
      }
      await atomicWriteText(
        settingsPath,
        `${JSON.stringify(parsed, null, 2)}\n`,
      );
      results.push({
        target: "claude",
        path: ".claude/settings.local.json",
        action: "updated",
      });
    } else {
      results.push({
        target: "claude",
        path: ".claude/settings.local.json",
        action: "absent",
      });
    }
  }

  return results;
}

export async function inspectHookStatus(directory: string) {
  const root = await realpath(directory);
  const gitHook = await readFile(
    join(root, ".git", "hooks", "pre-commit"),
    "utf8",
  ).catch(() => null);
  const claudeSettings = await readFile(
    join(root, ".claude", "settings.local.json"),
    "utf8",
  ).catch(() => null);
  return {
    gitPreCommitInstalled: Boolean(gitHook?.includes(GIT_HOOK_START)),
    claudeStopHookInstalled: Boolean(
      claudeSettings?.includes(CLAUDE_HOOK_MARKER),
    ),
  };
}

function isSecretOrCredentialPath(relPath: string): boolean {
  const base = basename(relPath).toLowerCase();
  if (
    base === ".env" ||
    (base.startsWith(".env.") && base !== ".env.example")
  ) {
    return true;
  }
  if (
    base.endsWith(".pem") ||
    base.endsWith(".key") ||
    base.startsWith("id_rsa") ||
    base.startsWith("id_ed25519")
  ) {
    return true;
  }
  return false;
}

export async function runHookGate(directory: string, now: string) {
  const root = await realpath(directory);
  const bundle = await loadSlicePlan(root);
  if (!bundle) {
    return {
      passed: true,
      activePlan: false,
      violations: [] as string[],
    };
  }

  const violations: string[] = [];
  const statusRaw = await runSliceGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--no-renames",
    "--untracked-files=all",
  ]).catch(() => "");

  const changedPaths = statusRaw
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .filter(
      (p) =>
        !p.startsWith(".anvilmark/") &&
        p !== "PLAN.md" &&
        p !== "CLAUDE.md" &&
        p !== "AGENTS.md" &&
        p !== ".cursor/rules/anvilmark-plan.mdc",
    );

  // 1. Secret / credential file guard
  for (const relPath of changedPaths) {
    if (isSecretOrCredentialPath(relPath)) {
      violations.push(
        `Forbidden secret/credential file modified: "${relPath}". Remove or untrack it before committing.`,
      );
    }
  }

  // 2. Unapproved package.json dependency modification guard across active unaccepted slices
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
  const remainingTasks = bundle.plan.tasks.filter(
    (t) => !acceptedIds.has(t.id),
  );
  const anyAllowsDeps = remainingTasks.some(
    (t) => t.contract === undefined || t.contract.allowDependencyChanges,
  );

  if (
    !anyAllowsDeps &&
    changedPaths.some((p) => basename(p) === "package.json")
  ) {
    const diffOut = await runSliceGit(root, [
      "diff",
      "--unified=0",
      "--",
      "package.json",
    ]).catch(() => "");
    if (/"(devD|optionalD|peerD|d)ependencies"/.test(diffOut)) {
      violations.push(
        `Active plan slices lock package.json dependencies (allowDependencyChanges=false), but package.json dependency fields were modified.`,
      );
    }
  }

  // 3. Architecture boundary bypass & unapproved AI SDK drift check
  const drift = await measureDrift(root, now).catch(() => null);
  if (drift && drift.status === "drifted") {
    for (const item of drift.items) {
      if (item.severity === "error") {
        violations.push(
          `Architecture ${item.kind} (${item.from} -> ${item.to}): ${item.detail}`,
        );
      }
    }
  }

  return {
    passed: violations.length === 0,
    activePlan: true,
    planTitle: bundle.plan.title,
    violations,
  };
}

export async function hooksCommand(context: CommandContext): Promise<ExitCode> {
  const { io } = context;
  const parsed = parse(
    context.args,
    {
      target: { type: "string", multiple: true },
      "claude-stop": { type: "boolean" },
    },
    HOOKS_USAGE,
  );

  if (flag(parsed, "help")) {
    io.stdout(`${HOOKS_USAGE}\n`);
    return EXIT.ok;
  }

  const subcommand = parsed.positionals[0];
  if (
    !subcommand ||
    !["install", "uninstall", "status", "run"].includes(subcommand) ||
    parsed.positionals.length > 1
  ) {
    throw new UsageError(
      "Specify one subcommand: install, uninstall, status, or run",
      HOOKS_USAGE,
    );
  }

  const root = projectDirectory(io, parsed);

  if (subcommand === "status") {
    const status = await inspectHookStatus(root);
    if (flag(parsed, "json")) {
      writeJson(io, { project_dir: root, ...status });
    } else {
      io.stdout(
        [
          `AnvilMark hooks in ${root}:`,
          `  git pre-commit:     ${status.gitPreCommitInstalled ? "installed" : "not installed"}`,
          `  claude Stop hook:   ${status.claudeStopHookInstalled ? "installed" : "not installed"}`,
        ].join("\n") + "\n",
      );
    }
    return EXIT.ok;
  }

  if (subcommand === "install") {
    const targets = parseHookTargets(parsed.values.target);
    const installed = await installHooks(root, targets);
    if (flag(parsed, "json")) {
      writeJson(io, { project_dir: root, hooks: installed });
    } else {
      io.stdout(
        [
          `Installed AnvilMark guardrails in ${root}:`,
          ...installed.map(
            (h) => `  ${h.action.padEnd(9)} ${h.path} (${h.target})`,
          ),
        ].join("\n") + "\n",
      );
    }
    return EXIT.ok;
  }

  if (subcommand === "uninstall") {
    const targets = parseHookTargets(parsed.values.target);
    const removed = await uninstallHooks(root, targets);
    if (flag(parsed, "json")) {
      writeJson(io, { project_dir: root, hooks: removed });
    } else {
      io.stdout(
        [
          `Removed AnvilMark guardrails in ${root}:`,
          ...removed.map(
            (h) => `  ${h.action.padEnd(9)} ${h.path} (${h.target})`,
          ),
        ].join("\n") + "\n",
      );
    }
    return EXIT.ok;
  }

  // subcommand === "run"
  const gate = await runHookGate(root, io.clock());
  if (flag(parsed, "json")) {
    writeJson(io, gate);
    return gate.passed ? EXIT.ok : EXIT.failed;
  }

  if (gate.passed) {
    return EXIT.ok;
  }

  const msg = [
    `AnvilMark guardrail blocked this step (${gate.planTitle ?? "active plan"}):`,
    ...gate.violations.map((v) => `  - ${v}`),
    `Run \`anvilmark verify-slice --slice <id>\` or \`anvilmark drift\` for details.`,
  ].join("\n");

  io.stderr(`${msg}\n`);
  // Exit 2 when invoked by Claude Stop hook so Claude receives blocking feedback and fixes violations.
  return flag(parsed, "claude-stop") ? EXIT.usage : EXIT.failed;
}
