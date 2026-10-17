import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { sanitizeText } from "@anvilmark/adapters";
import {
  DevelopmentEvidenceCatalog,
  openModelCatalog,
  type DevelopmentEvidenceRow,
} from "@anvilmark/model-catalog";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  Cancelled,
  UsageError,
  flag,
  parse,
  projectDirectory,
  requiredOption,
  writeJson,
} from "./common.js";

export const DEVELOPMENT_USAGE = `anvilmark development <plan|approve|recommend|run|review|report> [options]

  plan --file PLAN.json       validate and save a development plan in .anvilmark/development/
  approve                    interactively approve the exact architecture and task plan
  recommend [--catalog-db FILE]
                             compare eligible setups with mapped research and local outcomes
  run --model ID --prompt-file FILE
                             run Codex CLI, collect metadata and run the plan's checks
  review --run ID [--decision reject --reason TEXT]
                             interactively accept or reject the exact run
  report                     show the connected plan, comparison and recorded runs

Options: --project-dir DIR (-C), --json (report), --help`;

const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const Nonempty = z.string().trim().min(1);
const Check = z.strictObject({
  name: Id,
  argv: z.array(Nonempty).min(1),
});
const TaskProfile = z.strictObject({
  kind: z.enum([
    "architecture",
    "bug",
    "feature",
    "refactor",
    "test",
    "review",
  ]),
  languages: z.array(Nonempty).min(1),
  risk: z.enum(["low", "medium", "high"]),
});
const Candidate = z.strictObject({
  id: Id,
  agent: z.literal("codex_cli"),
  model: Nonempty,
  expected_input_tokens: z.number().int().nonnegative(),
  expected_output_tokens: z.number().int().nonnegative(),
  billing: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("subscription") }),
    z.strictObject({
      mode: z.literal("api_estimate"),
      input_usd_per_million: z.number().nonnegative(),
      cached_input_usd_per_million: z.number().nonnegative().optional(),
      output_usd_per_million: z.number().nonnegative(),
      source: Nonempty,
    }),
  ]),
  quality_evidence: z.enum(["none", "public", "project_task"]),
  evidence_note: Nonempty,
  research_mapping: z
    .strictObject({
      source_key: Nonempty,
      source_model_id: Nonempty,
      relevance_note: Nonempty,
      identity_note: Nonempty,
    })
    .optional(),
});
const Plan = z.strictObject({
  schema_version: z.literal(1),
  architecture: z.strictObject({ id: Id, summary: Nonempty }),
  task: z.strictObject({
    id: Id,
    summary: Nonempty,
    profile: TaskProfile.optional(),
    checks: z.array(Check).min(1),
  }),
  restrictions: z.strictObject({
    allowed_models: z.array(Nonempty).min(1),
    max_estimated_usd: z.number().nonnegative().nullable(),
  }),
  candidates: z.array(Candidate).min(2),
});
type DevelopmentPlan = z.infer<typeof Plan>;
type DevelopmentCandidate = DevelopmentPlan["candidates"][number];

interface Approval {
  readonly plan_hash: string;
  readonly approved_at: string;
  readonly actor: "interactive_local_operator";
}
interface TokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}
interface CheckResult {
  name: string;
  argv: string[];
  exit_code: number | null;
  duration_ms: number;
}
interface DevelopmentRun {
  schema_version: 1;
  id: string;
  plan_hash: string;
  approval_at_start: "current" | "missing_or_stale";
  architecture_id: string;
  task_id: string;
  candidate_id: string;
  configured_model: string;
  model_events: Array<{ event_index: number; model: string }>;
  model_identity:
    "tool_reported" | "tool_reported_multiple" | "configured_only";
  codex_thread_id: string | null;
  prompt_sha256: string;
  started_at: string;
  finished_at: string;
  agent_exit_code: number | null;
  agent_error: string | null;
  event_count: number;
  event_parse_errors: number;
  event_stream_sha256: string;
  usage: TokenUsage;
  billing: "subscription_allowance" | "api_rate_estimate";
  estimated_usd_from_observed_tokens: number | null;
  base_commit: string;
  baseline_clean: boolean;
  changed_paths: string[];
  change_sha256: string;
  checks: CheckResult[];
}
interface RunReview {
  readonly run_id: string;
  readonly run_hash: string;
  readonly decision?: "accepted" | "rejected";
  readonly accepted_at?: string;
  readonly reviewed_at?: string;
  readonly reason?: string;
  readonly actor: "interactive_local_operator";
}

const zeroUsage = (): TokenUsage => ({
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
});
const digest = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
const directory = (root: string): string =>
  join(root, ".anvilmark", "development");
const planFile = (root: string): string => join(directory(root), "plan.json");
const approvalFile = (root: string): string =>
  join(directory(root), "approval.json");
const runsDirectory = (root: string): string => join(directory(root), "runs");
const reviewsDirectory = (root: string): string =>
  join(directory(root), "reviews");
const plansDirectory = (root: string): string => join(directory(root), "plans");
const evidenceFile = (root: string): string =>
  join(directory(root), "development-evidence.sqlite");

function profileKey(
  profile: z.infer<typeof TaskProfile>,
  architectureId: string,
): string {
  return JSON.stringify({
    architecture_id: architectureId,
    kind: profile.kind,
    languages: [
      ...new Set(profile.languages.map((item) => item.toLowerCase())),
    ].sort(),
    risk: profile.risk,
  });
}

async function safeDirectory(root: string, child?: string): Promise<void> {
  const paths = [join(root, ".anvilmark"), directory(root)];
  if (child) paths.push(child);
  for (const path of paths) {
    await mkdir(path, { recursive: false, mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(
        `development storage path is not a real directory: ${path}`,
      );
  }
}

async function verifyStorage(root: string): Promise<void> {
  for (const path of [join(root, ".anvilmark"), directory(root)]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(
        `development storage path is not a real directory: ${path}`,
      );
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function loadPlan(
  root: string,
): Promise<{ plan: DevelopmentPlan; hash: string }> {
  await verifyStorage(root);
  if ((await lstat(planFile(root))).isSymbolicLink())
    throw new Error("development plan cannot be a symbolic link");
  const raw = await readFile(planFile(root), "utf8");
  const plan = Plan.parse(JSON.parse(raw));
  return { plan, hash: digest(JSON.stringify(plan)) };
}

async function approvalStanding(
  root: string,
  hash: string,
): Promise<"current" | "missing_or_stale"> {
  try {
    if ((await lstat(approvalFile(root))).isSymbolicLink())
      throw new Error("development approval cannot be a symbolic link");
    const approval = JSON.parse(
      await readFile(approvalFile(root), "utf8"),
    ) as Approval;
    return approval.plan_hash === hash ? "current" : "missing_or_stale";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return "missing_or_stale";
    throw error;
  }
}

function estimate(candidate: DevelopmentCandidate): number | null {
  if (candidate.billing.mode === "subscription") return null;
  return (
    (candidate.expected_input_tokens * candidate.billing.input_usd_per_million +
      candidate.expected_output_tokens *
        candidate.billing.output_usd_per_million) /
    1_000_000
  );
}

function observedApiEstimate(
  candidate: DevelopmentCandidate,
  usage: TokenUsage,
  modelRateApplicable: boolean,
): number | null {
  const bill = candidate.billing;
  if (bill.mode === "subscription" || !modelRateApplicable) return null;
  if (usage.cached_input_tokens > usage.input_tokens) return null;
  if (
    usage.cached_input_tokens > 0 &&
    bill.cached_input_usd_per_million === undefined
  )
    return null;
  return (
    ((usage.input_tokens - usage.cached_input_tokens) *
      bill.input_usd_per_million +
      usage.cached_input_tokens *
        (bill.cached_input_usd_per_million ?? bill.input_usd_per_million) +
      usage.output_tokens * bill.output_usd_per_million) /
    1_000_000
  );
}

function comparison(plan: DevelopmentPlan): Array<{
  id: string;
  model: string;
  standing: "eligible" | "excluded" | "unknown";
  reason: string;
  expected_tokens: number;
  projected_usd: number | null;
  quality_evidence: string;
}> {
  return plan.candidates.map((candidate) => {
    const projected = estimate(candidate);
    const allowed = plan.restrictions.allowed_models.includes(candidate.model);
    const overBudget =
      projected !== null &&
      plan.restrictions.max_estimated_usd !== null &&
      projected > plan.restrictions.max_estimated_usd;
    const budgetUnknown =
      projected === null && plan.restrictions.max_estimated_usd !== null;
    return {
      id: candidate.id,
      model: candidate.model,
      standing:
        !allowed || overBudget
          ? "excluded"
          : budgetUnknown
            ? "unknown"
            : "eligible",
      reason: !allowed
        ? "model excluded by plan"
        : overBudget
          ? "projected API cost exceeds plan limit"
          : budgetUnknown
            ? "cash budget cannot be checked against subscription billing"
            : candidate.billing.mode === "subscription"
              ? "allowed; incremental cash cost unknown under subscription"
              : "allowed; API cost is an estimate from declared usage and rates",
      expected_tokens:
        candidate.expected_input_tokens + candidate.expected_output_tokens,
      projected_usd: projected,
      quality_evidence: candidate.quality_evidence,
    };
  });
}

function suggestion(plan: DevelopmentPlan): string {
  const eligible = comparison(plan).filter(
    (candidate) => candidate.standing === "eligible",
  );
  if (eligible.length === 0)
    return "No eligible candidate; revise restrictions or options.";
  const byCost = eligible.filter(
    (candidate) => candidate.projected_usd !== null,
  );
  if (byCost.length === eligible.length) {
    const lowest = [...byCost].sort(
      (a, b) => (a.projected_usd ?? 0) - (b.projected_usd ?? 0),
    )[0];
    return `Provisional cost-first option: ${lowest?.id ?? "unknown"}; projected API cost uses declared usage and rates. Task quality is not verified by this pilot.`;
  }
  if (byCost.length === 0) {
    const lowest = [...eligible].sort(
      (a, b) => a.expected_tokens - b.expected_tokens,
    )[0];
    return `Provisional allowance-use starting point: ${lowest?.id ?? "unknown"}; expected tokens are declared, cash savings and task quality are unknown.`;
  }
  return "Eligible options have different billing bases; this pilot cannot rank their total cash cost or task quality.";
}

function printPlan(
  context: CommandContext,
  plan: DevelopmentPlan,
  hash: string,
): void {
  context.io.stdout(
    `Architecture: ${plan.architecture.id} — ${plan.architecture.summary}\n`,
  );
  context.io.stdout(`Task: ${plan.task.id} — ${plan.task.summary}\n`);
  context.io.stdout(`Plan hash: ${hash}\n`);
  for (const option of comparison(plan)) {
    const cost =
      option.projected_usd === null
        ? "cash cost unknown"
        : `$${option.projected_usd.toFixed(4)} projected`;
    context.io.stdout(
      `  ${option.id}: ${option.model}; ${option.standing}; ${option.expected_tokens} expected tokens; ${cost}; quality evidence ${option.quality_evidence}. ${option.reason}\n`,
    );
  }
  context.io.stdout(`${suggestion(plan)}\n`);
}

async function commandOutput(
  program: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on(
      "data",
      (chunk: Buffer) => (stdout += chunk.toString("utf8")),
    );
    child.stderr.on(
      "data",
      (chunk: Buffer) => (stderr += chunk.toString("utf8")),
    );
    child.on("error", reject);
    child.on("close", (code) =>
      resolveResult({
        code,
        stdout: code === 0 ? stdout : stderr.slice(0, 500),
      }),
    );
  });
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await commandOutput("git", args, root);
  if (result.code !== 0)
    throw new Error(`Git observation failed: ${result.stdout.trim()}`);
  return result.stdout;
}

/** Extract only structured metadata. Agent messages, prompt bodies and tool arguments are discarded. */
export function collectCodexMetadata(lines: readonly string[]): {
  threadId: string | null;
  modelEvents: Array<{ event_index: number; model: string }>;
  eventCount: number;
  parseErrors: number;
  usage: TokenUsage;
} {
  let threadId: string | null = null;
  const modelEvents: Array<{ event_index: number; model: string }> = [];
  let eventCount = 0;
  let parseErrors = 0;
  const usage = zeroUsage();
  for (const line of lines) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      )
        throw new Error("not an event");
      event = parsed as Record<string, unknown>;
    } catch {
      parseErrors += 1;
      continue;
    }
    eventCount += 1;
    if (event.type === "thread.started" && typeof event.thread_id === "string")
      threadId = event.thread_id;
    if (event.type === "model.changed" && typeof event.model === "string")
      modelEvents.push({ event_index: eventCount, model: event.model });
    if (
      event.type === "turn.completed" &&
      event.usage !== null &&
      typeof event.usage === "object"
    ) {
      const values = event.usage as Record<string, unknown>;
      for (const key of Object.keys(usage) as (keyof TokenUsage)[]) {
        const value = values[key];
        if (
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0
        )
          usage[key] += value;
      }
    }
  }
  return { threadId, modelEvents, eventCount, parseErrors, usage };
}

async function runCodex(
  root: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  binary = "codex",
): Promise<{
  code: number | null;
  lines: string[];
  errorSummary: string | null;
}> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      binary,
      [
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "--cd",
        root,
        "--model",
        model,
        "-",
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"], signal },
    );
    const lines: string[] = [];
    let pending = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const pieces = pending.split("\n");
      pending = pieces.pop() ?? "";
      lines.push(...pieces);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (pending) lines.push(pending);
      resolveResult({
        code,
        lines,
        errorSummary:
          code === 0 ? null : sanitizeText(stderr.slice(-500)).text.trim(),
      });
    });
    child.stdin.end(prompt);
  });
}

async function runCheck(
  root: string,
  check: z.infer<typeof Check>,
): Promise<CheckResult> {
  const start = Date.now();
  let code: number | null = null;
  try {
    code = (await commandOutput(check.argv[0] ?? "", check.argv.slice(1), root))
      .code;
  } catch {
    // Keep the failed check in the run record, including missing executables.
  }
  return {
    name: check.name,
    argv: check.argv,
    exit_code: code,
    duration_ms: Date.now() - start,
  };
}

async function observedChange(
  root: string,
): Promise<{ paths: string[]; hash: string }> {
  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude).anvilmark",
  ]);
  const entries = status.split("\0").filter(Boolean);
  const paths: string[] = [];
  const untracked: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const line = entries[index] ?? "";
    const state = line.slice(0, 2);
    const path = line.slice(3);
    paths.push(path);
    if (state === "??") untracked.push(path);
    if (state.includes("R") || state.includes("C")) index += 1; // porcelain -z adds the source path
  }
  const diff = await git(root, [
    "diff",
    "--binary",
    "HEAD",
    "--",
    ".",
    ":(exclude).anvilmark",
  ]);
  const hashes: string[] = [];
  for (const path of untracked) {
    const file = resolve(root, path);
    if (!file.startsWith(`${root}/`)) continue;
    const info = await lstat(file);
    if (info.isFile() && (await realpath(file)).startsWith(`${root}/`))
      hashes.push(`${path}:${digest(await readFile(file))}`);
  }
  return { paths, hash: digest(`${diff}\n${hashes.sort().join("\n")}`) };
}

async function saveRun(root: string, run: DevelopmentRun): Promise<void> {
  await safeDirectory(root, runsDirectory(root));
  await atomicJson(join(runsDirectory(root), `${run.id}.json`), run);
}

async function loadRuns(root: string): Promise<DevelopmentRun[]> {
  let files: string[];
  try {
    files = await readdir(runsDirectory(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const runs: DevelopmentRun[] = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    if ((await lstat(join(runsDirectory(root), file))).isSymbolicLink())
      throw new Error("development run cannot be a symbolic link");
    runs.push(
      JSON.parse(
        await readFile(join(runsDirectory(root), file), "utf8"),
      ) as DevelopmentRun,
    );
  }
  return runs;
}

async function loadReview(root: string, id: string): Promise<RunReview | null> {
  try {
    if (
      (await lstat(join(reviewsDirectory(root), `${id}.json`))).isSymbolicLink()
    )
      throw new Error("development review cannot be a symbolic link");
    return JSON.parse(
      await readFile(join(reviewsDirectory(root), `${id}.json`), "utf8"),
    ) as RunReview;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function archivedPlan(
  root: string,
  hash: string,
): Promise<DevelopmentPlan | null> {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  try {
    const file = join(plansDirectory(root), `${hash}.json`);
    if ((await lstat(file)).isSymbolicLink()) return null;
    const plan = Plan.parse(JSON.parse(await readFile(file, "utf8")));
    return digest(JSON.stringify(plan)) === hash ? plan : null;
  } catch {
    return null;
  }
}

async function syncDevelopmentEvidence(root: string): Promise<{
  catalog: DevelopmentEvidenceCatalog;
  skipped: number;
}> {
  await safeDirectory(root);
  const catalog = await DevelopmentEvidenceCatalog.open(evidenceFile(root));
  try {
    const rows: DevelopmentEvidenceRow[] = [];
    let skipped = 0;
    for (const run of await loadRuns(root)) {
      const plan = await archivedPlan(root, run.plan_hash);
      const candidate = plan?.candidates.find(
        (item) =>
          item.id === run.candidate_id && item.model === run.configured_model,
      );
      if (
        !plan?.task.profile ||
        !candidate ||
        plan.task.id !== run.task_id ||
        plan.architecture.id !== run.architecture_id ||
        run.approval_at_start !== "current" ||
        run.model_identity === "tool_reported_multiple" ||
        run.model_events.some((event) => event.model !== run.configured_model)
      ) {
        skipped += 1;
        continue;
      }
      const review = await loadReview(root, run.id);
      const reviewValid =
        review !== null && review.run_hash === digest(JSON.stringify(run));
      if (review !== null && !reviewValid) {
        skipped += 1;
        continue;
      }
      const completed =
        run.agent_exit_code === 0 &&
        run.changed_paths.length > 0 &&
        run.checks.every((check) => check.exit_code === 0);
      const outcome: DevelopmentEvidenceRow["outcome"] =
        reviewValid && review?.decision === "rejected"
          ? "rejected"
          : reviewValid && completed && review?.decision !== "rejected"
            ? "accepted"
            : !completed
              ? "failed"
              : "unreviewed";
      rows.push({
        run_id: run.id,
        run_hash: digest(JSON.stringify(run)),
        plan_hash: run.plan_hash,
        profile_key: profileKey(plan.task.profile, plan.architecture.id),
        agent: candidate.agent,
        model: candidate.model,
        model_identity: run.model_identity,
        outcome,
        observed_at: run.finished_at,
        billing: run.billing,
        estimated_usd: run.estimated_usd_from_observed_tokens,
        input_tokens: run.usage.input_tokens,
        output_tokens: run.usage.output_tokens,
      });
    }
    catalog.replaceAll(rows);
    return { catalog, skipped };
  } catch (error) {
    catalog.close();
    throw error;
  }
}

function recommendation(
  plan: DevelopmentPlan,
  catalog: DevelopmentEvidenceCatalog,
) {
  const key =
    plan.task.profile && profileKey(plan.task.profile, plan.architecture.id);
  const options = comparison(plan).map((option) => {
    const candidate = plan.candidates.find((item) => item.id === option.id);
    const rows =
      key && candidate
        ? catalog.comparable(key, candidate.agent, candidate.model)
        : [];
    const final = rows.filter((row) => row.outcome !== "unreviewed");
    const accepted = final.filter((row) => row.outcome === "accepted").length;
    const rejected = final.filter((row) => row.outcome === "rejected").length;
    const failed = final.filter((row) => row.outcome === "failed").length;
    const sample_cost_per_accepted =
      accepted > 0 &&
      final.every(
        (row) =>
          row.billing === "api_rate_estimate" && row.estimated_usd !== null,
      )
        ? final.reduce((sum, row) => sum + (row.estimated_usd ?? 0), 0) /
          accepted
        : null;
    return {
      ...option,
      comparable: {
        accepted,
        rejected,
        failed,
        unreviewed: rows.length - final.length,
        configured_only: rows.filter(
          (row) => row.model_identity === "configured_only",
        ).length,
        sample_cost_per_accepted,
      },
    };
  });
  const eligible = options.filter((option) => option.standing === "eligible");
  const withFinal = eligible.filter(
    (option) =>
      option.comparable.accepted +
        option.comparable.rejected +
        option.comparable.failed >
      0,
  );
  let selection = suggestion(plan);
  if (key && withFinal.length >= 2) {
    const costComparable = withFinal.filter(
      (option) => option.comparable.sample_cost_per_accepted !== null,
    );
    if (costComparable.length === eligible.length) {
      const ordered = [...costComparable].sort(
        (a, b) =>
          (a.comparable.sample_cost_per_accepted ?? Infinity) -
          (b.comparable.sample_cost_per_accepted ?? Infinity),
      );
      selection = `Exploratory sample cost-per-accepted starting point: ${ordered[0]?.id}; these are declared-rate estimates from local runs, not measured savings or a calibrated quality forecast.`;
    } else {
      selection = `${suggestion(plan)} Comparable local outcomes exist, but billing or acceptance coverage does not support a cost-per-accepted ranking.`;
    }
  }
  return {
    profile_key: key ?? null,
    options,
    selection,
    evidence_scope:
      "same repository and architecture part; exact task kind, language set and risk",
  };
}

async function mappedResearch(plan: DevelopmentPlan, path: string | null) {
  if (path === null)
    return plan.candidates.map((candidate) => ({
      candidate_id: candidate.id,
      standing: candidate.research_mapping
        ? "catalog_not_supplied"
        : "unmapped",
      mapping: candidate.research_mapping ?? null,
      snapshot: null,
      observations: [],
    }));
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("public model catalog must be a regular existing file");
  const catalog = await openModelCatalog(path);
  try {
    return plan.candidates.map((candidate) => {
      const mapping = candidate.research_mapping;
      if (!mapping)
        return {
          candidate_id: candidate.id,
          standing: "unmapped",
          mapping: null,
          snapshot: null,
          observations: [],
        };
      const snapshot = catalog.getLatest(mapping.source_key);
      const observations = snapshot
        ? catalog
            .getObservations(snapshot.id)
            .filter((item) => item.model_id === mapping.source_model_id)
            .map((item) => ({
              kind: item.kind,
              benchmark_id: item.benchmark_id,
              score: item.score,
              verified: item.verified,
              result_source_url: item.result_source_url,
            }))
        : [];
      return {
        candidate_id: candidate.id,
        standing:
          snapshot === null
            ? "source_missing"
            : observations.length === 0
              ? "model_missing"
              : snapshot.freshness,
        mapping,
        snapshot:
          snapshot === null
            ? null
            : {
                source: snapshot.source,
                source_url: snapshot.source_url,
                fetched_at: snapshot.fetched_at,
                usage_rights: snapshot.usage_rights,
              },
        observations,
      };
    });
  } finally {
    catalog.close();
  }
}

export async function developmentCommand(
  context: CommandContext,
  sub?: string,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      file: { type: "string" },
      model: { type: "string" },
      "prompt-file": { type: "string" },
      run: { type: "string" },
      decision: { type: "string" },
      reason: { type: "string" },
      "catalog-db": { type: "string" },
    },
    DEVELOPMENT_USAGE,
  );
  if (flag(parsed, "help") || sub === undefined) {
    context.io.stdout(`${DEVELOPMENT_USAGE}\n`);
    return sub === undefined && !flag(parsed, "help") ? EXIT.usage : EXIT.ok;
  }
  if (parsed.positionals.length)
    throw new UsageError("unexpected positional argument", DEVELOPMENT_USAGE);
  const root = projectDirectory(context.io, parsed);
  if (sub === "plan") {
    const source = resolve(
      root,
      requiredOption(parsed, "file", DEVELOPMENT_USAGE),
    );
    const plan = Plan.parse(JSON.parse(await readFile(source, "utf8")));
    if (
      new Set(plan.candidates.map((candidate) => candidate.id)).size !==
        plan.candidates.length ||
      new Set(plan.candidates.map((candidate) => candidate.model)).size !==
        plan.candidates.length
    )
      throw new Error("candidate ids and model names must be unique");
    await safeDirectory(root);
    const hash = digest(JSON.stringify(plan));
    await safeDirectory(root, plansDirectory(root));
    await atomicJson(join(plansDirectory(root), `${hash}.json`), plan);
    await atomicJson(planFile(root), plan);
    printPlan(context, plan, hash);
    context.io.stdout(
      "Saved local development plan. Any previous approval of different content is stale.\n",
    );
    return EXIT.ok;
  }
  if (sub === "approve") {
    const { plan, hash } = await loadPlan(root);
    printPlan(context, plan, hash);
    if (!context.io.interactive)
      throw new Cancelled("Approval requires an interactive local terminal.");
    const answer = await context.io.prompt(
      `Type ${hash.slice(0, 12)} to approve this architecture and task plan: `,
    );
    if (answer?.trim() !== hash.slice(0, 12))
      throw new Cancelled("Plan was not approved.");
    await atomicJson(approvalFile(root), {
      plan_hash: hash,
      approved_at: context.io.clock(),
      actor: "interactive_local_operator",
    } satisfies Approval);
    context.io.stdout(`Approved plan ${hash.slice(0, 12)}.\n`);
    return EXIT.ok;
  }
  if (sub === "recommend") {
    const { plan, hash } = await loadPlan(root);
    const { catalog, skipped } = await syncDevelopmentEvidence(root);
    try {
      const result = recommendation(plan, catalog);
      const research = await mappedResearch(
        plan,
        typeof parsed.values["catalog-db"] === "string"
          ? resolve(root, parsed.values["catalog-db"])
          : null,
      );
      if (flag(parsed, "json")) {
        writeJson(context.io, {
          plan_hash: hash,
          ...result,
          research,
          excluded_historical_runs: skipped,
        });
      } else {
        context.io.stdout(`Task: ${plan.task.id}. ${result.evidence_scope}.\n`);
        for (const option of result.options) {
          const sample = option.comparable;
          const mapped = research.find(
            (item) => item.candidate_id === option.id,
          );
          context.io.stdout(
            `  ${option.id}: ${option.standing}; ${sample.accepted} accepted, ${sample.rejected} rejected, ${sample.failed} failed, ${sample.unreviewed} awaiting review; ${sample.configured_only} configured-only model identities; ${sample.sample_cost_per_accepted === null ? "sample cash cost per accepted unknown" : `$${sample.sample_cost_per_accepted.toFixed(4)} estimated sample cost per accepted`}; public mapping ${mapped?.standing ?? "unmapped"} (${mapped?.observations.length ?? 0} source observations).\n`,
          );
          if (mapped?.snapshot && mapped.mapping)
            context.io.stdout(
              `    Public source: ${mapped.snapshot.source_url} fetched ${mapped.snapshot.fetched_at}; rights ${mapped.snapshot.usage_rights ?? "source-specific"}. Identity: ${mapped.mapping.identity_note} Relevance: ${mapped.mapping.relevance_note}\n`,
            );
        }
        context.io.stdout(`${result.selection}\n`);
        if (!result.profile_key)
          context.io.stdout(
            "Add task.profile to the plan to match local outcomes.\n",
          );
        if (skipped)
          context.io.stdout(
            `${skipped} historical runs lacked a valid approved task profile and were excluded.\n`,
          );
      }
      return EXIT.ok;
    } finally {
      catalog.close();
    }
  }
  if (sub === "run") {
    const { plan, hash } = await loadPlan(root);
    const model = requiredOption(parsed, "model", DEVELOPMENT_USAGE);
    const promptPath = resolve(
      root,
      requiredOption(parsed, "prompt-file", DEVELOPMENT_USAGE),
    );
    const candidate = plan.candidates.find((option) => option.model === model);
    const option = comparison(plan).find((entry) => entry.model === model);
    if (!candidate || option?.standing !== "eligible")
      throw new Error(
        "selected model is absent, excluded, or has an unresolved hard restriction",
      );
    const prompt = await readFile(promptPath, "utf8");
    if (!prompt.trim()) throw new Error("prompt file is empty");
    const repositoryRoot = (
      await git(root, ["rev-parse", "--show-toplevel"])
    ).trim();
    if (repositoryRoot !== root)
      throw new Error("--project-dir must be the Git repository root");
    const baseCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
    const baseline = await observedChange(root);
    if (baseline.paths.length)
      throw new Error(
        "development pilot requires a clean repository outside .anvilmark",
      );
    const approval = await approvalStanding(root, hash);
    if (approval !== "current")
      context.io.stdout(
        "Architecture approval is missing or stale; this run will be marked unapproved.\n",
      );
    const started = context.io.clock();
    const runId = `${started.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const execution = await runCodex(
      root,
      model,
      prompt,
      context.io.signal,
      context.io.env.ANVILMARK_CODEX_EXECUTABLE ?? "codex",
    );
    const metadata = collectCodexMetadata(execution.lines);
    const checks: CheckResult[] = [];
    for (const check of plan.task.checks)
      checks.push(await runCheck(root, check));
    const changes = await observedChange(root);
    const bill = candidate.billing;
    const modelRateApplicable = metadata.modelEvents.every(
      (event) => event.model === model,
    );
    const run: DevelopmentRun = {
      schema_version: 1,
      id: runId,
      plan_hash: hash,
      approval_at_start: approval,
      architecture_id: plan.architecture.id,
      task_id: plan.task.id,
      candidate_id: candidate.id,
      configured_model: model,
      model_events: metadata.modelEvents,
      model_identity:
        metadata.modelEvents.length === 0
          ? "configured_only"
          : new Set(metadata.modelEvents.map((event) => event.model)).size > 1
            ? "tool_reported_multiple"
            : "tool_reported",
      codex_thread_id: metadata.threadId,
      prompt_sha256: digest(prompt),
      started_at: started,
      finished_at: context.io.clock(),
      agent_exit_code: execution.code,
      agent_error: execution.errorSummary,
      event_count: metadata.eventCount,
      event_parse_errors: metadata.parseErrors,
      event_stream_sha256: digest(execution.lines.join("\n")),
      usage: metadata.usage,
      billing:
        bill.mode === "subscription"
          ? "subscription_allowance"
          : "api_rate_estimate",
      estimated_usd_from_observed_tokens: observedApiEstimate(
        candidate,
        metadata.usage,
        modelRateApplicable,
      ),
      base_commit: baseCommit,
      baseline_clean: true,
      changed_paths: changes.paths,
      change_sha256: changes.hash,
      checks,
    };
    await saveRun(root, run);
    context.io.stdout(
      `Recorded run ${run.id}: ${run.changed_paths.length} changed paths, ${run.usage.input_tokens} input and ${run.usage.output_tokens} output tokens.\n`,
    );
    context.io.stdout(
      `Model identity: ${run.model_identity}; cash cost: ${run.estimated_usd_from_observed_tokens === null ? (bill.mode === "subscription" ? "unknown (subscription)" : !modelRateApplicable ? "unknown (reported model differs from configured rate)" : "unknown (cached-input usage or rate unavailable)") : `$${run.estimated_usd_from_observed_tokens.toFixed(4)} estimated from rates`}.\n`,
    );
    context.io.stdout(
      `Checks: ${run.checks.map((check) => `${check.name}=${check.exit_code ?? "error"}`).join(", ")}.\n`,
    );
    if (run.agent_exit_code !== 0)
      context.io.stdout(
        `Agent exited ${run.agent_exit_code ?? "without a code"}; this run did not pass.${run.agent_error ? ` ${run.agent_error}` : ""}\n`,
      );
    if (run.changed_paths.length === 0)
      context.io.stdout(
        "No code change was observed; this coding task did not pass.\n",
      );
    return run.agent_exit_code === 0 &&
      run.changed_paths.length > 0 &&
      run.checks.every((check) => check.exit_code === 0)
      ? EXIT.ok
      : EXIT.failed;
  }
  if (sub === "review") {
    const runId = requiredOption(parsed, "run", DEVELOPMENT_USAGE);
    const decision = parsed.values["decision"] ?? "accept";
    if (decision !== "accept" && decision !== "reject")
      throw new UsageError(
        "decision must be accept or reject",
        DEVELOPMENT_USAGE,
      );
    const reason =
      typeof parsed.values["reason"] === "string"
        ? parsed.values["reason"].trim()
        : undefined;
    if (decision === "reject" && !reason)
      throw new UsageError("rejection requires --reason", DEVELOPMENT_USAGE);
    if (!Id.safeParse(runId).success)
      throw new UsageError("invalid run id", DEVELOPMENT_USAGE);
    const { hash } = await loadPlan(root);
    const run = (await loadRuns(root)).find((entry) => entry.id === runId);
    if (!run) throw new Error("run not found");
    if (
      run.plan_hash !== hash ||
      run.approval_at_start !== "current" ||
      (await approvalStanding(root, hash)) !== "current"
    )
      throw new Error("run has no current architecture approval");
    if (
      decision === "accept" &&
      (run.agent_exit_code !== 0 ||
        run.changed_paths.length === 0 ||
        run.checks.some((check) => check.exit_code !== 0))
    )
      throw new Error(
        "run lacks a code change or did not complete all checks successfully",
      );
    const currentCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
    const currentChange = await observedChange(root);
    if (
      currentCommit !== run.base_commit ||
      currentChange.hash !== run.change_sha256
    )
      throw new Error(
        "repository changed since this run; review the current code first",
      );
    if (!context.io.interactive)
      throw new Cancelled("Run review requires an interactive local terminal.");
    const runHash = digest(JSON.stringify(run));
    context.io.stdout(
      `Run ${run.id}: ${run.changed_paths.join(", ") || "no changed paths"}; checks ${run.checks.map((check) => `${check.name}=${check.exit_code ?? "error"}`).join(", ")}; model identity ${run.model_identity}; cash cost ${run.estimated_usd_from_observed_tokens === null ? "unknown" : "estimated only"}.\n`,
    );
    const answer = await context.io.prompt(
      `Type ${runHash.slice(0, 12)} to ${decision} this exact run and code state: `,
    );
    if (answer?.trim() !== runHash.slice(0, 12))
      throw new Cancelled("Run was not reviewed.");
    await safeDirectory(root, reviewsDirectory(root));
    const reviewedAt = context.io.clock();
    await atomicJson(join(reviewsDirectory(root), `${run.id}.json`), {
      run_id: run.id,
      run_hash: runHash,
      decision: decision === "accept" ? "accepted" : "rejected",
      reviewed_at: reviewedAt,
      ...(decision === "accept"
        ? { accepted_at: reviewedAt }
        : { reason: reason! }),
      actor: "interactive_local_operator",
    } satisfies RunReview);
    context.io.stdout(
      `${decision === "accept" ? "Accepted" : "Rejected"} run ${run.id}.\n`,
    );
    return EXIT.ok;
  }
  if (sub === "report") {
    const { plan, hash } = await loadPlan(root);
    const approval = await approvalStanding(root, hash);
    const runs = await loadRuns(root);
    const reviews = await Promise.all(
      runs.map((run) => loadReview(root, run.id)),
    );
    const accepted = runs.some((_, index) => {
      const review = reviews[index];
      return (
        review !== null &&
        review !== undefined &&
        review.decision !== "rejected"
      );
    });
    const currentCommit = accepted
      ? (await git(root, ["rev-parse", "HEAD"])).trim()
      : null;
    const currentChange = accepted ? await observedChange(root) : null;
    const runSummaries = runs.map((run, index) => {
      const review = reviews[index];
      const review_status =
        review === null || review === undefined
          ? "pending"
          : review.decision === "rejected" &&
              review.run_hash === digest(JSON.stringify(run))
            ? "rejected"
            : review.run_hash === digest(JSON.stringify(run)) &&
                run.plan_hash === hash &&
                approval === "current" &&
                currentCommit === run.base_commit &&
                currentChange?.hash === run.change_sha256
              ? "accepted_current"
              : "accepted_stale";
      return { ...run, review_status };
    });
    if (flag(parsed, "json")) {
      writeJson(context.io, {
        plan,
        plan_hash: hash,
        approval,
        comparison: comparison(plan),
        suggestion: suggestion(plan),
        runs: runSummaries,
      });
      return EXIT.ok;
    }
    printPlan(context, plan, hash);
    context.io.stdout(
      `Approval: ${approval}. Recorded runs: ${runs.length}.\n`,
    );
    for (const run of runSummaries) {
      context.io.stdout(
        `  ${run.id}: ${run.candidate_id}; approval at start ${run.approval_at_start}; agent exit ${run.agent_exit_code ?? "unknown"}; model ${run.model_identity}; tokens ${run.usage.input_tokens} in/${run.usage.output_tokens} out; changed ${run.changed_paths.join(", ") || "none"}; checks ${run.checks.map((check) => `${check.name}=${check.exit_code ?? "error"}`).join(", ")}; review ${run.review_status}; cash ${run.estimated_usd_from_observed_tokens === null ? "unknown" : `$${run.estimated_usd_from_observed_tokens.toFixed(4)} estimated`}\n`,
      );
    }
    return EXIT.ok;
  }
  throw new UsageError(
    `unknown development subcommand "${sub}"`,
    DEVELOPMENT_USAGE,
  );
}
