import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  GenerationCheck,
  GenerationManifest,
  PresentFreshness,
  ProjectionName,
  RenderedSet,
} from "@anvilmark/context";
import {
  GENERATOR_ID,
  GENERATOR_VERSION,
  MANIFEST_FORMAT,
  assertTimestamp,
  artifactPaths,
  checkArtifactSet,
  contractHash,
  presentFreshness,
  renderArtifactSet,
} from "@anvilmark/context";
import { parseProjectContract } from "@anvilmark/project-contract";

import {
  SCAN_CONFIG_FILE,
  SCAN_DIRECTORY,
  resolveOutputBoundary,
} from "./output-boundary.js";

/** Generated views never replace repository-scan state. */
const GENERATE_PROTECTION = {
  files: [SCAN_CONFIG_FILE],
  directories: [SCAN_DIRECTORY],
} as const;
import type { ProjectPaths } from "./store.js";
import {
  StoreError,
  acquireLock,
  digestText,
  pathsFor,
  readHistoryState,
} from "./store.js";

/** Filesystem operations generation performs, replaceable to test failures. */
export interface GenerateFs {
  readonly writeTemporary: (path: string, text: string) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly remove: (path: string) => Promise<void>;
  readonly read: (path: string) => Promise<string | null>;
}

export const nodeGenerateFs: GenerateFs = {
  async writeTemporary(path, text) {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "wx", 0o644);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async rename(from, to) {
    await rename(from, to);
  },
  async remove(path) {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  },
  async read(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
};

export type AsOfBasis = "explicit" | "reused" | "clock";

export interface GenerateResult {
  readonly rendered: RenderedSet;
  readonly asOf: string;
  readonly asOfBasis: AsOfBasis;
  /** True when every file already held exactly these bytes; nothing was written. */
  readonly unchanged: boolean;
  readonly written: readonly string[];
  readonly warnings: readonly string[];
  /**
   * Whether the snapshot's time-dependent standings still hold now. A reused
   * or explicit `as_of` can be byte-stable and still `stale_time`.
   */
  readonly freshness: PresentFreshness;
}

export interface GenerateHooks {
  /** Called after rendering, before anything is written. Tests use it. */
  readonly afterRender?: () => Promise<void>;
}

function readManifest(text: string | null): GenerationManifest | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as GenerationManifest;
  } catch {
    return null;
  }
}

async function readProject(paths: ProjectPaths, fs: GenerateFs) {
  const text = await fs.read(paths.projectFile);
  if (text === null) {
    throw new StoreError(
      `no ANVILMARK project at ${paths.root}; run "anvilmark init" first`,
    );
  }
  const parsed = parseProjectContract(text, "yaml");
  if (!parsed.ok) {
    throw new StoreError(
      `${paths.projectFile} is not a valid project contract; no generated output was changed`,
      parsed.issues,
    );
  }
  const digest = digestText(text);
  // Reads history only; generation never writes history or markers.
  const history = await readHistoryState(paths, digest);
  return {
    text,
    digest,
    contract: parsed.value,
    stateRevision: history.head?.revision ?? null,
  };
}

/**
 * Generate every view and the manifest from `project.yaml`.
 *
 * - Holds the project write lock, so no CLI commit replaces the contract while
 *   it is being rendered.
 * - `as_of` is explicit, reused from a manifest for the same source, generator
 *   and projection (so regenerating is byte-stable), or taken from the clock
 *   once and recorded. It is never `project.updated_at`.
 * - Writes every file to a temporary first. Before anything is replaced,
 *   `project.yaml` is read again; if its bytes changed, nothing is replaced.
 * - Replaces artifacts, then the manifest last. If any replacement fails, the
 *   files already replaced are restored, so the previous set stays intact.
 * - Never writes `project.yaml`, history, approvals or evidence.
 */
export async function generateArtifacts(input: {
  readonly root: string;
  readonly clock: () => string;
  readonly asOf?: string;
  readonly refresh?: boolean;
  readonly projection?: ProjectionName;
  readonly fs?: GenerateFs;
  readonly hooks?: GenerateHooks;
}): Promise<GenerateResult> {
  const fs = input.fs ?? nodeGenerateFs;
  const paths = pathsFor(input.root);
  const projection = input.projection ?? "remote-default";
  const release = await acquireLock(paths, input.clock);
  try {
    const project = await readProject(paths, fs);
    const targets = artifactPaths(project.contract);
    const outputPaths = [
      targets.agent_context,
      targets.calm_1_2,
      targets.mermaid,
      targets.manifest,
    ];
    // R1: verify the physical destinations before reading or writing any of
    // them, creating missing directories one checked component at a time.
    let physical = new Map(
      (
        await resolveOutputBoundary(input.root, outputPaths, {
          create: true,
          protect: GENERATE_PROTECTION,
        })
      ).map((entry) => [entry.path, entry.physical]),
    );
    const at = (path: string): string => {
      const resolved = physical.get(path);
      if (resolved === undefined) {
        throw new StoreError(`internal error: unresolved output ${path}`);
      }
      return resolved;
    };
    const previousManifest = readManifest(await fs.read(at(targets.manifest)));

    let asOf: string;
    let asOfBasis: AsOfBasis;
    if (input.asOf !== undefined) {
      assertTimestamp(input.asOf);
      asOf = input.asOf;
      asOfBasis = "explicit";
    } else if (
      input.refresh !== true &&
      previousManifest !== null &&
      previousManifest.format === MANIFEST_FORMAT &&
      previousManifest.generator === `${GENERATOR_ID}/${GENERATOR_VERSION}` &&
      previousManifest.projection === projection &&
      previousManifest.source?.contract_hash ===
        contractHash(project.contract) &&
      (previousManifest.source?.state_revision ?? null) ===
        project.stateRevision &&
      typeof previousManifest.as_of === "string"
    ) {
      asOf = previousManifest.as_of;
      asOfBasis = "reused";
    } else {
      asOf = input.clock();
      asOfBasis = "clock";
    }

    const rendered = renderArtifactSet(project.contract, {
      asOf,
      projection,
      stateRevision: project.stateRevision,
    });
    await input.hooks?.afterRender?.();

    const files = [
      ...rendered.artifacts.map((artifact) => ({
        path: artifact.path,
        content: artifact.content,
      })),
      // The manifest is replaced last: until it names the new set, the old
      // manifest still describes whatever is on disk.
      { path: rendered.manifestPath, content: rendered.manifestText },
    ].map((file) => ({ ...file, absolute: at(file.path) }));

    const before = new Map<string, string | null>();
    for (const file of files) {
      before.set(file.absolute, await fs.read(file.absolute));
    }
    // R3: byte equality says nothing about the present. Evaluate the
    // snapshot's time-dependent standings now, separately.
    const freshness = presentFreshness(project.contract, {
      asOf,
      now: input.clock(),
      projection,
      stateRevision: project.stateRevision,
    });

    if (files.every((file) => before.get(file.absolute) === file.content)) {
      const recheck = await fs.read(paths.projectFile);
      if (recheck === null || digestText(recheck) !== project.digest) {
        throw new StoreError(
          `${paths.projectFile} changed while generating; no generated output was changed, run the command again`,
        );
      }
      return {
        rendered,
        asOf,
        asOfBasis,
        unchanged: true,
        written: [],
        warnings: [],
        freshness,
      };
    }

    const suffix = `.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
    const temporaries: string[] = [];
    const discard = async () => {
      for (const path of temporaries) {
        await fs.remove(path).catch(() => undefined);
      }
    };
    try {
      for (const file of files) {
        const temporary = `${file.absolute}${suffix}`;
        temporaries.push(temporary);
        await fs.writeTemporary(temporary, file.content);
      }
    } catch (error) {
      await discard();
      throw error;
    }

    // Recheck the source at write time. The lock excludes CLI commits; this
    // also catches an editor or another tool replacing project.yaml.
    const recheck = await fs.read(paths.projectFile);
    if (recheck === null || digestText(recheck) !== project.digest) {
      await discard();
      throw new StoreError(
        `${paths.projectFile} changed while generating; no generated output was changed, run the command again`,
      );
    }

    // Recheck the physical boundary at the write boundary: a link created
    // after the first check must not redirect a replacement.
    try {
      const rechecked = await resolveOutputBoundary(input.root, outputPaths, {
        create: false,
        protect: GENERATE_PROTECTION,
      });
      if (
        rechecked.some((entry) => entry.physical !== physical.get(entry.path))
      ) {
        throw new StoreError(
          "generated output paths changed while generating; no generated output was changed",
        );
      }
      physical = new Map(
        rechecked.map((entry) => [entry.path, entry.physical]),
      );
    } catch (error) {
      await discard();
      throw error;
    }

    const replaced: string[] = [];
    try {
      for (const file of files) {
        await fs.rename(`${file.absolute}${suffix}`, file.absolute);
        replaced.push(file.absolute);
      }
    } catch (error) {
      const restoreFailures: string[] = [];
      for (const path of replaced.reverse()) {
        const previous = before.get(path) ?? null;
        try {
          if (previous === null) {
            await fs.remove(path);
          } else {
            const restore = `${path}.restore-${process.pid}-${randomBytes(6).toString("hex")}`;
            await fs.writeTemporary(restore, previous);
            await fs.rename(restore, path);
          }
        } catch (restoreError) {
          restoreFailures.push(
            `${path}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
          );
        }
      }
      await discard();
      const reason = error instanceof Error ? error.message : String(error);
      throw new StoreError(
        restoreFailures.length === 0
          ? `generation failed while replacing files (${reason}); the previous generated output was restored`
          : `generation failed while replacing files (${reason}) and some previous files could not be restored (${restoreFailures.join("; ")}); run "anvilmark generate --check"`,
      );
    }

    const warnings: string[] = [];
    const after = await fs.read(paths.projectFile);
    if (after === null || digestText(after) !== project.digest) {
      warnings.push(
        `${paths.projectFile} changed just after generation; the output describes the previous contract and "anvilmark generate --check" reports it as stale`,
      );
    }
    return {
      rendered,
      asOf,
      asOfBasis,
      unchanged: false,
      written: files
        .filter((file) => before.get(file.absolute) !== file.content)
        .map((file) => file.path),
      warnings,
      freshness,
    };
  } finally {
    await release();
  }
}

/** Check generated output against `project.yaml`, reading only. */
export async function checkGenerated(input: {
  readonly root: string;
  readonly now: string;
  readonly projection?: ProjectionName;
  readonly fs?: GenerateFs;
}): Promise<GenerationCheck> {
  const fs = input.fs ?? nodeGenerateFs;
  const paths = pathsFor(input.root);
  const project = await readProject(paths, fs);
  const targets = artifactPaths(project.contract);
  // R1: check the physical boundary before reading any output, without
  // creating anything.
  const resolved = await resolveOutputBoundary(
    input.root,
    [
      targets.agent_context,
      targets.calm_1_2,
      targets.mermaid,
      targets.manifest,
    ],
    { create: false, protect: GENERATE_PROTECTION },
  );
  const contents = new Map<string, string | null>();
  for (const entry of resolved) {
    contents.set(
      entry.path,
      entry.parentExists ? await fs.read(entry.physical) : null,
    );
  }
  return checkArtifactSet({
    contract: project.contract,
    manifestText: contents.get(targets.manifest) ?? null,
    read: (path) => contents.get(path) ?? null,
    now: input.now,
    stateRevision: project.stateRevision,
    ...(input.projection === undefined ? {} : { projection: input.projection }),
  });
}
