import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { currentProjectServerEntry } from "./codex-connect.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  writeJson,
} from "./common.js";
import { installHooks } from "./hooks.js";

export const CONNECT_USAGE = `Usage:
  anvilmark connect [--target claude|codex|cursor|vscode|antigravity|all] [--with-hooks] [-C DIR] [--json]

Connects ANVILMARK's local MCP server, browserless planning workflow, slice
conformance gates, and slash commands/skills into your coding agents and IDEs:

Targets (default: all)
  claude        .mcp.json + .claude/commands/anvilmark-{plan,next,cockpit}.md
  codex         .codex/config.toml (marked block with --local-studio & --slice-execution)
  cursor        .cursor/mcp.json + .cursor/rules/anvilmark-workflow.mdc
  vscode        .vscode/mcp.json (MCP stdio server)
  antigravity   .agent/skills/anvilmark/SKILL.md (workspace skill)

Options
  --target NAME      claude, codex, cursor, vscode, antigravity, or all (repeatable)
  --with-hooks       also install Git pre-commit and Claude Stop guardrails
  -C, --project-dir  repository root (default: current directory)
  --json             print structured JSON summary`;

export type ConnectTarget =
  "claude" | "codex" | "cursor" | "vscode" | "antigravity";

const ALL_CONNECT_TARGETS: readonly ConnectTarget[] = [
  "claude",
  "codex",
  "cursor",
  "vscode",
  "antigravity",
];

const SERVER_NAME = "anvilmark-project";
const CODEX_START = "# BEGIN ANVILMARK PROJECT MCP";
const CODEX_END = "# END ANVILMARK PROJECT MCP";

export interface ConnectedArtifact {
  target: ConnectTarget;
  path: string;
  action: "created" | "updated" | "unchanged";
}

function parseConnectTargets(
  raw: string | boolean | string[] | undefined,
): ConnectTarget[] {
  const values = (
    Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  )
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0 || values.includes("all")) {
    return [...ALL_CONNECT_TARGETS];
  }
  const result: ConnectTarget[] = [];
  for (const val of values) {
    if (!(ALL_CONNECT_TARGETS as readonly string[]).includes(val)) {
      throw new UsageError(
        `--target must be claude, codex, cursor, vscode, antigravity, or all, got "${val}"`,
        CONNECT_USAGE,
      );
    }
    if (!result.includes(val as ConnectTarget)) {
      result.push(val as ConnectTarget);
    }
  }
  return result;
}

async function assertNoSymlink(root: string, fullPath: string) {
  const rel = fullPath.slice(root.length).replace(/^\/+/, "");
  let cursor = root;
  for (const part of rel.split("/").filter(Boolean)) {
    cursor = join(cursor, part);
    const st = await lstat(cursor).catch(() => null);
    if (st?.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${cursor}`);
    }
  }
}

async function writeSafeFile(
  root: string,
  relPath: string,
  content: string,
): Promise<"created" | "updated" | "unchanged"> {
  const fullPath = join(root, relPath);
  await assertNoSymlink(root, fullPath);
  const existing = await readFile(fullPath, "utf8").catch(() => null);
  if (existing === content) return "unchanged";
  await mkdir(dirname(fullPath), { recursive: true });
  const tmp = `${fullPath}.anvilmark-${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, fullPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return existing === null ? "created" : "updated";
}

async function upsertMcpJsonFile(
  root: string,
  relPath: string,
  topKey: "mcpServers" | "servers",
  entryValue: Record<string, unknown>,
): Promise<"created" | "updated" | "unchanged"> {
  const fullPath = join(root, relPath);
  await assertNoSymlink(root, fullPath);
  const existingRaw = await readFile(fullPath, "utf8").catch(() => null);
  let doc: Record<string, unknown> = {};
  if (existingRaw !== null && existingRaw.trim()) {
    const parsed: unknown = JSON.parse(existingRaw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(`${relPath} must contain a top-level JSON object`);
    }
    doc = { ...(parsed as Record<string, unknown>) };
  }
  const container =
    typeof doc[topKey] === "object" &&
    doc[topKey] !== null &&
    !Array.isArray(doc[topKey])
      ? { ...(doc[topKey] as Record<string, unknown>) }
      : {};
  container[SERVER_NAME] = entryValue;
  doc[topKey] = container;
  return writeSafeFile(root, relPath, `${JSON.stringify(doc, null, 2)}\n`);
}

function buildMcpArgs(serverEntry: string, root: string): string[] {
  return [
    serverEntry,
    "--project-dir",
    root,
    "--agent-assessment",
    "--slice-execution",
    "--local-studio",
    "--hardware-sizing",
  ];
}

function renderCodexBlock(serverEntry: string, root: string): string {
  const args = buildMcpArgs(serverEntry, root)
    .map((v) => JSON.stringify(v))
    .join(", ");
  return [
    CODEX_START,
    `[mcp_servers.${SERVER_NAME}]`,
    `command = "node"`,
    `args = [${args}]`,
    `cwd = ${JSON.stringify(root)}`,
    `default_tools_approval_mode = "writes"`,
    CODEX_END,
  ].join("\n");
}

async function upsertCodexConfig(
  root: string,
  serverEntry: string,
): Promise<"created" | "updated" | "unchanged"> {
  const relPath = ".codex/config.toml";
  const fullPath = join(root, relPath);
  await assertNoSymlink(root, fullPath);
  const existing = await readFile(fullPath, "utf8").catch(() => null);
  const block = renderCodexBlock(serverEntry, root);

  if (existing === null || existing.trim().length === 0) {
    return writeSafeFile(root, relPath, `${block}\n`);
  }

  const startIdx = existing.indexOf(CODEX_START);
  const endIdx = existing.indexOf(CODEX_END);
  if (startIdx >= 0 && endIdx >= startIdx) {
    const before = existing.slice(0, startIdx).replace(/\s*$/, "");
    const after = existing.slice(endIdx + CODEX_END.length).replace(/^\s*/, "");
    const parts = [before, block, after].filter((p) => p.length > 0);
    return writeSafeFile(root, relPath, `${parts.join("\n\n")}\n`);
  }

  return writeSafeFile(
    root,
    relPath,
    `${existing.replace(/\s*$/, "")}\n\n${block}\n`,
  );
}

const CLAUDE_PLAN_CMD = `---
description: Clarify requirements, route models per task slice, and lock an executable AnvilMark plan locally
---

Plan and lock an AnvilMark implementation contract for: **$ARGUMENTS**

1. Call \`prepare_planning_context\` first (passing \`goal: "$ARGUMENTS"\`) to inspect verified repository scripts, check commands, frameworks, tracked paths, and empirical model win-rates.
2. If any architectural requirement is ambiguous (persistence, auth/tenancy, failure/retry behavior, or v1 scope boundaries), ask me 2–4 concise clarifying questions FIRST and wait for my reply before locking a plan.
3. Once clear, construct a rigorous \`HandoffPlan\` (explicit scope & non-goals, architecture decisions with rejected alternatives, trust-boundary data flows, ordered task slices choosing models from \`ranked_candidates\`, and security verification) and call \`lock_execution_plan\`.
`;

const CLAUDE_NEXT_CMD = `---
description: Execute the next ready AnvilMark task slice strictly inside its scope contract and verify conformance
---

Execute the next ready task slice in the active AnvilMark plan (or slice \`$ARGUMENTS\` if specified):

1. Call \`list_plan_slices\` to find the first unblocked slice whose \`depends_on\` prerequisites are \`accepted\`, then call \`get_slice_contract\` for that \`slice_id\`.
2. Implement ONLY that slice cleanly. Stay strictly within \`contract.allowedGlobs\`, never touch \`contract.forbiddenGlobs\`, and do not modify \`package.json\` dependencies unless \`contract.allowDependencyChanges\` is \`true\`.
3. Run the slice's verification checks, then call \`verify_slice\` and \`record_slice_outcome\` to close the loop. Never report a slice as complete if \`verify_slice\` reports violations.
`;

const CLAUDE_COCKPIT_CMD = `---
description: Open the AnvilMark Control Cockpit and inspect slice status, drift radar, and model win-rates
---

Call \`open_anvilmark_cockpit\` and \`list_plan_slices\`, then summarize active slice progress, any architecture drift findings, and recommended next actions.
`;

const CURSOR_WORKFLOW_MDC = `---
description: "AnvilMark MCP workflow: plan with prepare_planning_context -> lock_execution_plan, execute slices via get_slice_contract -> verify_slice -> record_slice_outcome"
alwaysApply: false
---

# AnvilMark Local Agent Workflow

When planning new features or executing slices from \`.anvilmark/development/active-plan.json\`:
1. **Planning locally:** Call \`prepare_planning_context\` first, ask 2–4 clarifying questions if architectural choices are ambiguous, then call \`lock_execution_plan\` to compile deterministic \`SliceContractSpec\` globs and update repo instructions.
2. **Executing a slice:** Call \`list_plan_slices\` and \`get_slice_contract\` before editing. Respect \`allowedGlobs\`, \`forbiddenGlobs\`, and \`allowDependencyChanges\`.
3. **Verification & Provenance:** Always call \`verify_slice\` after editing and \`record_slice_outcome\` once checks pass so Empirical Bayes routing learns from real repository outcomes.
`;

const ANTIGRAVITY_SKILL_MD = `---
name: anvilmark
description: Local-first architecture planning, per-slice coding-model routing, deterministic slice conformance verification, and drift detection via AnvilMark MCP tools. Activate when planning features, splitting tasks across models, verifying slice contracts, or opening the AnvilMark Cockpit.
---

# AnvilMark Local Control Plane Skill

Use the \`anvilmark-project\` MCP tools in this workspace to plan, enforce, and record multi-model software engineering without needing an external browser tab.

## 1. Planning a Feature or Project (\`prepare_planning_context\` → \`lock_execution_plan\`)
1. Call \`prepare_planning_context\` with the user's \`goal\` (and optional \`subscriptions\` / \`quota_mode\`). Never guess scripts or file layouts before calling it.
2. If the user's request leaves key architectural choices open (data model, auth/trust boundaries, retry/idempotency rules, or v1 scope), use \`ask_question\` (or concise plain text) to clarify 2–4 concrete choices **before** locking a plan.
3. Propose sharp engineering decisions (including rejected alternatives and honest tradeoffs), map sensitive crossings in \`flows\`, and route each vertical slice in \`tasks\` to the best-fit model from \`ranked_candidates\` (reserving frontier quota for ambiguous/security slices and routing bounded CRUD/schema/test slices to proven balanced/fast/local OSS models).
4. Call \`lock_execution_plan\` to validate the DAG, compile deterministic \`SliceContractSpec\` globs & cross-vendor reviewers, write \`.anvilmark/development/active-plan.json\` + IDE instruction blocks, and render the interactive **AnvilMark Cockpit** MCP App inline.

## 2. Executing & Verifying Slices (\`list_plan_slices\` → \`get_slice_contract\` → \`verify_slice\`)
1. Before implementing an active plan slice, call \`list_plan_slices\` and \`get_slice_contract\`.
2. Obey \`contract.allowedGlobs\`, \`contract.forbiddenGlobs\`, and \`contract.allowDependencyChanges\` strictly.
3. Run the slice's executable check commands, then call \`verify_slice\` and \`record_slice_outcome\` so empirical repository routing priors stay accurate.

## 3. Visual Inspection (\`open_anvilmark_cockpit\`)
Call \`open_anvilmark_cockpit\` whenever the user wants to view slice progress, inspect trust-boundary drift findings, or review empirical model win-rates inline or in the side pane.
`;

export async function connectAgents(
  directory: string,
  targets: readonly ConnectTarget[],
  serverEntryOverride?: string,
): Promise<ConnectedArtifact[]> {
  const root = await realpath(directory);
  const serverEntry =
    serverEntryOverride ?? (await currentProjectServerEntry());
  const mcpArgs = buildMcpArgs(serverEntry, root);
  const artifacts: ConnectedArtifact[] = [];

  if (targets.includes("claude")) {
    artifacts.push({
      target: "claude",
      path: ".mcp.json",
      action: await upsertMcpJsonFile(root, ".mcp.json", "mcpServers", {
        command: "node",
        args: mcpArgs,
      }),
    });
    artifacts.push({
      target: "claude",
      path: ".claude/commands/anvilmark-plan.md",
      action: await writeSafeFile(
        root,
        ".claude/commands/anvilmark-plan.md",
        CLAUDE_PLAN_CMD,
      ),
    });
    artifacts.push({
      target: "claude",
      path: ".claude/commands/anvilmark-next.md",
      action: await writeSafeFile(
        root,
        ".claude/commands/anvilmark-next.md",
        CLAUDE_NEXT_CMD,
      ),
    });
    artifacts.push({
      target: "claude",
      path: ".claude/commands/anvilmark-cockpit.md",
      action: await writeSafeFile(
        root,
        ".claude/commands/anvilmark-cockpit.md",
        CLAUDE_COCKPIT_CMD,
      ),
    });
  }

  if (targets.includes("codex")) {
    artifacts.push({
      target: "codex",
      path: ".codex/config.toml",
      action: await upsertCodexConfig(root, serverEntry),
    });
  }

  if (targets.includes("cursor")) {
    artifacts.push({
      target: "cursor",
      path: ".cursor/mcp.json",
      action: await upsertMcpJsonFile(root, ".cursor/mcp.json", "mcpServers", {
        command: "node",
        args: mcpArgs,
      }),
    });
    artifacts.push({
      target: "cursor",
      path: ".cursor/rules/anvilmark-workflow.mdc",
      action: await writeSafeFile(
        root,
        ".cursor/rules/anvilmark-workflow.mdc",
        CURSOR_WORKFLOW_MDC,
      ),
    });
  }

  if (targets.includes("vscode")) {
    artifacts.push({
      target: "vscode",
      path: ".vscode/mcp.json",
      action: await upsertMcpJsonFile(root, ".vscode/mcp.json", "servers", {
        type: "stdio",
        command: "node",
        args: mcpArgs,
      }),
    });
  }

  if (targets.includes("antigravity")) {
    artifacts.push({
      target: "antigravity",
      path: ".agent/skills/anvilmark/SKILL.md",
      action: await writeSafeFile(
        root,
        ".agent/skills/anvilmark/SKILL.md",
        ANTIGRAVITY_SKILL_MD,
      ),
    });
  }

  return artifacts;
}

export async function connectCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const { io } = context;
  const parsed = parse(
    context.args,
    {
      target: { type: "string", multiple: true },
      "with-hooks": { type: "boolean" },
    },
    CONNECT_USAGE,
  );

  if (flag(parsed, "help")) {
    io.stdout(`${CONNECT_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected positional argument "${parsed.positionals[0]}"`,
      CONNECT_USAGE,
    );
  }

  const root = projectDirectory(io, parsed);
  const targets = parseConnectTargets(parsed.values.target);
  const artifacts = await connectAgents(root, targets);
  const hooks = flag(parsed, "with-hooks")
    ? await installHooks(root, ["git", "claude"])
    : [];

  if (flag(parsed, "json")) {
    writeJson(io, {
      project_dir: root,
      targets,
      artifacts,
      hooks,
    });
    return EXIT.ok;
  }

  io.stdout(
    [
      `Connected ANVILMARK in ${root}:`,
      ...artifacts.map(
        (a) => `  ${a.action.padEnd(9)} ${a.path} (${a.target})`,
      ),
      ...hooks.map(
        (h) => `  ${h.action.padEnd(9)} ${h.path} (hook:${h.target})`,
      ),
      "",
      "Ready inside your tools:",
      "  • Claude Code:  run /anvilmark-plan, /anvilmark-next, or /anvilmark-cockpit",
      "  • Codex:        reload project to use mcp_servers.anvilmark-project",
      "  • Cursor/Code:  MCP server anvilmark-project + workflow rule active",
      "  • Antigravity:  anvilmark skill + inline Cockpit MCP App active",
    ].join("\n") + "\n",
  );
  return EXIT.ok;
}
