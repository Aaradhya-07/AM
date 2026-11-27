import { execFile, spawn } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import { basename, posix, resolve } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { sanitizeText } from "@anvilmark/adapters";
import type { SliceVerificationReport } from "@anvilmark/conformance";
import { z } from "zod";

import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  requiredOption,
  stringOption,
  writeJson,
} from "./common.js";
import {
  SLICE_PROMPT,
  WORKTREE_META,
  readRegisteredWorktree,
  sliceDigest,
} from "./slice-worktree.js";
import type { PlanHandoffBundle } from "./apply-plan.js";
import {
  matchesEndpoint,
  matchesFlow,
  observeArchitecture,
} from "./architecture-observations.js";
import {
  ACTIVE_PLAN,
  SLICE_OUTCOMES,
  fromRoot,
  inspectPath,
  loadSlicePlan,
  readRepoFile,
  repoPath,
} from "./slice-storage.js";

export type { SliceVerificationReport } from "@anvilmark/conformance";

export const VERIFY_SLICE_USAGE =
  "Usage: anvilmark verify-slice --slice <id> [--plan FILE] [--no-checks] [-C DIR] [--json]";
export const SliceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

const exec = promisify(execFile);

export async function runSliceGit(
  root: string,
  args: string[],
): Promise<string> {
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith("GIT_")) delete env[key];
  try {
    return (
      await exec(
        "git",
        ["-c", "core.fsmonitor=false", "--literal-pathspecs", ...args],
        {
          cwd: root,
          env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
          timeout: 30_000,
          maxBuffer: 16 * 1024 * 1024,
        },
      )
    ).stdout;
  } catch {
    throw new Error(
      "Git command failed: " + (args[0] === "-c" ? args[2] : args[0]),
    );
  }
}

export async function sliceGitRoot(directory: string): Promise<string> {
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Expected a real repository directory");
  const root = await realpath(directory);
  if ((await lstat(resolve(root, ".git"))).isSymbolicLink())
    throw new Error("Git metadata cannot be a symbolic link");
  if (
    (await runSliceGit(root, ["rev-parse", "--show-toplevel"])).trimEnd() !==
    root
  )
    throw new Error("Project directory must be the Git repository root");
  return root;
}

async function changes(
  root: string,
  violations: SliceVerificationReport["violations"],
  baseline?: string,
  ignored?: ReadonlySet<string>,
) {
  const status = await runSliceGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--no-renames",
    "--untracked-files=all",
  ]);
  const paths = status
    .split("\0")
    .filter(Boolean)
    .filter((line) => !line.startsWith("?? ") || !ignored?.has(line.slice(3)))
    .map((line) => line.slice(3));
  if (baseline) {
    paths.push(
      ...(
        await runSliceGit(root, [
          "diff",
          "--name-only",
          "--no-renames",
          "-z",
          baseline,
          "HEAD",
        ])
      )
        .split("\0")
        .filter(Boolean),
    );
  }
  const files = [...new Set(paths)].sort();
  const index = new Map<string, string[]>();
  for (const entry of (await runSliceGit(root, ["ls-files", "--stage", "-z"]))
    .split("\0")
    .filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    index.set(path, [...(index.get(path) ?? []), entry.slice(0, tab)]);
  }
  const safe = new Set<string>();
  const visible: string[] = [];
  for (const path of files) {
    try {
      repoPath(path);
      if (path.includes("\ufffd"))
        throw new Error("File name is not valid UTF-8");
      visible.push(path);
      await inspectPath(root, path);
      if (
        index
          .get(path)
          ?.some((entry) => !/^100(?:644|755) [a-f0-9]+ 0$/.test(entry))
      )
        throw new Error("Unsafe index entry");
      safe.add(path);
    } catch {
      violations.push({
        kind: "forbidden_file",
        ...(visible.at(-1) === path ? { path } : {}),
        detail: "Changed path is unsafe, unresolved, or is not a regular file",
      });
    }
  }
  return { visible, safe, index };
}

const dependencies = z.record(z.string(), z.string()).default({});
const Manifest = z.object({
  dependencies,
  devDependencies: dependencies,
  optionalDependencies: dependencies,
});

function dependencySections(raw: string | null) {
  return Manifest.parse(raw === null ? {} : JSON.parse(raw));
}

async function dependencyChanged(
  root: string,
  file: string,
  staged: string | undefined,
  base: string | null,
) {
  const entry = base
    ? (await runSliceGit(root, ["ls-tree", "-z", base, "--", file])).split(
        "\0",
      )[0]
    : undefined;
  const object = entry
    ? /^100(?:644|755) blob ([a-f0-9]+)\t/.exec(entry)?.[1]
    : undefined;
  if (entry && !object) return true;
  const readBlob = (oid: string | undefined) =>
    oid ? runSliceGit(root, ["cat-file", "blob", oid]) : Promise.resolve(null);
  const [before, index, after] = await Promise.all([
    readBlob(object),
    readBlob(staged?.split(" ")[1]),
    readRepoFile(root, file),
  ]);
  try {
    const original = dependencySections(before);
    return (
      !isDeepStrictEqual(original, dependencySections(index)) ||
      !isDeepStrictEqual(original, dependencySections(after))
    );
  } catch {
    return true;
  }
}

// Legacy checks are often prose. These exact command forms explicitly invoke
// local project checks without passing any arguments through a shell.
const SAFE_CHECK =
  /^(?:(?:npm|pnpm|yarn|bun) (?:test|run (?:test(?::[\w-]+)?|check|lint|typecheck|build))|pnpm --filter [@a-zA-Z0-9/_-]+ (?:test|lint|typecheck|build)|git diff --check|cargo test|go test \.\/\.\.\.)$/;

async function runCheck(
  root: string,
  command: string,
  shell: boolean,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<SliceVerificationReport["checkResults"][number]> {
  const start = Date.now();
  if (signal?.aborted)
    return {
      command,
      exitCode: 130,
      durationMs: 0,
      outputExcerpt: "Check cancelled.",
    };
  const [program, ...args] = command.split(" ");
  if (!shell && program === "git")
    args.splice(1, 0, "--no-ext-diff", "--no-textconv");
  const grouped = process.platform !== "win32";
  return new Promise((done) => {
    const child = spawn(shell ? command : program!, shell ? [] : args, {
      cwd: root,
      shell,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let outputBytes = 0;
    let finished = false;
    const finish = (exitCode: number, reason: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      done({
        command,
        exitCode,
        durationMs: Date.now() - start,
        outputExcerpt:
          reason +
          (outputBytes ? " (" + outputBytes + " output bytes withheld)" : ""),
      });
    };
    const terminate = (code: number, reason: string) => {
      if (child.pid) {
        try {
          if (grouped) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          // It may already have exited.
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      finish(code, reason);
    };
    const abort = () => terminate(130, "Check cancelled.");
    const timer = setTimeout(
      () => terminate(124, "Check timed out."),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 1024 * 1024)
          terminate(125, "Check exceeded its output limit.");
      });
    }
    child.once("error", () => finish(127, "Check could not be started."));
    child.once("close", (exitCode) =>
      finish(
        exitCode ?? 1,
        exitCode === 0 ? "" : "Check exited unsuccessfully.",
      ),
    );
  });
}

function matchesSliceGlob(path: string, glob: string): boolean {
  if (typeof posix.matchesGlob !== "function")
    throw new Error("Slice globs require Node.js 20.17 or newer");
  return posix.matchesGlob(path, glob);
}

type GitChanges = Awaited<ReturnType<typeof changes>>;

async function conformance(
  root: string,
  bundle: PlanHandoffBundle,
  task: PlanHandoffBundle["plan"]["tasks"][number],
  violations: SliceVerificationReport["violations"],
  baseline?: string,
  ignored?: ReadonlySet<string>,
): Promise<GitChanges> {
  const changed = await changes(root, violations, baseline, ignored);
  const { contract } = task;
  if (!contract) return changed;
  for (const path of changed.visible) {
    if (
      contract.allowedGlobs.length &&
      !contract.allowedGlobs.some((glob) => matchesSliceGlob(path, glob))
    )
      violations.push({
        kind: "out_of_scope_file",
        path,
        detail: "Changed file is outside the permitted globs",
      });
    if (contract.forbiddenGlobs.some((glob) => matchesSliceGlob(path, glob)))
      violations.push({
        kind: "forbidden_file",
        path,
        detail: "Changed file matches a forbidden glob",
      });
  }
  if (!contract.allowDependencyChanges) {
    const targets = [...changed.safe].filter(
      (path) => basename(path) === "package.json",
    );
    if (targets.length) {
      const base =
        baseline ??
        (await runSliceGit(root, ["rev-parse", "--verify", "HEAD"])
          .then((ref) => ref.trim())
          .catch(() => null));
      for (const path of targets) {
        if (
          await dependencyChanged(
            root,
            path,
            changed.index.get(path)?.[0],
            base,
          )
        )
          violations.push({
            kind: "unapproved_dependency_change",
            path,
            detail: "Dependency declarations changed or could not be verified",
          });
      }
    }
  }
  if (
    [...changed.safe].some((path) => /\.(?:[cm]?[jt]sx?|py|go|rs)$/.test(path))
  ) {
    for (const edge of observeArchitecture(root)) {
      if (!changed.safe.has(edge.from) || edge.kind === "sdk") continue;
      const planned = bundle.plan.flows.filter((flow) =>
        matchesFlow(flow, edge),
      );
      const crosses =
        edge.kind !== "import" ||
        bundle.plan.flows.some((flow) => matchesEndpoint(flow.to, edge.to));
      const permitted = planned.some(({ boundary }) =>
        contract.expectedBoundaries.includes(boundary),
      );
      if (crosses && !permitted)
        violations.push({
          kind: "boundary_violation",
          path: edge.from,
          detail: "Observed an undeclared or disallowed trust boundary",
        });
    }
  }
  return changed;
}

interface VerifyOptions {
  root: string;
  sliceId: string;
  planPath?: string | undefined;
  bundle?: PlanHandoffBundle;
  runChecks?: boolean;
  allowShell?: boolean;
  approvedCommands?: ReadonlySet<string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  clock?: () => string;
}

export async function verifySlice(
  options: VerifyOptions,
): Promise<SliceVerificationReport> {
  const root = await sliceGitRoot(options.root);
  const sliceId = SliceId.parse(options.sliceId);
  const bundle =
    options.bundle ?? (await loadSlicePlan(root, options.planPath));
  if (!bundle) throw new Error("No active plan");
  const task = bundle.plan.tasks.find(({ id }) => id === sliceId);
  if (!task) throw new Error("Unknown slice id");

  const metadata = await readRegisteredWorktree(root);
  const ignored = new Set<string>([
    SLICE_OUTCOMES,
    ".anvilmark/development/current-slice.md",
    ".anvilmark/development/outcomes-summary.json",
    ".anvilmark/development/bridge.json",
  ]);
  if (metadata) {
    const branch = (
      await runSliceGit(root, ["symbolic-ref", "--short", "HEAD"])
    ).trim();
    if (
      metadata.sliceId !== sliceId ||
      metadata.branch !== branch ||
      branch !== "anvilmark/slice/" + sliceId ||
      metadata.planSha256 !== sliceDigest(JSON.stringify(bundle))
    )
      throw new Error(
        "Slice worktree metadata does not match the plan or branch",
      );
    await runSliceGit(root, [
      "merge-base",
      "--is-ancestor",
      metadata.baseCommit,
      "HEAD",
    ]);
    ignored.add(WORKTREE_META);
    const localPlan = await loadSlicePlan(root);
    if (
      localPlan &&
      metadata.planSha256 === sliceDigest(JSON.stringify(localPlan))
    )
      ignored.add(ACTIVE_PLAN);
    const prompt = await readRepoFile(root, SLICE_PROMPT);
    if (prompt !== null && metadata.promptSha256 === sliceDigest(prompt))
      ignored.add(SLICE_PROMPT);
  } else {
    ignored.add(ACTIVE_PLAN);
    ignored.add(".anvilmark/development/plan.json");
    ignored.add(".anvilmark/development/PLAN.md");
    ignored.add(".anvilmark/development/master-prompt.md");
  }
  const baseline = metadata?.baseCommit;
  const violations: SliceVerificationReport["violations"] = [];
  const checkResults: SliceVerificationReport["checkResults"] = [];
  const head = () =>
    runSliceGit(root, ["rev-parse", "--verify", "HEAD"]).catch(() => null);
  const initialHead = await head();
  const before = await conformance(
    root,
    bundle,
    task,
    violations,
    baseline,
    ignored,
  );
  let changedFiles = before.visible;
  if (options.runChecks !== false && violations.length === 0) {
    const explicit = task.contract?.verificationCommands ?? [];
    const approved = (command: string) =>
      options.approvedCommands?.has(command) === true;
    const commands = explicit.length
      ? explicit
      : task.checks.filter(
          (check) => SAFE_CHECK.test(check) || approved(check),
        );
    const deadline = Date.now() + 120_000;
    for (const command of commands) {
      const trustedShell =
        approved(command) ||
        (explicit.length > 0 && options.allowShell === true);
      const remaining = deadline - Date.now();
      const result =
        remaining <= 0
          ? {
              command,
              exitCode: 124,
              durationMs: 0,
              outputExcerpt:
                "Verification exceeded its total check time limit.",
            }
          : trustedShell || SAFE_CHECK.test(command)
            ? await runCheck(
                root,
                command,
                trustedShell,
                Math.min(options.timeoutMs ?? 60_000, remaining),
                options.signal,
              )
            : {
                command,
                exitCode: 126,
                durationMs: 0,
                outputExcerpt: "Check requires local shell approval.",
              };
      const displayCommand = sanitizeText(command).text;
      checkResults.push({ ...result, command: displayCommand });
      if (result.exitCode !== 0)
        violations.push({
          kind: "check_command_failed",
          command: displayCommand,
          detail: result.outputExcerpt,
        });
      if (options.signal?.aborted || remaining <= 0) break;
    }
    if (checkResults.length) {
      if (
        initialHead !== (await head()) ||
        JSON.stringify(metadata) !==
          JSON.stringify(await readRegisteredWorktree(root)) ||
        (options.bundle === undefined &&
          JSON.stringify(bundle) !==
            JSON.stringify(await loadSlicePlan(root, options.planPath)))
      ) {
        violations.push({
          kind: "check_command_failed",
          detail:
            "The Git baseline or verification plan changed while checks ran",
        });
      }
      ignored.delete(SLICE_PROMPT);
      if (metadata) {
        const updated = await readRepoFile(root, SLICE_PROMPT);
        if (updated !== null && metadata.promptSha256 === sliceDigest(updated))
          ignored.add(SLICE_PROMPT);
      }
      changedFiles = (
        await conformance(root, bundle, task, violations, baseline, ignored)
      ).visible;
    }
  }
  return {
    schemaVersion: "anvilmark.slice-verification.v1",
    verifiedAt: options.clock?.() ?? new Date().toISOString(),
    sliceId,
    passed: violations.length === 0,
    changedFiles,
    violations,
    checkResults,
  };
}

export async function verifySliceCommand({ args, io }: CommandContext) {
  const parsed = parse(
    args,
    {
      slice: { type: "string" },
      plan: { type: "string" },
      "no-checks": { type: "boolean" },
    },
    VERIFY_SLICE_USAGE,
  );
  if (flag(parsed, "help")) {
    io.stdout(VERIFY_SLICE_USAGE + "\n");
    return EXIT.ok;
  }
  if (parsed.positionals.length)
    throw new UsageError("Unexpected positional argument", VERIFY_SLICE_USAGE);
  const root = projectDirectory(io, parsed);
  const file = stringOption(parsed, "plan");
  if (file && file.split(/[/\\]/).includes(".."))
    throw new UsageError("Unsafe plan path", VERIFY_SLICE_USAGE);
  const report = await verifySlice({
    root,
    sliceId: requiredOption(parsed, "slice", VERIFY_SLICE_USAGE),
    planPath:
      file === undefined ? undefined : fromRoot(root, resolve(root, file)),
    runChecks: !flag(parsed, "no-checks"),
    allowShell: true,
    signal: io.signal,
    clock: io.clock,
  });
  if (flag(parsed, "json")) writeJson(io, report);
  else
    io.stdout(
      report.sliceId +
        (report.passed ? " passed" : " failed") +
        "\n" +
        report.violations
          .map(({ path, detail }) => (path ? path + ": " : "") + detail + "\n")
          .join(""),
    );
  return report.passed ? EXIT.ok : EXIT.failed;
}
