import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { sanitizeText } from "@anvilmark/adapters";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  stringOption,
  writeJson,
} from "./common.js";

export const EXPORT_CONTEXT_USAGE = `Usage:
  anvilmark export-context [--goal TEXT] [--out FILE] [--json] [-C DIR]

Inspects the local repository deterministically and exports STRUCTURAL
metadata (anvilmark.repo-context.v1) for AnvilMark Studio planning:
languages, frameworks, package manager, package scripts, check commands,
ADR paths under docs/, and up to 150 tracked file paths.

Never read or exported: source file contents, .env files, private keys or
credential files. Only package.json manifests are parsed, for names, scripts
and dependency names.

Options
  --goal TEXT          the outcome you want to plan (included verbatim)
  --out FILE           write the JSON atomically to FILE and print its path
  --json               print the JSON to stdout (the default without --out)
  -C, --project-dir    the repository root (default: current directory)`;

export const REPO_CONTEXT_VERSION = "anvilmark.repo-context.v1";

export interface RepoContext {
  version: typeof REPO_CONTEXT_VERSION;
  exportedAt: string;
  repoName: string;
  goal?: string;
  languages: string[];
  frameworks: string[];
  packageManager: string | null;
  scripts: Record<string, string>;
  checkCommands: string[];
  adrPaths: string[];
  sampleFiles: string[];
  totalTrackedFiles: number;
  hasAnvilmarkDir: boolean;
  summary: string;
}

const SAMPLE_LIMIT = 150;
const ADR_LIMIT = 50;
const MANIFEST_LIMIT = 24;
const WALK_LIMIT = 20_000;
const MAX_MANIFEST_BYTES = 512 * 1024;
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  ".turbo",
  "coverage",
  ".anvilmark",
]);

const exec = promisify(execFile);

/**
 * Paths whose very presence may be sensitive, and whose contents are never
 * read. They are dropped from every list and count.
 */
export function isSensitivePath(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (
    /^\.env(\..*)?$/.test(name) ||
    /\.env$/.test(name) ||
    /\.(pem|key|p12|pfx|jks|keystore|asc|gpg|ppk|kdbx)$/.test(name) ||
    /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(name) ||
    /^(\.npmrc|\.netrc|\.pgpass|\.htpasswd|\.git-credentials|\.pypirc)$/.test(
      name,
    ) ||
    /(^|[-_.])(credentials?|secrets?|service-account)([-_.]|$)/.test(name)
  );
}

function isExcluded(path: string): boolean {
  return path.split("/").some((segment) => EXCLUDED_DIRECTORIES.has(segment));
}

const LANGUAGES: Readonly<Record<string, string>> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".cs": "C#",
  ".rb": "Ruby",
  ".php": "PHP",
  ".swift": "Swift",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".hpp": "C++",
  ".dart": "Dart",
  ".scala": "Scala",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".vue": "Vue",
  ".svelte": "Svelte",
};

const FRAMEWORKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^next$/, "Next.js"],
  [/^react$/, "React"],
  [/^react-native$/, "React Native"],
  [/^vue$/, "Vue"],
  [/^nuxt$/, "Nuxt"],
  [/^svelte$/, "Svelte"],
  [/^@sveltejs\/kit$/, "SvelteKit"],
  [/^@angular\/core$/, "Angular"],
  [/^astro$/, "Astro"],
  [/^@remix-run\//, "Remix"],
  [/^solid-js$/, "Solid"],
  [/^express$/, "Express"],
  [/^fastify$/, "Fastify"],
  [/^koa$/, "Koa"],
  [/^hono$/, "Hono"],
  [/^@nestjs\/core$/, "NestJS"],
  [/^electron$/, "Electron"],
  [/^vite$/, "Vite"],
  [/^vitest$/, "Vitest"],
  [/^jest$/, "Jest"],
  [/^mocha$/, "Mocha"],
  [/^@playwright\/test$/, "Playwright"],
  [/^cypress$/, "Cypress"],
  [/^tailwindcss$/, "Tailwind CSS"],
  [/^(prisma|@prisma\/client)$/, "Prisma"],
  [/^drizzle-orm$/, "Drizzle"],
  [/^typeorm$/, "TypeORM"],
  [/^mongoose$/, "Mongoose"],
  [/^@trpc\/server$/, "tRPC"],
  [/^graphql$/, "GraphQL"],
  [/^zod$/, "Zod"],
  [/^turbo$/, "Turborepo"],
  [/^eslint$/, "ESLint"],
  [/^prettier$/, "Prettier"],
];

const FILE_FRAMEWORKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^manage\.py$/, "Django"],
  [/^Cargo\.toml$/, "Cargo"],
  [/^go\.mod$/, "Go modules"],
  [/^pyproject\.toml$/, "Python packaging (pyproject)"],
  [/^Dockerfile$/, "Docker"],
  [/^(docker-)?compose\.ya?ml$/, "Docker Compose"],
  [/^pnpm-workspace\.yaml$/, "pnpm workspaces"],
];

const CHECK_SCRIPTS = [
  "check",
  "typecheck",
  "type-check",
  "lint",
  "format:check",
  "test",
  "test:unit",
  "test:e2e",
  "build",
];

async function trackedFiles(root: string): Promise<string[]> {
  try {
    const result = await exec(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
      },
    );
    const paths = result.stdout.split("\0").filter(Boolean);
    return paths.length > 0 ? paths : walk(root);
  } catch {
    return walk(root);
  }
}

/** Fallback for directories that are not Git work trees. Never follows links. */
async function walk(root: string): Promise<string[]> {
  const result: string[] = [];
  const pending: string[] = [""];
  while (pending.length > 0 && result.length < WALK_LIMIT) {
    const relative = pending.shift() ?? "";
    const entries = await readdir(join(root, relative), {
      withFileTypes: true,
    }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) pending.push(path);
      } else if (entry.isFile()) {
        result.push(path);
        if (result.length >= WALK_LIMIT) break;
      }
    }
  }
  return result;
}

type Manifest = Record<string, unknown>;

async function readManifest(
  root: string,
  path: string,
): Promise<Manifest | null> {
  const full = resolve(root, path);
  if (!full.startsWith(`${root}/`)) return null;
  const info = await lstat(full).catch(() => null);
  if (!info?.isFile() || info.size > MAX_MANIFEST_BYTES) return null;
  if (!(await realpath(full)).startsWith(`${root}/`)) return null;
  try {
    const value: unknown = JSON.parse(await readFile(full, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Manifest)
      : null;
  } catch {
    return null;
  }
}

function keys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

function stringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  for (const name of Object.keys(value).sort()) {
    const command = (value as Record<string, unknown>)[name];
    if (typeof command === "string") {
      // Scripts occasionally inline tokens; published credential shapes are
      // removed before export.
      result[name] = sanitizeText(command).text.slice(0, 500);
    }
  }
  return result;
}

function detectPackageManager(
  manifest: Manifest | null,
  rootFiles: ReadonlySet<string>,
): string | null {
  const declared = manifest?.packageManager;
  if (typeof declared === "string") {
    const name = /^([a-z]+)@/.exec(declared)?.[1];
    if (name) return name;
  }
  if (rootFiles.has("pnpm-lock.yaml") || rootFiles.has("pnpm-workspace.yaml"))
    return "pnpm";
  if (rootFiles.has("yarn.lock")) return "yarn";
  if (rootFiles.has("bun.lockb") || rootFiles.has("bun.lock")) return "bun";
  if (rootFiles.has("package-lock.json") || rootFiles.has("package.json"))
    return "npm";
  if (rootFiles.has("Cargo.toml")) return "cargo";
  if (rootFiles.has("go.mod")) return "go";
  if (rootFiles.has("uv.lock")) return "uv";
  if (rootFiles.has("poetry.lock")) return "poetry";
  if (rootFiles.has("Pipfile")) return "pipenv";
  if (rootFiles.has("requirements.txt") || rootFiles.has("pyproject.toml"))
    return "pip";
  return null;
}

function runScript(packageManager: string | null, name: string): string {
  switch (packageManager) {
    case "pnpm":
      return name === "test" ? "pnpm test" : `pnpm run ${name}`;
    case "yarn":
      return `yarn ${name}`;
    case "bun":
      return `bun run ${name}`;
    default:
      return name === "test" ? "npm test" : `npm run ${name}`;
  }
}

function isAdrPath(path: string): boolean {
  if (!path.startsWith("docs/") || extname(path).toLowerCase() !== ".md")
    return false;
  return (
    /(^|\/)(adrs?|decisions?|architecture-decisions?)\//i.test(path) ||
    /^(adr|decision)[-_ ]?\d/i.test(basename(path))
  );
}

export async function exportRepoContext(
  projectDir: string,
  options: { readonly goal?: string; readonly now: string },
): Promise<RepoContext> {
  const info = await lstat(projectDir).catch(() => null);
  if (!info?.isDirectory())
    throw new Error(`project directory not found: ${projectDir}`);
  const root = await realpath(projectDir);

  const files = (await trackedFiles(root))
    .filter((path) => !isExcluded(path) && !isSensitivePath(path))
    .sort();
  const rootFiles = new Set(files.filter((path) => !path.includes("/")));

  const rootManifest = rootFiles.has("package.json")
    ? await readManifest(root, "package.json")
    : null;
  const manifests = [
    ...(rootManifest ? [rootManifest] : []),
    ...(
      await Promise.all(
        files
          .filter(
            (path) =>
              path.endsWith("/package.json") &&
              !/(^|\/)(test|tests|__tests__|fixtures|examples?)\//.test(path),
          )
          .slice(0, MANIFEST_LIMIT)
          .map((path) => readManifest(root, path)),
      )
    ).filter((item): item is Manifest => item !== null),
  ];

  const languageCounts = new Map<string, number>();
  for (const path of files) {
    const language = LANGUAGES[extname(path).toLowerCase()];
    if (language)
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
  }
  const languages = [...languageCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([language]) => language);

  const dependencyNames = new Set(
    manifests.flatMap((manifest) => [
      ...keys(manifest.dependencies),
      ...keys(manifest.devDependencies),
      ...keys(manifest.peerDependencies),
    ]),
  );
  const frameworks: string[] = [];
  for (const [pattern, name] of FRAMEWORKS) {
    if (
      !frameworks.includes(name) &&
      [...dependencyNames].some((dependency) => pattern.test(dependency))
    )
      frameworks.push(name);
  }
  for (const [pattern, name] of FILE_FRAMEWORKS) {
    if (
      !frameworks.includes(name) &&
      [...rootFiles].some((path) => pattern.test(path))
    )
      frameworks.push(name);
  }

  const packageManager = detectPackageManager(rootManifest, rootFiles);
  const scripts = stringRecord(rootManifest?.scripts);
  const checkCommands = CHECK_SCRIPTS.filter((name) =>
    Object.hasOwn(scripts, name),
  ).map((name) => runScript(packageManager, name));
  if (checkCommands.length === 0) {
    if (rootFiles.has("Cargo.toml")) checkCommands.push("cargo test");
    if (rootFiles.has("go.mod")) checkCommands.push("go test ./...");
  }

  const adrPaths = files.filter(isAdrPath).slice(0, ADR_LIMIT);
  const anvilmark = await lstat(join(root, ".anvilmark")).catch(() => null);
  const hasAnvilmarkDir = Boolean(
    anvilmark?.isDirectory() && !anvilmark.isSymbolicLink(),
  );
  const manifestName = rootManifest?.name;
  const repoName =
    typeof manifestName === "string" && manifestName.trim()
      ? manifestName.trim()
      : basename(root);
  const goal = options.goal?.trim()
    ? sanitizeText(options.goal.trim()).text.slice(0, 4000)
    : undefined;

  const summary = [
    `${repoName}: ${files.length} tracked file(s)`,
    languages.length > 0 ? `mainly ${languages.slice(0, 3).join(", ")}` : null,
    frameworks.length > 0 ? `using ${frameworks.slice(0, 6).join(", ")}` : null,
    packageManager ? `managed with ${packageManager}` : null,
  ]
    .filter(Boolean)
    .join("; ")
    .concat(
      `. ${checkCommands.length} check command(s), ${adrPaths.length} ADR(s)`,
      hasAnvilmarkDir ? ", existing .anvilmark/ state." : ".",
    );

  return {
    version: REPO_CONTEXT_VERSION,
    exportedAt: options.now,
    repoName,
    ...(goal === undefined ? {} : { goal }),
    languages,
    frameworks,
    packageManager,
    scripts,
    checkCommands,
    adrPaths,
    sampleFiles: files.slice(0, SAMPLE_LIMIT),
    totalTrackedFiles: files.length,
    hasAnvilmarkDir,
    summary,
  };
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const existing = await lstat(path).catch(() => null);
  if (existing && (existing.isSymbolicLink() || !existing.isFile()))
    throw new Error(`refusing to replace ${path}: not a regular file`);
  const parent = await lstat(dirname(path)).catch(() => null);
  if (!parent?.isDirectory())
    throw new Error(`output directory does not exist: ${dirname(path)}`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode: 0o644 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function exportContextCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const { io } = context;
  const parsed = parse(
    context.args,
    { goal: { type: "string" }, out: { type: "string" } },
    EXPORT_CONTEXT_USAGE,
  );
  if (flag(parsed, "help")) {
    io.stdout(`${EXPORT_CONTEXT_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected argument "${parsed.positionals[0]}"`,
      EXPORT_CONTEXT_USAGE,
    );
  }
  const out = stringOption(parsed, "out");
  if (out !== undefined && out.trim() === "") {
    throw new UsageError("--out requires a file path", EXPORT_CONTEXT_USAGE);
  }
  const goal = stringOption(parsed, "goal");
  const report = await exportRepoContext(projectDirectory(io, parsed), {
    ...(goal === undefined ? {} : { goal }),
    now: io.clock(),
  });
  if (out === undefined) {
    writeJson(io, report);
    return EXIT.ok;
  }
  const destination = resolve(io.cwd, out);
  await writeAtomically(destination, `${JSON.stringify(report, null, 2)}\n`);
  if (flag(parsed, "json")) {
    writeJson(io, report);
  } else {
    io.stdout(`${destination}\n`);
  }
  return EXIT.ok;
}
