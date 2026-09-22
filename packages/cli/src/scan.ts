import { randomBytes } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { assertTimestamp } from "@anvilmark/context";
import type {
  ContractIssue,
  ProjectContract,
} from "@anvilmark/project-contract";
import { parseProjectContract } from "@anvilmark/project-contract";
import type {
  AiInventory,
  ScanArtifact,
  ScanConfig,
  ScanContent,
  ScanOutcome,
} from "@anvilmark/scanner";
import {
  defaultScanConfig,
  finalizeArtifact,
  inventoryRepository,
  parseScanConfig,
  readArtifact,
  scanRepository,
  serializeArtifact,
  sha256,
} from "@anvilmark/scanner";

import type { GenerateFs } from "./generate.js";
import { nodeGenerateFs } from "./generate.js";
import {
  SCAN_CONFIG_FILE,
  SCAN_DIRECTORY,
  resolveOutputBoundary,
} from "./output-boundary.js";
import type { ProjectPaths } from "./store.js";
import {
  STATE_DIRECTORY,
  StoreError,
  acquireLock,
  digestText,
  pathsFor,
  readHistoryState,
} from "./store.js";

/**
 * `anvilmark scan`: run the local repository scanner and persist ONLY its
 * artifact, `.anvilmark/scans/repository-scan.json`.
 *
 * - Reads `project.yaml` and history; never writes them, approvals, bindings
 *   or evidence.
 * - Reads the scanned repository through the scanner's bounded reader only;
 *   never runs its scripts, builds, executables or tsconfig plugins, and never
 *   writes into it (except the artifact, when the project lives inside it).
 * - Holds the project lock while scanning and publishing.
 * - Before publishing, rechecks `project.yaml`, the declaration file and every
 *   repository input the scan read; if any changed, nothing is written.
 * - Writes a temporary file exclusively and renames it over the artifact after
 *   the physical output boundary is checked again.
 * - `observation.observed_at` is `--observed-at`, else reused from the stored
 *   artifact when its content hash is unchanged (so an unchanged rescan is
 *   byte-identical), else the clock, once.
 */

export const SCAN_OUTPUT_PATH = `${STATE_DIRECTORY}/${SCAN_DIRECTORY}/repository-scan.json`;
export const SCAN_CONFIG_PATH = `${STATE_DIRECTORY}/${SCAN_CONFIG_FILE}`;

export interface ScanOptions {
  readonly root: string;
  /** Absolute; overrides the declaration file and the contract's repository_roots. */
  readonly repository?: string;
  /** Previous conformance selection; current config.repository_root takes precedence. */
  readonly fallbackRepository?: string;
  /** Absolute; default `.anvilmark/scanner.yaml` when it exists. */
  readonly config?: string;
  readonly observedAt?: string;
  readonly clock: () => string;
  readonly fs?: GenerateFs;
  readonly hooks?: { readonly afterScan?: () => Promise<void> };
  readonly onProgress?: (message: string) => void;
  /**
   * Scan without sources, sanitizers, sinks or components (for drafting
   * declarations); the file's repository_root, include and exclude still apply.
   */
  readonly withoutDeclarations?: boolean;
}

export interface PreparedScan {
  readonly paths: ProjectPaths;
  readonly projectText: string;
  readonly contract: ProjectContract;
  readonly stateRevision: number | null;
  readonly config: ScanConfig;
  readonly configFile: {
    readonly absolute: string;
    readonly text: string;
  } | null;
  readonly repositoryPath: string;
  readonly repositoryRoot: string;
  readonly outcome: ScanOutcome;
}

async function readProjectState(paths: ProjectPaths, fs: GenerateFs) {
  const text = await fs.read(paths.projectFile);
  if (text === null) {
    throw new StoreError(
      `no ANVILMARK project at ${paths.root}; run "anvilmark init" first`,
    );
  }
  const parsed = parseProjectContract(text, "yaml");
  if (!parsed.ok) {
    throw new StoreError(
      `${paths.projectFile} is not a valid project contract; no scan output was changed`,
      parsed.issues,
    );
  }
  const history = await readHistoryState(paths, digestText(text));
  return {
    text,
    contract: parsed.value,
    stateRevision: history.head?.revision ?? null,
  };
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

async function readConfig(
  root: string,
  explicit: string | undefined,
): Promise<{
  config: ScanConfig;
  file: { absolute: string; text: string } | null;
}> {
  const absolute = explicit ?? join(root, STATE_DIRECTORY, SCAN_CONFIG_FILE);
  const info = await stat(absolute).catch(() => null);
  if (info === null) {
    if (explicit !== undefined) {
      throw new StoreError(
        `scan declaration file ${explicit} does not exist; nothing was scanned`,
      );
    }
    return { config: defaultScanConfig(), file: null };
  }
  if (!info.isFile()) {
    throw new StoreError(
      `scan declaration file ${absolute} is not a regular file; nothing was scanned`,
    );
  }
  const text = await readFile(absolute, "utf8");
  const parsed = parseScanConfig(text);
  if (!parsed.ok) {
    throw new StoreError(
      `${absolute} is not a valid scan declaration file; nothing was scanned`,
      parsed.issues as ContractIssue[],
    );
  }
  return { config: parsed.config, file: { absolute, text } };
}

async function resolveRepository(
  root: string,
  contract: ProjectContract,
  config: ScanConfig,
  explicit: string | undefined,
  fallback: string | undefined,
): Promise<{ path: string; ref: string; declared: boolean }> {
  let candidate: string;
  if (explicit !== undefined) {
    candidate = explicit;
  } else if (config.repository_root !== null) {
    candidate = resolve(root, config.repository_root);
  } else if (fallback !== undefined) {
    candidate = fallback;
  } else if (contract.project.repository_roots.length === 1) {
    candidate = resolve(root, contract.project.repository_roots[0] as string);
  } else {
    throw new StoreError(
      contract.project.repository_roots.length === 0
        ? 'no repository to scan: pass --repository PATH, set repository_root in the scan declaration file, or record one with "anvilmark init --repo"'
        : "the contract lists several repository roots; pass --repository PATH or set repository_root in the scan declaration file",
    );
  }
  const info = await lstat(candidate).catch(() => null);
  if (
    info === null ||
    !(await stat(candidate).then(
      (entry) => entry.isDirectory(),
      () => false,
    ))
  ) {
    throw new StoreError(
      `repository path ${candidate} is not a directory; nothing was scanned`,
    );
  }
  // Compare physical identities so OS aliases (for example /var -> /private/var)
  // do not turn a declared repository into a different, undeclared selection.
  const physicalRoot = await realpath(root);
  const physicalCandidate = await realpath(candidate);
  const ref = toPosix(relative(physicalRoot, physicalCandidate)) || ".";
  if (isAbsolute(ref)) {
    throw new StoreError(
      "the repository must be addressable by a relative path from the project; nothing was scanned",
    );
  }
  const declaredRoots = await Promise.all(
    contract.project.repository_roots.map((entry) =>
      realpath(resolve(root, entry)).catch(() => null),
    ),
  );
  const declared = declaredRoots.includes(physicalCandidate);
  return { path: candidate, ref, declared };
}

/** Load inputs and run the scanner; reads only. */
export async function prepareScan(options: ScanOptions): Promise<PreparedScan> {
  const fs = options.fs ?? nodeGenerateFs;
  const paths = pathsFor(options.root);
  const project = await readProjectState(paths, fs);
  const read = await readConfig(options.root, options.config);
  const file = options.withoutDeclarations === true ? null : read.file;
  const config =
    options.withoutDeclarations === true
      ? {
          ...defaultScanConfig(),
          repository_root: read.config.repository_root,
          include: read.config.include,
          exclude: read.config.exclude,
        }
      : read.config;
  const repository = await resolveRepository(
    options.root,
    project.contract,
    config,
    options.repository,
    options.fallbackRepository,
  );
  const configPath =
    file === null
      ? null
      : (() => {
          // Remember the selected path, including its final symlink, so a
          // later retarget is read rather than silently pinning the old target.
          const rel = toPosix(relative(options.root, file.absolute));
          return rel.startsWith("..") || isAbsolute(rel) ? null : rel;
        })();
  const outcome = scanRepository({
    repositoryPath: repository.path,
    repositoryRoot: repository.ref,
    repositoryDeclaredInContract: repository.declared,
    deniedDirectories: [paths.directory],
    contract: project.contract,
    stateRevision: project.stateRevision,
    config,
    configSource:
      file === null
        ? { source: "default" }
        : { source: "file", path: configPath, sha256: sha256(file.text) },
    ...(options.onProgress === undefined
      ? {}
      : {
          onStage: (event: { stage: string; sourceFiles: number }) => {
            if (event.stage !== "inventory")
              options.onProgress?.(
                `scanning ${event.sourceFiles} file(s) (${event.stage})...`,
              );
          },
        }),
  });
  return {
    paths,
    projectText: project.text,
    contract: project.contract,
    stateRevision: project.stateRevision,
    config,
    configFile: file,
    repositoryPath: repository.path,
    repositoryRoot: repository.ref,
    outcome,
  };
}

export async function recheckScanInputs(
  prepared: PreparedScan,
  fs: GenerateFs,
): Promise<void> {
  const project = await fs.read(prepared.paths.projectFile);
  if (project === null || project !== prepared.projectText) {
    throw new StoreError(
      `${prepared.paths.projectFile} changed while scanning; no scan output was changed, run the command again`,
    );
  }
  if (prepared.configFile !== null) {
    const config = await readFile(prepared.configFile.absolute, "utf8").catch(
      () => null,
    );
    if (config !== prepared.configFile.text) {
      throw new StoreError(
        "the scan declaration file changed while scanning; no scan output was changed, run the command again",
      );
    }
  } else if (
    await lstat(join(prepared.paths.directory, SCAN_CONFIG_FILE)).catch(
      () => null,
    )
  ) {
    throw new StoreError(
      "the default scan declaration file appeared while scanning; no scan output was changed, run the command again",
    );
  }
  const changed = prepared.outcome.recheck();
  if (changed.length > 0) {
    throw new StoreError(
      `${changed.length} repository file(s) changed while scanning (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", ..." : ""}); no scan output was changed, run the command again`,
    );
  }
}

export type ObservedAtBasis = "explicit" | "reused" | "clock";

export interface ScanResult {
  readonly artifact: ScanArtifact;
  readonly path: string;
  readonly unchanged: boolean;
  /** How this run chose observed_at; `reused` keeps the stored observation. */
  readonly basis: ObservedAtBasis;
  readonly repositoryDeclaredInContract: boolean;
}

function outputProtection(prepared: {
  configFile: { absolute: string } | null;
}) {
  return {
    files: [SCAN_CONFIG_FILE],
    paths:
      prepared.configFile === null
        ? []
        : [
            {
              path: prepared.configFile.absolute,
              label: "the scan declaration file",
            },
          ],
  };
}

export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  const fs = options.fs ?? nodeGenerateFs;
  const paths = pathsFor(options.root);
  if (options.observedAt !== undefined) assertTimestamp(options.observedAt);
  const release = await acquireLock(paths, options.clock);
  try {
    const prepared = await prepareScan(options);
    const protect = outputProtection(prepared);
    const [output] = await resolveOutputBoundary(
      options.root,
      [SCAN_OUTPUT_PATH],
      { create: true, protect },
    );
    if (output === undefined)
      throw new StoreError("internal error: unresolved scan output");
    const previousText = await fs.read(output.physical);
    const previous = previousText === null ? null : readArtifact(previousText);

    // The stored observation is reused verbatim for identical content, so its
    // recorded basis still says how that instant was first chosen.
    let basis: ObservedAtBasis;
    let observation: ScanArtifact["observation"];
    if (options.observedAt !== undefined) {
      basis = "explicit";
      observation = { observed_at: options.observedAt, basis };
    } else if (
      previous?.status === "valid" &&
      previous.artifact.content_hash === prepared.outcome.contentHash
    ) {
      basis = "reused";
      observation = previous.artifact.observation;
    } else {
      basis = "clock";
      observation = { observed_at: options.clock(), basis };
    }
    const artifact = finalizeArtifact(prepared.outcome.content, observation);
    const text = serializeArtifact(artifact);
    await options.hooks?.afterScan?.();

    await recheckScanInputs(prepared, fs);
    if (previousText === text) {
      await resolveOutputBoundary(options.root, [SCAN_OUTPUT_PATH], {
        create: false,
        protect,
      });
      if ((await fs.read(output.physical)) !== previousText)
        throw new StoreError(
          "the stored scan changed while scanning; no scan output was changed",
        );
      return {
        artifact,
        path: SCAN_OUTPUT_PATH,
        unchanged: true,
        basis,
        repositoryDeclaredInContract: artifact.repository.declared_in_contract,
      };
    }

    const temporary = `${output.physical}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    try {
      await fs.writeTemporary(temporary, text);
    } catch (error) {
      await fs.remove(temporary).catch(() => undefined);
      throw error;
    }
    try {
      await recheckScanInputs(prepared, fs);
      const [rechecked] = await resolveOutputBoundary(
        options.root,
        [SCAN_OUTPUT_PATH],
        { create: false, protect },
      );
      if (rechecked === undefined || rechecked.physical !== output.physical) {
        throw new StoreError(
          "the scan output path changed while scanning; no scan output was changed",
        );
      }
      await fs.rename(temporary, output.physical);
    } catch (error) {
      await fs.remove(temporary).catch(() => undefined);
      throw error;
    }
    return {
      artifact,
      path: SCAN_OUTPUT_PATH,
      unchanged: false,
      basis,
      repositoryDeclaredInContract: artifact.repository.declared_in_contract,
    };
  } finally {
    await release();
  }
}

export type StoredScan =
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly problem: string }
  | { readonly status: "tampered"; readonly artifact: ScanArtifact }
  | { readonly status: "valid"; readonly artifact: ScanArtifact };

/** Read the stored artifact through the output boundary, creating nothing. */
export async function readStoredScan(
  root: string,
  fs: GenerateFs = nodeGenerateFs,
): Promise<StoredScan> {
  await realpath(join(root, STATE_DIRECTORY)).catch(() => {
    throw new StoreError(
      `no ANVILMARK project at ${root}; run "anvilmark init" first`,
    );
  });
  const [output] = await resolveOutputBoundary(root, [SCAN_OUTPUT_PATH], {
    create: false,
    protect: { files: [SCAN_CONFIG_FILE] },
  });
  if (output === undefined || !output.parentExists)
    return { status: "missing" };
  const text = await fs.read(output.physical);
  if (text === null) return { status: "missing" };
  const reading = readArtifact(text);
  return reading;
}

export interface ScanCheck {
  readonly status: "current" | "missing" | "invalid" | "tampered" | "stale";
  readonly reasons: readonly string[];
  readonly stored_content_hash: string | null;
  readonly current_content_hash: string | null;
}

/** Recompute the scan without writing and compare it with the stored artifact. */
export async function checkScan(
  options: Omit<ScanOptions, "observedAt" | "hooks">,
): Promise<ScanCheck> {
  const stored = await readStoredScan(options.root, options.fs);
  if (stored.status === "missing" || stored.status === "invalid") {
    return {
      status: stored.status,
      reasons:
        stored.status === "invalid"
          ? [stored.problem]
          : ['no scan artifact; run "anvilmark scan"'],
      stored_content_hash: null,
      current_content_hash: null,
    };
  }
  const prepared = await prepareScan(options);
  const current = prepared.outcome.content;
  if (stored.status === "tampered") {
    return {
      status: "tampered",
      reasons: ["the stored artifact does not match its own content hash"],
      stored_content_hash: stored.artifact.content_hash,
      current_content_hash: prepared.outcome.contentHash,
    };
  }
  const artifact = stored.artifact;
  const reasons: string[] = [];
  if (artifact.contract.contract_hash !== current.contract.contract_hash)
    reasons.push("contract changed");
  if (artifact.contract.state_revision !== current.contract.state_revision)
    reasons.push("state revision changed");
  if (artifact.repository.root !== current.repository.root)
    reasons.push("repository root changed");
  if (artifact.repository.snapshot_hash !== current.repository.snapshot_hash)
    reasons.push("repository inputs changed");
  if (
    artifact.configuration.sha256 !== current.configuration.sha256 ||
    artifact.configuration.source !== current.configuration.source
  ) {
    reasons.push("scan declarations changed");
  }
  if (
    artifact.scanner.version !== current.scanner.version ||
    artifact.scanner.typescript_version !==
      current.scanner.typescript_version ||
    JSON.stringify(artifact.scanner.recognizers) !==
      JSON.stringify(current.scanner.recognizers) ||
    JSON.stringify(artifact.scanner.stages) !==
      JSON.stringify(current.scanner.stages)
  ) {
    reasons.push("scanner changed");
  }
  const same = artifact.content_hash === prepared.outcome.contentHash;
  await recheckScanInputs(prepared, options.fs ?? nodeGenerateFs);
  if (!same && reasons.length === 0) reasons.push("results differ");
  return {
    status: same ? "current" : "stale",
    reasons: same ? [] : reasons,
    stored_content_hash: artifact.content_hash,
    current_content_hash: prepared.outcome.contentHash,
  };
}

export interface InventoryScanOptions {
  readonly repositoryPath: string;
  readonly deniedDirectories?: readonly string[] | undefined;
  readonly onProgress?: ((message: string) => void) | undefined;
}

/**
 * The inventory scan, with optional progress. Progress is observed through the
 * scanner's own stage hook, so there is one scan path whether or not anyone is
 * watching it.
 */
export function inventoryScan(options: InventoryScanOptions): {
  readonly inventory: AiInventory;
  readonly content: ScanContent;
} {
  const onProgress = options.onProgress;
  return inventoryRepository({
    repositoryPath: options.repositoryPath,
    ...(options.deniedDirectories === undefined
      ? {}
      : { deniedDirectories: options.deniedDirectories }),
    ...(onProgress === undefined
      ? {}
      : {
          onStage: (event: { stage: string; sourceFiles: number }) => {
            if (event.stage === "inventory") return;
            const files = `${event.sourceFiles} ${event.sourceFiles === 1 ? "file" : "files"}`;
            onProgress(
              event.stage === "resolution"
                ? `scanning ${files}...`
                : `scanning ${files} (${event.stage})...`,
            );
          },
        }),
  });
}
