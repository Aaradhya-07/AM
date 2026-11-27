import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { z } from "zod";
import { sliceWaves } from "./slice-dag.js";

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

export const ReviewerFamilySchema = z.enum([
  "anthropic",
  "openai",
  "google",
  "local_oss",
]);

const glob = text.refine(
  (pattern) =>
    !pattern.includes("\0") &&
    !pattern.includes("\\") &&
    !pattern.startsWith("/") &&
    !/^[A-Za-z]:/.test(pattern) &&
    !pattern.split("/").some((segment) => segment === ".."),
  "expected a POSIX repository-relative glob",
);

export const SliceContractSchema = z.strictObject({
  allowedGlobs: z.array(glob).max(50),
  forbiddenGlobs: z.array(glob).max(50),
  verificationCommands: z
    .array(
      text.refine(
        (command) => !command.includes("\0"),
        "Invalid check command",
      ),
    )
    .max(50),
  allowDependencyChanges: z.boolean(),
  expectedBoundaries: list,
  reviewerFamily: ReviewerFamilySchema.optional(),
});
export type SliceContractSpec = z.infer<typeof SliceContractSchema>;

export const ProjectScaleSchema = z.enum([
  "micro",
  "small_app",
  "multi_feature",
  "complex_system",
]);

export const SliceKindSchema = z.enum([
  "schema_types",
  "crud_ui",
  "feature_integration",
  "auth_security",
  "concurrency_algorithms",
  "tests_docs",
]);

export const SliceComplexitySchema = z.enum([
  "trivial",
  "low",
  "medium",
  "high",
]);

/** Mirrors the Studio planner output (packages/web/lib/planner.ts). */
export const HandoffPlan = z.strictObject({
  title: text,
  goal: text,
  users: text,
  projectScale: ProjectScaleSchema.optional(),
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
        kind: SliceKindSchema.optional(),
        complexity: SliceComplexitySchema.optional(),
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
        contract: SliceContractSchema.optional(),
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
    quotaMode: z.enum(["plenty", "conserve", "exhausted"]).optional(),
    masterPrompt: z.string().trim().min(1).max(500_000),
    claudeMdSection: section.optional(),
    cursorRuleMdc: section.optional(),
    codexAgentsSection: section.optional(),
  })
  .superRefine((bundle, context) => {
    try {
      sliceWaves(bundle.plan.tasks);
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["plan", "tasks"],
        message:
          error instanceof Error ? error.message : "Invalid slice dependencies",
      });
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
  const active = [".anvilmark", "development", "active-plan.json"];
  const createdDirectories: string[] = [];
  const lockPath = join(root, ".anvilmark", "development", ".apply-plan.lock");
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let applied = false;
  try {
    await prepareTarget(
      root,
      [".anvilmark", "development", ".apply-plan.lock"],
      createdDirectories,
    );
    handle = await open(lockPath, "wx", 0o600);
    const plan = await prepareTarget(root, active);
    const manifest: PendingWrite[] = [
      { target: plan, content: JSON.stringify(bundle, null, 2) + "\n" },
      await prepareBlock(
        root,
        ["PLAN.md"],
        bundle.masterPrompt.trim(),
        "# Plan",
      ),
    ];
    for (const target of targets) {
      if (target === "claude") {
        manifest.push(
          await prepareBlock(
            root,
            ["CLAUDE.md"],
            bundle.claudeMdSection?.trim() || renderInstructionSection(bundle),
          ),
        );
      } else if (target === "codex") {
        manifest.push(
          await prepareBlock(
            root,
            ["AGENTS.md"],
            bundle.codexAgentsSection?.trim() ||
              renderInstructionSection(bundle),
          ),
        );
      } else {
        manifest.push({
          target: await prepareTarget(
            root,
            [".cursor", "rules", "anvilmark-plan.mdc"],
            createdDirectories,
          ),
          content: renderCursorRule(bundle),
        });
      }
    }
    // Publish the active-plan pointer last so clients only read a fully applied plan.
    await publishPlan(root, [...manifest.slice(1), manifest[0]!]);
    applied = true;
    return manifest.map(({ target, content }) => ({
      path: target.display,
      action:
        target.current === content
          ? "unchanged"
          : target.current === null
            ? "created"
            : "updated",
    }));
  } finally {
    if (handle) {
      await handle.close();
      await rm(lockPath, { force: true });
    }
    if (!applied) {
      for (const directory of createdDirectories.reverse()) {
        await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? ""))
            throw error;
        });
      }
    }
  }
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
type PlanTargetFile = {
  path: string;
  display: string;
  current: string | null;
  mode: number;
};

interface PendingWrite {
  target: PlanTargetFile;
  content: string;
}

async function prepareTarget(
  root: string,
  segments: readonly string[],
  createdDirectories?: string[],
): Promise<PlanTargetFile> {
  const display = segments.join("/");
  let directory = root;
  for (const segment of segments.slice(0, -1)) {
    const next = join(directory, segment);
    const info = await safeLstat(next);
    if (info === null) {
      if (!createdDirectories)
        throw new ApplyPlanError(
          "Plan target directory disappeared: " + display,
        );
      try {
        await mkdir(next, { mode: 0o700 });
        createdDirectories.push(next);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (!(await lstat(next)).isDirectory())
        throw new ApplyPlanError("unsafe plan target directory");
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
  if (relative(root, path).startsWith(".."))
    throw new ApplyPlanError(`refusing to write outside ${root}: ${display}`);
  const info = await safeLstat(path);
  if (info === null)
    return {
      path,
      display,
      current: null,
      mode: display.endsWith("active-plan.json") ? 0o600 : 0o644,
    };
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
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size > MAX_INSTRUCTION_FILE_BYTES
    )
      throw new ApplyPlanError("Unsafe plan target: " + display);
    return {
      path,
      display,
      current: await handle.readFile("utf8"),
      mode: opened.mode & 0o777,
    };
  } finally {
    await handle.close();
  }
}

function safeLstat(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
}

async function publishPlan(
  root: string,
  manifest: readonly PendingWrite[],
): Promise<void> {
  const staged: Array<{
    target: PlanTargetFile;
    content: string;
    temp: string;
    backup: string | null;
  }> = [];
  const published: typeof staged = [];
  const retain = new Set<string>();
  try {
    for (const { target, content } of manifest) {
      if (target.current === content) continue;
      const temp = target.path + "." + randomUUID() + ".tmp";
      const backup = target.current === null ? null : temp + ".original";
      staged.push({ target, content, temp, backup });
      await writeFile(temp, content, { flag: "wx", mode: target.mode });
      if (backup !== null && target.current !== null)
        await writeFile(backup, target.current, {
          flag: "wx",
          mode: target.mode,
        });
    }
    for (const entry of staged) {
      const current = await prepareTarget(
        root,
        entry.target.display.split("/"),
      );
      if (current.current !== entry.target.current)
        throw new ApplyPlanError(
          "Plan target changed while applying the bundle: " + current.display,
        );
      await rename(entry.temp, entry.target.path);
      published.push(entry);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const entry of published.reverse()) {
      try {
        const current = await prepareTarget(
          root,
          entry.target.display.split("/"),
        );
        if (current.current !== entry.content)
          throw new Error("Plan target changed after publication");
        if (entry.backup === null) await rm(entry.target.path);
        else await rename(entry.backup, entry.target.path);
      } catch {
        if (entry.backup) retain.add(entry.backup);
        rollbackFailures.push(entry.target.display);
      }
    }
    if (rollbackFailures.length)
      throw new ApplyPlanError(
        "Plan rollback needs attention for " + rollbackFailures.join(", "),
      );
    throw error;
  } finally {
    await Promise.all(
      staged
        .flatMap(({ temp, backup }) => [
          temp,
          ...(backup === null ? [] : [backup]),
        ])
        .filter((path) => !retain.has(path))
        .map((path) => rm(path, { force: true })),
    );
  }
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

async function prepareBlock(
  root: string,
  segments: readonly string[],
  body: string,
  heading?: string,
): Promise<PendingWrite> {
  const target = await prepareTarget(root, segments);
  let next: string;
  try {
    next = upsertPlanBlock(target.current, body, heading);
  } catch (error) {
    if (error instanceof ApplyPlanError)
      throw new ApplyPlanError(`${target.display}: ${error.message}`);
    throw error;
  }
  return { target, content: next };
}
