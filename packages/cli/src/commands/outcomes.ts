import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { z } from "zod";

import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  writeJson,
} from "./common.js";
import {
  SLICE_OUTCOMES,
  inspectPath,
  readRepoFile,
  writeRepoJson,
} from "./slice-storage.js";
import { runSliceGit, SliceId } from "./verify-slice.js";

const OUTCOMES_USAGE =
  "Usage: anvilmark outcomes [-C DIR] [--sync-git] [--write] [--json]";
const STORAGE = ".anvilmark/development";
const SUMMARY = STORAGE + "/outcomes-summary.json";
const Model = z.string().regex(/^[\w./:-]{1,120}$/);
const Provider = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,79}$/);
const Category = z.enum([
  "architecture",
  "backend",
  "frontend",
  "tests",
  "general",
]);
export type OutcomeTaskCategory = z.infer<typeof Category>;

const PathPrefix = z
  .string()
  .regex(/^[a-zA-Z0-9._/-]{1,120}$/)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.endsWith("/") &&
      !p.includes("\\") &&
      !p.split("/").includes(".."),
    "Invalid repository path prefix",
  );

const Count = z.int().nonnegative();
const Ratio = z.number().min(0).max(1);
const DateTime = z.iso.datetime({ offset: true });
const Status = z.enum(["accepted", "rejected", "failed"]);
const MAX_LOG_BYTES = 32 * 1024 * 1024;

export function inferDominantPathPrefix(
  paths: readonly string[],
): string | undefined {
  const counts = new Map<string, number>();
  let validCount = 0;
  for (const raw of paths) {
    const clean = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!clean || clean.startsWith("/") || clean.includes("..")) continue;
    const parts = clean.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    validCount += 1;
    const prefix =
      (parts[0] === "packages" ||
        parts[0] === "apps" ||
        parts[0] === "services" ||
        parts[0] === "libs" ||
        parts[0] === "crates") &&
      parts[1]
        ? `${parts[0]}/${parts[1]}`
        : parts[0] === "src" && parts.length >= 3 && parts[1]
          ? `src/${parts[1]}`
          : parts[0]!;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  if (validCount === 0 || counts.size === 0) return undefined;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top || top[1] / validCount < 0.6) return undefined;
  return PathPrefix.safeParse(top[0]).success ? top[0] : undefined;
}

export function inferOutcomeCategoryFromPaths(
  paths: readonly string[],
  hintText = "",
): OutcomeTaskCategory {
  const joined = `${paths.join(" ")} ${hintText}`;
  if (
    paths.length > 0 &&
    paths.every((p) =>
      /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(tests?|__tests__|e2e)\//i.test(p),
    )
  ) {
    return "tests";
  }
  if (
    /\b(auth|rbac|jwt|oauth|hmac|crypto|conformance|drift|contract|adr|security)\b/i.test(
      joined,
    )
  ) {
    return "architecture";
  }
  const uiCount = paths.filter((p) =>
    /\.(tsx|jsx|css|scss|vue|svelte)$|(^|\/)(components|pages)\//i.test(p),
  ).length;
  if (paths.length > 0 && uiCount / paths.length >= 0.5) {
    return "frontend";
  }
  if (
    paths.some((p) =>
      /\.(sql|prisma|py|rs|go)$|(^|\/)(api|server|cli|db|migrations|commands|mcp)\//i.test(
        p,
      ),
    )
  ) {
    return "backend";
  }
  return "general";
}

export const SliceOutcomeInputSchema = z.strictObject({
  slice_id: SliceId,
  status: Status,
  configured_model: Model,
  served_model: Model.optional(),
  provider: Provider.optional(),
  task_category: Category.optional(),
  path_prefix: PathPrefix.optional(),
  attempts: z.int().positive(),
  retries: Count,
  input_tokens: Count.optional(),
  output_tokens: Count.optional(),
  rework_ratio: Ratio.optional(),
  verification_passed: z.boolean().optional(),
  observed_usd: z.number().nonnegative().optional(),
});

const SliceOutcomeRecordSchema = SliceOutcomeInputSchema.extend({
  id: z.uuid(),
  recorded_at: DateTime,
  verified_at: DateTime.optional(),
  plan_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  verification_passed: z.boolean(),
}).refine(
  (record) =>
    record.retries < record.attempts &&
    (record.status !== "accepted" || record.verification_passed),
  "Invalid attempt counts or accepted verification",
);

type SliceOutcome = z.infer<typeof SliceOutcomeRecordSchema>;
export type SliceOutcomeInput = z.infer<typeof SliceOutcomeInputSchema>;

export async function readSliceOutcomes(root: string): Promise<SliceOutcome[]> {
  const log = await readRepoFile(root, SLICE_OUTCOMES, MAX_LOG_BYTES);
  if (log === null) return [];
  return log
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => SliceOutcomeRecordSchema.parse(JSON.parse(line)));
}

export async function appendSliceOutcome(
  root: string,
  input: SliceOutcomeInput,
  verificationPassed: boolean,
  at: string,
  provenance?: { planSha256: string; verifiedAt: string },
): Promise<SliceOutcome> {
  const record = SliceOutcomeRecordSchema.parse({
    ...input,
    id: randomUUID(),
    recorded_at: at,
    verification_passed: verificationPassed,
    ...(provenance
      ? {
          plan_sha256: provenance.planSha256,
          verified_at: provenance.verifiedAt,
        }
      : {}),
  });
  await inspectPath(root, dirname(SLICE_OUTCOMES), true, true);
  await inspectPath(root, SLICE_OUTCOMES);
  const handle = await open(
    join(root, SLICE_OUTCOMES),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_APPEND |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const line = Buffer.from(JSON.stringify(record) + "\n");
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size + line.length > MAX_LOG_BYTES
    )
      throw new Error("Outcome log is unsafe or full");
    if ((await handle.write(line)).bytesWritten !== line.length)
      throw new Error("Incomplete outcome append");
  } finally {
    await handle.close();
  }
  return record;
}

const ModelSummarySchema = z.strictObject({
  model: Model,
  provider: Provider.optional(),
  taskCategory: Category.optional(),
  pathPrefix: PathPrefix.optional(),
  attempts: Count,
  acceptedFirstPass: Count,
  acceptedAfterRetry: Count,
  rejected: Count,
  meanRetries: z.number().nonnegative(),
  meanReworkRatio: Ratio,
  meanInputTokens: z.number().nonnegative(),
  meanOutputTokens: z.number().nonnegative(),
  observedUsdPerAccepted: z.number().nonnegative().nullable().optional(),
  lastObservedAt: DateTime,
});

export const RepoOutcomesSummarySchema = z.strictObject({
  schemaVersion: z.literal("anvilmark.outcomes-summary.v1"),
  generatedAt: DateTime,
  repoName: z.string(),
  totalRecordedRuns: Count,
  models: z.array(ModelSummarySchema),
});
export type RepoOutcomesSummary = z.infer<typeof RepoOutcomesSummarySchema>;

interface Sample {
  model: string;
  provider?: string | undefined;
  category?: z.infer<typeof Category> | undefined;
  pathPrefix?: string | undefined;
  date: string;
  attempts: number;
  retries: number;
  status?: z.infer<typeof Status> | undefined;
  input?: number | undefined;
  output?: number | undefined;
  rework?: number | undefined;
  usd?: number | undefined;
}

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const DevelopmentRun = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[\w-]+$/),
  plan_hash: Hash,
  configured_model: Model,
  candidate_id: z.string(),
  base_commit: z.string(),
  prompt_sha256: z.string(),
  finished_at: DateTime,
  approval_at_start: z.string(),
  approval_actor_at_start: z.string().nullable().optional(),
  agent_exit_code: z.int().nullable(),
  changed_paths: z.array(z.string()),
  checks: z.array(z.object({ exit_code: z.int().nullable() })),
  architecture_check: z.object({ violations: z.array(z.string()) }).optional(),
  model_events: z.array(z.object({ model: Model })),
  usage: z.object({ input_tokens: Count, output_tokens: Count }),
  usage_reported_turns: Count.optional(),
});

const DevelopmentReview = z.object({
  run_id: z.string(),
  run_hash: Hash,
  decision: z.enum(["accepted", "rejected"]).optional(),
  actor: z.string(),
});

const ArchivedPlan = z.object({
  task: z.object({ profile: z.object({ kind: z.string() }).optional() }),
  candidates: z.array(
    z.object({
      id: z.string(),
      model: Model,
      provider_evidence: z.object({ value: Provider }).optional(),
    }),
  ),
});

async function readJson(root: string, path: string): Promise<unknown> {
  const raw = await readRepoFile(root, path, 16 * 1024 * 1024);
  return raw === null ? null : JSON.parse(raw);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function developmentSamples(
  root: string,
): Promise<{ count: number; samples: Sample[] }> {
  const directory = await inspectPath(root, STORAGE + "/runs", true);
  if (!directory) return { count: 0, samples: [] };
  const runFiles = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const entries = await Promise.all(
    runFiles.map(async (file) => {
      const raw = await readJson(root, STORAGE + "/runs/" + file);
      const run = DevelopmentRun.parse(raw);
      if (file !== run.id + ".json")
        throw new Error("Development run id does not match its filename");
      return { run, hash: digest(raw) };
    }),
  );
  entries.sort(
    (left, right) =>
      Date.parse(left.run.finished_at) - Date.parse(right.run.finished_at),
  );
  const history = new Map<string, number>();
  const samples: Sample[] = [];
  for (const { run, hash } of entries) {
    if (
      run.approval_at_start !== "current" ||
      run.approval_actor_at_start === "agent_test_operator"
    )
      continue;
    const rawReview = await readJson(
      root,
      STORAGE + "/reviews/" + run.id + ".json",
    );
    const review =
      rawReview === null ? null : DevelopmentReview.parse(rawReview);
    if (
      review &&
      (review.run_id !== run.id ||
        review.run_hash !== hash ||
        review.actor !== "interactive_local_operator")
    )
      continue;
    const reported = [...new Set(run.model_events.map(({ model }) => model))];
    if (reported.length > 1) continue;
    const model = reported[0] ?? run.configured_model;
    const rawPlan = await readJson(
      root,
      STORAGE + "/plans/" + run.plan_hash + ".json",
    );
    const plan =
      rawPlan && digest(rawPlan) === run.plan_hash
        ? ArchivedPlan.parse(rawPlan)
        : null;
    const candidate = plan?.candidates.find(
      ({ id }) => id === run.candidate_id,
    );
    const kind = plan?.task.profile?.kind;
    const provider =
      candidate?.model === model
        ? candidate.provider_evidence?.value
        : undefined;
    const verified =
      run.agent_exit_code === 0 &&
      run.changed_paths.length > 0 &&
      run.checks.every(({ exit_code }) => exit_code === 0) &&
      !run.architecture_check?.violations.length;
    const key = JSON.stringify([
      run.plan_hash,
      run.base_commit,
      run.prompt_sha256,
      run.candidate_id,
      model,
    ]);
    const retries = history.get(key) ?? 0;
    history.set(key, retries + 1);
    samples.push({
      model,
      provider,
      date: run.finished_at,
      attempts: 1,
      retries,
      category:
        kind === "architecture"
          ? "architecture"
          : kind === "test"
            ? "tests"
            : "general",
      status:
        review?.decision === "rejected"
          ? "rejected"
          : !verified
            ? "failed"
            : review
              ? "accepted"
              : undefined,
      ...(run.usage_reported_turns === 0
        ? {}
        : { input: run.usage.input_tokens, output: run.usage.output_tokens }),
    });
  }
  return { count: entries.length, samples };
}

export async function outcomesRepoName(root: string): Promise<string> {
  const manifest = z
    .object({ name: Model })
    .safeParse(await readJson(root, "package.json").catch(() => null));
  return manifest.success ? manifest.data.name : basename(root);
}

function mean(
  rows: Sample[],
  field: "retries" | "rework" | "input" | "output",
) {
  const values = rows.flatMap((row) => row[field] ?? []);
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

export async function aggregateOutcomes(
  directory: string,
  now = new Date().toISOString(),
): Promise<RepoOutcomesSummary> {
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Expected a real repository directory");
  const root = await realpath(directory);
  const [legacy, records, repoName] = await Promise.all([
    developmentSamples(root),
    readSliceOutcomes(root),
    outcomesRepoName(root),
  ]);
  const samples = [
    ...legacy.samples,
    ...records.map((record): Sample => ({
      model: record.served_model ?? record.configured_model,
      provider:
        record.served_model && record.served_model !== record.configured_model
          ? undefined
          : record.provider,
      category: record.task_category,
      pathPrefix: record.path_prefix,
      date: record.recorded_at,
      attempts: record.attempts,
      retries: record.retries,
      status: record.status,
      input: record.input_tokens,
      output: record.output_tokens,
      rework: record.rework_ratio,
      usd: record.observed_usd,
    })),
  ];
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = JSON.stringify(
      sample.pathPrefix !== undefined
        ? [sample.model, sample.provider, sample.category, sample.pathPrefix]
        : [sample.model, sample.provider, sample.category],
    );
    const group = groups.get(key);
    if (group) group.push(sample);
    else groups.set(key, [sample]);
  }
  return RepoOutcomesSummarySchema.parse({
    schemaVersion: "anvilmark.outcomes-summary.v1",
    generatedAt: now,
    repoName,
    totalRecordedRuns: legacy.count + records.length,
    models: [...groups.keys()].sort().map((key) => {
      const rows = groups.get(key)!;
      const { model, provider, category, pathPrefix } = rows[0]!;
      const accepted = rows.filter(({ status }) => status === "accepted");
      const terminal = rows.filter(({ status }) => status !== undefined);
      const observedUsdPerAccepted =
        accepted.length && terminal.every(({ usd }) => usd !== undefined)
          ? terminal.reduce((sum, { usd }) => sum + (usd ?? 0), 0) /
            accepted.length
          : null;
      return {
        model,
        ...(provider === undefined ? {} : { provider }),
        ...(category === undefined ? {} : { taskCategory: category }),
        ...(pathPrefix === undefined ? {} : { pathPrefix }),
        attempts: rows.reduce((sum, row) => sum + row.attempts, 0),
        acceptedFirstPass: accepted.filter(
          ({ retries, attempts }) => retries === 0 && attempts === 1,
        ).length,
        acceptedAfterRetry: accepted.filter(
          ({ retries, attempts }) => retries > 0 || attempts > 1,
        ).length,
        rejected: terminal.length - accepted.length,
        meanRetries: mean(rows, "retries"),
        meanReworkRatio: mean(accepted, "rework"),
        meanInputTokens: mean(rows, "input"),
        meanOutputTokens: mean(rows, "output"),
        observedUsdPerAccepted,
        lastObservedAt: rows.reduce(
          (latest, row) =>
            Date.parse(latest) > Date.parse(row.date) ? latest : row.date,
          rows[0]!.date,
        ),
      };
    }),
  });
}

export async function syncGitAttributedOutcomes(
  directory: string,
  now = new Date().toISOString(),
): Promise<number> {
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Expected a real repository directory");
  const root = await realpath(directory);
  const existing = await readSliceOutcomes(root);
  const seenSliceIds = new Set(existing.map((r) => r.slice_id));

  const rawLog = await runSliceGit(root, [
    "log",
    "--no-merges",
    "--max-count=50",
    "--format=%H%x00%P%x00%s%x00%b%x1e",
  ]).catch(() => "");

  if (!rawLog.trim()) return 0;

  let added = 0;
  for (const entry of rawLog.split("\x1e")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [commitSha, parentsRaw, subject, body = ""] = trimmed.split("\0");
    if (!commitSha || !parentsRaw || !subject) continue;
    const parentSha = parentsRaw.trim().split(/\s+/)[0];
    if (!parentSha) continue;

    const modelMatch = `${subject}\n${body}`.match(
      /(?:AnvilMark-Model|Model-Used):\s*([\w./:-]{1,120})/i,
    );
    const modelId = modelMatch?.[1]?.trim();
    if (!modelId || !Model.safeParse(modelId).success) continue;

    const sliceId = `git-${commitSha.slice(0, 12)}`;
    if (!SliceId.safeParse(sliceId).success || seenSliceIds.has(sliceId)) {
      continue;
    }

    const touchedRaw = await runSliceGit(root, [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      parentSha,
      commitSha,
    ]).catch(() => "");
    const touched = touchedRaw.split("\0").filter(Boolean);
    if (touched.length === 0) continue;

    // Measure post-commit human churn across those touched files up to HEAD
    const commitStat = await runSliceGit(root, [
      "diff",
      "--numstat",
      parentSha,
      commitSha,
      "--",
      ...touched,
    ]).catch(() => "");
    const laterStat = await runSliceGit(root, [
      "diff",
      "--numstat",
      commitSha,
      "HEAD",
      "--",
      ...touched,
    ]).catch(() => "");

    const sumAddedAndDeleted = (statText: string) =>
      statText
        .split(/\r?\n/)
        .filter(Boolean)
        .reduce((acc, row) => {
          const [a, d] = row.split(/\t/);
          const add = Number.parseInt(a ?? "0", 10);
          const del = Number.parseInt(d ?? "0", 10);
          return (
            acc +
            (Number.isFinite(add) ? add : 0) +
            (Number.isFinite(del) ? del : 0)
          );
        }, 0);

    const authoredLines = Math.max(1, sumAddedAndDeleted(commitStat));
    const churnLines = sumAddedAndDeleted(laterStat);
    const reworkRatio = Number(
      Math.min(1, Math.max(0, churnLines / (authoredLines * 2))).toFixed(4),
    );

    const category = inferOutcomeCategoryFromPaths(touched, subject);
    const pathPrefix = inferDominantPathPrefix(touched);

    await appendSliceOutcome(
      root,
      {
        slice_id: sliceId,
        status: "accepted",
        configured_model: modelId,
        served_model: modelId,
        task_category: category,
        ...(pathPrefix ? { path_prefix: pathPrefix } : {}),
        attempts: 1,
        retries: 0,
        rework_ratio: reworkRatio,
        verification_passed: true,
      },
      true,
      now,
    );
    seenSliceIds.add(sliceId);
    added += 1;
  }

  return added;
}

export async function outcomesCommand({ args, io }: CommandContext) {
  const parsed = parse(
    args,
    { write: { type: "boolean" }, "sync-git": { type: "boolean" } },
    OUTCOMES_USAGE,
  );
  if (flag(parsed, "help")) {
    io.stdout(OUTCOMES_USAGE + "\n");
    return EXIT.ok;
  }
  if (parsed.positionals.length)
    throw new UsageError("Unexpected positional argument", OUTCOMES_USAGE);
  const root = projectDirectory(io, parsed);
  if (flag(parsed, "sync-git")) {
    await syncGitAttributedOutcomes(root, io.clock());
  }
  const summary = await aggregateOutcomes(root, io.clock());
  if (flag(parsed, "write"))
    await writeRepoJson(await realpath(root), SUMMARY, summary);
  if (flag(parsed, "json")) writeJson(io, summary);
  else {
    io.stdout(
      summary.repoName + " · " + summary.totalRecordedRuns + " recorded runs\n",
    );
    for (const model of summary.models)
      io.stdout(
        "  " +
          model.model +
          ": " +
          model.attempts +
          " attempts, " +
          model.acceptedFirstPass +
          " accepted first pass, " +
          model.acceptedAfterRetry +
          " accepted after retry\n",
      );
  }
  return EXIT.ok;
}
