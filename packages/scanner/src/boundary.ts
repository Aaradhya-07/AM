import type { Stats } from "node:fs";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import ts from "typescript";

import { compareStrings, sha256 } from "./model.js";

/**
 * The only way the scanner reads anything.
 *
 * - Reads are allowed below the physical repository root, and — for the
 *   bundled TypeScript default-library declarations only — below the
 *   compiler's own `lib` directory. Nothing else is read, whatever an import,
 *   `extends`, `typeRoots` or symlink points at.
 * - Every path is resolved with `realpath` before the check, so a symbolic
 *   link inside the repository that points outside it is refused (and
 *   recorded by its repository-relative name, never by its target).
 * - Directories the caller denies — the project's own `.anvilmark/` state and
 *   scanner output — are refused even when they lie inside the repository.
 * - Lookups outside the repository (the compiler probing ancestor
 *   `node_modules`) simply report "absent"; their absolute paths are never
 *   recorded.
 * - Each repository file's exact bytes are hashed on first read and cached, so
 *   the compiler sees one version of every file; `recheck` re-reads them to
 *   detect changes made while the scan ran.
 *
 * This bounds what the scanner reads under normal conditions. It does not
 * defend against a concurrent process swapping files or links mid-read.
 */

export type InputRole =
  | "source"
  | "declaration"
  | "manifest"
  | "lockfile"
  | "compiler_config"
  | "ignore_rules"
  | "resolution_input";

export interface InputRecord {
  readonly path: string;
  readonly sha256: string;
  readonly role: InputRole;
}

export interface BoundaryLimit {
  readonly kind:
    | "outside_repository_boundary"
    | "denied_directory"
    | "file_too_large"
    | "symlink_not_followed"
    | "not_a_regular_file";
  readonly path: string;
}

export interface ReadFailure {
  readonly path: string;
  readonly code: string;
}

export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
/**
 * Dependency type declarations are read under a larger cap than repository
 * source: they are generated (an icon package ships megabytes of them), they
 * are parsed for types and never reported as observations, and refusing one
 * silently degrades the types of every file that imports it.
 */
export const DEFAULT_MAX_DECLARATION_BYTES = 8 * 1024 * 1024;

function inside(path: string, directory: string): boolean {
  return path === directory || path.startsWith(directory + sep);
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export class RepositoryReader {
  readonly root: string;
  readonly libDirectory: string;
  private readonly denied: readonly string[];
  private readonly maxFileBytes: number;
  private readonly texts = new Map<string, string>();
  private readonly records = new Map<string, InputRecord>();
  private readonly limitList = new Map<string, BoundaryLimit>();
  private readonly failureList = new Map<string, ReadFailure>();
  private readonly lookups = new Map<
    string,
    { path: string; directory: boolean; exists: boolean }
  >();
  private readonly directoryLookups = new Map<string, string[]>();

  constructor(input: {
    readonly root: string;
    readonly deniedDirectories?: readonly string[];
    readonly maxFileBytes?: number;
  }) {
    this.root = realpathSync(input.root);
    this.libDirectory = realpathSync(
      dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 })),
    );
    this.denied = (input.deniedDirectories ?? []).flatMap((path) => {
      try {
        return [realpathSync(path)];
      } catch {
        return [];
      }
    });
    this.maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  /** Repository-relative, `/`-separated form of a path below the root. */
  relative(path: string): string {
    const value = toPosix(relative(this.root, path));
    return value === "" ? "." : value;
  }

  isInsideRoot(path: string): boolean {
    return inside(path, this.root);
  }

  private limit(kind: BoundaryLimit["kind"], path: string): void {
    this.limitList.set(`${kind}:${path}`, { kind, path });
  }

  /**
   * Classify a path. Returns the physical path when it may be read, or null.
   * `record` controls whether a refusal inside the repository is recorded.
   */
  private allowed(path: string, record: boolean): string | null {
    const absolute = isAbsolute(path) ? path : `${this.root}${sep}${path}`;
    const lexicalInside = inside(absolute, this.root);
    const lexicalLib = inside(absolute, this.libDirectory);
    let physical: string;
    try {
      physical = realpathSync(absolute);
    } catch {
      return null;
    }
    if (inside(physical, this.libDirectory)) {
      return /[\\/]lib\.[^\\/]*\.d\.ts$/.test(physical) ? physical : null;
    }
    if (!inside(physical, this.root)) {
      if (record && lexicalInside && !lexicalLib) {
        this.limit("outside_repository_boundary", this.relative(absolute));
      }
      return null;
    }
    const denied = this.denied.find((directory) => inside(physical, directory));
    if (denied !== undefined) {
      if (record) this.limit("denied_directory", this.relative(physical));
      return null;
    }
    return physical;
  }

  private stats(physical: string): Stats | null {
    try {
      return statSync(physical);
    } catch {
      return null;
    }
  }

  fileExists(path: string): boolean {
    // A refusal is recorded only for paths that lie lexically inside the
    // repository (a link escaping it, or a denied directory); the compiler's
    // probes of ancestor directories are never recorded.
    const physical = this.allowed(path, true);
    const exists = physical !== null && this.stats(physical)?.isFile() === true;
    this.rememberLookup(path, false, exists);
    return exists;
  }

  directoryExists(path: string): boolean {
    const physical = this.allowed(path, true);
    const exists =
      physical !== null && this.stats(physical)?.isDirectory() === true;
    this.rememberLookup(path, true, exists);
    return exists;
  }

  private rememberLookup(
    path: string,
    directory: boolean,
    exists: boolean,
  ): void {
    const absolute = resolve(this.root, path);
    if (
      !inside(absolute, this.root) ||
      this.denied.some((denied) => inside(absolute, denied))
    )
      return;
    this.lookups.set(`${directory}:${absolute}`, {
      path: absolute,
      directory,
      exists,
    });
  }

  getDirectories(path: string): string[] {
    const physical = this.allowed(path, false);
    if (physical === null) return [];
    try {
      const names = readdirSync(physical, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(compareStrings);
      if (inside(physical, this.root))
        this.directoryLookups.set(physical, names);
      return names;
    } catch {
      return [];
    }
  }

  realpath(path: string): string {
    return this.allowed(path, false) ?? path;
  }

  /** Read a text file through the boundary; undefined when refused or absent. */
  readText(path: string, role: InputRole): string | undefined {
    const physical = this.allowed(path, true);
    if (physical === null) return undefined;
    const cached = this.texts.get(physical);
    if (cached !== undefined) return cached;
    const stats = this.stats(physical);
    if (stats === null) return undefined;
    const fromLib = inside(physical, this.libDirectory);
    const shown = fromLib ? null : this.relative(physical);
    if (!stats.isFile()) {
      if (shown !== null) this.limit("not_a_regular_file", shown);
      return undefined;
    }
    const cap =
      physical.includes(`${sep}node_modules${sep}`) &&
      physical.endsWith(".d.ts")
        ? Math.max(this.maxFileBytes, DEFAULT_MAX_DECLARATION_BYTES)
        : this.maxFileBytes;
    if (!fromLib && stats.size > cap) {
      this.limit("file_too_large", shown as string);
      return undefined;
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(physical);
    } catch (error) {
      if (shown !== null) {
        this.failureList.set(shown, {
          path: shown,
          code: (error as NodeJS.ErrnoException).code ?? "EIO",
        });
      }
      return undefined;
    }
    const text = bytes.toString("utf8");
    this.texts.set(physical, text);
    if (shown !== null) {
      const existing = this.records.get(shown);
      this.records.set(shown, {
        path: shown,
        sha256: sha256(bytes),
        role: existing?.role ?? role,
      });
    }
    return text;
  }

  /** Hash a file without keeping its text (lockfiles). */
  hashFile(path: string, role: InputRole): string | null {
    const physical = this.allowed(path, true);
    if (physical === null) return null;
    const stats = this.stats(physical);
    if (stats === null || !stats.isFile()) return null;
    try {
      const digest = sha256(readFileSync(physical));
      const shown = this.relative(physical);
      this.records.set(shown, { path: shown, sha256: digest, role });
      return digest;
    } catch (error) {
      const shown = this.relative(physical);
      this.failureList.set(shown, {
        path: shown,
        code: (error as NodeJS.ErrnoException).code ?? "EIO",
      });
      return null;
    }
  }

  /** Assign a more specific role to an already-read input. */
  setRole(path: string, role: InputRole): void {
    const existing = this.records.get(path);
    if (existing !== undefined) {
      this.records.set(path, { ...existing, role });
    }
  }

  /** lstat without following links, for the inventory walk. */
  lstat(path: string): Stats | null {
    try {
      return lstatSync(path);
    } catch {
      return null;
    }
  }

  readDirectory(path: string): string[] | null {
    const physical = this.allowed(path, true);
    if (physical === null) return null;
    try {
      return readdirSync(physical).sort(compareStrings);
    } catch (error) {
      const shown = this.relative(physical);
      this.failureList.set(shown, {
        path: shown,
        code: (error as NodeJS.ErrnoException).code ?? "EIO",
      });
      return null;
    }
  }

  recordLimit(kind: BoundaryLimit["kind"], path: string): void {
    this.limit(kind, path);
  }

  inputs(): InputRecord[] {
    return [...this.records.values()].sort((left, right) =>
      compareStrings(left.path, right.path),
    );
  }

  limits(): BoundaryLimit[] {
    return [...this.limitList.values()].sort(
      (left, right) =>
        compareStrings(left.path, right.path) ||
        compareStrings(left.kind, right.kind),
    );
  }

  failures(): ReadFailure[] {
    return [...this.failureList.values()].sort((left, right) =>
      compareStrings(left.path, right.path),
    );
  }

  /** Re-read every recorded input; returns the paths whose bytes changed or vanished. */
  recheck(): string[] {
    const changed: string[] = [];
    for (const record of this.records.values()) {
      const absolute = `${this.root}${sep}${record.path.split("/").join(sep)}`;
      try {
        const physical = realpathSync(absolute);
        if (!inside(physical, this.root)) {
          changed.push(record.path);
          continue;
        }
        if (sha256(readFileSync(physical)) !== record.sha256) {
          changed.push(record.path);
        }
      } catch {
        changed.push(record.path);
      }
    }
    // Missing modules/configs are inputs too: a formerly absent declaration
    // can change resolution without changing any byte we previously read.
    for (const lookup of [...this.lookups.values()]) {
      const physical = this.allowed(lookup.path, false);
      const stats = physical === null ? null : this.stats(physical);
      const exists = lookup.directory
        ? stats?.isDirectory() === true
        : stats?.isFile() === true;
      if (exists !== lookup.exists) changed.push(this.relative(lookup.path));
    }
    for (const [directory, before] of [...this.directoryLookups]) {
      const physical = this.allowed(directory, false);
      let after: string[] = [];
      if (physical !== null) {
        try {
          after = readdirSync(physical, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort(compareStrings);
        } catch {
          changed.push(this.relative(directory));
        }
      }
      if (JSON.stringify(before) !== JSON.stringify(after))
        changed.push(this.relative(directory));
    }
    return [...new Set(changed)].sort(compareStrings);
  }
}
