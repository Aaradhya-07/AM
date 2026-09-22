import { classifyValue } from "@anvilmark/project-contract";

/**
 * Secret sanitization for untrusted adapter output.
 *
 * Subprocess stdout, stderr, error messages, and command lines are all places
 * a credential can surface, and every one of them can end up in a persisted
 * artifact or a bug report. Sanitizing happens at the boundary, before the
 * text is stored, logged, or attached to an evidence record.
 *
 * Value SHAPES are not redefined here. `classifyValue` from
 * `@anvilmark/project-contract` remains the single reviewed source of truth
 * for what a credential looks like; this module adds the text-shaped handling
 * that a whole-value classifier cannot do: multi-line key blocks, flag/value
 * pairs, and token-by-token scanning of free text.
 */

/** A single redaction that was applied. */
export interface Redaction {
  readonly detector: string;
  readonly count: number;
}

export interface SanitizedText {
  readonly text: string;
  readonly redactions: readonly Redaction[];
}

const PLACEHOLDER = (detector: string): string => `[redacted:${detector}]`;

/** PEM armour spans lines, so it cannot be found by token scanning. */
const PEM_BLOCK =
  /-----BEGIN (?:[A-Z][A-Z ]* )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z][A-Z ]* )?PRIVATE KEY-----/g;

/**
 * Words that mark a field as carrying a credential.
 *
 * `token` is deliberately written `token(?!s)`. A plural `tokens` is a COUNT —
 * `input_tokens_per_call`, `estimated_tokens_per_second` — and token counts
 * are core ANVILMARK data. Redacting them would corrupt exactly the numbers
 * the cost and token gates depend on.
 */
const CREDENTIAL_WORD =
  "password|passwd|pwd|secret|token(?!s)|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth";

/** `--api-key VALUE`, `--token=VALUE`, `PASSWORD=VALUE`, `"secret": "VALUE"`. */
const CREDENTIAL_ASSIGNMENT = new RegExp(
  `((?:^|[\\s"'{,])(?:-{0,2})[A-Za-z_][\\w-]*(?:${CREDENTIAL_WORD})[\\w-]*["']?\\s*[:=]\\s*)(["']?)([^\\s"',}]+)\\2`,
  "gi",
);

/** `--api-key VALUE` with a space rather than `=` or `:`. */
const CREDENTIAL_FLAG = new RegExp(
  `((?:^|\\s)-{1,2}[A-Za-z][\\w-]*(?:${CREDENTIAL_WORD}|key(?!s))[\\w-]*\\s+)(\\S+)`,
  "gi",
);

/**
 * A credential is an opaque string. A number, a boolean, or a two-character
 * enum in a credential-named field is a value, not a key, and blanking it
 * would destroy data while protecting nothing.
 */
function looksLikeCredentialValue(value: string): boolean {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return false;
  }
  if (/^(?:true|false|null|undefined)$/i.test(value)) {
    return false;
  }
  return value.length >= 6;
}

/** `Bearer <token>` in a header dump. */
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi;

/**
 * Split free text into candidate tokens. Quotes, brackets, and separators are
 * boundaries; a credential never spans them.
 */
function tokenize(text: string): string[] {
  return text.split(/[\s"'`<>(){}[\],;]+/).filter((token) => token.length > 0);
}

/**
 * Redact anything credential-shaped from free text.
 *
 * Token scanning uses a NON-credential path so that only the high-confidence
 * vendor patterns fire. Entropy guessing is deliberately not applied to free
 * text: it would mangle hashes, ids, and ordinary tool output without
 * meaningfully improving safety.
 */
export function sanitizeText(input: string): SanitizedText {
  const counts = new Map<string, number>();
  const note = (detector: string): void => {
    counts.set(detector, (counts.get(detector) ?? 0) + 1);
  };

  let text = input.replace(PEM_BLOCK, () => {
    note("pem_private_key");
    return PLACEHOLDER("pem_private_key");
  });

  text = text.replace(BEARER, () => {
    note("bearer_token");
    return PLACEHOLDER("bearer_token");
  });

  text = text.replace(
    CREDENTIAL_ASSIGNMENT,
    (_match, prefix: string, quote: string, value: string) => {
      if (value.startsWith("[redacted:") || !looksLikeCredentialValue(value)) {
        return `${prefix}${quote}${value}${quote}`;
      }
      note("credential_assignment");
      return `${prefix}${quote}${PLACEHOLDER("credential_assignment")}${quote}`;
    },
  );

  text = text.replace(
    CREDENTIAL_FLAG,
    (_match, prefix: string, value: string) => {
      if (value.startsWith("[redacted:") || !looksLikeCredentialValue(value)) {
        return `${prefix}${value}`;
      }
      note("credential_flag");
      return `${prefix}${PLACEHOLDER("credential_flag")}`;
    },
  );

  for (const token of new Set(tokenize(text))) {
    if (token.startsWith("[redacted:")) {
      continue;
    }
    const verdict = classifyValue(token, "adapter.output");
    if (!verdict.isSecret) {
      continue;
    }
    note(verdict.detector);
    text = text.split(token).join(PLACEHOLDER(verdict.detector));
  }

  const redactions = [...counts.entries()]
    .map(([detector, count]) => ({ detector, count }))
    .sort((left, right) => (left.detector < right.detector ? -1 : 1));

  return { text, redactions };
}

/**
 * Sanitize a message that is about to become part of an error.
 *
 * Free text is normally scanned for published credential SHAPES only, because
 * entropy-guessing ordinary output would mangle hashes and identifiers. An
 * error message is different: it exists to quote whatever went wrong, it is
 * the likeliest thing to be pasted into a bug report, and it is short. Tokens
 * here are therefore classified in a credential context, so an opaque value
 * with no vendor prefix is caught too.
 *
 * The cost is that a long hash quoted in a message is redacted. That is the
 * right trade: structured `detail` keeps hashes under their own field names,
 * where they are not treated as credentials.
 */
export function sanitizeErrorMessage(input: string): string {
  let text = sanitizeText(input).text;

  for (const token of new Set(tokenize(text))) {
    if (token.startsWith("[redacted:")) {
      continue;
    }
    const verdict = classifyValue(token, "adapter.error.credential");
    if (verdict.isSecret) {
      text = text.split(token).join(PLACEHOLDER(verdict.detector));
    }
  }

  return text;
}

/** True when the text contains anything credential-shaped. */
export function containsSecret(input: string): boolean {
  return sanitizeText(input).redactions.length > 0;
}

/**
 * Recursively sanitize a parsed structure.
 *
 * Structured tool output carries credentials as readily as a log line, and it
 * is more likely to be persisted verbatim. Free-text scanning alone is not
 * enough here: an opaque value with no vendor prefix — `mQ7vL2xP9cR4nT8kW6zB`
 * under a key called `api_token` — matches no published pattern, and the only
 * thing marking it as a credential is the key it sits under.
 *
 * The KEY PATH is therefore passed to `classifyValue`, the canonical
 * classifier, which already applies the context-plus-entropy rule. Numbers are
 * left untouched, so token counts and latencies survive intact.
 */
export function sanitizeStructured(value: unknown, path = ""): unknown {
  if (typeof value === "string") {
    const verdict = classifyValue(value, path);
    if (verdict.isSecret) {
      return PLACEHOLDER(verdict.detector);
    }
    return sanitizeText(value).text;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeStructured(entry, `${path}[${index}]`),
    );
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = sanitizeStructured(
        member,
        path === "" ? key : `${path}.${key}`,
      );
    }
    return result;
  }
  return value;
}

/** True when any string anywhere in the structure is credential-shaped. */
export function structuredContainsSecret(value: unknown, path = ""): boolean {
  if (typeof value === "string") {
    return classifyValue(value, path).isSecret || containsSecret(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry, index) =>
      structuredContainsSecret(entry, `${path}[${index}]`),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(
      ([key, member]) =>
        structuredContainsSecret(member, path === "" ? key : `${path}.${key}`),
    );
  }
  return false;
}
