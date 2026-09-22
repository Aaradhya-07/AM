import type { CommandManifest } from "../envelope.js";
import { sanitizeText } from "../sanitize.js";

/** Flag names whose following argument is a credential value. */
const CREDENTIAL_FLAG_NAME =
  /(?:password|passwd|pwd|secret|token(?!s)|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth)/i;

const REDACTED = "[redacted:argument]";

/**
 * Build the command manifest that gets persisted.
 *
 * The real command line is never recorded. Three things are removed: the value
 * following a credential-shaped flag, the value inside a `--flag=value` pair,
 * and anything credential-shaped appearing anywhere else in an argument.
 *
 * Environment variables are recorded by NAME only. The name is the useful
 * provenance ("this ran with OPENAI_API_KEY set"); the value never is.
 */
export function buildCommandManifest(input: {
  readonly executable: string;
  readonly args: readonly string[];
  readonly environmentNames: readonly string[];
  readonly workingDirectory: string | null;
}): CommandManifest {
  const args: string[] = [];
  let redactNext = false;

  for (const raw of input.args) {
    if (redactNext) {
      args.push(REDACTED);
      redactNext = false;
      continue;
    }

    const equals = raw.indexOf("=");
    if (raw.startsWith("-") && equals > 0) {
      const name = raw.slice(0, equals);
      if (CREDENTIAL_FLAG_NAME.test(name)) {
        args.push(`${name}=${REDACTED}`);
        continue;
      }
    }

    if (raw.startsWith("-") && CREDENTIAL_FLAG_NAME.test(raw)) {
      args.push(raw);
      redactNext = true;
      continue;
    }

    args.push(sanitizeText(raw).text);
  }

  return {
    executable: sanitizeText(input.executable).text,
    arguments: args,
    environment_names: [...input.environmentNames].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    working_directory:
      input.workingDirectory === null
        ? null
        : sanitizeText(input.workingDirectory).text,
  };
}
