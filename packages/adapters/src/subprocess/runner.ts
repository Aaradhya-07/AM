import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import type {
  AdapterError,
  AdapterIdentity,
  AdapterOutcome,
  CommandManifest,
} from "../envelope.js";
import { adapterError, available, notAvailable } from "../envelope.js";
import type { Redaction } from "../sanitize.js";
import { sanitizeText } from "../sanitize.js";
import { buildCommandManifest } from "./manifest.js";

/**
 * Environment variables a child needs simply to be found and to run.
 *
 * Denying the whole ambient environment is right — it is full of credentials —
 * but denying PATH too means an ordinary `npm i -g promptfoo` install is
 * invisible, which would make every optional tool permanently "unavailable".
 * Only resolution-related variables are forwarded, and their VALUES are never
 * recorded in a manifest.
 */
export const EXECUTION_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
] as const;

/** Pick just the resolution variables out of an environment. */
export function executionEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of EXECUTION_ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}

export interface SubprocessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory?: string | null;
  /**
   * What the manifest records instead of `executable` and `workingDirectory`.
   * A caller that resolves a program to a canonical absolute path, or runs it
   * in a private directory, should not have that machine path written into a
   * manifest that travels with evidence. Only the RECORD changes; the child is
   * still spawned with the real values.
   */
  readonly manifestExecutable?: string;
  readonly manifestWorkingDirectory?: string | null;
  /** Extra environment for the child. Values are used but never recorded. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Source for the resolution allowlist. Defaults to the real environment;
   * injected in tests so PATH behaviour can be exercised deterministically.
   */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly stdin?: string | null;
  /** POSIX collectors can terminate descendants as one isolated process group. */
  readonly terminateProcessGroup?: boolean;
  readonly signal?: AbortSignal;
}

export interface SubprocessResult {
  readonly exit_code: number | null;
  readonly signal: string | null;
  /** Sanitized. */
  readonly stdout: string;
  /** Sanitized. */
  readonly stderr: string;
  readonly manifest: CommandManifest;
  /** SHA-256 over the complete raw result: stdout, stderr, exit code, signal. */
  readonly raw_result_hash: string;
  readonly redactions: readonly Redaction[];
}

const DEFAULT_ADAPTER_ID = "subprocess";

/** Grace period between asking a process to stop and forcing it to. */
const TERMINATION_GRACE_MS = 250;

function hashOf(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Hash the COMPLETE raw result, not just stdout.
 *
 * A tool that writes half its answer to stderr, or that exits non-zero after
 * printing a plausible payload, produces a different result even when stdout
 * is byte-identical. Hashing stdout alone while calling the digest a
 * "raw result hash" would overstate what the hash covers.
 */
export function hashRawResult(parts: {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
}): string {
  return hashOf(
    JSON.stringify({
      stdout: parts.stdout,
      stderr: parts.stderr,
      exit_code: parts.exitCode,
      signal: parts.signal,
    }),
  );
}

/**
 * Run an external tool safely.
 *
 * Every failure mode ends in a structured outcome rather than an exception, so
 * a missing, hung, crashing, or hostile tool can never leave the caller
 * holding a half-written result. The contract is never touched from here: this
 * function returns data, and the caller decides what, if anything, to record.
 *
 * Output is capped. A tool that exceeds the cap is terminated and reported as
 * `output_too_large` rather than truncated, because a truncated JSON document
 * is indistinguishable from a malformed one and must not be parsed.
 */
export async function runSubprocess(
  request: SubprocessRequest,
  options: {
    readonly identity: AdapterIdentity;
    readonly clock?: Clock;
  },
): Promise<AdapterOutcome<SubprocessResult>> {
  const clock = options.clock ?? systemClock;
  const startedAt = clock();

  const environmentNames = Object.keys(request.env ?? {});
  const manifest = buildCommandManifest({
    executable: request.manifestExecutable ?? request.executable,
    args: request.args,
    environmentNames,
    workingDirectory:
      request.manifestWorkingDirectory !== undefined
        ? request.manifestWorkingDirectory
        : (request.workingDirectory ?? null),
  });

  const meta = (diagnostics: readonly string[]) => ({
    adapter: options.identity,
    started_at: startedAt,
    completed_at: clock(),
    provenance: {
      command_manifest: manifest,
      locator: null,
      raw_result_hash: null,
    },
    diagnostics,
  });

  if (request.signal?.aborted === true) {
    return notAvailable(
      "failed",
      [
        adapterError(
          "cancelled",
          "the request was cancelled before the tool started",
        ),
      ],
      meta([]),
    );
  }

  return new Promise<AdapterOutcome<SubprocessResult>>((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflowed = false;
    let timedOut = false;
    let cancelled = false;
    let killTimer: NodeJS.Timeout | undefined;

    const child = spawn(request.executable, [...request.args], {
      cwd: request.workingDirectory ?? undefined,
      // Resolution variables only, then the caller's explicit additions.
      // Nothing else from the ambient environment reaches the child.
      env: {
        ...executionEnvironment(request.baseEnv ?? process.env),
        ...(request.env ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      detached:
        request.terminateProcessGroup === true && process.platform !== "win32",
    });

    const finish = (outcome: AdapterOutcome<SubprocessResult>): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (
        (cancelled || timedOut || overflowed) &&
        request.terminateProcessGroup === true &&
        process.platform !== "win32" &&
        child.pid
      ) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      request.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    /** Ask politely, then insist. A hung tool must not hold the process open. */
    const terminate = (): void => {
      const stop = (signal: NodeJS.Signals): void => {
        try {
          if (
            request.terminateProcessGroup === true &&
            process.platform !== "win32" &&
            child.pid
          )
            process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {
          /* The process may have exited during cancellation. */
        }
      };
      stop("SIGTERM");
      killTimer = setTimeout(() => {
        stop("SIGKILL");
      }, TERMINATION_GRACE_MS);
      killTimer.unref?.();
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);
    timeoutTimer.unref?.();

    const onAbort = (): void => {
      cancelled = true;
      terminate();
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });

    const capture = (which: "stdout" | "stderr") => (chunk: Buffer) => {
      if (overflowed) {
        return;
      }
      const size = chunk.byteLength;
      if (which === "stdout") {
        stdoutBytes += size;
      } else {
        stderrBytes += size;
      }
      if (stdoutBytes + stderrBytes > request.maxOutputBytes) {
        overflowed = true;
        terminate();
        return;
      }
      if (which === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
      }
    };

    child.stdout.on("data", capture("stdout"));
    child.stderr.on("data", capture("stderr"));

    child.on("error", (error: NodeJS.ErrnoException) => {
      const missing = error.code === "ENOENT";
      const sanitized = sanitizeText(error.message).text;
      finish(
        notAvailable(
          // A tool that is not installed is an evidence gap, not a failure.
          missing ? "unavailable" : "failed",
          [
            adapterError(
              missing ? "executable_not_found" : "spawn_failed",
              missing
                ? `the tool "${manifest.executable}" is not installed or not on PATH`
                : `the tool could not be started: ${sanitized}`,
              { executable: manifest.executable },
            ),
          ],
          meta([]),
        ),
      );
    });

    child.on("close", (code, signal) => {
      const cleanStdout = sanitizeText(stdout);
      const cleanStderr = sanitizeText(stderr);
      const redactions = [...cleanStdout.redactions, ...cleanStderr.redactions];
      const diagnostics =
        redactions.length === 0
          ? []
          : [
              `redacted ${redactions.reduce((sum, entry) => sum + entry.count, 0)} credential-shaped value(s) from tool output`,
            ];

      const errorDetail = {
        exit_code: code,
        signal,
        stdout: cleanStdout.text,
        stderr: cleanStderr.text,
      };

      if (cancelled) {
        finish(
          notAvailable(
            "failed",
            [adapterError("cancelled", "the tool was cancelled", errorDetail)],
            meta(diagnostics),
          ),
        );
        return;
      }

      if (timedOut) {
        finish(
          notAvailable(
            "timed_out",
            [
              adapterError(
                "timed_out",
                `the tool did not finish within ${request.timeoutMs}ms and was terminated`,
                errorDetail,
              ),
            ],
            meta(diagnostics),
          ),
        );
        return;
      }

      if (overflowed) {
        finish(
          notAvailable(
            "failed",
            [
              adapterError(
                "output_too_large",
                `the tool produced more than ${request.maxOutputBytes} bytes and was terminated; a truncated result cannot be trusted`,
                { max_output_bytes: request.maxOutputBytes },
              ),
            ],
            meta(diagnostics),
          ),
        );
        return;
      }

      if (code !== 0) {
        finish(
          notAvailable(
            "failed",
            [
              adapterError(
                "non_zero_exit",
                `the tool exited with status ${String(code)}`,
                errorDetail,
              ),
            ],
            meta(diagnostics),
          ),
        );
        return;
      }

      const result: SubprocessResult = {
        exit_code: code,
        signal,
        stdout: cleanStdout.text,
        stderr: cleanStderr.text,
        manifest,
        // Covers the raw stdout, stderr, exit code, and signal, so two runs
        // can be compared even though the persisted text is sanitized.
        raw_result_hash: hashRawResult({
          stdout,
          stderr,
          exitCode: code,
          signal,
        }),
        redactions,
      };
      finish(available(result, meta(diagnostics)));
    });

    if (request.stdin !== undefined && request.stdin !== null) {
      child.stdin.end(request.stdin);
    } else {
      child.stdin.end();
    }
  });
}

export { DEFAULT_ADAPTER_ID };

/** Errors a caller may want to branch on without importing the whole envelope. */
export type SubprocessError = AdapterError;
