import type { ProbeDependencies } from "@anvilmark/adapters";
import { hardwareSizingEvidenceProblem } from "@anvilmark/project-contract";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { sanitizeErrorMessage, sanitizeText } from "@anvilmark/adapters";
import type { ProjectContract } from "@anvilmark/project-contract";

import type { CliIo, ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines, renderIssues } from "../render.js";
import type { CommitResult, LoadedProject, StoreFs } from "../store.js";
import {
  StoreError,
  commitRevision,
  findProjectRoot,
  loadProject,
} from "../store.js";
import { reconcileApprovals } from "../workflow/decisions.js";
import { WorkflowError } from "../workflow/edit.js";

/** A command-line mistake. Exits 2 with the command's usage. */
export class UsageError extends Error {
  readonly usage: string;
  constructor(message: string, usage: string) {
    super(message);
    this.name = "UsageError";
    this.usage = usage;
  }
}

/** The user declined or cancelled. Exits 3; nothing was written. */
export class Cancelled extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Cancelled";
  }
}

export interface CommandContext {
  readonly hardwareProbeDependencies?: Partial<ProbeDependencies>;
  readonly io: CliIo;
  /** Arguments after the command (and subcommand) words. */
  readonly args: readonly string[];
  /** Seam for write-failure tests. */
  readonly storeFs?: StoreFs;
}

export type OptionSpec = Record<
  string,
  {
    readonly type: "string" | "boolean";
    readonly multiple?: boolean;
    readonly short?: string;
  }
>;

const COMMON: OptionSpec = {
  "project-dir": { type: "string", short: "C" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

export interface Parsed {
  readonly values: Record<string, string | boolean | string[] | undefined>;
  readonly positionals: readonly string[];
}

export function parse(
  args: readonly string[],
  options: OptionSpec,
  usage: string,
): Parsed {
  try {
    const result = parseArgs({
      args: [...args],
      options: { ...COMMON, ...options },
      allowPositionals: true,
      strict: true,
    });
    return {
      values: result.values as Parsed["values"],
      positionals: result.positionals,
    };
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error),
      usage,
    );
  }
}

export function stringOption(parsed: Parsed, name: string): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

export function requiredOption(
  parsed: Parsed,
  name: string,
  usage: string,
): string {
  const value = stringOption(parsed, name);
  if (value === undefined || value.trim() === "") {
    throw new UsageError(`--${name} is required`, usage);
  }
  return value;
}

export function listOption(parsed: Parsed, name: string): string[] {
  const value = parsed.values[name];
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  return raw
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function numberOption(
  parsed: Parsed,
  name: string,
  usage: string,
): number | undefined {
  const value = stringOption(parsed, name);
  if (value === undefined) {
    return undefined;
  }
  const number = Number(value);
  if (value.trim() === "" || !Number.isFinite(number)) {
    throw new UsageError(`--${name} must be a number, got "${value}"`, usage);
  }
  return number;
}

export function flag(parsed: Parsed, name: string): boolean {
  return parsed.values[name] === true;
}

export function projectDirectory(io: CliIo, parsed: Parsed): string {
  const explicit = stringOption(parsed, "project-dir");
  return resolve(io.cwd, explicit ?? ".");
}

export async function openProject(
  io: CliIo,
  parsed: Parsed,
): Promise<LoadedProject> {
  const explicit = stringOption(parsed, "project-dir");
  const root =
    explicit === undefined
      ? await findProjectRoot(io.cwd)
      : resolve(io.cwd, explicit);
  if (root === null) {
    throw new StoreError(
      `no ANVILMARK project found in ${io.cwd} or any parent directory; run "anvilmark init" first`,
    );
  }
  return loadProject(root);
}

/**
 * Reconcile approvals, then validate and commit. Prints what was saved and
 * every notice, including an approval that stopped being current.
 */
export async function commit(
  context: CommandContext,
  loaded: Pick<LoadedProject, "paths" | "digest">,
  next: ProjectContract,
  meta: {
    readonly command: string;
    readonly summary: string;
    readonly notices?: readonly string[];
    readonly provenance?: Readonly<Record<string, unknown>> | null;
  },
): Promise<CommitResult> {
  const now = context.io.clock();
  const reconciledInput = structuredClone(next);
  const sizingNotices: string[] = [];
  for (const candidate of reconciledInput.candidates) {
    for (const result of candidate.constraint_results) {
      if (result.status !== "pass" && result.status !== "fail") continue;
      const stale = result.evidence_refs
        .map((id) => reconciledInput.evidence_refs.find((e) => e.id === id))
        .filter((e) => e !== undefined)
        .find(
          (e) => hardwareSizingEvidenceProblem(e, reconciledInput) !== null,
        );
      if (stale) {
        result.status = "unknown";
        result.explanation =
          "Sizing dependencies changed; a new bound scenario is required.";
        sizingNotices.push(
          `Sizing result for ${candidate.id}/${result.constraint_ref} is no longer current.`,
        );
      }
    }
    const selected = reconciledInput.evidence_refs.find(
      (e) => e.id === candidate.measurements.hardware_fit_evidence_ref,
    );
    if (
      selected &&
      hardwareSizingEvidenceProblem(selected, reconciledInput) !== null
    )
      candidate.measurements.hardware_fit_evidence_ref = null;
  }
  const reconciled = reconcileApprovals(reconciledInput, now);
  const notices = [
    ...(meta.notices ?? []),
    ...sizingNotices,
    ...reconciled.notices,
  ];
  const result = await commitRevision({
    paths: loaded.paths,
    expectedDigest: loaded.digest,
    contract: reconciled.contract,
    command: meta.command,
    summary: meta.summary,
    notices,
    provenance: meta.provenance ?? null,
    clock: context.io.clock,
    ...(context.storeFs === undefined ? {} : { fs: context.storeFs }),
  });
  context.io.stdout(
    lines(
      `Saved state revision r${result.entry.revision}: ${meta.summary}`,
      result.entry.notices.map((notice) => `  notice: ${notice}`),
      result.warnings.map((warning) => `  warning: ${warning}`),
    ),
  );
  return result;
}

/** Ask a yes/no question that defaults to no. */
export async function confirm(io: CliIo, question: string): Promise<boolean> {
  const answer = await io.prompt(`${question} [y/N] `);
  return answer !== null && /^(?:y|yes)$/i.test(answer.trim());
}

export function writeJson(io: CliIo, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

/** Convert any thrown value into output and an exit code. */
export function reportError(io: CliIo, error: unknown): ExitCode {
  if (error instanceof UsageError) {
    io.stderr(lines(`error: ${error.message}`, "", error.usage));
    return EXIT.usage;
  }
  if (error instanceof Cancelled) {
    io.stderr(lines(error.message));
    return EXIT.cancelled;
  }
  if (error instanceof StoreError) {
    io.stderr(
      lines(
        `error: ${sanitizeText(error.message).text}`,
        renderIssues(error.issues),
      ),
    );
    return EXIT.failed;
  }
  if (error instanceof WorkflowError) {
    // Messages written by ANVILMARK itself quote ids and paths, which an
    // entropy guess would mangle; published credential shapes are still removed.
    io.stderr(lines(`error: ${sanitizeText(error.message).text}`));
    return EXIT.failed;
  }
  const errno = error as NodeJS.ErrnoException;
  if (
    error instanceof Error &&
    typeof errno.code === "string" &&
    typeof errno.syscall === "string"
  ) {
    // A filesystem failure: its path is not a credential, and redacting it as
    // one only hides where the problem is.
    io.stderr(lines(`error: ${sanitizeText(error.message).text}`));
    return EXIT.failed;
  }
  const message = error instanceof Error ? error.message : String(error);
  io.stderr(lines(`error: ${sanitizeErrorMessage(message)}`));
  return EXIT.failed;
}
