import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";

import { EXIT } from "../io.js";
import type { PlanHandoffBundle, ReviewerFamilySchema } from "./apply-plan.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  numberOption,
  parse,
  projectDirectory,
  writeJson,
} from "./common.js";
import { sliceWaves } from "./slice-dag.js";
import {
  ACTIVE_PLAN,
  inspectPath,
  loadSlicePlan,
  writeRepoJson,
} from "./slice-storage.js";
import {
  SLICE_PROMPT,
  WORKTREE_META,
  WORKTREE_PARENT,
  readRegisteredWorktree,
  worktreeRegistration,
  sliceDigest,
  type WorktreeMetadata,
} from "./slice-worktree.js";
import {
  runSliceGit,
  sliceGitRoot,
  verifySlice,
  type SliceVerificationReport,
} from "./verify-slice.js";

const USAGE =
  "Usage: anvilmark orchestrate [-C DIR] [--dry-run] [--prepare-worktrees] [--max-parallel N] [--json]";
type Family = z.infer<typeof ReviewerFamilySchema>;
type Candidate = PlanHandoffBundle["candidates"][number];
type Task = PlanHandoffBundle["plan"]["tasks"][number];

function family(candidate: Candidate): Family | null {
  if (candidate.billing === "local") return "local_oss";
  const name = candidate.provider.toLowerCase().replace(/[^a-z]/g, "");
  if (name.startsWith("openai")) return "openai";
  if (name.startsWith("anthropic")) return "anthropic";
  if (name.startsWith("google") || name === "deepmind") return "google";
  if (
    ["local", "localoss", "ollama", "llamacpp", "selfhosted", "oss"].includes(
      name,
    )
  )
    return "local_oss";
  return null;
}

function inferredFamily(model: string): Family | null {
  if (/^(openai\/|gpt-|o[134](?:-|$))/i.test(model)) return "openai";
  if (/^(anthropic\/|claude-)/i.test(model)) return "anthropic";
  if (/^(google\/|gemini-)/i.test(model)) return "google";
  if (/^(qwen|gemma|llama|mistral|deepseek)/i.test(model)) return "local_oss";
  return null;
}

function route(task: Task, candidates: Candidate[]) {
  const authors = [
    ...new Set(
      candidates
        .filter(({ model }) => model === task.model)
        .map(
          (candidate) => family(candidate) ?? inferredFamily(candidate.model),
        ),
    ),
  ];
  if (authors.length > 1)
    throw new Error(
      "Authoring model has ambiguous provider families for " + task.id,
    );
  const authorFamily = authors[0] ?? inferredFamily(task.model);
  const available = [
    ...new Set(
      candidates.flatMap(
        (candidate) =>
          family(candidate) ?? inferredFamily(candidate.model) ?? [],
      ),
    ),
  ].sort();
  if (authorFamily === null && available.length > 1)
    throw new Error("Author provider family is unknown for " + task.id);
  const preferred = task.contract?.reviewerFamily;
  const alternatives =
    authorFamily === null
      ? []
      : available.filter((value) => value !== authorFamily);
  const reviewerFamily =
    preferred && alternatives.includes(preferred)
      ? preferred
      : (alternatives[0] ?? null);
  return { authorFamily, reviewerFamily };
}

export function planOrchestration(
  bundle: PlanHandoffBundle,
  baseCommit: string,
  maxParallel: number,
) {
  const waves = sliceWaves(bundle.plan.tasks, maxParallel);
  const tasks = new Map(bundle.plan.tasks.map((task) => [task.id, task]));
  const planSha256 = sliceDigest(JSON.stringify(bundle));
  return {
    baseCommit,
    maxParallel,
    waves,
    slices: waves.flatMap((wave, index) =>
      wave.map((sliceId) => {
        const task = tasks.get(sliceId)!;
        return {
          sliceId,
          wave: index + 1,
          dependsOn: task.dependsOn,
          model: task.model,
          ...route(task, bundle.candidates),
          branch: "anvilmark/slice/" + sliceId,
          worktree: WORKTREE_PARENT + "/" + sliceId,
          contract: task.contract ?? null,
        };
      }),
    ),
    planSha256,
  };
}

function renderPrompt(
  bundle: PlanHandoffBundle,
  task: Task,
  reviewer: Family | null,
  baseCommit: string,
) {
  return [
    "# " + task.title,
    "",
    "Plan goal. " + bundle.plan.goal,
    "",
    task.outcome,
    "",
    "## Acceptance criteria",
    ...task.acceptance.map((line) => "- " + line),
    "",
    "## Verification",
    ...task.checks.map((line) => "- " + line),
    "",
    "## Dependencies and review",
    "- Prerequisite slices: " + (task.dependsOn.join(", ") || "none"),
    "- Baseline commit: " + baseCommit,
    "- Configured model: " + task.model,
    "- Reviewer family: " + (reviewer ?? "unassigned"),
    "- Run anvilmark verify-slice --slice " + task.id + " before review.",
    "",
    "## Slice contract",
    "```json",
    JSON.stringify(task.contract ?? null, null, 2),
    "```",
    "",
  ].join("\n");
}

function registeredWorktrees(raw: string) {
  return new Map(
    raw
      .split("\0\0")
      .filter(Boolean)
      .flatMap((record) => {
        const fields = record.split("\0");
        const path = fields[0]?.replace(/^worktree /, "");
        const branch = fields
          .find((field) => field.startsWith("branch "))
          ?.slice("branch refs/heads/".length);
        return path ? [[path, branch]] : [];
      }),
  );
}

export async function orchestrate(
  directory: string,
  options: {
    dryRun?: boolean;
    prepareWorktrees?: boolean;
    maxParallel?: number;
    clock?: () => string;
    signal?: AbortSignal;
  } = {},
) {
  const root = await sliceGitRoot(directory);
  const bundle = await loadSlicePlan(root);
  if (!bundle) throw new Error("No active plan");
  const baseCommit = (
    await runSliceGit(root, ["rev-parse", "--verify", "HEAD"])
  ).trim();
  const plan = planOrchestration(
    bundle,
    baseCommit,
    options.maxParallel ?? bundle.plan.tasks.length,
  );
  const prepared: string[] = [];
  const verification: SliceVerificationReport[] = [];
  if (options.dryRun) return { ...plan, prepared, verification };

  const registered = registeredWorktrees(
    await runSliceGit(root, ["worktree", "list", "--porcelain", "-z"]),
  );
  const existing = new Map<string, WorktreeMetadata>();
  const pending = [];
  for (const slice of plan.slices) {
    const path = join(root, slice.worktree);
    const checkout = await inspectPath(root, slice.worktree, true);
    if (checkout === null && !registered.has(path)) {
      if ([...registered.values()].includes(slice.branch))
        throw new Error(
          "Slice branch is already checked out elsewhere: " + slice.branch,
        );
      if (await inspectPath(root, worktreeRegistration(slice.sliceId)))
        throw new Error(
          "A creation record already exists for " + slice.sliceId,
        );
      pending.push(slice);
      continue;
    }
    if (!checkout || registered.get(path) !== slice.branch)
      throw new Error("Worktree path is already in use: " + slice.worktree);
    const metadata = await readRegisteredWorktree(checkout);
    if (
      !metadata ||
      metadata.sliceId !== slice.sliceId ||
      metadata.branch !== slice.branch ||
      metadata.planSha256 !== plan.planSha256
    )
      throw new Error(
        "Worktree metadata does not match the active slice: " + slice.sliceId,
      );
    existing.set(slice.sliceId, metadata);
  }

  if (options.prepareWorktrees && pending.length) {
    const reserved = [SLICE_PROMPT, WORKTREE_META, ACTIVE_PLAN];
    if (
      await runSliceGit(root, ["ls-tree", "-z", baseCommit, "--", ...reserved])
    )
      throw new Error("The baseline tracks a reserved slice worktree file");
    await inspectPath(root, WORKTREE_PARENT, true, true);
    for (const slice of pending) {
      const path = join(root, slice.worktree);
      const task = bundle.plan.tasks.find(({ id }) => id === slice.sliceId)!;
      const prompt = renderPrompt(
        bundle,
        task,
        slice.reviewerFamily,
        baseCommit,
      );
      await runSliceGit(root, [
        "-c",
        "core.hooksPath=/dev/null",
        "worktree",
        "add",
        "-b",
        slice.branch,
        "--",
        path,
        baseCommit,
      ]);
      try {
        await writeFile(join(path, SLICE_PROMPT), prompt, {
          flag: "wx",
          mode: 0o600,
        });
        await writeRepoJson(path, ACTIVE_PLAN, bundle);
        const metadata = {
          schemaVersion: "anvilmark.slice-worktree.v1",
          sliceId: slice.sliceId,
          branch: slice.branch,
          baseCommit,
          planSha256: plan.planSha256,
          promptSha256: sliceDigest(prompt),
          contract: slice.contract,
          reviewerFamily: slice.reviewerFamily,
        } satisfies WorktreeMetadata;
        await writeRepoJson(path, WORKTREE_META, metadata);
        await writeRepoJson(
          root,
          worktreeRegistration(slice.sliceId),
          metadata,
        );
      } catch (error) {
        await runSliceGit(root, ["worktree", "remove", "--force", "--", path]);
        await runSliceGit(root, ["branch", "-d", "--", slice.branch]);
        throw error;
      }
      prepared.push(slice.sliceId);
    }
  }
  for (const slice of plan.slices) {
    const metadata = existing.get(slice.sliceId);
    if (!metadata) continue;
    const worktree = join(root, slice.worktree);
    const head = (
      await runSliceGit(worktree, ["rev-parse", "--verify", "HEAD"])
    ).trim();
    if (head === metadata.baseCommit) continue;
    verification.push(
      await verifySlice({
        root: worktree,
        sliceId: slice.sliceId,
        bundle,
        runChecks: true,
        allowShell: true,
        ...(options.clock ? { clock: options.clock } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      }),
    );
  }
  return { ...plan, prepared, verification };
}

export async function orchestrateCommand({ args, io }: CommandContext) {
  const parsed = parse(
    args,
    {
      "dry-run": { type: "boolean" },
      "prepare-worktrees": { type: "boolean" },
      "max-parallel": { type: "string" },
    },
    USAGE,
  );
  if (flag(parsed, "help")) {
    io.stdout(USAGE + "\n");
    return EXIT.ok;
  }
  if (parsed.positionals.length)
    throw new UsageError("Unexpected positional argument", USAGE);
  const maxParallel = numberOption(parsed, "max-parallel", USAGE);
  if (
    maxParallel !== undefined &&
    (!Number.isSafeInteger(maxParallel) || maxParallel < 1)
  )
    throw new UsageError("--max-parallel must be a positive integer", USAGE);
  const report = await orchestrate(projectDirectory(io, parsed), {
    dryRun: flag(parsed, "dry-run"),
    prepareWorktrees: flag(parsed, "prepare-worktrees"),
    ...(maxParallel === undefined ? {} : { maxParallel }),
    clock: io.clock,
    signal: io.signal,
  });
  if (flag(parsed, "json") || flag(parsed, "dry-run")) writeJson(io, report);
  else {
    report.waves.forEach((wave, index) =>
      io.stdout("Wave " + (index + 1) + " · " + wave.join(", ") + "\n"),
    );
    for (const sliceId of report.prepared)
      io.stdout("Prepared " + sliceId + "\n");
    for (const result of report.verification)
      io.stdout(result.sliceId + (result.passed ? " passed\n" : " failed\n"));
  }
  return report.verification.every(({ passed }) => passed)
    ? EXIT.ok
    : EXIT.failed;
}
