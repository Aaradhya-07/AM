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
import { join, resolve } from "node:path";

import { z } from "zod";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  requiredOption,
  writeJson,
} from "./common.js";

export const APPLY_PLAN_USAGE = `Usage:
  anvilmark apply-plan --file <bundle.json> [--target claude|cursor|codex|all] [-C DIR] [--json]

Applies an AnvilMark plan handoff bundle (anvilmark.plan-handoff.v1, exported
from AnvilMark Studio) to a local repository so coding agents pick it up.

Writes
  .anvilmark/development/active-plan.json   the validated bundle (pretty JSON)
  PLAN.md                                    the master prompt (marked block)

Updates, per --target (default: all)
  claude   CLAUDE.md                          marked block only; your text is kept
  cursor   .cursor/rules/anvilmark-plan.mdc   Cursor rule, alwaysApply: true
  codex    AGENTS.md                          marked block only; your text is kept

Options
  --file FILE          the plan handoff bundle (JSON)
  --target NAME        claude, cursor, codex or all (repeat or comma-separate)
  -C, --project-dir    the repository root (default: current directory)
  --json               print the written files as JSON

Nothing is written through a symbolic link, and nothing outside the project
directory is touched. Re-running with the same bundle changes nothing.`;

export const PLAN_HANDOFF_VERSION = "anvilmark.plan-handoff.v1";
export const PLAN_BLOCK_START = "<!-- anvilmark:plan:start -->";
export const PLAN_BLOCK_END = "<!-- anvilmark:plan:end -->";

const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const MAX_INSTRUCTION_FILE_BYTES = 4 * 1024 * 1024;

const text = z.string().trim().min(1).max(4000);
const list = z.array(text).max(50);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
const section = z.string().max(200_000);

/** Mirrors the Studio planner output (packages/web/lib/planner.ts). */
export const HandoffPlan = z.strictObject({
  title: text,
  goal: text,
  users: text,
  scope: list.min(1),
  nonGoals: list,
  assumptions: list,
  questions: list,
  architecture: z
    .array(
      z.strictObject({
        title: text,
        decision: text,
        why: text,
        alternative: text,
        tradeoff: text,
      }),
    )
    .min(1)
    .max(20),
  flows: z
    .array(
      z.strictObject({
        from: text,
        to: text,
        data: text,
        boundary: text,
      }),
    )
    .max(30),
  tasks: z
    .array(
      z.strictObject({
        id,
        title: text,
        outcome: text,
        dependsOn: z.array(id).max(20),
        acceptance: list.min(1),
        checks: list.min(1),
        model: text,
        why: text,
        alternatives: z
          .array(z.strictObject({ model: text, tradeoff: text }))
          .max(5),
        inputTokens: z.number().int().positive().max(10_000_000),
        outputTokens: z.number().int().positive().max(1_000_000),
        estimateBasis: text,
      }),
    )
    .min(1)
    .max(30),
  security: z
    .array(
      z.strictObject({
        risk: text,
        control: text,
        verification: text,
      }),
    )
    .max(30),
});

export const PlanHandoffBundle = z
  .strictObject({
    version: z.literal(PLAN_HANDOFF_VERSION),
    createdAt: z.string().trim().min(1).max(64),
    plan: HandoffPlan,
    candidates: z
      .array(
        // Studio candidates carry pricing and ranking fields too; only the
        // identity fields are kept.
        z.object({
          model: z
            .string()
            .trim()
            .regex(/^[\w./:-]{1,120}$/),
          label: text,
          provider: text,
          tier: z.enum(["frontier", "balanced", "fast"]),
          billing: z.enum(["api", "subscription", "local"]),
        }),
      )
      .max(32),
    strict: z.boolean(),
    masterPrompt: z.string().trim().min(1).max(500_000),
    claudeMdSection: section.optional(),
    cursorRuleMdc: section.optional(),
    codexAgentsSection: section.optional(),
  })
  .superRefine((bundle, context) => {
    const seen = new Set<string>();
    for (const [index, task] of bundle.plan.tasks.entries()) {
      if (seen.has(task.id)) {
        context.addIssue({
          code: "custom",
          path: ["plan", "tasks", index, "id"],
          message: `duplicate task id "${task.id}"`,
        });
      }
      for (const dependency of task.dependsOn) {
        if (!seen.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["plan", "tasks", index, "dependsOn"],
            message: `task "${task.id}" depends on "${dependency}", which is not an earlier task`,
          });
        }
      }
      seen.add(task.id);
    }
  });
export type PlanHandoffBundle = z.infer<typeof PlanHandoffBundle>;

export type PlanTarget = "claude" | "cursor" | "codex";
const TARGETS: readonly PlanTarget[] = ["claude", "cursor", "codex"];

export interface AppliedFile {
  readonly path: string;
  readonly action: "created" | "updated" | "unchanged";
}

/** A refused write or an invalid bundle. Exits 1. */
export class ApplyPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyPlanError";
  }
}

export async function applyPlanCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const { io } = context;
  const parsed = parse(
    context.args,
    { file: { type: "string" }, target: { type: "string", multiple: true } },
    APPLY_PLAN_USAGE,
  );
  if (flag(parsed, "help")) {
    io.stdout(`${APPLY_PLAN_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected argument "${parsed.positionals[0]}"`,
      APPLY_PLAN_USAGE,
    );
  }
  const file = requiredOption(parsed, "file", APPLY_PLAN_USAGE);
  const targets = parseTargets(parsed.values.target);
  const root = projectDirectory(io, parsed);

  try {
    const bundle = await readBundle(resolve(io.cwd, file));
    const written = await applyPlan(root, bundle, targets);
    if (flag(parsed, "json")) {
      writeJson(io, { project_dir: root, files: written });
    } else {
      const changed = written.filter((item) => item.action !== "unchanged");
      io.stdout(
        [
          `Applied plan "${bundle.plan.title}" to ${root}`,
          ...written.map((item) => `  ${item.action.padEnd(9)} ${item.path}`),
          changed.length === 0
            ? "Nothing changed; the plan was already applied."
            : `${changed.length} file(s) written. Review the changes before committing.`,
        ].join("\n") + "\n",
      );
    }
    return EXIT.ok;
  } catch (error) {
    if (error instanceof ApplyPlanError) {
      io.stderr(`error: ${error.message}\n`);
      return EXIT.failed;
    }
    throw error;
  }
}

function parseTargets(
  raw: string | boolean | string[] | undefined,
): PlanTarget[] {
  const values = (
    Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  )
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0 || values.includes("all")) return [...TARGETS];
  const result: PlanTarget[] = [];
  for (const value of values) {
    if (!(TARGETS as readonly string[]).includes(value)) {
      throw new UsageError(
        `--target must be claude, cursor, codex or all, got "${value}"`,
        APPLY_PLAN_USAGE,
      );
    }
    if (!result.includes(value as PlanTarget)) result.push(value as PlanTarget);
  }
  return TARGETS.filter((target) => result.includes(target));
}

export async function readBundle(path: string): Promise<PlanHandoffBundle> {
  const info = await lstat(path).catch(() => null);
  if (!info) throw new ApplyPlanError(`bundle file not found: ${path}`);
  if (!info.isFile())
    throw new ApplyPlanError(`bundle is not a regular file: ${path}`);
  if (info.size > MAX_BUNDLE_BYTES)
    throw new ApplyPlanError(
      `bundle is larger than ${MAX_BUNDLE_BYTES} bytes: ${path}`,
    );
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new ApplyPlanError(
      `bundle is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseBundle(raw);
}

export function parseBundle(raw: unknown): PlanHandoffBundle {
  const result = PlanHandoffBundle.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 12)
      .map(
        (issue) =>
          `  ${issue.path.length > 0 ? issue.path.join(".") : "(bundle)"}: ${issue.message}`,
      );
    throw new ApplyPlanError(
      [
        `invalid plan handoff bundle (${PLAN_HANDOFF_VERSION}):`,
        ...issues,
      ].join("\n"),
    );
  }
  return result.data;
}

/** Apply a validated bundle. Returns every file it considered, in order. */
export async function applyPlan(
  projectDir: string,
  bundle: PlanHandoffBundle,
  targets: readonly PlanTarget[] = TARGETS,
): Promise<AppliedFile[]> {
  const rootInfo = await lstat(projectDir).catch(() => null);
  if (!rootInfo?.isDirectory())
    throw new ApplyPlanError(`project directory not found: ${projectDir}`);
  const root = await realpath(projectDir);
  const written: AppliedFile[] = [];

  written.push(
    await writeWhole(
      root,
      [".anvilmark", "development", "active-plan.json"],
      `${JSON.stringify(bundle, null, 2)}\n`,
    ),
  );
  written.push(
    await writeBlock(root, ["PLAN.md"], bundle.masterPrompt.trim(), "# Plan"),
  );
  for (const target of targets) {
    if (target === "claude") {
      written.push(
        await writeBlock(
          root,
          ["CLAUDE.md"],
          bundle.claudeMdSection?.trim() || renderInstructionSection(bundle),
        ),
      );
    } else if (target === "codex") {
      written.push(
        await writeBlock(
          root,
          ["AGENTS.md"],
          bundle.codexAgentsSection?.trim() || renderInstructionSection(bundle),
        ),
      );
    } else {
      written.push(
        await writeWhole(
          root,
          [".cursor", "rules", "anvilmark-plan.mdc"],
          renderCursorRule(bundle),
        ),
      );
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Rendering

function modelLabel(bundle: PlanHandoffBundle, model: string): string {
  const candidate = bundle.candidates.find((item) => item.model === model);
  return candidate ? `${candidate.label} (\`${model}\`)` : `\`${model}\``;
}

function bullets(items: readonly string[], empty = "None recorded."): string[] {
  return items.length > 0
    ? items.map((item) => `- ${oneLine(item)}`)
    : [`- ${empty}`];
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function architectureLines(bundle: PlanHandoffBundle): string[] {
  return bundle.plan.architecture.map(
    (item) =>
      `- **${oneLine(item.title)}**: ${oneLine(item.decision)} Why: ${oneLine(item.why)} Rejected alternative: ${oneLine(item.alternative)} Trade-off: ${oneLine(item.tradeoff)}`,
  );
}

function sliceLines(bundle: PlanHandoffBundle): string[] {
  return bundle.plan.tasks.flatMap((task, index) => [
    `${index + 1}. **${task.id} — ${oneLine(task.title)}** (recommended model: ${modelLabel(bundle, task.model)}${
      task.dependsOn.length > 0 ? `; after: ${task.dependsOn.join(", ")}` : ""
    })`,
    `   - Outcome: ${oneLine(task.outcome)}`,
    `   - Acceptance: ${task.acceptance.map(oneLine).join("; ")}`,
    `   - Checks: ${task.checks.map(oneLine).join("; ")}`,
    ...(task.alternatives.length > 0
      ? [
          `   - Alternatives: ${task.alternatives
            .map(
              (option) =>
                `${modelLabel(bundle, option.model)} — ${oneLine(option.tradeoff)}`,
            )
            .join("; ")}`,
        ]
      : []),
  ]);
}

function securityLines(bundle: PlanHandoffBundle): string[] {
  return bundle.plan.security.map(
    (item) =>
      `- **${oneLine(item.risk)}**: ${oneLine(item.control)} Verify: ${oneLine(item.verification)}`,
  );
}

/** The CLAUDE.md / AGENTS.md block body when the bundle supplies none. */
export function renderInstructionSection(bundle: PlanHandoffBundle): string {
  const { plan } = bundle;
  return [
    `## AnvilMark plan: ${oneLine(plan.title)}`,
    "",
    `Goal: ${oneLine(plan.goal)}`,
    `Users: ${oneLine(plan.users)}`,
    "",
    `The full plan is in \`PLAN.md\` and \`.anvilmark/development/active-plan.json\` (created ${bundle.createdAt}). Read them before editing, inspect the actual code, and treat paths, checks and model suggestions as proposals to confirm.`,
    "",
    "### Scope",
    ...bullets(plan.scope),
    "",
    "### Non-goals",
    ...bullets(plan.nonGoals),
    "",
    "### Architecture decisions",
    ...architectureLines(bundle),
    "",
    "### Slices (in order)",
    ...sliceLines(bundle),
    ...(plan.security.length > 0
      ? ["", "### Security controls", ...securityLines(bundle)]
      : []),
    ...(plan.questions.length > 0
      ? ["", "### Open questions", ...bullets(plan.questions)]
      : []),
    "",
    "### Working rules",
    "- Work one slice at a time, in order; do not start a slice before the slices it depends on pass their checks.",
    "- Do not implement non-goals. Surface blockers and repo-specific assumptions before editing.",
    "- Report files changed, checks run and their results, and remaining risks for each slice.",
    ...(bundle.strict
      ? [
          "- Strict mode: review trust boundaries, run negative tests for access denial and malformed input, and keep security-relevant work pending when checks fail or are unavailable.",
        ]
      : []),
  ].join("\n");
}

function yamlString(value: string): string {
  // JSON strings are valid YAML double-quoted scalars.
  return JSON.stringify(oneLine(value));
}

/** A Cursor project rule (.mdc) with frontmatter. */
export function renderCursorRule(bundle: PlanHandoffBundle): string {
  const frontmatter = [
    "---",
    `description: ${yamlString(`AnvilMark plan: ${bundle.plan.title}`)}`,
    "globs:",
    "alwaysApply: true",
    "---",
  ].join("\n");
  const supplied = bundle.cursorRuleMdc?.trim();
  if (supplied) {
    const body = supplied.startsWith("---")
      ? supplied
      : `${frontmatter}\n\n${supplied}`;
    return `${body}\n`;
  }
  const { plan } = bundle;
  return `${[
    frontmatter,
    "",
    `# AnvilMark plan: ${oneLine(plan.title)}`,
    "",
    `Goal: ${oneLine(plan.goal)}`,
    "",
    "Read `PLAN.md` and `.anvilmark/development/active-plan.json` before editing. Treat paths, checks and model suggestions as proposals to confirm against the code.",
    "",
    "## Architecture decisions",
    ...architectureLines(bundle),
    "",
    "## Non-goals",
    ...bullets(plan.nonGoals),
    "",
    "## Slices (in order, with recommended models)",
    ...sliceLines(bundle),
    ...(plan.security.length > 0
      ? ["", "## Security controls", ...securityLines(bundle)]
      : []),
    ...(bundle.strict
      ? [
          "",
          "Strict mode: keep security-relevant work pending until negative tests and existing security checks pass.",
        ]
      : []),
  ].join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Safe writing

/**
 * Walk `segments` below the physical project root. No component may be a
 * symbolic link; every intermediate component must be a directory (created
 * when missing, one level at a time); an existing destination must be a
 * regular file. Returns the destination path and its current content.
 */
async function prepareTarget(
  root: string,
  segments: readonly string[],
): Promise<{ path: string; display: string; current: string | null }> {
  const display = segments.join("/");
  let directory = root;
  for (const segment of segments.slice(0, -1)) {
    const next = join(directory, segment);
    const info = await lstat(next).catch(() => null);
    if (info === null) {
      await mkdir(next);
    } else if (info.isSymbolicLink()) {
      throw new ApplyPlanError(
        `refusing to write ${display}: ${next} is a symbolic link`,
      );
    } else if (!info.isDirectory()) {
      throw new ApplyPlanError(
        `refusing to write ${display}: ${next} is not a directory`,
      );
    }
    directory = next;
  }
  const path = join(directory, segments[segments.length - 1] ?? "");
  if (!path.startsWith(`${root}/`))
    throw new ApplyPlanError(`refusing to write outside ${root}: ${display}`);
  const info = await lstat(path).catch(() => null);
  if (info === null) return { path, display, current: null };
  if (info.isSymbolicLink())
    throw new ApplyPlanError(
      `refusing to write ${display}: it is a symbolic link`,
    );
  if (!info.isFile())
    throw new ApplyPlanError(
      `refusing to write ${display}: it is not a regular file`,
    );
  if (info.size > MAX_INSTRUCTION_FILE_BYTES)
    throw new ApplyPlanError(
      `refusing to rewrite ${display}: larger than ${MAX_INSTRUCTION_FILE_BYTES} bytes`,
    );
  return { path, display, current: await readFile(path, "utf8") };
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode: 0o644 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeWhole(
  root: string,
  segments: readonly string[],
  content: string,
): Promise<AppliedFile> {
  const target = await prepareTarget(root, segments);
  if (target.current === content)
    return { path: target.display, action: "unchanged" };
  await atomicWrite(target.path, content);
  return {
    path: target.display,
    action: target.current === null ? "created" : "updated",
  };
}

/** Remove any plan markers from supplied content so blocks never nest. */
function stripMarkers(body: string): string {
  return body
    .split(PLAN_BLOCK_START)
    .join("")
    .split(PLAN_BLOCK_END)
    .join("")
    .trim();
}

/**
 * Replace (or append) the marked plan block, keeping everything outside it
 * byte for byte.
 */
export function upsertPlanBlock(
  existing: string | null,
  body: string,
  heading?: string,
): string {
  const block = `${PLAN_BLOCK_START}\n${stripMarkers(body)}\n${PLAN_BLOCK_END}`;
  if (existing === null || existing.trim() === "") {
    return `${heading && !body.trimStart().startsWith("#") ? `${heading}\n\n` : ""}${block}\n`;
  }
  const start = existing.indexOf(PLAN_BLOCK_START);
  const end =
    start === -1
      ? -1
      : existing.indexOf(PLAN_BLOCK_END, start + PLAN_BLOCK_START.length);
  if (start === -1 && existing.includes(PLAN_BLOCK_END)) {
    throw new ApplyPlanError(
      `found ${PLAN_BLOCK_END} without ${PLAN_BLOCK_START}; fix the markers by hand`,
    );
  }
  if (start !== -1 && end === -1) {
    throw new ApplyPlanError(
      `found ${PLAN_BLOCK_START} without ${PLAN_BLOCK_END}; fix the markers by hand`,
    );
  }
  if (start === -1) {
    return `${existing.replace(/\s+$/, "")}\n\n${block}\n`;
  }
  return `${existing.slice(0, start)}${block}${existing.slice(end + PLAN_BLOCK_END.length)}`;
}

async function writeBlock(
  root: string,
  segments: readonly string[],
  body: string,
  heading?: string,
): Promise<AppliedFile> {
  const target = await prepareTarget(root, segments);
  let next: string;
  try {
    next = upsertPlanBlock(target.current, body, heading);
  } catch (error) {
    if (error instanceof ApplyPlanError)
      throw new ApplyPlanError(`${target.display}: ${error.message}`);
    throw error;
  }
  if (target.current === next)
    return { path: target.display, action: "unchanged" };
  await atomicWrite(target.path, next);
  return {
    path: target.display,
    action: target.current === null ? "created" : "updated",
  };
}
