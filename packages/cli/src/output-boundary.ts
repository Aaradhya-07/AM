import type { Stats } from "node:fs";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

import { STATE_DIRECTORY, StoreError } from "./store.js";

/**
 * The physical boundary for generated output (Milestone 4 correction R1).
 *
 * Lexical checks on configured paths are not enough: a directory symlink or a
 * case-insensitive alias can make `.anvilmark/exports/project.yaml` the
 * project contract itself. Before generated output is read or written, every
 * path is walked component by component below the physical `.anvilmark/`
 * directory:
 *
 * - no component below `.anvilmark/` may be a symbolic link, and every
 *   intermediate component must be a directory;
 * - an existing destination must be a regular file;
 * - the destination may not be, or lie inside, a protected location
 *   (`project.yaml`, `.lock`, `history/`, `intelligence/`, `evaluations/`),
 *   compared both by file identity and case-insensitively by path;
 * - no two outputs may resolve to the same physical file.
 *
 * `.anvilmark/` itself is resolved with `realpath`, as the store resolves it
 * to read `project.yaml`. This is a guard against misconfiguration and
 * pre-existing links, not against a concurrent attacker with write access to
 * the project directory; the generator rechecks it immediately before
 * replacing files.
 */

export class OutputBoundaryError extends StoreError {
  constructor(message: string) {
    super(`${message}; no generated output was read or changed`);
    this.name = "OutputBoundaryError";
  }
}

const PROTECTED_FILES = ["project.yaml", ".lock"] as const;
const PROTECTED_DIRECTORIES = ["history", "intelligence", "evaluations"];

/**
 * Repository-scan state (Milestone 5). Generated views may not overwrite the
 * scan declarations or the scan output, and the scan may not overwrite
 * generated views' protected state.
 */
export const SCAN_CONFIG_FILE = "scanner.yaml";
export const SCAN_DIRECTORY = "scans";

/**
 * Conformance report state (Milestone 6).
 */
export const CONFORMANCE_DIRECTORY = "conformance";
export const CONFORMANCE_REPORT_FILE = "conformance.json";

export interface BoundaryProtection {
  /** Additional protected file names directly below `.anvilmark/`. */
  readonly files?: readonly string[];
  /** Additional protected directory names directly below `.anvilmark/`. */
  readonly directories?: readonly string[];
  /** Absolute paths (anywhere) that an output may not be, by identity or path. */
  readonly paths?: readonly { readonly path: string; readonly label: string }[];
}

function fold(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export interface PhysicalOutput {
  /** The configured project-relative path, e.g. `.anvilmark/architecture/view.mmd`. */
  readonly path: string;
  /** The physical path below the resolved `.anvilmark/` directory. */
  readonly physical: string;
  /** False when a parent directory does not exist (checked without creating). */
  readonly parentExists: boolean;
}

/**
 * Resolve and verify every output path. With `create`, missing directories
 * are created one component at a time, each checked as it is made.
 */
export async function resolveOutputBoundary(
  root: string,
  paths: readonly string[],
  options: { readonly create: boolean; readonly protect?: BoundaryProtection },
): Promise<PhysicalOutput[]> {
  let stateDirectory: string;
  try {
    stateDirectory = await realpath(join(root, STATE_DIRECTORY));
  } catch {
    throw new OutputBoundaryError(
      `the ${STATE_DIRECTORY} directory could not be resolved`,
    );
  }

  const fileNames = [...PROTECTED_FILES, ...(options.protect?.files ?? [])];
  const directoryNames = [
    ...PROTECTED_DIRECTORIES,
    ...(options.protect?.directories ?? []),
  ];
  const protectedIdentities: { name: string; dev: number; ino: number }[] = [];
  for (const name of fileNames) {
    const stats = await stat(join(stateDirectory, name)).catch(() => null);
    if (stats !== null) {
      protectedIdentities.push({
        name: `${STATE_DIRECTORY}/${name}`,
        dev: stats.dev,
        ino: stats.ino,
      });
    }
  }
  const protectedFiles = fileNames.map((name) =>
    fold(join(stateDirectory, name)),
  );
  for (const entry of options.protect?.paths ?? []) {
    const stats = await stat(entry.path).catch(() => null);
    if (stats !== null) {
      protectedIdentities.push({
        name: entry.label,
        dev: stats.dev,
        ino: stats.ino,
      });
    }
    const physicalPath = await realpath(entry.path).catch(() => entry.path);
    protectedFiles.push(fold(physicalPath));
  }
  const protectedDirectories = directoryNames.map((name) =>
    fold(join(stateDirectory, name)),
  );

  const results: PhysicalOutput[] = [];
  const claimedPaths = new Map<string, string>();
  const claimedIdentities = new Map<string, string>();

  for (const path of paths) {
    const segments = path.split("/");
    if (segments[0] !== STATE_DIRECTORY || segments.length < 2) {
      throw new OutputBoundaryError(
        `generated output "${path}" is not inside ${STATE_DIRECTORY}/`,
      );
    }
    const inner = segments.slice(1);
    if (inner.some((part) => part === "" || part === "." || part === "..")) {
      throw new OutputBoundaryError(
        `generated output "${path}" is not a normalized path`,
      );
    }

    let current = stateDirectory;
    let parentExists = true;
    for (const [index, part] of inner.slice(0, -1).entries()) {
      const shown = `${STATE_DIRECTORY}/${inner.slice(0, index + 1).join("/")}`;
      const next = join(current, part);
      let stats = parentExists ? await lstatOrNull(next) : null;
      if (stats === null && parentExists && options.create) {
        await mkdir(next).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        });
        stats = await lstatOrNull(next);
      }
      if (stats === null) {
        parentExists = false;
      } else if (stats.isSymbolicLink()) {
        throw new OutputBoundaryError(
          `generated output "${path}" passes through a symbolic link at ${shown}; generated files are never written through links`,
        );
      } else if (!stats.isDirectory()) {
        throw new OutputBoundaryError(
          `generated output "${path}" needs ${shown} to be a directory`,
        );
      }
      current = next;
    }

    const physical = join(current, inner[inner.length - 1] as string);
    const folded = fold(physical);
    if (
      protectedFiles.includes(folded) ||
      protectedDirectories.some(
        (directory) =>
          folded === directory || folded.startsWith(directory + sep),
      )
    ) {
      throw new OutputBoundaryError(
        `generated output "${path}" resolves to protected project state (${physical.slice(stateDirectory.length + 1)})`,
      );
    }

    const existing = parentExists ? await lstatOrNull(physical) : null;
    if (existing !== null) {
      if (existing.isSymbolicLink()) {
        throw new OutputBoundaryError(
          `generated output "${path}" is a symbolic link; generated files are never written through links`,
        );
      }
      if (!existing.isFile()) {
        throw new OutputBoundaryError(
          `generated output "${path}" exists and is not a regular file`,
        );
      }
      const alias = protectedIdentities.find(
        (entry) => entry.dev === existing.dev && entry.ino === existing.ino,
      );
      if (alias !== undefined) {
        throw new OutputBoundaryError(
          `generated output "${path}" is the same file as ${alias.name}`,
        );
      }
      const identity = `${existing.dev}:${existing.ino}`;
      const other = claimedIdentities.get(identity);
      if (other !== undefined) {
        throw new OutputBoundaryError(
          `generated outputs "${other}" and "${path}" are the same file`,
        );
      }
      claimedIdentities.set(identity, path);
    }

    const other = claimedPaths.get(folded);
    if (other !== undefined) {
      throw new OutputBoundaryError(
        `generated outputs "${other}" and "${path}" resolve to the same physical path`,
      );
    }
    claimedPaths.set(folded, path);
    results.push({ path, physical, parentExists });
  }
  return results;
}
