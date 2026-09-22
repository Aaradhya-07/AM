import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  ContractIssue,
  ProjectContract,
} from "@anvilmark/project-contract";
import {
  parseProjectContract,
  toNormalizedYaml,
} from "@anvilmark/project-contract";

/**
 * Project state under `.anvilmark/`.
 *
 * ```text
 * .anvilmark/
 *   project.yaml                 the current contract, canonical YAML
 *   history/r000001.yaml         every committed state, never rewritten
 *   history/r000001.json         who/what/why for that state
 *   intelligence/requests/       exact requests that were sent or exported
 *   intelligence/handoff/        request and response files for an agent
 *   intelligence/proposals/      every proposal received, accepted or not
 * ```
 *
 * A **state revision** (`r1`, `r2`, ...) is one committed save. It is not
 * `project.contract_revision`, which the contract increments only when approved
 * content changes, and not a decision's `revision`.
 *
 * Commit order makes `project.yaml` the commit point: the candidate text is
 * validated, the history snapshot and its metadata are created exclusively,
 * and only then is `project.yaml` atomically replaced by rename. A failure at
 * any step leaves the previous `project.yaml` in place and valid. A snapshot
 * left by an interrupted commit is never part of the history chain, because the
 * chain is followed from the entry matching `project.yaml` through `parent`.
 */
export const STATE_DIRECTORY = ".anvilmark";
/** Written by commits that also write commit markers. */
export const HISTORY_FORMAT = "anvilmark-state-revision/0.2";
/** Written before commit markers existed. Still read. */
export const LEGACY_HISTORY_FORMAT = "anvilmark-state-revision/0.1";

export interface ProjectPaths {
  readonly root: string;
  readonly directory: string;
  readonly projectFile: string;
  readonly historyDirectory: string;
  readonly requestsDirectory: string;
  readonly handoffDirectory: string;
  readonly proposalsDirectory: string;
  readonly lockFile: string;
}

export function pathsFor(root: string): ProjectPaths {
  const directory = join(root, STATE_DIRECTORY);
  return {
    root,
    directory,
    projectFile: join(directory, "project.yaml"),
    historyDirectory: join(directory, "history"),
    requestsDirectory: join(directory, "intelligence", "requests"),
    handoffDirectory: join(directory, "intelligence", "handoff"),
    proposalsDirectory: join(directory, "intelligence", "proposals"),
    lockFile: join(directory, ".lock"),
  };
}

export interface HistoryEntry {
  readonly format: typeof HISTORY_FORMAT | typeof LEGACY_HISTORY_FORMAT;
  readonly revision: number;
  readonly parent: number | null;
  readonly created_at: string;
  /** The command that produced this state, e.g. `constraint add`. */
  readonly command: string;
  readonly summary: string;
  /** Things the user was told at commit time, e.g. an approval becoming non-current. */
  readonly notices: readonly string[];
  /** Where generated content came from. Null for direct user edits. */
  readonly provenance: Readonly<Record<string, unknown>> | null;
  /** `sha256:` over the exact bytes of the snapshot. */
  readonly content_digest: string;
}

export interface LoadedProject {
  readonly paths: ProjectPaths;
  readonly contract: ProjectContract;
  /** Digest of `project.yaml` as read. A commit refuses if it has changed since. */
  readonly digest: string;
  /** The committed entry `project.yaml` matches, or null. */
  readonly head: HistoryEntry | null;
  /** The newest COMMITTED entry; never an interrupted or ambiguous snapshot. */
  readonly latest: HistoryEntry | null;
  /** True when `project.yaml` matches no committed snapshot. */
  readonly editedOutsideCli: boolean;
  readonly history: HistoryState;
}

export class StoreError extends Error {
  readonly issues: readonly ContractIssue[];
  constructor(message: string, issues: readonly ContractIssue[] = []) {
    super(message);
    this.name = "StoreError";
    this.issues = issues;
  }
}

/** Filesystem operations a commit performs, replaceable to test failures. */
export interface StoreFs {
  readonly writeExclusive: (path: string, text: string) => Promise<void>;
  readonly replace: (path: string, text: string) => Promise<void>;
}

async function syncAndClose(handle: FileHandle): Promise<void> {
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export const nodeStoreFs: StoreFs = {
  async writeExclusive(path, text) {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "wx", 0o644);
    try {
      await handle.writeFile(text, "utf8");
    } finally {
      await syncAndClose(handle);
    }
  },
  async replace(path, text) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    const handle = await open(temporary, "wx", 0o644);
    try {
      await handle.writeFile(text, "utf8");
    } finally {
      await syncAndClose(handle);
    }
    try {
      await rename(temporary, path);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    const directory = await open(dirname(path), constants.O_RDONLY).catch(
      () => null,
    );
    if (directory !== null) {
      await directory.sync().catch(() => undefined);
      await directory.close();
    }
  },
};

export function digestText(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Walk up from `start` to the nearest directory holding `.anvilmark/project.yaml`. */
export async function findProjectRoot(start: string): Promise<string | null> {
  let current = resolve(start);
  for (;;) {
    if (await exists(join(current, STATE_DIRECTORY, "project.yaml"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function historyName(
  revision: number,
  kind: "yaml" | "json" | "committed" | "abandoned",
): string {
  const base = `r${String(revision).padStart(6, "0")}`;
  return kind === "yaml" || kind === "json"
    ? `${base}.${kind}`
    : `${base}.${kind}.json`;
}

/**
 * One history entry as found on disk, with its commit markers.
 *
 * A snapshot and its metadata are written BEFORE `project.yaml` is replaced,
 * so their existence proves nothing about whether the replacement happened.
 * From history format 0.2 on, a commit writes `rNNNNNN.committed.json` after
 * the replacement succeeds, and `rNNNNNN.abandoned.json` when it fails. Format
 * 0.1 entries predate the markers.
 */
export interface HistoryRecord {
  readonly entry: HistoryEntry;
  readonly legacy: boolean;
  readonly committedMarker: boolean;
  readonly abandonedMarker: boolean;
}

export type RevisionStanding =
  "committed" | "abandoned" | "uncommitted" | "ambiguous";

export interface ClassifiedRevision {
  readonly entry: HistoryEntry;
  readonly standing: RevisionStanding;
  /** Why this standing was reached, in words. */
  readonly basis: string;
  /** A marker a commit should write so the standing no longer needs inference. */
  readonly repair: "committed" | "abandoned" | null;
}

export interface HistoryState {
  readonly revisions: readonly ClassifiedRevision[];
  /** The committed chain, oldest first. Linear by construction. */
  readonly committed: readonly HistoryEntry[];
  /** The committed revision `project.yaml` matches byte for byte, or null. */
  readonly head: HistoryEntry | null;
  /** The newest committed revision: the only correct parent for a new commit. */
  readonly latest: HistoryEntry | null;
  /**
   * Revisions that may or may not have reached `project.yaml`, which has since
   * been edited outside the CLI. Nothing treats them as committed, and no commit
   * proceeds until each is resolved.
   */
  readonly ambiguous: readonly HistoryEntry[];
  /** The highest revision number in use by any history file. */
  readonly highestRevision: number;
}

/** Every complete history entry, with its markers, oldest first. */
export async function readHistoryRecords(paths: ProjectPaths): Promise<{
  readonly records: readonly HistoryRecord[];
  readonly highestRevision: number;
}> {
  let names: string[];
  try {
    names = await readdir(paths.historyDirectory);
  } catch {
    return { records: [], highestRevision: 0 };
  }
  const present = new Set(names);
  const highestRevision = names
    .map((name) => /^r(\d{6})\./.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .reduce((max, value) => Math.max(max, Number(value)), 0);
  const records: HistoryRecord[] = [];
  for (const name of names.filter((entry) => /^r\d{6}\.json$/.test(entry))) {
    try {
      const entry = JSON.parse(
        await readFile(join(paths.historyDirectory, name), "utf8"),
      ) as HistoryEntry;
      const snapshot = await readFile(
        join(paths.historyDirectory, historyName(entry.revision, "yaml")),
        "utf8",
      );
      if (
        (entry.format === HISTORY_FORMAT ||
          entry.format === LEGACY_HISTORY_FORMAT) &&
        name === historyName(entry.revision, "json") &&
        digestText(snapshot) === entry.content_digest
      ) {
        records.push({
          entry,
          legacy: entry.format === LEGACY_HISTORY_FORMAT,
          committedMarker: present.has(
            historyName(entry.revision, "committed"),
          ),
          abandonedMarker: present.has(
            historyName(entry.revision, "abandoned"),
          ),
        });
      }
    } catch {
      // An unreadable or partial entry is not history.
    }
  }
  records.sort((left, right) => left.entry.revision - right.entry.revision);
  return { records, highestRevision };
}

/**
 * Decide which history entries were committed, from markers and from what
 * `project.yaml` currently contains.
 *
 * The rules, in order:
 *
 * 1. An entry with an abandoned marker was not committed.
 * 2. An entry with a committed marker was committed, and so was every
 *    ancestor, because a commit's parent is always a committed revision.
 * 3. An unmarked entry whose snapshot is byte-identical to `project.yaml` and
 *    whose chain extends every committed entry was committed (a commit that
 *    replaced `project.yaml` and stopped before writing its marker).
 * 4. Format 0.1 history has no markers. If rule 3 anchors nothing, the
 *    ancestors of the newest 0.1 entry are presumed committed and that entry
 *    itself is classified by rule 5.
 * 5. Any other entry is uncommitted when a newer revision was committed without
 *    descending from it, or when `project.yaml` matches a committed revision;
 *    it is AMBIGUOUS when `project.yaml` matches nothing and the entry sits
 *    directly on the newest committed revision, because it may have been
 *    committed and then edited by hand.
 *
 * An ambiguous entry is never treated as committed. The newest committed
 * revision, not the newest file, is the parent of the next commit.
 */
export function classifyHistory(
  records: readonly HistoryRecord[],
  projectDigest: string | null,
  highestRevision = 0,
): HistoryState {
  const byRevision = new Map(
    records.map((record) => [record.entry.revision, record]),
  );
  const standing = new Map<
    number,
    {
      standing: RevisionStanding;
      basis: string;
      repair: ClassifiedRevision["repair"];
    }
  >();
  const committed = new Set<number>();

  const chainOf = (entry: HistoryEntry): HistoryEntry[] | null => {
    const chain: HistoryEntry[] = [];
    let current: HistoryEntry | undefined = entry;
    const seen = new Set<number>();
    while (current !== undefined) {
      if (seen.has(current.revision)) return null;
      seen.add(current.revision);
      chain.unshift(current);
      if (current.parent === null) return chain;
      const parent = byRevision.get(current.parent);
      if (parent === undefined || parent.abandonedMarker) return null;
      current = parent.entry;
    }
    return chain;
  };
  const commit = (
    entry: HistoryEntry,
    basis: string,
    repair: ClassifiedRevision["repair"],
  ) => {
    for (const member of chainOf(entry) ?? [entry]) {
      if (!committed.has(member.revision)) {
        committed.add(member.revision);
        const record = byRevision.get(member.revision);
        standing.set(member.revision, {
          standing: "committed",
          basis:
            member.revision === entry.revision
              ? basis
              : `an ancestor of committed revision r${entry.revision}`,
          repair:
            member.revision === entry.revision
              ? repair
              : record !== undefined &&
                  !record.committedMarker &&
                  !record.legacy
                ? "committed"
                : null,
        });
      }
    }
  };
  const extendsCommitted = (chain: readonly HistoryEntry[] | null): boolean =>
    chain !== null &&
    [...committed].every((revision) =>
      chain.some((member) => member.revision === revision),
    );

  // 1 and 2: markers.
  for (const record of records) {
    const revision = record.entry.revision;
    if (record.abandonedMarker) {
      standing.set(revision, {
        standing: "abandoned",
        basis: "its commit did not replace project.yaml (abandoned marker)",
        repair: null,
      });
    }
  }
  for (const record of records) {
    if (record.committedMarker && !record.abandonedMarker) {
      commit(record.entry, "its commit completed (committed marker)", null);
    }
  }

  // 3: digest recovery.
  const unresolved = () =>
    records.filter(
      (record) =>
        !committed.has(record.entry.revision) && !record.abandonedMarker,
    );
  if (projectDigest !== null) {
    const match = [...unresolved()]
      .reverse()
      .find(
        (record) =>
          record.entry.content_digest === projectDigest &&
          extendsCommitted(chainOf(record.entry)),
      );
    if (match !== undefined) {
      commit(
        match.entry,
        "project.yaml is byte-identical to its snapshot and it extends the committed chain",
        match.legacy ? null : "committed",
      );
    } else {
      // 4: pre-marker history.
      const newestLegacy = [...unresolved()]
        .reverse()
        .find((record) => record.legacy);
      const chain =
        newestLegacy === undefined ? null : chainOf(newestLegacy.entry);
      if (newestLegacy !== undefined && chain !== null && chain.length > 1) {
        const parent = chain[chain.length - 2];
        if (parent !== undefined && extendsCommitted(chain.slice(0, -1))) {
          commit(
            parent,
            "presumed committed: an ancestor of the newest history entry written before commit markers existed",
            null,
          );
        }
      }
    }
  }

  const committedEntries = records
    .filter((record) => committed.has(record.entry.revision))
    .map((record) => record.entry);
  const latest = committedEntries[committedEntries.length - 1] ?? null;
  const head =
    projectDigest === null
      ? null
      : ([...committedEntries]
          .reverse()
          .find((entry) => entry.content_digest === projectDigest) ?? null);

  // 5: everything else.
  for (const record of unresolved()) {
    const entry = record.entry;
    if (standing.has(entry.revision)) continue;
    if (projectDigest === null) {
      standing.set(entry.revision, {
        standing: "uncommitted",
        basis: "there is no project.yaml it could have been committed to",
        repair: null,
      });
    } else if (latest !== null && entry.revision < latest.revision) {
      standing.set(entry.revision, {
        standing: "uncommitted",
        basis: `newer revision r${latest.revision} was committed without descending from it`,
        repair: "abandoned",
      });
    } else if (head !== null) {
      standing.set(entry.revision, {
        standing: "uncommitted",
        basis: `project.yaml still matches committed revision r${head.revision}`,
        repair: "abandoned",
      });
    } else if (entry.parent === (latest?.revision ?? null)) {
      standing.set(entry.revision, {
        standing: "ambiguous",
        basis: `project.yaml was edited outside the CLI and matches no snapshot, so it cannot be told whether this revision reached project.yaml before the edit`,
        repair: null,
      });
    } else {
      standing.set(entry.revision, {
        standing: "uncommitted",
        basis: `its parent r${entry.parent ?? "none"} is not the newest committed revision`,
        repair: "abandoned",
      });
    }
  }

  const revisions = records.map((record) => {
    const found = standing.get(record.entry.revision);
    return {
      entry: record.entry,
      standing: found?.standing ?? "uncommitted",
      basis: found?.basis ?? "unclassified",
      repair: found?.repair ?? null,
    };
  });
  return {
    revisions,
    committed: committedEntries,
    head,
    latest,
    ambiguous: revisions
      .filter((revision) => revision.standing === "ambiguous")
      .map((revision) => revision.entry),
    highestRevision: Math.max(
      highestRevision,
      records.reduce((max, record) => Math.max(max, record.entry.revision), 0),
    ),
  };
}

export async function readHistoryState(
  paths: ProjectPaths,
  projectDigest: string | null,
): Promise<HistoryState> {
  const { records, highestRevision } = await readHistoryRecords(paths);
  return classifyHistory(records, projectDigest, highestRevision);
}

/** The recovery a user runs when history is ambiguous. */
export function ambiguityGuidance(
  paths: ProjectPaths,
  ambiguous: readonly HistoryEntry[],
): string {
  return ambiguous
    .map(
      (entry) =>
        `revision r${entry.revision} ("${entry.command}: ${entry.summary}") was written by a commit that may not have reached project.yaml, and project.yaml has since been edited outside the CLI. Compare ${join(paths.historyDirectory, historyName(entry.revision, "yaml"))} with ${paths.projectFile}; if project.yaml contains that revision's change, run "anvilmark history resolve r${entry.revision} --adopt", otherwise run "anvilmark history resolve r${entry.revision} --abandon"`,
    )
    .join("\n");
}

/** Kept for callers that only need committed entries, oldest first. */
export async function readHistory(
  paths: ProjectPaths,
  projectDigest: string | null,
): Promise<readonly HistoryEntry[]> {
  return (await readHistoryState(paths, projectDigest)).committed;
}

export async function readSnapshot(
  paths: ProjectPaths,
  revision: number,
): Promise<string> {
  return readFile(
    join(paths.historyDirectory, historyName(revision, "yaml")),
    "utf8",
  );
}

export async function loadProject(root: string): Promise<LoadedProject> {
  const paths = pathsFor(root);
  let text: string;
  try {
    text = await readFile(paths.projectFile, "utf8");
  } catch {
    throw new StoreError(
      `no ANVILMARK project at ${root}; run "anvilmark init" first`,
    );
  }
  const parsed = parseProjectContract(text, "yaml");
  if (!parsed.ok) {
    throw new StoreError(
      `${paths.projectFile} is not a valid project contract; nothing was changed`,
      parsed.issues,
    );
  }
  const digest = digestText(text);
  const history = await readHistoryState(paths, digest);
  return {
    paths,
    contract: parsed.value,
    digest,
    head: history.head,
    latest: history.latest,
    editedOutsideCli: history.head === null,
    history,
  };
}

interface LockRecord {
  readonly pid: number;
  readonly created_at: string;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Take the project write lock. Commits hold it; so does generation, so generated
 * output is never rendered from a contract a commit is replacing.
 */
export async function acquireLock(
  paths: ProjectPaths,
  clock: () => string,
): Promise<() => Promise<void>> {
  await mkdir(paths.directory, { recursive: true });
  const record: LockRecord = { pid: process.pid, created_at: clock() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(paths.lockFile, "wx", 0o644);
      await handle.writeFile(JSON.stringify(record), "utf8");
      await handle.close();
      return async () => {
        await unlink(paths.lockFile).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      let holder: LockRecord | null = null;
      try {
        holder = JSON.parse(
          await readFile(paths.lockFile, "utf8"),
        ) as LockRecord;
      } catch {
        holder = null;
      }
      if (
        attempt === 0 &&
        holder !== null &&
        typeof holder.pid === "number" &&
        !processAlive(holder.pid)
      ) {
        // The writer that held this lock is gone; its commit never reached
        // project.yaml, so removing the lock cannot lose a committed state.
        await unlink(paths.lockFile).catch(() => undefined);
        continue;
      }
      throw new StoreError(
        `another anvilmark command is writing this project (${paths.lockFile}); if none is running, remove that file`,
      );
    }
  }
  throw new StoreError(`could not lock ${paths.lockFile}`);
}

export interface CommitInput {
  readonly paths: ProjectPaths;
  /** Digest of `project.yaml` when the command read it; null when creating. */
  readonly expectedDigest: string | null;
  readonly contract: ProjectContract;
  readonly command: string;
  readonly summary: string;
  readonly notices?: readonly string[];
  readonly provenance?: Readonly<Record<string, unknown>> | null;
  readonly clock: () => string;
  readonly fs?: StoreFs;
}

export interface CommitResult {
  readonly entry: HistoryEntry;
  readonly contract: ProjectContract;
  readonly digest: string;
  /** Problems that did not prevent the commit, e.g. an unwritable marker. */
  readonly warnings: readonly string[];
}

async function writeMarker(
  fs: StoreFs,
  paths: ProjectPaths,
  revision: number,
  kind: "committed" | "abandoned",
  at: string,
  reason: string,
): Promise<void> {
  try {
    await fs.writeExclusive(
      join(paths.historyDirectory, historyName(revision, kind)),
      `${JSON.stringify({ format: "anvilmark-state-revision-marker/0.1", revision, standing: kind, marked_at: at, reason }, null, 2)}\n`,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
}

/**
 * Record the user's resolution of an ambiguous revision, under the lock.
 *
 * Refused unless the revision is ambiguous right now: a committed, abandoned or
 * uncommitted revision is already determined and cannot be re-labelled here.
 */
export async function resolveAmbiguousRevision(input: {
  readonly paths: ProjectPaths;
  readonly revision: number;
  readonly resolution: "adopt" | "abandon";
  readonly clock: () => string;
  readonly fs?: StoreFs;
}): Promise<HistoryEntry> {
  const fs = input.fs ?? nodeStoreFs;
  const release = await acquireLock(input.paths, input.clock);
  try {
    let digest: string | null = null;
    try {
      digest = digestText(await readFile(input.paths.projectFile, "utf8"));
    } catch {
      digest = null;
    }
    const history = await readHistoryState(input.paths, digest);
    const target = history.revisions.find(
      (entry) => entry.entry.revision === input.revision,
    );
    if (target === undefined) {
      throw new StoreError(
        `there is no complete history revision r${input.revision}`,
      );
    }
    if (target.standing !== "ambiguous") {
      throw new StoreError(
        `revision r${input.revision} is ${target.standing} (${target.basis}); only an ambiguous revision can be resolved`,
      );
    }
    await writeMarker(
      fs,
      input.paths,
      input.revision,
      input.resolution === "adopt" ? "committed" : "abandoned",
      input.clock(),
      `resolved by the user with "anvilmark history resolve r${input.revision} --${input.resolution}"`,
    );
    return target.entry;
  } finally {
    await release();
  }
}

/**
 * Validate and commit one state revision.
 *
 * Nothing is written unless the exact bytes about to become `project.yaml`
 * parse and validate as a complete contract -- schema, references, evidence
 * floors, approval hashes and secret scanning -- and unless `project.yaml`
 * is still the file this command read.
 */
export async function commitRevision(
  input: CommitInput,
): Promise<CommitResult> {
  const fs = input.fs ?? nodeStoreFs;
  const text = toNormalizedYaml(input.contract);
  const reparsed = parseProjectContract(text, "yaml");
  if (!reparsed.ok) {
    throw new StoreError(
      "the change would produce an invalid contract; nothing was written",
      reparsed.issues,
    );
  }

  const release = await acquireLock(input.paths, input.clock);
  try {
    let current: string | null = null;
    try {
      current = await readFile(input.paths.projectFile, "utf8");
    } catch {
      current = null;
    }
    const currentDigest = current === null ? null : digestText(current);
    if (currentDigest !== input.expectedDigest) {
      throw new StoreError(
        input.expectedDigest === null
          ? `${input.paths.projectFile} already exists; nothing was written`
          : `${input.paths.projectFile} changed while this command was running; nothing was written, run the command again`,
      );
    }

    const history = await readHistoryState(input.paths, currentDigest);
    if (currentDigest !== null && history.ambiguous.length > 0) {
      throw new StoreError(
        `nothing was written: the project history is ambiguous.\n${ambiguityGuidance(input.paths, history.ambiguous)}`,
      );
    }

    // Make inferred standings explicit before building on them. A marker that
    // already exists is left alone.
    const markerFailures: string[] = [];
    if (currentDigest !== null) {
      for (const revision of history.revisions) {
        if (revision.repair === null) continue;
        await writeMarker(
          fs,
          input.paths,
          revision.entry.revision,
          revision.repair,
          input.clock(),
          revision.basis,
        ).catch((error: unknown) => {
          markerFailures.push(
            `r${revision.entry.revision}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    }

    const parent = history.latest;
    const revision = history.highestRevision + 1;

    const notices = [...(input.notices ?? [])];
    if (currentDigest !== null && history.head === null) {
      notices.push(
        `project.yaml had been edited outside the CLI since committed revision r${parent?.revision ?? "?"}; those edits are included in this state`,
      );
    }

    const entry: HistoryEntry = {
      format: HISTORY_FORMAT,
      revision,
      parent: parent?.revision ?? null,
      created_at: input.clock(),
      command: input.command,
      summary: input.summary,
      notices,
      provenance: input.provenance ?? null,
      content_digest: digestText(text),
    };

    await fs.writeExclusive(
      join(input.paths.historyDirectory, historyName(revision, "yaml")),
      text,
    );
    await fs.writeExclusive(
      join(input.paths.historyDirectory, historyName(revision, "json")),
      `${JSON.stringify(entry, null, 2)}\n`,
    );
    try {
      await fs.replace(input.paths.projectFile, text);
    } catch (error) {
      // The replacement did not happen, so this revision was never committed.
      // Say so on disk; if even that fails, the revision is still classified
      // as uncommitted from project.yaml's content.
      await writeMarker(
        fs,
        input.paths,
        revision,
        "abandoned",
        input.clock(),
        `project.yaml was not replaced: ${error instanceof Error ? error.message : String(error)}`,
      ).catch(() => undefined);
      throw error;
    }
    // project.yaml now holds this revision: the commit has happened. The
    // marker only records it; if it cannot be written, the next command
    // recovers the standing from project.yaml's matching bytes.
    const warnings = [...markerFailures];
    await writeMarker(
      fs,
      input.paths,
      revision,
      "committed",
      input.clock(),
      "project.yaml was replaced with this snapshot",
    ).catch((error: unknown) => {
      warnings.push(
        `the commit succeeded, but its completion marker could not be written (${error instanceof Error ? error.message : String(error)}); the next command restores it from project.yaml`,
      );
    });
    return {
      entry,
      contract: reparsed.value,
      digest: entry.content_digest,
      warnings,
    };
  } finally {
    await release();
  }
}

/** Write a JSON record that must not overwrite an existing one. */
export async function writeRecord(
  path: string,
  value: unknown,
  fs: StoreFs | undefined = nodeStoreFs,
): Promise<void> {
  await (fs ?? nodeStoreFs).writeExclusive(
    path,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function listJson(directory: string): Promise<readonly string[]> {
  try {
    return (await readdir(directory))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
}
