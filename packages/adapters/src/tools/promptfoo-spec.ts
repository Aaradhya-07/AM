import { createHash } from "node:crypto";

import {
  compareCodeUnits,
  findSecrets,
  prettyStringify,
  stableStringify,
} from "@anvilmark/project-contract";
import { z } from "zod/v4";

import { EXECUTION_ENV_ALLOWLIST } from "../subprocess/runner.js";

/**
 * The evaluation ANVILMARK owns.
 *
 * Parsing an arbitrary promptfoo config to work out what an evaluation depends
 * on is structurally unsound, and four review passes proved it: every fix was
 * another string check, and every pass found another way in — `file://` inside
 * an assertion's `value`, inside a test variable, inside `scenarios`, inside a
 * provider id. The bytes that decide pass or fail kept living somewhere the
 * identity did not cover.
 *
 * Control is therefore inverted. A caller supplies the evaluation as DATA and
 * ANVILMARK generates the promptfoo config from it. There is no path by which
 * an input can influence the run without also being in the spec, because the
 * generated file is the only thing the tool ever sees.
 *
 * The spec is the SINGLE authority. Every attribution field — workload,
 * candidate, dataset, dataset version, provider — and every credential name is
 * read from here and nowhere else. A second declaration alongside it would be
 * a second source of truth, and a second source of truth is a mismatch waiting
 * to be recorded.
 */
export const PROMPTFOO_SPEC_VERSION = "0.1.0-draft.1" as const;

/**
 * Assertion types this slice will generate.
 *
 * Deliberately small, and deliberately deterministic: each is decided by
 * comparing the output to a value in the spec. Names are taken from
 * `BaseAssertionTypesSchema` in the pinned promptfoo source.
 *
 * Everything else is refused, including every model-graded type. A model-graded
 * assertion is decided by a second model, so the result depends on a provider
 * that the attribution model has no way to name — and an evaluation attributed
 * to one candidate while a different model silently decided the outcome is
 * exactly the confusion this milestone exists to prevent.
 */
export const BASE_ASSERTION_TYPES = [
  "contains",
  "contains-all",
  "contains-any",
  "contains-json",
  "equals",
  "icontains",
  "icontains-all",
  "icontains-any",
  "is-json",
  "levenshtein",
  "regex",
  "starts-with",
] as const;

export type BaseAssertionType = (typeof BASE_ASSERTION_TYPES)[number];

/**
 * Every base type, plus its `not-` form.
 *
 * The negations are listed because they were EXERCISED, not because promptfoo
 * documents them: each of the 24 was run against promptfoo 0.122.0 twice — once
 * arranged to hold and once arranged to fail — and each behaved correctly in
 * both directions. A type that promptfoo silently ignored would have passed the
 * second run, so the failing arrangement is what proves the assertion is real.
 */
export const SUPPORTED_ASSERTION_TYPES = [
  ...BASE_ASSERTION_TYPES,
  ...BASE_ASSERTION_TYPES.map((type) => `not-${type}` as const),
] as const;

export type SupportedAssertionType = (typeof SUPPORTED_ASSERTION_TYPES)[number];

/** Assertion types that are decided by another model. Always refused here. */
export const MODEL_GRADED_ASSERTION_TYPES = [
  "agent-rubric",
  "answer-relevance",
  "classifier",
  "context-faithfulness",
  "context-recall",
  "context-relevance",
  "conversation-relevance",
  "factuality",
  "g-eval",
  "llm-rubric",
  "model-graded-closedqa",
  "model-graded-factuality",
  "moderation",
  "pi",
  "select-best",
  "similar",
] as const;

/** Assertion types that execute code. Always refused. */
export const EXECUTABLE_ASSERTION_TYPES = ["javascript", "python"] as const;

/** A reference to bytes that are not in the spec. */
const REFERENCE_PREFIX = /^(?:file:\/\/|exec:|python:|package:|golang:)/i;
const URL_PREFIX = /^(?:https?|ftp|data|blob):/i;

/**
 * Prompt references promptfoo 0.122.0 FETCHES from a prompt-management service
 * when it renders the prompt (`src/evaluatorHelpers.ts:424-485`, pinned commit
 * 0170037970dd4732f7542c60ceafa5f4951289de). What would be sent is then not the
 * text the projection hashed. Matched case-insensitively, which is stricter
 * than the pinned `startsWith`.
 */
const REMOTE_PROMPT_PREFIX = /^(?:portkey|langfuse|helicone):\/\//i;

/** `VALID_FILE_EXTENSIONS` at the pinned commit, `src/prompts/constants.ts:4-19`. */
export const PROMPTFOO_0_122_PROMPT_FILE_EXTENSIONS = [
  ".cjs",
  ".cts",
  ".j2",
  ".js",
  ".json",
  ".jsonl",
  ".md",
  ".mjs",
  ".mts",
  ".py",
  ".ts",
  ".txt",
  ".yml",
  ".yaml",
] as const;

/**
 * Would promptfoo 0.122.0 read this prompt string as a FILE PATH?
 *
 * A faithful copy of the pinned `maybeFilePath` (`src/prompts/utils.ts:11-36`),
 * which `processPrompt` (`src/prompts/index.ts:129`) consults for every prompt,
 * including object prompts. It is not a guess about what looks like a path; it
 * is the rule this pinned version applies. Against 591171a the prompt text
 * `"../../../secret.txt"` was read from outside the data directory and returned
 * as available T3 evidence -- and with a remote provider the file's contents
 * would have been sent under an authorization that hashed only the path text.
 *
 * It is version-specific by design. Another promptfoo version needs its own
 * verified copy, which the version boundary enforces.
 */
export function promptfooWouldReadAsPath(value: string): boolean {
  if (
    ["\n", "portkey://", "langfuse://", "helicone://"].some((part) =>
      value.includes(part),
    )
  ) {
    return false;
  }
  const tokens = value.split(":");
  const last = tokens[tokens.length - 1];
  const secondToLast = tokens[tokens.length - 2];
  return (
    value.startsWith("file://") ||
    PROMPTFOO_0_122_PROMPT_FILE_EXTENSIONS.some(
      (extension) =>
        last?.endsWith(extension) === true ||
        secondToLast?.endsWith(extension) === true,
    ) ||
    value.charAt(value.length - 3) === "." ||
    value.charAt(value.length - 4) === "." ||
    value.includes("*") ||
    value.includes("/") ||
    value.includes("\\")
  );
}

/**
 * The Nunjucks lexer tokens that make a string a template.
 *
 * promptfoo 0.122.0 renders prompts, assertion values and metric names with
 * Nunjucks (`src/assertions/index.ts:337,548,557`), and at config load renders
 * `{{ env... }}` in every string (`renderEnvOnlyInObject`,
 * `src/util/render.ts:31`). A Nunjucks EXPRESSION is not inert: in Nunjucks
 * 3.2.4, installed with the pinned promptfoo, `{{ range.constructor("return
 * 6*7")() }}` renders `42`. Against 483d1cb that ran through the adapter and was
 * returned as available T3 evidence, `process.pid` was read the same way, and
 * `{{ env.constructor.constructor("return 42")() }}` executed at config load in
 * a description and a variable despite `PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS`,
 * because `"constructor" in {}` is true.
 *
 * So the rule is not "no dangerous names". It is positive: a prompt may contain
 * a tag only in the form `{{ identifier }}`, and every other string is literal.
 * These four are the tokens the 3.2.4 lexer acts on in plain text, checked
 * directly: `{{`, `{%` and `{#` open a tag, and a bare `#}` throws. `}}` and `%}`
 * on their own render as text, so compact JSON such as `{"a":{"b":1}}` is still
 * literal.
 */
export const NUNJUCKS_TAG_TOKENS = ["{{", "{%", "{#", "#}"] as const;

/**
 * Identifiers Nunjucks 3.2.4 does not treat as a variable inside `{{ ... }}`.
 *
 * Its lexer turns `true` and `false` into boolean tokens and `none` and `null`
 * into null tokens (`src/lexer.js:211-223`), and its parser consumes `not` as an
 * operator (`parseNot`). So even with a row variable of that name,
 * `{{ true }}` renders "true", `{{ none }}` and `{{ null }}` render "", and
 * `{{ not }}` throws -- the prompt promptfoo runs is not the one planned.
 * Checked against the installed 3.2.4 by rendering `{{ name }}` with a variable
 * of that name for every parser keyword: only these five fail to substitute.
 * Case-sensitive, as the lexer is: `True`, `None`, `and`, `in`, `if` substitute.
 *
 * This is not a list of dangerous names. It is the set of words the grammar's
 * "identifier" would otherwise wrongly admit as variables.
 */
export const NUNJUCKS_NON_VARIABLE_WORDS: readonly string[] = [
  "true",
  "false",
  "none",
  "null",
  "not",
];

/** Exactly `{{ name }}`: a plain identifier, optional spaces or tabs, nothing else. */
const INTERPOLATION = /\{\{[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*\}\}/y;

export function containsTemplateSyntax(value: string): boolean {
  return NUNJUCKS_TAG_TOKENS.some((token) => value.includes(token));
}

/**
 * Parse a prompt under the permitted grammar: text, and `{{ identifier }}`.
 *
 * Scans left to right as the lexer does, so a tag is judged where it OPENS:
 * `{{{ name }}}` is refused at its first `{{` rather than matched one character
 * later. Anything else a Nunjucks tag can hold -- a call, property or bracket
 * access, a filter, an operator, a literal, whitespace control, a comment, a
 * statement -- does not fit the grammar and is refused. No names are listed.
 */
export function parsePromptTemplate(
  prompt: string,
): { readonly variables: readonly string[] } | { readonly problem: string } {
  const variables: string[] = [];
  let index = 0;
  while (index < prompt.length) {
    const pair = prompt.slice(index, index + 2);
    if (pair === "{{") {
      INTERPOLATION.lastIndex = index;
      const match = INTERPOLATION.exec(prompt);
      if (match === null) {
        return {
          problem: `the template tag at character ${index} is not a plain {{ variable }} interpolation; function calls, property or bracket access, filters, operators, literals and whitespace control are not permitted template syntax`,
        };
      }
      const name = match[1]!;
      if (NUNJUCKS_NON_VARIABLE_WORDS.includes(name)) {
        return {
          problem: `"${name}" at character ${index} is a Nunjucks literal or operator, not a variable, so {{ ${name} }} would not substitute a row value; it is not permitted template syntax -- rename the variable`,
        };
      }
      variables.push(name);
      index = INTERPOLATION.lastIndex;
      continue;
    }
    if (pair === "{%" || pair === "{#" || pair === "#}") {
      return {
        problem: `"${pair}" at character ${index} is Nunjucks statement or comment syntax, which is not permitted template syntax in a prompt`,
      };
    }
    index += 1;
  }
  return { variables: [...new Set(variables)] };
}

/**
 * Is this a JSON object or array written in a form promptfoo 0.122.0 would
 * REWRITE when it exports results?
 *
 * The exporter runs every string through `sanitizeJsonString`
 * (`src/util/sanitizer.ts:750-775`, reached from `recursiveSanitize` at line
 * 951): a string that parses as a JSON object or array is written back as
 * `JSON.stringify` of the parsed value. Checked against real output: a variable
 * `{"ok": true}` was SENT unchanged -- `echo` returned it with its space and an
 * exact `equals` held -- but EXPORTED as `{"ok":true}`, and ` {"a":1}` lost its
 * leading space.
 *
 * So an artifact cannot distinguish `{"ok": true}` from `{"ok":true}`, and a
 * plan containing the first could be matched by an evaluation of the second.
 * Such strings are refused rather than normalised; written compactly, the
 * exported form is the planned form and the comparison stays exact.
 */
export function isRewrittenOnExport(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      JSON.stringify(parsed) !== value
    );
  } catch {
    return false;
  }
}

/** A literal string that is not a reference promptfoo would resolve. */
const literalValue = (minimum: number) =>
  z
    .string()
    .min(minimum)
    .refine((value) => !REFERENCE_PREFIX.test(value), {
      message:
        "an assertion value must be the literal expected value, not a reference to a file, a package or a program",
    });

/** A named score, rendered by promptfoo, so literal like every other name. */
const MetricSchema = z.string().min(1).max(128);

/**
 * One assertion type and its `not-` form, with exactly the fields that type
 * uses. `strictObject`, so a field the type does not read -- a `threshold` on
 * `contains`, a `weight`, a `transform` -- is refused rather than ignored.
 */
function assertionForms<
  Type extends BaseAssertionType,
  Shape extends Record<string, z.ZodType>,
>(type: Type, shape: Shape) {
  return [
    z.strictObject({
      type: z.literal(type),
      ...shape,
      metric: MetricSchema.optional(),
    }),
    z.strictObject({
      type: z.literal(`not-${type}` as `not-${Type}`),
      ...shape,
      metric: MetricSchema.optional(),
    }),
  ] as const;
}

/** A pattern promptfoo would not turn into a silently failing case. */
const RegexValueSchema = literalValue(1).refine(
  (value) => {
    try {
      new RegExp(value);
      return true;
    } catch {
      return false;
    }
  },
  {
    message:
      "the regular expression does not compile; promptfoo 0.122.0 records an invalid pattern as an ordinary failed case (src/assertions/regex.ts), which would be a result about the candidate rather than a configuration error",
  },
);

/** A non-empty list of non-empty literal needles. */
const NeedleListSchema = z.array(literalValue(1)).min(1).max(1_000);

/**
 * Per-type assertion shapes, from the pinned promptfoo 0.122.0 handlers at
 * commit 0170037970dd4732f7542c60ceafa5f4951289de:
 *
 * | type                    | pinned handler requires                                   | this spec requires                         |
 * | ----------------------- | --------------------------------------------------------- | ------------------------------------------ |
 * | contains, icontains     | non-empty string or number (`contains.ts`)                | non-empty string                           |
 * | *-all, *-any            | truthy; a STRING is split on commas into needles          | non-empty list of non-empty strings        |
 * | starts-with             | non-empty string (`startsWith.ts`)                        | non-empty string                           |
 * | regex                   | non-empty string; bad pattern becomes a FAILED case       | non-empty string that compiles             |
 * | equals                  | anything; a missing value compares against "undefined"   | string (may be empty)                      |
 * | levenshtein             | string; `threshold ?? 5` (`levenshtein.ts`)               | string and an explicit integer threshold   |
 * | is-json, contains-json  | optional JSON schema (string, object or file)            | no value: schema validation not supported |
 *
 * Numbers are refused where promptfoo would coerce them with `String()`: write
 * the text. A comma-separated STRING for the list types is refused because
 * promptfoo would split it into several needles by its own CSV-like rules. Only
 * `levenshtein` reads `threshold`; its default of 5 is not relied on, so it
 * must be stated. Every type's `not-` form has the same shape, since the pinned
 * dispatcher only inverts the result (`src/assertions/index.ts:357`).
 */
export const AssertionSchema = z.discriminatedUnion("type", [
  ...assertionForms("contains", { value: literalValue(1) }),
  ...assertionForms("icontains", { value: literalValue(1) }),
  ...assertionForms("starts-with", { value: literalValue(1) }),
  ...assertionForms("regex", { value: RegexValueSchema }),
  ...assertionForms("equals", { value: literalValue(0) }),
  ...assertionForms("contains-all", { value: NeedleListSchema }),
  ...assertionForms("contains-any", { value: NeedleListSchema }),
  ...assertionForms("icontains-all", { value: NeedleListSchema }),
  ...assertionForms("icontains-any", { value: NeedleListSchema }),
  ...assertionForms("is-json", {}),
  ...assertionForms("contains-json", {}),
  ...assertionForms("levenshtein", {
    value: literalValue(0),
    threshold: z.number().int().min(0).max(1_000_000),
  }),
]);

export type Assertion = z.infer<typeof AssertionSchema>;

/**
 * A variable is a literal. Anything that looks like a reference is refused,
 * because promptfoo would resolve it at run time from a file this adapter
 * never saw and never hashed.
 */
const VariableValueSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .refine(
    (value) =>
      typeof value !== "string" ||
      !(REFERENCE_PREFIX.test(value) || URL_PREFIX.test(value)),
    {
      message:
        "a variable must be a literal value; a reference would be resolved from bytes that are not in this spec",
    },
  );

export const TestRowSchema = z.strictObject({
  vars: z.record(z.string().min(1), VariableValueSchema),
  assert: z.array(AssertionSchema).default([]),
  description: z.string().min(1).optional(),
});

export type TestRow = z.infer<typeof TestRowSchema>;

/**
 * The SHAPE of a provider id. Not a permission to run one.
 *
 * A positive grammar, not a denylist: one to three segments separated by `:`,
 * each starting alphanumeric and continuing with alphanumerics, `.`, `_` or
 * `-`. Nothing else is a provider id here.
 *
 * This is what structurally excludes the whole family of ids that are really
 * network endpoints — `https://host/collect?api_key=...`,
 * `webhook:http://host/collect`, `ws://host/socket`, `user:secret@host` — since
 * every one of them needs a character the grammar does not have (`/`, `?`, `#`,
 * `@`, a space, a control character). That matters beyond execution: a provider
 * id is PERSISTED on the evidence record, so a URL carrying a token in its
 * query string would write that token into the contract.
 *
 * Passing the grammar does not make an id runnable. `browser`,
 * `promptfoo:manual-input`, `mcp:server` and `sequence:a` are all well-formed
 * and none of them runs, because running requires registration.
 */
const PROVIDER_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const MAX_PROVIDER_ID_LENGTH = 128;

export function isWellFormedProviderId(value: string): boolean {
  if (value.length === 0 || value.length > MAX_PROVIDER_ID_LENGTH) {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  const segments = value.split(":");
  if (segments.length > 3) {
    return false;
  }
  return segments.every((segment) => PROVIDER_SEGMENT.test(segment));
}

export const ProviderIdSchema = z
  .string()
  .min(1)
  .refine(isWellFormedProviderId, {
    message:
      "not a provider id: expected one to three `:`-separated alphanumeric segments, so a URL, webhook, socket address, path, query string, fragment or embedded credential cannot be one",
  });

/**
 * Where a registered provider sends the evaluation.
 *
 * `local` runs on this machine and nothing leaves it. `remote` sends prompts
 * and dataset rows to a third party, which is a projection and needs
 * authorization before it happens.
 */
export type ProviderReach = "local" | "remote";

/**
 * A provider this adapter is permitted to execute.
 *
 * Registration is the closure. The grammar above rules out ids that are
 * secretly endpoints; it cannot rule out `browser` or `promptfoo:manual-input`,
 * because those are well-formed names for capabilities this milestone does not
 * cover — interactive input, an agent loop, a headless browser. No pattern
 * distinguishes them from a model id, and a denylist of them would need
 * extending every time promptfoo adds a provider.
 *
 * So nothing is executable by default. An adapter is constructed with the
 * providers it may run, each declaring its reach, and an unregistered id is
 * refused before anything is spawned. Deciding WHAT to register is a policy
 * question this milestone deliberately leaves to its caller.
 */
export interface ProviderRegistration {
  readonly id: string;
  readonly reach: ProviderReach;
  /**
   * Where this provider's traffic goes, as a stable identity bound into the
   * projection digest. `"local"` for a local provider; a lower-case DNS host
   * name, optionally with a port, for a remote one. Never a URL: a scheme,
   * path, query or user-info would let two different destinations share one
   * identity.
   */
  readonly destination: string;
  /**
   * The exact environment variable names this provider may read for
   * credentials. An evaluation spec may reference only names listed here, and
   * the match is exact, so the spelling forwarded to the process is the one
   * trusted policy wrote.
   *
   * This is POLICY, supplied when the adapter is constructed. It is never read
   * from a request, a spec, or an agent proposal: the caller who describes an
   * evaluation must not also decide which parts of the environment that
   * evaluation may see.
   */
  readonly credentialEnvNames: readonly string[];
}

export interface ProviderRegistryProblem {
  readonly reasons: readonly string[];
}

export type ProviderRegistry = ReadonlyMap<string, ProviderRegistration>;

/**
 * Environment names that change WHICH program runs or WHERE its traffic goes.
 *
 * A fixed set derived from how this adapter executes, not a list of vendors:
 *
 * - the resolution variables the subprocess runner forwards
 *   (`EXECUTION_ENV_ALLOWLIST`), because a credential named `PATH` would
 *   decide which binary a bare executable name resolves to;
 * - `NODE_OPTIONS`, because promptfoo is a Node program and `--require` there
 *   loads arbitrary code into the process whose version was probed;
 * - the proxy variables Node's fetch honours, because they send traffic
 *   somewhere other than the destination identity the projection binds.
 *
 * No provider policy may allow these, whatever it declares. Vendor endpoint
 * variables such as `OPENAI_BASE_URL` are NOT listed: they are refused because
 * a policy must name every credential it allows, not because a list recognised
 * them. Compared case-insensitively.
 */
export const EXECUTION_CONTROL_ENVIRONMENT_NAMES: readonly string[] = [
  ...EXECUTION_ENV_ALLOWLIST,
  "NODE_OPTIONS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
];

export function isExecutionControlEnvironmentName(name: string): boolean {
  const upper = name.toUpperCase();
  return EXECUTION_CONTROL_ENVIRONMENT_NAMES.some(
    (reserved) => reserved.toUpperCase() === upper,
  );
}

/** A lower-case DNS host name with an optional port. Never a URL. */
const DESTINATION_HOST =
  /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

export const LOCAL_DESTINATION = "local" as const;

const ProviderRegistrationSchema = z.strictObject({
  id: z.string(),
  reach: z.enum(["local", "remote"]),
  destination: z.string(),
  credentialEnvNames: z.array(z.string()),
});

/**
 * Build a registry from trusted policy, refusing anything malformed.
 *
 * A caller cannot register its way past the grammar -- registering
 * `https://host/collect` fails here, not at run time -- and cannot grant a
 * credential name that controls execution or destination. Each registration is
 * a closed shape, so a field this adapter does not understand is refused rather
 * than silently ignored.
 */
export function buildProviderRegistry(
  registrations: readonly ProviderRegistration[],
): { readonly registry: ProviderRegistry } | ProviderRegistryProblem {
  const reasons: string[] = [];
  const registry = new Map<string, ProviderRegistration>();

  let entries: readonly unknown[];
  try {
    entries = Array.isArray(registrations) ? [...registrations] : [];
    if (!Array.isArray(registrations)) {
      reasons.push("provider policy must be a list of registrations");
    }
  } catch {
    return { reasons: ["provider policy could not be read"] };
  }

  for (const [index, entry] of entries.entries()) {
    const parsed = ProviderRegistrationSchema.safeParse(entry);
    if (!parsed.success) {
      reasons.push(
        `registration ${index} is not a closed provider registration: ${parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`,
          )
          .join("; ")}`,
      );
      continue;
    }
    const registration = parsed.data;
    const label = `"${registration.id}"`;

    if (!isWellFormedProviderId(registration.id)) {
      reasons.push(
        `${label} is not a well-formed provider id and cannot be registered`,
      );
      continue;
    }

    if (registration.reach === "local") {
      if (registration.destination !== LOCAL_DESTINATION) {
        reasons.push(
          `${label} is local, so its destination must be "${LOCAL_DESTINATION}"; a local provider that names a host is not local`,
        );
        continue;
      }
    } else if (
      registration.destination === LOCAL_DESTINATION ||
      !DESTINATION_HOST.test(registration.destination)
    ) {
      reasons.push(
        `${label} is remote, so its destination must be a lower-case host name with an optional port -- not a URL, path, user-info or "${LOCAL_DESTINATION}"`,
      );
      continue;
    }

    const seen = new Set<string>();
    let credentialsValid = true;
    for (const name of registration.credentialEnvNames) {
      const folded = name.toUpperCase();
      if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
        reasons.push(
          `${label} allows "${name}", which is not a portable environment-variable name`,
        );
        credentialsValid = false;
      } else if (isReservedEnvironmentName(name)) {
        reasons.push(`${label} allows "${name}", which this adapter owns`);
        credentialsValid = false;
      } else if (isExecutionControlEnvironmentName(name)) {
        reasons.push(
          `${label} allows "${name}", which controls which program runs or where its traffic goes; no provider policy may grant it as a credential`,
        );
        credentialsValid = false;
      } else if (seen.has(folded)) {
        reasons.push(
          `${label} allows "${name}" more than once, ignoring case; on Windows those are the same variable`,
        );
        credentialsValid = false;
      }
      seen.add(folded);
    }
    if (!credentialsValid) {
      continue;
    }

    const existing = registry.get(registration.id);
    if (existing !== undefined) {
      reasons.push(
        `${label} is registered more than once; one provider has one reach, one destination and one credential policy`,
      );
      continue;
    }

    registry.set(
      registration.id,
      Object.freeze({
        id: registration.id,
        reach: registration.reach,
        destination: registration.destination,
        credentialEnvNames: Object.freeze([...registration.credentialEnvNames]),
      }),
    );
  }

  if (reasons.length > 0) {
    return { reasons: [...new Set(reasons)].sort(compareCodeUnits) };
  }
  return { registry };
}

/**
 * Variables the adapter owns.
 *
 * The comparison is case-INSENSITIVE, and there is exactly one of it. Windows
 * environment names are case-insensitive, so `promptfoo_disable_sharing` and
 * `PROMPTFOO_DISABLE_SHARING` are the same variable there; a case-sensitive
 * check accepted the lower-case spelling as a "credential" and let a caller
 * turn sharing back on. Two checks that disagree is how that happened: the
 * schema compared with `startsWith("PROMPTFOO_")` while
 * `isReservedEnvironmentName` upper-cased first.
 */
export const RESERVED_ENVIRONMENT_PREFIXES: readonly string[] = ["PROMPTFOO_"];

export function isReservedEnvironmentName(name: string): boolean {
  const upper = name.toUpperCase();
  return RESERVED_ENVIRONMENT_PREFIXES.some((prefix) =>
    upper.startsWith(prefix),
  );
}

/**
 * A portable environment-variable name: a letter or underscore, then letters,
 * digits or underscores. This is the C identifier rule, which is the POSIX
 * portable rule with case allowed. It rejects the shapes that would otherwise
 * reach `execve` as something other than a name — an embedded `=`, a NUL, a
 * space, a leading digit, the empty string.
 */
export const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const EnvironmentVariableNameSchema = z
  .string()
  .min(1)
  .refine((value) => ENVIRONMENT_NAME_PATTERN.test(value), {
    message:
      "not a portable environment-variable name: expected a letter or underscore followed by letters, digits or underscores",
  })
  .refine((value) => !isReservedEnvironmentName(value), {
    message:
      "PROMPTFOO_* names are owned by this adapter, which sets them last so a credential cannot override a safety setting; the comparison is case-insensitive because Windows environment names are",
  });

const bounded = (min: number, max: number) => z.number().min(min).max(max);
const boundedInteger = (min: number, max: number) =>
  z.number().int().min(min).max(max);

/**
 * Provider configuration: a closed allowlist of ordinary model parameters.
 *
 * `z.record(z.string(), z.unknown())` was NOT closed data. It re-admitted
 * everything the spec exists to exclude, through the one door left open —
 * `{ request: "file:///tmp/request.txt" }`, `{ transformResponse: "..." }`
 * pointing at a script, a literal `apiKey`, a function, `NaN`, a cyclic
 * object. Each of those changes what runs while contributing nothing the
 * identity could describe.
 *
 * So this milestone does not try to model promptfoo's provider configuration.
 * It accepts eight sampling parameters, each a finite number in a stated range,
 * plus a small `stop` list. Everything else — every unknown key, every path,
 * every URL, every transform, every credential-bearing key — is refused, and
 * refused by absence from this object rather than by a pattern that has to
 * anticipate the attack.
 */
export const PROVIDER_CONFIG_ALLOWLIST = [
  "frequency_penalty",
  "max_tokens",
  "presence_penalty",
  "seed",
  "stop",
  "temperature",
  "top_k",
  "top_p",
] as const;

export const ProviderConfigSchema = z.strictObject({
  temperature: bounded(0, 2).optional(),
  top_p: bounded(0, 1).optional(),
  top_k: boundedInteger(1, 1000).optional(),
  seed: boundedInteger(0, 2_147_483_647).optional(),
  max_tokens: boundedInteger(1, 1_000_000).optional(),
  frequency_penalty: bounded(-2, 2).optional(),
  presence_penalty: bounded(-2, 2).optional(),
  stop: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(4)
    .refine(
      (values) =>
        values.every(
          (value) => !REFERENCE_PREFIX.test(value) && !URL_PREFIX.test(value),
        ),
      { message: "a stop sequence must be a literal string" },
    )
    .optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * Provider declaration.
 *
 * `credential_env_names` is the ONLY place credentials are declared. The names
 * are hashed into `model_configuration_hash` and the same list is what the
 * subprocess receives, so the set that was hashed and the set that executed
 * cannot differ. Values are never carried: the whole spec is scanned for secret
 * values before anything runs.
 */
export const ProviderSchema = z.strictObject({
  id: ProviderIdSchema,
  config: ProviderConfigSchema.prefault({}),
  credential_env_names: z
    .array(EnvironmentVariableNameSchema)
    .max(16)
    .refine(
      (names) =>
        new Set(names.map((name) => name.toUpperCase())).size === names.length,
      {
        message:
          "a credential environment variable is declared more than once, ignoring case; on Windows those are the same variable, and the hashed set and the executed set must be the same set",
      },
    )
    .default([]),
});

export type ProviderDeclaration = z.infer<typeof ProviderSchema>;

export const PromptfooEvaluationSpecSchema = z.strictObject({
  spec_version: z.literal(PROMPTFOO_SPEC_VERSION),
  /** Attribution. These are the only declarations of each; there is no second. */
  workload_ref: z.string().min(1),
  candidate_ref: z.string().min(1),
  dataset: z.strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
    rows: z.array(TestRowSchema).min(1).max(10_000),
  }),
  /** Inline prompt CONTENT, never a path, a fetched reference or a statement. */
  prompts: z
    .array(
      z
        .string()
        .min(1)
        .refine((value) => !REFERENCE_PREFIX.test(value), {
          message: "a prompt must be its content, not a reference",
        })
        .refine((value) => !REMOTE_PROMPT_PREFIX.test(value), {
          message:
            "a prompt naming a prompt-management service is fetched over the network when rendered, so what would be sent is not what the projection covers",
        })
        .superRefine((value, context) => {
          const parsed = parsePromptTemplate(value);
          if ("problem" in parsed) {
            // The parser's own reason, so the refusal names what was wrong.
            context.addIssue({
              code: "custom",
              message: `a prompt may use template syntax only as a plain {{ variable }} interpolation: ${parsed.problem}`,
            });
          }
        })
        .refine((value) => !promptfooWouldReadAsPath(value), {
          message:
            "promptfoo 0.122.0 would read this single-line prompt as a file path (it contains a slash, a backslash or '*', ends in a file extension, or has a '.' third or fourth from the end); rephrase it, or make it span more than one line",
        }),
    )
    .min(1)
    .max(64),
  provider: ProviderSchema,
  /** Assertions applied to every row. */
  default_assertions: z.array(AssertionSchema).default([]),
  description: z.string().min(1).optional(),
});

export type PromptfooEvaluationSpec = z.infer<
  typeof PromptfooEvaluationSpecSchema
>;

export interface SpecRejection {
  readonly reasons: readonly string[];
}

export type SpecValidation =
  { readonly spec: PromptfooEvaluationSpec } | SpecRejection;

export function isRejection(
  value: SpecValidation | PlanOutcome,
): value is SpecRejection {
  return "reasons" in value;
}

/** Name an assertion type precisely when it is refused, so the reason is usable. */
function describeAssertionType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const bare = value.startsWith("not-") ? value.slice(4) : value;
  if ((MODEL_GRADED_ASSERTION_TYPES as readonly string[]).includes(bare)) {
    return `"${value}" is model-graded: its outcome is decided by another model, whose identity this slice cannot represent or attribute`;
  }
  if ((EXECUTABLE_ASSERTION_TYPES as readonly string[]).includes(bare)) {
    return `"${value}" executes code, whose behaviour is not determined by the bytes in this spec`;
  }
  return null;
}

function rejection(reasons: readonly string[]): SpecRejection {
  return { reasons: [...new Set(reasons)].sort(compareCodeUnits) };
}

/**
 * Validate a spec, with reasons a caller can act on.
 *
 * This function NEVER throws. Hostile input is ordinary input here: a getter
 * that raises, a proxy, a cyclic object, a bigint where a number belongs. Each
 * has to come back as a structured rejection, because a thrown error from a
 * validator is indistinguishable from a crash and a crash is not a decision.
 */
export function validateEvaluationSpec(input: unknown): SpecValidation {
  try {
    const reasons: string[] = [];

    // Look for the two interesting refusals before Zod flattens them into an
    // enum complaint.
    if (input !== null && typeof input === "object") {
      const candidate = input as {
        dataset?: { rows?: { assert?: { type?: unknown }[] }[] };
        default_assertions?: { type?: unknown }[];
      };
      const everyAssertion = [
        ...(candidate.dataset?.rows ?? []).flatMap((row) => row?.assert ?? []),
        ...(candidate.default_assertions ?? []),
      ];
      for (const assertion of everyAssertion) {
        const described = describeAssertionType(assertion?.type);
        if (described !== null) {
          reasons.push(described);
        }
      }
    }

    const parsed = PromptfooEvaluationSpecSchema.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        reasons.push(
          path.length > 0 ? `${path}: ${issue.message}` : issue.message,
        );
      }
      return rejection(reasons);
    }

    if (reasons.length > 0) {
      return rejection(reasons);
    }

    // A credential value in the spec would be written into the generated config
    // and then into a run directory. Names are fine; values never are.
    const secrets = findSecrets(parsed.data);
    if (secrets.length > 0) {
      return rejection(
        secrets.map(
          (finding) =>
            `${finding.path} carries a credential value; name the environment variable in provider.credential_env_names instead`,
        ),
      );
    }

    const templates = templateProblems(parsed.data);
    const rewritten = templatedStrings(parsed.data)
      .filter(([, value]) => isRewrittenOnExport(value))
      .map(
        ([path]) =>
          `${path} is JSON that promptfoo 0.122.0 rewrites when it exports results, so its artifact could not show which form was evaluated; write it compactly, as JSON.stringify would`,
      );
    if (templates.length > 0 || rewritten.length > 0) {
      return rejection([...templates, ...rewritten]);
    }

    return { spec: parsed.data };
  } catch (error) {
    // Reading the input itself failed — a throwing getter, a hostile proxy.
    return rejection([
      `the spec could not be read as data: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

/**
 * Every template problem in a parsed spec.
 *
 * Checked on the GENERATED CONFIG, which is exactly what promptfoo reads, so a
 * string that reaches it indirectly -- a candidate reference folded into the
 * default description -- is covered too. Prompts follow the interpolation
 * grammar and may reference only variables every row defines; every other
 * string, and every key, must be literal.
 */
function templateProblems(spec: PromptfooEvaluationSpec): string[] {
  const problems: string[] = [];
  const referenced = new Set<string>();

  spec.prompts.forEach((prompt, index) => {
    const parsed = parsePromptTemplate(prompt);
    if ("problem" in parsed) {
      problems.push(
        `prompts[${index}] is not a permitted template: ${parsed.problem}`,
      );
    } else {
      parsed.variables.forEach((name) => referenced.add(name));
    }
  });

  for (const name of [...referenced].sort(compareCodeUnits)) {
    spec.dataset.rows.forEach((row, index) => {
      if (!Object.prototype.hasOwnProperty.call(row.vars, name)) {
        problems.push(
          `a prompt's template references the variable "${name}", which dataset.rows[${index}] does not define; every referenced variable must exist in every row`,
        );
      }
    });
  }

  // Prompts were checked against the grammar above; everything else is literal.
  const literal: Record<string, unknown> = { ...generatePromptfooConfig(spec) };
  delete literal.prompts;
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (containsTemplateSyntax(value)) {
        problems.push(
          `${path} contains Nunjucks template syntax ({{, {%, {# or #}); promptfoo renders this string, a Nunjucks expression can execute JavaScript, and only prompts may use the {{ variable }} template form`,
        );
      }
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
    } else if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        if (containsTemplateSyntax(key)) {
          problems.push(
            `the key "${key}" under ${path} contains Nunjucks template syntax; names are literal and may not contain template tags`,
          );
        }
        walk(entry, `${path}.${key}`);
      }
    }
  };
  walk(literal, "generated config");
  return problems;
}

/**
 * Every string promptfoo may render as a Nunjucks template, with its path.
 *
 * Prompts, variable values, assertion values, row descriptions, the evaluation
 * description, and stop sequences. Erring towards more strings costs only a
 * refused `{%`, which ordinary data has no reason to contain.
 */
function templatedStrings(
  spec: PromptfooEvaluationSpec,
): (readonly [string, string])[] {
  const found: (readonly [string, string])[] = [];
  const note = (path: string, value: unknown): void => {
    if (typeof value === "string") {
      found.push([path, value]);
    } else if (Array.isArray(value)) {
      value.forEach((entry, index) => note(`${path}[${index}]`, entry));
    }
  };
  spec.prompts.forEach((prompt, index) => note(`prompts[${index}]`, prompt));
  spec.dataset.rows.forEach((row, index) => {
    note(`dataset.rows[${index}].description`, row.description);
    for (const [name, value] of Object.entries(row.vars)) {
      note(`dataset.rows[${index}].vars.${name}`, value);
    }
    row.assert.forEach((assertion, position) =>
      note(
        `dataset.rows[${index}].assert[${position}].value`,
        "value" in assertion ? assertion.value : undefined,
      ),
    );
  });
  spec.default_assertions.forEach((assertion, position) =>
    note(
      `default_assertions[${position}].value`,
      "value" in assertion ? assertion.value : undefined,
    ),
  );
  note("description", spec.description);
  note("provider.config.stop", spec.provider.config.stop);
  return found;
}

/**
 * The promptfoo config ANVILMARK writes.
 *
 * Only these keys are ever emitted. `scenarios`, `transform`, `extensions`,
 * `env`, `defaultTest` as a file, and every other promptfoo feature are absent
 * because nothing generates them.
 */
export function generatePromptfooConfig(
  spec: PromptfooEvaluationSpec,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    description:
      spec.description ??
      `ANVILMARK evaluation of ${spec.candidate_ref} on ${spec.dataset.id}@${spec.dataset.version}`,
    providers: [
      Object.keys(spec.provider.config).length === 0
        ? spec.provider.id
        : { id: spec.provider.id, config: spec.provider.config },
    ],
    prompts: [...spec.prompts],
    tests: spec.dataset.rows.map((row) => ({
      ...(row.description === undefined
        ? {}
        : { description: row.description }),
      vars: row.vars,
      ...(row.assert.length === 0 ? {} : { assert: row.assert }),
    })),
  };

  if (spec.default_assertions.length > 0) {
    config.defaultTest = { assert: spec.default_assertions };
  }

  return config;
}

/**
 * Canonical bytes of the generated config.
 *
 * The project's canonical serializer, not `JSON.stringify`: keys are emitted in
 * code-unit order at every depth, so two specs that differ only in the order
 * their keys were written produce identical bytes and therefore an identical
 * `config_digest`. Ordinary `JSON.stringify` preserves insertion order, which
 * would make the digest depend on how the caller happened to build the object.
 */
export function renderPromptfooConfig(spec: PromptfooEvaluationSpec): string {
  return prettyStringify(generatePromptfooConfig(spec));
}

function digest(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export interface SpecIdentities {
  readonly dataset_hash: string;
  readonly prompt_hash: string;
  readonly evaluator_hash: string;
  readonly model_configuration_hash: string;
  readonly config_digest: string;
  readonly provider_id: string;
}

/**
 * Derive every identity from the spec itself.
 *
 * Each component covers exactly its own data and nothing else, so a reader can
 * tell which input moved:
 *
 * | digest                     | canonical bytes                                        |
 * | -------------------------- | ------------------------------------------------------ |
 * | `dataset_hash`             | dataset id, version, and each row WITHOUT its `assert` |
 * | `prompt_hash`              | the ordered list of inline prompt contents             |
 * | `evaluator_hash`           | default assertions plus each row's `assert`, in order  |
 * | `model_configuration_hash` | provider id, config data, and credential NAMES         |
 * | `config_digest`            | the exact generated config bytes                       |
 *
 * Row order is preserved rather than sorted: promptfoo runs rows in order, and
 * reordering a dataset is a change to the dataset.
 */
export function deriveSpecIdentities(
  spec: PromptfooEvaluationSpec,
): SpecIdentities {
  const rowsWithoutAssertions = spec.dataset.rows.map((row) => ({
    ...(row.description === undefined ? {} : { description: row.description }),
    vars: row.vars,
  }));

  return {
    dataset_hash: digest(
      stableStringify({
        id: spec.dataset.id,
        version: spec.dataset.version,
        rows: rowsWithoutAssertions,
      }),
    ),
    prompt_hash: digest(stableStringify(spec.prompts)),
    evaluator_hash: digest(
      stableStringify({
        default: spec.default_assertions,
        rows: spec.dataset.rows.map((row) => row.assert),
      }),
    ),
    model_configuration_hash: digest(
      stableStringify({
        id: spec.provider.id,
        config: spec.provider.config,
        credential_env_names: [...spec.provider.credential_env_names].sort(
          compareCodeUnits,
        ),
      }),
    ),
    config_digest: digest(renderPromptfooConfig(spec)),
    provider_id: spec.provider.id,
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  for (const member of Object.values(value as Record<string, unknown>)) {
    deepFreeze(member);
  }
  return Object.freeze(value);
}

/**
 * One immutable evaluation plan: everything the run needs, computed once.
 *
 * The config was previously rendered at three separate points — into the
 * snapshot, into `config_digest`, and again for the post-run integrity check —
 * from a spec object the caller could still be holding. Three renders of a
 * mutable input is three chances to disagree. Here the bytes are produced once,
 * the digest is taken over those bytes, and the spec they came from is a
 * canonical deep copy that is frozen at every level, so a later mutation of the
 * caller's object cannot reach any of it.
 */
export interface EvaluationPlan {
  readonly spec: PromptfooEvaluationSpec;
  /** The exact bytes written to the snapshot and hashed as `config_digest`. */
  readonly configBytes: string;
  readonly identities: SpecIdentities;
  readonly providerId: string;
  readonly credentialEnvNames: readonly string[];
  readonly workloadRef: string;
  readonly candidateRef: string;
  readonly datasetRef: string;
  readonly datasetVersion: string;
}

export type PlanOutcome = { readonly plan: EvaluationPlan } | SpecRejection;

/**
 * Validate, take ownership of the data, and compute the plan. Never throws.
 */
export function planEvaluation(input: unknown): PlanOutcome {
  const validation = validateEvaluationSpec(input);
  if (isRejection(validation)) {
    return validation;
  }

  try {
    // Canonicalising re-materialises every object and array, so nothing in the
    // plan is still shared with the caller's input.
    const owned = PromptfooEvaluationSpecSchema.safeParse(
      JSON.parse(stableStringify(validation.spec)) as unknown,
    );
    if (!owned.success) {
      return rejection([
        "the validated spec did not survive canonicalisation, which means it holds a value that cannot be represented portably",
      ]);
    }

    const spec = deepFreeze(owned.data);
    const configBytes = renderPromptfooConfig(spec);
    const identities = deriveSpecIdentities(spec);

    return {
      plan: deepFreeze({
        spec,
        configBytes,
        identities,
        providerId: spec.provider.id,
        credentialEnvNames: [...spec.provider.credential_env_names],
        workloadRef: spec.workload_ref,
        candidateRef: spec.candidate_ref,
        datasetRef: spec.dataset.id,
        datasetVersion: spec.dataset.version,
      }),
    };
  } catch (error) {
    return rejection([
      `the spec could not be reduced to a portable plan: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

/**
 * What would leave this machine, stated before anything leaves it.
 *
 * Decision 06 denies evaluation rows by default and requires the exact outbound
 * projection to be shown before it is sent. `collect()` could previously
 * execute a remote provider straight away, which is that rule not being
 * enforced at all.
 *
 * The projection is data, not a decision. It says WHAT would go, WHERE, and
 * fixes both in a digest. Nothing here approves anything.
 */
export interface EvaluationProjection {
  readonly provider_id: string;
  readonly destination: ProviderReach;
  /**
   * The stable destination identity from trusted provider policy: `"local"`,
   * or the host the traffic goes to. Bound into `projection_digest`.
   */
  readonly destination_identity: string;
  /**
   * Fixes the provider, destination identity, credential-name set and exact
   * content in one value. An authorization matches this, so approving one
   * destination or one set of credentials is not approving another.
   */
  readonly projection_digest: string;
  /** The exact bytes that would be sent, hashed. */
  readonly content_digest: string;
  /** Plain-language categories, for a human to read before deciding. */
  readonly data_categories: readonly string[];
  readonly prompt_count: number;
  readonly row_count: number;
  readonly case_count: number;
  /** Names only. A value never appears in a projection. */
  readonly credential_env_names: readonly string[];
}

/**
 * A recorded human authorization for one exact projection.
 *
 * Milestone 2 does NOT create these. It has no interactive surface and no
 * standing to approve anything on a person's behalf. Milestone 3's flow shows
 * the projection and records the decision; this milestone only enforces that a
 * matching record exists before a remote provider runs.
 */
export interface RemoteAuthorization {
  readonly provider_id: string;
  readonly projection_digest: string;
  /** ISO-8601. Compared against the adapter's clock for staleness. */
  readonly authorized_at: string;
}

/**
 * Describe the projection for a plan under one provider registration.
 *
 * `content_digest` covers the prompts, every variable value and every assertion
 * value -- the whole of what a remote provider would receive. The projection
 * digest binds that content to the provider, the reach, the concrete
 * destination identity and the credential-name set, so an authorization cannot
 * be replayed against a different host, a different reach, or a run that reads
 * more credentials than the one that was approved.
 */
export function describeOutboundProjection(
  plan: EvaluationPlan,
  registration: Pick<ProviderRegistration, "reach" | "destination">,
): EvaluationProjection {
  const destination = registration.reach;
  const destinationIdentity = registration.destination;
  const credentialNames = [...plan.spec.provider.credential_env_names].sort(
    compareCodeUnits,
  );
  const spec = plan.spec;
  // Every category listed below as outbound is inside this digest, including
  // row descriptions: a category a person is told about but that the digest
  // does not cover could change after approval without invalidating it.
  const contentDigest = digest(
    stableStringify({
      prompts: spec.prompts,
      rows: spec.dataset.rows.map((row) => ({
        ...(row.description === undefined
          ? {}
          : { description: row.description }),
        vars: row.vars,
        assert: row.assert,
      })),
      default_assertions: spec.default_assertions,
    }),
  );

  const categories: string[] = ["prompt_text", "dataset_variable_values"];
  const hasAssertionValues =
    spec.default_assertions.some((entry) => "value" in entry) ||
    spec.dataset.rows.some((row) =>
      row.assert.some((entry) => "value" in entry),
    );
  if (hasAssertionValues) {
    categories.push("assertion_expected_values");
  }
  if (spec.dataset.rows.some((row) => row.description !== undefined)) {
    categories.push("row_descriptions");
  }
  if (Object.keys(spec.provider.config).length > 0) {
    categories.push("provider_sampling_parameters");
  }
  if (spec.provider.credential_env_names.length > 0) {
    categories.push("credential_values_read_from_the_environment");
  }

  return {
    provider_id: plan.providerId,
    destination,
    destination_identity: destinationIdentity,
    projection_digest: digest(
      stableStringify({
        provider_id: plan.providerId,
        destination,
        destination_identity: destinationIdentity,
        credential_env_names: credentialNames,
        // Provider configuration -- temperature, max_tokens, stop -- changes
        // what a remote provider is asked to do. It was absent from 591171a's
        // digest, so an approval for temperature 0.1 was accepted for 0.9.
        model_configuration_hash: plan.identities.model_configuration_hash,
        // The exact bytes promptfoo reads. Anything the generated config
        // carries that the named components miss is still covered here.
        config_digest: plan.identities.config_digest,
        content_digest: contentDigest,
      }),
    ),
    content_digest: contentDigest,
    data_categories: categories,
    prompt_count: spec.prompts.length,
    row_count: spec.dataset.rows.length,
    case_count: expectedCaseCount(plan),
    credential_env_names: credentialNames,
  };
}

/**
 * How many cases this plan must produce.
 *
 * promptfoo runs every prompt against every row, with exactly one provider in
 * this subset, so the count is fixed by the spec before the tool runs. An
 * artifact reporting a different number is not describing this evaluation.
 */
export function expectedCaseCount(plan: EvaluationPlan): number {
  return plan.spec.dataset.rows.length * plan.spec.prompts.length;
}

/** What this slice supports, for documentation and error messages. */
export const SUPPORTED_EVALUATION_SUBSET = [
  "an ANVILMARK-owned evaluation spec whose every input is inline data",
  "exactly one provider, named by a well-formed id and registered by trusted policy with its reach, destination identity and allowed credential names",
  "provider configuration drawn only from the sampling-parameter allowlist",
  "one or more inline prompt strings that promptfoo 0.122.0 will not read as a file path or fetch from a prompt service",
  "inline test rows whose variables are literal values",
  `deterministic assertions of type ${BASE_ASSERTION_TYPES.join(", ")}, each also in its not- form, in the value and threshold shape its promptfoo 0.122.0 handler evaluates`,
  "plain {{ variable }} interpolation in prompts, of variables every row defines; every other string literal",
  "JSON-valued strings written compactly, as promptfoo exports them",
  "promptfoo 0.122.0 exactly",
] as const;

/** What this slice refuses, and why, for documentation. */
export const EXPLICITLY_UNSUPPORTED = [
  "an arbitrary or imported promptfoo config file, including `configPath`",
  "any provider not registered by trusted construction-time policy",
  "HTTP, WebSocket, webhook and other custom-endpoint providers, which promptfoo attributes by URL; deferred as a capability rather than admitted by weakening the provider-id grammar",
  "`file://`, `exec:`, `python:`, `package:` and executable providers",
  "file or program references inside prompts, variables or assertion values",
  "single-line prompts promptfoo 0.122.0 reads as file paths, and portkey://, langfuse:// and helicone:// prompt references",
  "any other Nunjucks syntax -- expressions beyond {{ variable }}, filters, comments, statements -- in a prompt, and any template syntax at all in a literal field",
  "assertions promptfoo cannot evaluate: a missing or wrong-typed value, a comma-string list, an uncompilable regular expression, an unstated levenshtein threshold, a threshold on a type that does not read one, or a JSON schema value",
  "provider configuration outside the sampling-parameter allowlist, including `request`, `transformResponse`, `tools`, and any credential-bearing key",
  "`scenarios`, `transform`, `filters`, `extensions` and `env`",
  "JavaScript, Python and Ruby assertions or transforms",
  "model-graded assertions, whose grader provider cannot yet be attributed",
  "literal credential values anywhere in the spec",
  "promptfoo versions other than 0.122.0",
] as const;
