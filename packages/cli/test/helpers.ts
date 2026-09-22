import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
} from "@anvilmark/project-contract";

import type { CliIo, ExitCode } from "../src/index.js";
import { run } from "../src/index.js";
import type { StoreFs } from "../src/store.js";

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
export const BIN = join(PACKAGE_ROOT, "dist", "bin.js");
export const ATLAS = join(
  REPO_ROOT,
  "docs",
  "vnext",
  "fixtures",
  "atlas-project.draft.yaml",
);
export const ATLAS_PROPOSAL = join(
  REPO_ROOT,
  "docs",
  "vnext",
  "fixtures",
  "atlas-intelligence-proposal.json",
);

// A key-shaped value the secret detector recognises. Never a real key.
export const FAKE_KEY = "sk-proj-TESTONLYabcdefghijklmnopqrstuvwxyz0123";

const directories: string[] = [];

export async function tempDir(prefix = "anvilmark-cli-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

export async function cleanup(): Promise<void> {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A clock that advances one second per call from a fixed start. */
export function steppingClock(
  start = "2026-09-13T10:00:00.000Z",
): () => string {
  let current = Date.parse(start);
  return () => {
    const value = new Date(current).toISOString();
    current += 1000;
    return value;
  };
}

export interface ScriptedIo extends CliIo {
  readonly out: () => string;
  readonly err: () => string;
  readonly prompts: string[];
}

/**
 * Simulated terminal input. `interactive: true` marks it as a TTY, which is
 * exactly what the approval command cannot tell apart from a person.
 */
export function scriptedIo(options: {
  readonly cwd: string;
  readonly env?: Record<string, string | undefined>;
  readonly interactive?: boolean;
  readonly answers?: readonly (
    string | null | (() => Promise<string | null>)
  )[];
  readonly clock?: () => string;
  readonly signal?: AbortSignal;
}): ScriptedIo {
  let stdout = "";
  let stderr = "";
  const answers = [...(options.answers ?? [])];
  const prompts: string[] = [];
  return {
    cwd: options.cwd,
    env: options.env ?? {},
    homedir: options.cwd,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    interactive: options.interactive ?? false,
    prompt: async (question) => {
      prompts.push(question);
      stdout += question;
      const next = answers.shift();
      if (next === undefined || next === null) return null;
      return typeof next === "function" ? next() : next;
    },
    clock: options.clock ?? steppingClock(),
    signal: options.signal ?? new AbortController().signal,
    out: () => stdout,
    err: () => stderr,
    prompts,
  };
}

export async function cli(
  argv: readonly string[],
  io: ScriptedIo,
  options: { readonly storeFs?: StoreFs } = {},
): Promise<ExitCode> {
  return run(argv, io, options);
}

export interface Spawned {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the BUILT binary as a user would. */
export function spawnCli(
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: Record<string, string>;
    readonly input?: string;
  },
): Promise<Spawned> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: options.cwd,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: options.cwd,
        ANVILMARK_CONFIG_HOME: join(options.cwd, "..", "host-config-absent"),
        ...options.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on(
      "data",
      (chunk: Buffer) => (stdout += chunk.toString("utf8")),
    );
    child.stderr.on(
      "data",
      (chunk: Buffer) => (stderr += chunk.toString("utf8")),
    );
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(options.input ?? "");
  });
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Every file under a directory, with its text. */
export async function readTree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        result[path.slice(root.length + 1)] = await readFile(path, "utf8");
      }
    }
  };
  await walk(root);
  return result;
}

export async function writeHostConfig(
  directory: string,
  providers: readonly Record<string, unknown>[],
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "host.json"),
    JSON.stringify({
      format: "anvilmark-host/0.1",
      intelligence_providers: providers,
    }),
    "utf8",
  );
}

export async function projectText(root: string): Promise<string> {
  return readFile(join(root, ".anvilmark", "project.yaml"), "utf8");
}

/** A project initialized from the Atlas fixture. */
export async function atlasProject(): Promise<string> {
  const root = await tempDir();
  const code = await run(
    ["init", "--from-contract", ATLAS],
    scriptedIo({ cwd: root }),
  );
  if (code !== 0) throw new Error("init from Atlas failed");
  return root;
}

/**
 * A project initialized from the synthetic approved fixture, migrated to
 * the current schema by its version lines only. The approval was produced for fixture
 * purposes and is not a real project decision.
 */
export async function approvedProject(): Promise<string> {
  const root = await tempDir();
  const fixtures = await tempDir("anvilmark-cli-fixture-");
  const text = (
    await readFile(
      join(
        REPO_ROOT,
        "packages/project-contract/test/fixtures/approved-atlas.draft3.yaml",
      ),
      "utf8",
    )
  )
    .replace(/^schema: .+$/m, `schema: ${PROJECT_SCHEMA_ID}`)
    .replace(
      /^schema_version: .+$/m,
      `schema_version: ${PROJECT_SCHEMA_VERSION}`,
    );
  const file = join(fixtures, "approved-atlas.current.yaml");
  await writeFile(file, text, "utf8");
  const code = await run(
    ["init", "--from-contract", file],
    scriptedIo({ cwd: root }),
  );
  if (code !== 0) throw new Error("init from the approved fixture failed");
  return root;
}
