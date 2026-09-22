import { join, posix, sep } from "node:path";

import type { RepositoryReader } from "./boundary.js";
import type { ScanConfig } from "./config.js";
import { compareStrings } from "./model.js";
import type { RecognizerSet } from "./recognizers/index.js";
import {
  isUnsupportedSdk,
  modelFactoryFor,
  providerForPackage,
} from "./recognizers/index.js";

/**
 * Inventory stage: which files exist, which are excluded and why, and what
 * the package manifests declare. Nothing here parses source code or runs a
 * package manager, script or build command.
 */

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/** Directory names excluded wherever they appear. */
export const DEFAULT_EXCLUDED_DIRECTORIES = [
  ".anvilmark",
  ".cache",
  ".git",
  ".hg",
  ".next",
  ".nuxt",
  ".output",
  ".pnpm-store",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".yarn",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "jspm_packages",
  "node_modules",
  "out",
  "vendor",
] as const;

const LOCKFILES: Record<string, string> = {
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "npm-shrinkwrap.json": "npm",
  "package-lock.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
};

export type ExclusionReason =
  | "default_excluded_directory"
  | "gitignore"
  | "config_exclude"
  | "environment_file_not_read"
  | "minified_file";

export interface Exclusion {
  readonly path: string;
  readonly reason: ExclusionReason;
}

export interface InventoryLimit {
  readonly kind:
    | "gitignore_pattern_not_applied"
    | "nested_gitignore_not_applied"
    | "include_path_missing";
  readonly path: string;
  readonly detail: string | null;
}

export interface ManifestProblem {
  readonly path: string;
  readonly kind: "manifest_unreadable" | "manifest_invalid_json";
}

export interface DependencyFact {
  readonly name: string;
  /** A registry range, `workspace:` or a marker; never a URL or local path. */
  readonly declared: string;
  readonly section:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  readonly manifest: string;
  /** Version from an installed package.json inside the repository, else null. */
  readonly installed_version: string | null;
  readonly category: "provider_sdk" | "unsupported_ai_sdk" | "other";
  readonly recognizer: string | null;
}

export interface ManifestFact {
  readonly path: string;
  readonly name: string | null;
  readonly package_manager: string | null;
  readonly entry_points: readonly { field: string; path: string }[];
  readonly dependency_count: number;
}

export interface Inventory {
  readonly sourceFiles: readonly string[];
  readonly declarationFiles: readonly string[];
  readonly manifests: readonly ManifestFact[];
  readonly dependencies: readonly DependencyFact[];
  readonly lockfiles: readonly { path: string; package_manager: string }[];
  readonly excluded: readonly Exclusion[];
  readonly limits: readonly InventoryLimit[];
  readonly manifestProblems: readonly ManifestProblem[];
}

function isSource(name: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function isDeclaration(name: string): boolean {
  return /\.d\.(?:ts|mts|cts)$/.test(name) || /\.d\.[^.]+\.ts$/.test(name);
}

/**
 * `.gitignore` rules for one directory, applied to paths relative to it:
 * blank lines and comments are skipped; `*`, `?`, `**` and character classes
 * are supported; a trailing `/` matches directories only; a pattern with a
 * `/` before its end is anchored to the file's directory; `!` re-includes,
 * and the last matching rule wins. As in Git, a path inside an excluded
 * directory is never re-included, because that directory is not traversed.
 */
export class IgnoreRules {
  private readonly rules: {
    readonly regex: RegExp;
    readonly anchored: boolean;
    readonly directoryOnly: boolean;
    readonly negated: boolean;
  }[] = [];

  constructor(text: string | undefined) {
    if (text === undefined) return;
    for (const raw of text.split(/\r?\n/)) {
      let line = raw.replace(/(?<!\\)\s+$/, "");
      if (line === "" || line.startsWith("#")) continue;
      const negated = line.startsWith("!");
      if (negated) line = line.slice(1);
      if (line.startsWith("\\#") || line.startsWith("\\!"))
        line = line.slice(1);
      let pattern = line;
      const directoryOnly = pattern.endsWith("/");
      if (directoryOnly) pattern = pattern.slice(0, -1);
      const anchored = pattern.includes("/");
      if (pattern.startsWith("/")) pattern = pattern.slice(1);
      if (pattern === "") continue;
      this.rules.push({
        regex: new RegExp(`^${globToRegex(pattern)}$`),
        anchored,
        directoryOnly,
        negated,
      });
    }
  }

  /** `true` ignored, `false` re-included, `null` no rule matched. */
  decide(path: string, directory: boolean): boolean | null {
    const name = posix.basename(path);
    let decision: boolean | null = null;
    for (const rule of this.rules) {
      if (rule.directoryOnly && !directory) continue;
      if (rule.regex.test(rule.anchored ? path : name))
        decision = !rule.negated;
    }
    return decision;
  }

  ignores(path: string, directory: boolean): boolean {
    return this.decide(path, directory) === true;
  }
}

function globToRegex(pattern: string): string {
  let out = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        const slash = pattern[index + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        index += slash ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (char === "?") {
      out += "[^/]";
    } else if (char === "[") {
      const close = pattern.indexOf("]", index + 1);
      if (close === -1) {
        out += "\\[";
      } else {
        out += `[${pattern.slice(index + 1, close).replace(/\\/g, "\\\\")}]`;
        index = close;
      }
    } else {
      out += char.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }
  return out;
}

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const SAFE_RANGE = /^(?:workspace:)?[\w.^~<>=|*\s-]{1,64}$/;

function declaredRange(value: unknown): string {
  if (typeof value !== "string") return "<not a string>";
  return SAFE_RANGE.test(value) ? value : "<non-registry specifier>";
}

function entryPoints(
  manifest: Record<string, unknown>,
  directory: string,
): { field: string; path: string }[] {
  const found: { field: string; path: string }[] = [];
  const add = (field: string, value: unknown) => {
    if (typeof value !== "string") return;
    const cleaned = value.replace(/^\.\//, "");
    if (
      cleaned === "" ||
      cleaned.includes(":") ||
      cleaned.startsWith("/") ||
      cleaned.includes("\\") ||
      cleaned.split("/").some((part) => part === ".." || part === "") ||
      cleaned.includes("*")
    ) {
      return;
    }
    found.push({
      field,
      path: directory === "." ? cleaned : `${directory}/${cleaned}`,
    });
  };
  for (const field of ["main", "module", "browser", "types"]) {
    add(field, manifest[field]);
  }
  const bin = manifest.bin;
  if (typeof bin === "string") add("bin", bin);
  else if (bin !== null && typeof bin === "object") {
    for (const key of Object.keys(bin).sort(compareStrings)) {
      add("bin", (bin as Record<string, unknown>)[key]);
    }
  }
  const walk = (value: unknown, depth: number) => {
    if (depth > 4) return;
    if (typeof value === "string") add("exports", value);
    else if (value !== null && typeof value === "object") {
      for (const key of Object.keys(value).sort(compareStrings)) {
        walk((value as Record<string, unknown>)[key], depth + 1);
      }
    }
  };
  walk(manifest.exports, 0);
  const unique = new Map(
    found.map((entry) => [`${entry.field}:${entry.path}`, entry]),
  );
  return [...unique.values()].sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      compareStrings(left.field, right.field),
  );
}

function installedVersion(
  reader: RepositoryReader,
  manifestDirectory: string,
  name: string,
): string | null {
  const candidates = [
    manifestDirectory === "."
      ? `node_modules/${name}/package.json`
      : `${manifestDirectory}/node_modules/${name}/package.json`,
    `node_modules/${name}/package.json`,
  ];
  for (const candidate of candidates) {
    const text = reader.readText(
      join(reader.root, ...candidate.split("/")),
      "resolution_input",
    );
    if (text === undefined) continue;
    try {
      const version = (JSON.parse(text) as { version?: unknown }).version;
      if (typeof version === "string" && /^[\w.+-]{1,64}$/.test(version)) {
        return version;
      }
      return null;
    } catch {
      return null;
    }
  }
  return null;
}

export function buildInventory(
  reader: RepositoryReader,
  config: ScanConfig,
  recognizers: RecognizerSet,
): Inventory {
  const sourceFiles: string[] = [];
  const declarationFiles: string[] = [];
  const manifestPaths: string[] = [];
  const lockfiles: { path: string; package_manager: string }[] = [];
  const excluded = new Map<string, Exclusion>();
  const limits: InventoryLimit[] = [];
  const manifestProblems: ManifestProblem[] = [];

  // `.gitignore` files by directory ("." is the root), read as directories are visited.
  const ignoreByDirectory = new Map<string, IgnoreRules>();
  const rulesFor = (directory: string): IgnoreRules => {
    let rules = ignoreByDirectory.get(directory);
    if (rules === undefined) {
      const absolute =
        directory === "."
          ? join(reader.root, ".gitignore")
          : join(reader.root, ...directory.split("/"), ".gitignore");
      const stats = reader.lstat(absolute);
      rules = new IgnoreRules(
        stats !== null && stats.isFile()
          ? reader.readText(absolute, "ignore_rules")
          : undefined,
      );
      ignoreByDirectory.set(directory, rules);
    }
    return rules;
  };
  const ignored = (path: string, directory: boolean): boolean => {
    const parts = path.split("/");
    let decision: boolean | null = null;
    // Deeper files override shallower ones; each sees the path relative to itself.
    for (let depth = 0; depth < parts.length; depth += 1) {
      const base = depth === 0 ? "." : parts.slice(0, depth).join("/");
      const result = rulesFor(base).decide(
        parts.slice(depth).join("/"),
        directory,
      );
      if (result !== null) decision = result;
    }
    return decision === true;
  };
  const configExcluded = (path: string) =>
    config.exclude.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
  const defaultExcluded = new Set<string>(DEFAULT_EXCLUDED_DIRECTORIES);
  const visited = new Set<string>();

  const visit = (relative: string) => {
    if (visited.has(relative)) return;
    visited.add(relative);
    const absolute =
      relative === "."
        ? reader.root
        : join(reader.root, ...relative.split("/"));
    const stats = reader.lstat(absolute);
    if (stats === null) return;
    if (stats.isSymbolicLink()) {
      reader.recordLimit("symlink_not_followed", relative);
      return;
    }
    if (stats.isDirectory()) {
      const names = reader.readDirectory(absolute);
      if (names === null) return;
      for (const name of names) {
        const child = relative === "." ? name : `${relative}/${name}`;
        const childStats = reader.lstat(join(absolute, name));
        if (childStats === null) continue;
        const directory = childStats.isDirectory();
        if (directory && defaultExcluded.has(name)) {
          excluded.set(child, {
            path: child,
            reason: "default_excluded_directory",
          });
          continue;
        }
        if (configExcluded(child)) {
          excluded.set(child, { path: child, reason: "config_exclude" });
          continue;
        }
        if (ignored(child, directory)) {
          excluded.set(child, { path: child, reason: "gitignore" });
          continue;
        }
        if (!directory && /^\.env(?:\..*)?$/.test(name)) {
          excluded.set(child, {
            path: child,
            reason: "environment_file_not_read",
          });
          continue;
        }
        visit(child);
      }
      return;
    }
    if (!stats.isFile()) return;
    const name = posix.basename(relative);
    if (name === ".gitignore") return;
    if (name === "package.json") {
      manifestPaths.push(relative);
      return;
    }
    const manager = LOCKFILES[name];
    if (manager !== undefined) {
      if (reader.hashFile(absolute, "lockfile") !== null) {
        lockfiles.push({ path: relative, package_manager: manager });
      }
      return;
    }
    if (/\.min\.[cm]?js$/.test(name)) {
      excluded.set(relative, { path: relative, reason: "minified_file" });
      return;
    }
    if (isDeclaration(name)) declarationFiles.push(relative);
    else if (isSource(name)) sourceFiles.push(relative);
  };

  for (const include of [...config.include].sort(compareStrings)) {
    const absolute =
      include === "." ? reader.root : join(reader.root, ...include.split("/"));
    if (reader.lstat(absolute) === null) {
      limits.push({
        kind: "include_path_missing",
        path: include,
        detail: null,
      });
      continue;
    }
    if (include !== "." && configExcluded(include)) continue;
    visit(include);
  }
  // Root manifests and lockfiles are inventory facts even when `include`
  // narrows the analysed sources.
  for (const name of ["package.json", ...Object.keys(LOCKFILES)]) {
    if (!visited.has(name) && reader.lstat(join(reader.root, name))?.isFile()) {
      visit(name);
    }
  }

  const manifests: ManifestFact[] = [];
  const dependencies: DependencyFact[] = [];
  for (const path of [...new Set(manifestPaths)].sort(compareStrings)) {
    const text = reader.readText(
      join(reader.root, ...path.split("/")),
      "manifest",
    );
    if (text === undefined) {
      manifestProblems.push({ path, kind: "manifest_unreadable" });
      continue;
    }
    let manifest: Record<string, unknown>;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("not an object");
      }
      manifest = parsed as Record<string, unknown>;
    } catch {
      manifestProblems.push({ path, kind: "manifest_invalid_json" });
      continue;
    }
    const directory = posix.dirname(path);
    let count = 0;
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ] as const) {
      const block = manifest[section];
      if (block === null || typeof block !== "object") continue;
      for (const name of Object.keys(block).sort(compareStrings)) {
        if (!NPM_NAME.test(name)) continue;
        count += 1;
        const provider =
          providerForPackage(recognizers, name) ??
          modelFactoryFor(recognizers, name)?.recognizer ??
          null;
        const unsupported = isUnsupportedSdk(recognizers, name);
        const category =
          provider !== null
            ? "provider_sdk"
            : unsupported
              ? "unsupported_ai_sdk"
              : "other";
        if (category === "other") continue;
        dependencies.push({
          name,
          declared: declaredRange((block as Record<string, unknown>)[name]),
          section,
          manifest: path,
          installed_version: installedVersion(reader, directory, name),
          category,
          recognizer: provider?.id ?? null,
        });
      }
    }
    const packageManager = manifest.packageManager;
    manifests.push({
      path,
      name:
        typeof manifest.name === "string" && NPM_NAME.test(manifest.name)
          ? manifest.name
          : null,
      package_manager:
        typeof packageManager === "string" &&
        /^(?:npm|pnpm|yarn|bun)@[\w.+-]{1,64}$/.test(packageManager)
          ? packageManager
          : null,
      entry_points: entryPoints(manifest, directory),
      dependency_count: count,
    });
  }

  return {
    sourceFiles: sourceFiles.sort(compareStrings),
    declarationFiles: declarationFiles.sort(compareStrings),
    manifests,
    dependencies: dependencies.sort(
      (left, right) =>
        compareStrings(left.manifest, right.manifest) ||
        compareStrings(left.name, right.name) ||
        compareStrings(left.section, right.section),
    ),
    lockfiles: lockfiles.sort((left, right) =>
      compareStrings(left.path, right.path),
    ),
    excluded: [...excluded.values()].sort((left, right) =>
      compareStrings(left.path, right.path),
    ),
    limits: limits.sort(
      (left, right) =>
        compareStrings(left.path, right.path) ||
        compareStrings(left.kind, right.kind),
    ),
    manifestProblems,
  };
}

/** Absolute path of a repository-relative path. */
export function absoluteIn(root: string, path: string): string {
  return path === "." ? root : `${root}${sep}${path.split("/").join(sep)}`;
}
