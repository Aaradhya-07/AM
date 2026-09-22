/**
 * Acceptance against the REAL promptfoo binary.
 *
 * Opt-in: set ANVILMARK_PROMPTFOO_BIN to a promptfoo executable. Skipped
 * otherwise, so the normal suite still makes no external calls and needs no
 * install. The provider is promptfoo's built-in `echo`, which returns the
 * rendered prompt verbatim -- no API key, no model request, no paid call.
 */
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BASE_ASSERTION_TYPES,
  PROMPTFOO_SPEC_VERSION,
  SUPPORTED_ASSERTION_TYPES,
  createPromptfooAdapter,
  isAvailable,
  planEvaluation,
} from "../src/index.js";

const BINARY = process.env["ANVILMARK_PROMPTFOO_BIN"];
const describeReal = BINARY ? describe : describe.skip;

interface Case {
  readonly type: string;
  readonly text: string;
  readonly value?: string | readonly string[];
  readonly threshold?: number;
}

/**
 * One case per supported assertion type, arranged so the assertion HOLDS.
 *
 * `echo` returns the rendered prompt, and the prompt is `{{text}}`, so `text`
 * is exactly the model output each assertion sees.
 */
const HOLDS: readonly Case[] = [
  { type: "contains", text: "hello world", value: "hello" },
  { type: "contains-all", text: "hello world", value: ["hello", "world"] },
  { type: "contains-any", text: "hello world", value: ["absent", "world"] },
  { type: "contains-json", text: '{"ok":true}' },
  { type: "equals", text: "exact", value: "exact" },
  { type: "icontains", text: "Hello World", value: "hello" },
  { type: "icontains-all", text: "Hello World", value: ["hello", "world"] },
  { type: "icontains-any", text: "Hello World", value: ["nope", "WORLD"] },
  { type: "is-json", text: '{"a":1}' },
  { type: "levenshtein", text: "kitten", value: "sitting", threshold: 3 },
  { type: "regex", text: "abc123", value: "^[a-z]+[0-9]+$" },
  { type: "starts-with", text: "prefix-body", value: "prefix" },
  { type: "not-contains", text: "hello world", value: "zzz" },
  { type: "not-contains-all", text: "hello world", value: ["hello", "zzz"] },
  { type: "not-contains-any", text: "hello world", value: ["zzz", "qqq"] },
  { type: "not-contains-json", text: "plain text" },
  { type: "not-equals", text: "exact", value: "different" },
  { type: "not-icontains", text: "Hello World", value: "zzz" },
  { type: "not-icontains-all", text: "Hello World", value: ["hello", "zzz"] },
  { type: "not-icontains-any", text: "Hello World", value: ["zzz", "qqq"] },
  { type: "not-is-json", text: "plain text" },
  {
    type: "not-levenshtein",
    text: "kitten",
    value: "completelydifferent",
    threshold: 2,
  },
  { type: "not-regex", text: "abc123", value: "^[0-9]+$" },
  { type: "not-starts-with", text: "prefix-body", value: "other" },
];

/**
 * The same types, arranged so each assertion MUST fail.
 *
 * This is the half that proves anything. A type promptfoo did not recognise
 * would pass here, so a run in which all of them fail is what establishes that
 * every type in the allowlist is genuinely honoured rather than ignored.
 */
const FAILS: readonly Case[] = [
  { type: "contains", text: "hello world", value: "zzz" },
  { type: "contains-all", text: "hello world", value: ["hello", "zzz"] },
  { type: "contains-any", text: "hello world", value: ["zzz", "qqq"] },
  { type: "contains-json", text: "plain text" },
  { type: "equals", text: "exact", value: "different" },
  { type: "icontains", text: "Hello World", value: "zzz" },
  { type: "icontains-all", text: "Hello World", value: ["hello", "zzz"] },
  { type: "icontains-any", text: "Hello World", value: ["zzz", "qqq"] },
  { type: "is-json", text: "plain text" },
  {
    type: "levenshtein",
    text: "kitten",
    value: "completelydifferent",
    threshold: 2,
  },
  { type: "regex", text: "abc123", value: "^[0-9]+$" },
  { type: "starts-with", text: "prefix-body", value: "other" },
  { type: "not-contains", text: "hello world", value: "hello" },
  { type: "not-contains-all", text: "hello world", value: ["hello", "world"] },
  { type: "not-contains-any", text: "hello world", value: ["zzz", "world"] },
  { type: "not-contains-json", text: '{"ok":true}' },
  { type: "not-equals", text: "exact", value: "exact" },
  { type: "not-icontains", text: "Hello World", value: "hello" },
  { type: "not-icontains-all", text: "Hello World", value: ["hello", "world"] },
  { type: "not-icontains-any", text: "Hello World", value: ["zzz", "WORLD"] },
  { type: "not-is-json", text: '{"a":1}' },
  { type: "not-levenshtein", text: "kitten", value: "sitting", threshold: 3 },
  { type: "not-regex", text: "abc123", value: "^[a-z]+[0-9]+$" },
  { type: "not-starts-with", text: "prefix-body", value: "prefix" },
];

function rowsFrom(cases: readonly Case[]) {
  return cases.map((entry) => ({
    description: entry.type,
    vars: { text: entry.text },
    assert: [
      {
        type: entry.type,
        ...(entry.value === undefined ? {} : { value: entry.value }),
        ...(entry.threshold === undefined
          ? {}
          : { threshold: entry.threshold }),
      },
    ],
  }));
}

function spec(
  overrides: {
    rows?: unknown;
    prompts?: readonly string[];
    defaultAssertions?: unknown[];
  } = {},
) {
  return {
    spec_version: PROMPTFOO_SPEC_VERSION,
    workload_ref: "workload.support_triage",
    candidate_ref: "candidate.echo",
    dataset: {
      id: "dataset.assertion_coverage",
      version: "1.0.0",
      rows: overrides.rows ?? rowsFrom(HOLDS),
    },
    prompts: overrides.prompts ?? ["{{text}}"],
    provider: { id: "echo" },
    default_assertions: overrides.defaultAssertions ?? [],
  };
}

function planOf(input: unknown) {
  const planned = planEvaluation(input);
  if (!("plan" in planned)) {
    throw new Error(planned.reasons.join("; "));
  }
  return planned.plan;
}

/**
 * Collect WITHOUT removing the caller's directory, so a test can inspect what
 * the adapter left behind. Removing it here would delete the very thing the
 * cleanup assertions need to look at.
 */
async function collectLeavingDirectory(specValue: unknown) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "anvilmark-real-"));
  const outcome = await createPromptfooAdapter({
    // The program and its environment are construction-time choices.
    executable: BINARY,
    readEnv: () => undefined,
    // `echo` is local: it runs in-process in promptfoo and sends nothing
    // anywhere, so it needs registration but not a remote authorization, and
    // reads no credentials.
    providers: [
      {
        id: "echo",
        reach: "local",
        destination: "local",
        credentialEnvNames: [],
      },
    ],
  }).collect({
    evidenceId: "evidence.eval.smoke",
    spec: specValue,
    dataDirectory,
    timeoutMs: 240_000,
    constraintRefs: ["quality.smoke"],
  });
  const planned = planEvaluation(specValue);
  return {
    outcome,
    dataDirectory,
    plan: "plan" in planned ? planned.plan : planOf(twoCaseFallback()),
  };
}

async function runDirectoriesIn(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.startsWith("run-"));
}

/** Only used when a test deliberately collects a spec the adapter refuses. */
function twoCaseFallback() {
  return spec({ rows: rowsFrom(HOLDS.slice(0, 1)) });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describeReal("real promptfoo binary", () => {
  it("runs the generated config end to end and attributes the echo provider", async () => {
    const { outcome, dataDirectory, plan } =
      await collectLeavingDirectory(spec());
    try {
      expect(outcome.errors).toEqual([]);
      expect(outcome.standing).toBe("available");
      if (!isAvailable(outcome)) return;

      const record = outcome.value.record;
      expect(record.kind).toBe("measured_evaluation");
      if (record.kind !== "measured_evaluation") return;

      // Every supported assertion type ran, and every one passed.
      expect(record.producer.version).toBe("0.122.0");
      expect(record.value.metrics["cases_attempted"]).toBe(
        SUPPORTED_ASSERTION_TYPES.length,
      );
      expect(record.value.metrics["successes"]).toBe(
        SUPPORTED_ASSERTION_TYPES.length,
      );
      expect(record.value.metrics["failures"]).toBe(0);
      expect(record.value.metrics["errors"]).toBe(0);

      // Attribution comes from the artifact, reconciled against the spec.
      expect(record.value.identity.provider_id).toBe("echo");

      // Attribution fields come from the spec, the only declaration there is.
      expect(record.applies_to.candidate_ref).toBe("candidate.echo");
      expect(record.applies_to.workload_ref).toBe("workload.support_triage");
      expect(record.value.dataset_ref).toBe("dataset.assertion_coverage");
      expect(record.value.dataset_version).toBe("1.0.0");

      // Every recorded digest is the one ANVILMARK derived from the spec.
      expect(record.value.identity.dataset_hash).toBe(
        plan.identities.dataset_hash,
      );
      expect(record.value.identity.prompt_hash).toBe(
        plan.identities.prompt_hash,
      );
      expect(record.value.identity.evaluator_hash).toBe(
        plan.identities.evaluator_hash,
      );
      expect(record.value.identity.model_configuration_hash).toBe(
        plan.identities.model_configuration_hash,
      );
      expect(record.value.identity.config_digest).toBe(
        plan.identities.config_digest,
      );

      expect(outcome.value.tier).toBe("T3");

      // Cleanup, checked BEFORE anything here removes the parent: the adapter
      // removes the run directory it created and leaves the caller's directory
      // alone. The manifest no longer names the run directory -- arguments are
      // relative to it -- so what is checked is that no run directory remains.
      expect(await exists(dataDirectory)).toBe(true);
      expect(await runDirectoriesIn(dataDirectory)).toEqual([]);

      // Nothing machine-specific is written into the persisted record.
      const persisted = JSON.stringify(record);
      expect(persisted).not.toContain(dataDirectory);
      expect(persisted).not.toContain(BINARY as string);
      expect(persisted).toMatch(/promptfoo launcher sha256:[0-9a-f]{64}/);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 300_000);

  it("returns 24 failing assertions as available T3 evidence, through the adapter", async () => {
    // Replaces a test that ran the binary directly because the adapter threw
    // failing runs away: promptfoo 0.122.0 exits 100 when assertions fail. The
    // adapter now sets PROMPTFOO_PASS_RATE_THRESHOLD=0, so a COMPLETED
    // evaluation exits normally and its failures are evidence.
    //
    // It is also still the negative control: a type promptfoo silently ignored
    // would have passed here, so all 24 failing proves each is honoured.
    const { outcome, dataDirectory } = await collectLeavingDirectory(
      spec({ rows: rowsFrom(FAILS) }),
    );
    try {
      expect(outcome.errors).toEqual([]);
      expect(outcome.standing).toBe("available");
      if (!isAvailable(outcome)) return;
      expect(outcome.value.tier).toBe("T3");

      const record = outcome.value.record;
      if (record.kind !== "measured_evaluation") {
        throw new Error("expected a measured evaluation");
      }
      expect(record.value.metrics["cases_attempted"]).toBe(
        SUPPORTED_ASSERTION_TYPES.length,
      );
      expect(record.value.metrics["successes"]).toBe(0);
      expect(record.value.metrics["failures"]).toBe(
        SUPPORTED_ASSERTION_TYPES.length,
      );
      expect(record.value.metrics["errors"]).toBe(0);
      expect(record.caveats.join(" ")).toContain(
        `${SUPPORTED_ASSERTION_TYPES.length} case(s) failed`,
      );
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 300_000);

  it("counts a passing and a failing case correctly, through the adapter", async () => {
    // Error rows are NOT exercised here. The only locally reproducible way to
    // make promptfoo 0.122.0 record an error row under `echo` was an assertion
    // it cannot evaluate -- `{ type: "contains" }` with no value -- and that is
    // invalid configuration, which the spec now refuses, not evidence about a
    // candidate. `echo` never fails, and timeouts need a slower provider. Error
    // reconciliation is covered by faithful artifact fixtures instead, including
    // a genuine error row captured from a closed localhost endpoint.
    const { outcome, dataDirectory } = await collectLeavingDirectory(
      spec({
        rows: [
          {
            description: "passes",
            vars: { text: "hello" },
            assert: [{ type: "contains", value: "hello" }],
          },
          {
            description: "fails",
            vars: { text: "hello" },
            assert: [{ type: "contains", value: "zzz" }],
          },
        ],
      }),
    );
    try {
      expect(outcome.errors).toEqual([]);
      if (!isAvailable(outcome)) throw new Error("expected a result");
      expect(outcome.value.tier).toBe("T3");
      const record = outcome.value.record;
      if (record.kind !== "measured_evaluation") {
        throw new Error("expected a measured evaluation");
      }
      expect(record.value.metrics["successes"]).toBe(1);
      expect(record.value.metrics["failures"]).toBe(1);
      expect(record.value.metrics["errors"]).toBe(0);
      expect(record.value.metrics["pass_rate"]).toBeCloseTo(1 / 2);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 300_000);

  it.each([
    [
      "the reported constructor expression",
      '{{ range.constructor("return 6*7")() }}',
    ],
    [
      "the same expression without an asterisk",
      '{{ range.constructor("return 42")() }}',
    ],
    ["environment access", "cfg={{ env.PROMPTFOO_CONFIG_DIR }}"],
    [
      "environment constructor access",
      '{{ env.constructor.constructor("return 42")() }}',
    ],
  ])(
    "refuses %s before promptfoo spawns",
    async (_label, prompt) => {
      // Against 483d1cb the second of these rendered `42` inside promptfoo 0.122.0
      // and was returned as available T3 evidence. Refusal is at planning: no
      // version was probed and no command was built.
      const { outcome, dataDirectory } = await collectLeavingDirectory(
        spec({
          prompts: [prompt],
          rows: [
            { vars: { text: "x" }, assert: [{ type: "equals", value: "42" }] },
          ],
        }),
      );
      try {
        expect(outcome.standing).toBe("unknown");
        expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
        expect(outcome.errors[0]?.message).toContain("template");
        expect(outcome.adapter.version).toBeNull();
        expect(outcome.provenance.command_manifest).toBeNull();
        expect(await runDirectoriesIn(dataDirectory)).toEqual([]);
      } finally {
        await rm(dataDirectory, { recursive: true, force: true });
      }
    },
    300_000,
  );

  it("still substitutes variables named like Nunjucks globals and capitalised keywords", async () => {
    // Positive control for the keyword rule: these names ARE variables in
    // Nunjucks 3.2.4, and echo returns exactly the substituted prompt.
    const { outcome, dataDirectory } = await collectLeavingDirectory(
      spec({
        prompts: ["{{ ticket }}|{{ range }}|{{ env }}|{{ True }}|{{ None }}"],
        rows: [
          {
            vars: { ticket: "a", range: "b", env: "c", True: "d", None: "e" },
            assert: [{ type: "equals", value: "a|b|c|d|e" }],
          },
        ],
      }),
    );
    try {
      expect(outcome.errors).toEqual([]);
      if (!isAvailable(outcome)) throw new Error("expected a result");
      const record = outcome.value.record;
      if (record.kind !== "measured_evaluation") {
        throw new Error("expected a measured evaluation");
      }
      expect(record.value.metrics["successes"]).toBe(1);
      expect(record.value.metrics["failures"]).toBe(0);
      expect(record.value.metrics["errors"]).toBe(0);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 300_000);

  it.each(["true", "false", "none", "null", "not"])(
    "refuses {{ %s }} before promptfoo spawns, even with that variable defined",
    async (name) => {
      // Against dd5ecfc each of these ran: true/false/none/null rendered a
      // literal instead of the row value, and not threw inside promptfoo.
      const { outcome, dataDirectory } = await collectLeavingDirectory(
        spec({
          prompts: [`v={{ ${name} }}`],
          rows: [
            {
              vars: { [name]: "SENTINEL" },
              assert: [{ type: "equals", value: "v=SENTINEL" }],
            },
          ],
        }),
      );
      try {
        expect(outcome.standing).toBe("unknown");
        expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
        expect(outcome.errors[0]?.message).toContain(`"${name}"`);
        expect(outcome.adapter.version).toBeNull();
        expect(outcome.provenance.command_manifest).toBeNull();
        expect(await runDirectoriesIn(dataDirectory)).toEqual([]);
      } finally {
        await rm(dataDirectory, { recursive: true, force: true });
      }
    },
    300_000,
  );

  it("refuses a prompt promptfoo would read as a file, before running anything", async () => {
    // Against 591171a this prompt text was read as a path from outside the data
    // directory and returned as available T3 evidence.
    const { outcome, dataDirectory } = await collectLeavingDirectory(
      spec({
        prompts: ["../../../secret.txt"],
        rows: [{ vars: { text: "x" }, assert: [] }],
      }),
    );
    try {
      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
      expect(outcome.adapter.version).toBeNull();
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 300_000);

  it("produces rows times prompts cases, which is what the count rule assumes", async () => {
    // The reconciliation rule is `rows * prompts` for a single provider. That
    // is an assumption about promptfoo, so it is checked against promptfoo:
    // three rows and two prompts must be six cases, not three and not five.
    const threeRows = rowsFrom(HOLDS.slice(0, 3));
    const { outcome, dataDirectory } = await collectLeavingDirectory(
      spec({ rows: threeRows, prompts: ["{{text}}", "Echo: {{text}}"] }),
    );
    try {
      // The three cases used here are `contains`, `contains-all` and
      // `contains-any`, all of which still hold when the second prompt adds a
      // prefix, so the run passes and the count is what is under test.
      expect(outcome.errors).toEqual([]);
      if (!isAvailable(outcome)) throw new Error("expected a result");
      const record = outcome.value.record;
      if (record.kind !== "measured_evaluation") {
        throw new Error("expected a measured evaluation");
      }
      expect(record.value.metrics["cases_attempted"]).toBe(6);
      expect(record.value.metrics["successes"]).toBe(6);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 300_000);

  it("binds genuine rows with default assertions and mixed descriptions to the plan", async () => {
    // Row binding relies on two facts about real output: `testCase.assert` is
    // the default assertions FOLLOWED by the row's own, and a row without a
    // description exports none. Two prompts, three rows, one default assertion
    // and one undescribed row exercise both, through the adapter.
    const { outcome, dataDirectory } = await collectLeavingDirectory(
      spec({
        prompts: ["Classify: {{text}}", "Echo {{text}}"],
        defaultAssertions: [{ type: "icontains", value: "e" }],
        rows: [
          {
            description: "row zero",
            vars: { text: "billing question", n: 1 },
            assert: [{ type: "contains", value: "billing" }],
          },
          {
            vars: { text: "shipping question" },
            assert: [{ type: "contains", value: "refund" }],
          },
          { description: "row two", vars: { text: "returns" }, assert: [] },
        ],
      }),
    );
    try {
      expect(outcome.errors).toEqual([]);
      if (!isAvailable(outcome)) throw new Error("expected a result");
      const record = outcome.value.record;
      if (record.kind !== "measured_evaluation") {
        throw new Error("expected a measured evaluation");
      }
      expect(record.value.metrics["cases_attempted"]).toBe(6);
      expect(record.value.metrics["successes"]).toBe(4);
      expect(record.value.metrics["failures"]).toBe(2);
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 300_000);

  it("exercises every type in the allowlist, in both directions", () => {
    // The allowlist and the exercised set are the same set, so a type cannot be
    // added to the schema without also being run against the real binary.
    expect([...HOLDS.map((entry) => entry.type)].sort()).toEqual(
      [...SUPPORTED_ASSERTION_TYPES].sort(),
    );
    expect([...FAILS.map((entry) => entry.type)].sort()).toEqual(
      [...SUPPORTED_ASSERTION_TYPES].sort(),
    );
    expect(SUPPORTED_ASSERTION_TYPES.length).toBe(
      BASE_ASSERTION_TYPES.length * 2,
    );
  });

  it("moves exactly one identity component per change", () => {
    const base = planOf(spec()).identities;
    const otherPrompt = planOf(
      spec({ prompts: ["Different: {{text}}"] }),
    ).identities;
    const otherAssert = planOf(
      spec({
        rows: rowsFrom([{ ...HOLDS[0]!, value: "world" }, ...HOLDS.slice(1)]),
      }),
    ).identities;
    const otherRows = planOf(
      spec({
        rows: rowsFrom([
          { ...HOLDS[0]!, text: "hello there world" },
          ...HOLDS.slice(1),
        ]),
      }),
    ).identities;

    expect(otherPrompt.prompt_hash).not.toBe(base.prompt_hash);
    expect(otherPrompt.dataset_hash).toBe(base.dataset_hash);
    expect(otherPrompt.evaluator_hash).toBe(base.evaluator_hash);

    expect(otherAssert.evaluator_hash).not.toBe(base.evaluator_hash);
    expect(otherAssert.dataset_hash).toBe(base.dataset_hash);
    expect(otherAssert.prompt_hash).toBe(base.prompt_hash);

    expect(otherRows.dataset_hash).not.toBe(base.dataset_hash);
    expect(otherRows.prompt_hash).toBe(base.prompt_hash);
    expect(otherRows.evaluator_hash).toBe(base.evaluator_hash);

    // Every change moves the whole-config digest.
    expect(
      new Set([
        base.config_digest,
        otherPrompt.config_digest,
        otherAssert.config_digest,
        otherRows.config_digest,
      ]).size,
    ).toBe(4);
  });

  it("passes the generated config path, and no caller path", async () => {
    const { outcome, dataDirectory } = await collectLeavingDirectory(spec());
    try {
      if (!isAvailable(outcome)) throw new Error("expected a result");

      const args = outcome.value.annotations.command_manifest?.arguments ?? [];
      expect(args.slice(0, 2)).toEqual(["eval", "-c"]);
      const configArg = args[args.indexOf("-c") + 1] ?? "";

      // This states only what it observes: the path handed to the tool is the
      // generated one, relative to the run directory the tool runs in. It does
      // NOT claim the tool read nothing else -- nothing here monitors filesystem
      // reads, and asserting that would be asserting something untested.
      expect(configArg).toBe(join("snapshot", "promptfooconfig.json"));
      expect(args.some((entry) => entry.endsWith(".yaml"))).toBe(false);
      expect(
        outcome.value.annotations.command_manifest?.working_directory,
      ).toBe("<run-directory>");
      expect(outcome.value.annotations.command_manifest?.executable).toBe(
        "promptfoo",
      );
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 300_000);
});
