import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";

/**
 * How promptfoo is run: which build, which file, with what limits, and where.
 *
 * Everything here is decided when the adapter is CONSTRUCTED, from trusted
 * configuration. None of it can be influenced by an evaluation request.
 */

// --- the version boundary ------------------------------------------------------

/**
 * The promptfoo versions whose output this adapter has verified.
 *
 * The artifact parser, the per-case `failureReason` rule, the result-row shape
 * this adapter binds to the plan, the prompt-as-path rule and the exit-code
 * handling were all checked against promptfoo 0.122.0 -- its source at commit
 * 0170037970dd4732f7542c60ceafa5f4951289de and its real output. A different
 * version may change any of them silently, so it is refused as `unsupported`
 * before an evaluation runs. Adding a version means adding its own verified
 * parser and semantics tests, not extending this list.
 */
export const VERIFIED_PROMPTFOO_VERSIONS: readonly string[] = ["0.122.0"];

export function isVerifiedPromptfooVersion(version: string): boolean {
  return VERIFIED_PROMPTFOO_VERSIONS.includes(version);
}

// --- the launcher ----------------------------------------------------------------

export interface ResolvedExecutable {
  /** Canonical absolute path. Used to spawn; never written into evidence. */
  readonly path: string;
  /** SHA-256 of the file at `path` when the adapter was constructed. */
  readonly digest: string;
}

export type ExecutableResolution =
  { readonly resolved: ResolvedExecutable } | { readonly problem: string };

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      accessSync(candidate, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

export function digestFileSync(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

export async function digestFile(path: string): Promise<string | null> {
  try {
    return `sha256:${createHash("sha256")
      .update(await readFile(path))
      .digest("hex")}`;
  } catch {
    return null;
  }
}

/**
 * Resolve the configured executable ONCE to a canonical absolute path.
 *
 * A bare name is searched for on the construction-time `PATH` (and `PATHEXT`
 * on Windows); a name containing a path separator is resolved against the
 * process working directory. Symbolic links are followed, so an npm `.bin`
 * link resolves to the file it points at, and that file is hashed.
 *
 * The previous design passed the bare name to `spawn` at each invocation, so
 * the program that ran was whatever the environment resolved to at that
 * moment. Resolving once means a program placed earlier on `PATH` after the
 * adapter was built is never run.
 *
 * This pins the LAUNCHER FILE. promptfoo is a Node program whose launcher loads
 * many other files from its package; those transitive dependencies are not
 * hashed, and a change to them is not detected.
 */
export function resolveExecutable(
  executable: string,
  env: Readonly<Record<string, string | undefined>>,
): ExecutableResolution {
  const candidates: string[] = [];
  if (isAbsolute(executable) || /[\\/]/.test(executable)) {
    candidates.push(resolve(executable));
  } else {
    const searchPath = env.PATH ?? env.Path ?? "";
    const extensions =
      process.platform === "win32"
        ? ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")]
        : [""];
    for (const directory of searchPath.split(delimiter)) {
      if (directory.length === 0) {
        continue;
      }
      for (const extension of extensions) {
        candidates.push(join(directory, `${executable}${extension}`));
      }
    }
  }

  for (const candidate of candidates) {
    if (!isExecutableFile(candidate)) {
      continue;
    }
    try {
      const canonical = realpathSync(candidate);
      if (!isExecutableFile(canonical)) {
        continue;
      }
      return {
        resolved: { path: canonical, digest: digestFileSync(canonical) },
      };
    } catch {
      continue;
    }
  }

  return {
    problem: `the tool "${executable}" is not installed or not on the configured PATH`,
  };
}

// --- resource limits ---------------------------------------------------------------

/**
 * The documented bounds for every resource limit, and their defaults.
 *
 * The CEILINGS are construction-time policy. A request may omit a limit or ask
 * for a SMALLER one; it cannot raise one. Every value must be a finite, positive
 * integer within these bounds.
 */
export const RESOURCE_LIMIT_BOUNDS = {
  /** Wall-clock limit for an evaluation run. Up to one hour. */
  timeoutMs: { min: 1, max: 3_600_000, default: 300_000 },
  /** Captured stdout plus stderr. Up to 64 MiB. */
  maxOutputBytes: { min: 1, max: 64 * 1024 * 1024, default: 4 * 1024 * 1024 },
  /** Size of the result artifact the adapter will read. Up to 256 MiB. */
  maxArtifactBytes: {
    min: 1,
    max: 256 * 1024 * 1024,
    default: 8 * 1024 * 1024,
  },
} as const;

/** The version probe's wall-clock limit. Up to one minute. */
export const PROBE_TIMEOUT_BOUNDS = {
  min: 1,
  max: 60_000,
  default: 5_000,
} as const;

export type ResourceLimitName = keyof typeof RESOURCE_LIMIT_BOUNDS;

export type ResourceLimits = { readonly [K in ResourceLimitName]: number };

const LIMIT_NAMES = Object.keys(RESOURCE_LIMIT_BOUNDS) as ResourceLimitName[];

export function isBoundedInteger(
  value: unknown,
  bounds: { readonly min: number; readonly max: number },
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= bounds.min &&
    value <= bounds.max
  );
}

/** Validate construction-time ceilings. Never throws. */
export function resourceLimitCeilings(
  input: unknown,
):
  | { readonly ceilings: ResourceLimits }
  | { readonly problems: readonly string[] } {
  if (input === undefined) {
    return {
      ceilings: Object.fromEntries(
        LIMIT_NAMES.map((name) => [name, RESOURCE_LIMIT_BOUNDS[name].default]),
      ) as ResourceLimits,
    };
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { problems: ["limits must be an object of named ceilings"] };
  }

  const problems: string[] = [];
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!(LIMIT_NAMES as string[]).includes(key)) {
      problems.push(`limits.${key} is not a limit this adapter recognises`);
    }
  }
  const ceilings: Record<string, number> = {};
  for (const name of LIMIT_NAMES) {
    const bounds = RESOURCE_LIMIT_BOUNDS[name];
    const value = source[name];
    if (value === undefined) {
      ceilings[name] = bounds.default;
    } else if (isBoundedInteger(value, bounds)) {
      ceilings[name] = value;
    } else {
      problems.push(
        `limits.${name} must be an integer from ${bounds.min} to ${bounds.max}`,
      );
    }
  }
  return problems.length > 0
    ? { problems }
    : { ceilings: ceilings as ResourceLimits };
}

/**
 * The limits a run uses: the ceiling, or the request's smaller value.
 *
 * A value above the ceiling, or anything that is not a positive integer, is a
 * refusal -- not a silent clamp -- so a caller learns the request was not
 * honoured as written.
 */
export function effectiveResourceLimits(
  request: Partial<Record<ResourceLimitName, unknown>>,
  ceilings: ResourceLimits,
):
  | { readonly limits: ResourceLimits }
  | { readonly problems: readonly string[] } {
  const problems: string[] = [];
  const limits: Record<string, number> = {};
  for (const name of LIMIT_NAMES) {
    const value = request[name];
    const ceiling = ceilings[name];
    if (value === undefined) {
      limits[name] = ceiling;
    } else if (!isBoundedInteger(value, { min: 1, max: ceiling })) {
      problems.push(
        `${name} must be a positive integer no greater than this adapter's ceiling of ${ceiling}`,
      );
    } else {
      limits[name] = value;
    }
  }
  return problems.length > 0
    ? { problems }
    : { limits: limits as ResourceLimits };
}

// --- where it runs ---------------------------------------------------------------

/**
 * The private runtime layout inside one run directory.
 *
 * promptfoo runs with the run directory as its working directory, and with its
 * home, XDG, temporary and promptfoo configuration directories all inside it,
 * so nothing it writes lands in the user's home or the repository, and nothing
 * it reads by a relative path comes from there. Redirection is by environment
 * variable, which a program may ignore; it confines well-behaved lookups, not a
 * hostile program.
 */
export function runtimeLayout(runDirectory: string): {
  readonly directories: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
} {
  const runtime = join(runDirectory, "runtime");
  const home = join(runtime, "home");
  const temporary = join(runtime, "tmp");
  const xdg = join(runtime, "xdg");
  const layout = {
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    XDG_CONFIG_HOME: join(xdg, "config"),
    XDG_CACHE_HOME: join(xdg, "cache"),
    XDG_DATA_HOME: join(xdg, "data"),
    XDG_STATE_HOME: join(xdg, "state"),
    PROMPTFOO_CONFIG_DIR: join(runtime, "promptfoo"),
    PROMPTFOO_CACHE_PATH: join(runtime, "promptfoo-cache"),
  };
  return {
    directories: [...new Set(Object.values(layout))],
    environment: layout,
  };
}

export async function createRuntimeLayout(
  runDirectory: string,
): Promise<Readonly<Record<string, string>>> {
  const layout = runtimeLayout(runDirectory);
  for (const directory of layout.directories) {
    await mkdir(directory, { recursive: true });
  }
  return layout.environment;
}
