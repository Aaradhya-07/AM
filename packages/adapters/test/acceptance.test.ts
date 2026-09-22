/**
 * Milestone 2 final acceptance regressions.
 *
 * Each describe block below was written against 591171a and run there before
 * the corresponding fix. Tests that are deliberate guards -- behaviour that was
 * already correct and must stay correct -- say so in their name.
 */
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROMPTFOO_SPEC_VERSION,
  createPromptfooAdapter,
  deriveExpectedEvaluation,
  fixedClock,
  isAvailable,
  isEvaluationCurrentFor,
  planEvaluation,
  prepareEvaluation,
  validateEvaluationSpec,
  verifiedIdentityOf,
} from "../src/index.js";
import { FIXED_TIMES } from "./helpers.js";
import { artifactFor } from "./promptfoo-artifacts.js";
import type { SpecRow } from "./promptfoo-artifacts.js";
import { evaluationSpec } from "./promptfoo-inputs.js";

let workspace = "";

beforeEach(async () => {
  workspace = await realpath(
    await mkdtemp(join(tmpdir(), "anvilmark-accept-")),
  );
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

// --- evaluations and genuinely shaped artifacts ------------------------------

/** Two prompts times three rows, shaped like the genuine 0.122.0 run studied. */
function twoByThree(
  overrides: {
    readonly prompts?: readonly string[];
    readonly rows?: readonly SpecRow[];
  } = {},
) {
  return {
    spec_version: PROMPTFOO_SPEC_VERSION,
    workload_ref: "classification",
    candidate_ref: "candidate.local",
    dataset: {
      id: "dataset.classification",
      version: "v1",
      rows: overrides.rows ?? [
        {
          description: "row zero",
          vars: { ticket: "billing question", n: 1 },
          assert: [{ type: "contains", value: "billing" }],
        },
        {
          vars: { ticket: "shipping question" },
          assert: [{ type: "contains", value: "question" }],
        },
        { description: "row two", vars: { ticket: "returns" }, assert: [] },
      ],
    },
    prompts: overrides.prompts ?? ["Classify: {{ticket}}", "Echo {{ticket}}"],
    provider: { id: "echo" },
    default_assertions: [{ type: "icontains", value: "e" }],
  };
}

// --- a stand-in promptfoo -----------------------------------------------------

interface ProgramOptions {
  readonly version?: string;
  readonly body: unknown;
  /** Emulate the pinned exit rule, or force a code. */
  readonly exit?: "emulate" | number;
  /** Rewrite its own launcher file while evaluating. */
  readonly selfModify?: boolean;
}

/**
 * Records every invocation, its working directory and the environment it saw,
 * beside itself (outside the adapter's run directory). By default it emulates
 * promptfoo 0.122.0's exit rule (`src/node/doEval.ts:1204-1218`): exit 100
 * when the pass rate is below `PROMPTFOO_PASS_RATE_THRESHOLD` (default 100).
 */
async function installProgram(
  directory: string,
  options: ProgramOptions,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "body.json"),
    typeof options.body === "string"
      ? options.body
      : JSON.stringify(options.body),
    "utf8",
  );
  const exit = options.exit ?? "emulate";
  const script = join(directory, "fake-promptfoo");
  await writeFile(
    script,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'fs.appendFileSync(path.join(__dirname, "invocations.log"), argv[0] + "\\n");',
      'const names = ["HOME","TMPDIR","TMP","TEMP","XDG_CONFIG_HOME","XDG_CACHE_HOME","XDG_DATA_HOME","XDG_STATE_HOME","PROMPTFOO_PASS_RATE_THRESHOLD","PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS","PROMPTFOO_CONFIG_DIR"];',
      "const env = {}; for (const n of names) env[n] = process.env[n] ?? null;",
      "fs.writeFileSync(path.join(__dirname, `seen-${argv[0]}.json`), JSON.stringify({ cwd: process.cwd(), env }));",
      `if (argv.includes("--version")) { process.stdout.write(${JSON.stringify(options.version ?? "0.122.0")}); process.exit(0); }`,
      options.selfModify === true
        ? 'fs.appendFileSync(__filename, "\\n// rewritten during the run\\n");'
        : "",
      'const body = fs.readFileSync(path.join(__dirname, "body.json"), "utf8");',
      'const at = argv.indexOf("-o");',
      "fs.writeFileSync(argv[at + 1], body);",
      exit === "emulate"
        ? [
            "let code = 0;",
            "try {",
            "  const s = JSON.parse(body).results.stats;",
            "  const total = s.successes + s.failures + (s.errors ?? 0);",
            "  const rate = (s.successes / total) * 100;",
            '  const raw = Number.parseFloat(process.env.PROMPTFOO_PASS_RATE_THRESHOLD ?? "100");',
            "  const threshold = Number.isFinite(raw) ? raw : 100;",
            "  if (rate < threshold) code = 100;",
            "} catch { code = 0; }",
            "process.exit(code);",
          ].join("\n")
        : `process.exit(${exit});`,
    ].join("\n"),
    "utf8",
  );
  await chmod(script, 0o755);
  return script;
}

async function invocationsOf(directory: string): Promise<string[]> {
  try {
    return (await readFile(join(directory, "invocations.log"), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function seenOf(
  directory: string,
  invocation: "eval" | "--version",
): Promise<{ cwd: string; env: Record<string, string | null> }> {
  return JSON.parse(
    await readFile(join(directory, `seen-${invocation}.json`), "utf8"),
  ) as { cwd: string; env: Record<string, string | null> };
}

const ECHO = [
  { id: "echo", reach: "local", destination: "local", credentialEnvNames: [] },
] as const;

function adapterFor(program: string, extra: Record<string, unknown> = {}) {
  return createPromptfooAdapter({
    clock: fixedClock(...FIXED_TIMES),
    executable: program,
    providers: ECHO,
    readEnv: () => undefined,
    ...extra,
  } as never);
}

function requestFor(spec: unknown, extra: Record<string, unknown> = {}) {
  return {
    evidenceId: "evidence.eval",
    spec,
    dataDirectory: workspace,
    constraintRefs: ["quality.classification_f1"],
    ...extra,
  } as never;
}

const programDir = () => join(workspace, "program");
const dataDir = () => join(workspace, "data");

async function collect(
  spec: unknown,
  program: ProgramOptions,
  extra: {
    adapter?: Record<string, unknown>;
    request?: Record<string, unknown>;
  } = {},
) {
  const path = await installProgram(programDir(), program);
  await mkdir(dataDir(), { recursive: true });
  return adapterFor(path, extra.adapter).collect(
    requestFor(spec, { dataDirectory: dataDir(), ...extra.request }),
  );
}

// =============================================================================

describe("1. a completed evaluation with failures is still evidence", () => {
  it("keeps failures and errors as available T3 evidence", async () => {
    const spec = twoByThree();
    const outcome = await collect(spec, {
      body: artifactFor(spec, {
        outcome: (_p, t) =>
          t === 1 ? [false, 1] : t === 2 ? [false, 2] : [true, 0],
      }),
    });

    expect(outcome.errors).toEqual([]);
    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.value.tier).toBe("T3");
    const metrics = (
      outcome.value.record.value as { metrics: Record<string, number> }
    ).metrics;
    expect(metrics.successes).toBe(2);
    expect(metrics.failures).toBe(2);
    expect(metrics.errors).toBe(2);
  });

  it("runs promptfoo with an adapter-owned pass-rate threshold of zero", async () => {
    const spec = evaluationSpec();
    await collect(spec, { body: artifactFor(spec) });

    expect(
      (await seenOf(programDir(), "eval")).env.PROMPTFOO_PASS_RATE_THRESHOLD,
    ).toBe("0");
  });

  it("guard: still fails when promptfoo exits 100 despite that setting", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(spec, { body: artifactFor(spec), exit: 100 });

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("non_zero_exit");
  });

  it("guard: a fatal exit is not evidence even beside a valid artifact", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(spec, { body: artifactFor(spec), exit: 1 });

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("non_zero_exit");
  });
});

// =============================================================================

describe("2. every result row is bound to the requested evaluation", () => {
  // All cases pass, so the stand-in exits 0 both before and after the fix and
  // these tests isolate row binding from exit handling.
  type Artifact = ReturnType<typeof artifactFor>;
  type Row = Record<string, unknown> & {
    promptIdx: unknown;
    testIdx: unknown;
    prompt: Record<string, unknown>;
    vars: Record<string, unknown>;
    testCase: Record<string, unknown> & {
      vars: Record<string, unknown>;
      assert: Record<string, unknown>[];
    };
  };
  const rowAt = (artifact: Artifact, p: number, t: number) =>
    (artifact.results.results as Row[]).find(
      (row) => row.promptIdx === p && row.testIdx === t,
    )!;

  async function collectMutated(mutate: (artifact: Artifact) => void) {
    const spec = twoByThree();
    const artifact = artifactFor(spec);
    mutate(artifact);
    return collect(spec, { body: artifact });
  }

  it("guard: accepts rows that exactly describe the plan", async () => {
    const outcome = await collectMutated(() => undefined);
    expect(outcome.errors).toEqual([]);
    expect(outcome.standing).toBe("available");
  });

  it.each([
    [
      "a row naming the wrong prompt",
      (a: Artifact) => {
        rowAt(a, 1, 0).prompt.label = "Classify: {{ticket}}";
      },
      "identity_mismatch",
    ],
    [
      "a prompt list naming the wrong template",
      (a: Artifact) => {
        a.results.prompts[1]!.raw = "Something else {{ticket}}";
        a.results.prompts[1]!.label = "Something else {{ticket}}";
      },
      "identity_mismatch",
    ],
    [
      "wrong variables",
      (a: Artifact) => {
        rowAt(a, 0, 2).vars.ticket = "refunds";
        rowAt(a, 0, 2).testCase.vars.ticket = "refunds";
      },
      "identity_mismatch",
    ],
    [
      "wrong assertions",
      (a: Artifact) => {
        rowAt(a, 0, 1).testCase.assert[1]!.value = "billing";
      },
      "identity_mismatch",
    ],
    [
      "a dropped default assertion",
      (a: Artifact) => {
        rowAt(a, 1, 2).testCase.assert = [];
      },
      "identity_mismatch",
    ],
    [
      "a wrong description",
      (a: Artifact) => {
        rowAt(a, 0, 0).testCase.description = "row nine";
      },
      "identity_mismatch",
    ],
    [
      "a description on a row that has none",
      (a: Artifact) => {
        rowAt(a, 1, 1).testCase.description = "invented";
      },
      "identity_mismatch",
    ],
    [
      "an out-of-range prompt index",
      (a: Artifact) => {
        rowAt(a, 1, 2).promptIdx = 2;
      },
      "malformed_output",
    ],
    [
      "an out-of-range test index",
      (a: Artifact) => {
        rowAt(a, 1, 2).testIdx = 3;
      },
      "malformed_output",
    ],
    [
      "a negative index",
      (a: Artifact) => {
        rowAt(a, 0, 0).testIdx = -1;
      },
      "malformed_output",
    ],
    [
      "a fractional index",
      (a: Artifact) => {
        rowAt(a, 0, 0).promptIdx = 0.5;
      },
      "malformed_output",
    ],
    [
      "a missing index",
      (a: Artifact) => {
        delete rowAt(a, 0, 0).promptIdx;
      },
      "malformed_output",
    ],
    [
      "a duplicated pair",
      (a: Artifact) => {
        const row = rowAt(a, 1, 2);
        row.testIdx = 1;
      },
      "malformed_output",
    ],
    [
      "a missing per-row provider",
      (a: Artifact) => {
        delete rowAt(a, 0, 1).provider;
      },
      "malformed_output",
    ],
    [
      "a row with no test case",
      (a: Artifact) => {
        delete rowAt(a, 0, 1).testCase;
      },
      "malformed_output",
    ],
    [
      "a row with no prompt label",
      (a: Artifact) => {
        delete rowAt(a, 0, 1).prompt.label;
      },
      "malformed_output",
    ],
  ] as const)("refuses %s", async (_label, mutate, code) => {
    const outcome = await collectMutated(mutate);

    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe(code);
  });

  it("names the missing pair when a pair is replaced by a duplicate", async () => {
    const outcome = await collectMutated((a) => {
      const row = rowAt(a, 1, 2);
      row.promptIdx = 0;
      row.testIdx = 0;
    });

    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
    expect(outcome.errors[0]?.detail).toMatchObject({
      missing_pairs: [[1, 2]],
    });
  });

  it("refuses an artifact from another evaluation of the same size", async () => {
    const other = twoByThree({
      prompts: ["Summarise: {{ticket}}", "Route {{ticket}}"],
      rows: [
        { vars: { ticket: "a" }, assert: [] },
        { vars: { ticket: "b" }, assert: [] },
        { vars: { ticket: "c" }, assert: [] },
      ],
    });
    const outcome = await collect(twoByThree(), { body: artifactFor(other) });

    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe("identity_mismatch");
  });
});

// =============================================================================

describe("3. the promptfoo version boundary", () => {
  it("refuses an unverified version before evaluating", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(spec, {
      version: "0.118.4",
      body: artifactFor(spec, { version: null }),
    });

    expect(outcome.standing).toBe("unsupported");
    expect(outcome.errors[0]?.code).toBe("version_unsupported");
    expect(await invocationsOf(programDir())).toEqual(["--version"]);
  });

  it("refuses an artifact whose promptfooVersion is not the probed binary's", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(spec, {
      version: "0.122.0",
      body: artifactFor(spec, { version: "0.121.0" }),
    });

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("identity_mismatch");
  });

  it("guard: accepts a matching 0.122.0 artifact", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(spec, { body: artifactFor(spec) });

    expect(outcome.errors).toEqual([]);
    expect(outcome.adapter.version).toBe("0.122.0");
  });
});

// =============================================================================

describe("4. execution is isolated and the launcher is pinned", () => {
  it("runs promptfoo inside the run directory, not the repository", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(spec, { body: artifactFor(spec) });
    expect(outcome.errors).toEqual([]);

    const seen = await seenOf(programDir(), "eval");
    expect(seen.cwd).not.toBe(process.cwd());
    expect(seen.cwd.startsWith(join(dataDir(), "run-"))).toBe(true);
  });

  it("redirects home, XDG and temporary directories into the run directory", async () => {
    const spec = evaluationSpec();
    await collect(spec, { body: artifactFor(spec) });

    const { env, cwd } = await seenOf(programDir(), "eval");
    for (const name of [
      "HOME",
      "TMPDIR",
      "TMP",
      "TEMP",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
    ]) {
      expect(env[name], name).not.toBeNull();
      expect(env[name]!.startsWith(cwd), name).toBe(true);
    }
  });

  it("resolves the executable once, when the adapter is constructed", async () => {
    const trustedDir = join(workspace, "trusted");
    const rogueDir = join(workspace, "rogue");
    const spec = evaluationSpec();
    await installProgram(trustedDir, { body: artifactFor(spec) });
    await mkdir(rogueDir, { recursive: true });

    const adapter = createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: "fake-promptfoo",
      baseEnv: { PATH: `${rogueDir}:${trustedDir}:${process.env.PATH ?? ""}` },
      providers: ECHO,
      readEnv: () => undefined,
    } as never);

    // Earlier on PATH, installed only after construction.
    await installProgram(rogueDir, { body: artifactFor(spec) });
    await mkdir(dataDir(), { recursive: true });
    const outcome = await adapter.collect(
      requestFor(spec, { dataDirectory: dataDir() }),
    );

    expect(outcome.errors).toEqual([]);
    expect(await invocationsOf(rogueDir)).toEqual([]);
    expect(await invocationsOf(trustedDir)).toEqual(["--version", "eval"]);
  });

  it("refuses to run a launcher that changed after construction", async () => {
    const spec = evaluationSpec();
    const path = await installProgram(programDir(), {
      body: artifactFor(spec),
    });
    const adapter = adapterFor(path);

    await appendFile(path, "\n// replaced after the adapter was built\n");
    await mkdir(dataDir(), { recursive: true });
    const outcome = await adapter.collect(
      requestFor(spec, { dataDirectory: dataDir() }),
    );

    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe("executable_changed");
    expect(await invocationsOf(programDir())).toEqual([]);
  });

  it("refuses the result when the launcher changes during the run", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(spec, {
      body: artifactFor(spec),
      selfModify: true,
    });

    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe("executable_changed");
  });

  it("records the launcher digest in the evidence without a local path", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(spec, { body: artifactFor(spec) });
    if (!isAvailable(outcome)) {
      throw new Error(`expected a result: ${JSON.stringify(outcome.errors)}`);
    }

    const launcher = await readFile(join(programDir(), "fake-promptfoo"));
    const digest = `sha256:${createHash("sha256").update(launcher).digest("hex")}`;
    const record = JSON.stringify(outcome.value.record);

    expect(record).toContain(digest);
    for (const privatePath of [workspace, tmpdir(), process.cwd()]) {
      expect(record).not.toContain(privatePath);
    }

    const manifest = outcome.value.annotations.command_manifest;
    expect(manifest?.executable).toBe("promptfoo");
    expect(JSON.stringify(manifest)).not.toContain(workspace);
  });

  it("guard: an executable that cannot be resolved is an evidence gap, not a spawn", async () => {
    await mkdir(dataDir(), { recursive: true });
    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: "definitely-not-installed-promptfoo",
      baseEnv: { PATH: workspace },
      providers: ECHO,
    } as never).collect(
      requestFor(evaluationSpec(), { dataDirectory: dataDir() }),
    );

    expect(outcome.standing).toBe("unavailable");
    expect(outcome.errors[0]?.code).toBe("executable_not_found");
  });
});

// =============================================================================

describe("5. projection and evidence identity cover every identity input", () => {
  const REMOTE = {
    id: "example:model-a",
    reach: "remote",
    destination: "api.one.example",
    credentialEnvNames: ["EXAMPLE_API_KEY", "SECOND_TOKEN"],
  } as const;

  const remoteSpec = (
    overrides: {
      config?: Record<string, unknown>;
      description?: string;
      credentials?: string[];
    } = {},
  ) => {
    const base = evaluationSpec({
      provider: REMOTE.id,
      providerConfig: overrides.config ?? {},
      credentialEnvNames: overrides.credentials ?? [],
    }) as { dataset: { rows: Record<string, unknown>[] } };
    if (overrides.description !== undefined) {
      base.dataset.rows[0]!.description = overrides.description;
    }
    return base;
  };

  function digestOf(
    spec: unknown,
    registration: Record<string, unknown> = REMOTE,
  ) {
    const prepared = prepareEvaluation(spec, {
      providers: [registration],
    } as never);
    if ("reasons" in prepared) throw new Error(prepared.reasons.join("; "));
    return prepared.projection.projection_digest;
  }

  it.each([
    ["temperature", remoteSpec({ config: { temperature: 0.9 } })],
    ["max_tokens", remoteSpec({ config: { max_tokens: 64 } })],
    ["stop", remoteSpec({ config: { stop: ["END"] } })],
    ["a row description", remoteSpec({ description: "a described row" })],
  ])("changes the projection digest when %s changes", (_label, changed) => {
    expect(digestOf(changed)).not.toBe(digestOf(remoteSpec()));
  });

  it("guard: changes the projection digest when the credential-name set changes", () => {
    expect(digestOf(remoteSpec({ credentials: ["EXAMPLE_API_KEY"] }))).not.toBe(
      digestOf(remoteSpec()),
    );
  });

  it("guard: changes the projection digest when the destination changes", () => {
    expect(
      digestOf(remoteSpec(), { ...REMOTE, destination: "api.two.example" }),
    ).not.toBe(digestOf(remoteSpec()));
  });

  it("guard: changes the projection digest when the reach changes", () => {
    const local = {
      id: REMOTE.id,
      reach: "local",
      destination: "local",
      credentialEnvNames: [],
    };
    expect(digestOf(remoteSpec(), local)).not.toBe(digestOf(remoteSpec()));
  });

  it.each([
    [
      "temperature",
      { config: { temperature: 0.1 } },
      { config: { temperature: 0.9 } },
    ],
    [
      "max_tokens",
      { config: { max_tokens: 64 } },
      { config: { max_tokens: 4096 } },
    ],
    ["stop", { config: { stop: ["END"] } }, { config: { stop: ["STOP"] } }],
    [
      "a row description",
      { description: "approved" },
      { description: "changed" },
    ],
  ] as const)(
    "invalidates an authorization when %s changes",
    async (_label, approved, executed) => {
      const outcome = await createPromptfooAdapter({
        clock: fixedClock(...FIXED_TIMES),
        executable: join(workspace, "missing-binary"),
        providers: [REMOTE],
      } as never).collect(
        requestFor(remoteSpec(executed as never), {
          authorization: {
            provider_id: REMOTE.id,
            projection_digest: digestOf(remoteSpec(approved as never)),
            authorized_at: FIXED_TIMES[0],
          },
        }),
      );

      expect(outcome.errors[0]?.code).toBe("authorization_required");
      expect(outcome.errors[0]?.detail).toMatchObject({
        reason: "projection_mismatch",
      });
    },
  );

  it("derives a different expected evaluation for a different endpoint", () => {
    const spec = remoteSpec();
    const one = deriveExpectedEvaluation(spec, {
      providers: [REMOTE],
    } as never);
    const two = deriveExpectedEvaluation(spec, {
      providers: [{ ...REMOTE, destination: "api.two.example" }],
    } as never);
    if (!("expected_evaluation" in one) || !("expected_evaluation" in two)) {
      throw new Error("expected both to derive");
    }

    expect(one.expected_evaluation.configuration_hash).not.toBe(
      two.expected_evaluation.configuration_hash,
    );
  });

  it("does not treat evidence from endpoint A as current for endpoint B", async () => {
    const spec = remoteSpec();
    const outcome = await collect(
      spec,
      { body: artifactFor(spec) },
      {
        adapter: { providers: [REMOTE] },
        request: {
          authorization: {
            provider_id: REMOTE.id,
            projection_digest: digestOf(spec),
            authorized_at: FIXED_TIMES[0],
          },
        },
      },
    );
    if (!isAvailable(outcome)) {
      throw new Error(`expected a result: ${JSON.stringify(outcome.errors)}`);
    }
    const planned = planEvaluation(spec);
    if (!("plan" in planned)) throw new Error("expected a plan");

    const endpointA = verifiedIdentityOf(planned.plan, REMOTE as never);
    const endpointB = verifiedIdentityOf(planned.plan, {
      ...REMOTE,
      destination: "api.two.example",
    } as never);

    expect(isEvaluationCurrentFor(outcome.value.record, endpointA)).toBe(true);
    expect(isEvaluationCurrentFor(outcome.value.record, endpointB)).toBe(false);
    expect(outcome.value.record.caveats.join(" ")).toContain("api.one.example");
  });
});

// =============================================================================

describe("6. resource limits are trusted policy", () => {
  const LIMIT_FIELDS = [
    "timeoutMs",
    "maxOutputBytes",
    "maxArtifactBytes",
  ] as const;

  it.each(
    LIMIT_FIELDS.flatMap((field) =>
      (
        [
          ["NaN", Number.NaN],
          ["Infinity", Number.POSITIVE_INFINITY],
          ["negative", -1],
          ["zero", 0],
          ["fractional", 1.5],
          ["a string", "1000"],
        ] as const
      ).map(([label, value]) => [field, label, value] as const),
    ),
  )(
    "refuses a request %s of %s before any subprocess",
    async (field, _label, value) => {
      const spec = evaluationSpec();
      const outcome = await collect(
        spec,
        { body: artifactFor(spec) },
        { request: { [field]: value } },
      );

      expect(outcome.standing).toBe("failed");
      expect(outcome.errors[0]?.code).toBe("invalid_resource_limit");
      expect(await invocationsOf(programDir())).toEqual([]);
    },
  );

  it.each(LIMIT_FIELDS)(
    "refuses a request %s above the construction-time ceiling",
    async (field) => {
      const spec = evaluationSpec();
      const outcome = await collect(
        spec,
        { body: artifactFor(spec) },
        {
          adapter: { limits: { [field]: 10_000 } },
          request: { [field]: 20_000 },
        },
      );

      expect(outcome.standing).toBe("failed");
      expect(outcome.errors[0]?.code).toBe("invalid_resource_limit");
      expect(await invocationsOf(programDir())).toEqual([]);
    },
  );

  it("guard: accepts a request limit below the ceiling", async () => {
    const spec = evaluationSpec();
    const outcome = await collect(
      spec,
      { body: artifactFor(spec) },
      {
        adapter: { limits: { timeoutMs: 60_000 } },
        request: { timeoutMs: 30_000 },
      },
    );

    expect(outcome.errors).toEqual([]);
    expect(outcome.standing).toBe("available");
  });

  it.each([
    ["a NaN ceiling", { timeoutMs: Number.NaN }],
    ["a zero ceiling", { maxOutputBytes: 0 }],
    ["a ceiling above the documented bound", { maxArtifactBytes: 1024 ** 4 }],
    ["an unknown limit", { maxEverything: 1 }],
  ])("fails closed on %s before any subprocess", async (_label, limits) => {
    const spec = evaluationSpec();
    const path = await installProgram(programDir(), {
      body: artifactFor(spec),
    });
    const adapter = adapterFor(path, { limits });
    await mkdir(dataDir(), { recursive: true });

    const collected = await adapter.collect(
      requestFor(spec, { dataDirectory: dataDir() }),
    );
    const probed = await adapter.probe();

    expect(collected.errors[0]?.code).toBe("invalid_adapter_policy");
    expect(probed.errors[0]?.code).toBe("invalid_adapter_policy");
    expect(await invocationsOf(programDir())).toEqual([]);
  });
});

// =============================================================================

describe("found in this pass: template and prompt-file inputs", () => {
  /**
   * promptfoo 0.122.0 treats a single-line prompt as a FILE PATH when the
   * pinned `maybeFilePath` (src/prompts/utils.ts:11-36) says so. Against
   * 591171a, the prompt text "../../../secret.txt" was read from outside the
   * data directory and returned as available T3 evidence.
   */
  it.each([
    "../../../secret.txt",
    "notes.md",
    "see a/b",
    "back\\slash",
    "glob*",
    "what is 3.14",
    "file.js:fn",
  ])(
    "refuses the prompt %j, which promptfoo would read as a path",
    (prompt) => {
      const result = validateEvaluationSpec({
        ...(evaluationSpec() as object),
        prompts: [prompt],
      });
      expect("reasons" in result).toBe(true);
    },
  );

  /**
   * Prompts naming a prompt-management service are FETCHED over the network
   * when rendered (src/evaluatorHelpers.ts:424-485), so what is sent is not
   * what the projection hashed. Reproduced against 591171a by script: all three
   * were accepted by the spec.
   */
  it.each(["portkey://pp-123", "langfuse://my-prompt:1", "helicone://id"])(
    "refuses the remote prompt reference %j",
    (prompt) => {
      const result = validateEvaluationSpec({
        ...(evaluationSpec() as object),
        prompts: [prompt],
      });
      expect("reasons" in result).toBe(true);
    },
  );

  it.each(["Classify the ticket: {{ticket}}", "Line one\nsee a/b and 3.14"])(
    "guard: accepts the prompt %j",
    (prompt) => {
      const result = validateEvaluationSpec({
        ...(evaluationSpec() as object),
        prompts: [prompt],
      });
      expect("spec" in result).toBe(true);
    },
  );

  /**
   * Nunjucks statements can load templates from the working directory: against
   * 591171a, `{% include 'package.json' %}` put the repository's package.json
   * into a prompt and was accepted as evidence.
   */
  it.each([
    ["a prompt", { prompts: ["{% include 'package.json' %}\nend"] }],
    [
      "a variable",
      {
        dataset: {
          id: "d",
          version: "1",
          rows: [{ vars: { t: "{% include 'x' %}" }, assert: [] }],
        },
      },
    ],
    [
      "an assertion value",
      {
        default_assertions: [
          { type: "contains", value: "{% import 'x' as y %}" },
        ],
      },
    ],
    [
      "a row description",
      {
        dataset: {
          id: "d",
          version: "1",
          rows: [
            { description: "{% extends 'x' %}", vars: { t: "a" }, assert: [] },
          ],
        },
      },
    ],
  ])("refuses a Nunjucks statement in %s", (_label, change) => {
    const result = validateEvaluationSpec({
      ...(evaluationSpec() as object),
      ...change,
    });
    expect("reasons" in result).toBe(true);
  });

  /**
   * Found while checking row binding against real output: promptfoo 0.122.0
   * EXPORTS a JSON-valued string compactly (src/util/sanitizer.ts:750-775)
   * while SENDING it unchanged, so its artifact cannot show which form ran.
   * Not a 591171a defect -- 591171a did not compare variables at all.
   */
  it.each([
    [
      "a variable",
      {
        dataset: {
          id: "d",
          version: "1",
          rows: [{ vars: { t: '{"ok": true}' }, assert: [] }],
        },
      },
    ],
    [
      "an assertion value",
      { default_assertions: [{ type: "equals", value: "[1, 2]" }] },
    ],
    [
      "a row description",
      {
        dataset: {
          id: "d",
          version: "1",
          rows: [{ description: ' {"a":1}', vars: { t: "a" }, assert: [] }],
        },
      },
    ],
  ])(
    "refuses spaced JSON in %s, which the export would rewrite",
    (_label, change) => {
      const result = validateEvaluationSpec({
        ...(evaluationSpec() as object),
        ...change,
      });
      expect("reasons" in result).toBe(true);
      if (!("reasons" in result)) return;
      expect(result.reasons.join(" ")).toContain("rewrites when it exports");
    },
  );

  it("guard: accepts compact JSON and JSON scalars", () => {
    const result = validateEvaluationSpec({
      ...(evaluationSpec() as object),
      dataset: {
        id: "d",
        version: "1",
        rows: [
          {
            // `ticket` because the default prompt references it, and every
            // referenced variable must exist in every row.
            vars: {
              ticket: "x",
              a: '{"ok":true}',
              b: "[1,2]",
              c: "42",
              d: "true",
            },
            assert: [],
          },
        ],
      },
    });
    expect("spec" in result).toBe(true);
  });

  it("runs promptfoo with process environment hidden from templates", async () => {
    const spec = evaluationSpec();
    await collect(spec, { body: artifactFor(spec) });

    expect(
      (await seenOf(programDir(), "eval")).env
        .PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS,
    ).toBe("1");
  });
});
