import { homedir } from "node:os";
import { createInterface } from "node:readline";

/**
 * Everything a command touches outside its own arguments.
 *
 * Commands never reach for `process` directly, so the same code runs as the
 * real binary and inside tests with simulated input. Simulated input can mark
 * itself interactive; that is exactly the limit the approval command states: an
 * interactive terminal reduces accidental approval, it does not prove a human
 * is present.
 */
export interface CliIo {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homedir: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** True only when both stdin and stdout are terminals. */
  readonly interactive: boolean;
  /**
   * Show a question and read one line. Resolves null when input ends or the
   * user cancels (Ctrl-C), which every caller treats as "no".
   */
  readonly prompt: (question: string) => Promise<string | null>;
  readonly clock: () => string;
  /** Aborted when the user interrupts. Long operations observe it. */
  readonly signal: AbortSignal;
}

export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  /** The user declined, cancelled, or input ended before an answer. */
  cancelled: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The real terminal. */
export function processIo(): CliIo & { readonly close: () => void } {
  const controller = new AbortController();
  const interactive =
    process.stdin.isTTY === true && process.stdout.isTTY === true;

  let reader: ReturnType<typeof createInterface> | null = null;
  const queued: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let ended = false;

  const finish = () => {
    ended = true;
    for (const resolve of waiting.splice(0)) {
      resolve(null);
    }
  };

  const ensureReader = () => {
    if (reader !== null) {
      return reader;
    }
    reader = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: interactive,
    });
    reader.on("line", (line) => {
      const next = waiting.shift();
      if (next === undefined) {
        queued.push(line);
      } else {
        next(line);
      }
    });
    reader.on("close", finish);
    reader.on("SIGINT", () => {
      controller.abort();
      process.stdout.write("\n");
      reader?.close();
      finish();
    });
    return reader;
  };

  const onSignal = () => {
    controller.abort();
    finish();
    reader?.close();
  };
  process.once("SIGINT", onSignal);

  return {
    cwd: process.cwd(),
    env: process.env,
    homedir: homedir(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    interactive,
    prompt: (question) => {
      process.stdout.write(question);
      const input = ensureReader();
      const early = queued.shift();
      if (early !== undefined) {
        return Promise.resolve(early);
      }
      if (ended || controller.signal.aborted) {
        return Promise.resolve(null);
      }
      input.resume();
      return new Promise((resolve) => waiting.push(resolve));
    },
    clock: () => new Date().toISOString(),
    signal: controller.signal,
    close: () => {
      process.removeListener("SIGINT", onSignal);
      reader?.close();
    },
  };
}
