/**
 * Trust-boundary regressions.
 *
 * Every test here was written against 37f26ff and FAILED there before the fix
 * it guards was made. The caller that supplies an evaluation is not trusted to
 * choose the program that measures it, the environment that program sees, the
 * credentials it may read, or the clock policy that decides whether a remote
 * run was authorized.
 */
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  classifyCaseRow,
  createPromptfooAdapter,
  fixedClock,
  isAvailable,
  prepareEvaluation,
  reconcileCaseOutcomes,
} from "../src/index.js";
import { FIXED_TIMES } from "./helpers.js";
import { artifactFor } from "./promptfoo-artifacts.js";
import { evaluationSpec } from "./promptfoo-inputs.js";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "anvilmark-trust-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** A one-case, genuinely shaped artifact for the default one-row echo spec. */
const ONE_CASE_BODY = JSON.stringify(artifactFor(evaluationSpec()));

/**
 * Install a stand-in program that records EVERY invocation -- including
 * `--version` -- and the environment it saw, in files beside itself. Those
 * files are outside the adapter's run directory, so the adapter cannot clean
 * them up, and a test can tell afterwards exactly which program ran.
 */
async function installProgram(
  directory: string,
  options: { readonly version: string; readonly body: string },
): Promise<string> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "body.json"), options.body, "utf8");
  const script = join(directory, "fake-promptfoo");
  await writeFile(
    script,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      'fs.appendFileSync(path.join(__dirname, "invocations.log"), argv[0] + "\\n");',
      'fs.writeFileSync(path.join(__dirname, "seen-env.json"), JSON.stringify({',
      "  HOME: process.env.HOME ?? null,",
      "  EXAMPLE_API_KEY: process.env.EXAMPLE_API_KEY ?? null,",
      "  NODE_OPTIONS: process.env.NODE_OPTIONS ?? null,",
      "}));",
      `if (argv.includes("--version")) { process.stdout.write(${JSON.stringify(options.version)}); process.exit(0); }`,
      'const at = argv.indexOf("-o");',
      'fs.writeFileSync(argv[at + 1], fs.readFileSync(path.join(__dirname, "body.json"), "utf8"));',
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

async function seenEnvOf(
  directory: string,
): Promise<Record<string, string | null>> {
  return JSON.parse(
    await readFile(join(directory, "seen-env.json"), "utf8"),
  ) as Record<string, string | null>;
}

const ECHO_LOCAL = {
  id: "echo",
  reach: "local",
  destination: "local",
  credentialEnvNames: [],
} as const;

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: "evidence.eval",
    spec: evaluationSpec(),
    dataDirectory: workspace,
    constraintRefs: ["quality.classification_f1"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("1. the request cannot choose the program or its environment", () => {
  it("refuses a request that names its own executable, and runs neither program", async () => {
    const trusted = await installProgram(join(workspace, "trusted"), {
      version: "0.122.0",
      body: ONE_CASE_BODY,
    });
    const rogue = await installProgram(join(workspace, "rogue"), {
      version: "6.6.6",
      body: ONE_CASE_BODY,
    });

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: trusted,
      providers: [ECHO_LOCAL],
    }).collect(baseRequest({ executable: rogue }) as never);

    // A fake binary emitting a fabricated artifact would otherwise become T3
    // evidence. The caller that supplies the evaluation may not pick the
    // program that measures it.
    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe("unsupported_argument");
    expect(await invocationsOf(join(workspace, "rogue"))).toEqual([]);
    expect(await invocationsOf(join(workspace, "trusted"))).toEqual([]);
  });

  it("refuses a request that carries its own environment lookup", async () => {
    await installProgram(join(workspace, "trusted"), {
      version: "0.122.0",
      body: ONE_CASE_BODY,
    });

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "trusted", "fake-promptfoo"),
      providers: [{ ...ECHO_LOCAL, credentialEnvNames: ["EXAMPLE_API_KEY"] }],
      readEnv: () => undefined,
    }).collect(
      baseRequest({
        spec: evaluationSpec({ credentialEnvNames: ["EXAMPLE_API_KEY"] }),
        readEnv: () => "sk-injectedinjectedinjectedinjected0000",
      }) as never,
    );

    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe("unsupported_argument");
    expect(await invocationsOf(join(workspace, "trusted"))).toEqual([]);
  });

  it("refuses a request that carries its own base environment", async () => {
    await installProgram(join(workspace, "trusted"), {
      version: "0.122.0",
      body: ONE_CASE_BODY,
    });

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "trusted", "fake-promptfoo"),
      providers: [ECHO_LOCAL],
    }).collect(
      baseRequest({
        baseEnv: { PATH: join(workspace, "rogue"), HOME: "/rogue-home" },
      }) as never,
    );

    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe("unsupported_argument");
    expect(await invocationsOf(join(workspace, "trusted"))).toEqual([]);
  });

  it("resolves a bare executable name through the construction-time environment only", async () => {
    // On 37f26ff the probe resolved a bare name through the ambient PATH while
    // the evaluation resolved it through the request's `baseEnv`, so evidence
    // could record the probed program's version while another program produced
    // the result (reproduced separately against the unfixed build). This guards
    // the fix: one construction-time environment resolves both invocations.
    await installProgram(join(workspace, "trusted"), {
      version: "0.122.0",
      body: ONE_CASE_BODY,
    });
    await installProgram(join(workspace, "rogue"), {
      version: "6.6.6",
      body: ONE_CASE_BODY,
    });

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: "fake-promptfoo",
      baseEnv: {
        PATH: `${join(workspace, "trusted")}:${process.env.PATH ?? ""}`,
        HOME: "/trusted-home",
      },
      providers: [ECHO_LOCAL],
    }).collect(baseRequest());

    expect(outcome.errors).toEqual([]);
    expect(outcome.standing).toBe("available");
    expect(outcome.adapter.version).toBe("0.122.0");
    expect(await invocationsOf(join(workspace, "trusted"))).toEqual([
      "--version",
      "eval",
    ]);
    expect(await invocationsOf(join(workspace, "rogue"))).toEqual([]);
    // HOME is no longer passed through at all: promptfoo gets a home inside
    // its own run directory, whatever the construction-time environment says.
    const seenHome = (await seenEnvOf(join(workspace, "trusted"))).HOME;
    expect(seenHome).not.toBe("/trusted-home");
    expect(seenHome).toContain("runtime");
  });

  it("probes the construction-time executable even if probe is handed another", async () => {
    await installProgram(join(workspace, "trusted"), {
      version: "0.122.0",
      body: ONE_CASE_BODY,
    });
    const rogue = await installProgram(join(workspace, "rogue"), {
      version: "6.6.6",
      body: ONE_CASE_BODY,
    });

    const probed = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "trusted", "fake-promptfoo"),
      providers: [ECHO_LOCAL],
    }).probe({ executable: rogue } as never);

    expect(isAvailable(probed) ? probed.value.version : null).toBe("0.122.0");
    expect(await invocationsOf(join(workspace, "rogue"))).toEqual([]);
  });

  it("reads credentials through the construction-time lookup, and only that", async () => {
    await installProgram(join(workspace, "trusted"), {
      version: "0.122.0",
      body: ONE_CASE_BODY,
    });
    const value = "sk-trustedtrustedtrustedtrusted00000000";

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "trusted", "fake-promptfoo"),
      providers: [{ ...ECHO_LOCAL, credentialEnvNames: ["EXAMPLE_API_KEY"] }],
      readEnv: (name: string) =>
        name === "EXAMPLE_API_KEY" ? value : undefined,
    }).collect(
      baseRequest({
        spec: evaluationSpec({ credentialEnvNames: ["EXAMPLE_API_KEY"] }),
      }),
    );

    expect(outcome.standing).toBe("available");
    expect((await seenEnvOf(join(workspace, "trusted"))).EXAMPLE_API_KEY).toBe(
      value,
    );
    expect(JSON.stringify(outcome)).not.toContain(value);
  });
});

// ---------------------------------------------------------------------------

describe("2. credential names are owned by trusted provider policy", () => {
  function recordingEnv() {
    const read: string[] = [];
    return {
      read,
      lookup: (name: string) => {
        read.push(name);
        return "some-value-that-must-never-be-read";
      },
    };
  }

  it.each([
    "PATH",
    "HOME",
    "NODE_OPTIONS",
    "OPENAI_BASE_URL",
    "HTTP_PROXY",
    "HTTPS_PROXY",
  ])(
    "refuses %s when policy does not allow it, before probing or reading",
    async (name) => {
      await installProgram(join(workspace, "trusted"), {
        version: "0.122.0",
        body: ONE_CASE_BODY,
      });
      const env = recordingEnv();

      const outcome = await createPromptfooAdapter({
        clock: fixedClock(...FIXED_TIMES),
        executable: join(workspace, "trusted", "fake-promptfoo"),
        providers: [{ ...ECHO_LOCAL, credentialEnvNames: ["EXAMPLE_API_KEY"] }],
        readEnv: env.lookup,
      }).collect(
        baseRequest({ spec: evaluationSpec({ credentialEnvNames: [name] }) }),
      );

      expect(outcome.standing).not.toBe("available");
      expect(outcome.errors[0]?.code).toBe("credential_not_permitted");
      expect(env.read).toEqual([]);
      expect(await invocationsOf(join(workspace, "trusted"))).toEqual([]);
    },
  );

  it.each([
    "PATH",
    "HOME",
    "NODE_OPTIONS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "https_proxy",
  ])(
    "refuses to let provider policy allow %s, which controls execution or destination",
    async (name) => {
      const outcome = await createPromptfooAdapter({
        clock: fixedClock(...FIXED_TIMES),
        executable: join(workspace, "missing"),
        providers: [{ ...ECHO_LOCAL, credentialEnvNames: [name] }],
      }).collect(baseRequest());

      expect(outcome.standing).toBe("failed");
      expect(outcome.errors[0]?.code).toBe("invalid_adapter_policy");
    },
  );

  it("refuses a spec that names the same credential twice in different case", async () => {
    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "missing"),
      providers: [{ ...ECHO_LOCAL, credentialEnvNames: ["EXAMPLE_API_KEY"] }],
    }).collect(
      baseRequest({
        spec: evaluationSpec({
          credentialEnvNames: ["EXAMPLE_API_KEY", "example_api_key"],
        }),
      }),
    );

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
    expect(outcome.errors[0]?.message).toContain("more than once");
  });

  it("refuses provider policy that lists the same name twice in different case", async () => {
    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "missing"),
      providers: [
        {
          ...ECHO_LOCAL,
          credentialEnvNames: ["EXAMPLE_API_KEY", "Example_Api_Key"],
        },
      ],
    }).collect(baseRequest());

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("invalid_adapter_policy");
  });

  it("matches a spec credential to policy exactly, so the forwarded spelling is policy's", async () => {
    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "missing"),
      providers: [{ ...ECHO_LOCAL, credentialEnvNames: ["EXAMPLE_API_KEY"] }],
    }).collect(
      baseRequest({
        spec: evaluationSpec({ credentialEnvNames: ["example_api_key"] }),
      }),
    );

    expect(outcome.errors[0]?.code).toBe("credential_not_permitted");
  });

  it("requires a stable destination identity for every registration", async () => {
    for (const registration of [
      { id: "echo", reach: "local", credentialEnvNames: [] },
      {
        id: "echo",
        reach: "local",
        destination: "api.example.com",
        credentialEnvNames: [],
      },
      {
        id: "example:model-a",
        reach: "remote",
        destination: "local",
        credentialEnvNames: [],
      },
      {
        id: "example:model-a",
        reach: "remote",
        destination: "https://api.example.com",
        credentialEnvNames: [],
      },
      {
        id: "example:model-a",
        reach: "remote",
        destination: "user@api.example.com",
        credentialEnvNames: [],
      },
      {
        id: "example:model-a",
        reach: "remote",
        destination: "api.example.com/v1",
        credentialEnvNames: [],
      },
    ]) {
      const outcome = await createPromptfooAdapter({
        clock: fixedClock(...FIXED_TIMES),
        executable: join(workspace, "missing"),
        providers: [registration as never],
      }).collect(baseRequest());

      expect(outcome.errors[0]?.code, JSON.stringify(registration)).toBe(
        "invalid_adapter_policy",
      );
    }
  });

  it("binds the destination identity into the projection digest", () => {
    const spec = evaluationSpec({ provider: "example:model-a" });
    const one = prepareEvaluation(spec, {
      providers: [
        {
          id: "example:model-a",
          reach: "remote",
          destination: "api.one.example",
          credentialEnvNames: [],
        },
      ],
    } as never);
    const two = prepareEvaluation(spec, {
      providers: [
        {
          id: "example:model-a",
          reach: "remote",
          destination: "api.two.example",
          credentialEnvNames: [],
        },
      ],
    } as never);
    if ("reasons" in one || "reasons" in two) throw new Error("expected both");

    expect(
      (one.projection as unknown as { destination_identity: string })
        .destination_identity,
    ).toBe("api.one.example");
    expect(one.projection.projection_digest).not.toBe(
      two.projection.projection_digest,
    );
  });

  it("binds the credential-name set into the projection digest", () => {
    const registration = {
      id: "example:model-a",
      reach: "remote",
      destination: "api.example.com",
      credentialEnvNames: ["EXAMPLE_API_KEY", "SECOND_TOKEN"],
    };
    const withOne = prepareEvaluation(
      evaluationSpec({
        provider: "example:model-a",
        credentialEnvNames: ["EXAMPLE_API_KEY"],
      }),
      { providers: [registration] } as never,
    );
    const withTwo = prepareEvaluation(
      evaluationSpec({
        provider: "example:model-a",
        credentialEnvNames: ["EXAMPLE_API_KEY", "SECOND_TOKEN"],
      }),
      { providers: [registration] } as never,
    );
    if ("reasons" in withOne || "reasons" in withTwo)
      throw new Error("expected both");

    expect(withOne.projection.content_digest).toBe(
      withTwo.projection.content_digest,
    );
    expect(withOne.projection.projection_digest).not.toBe(
      withTwo.projection.projection_digest,
    );
  });
});

// ---------------------------------------------------------------------------

describe("3. per-case outcomes must reconcile with the summary", () => {
  const REMOVE = Symbol("remove");

  /**
   * A faithful one-case artifact for the default spec, with the summary
   * replaced and the single row's OUTCOME fields overridden. Every other field
   * still restates the plan, so a refusal here is about outcomes, not about a
   * row that fails to bind.
   */
  function artifact(
    stats: { successes: number; failures: number; errors: number },
    row: Record<string, unknown> | undefined,
  ) {
    const built = artifactFor(evaluationSpec()) as {
      results: Record<string, unknown> & {
        results?: Record<string, unknown>[];
      };
    };
    built.results.stats = stats;
    if (row === undefined) {
      delete built.results.results;
    } else {
      const target = built.results.results![0]!;
      for (const [key, value] of Object.entries(row)) {
        if (value === REMOVE) delete target[key];
        else target[key] = value;
      }
    }
    return JSON.stringify(built);
  }

  async function collectWith(body: string, spec = evaluationSpec()) {
    await installProgram(join(workspace, "trusted"), {
      version: "0.122.0",
      body,
    });
    return createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "trusted", "fake-promptfoo"),
      providers: [ECHO_LOCAL],
    }).collect(baseRequest({ spec }));
  }

  const outcomeOf = (success: unknown, failureReason: unknown) => ({
    success,
    failureReason,
  });

  it.each([
    [
      "stats say success, the only row says it failed",
      { successes: 1, failures: 0, errors: 0 },
      outcomeOf(false, 1),
      "do not reconcile with the summary",
    ],
    [
      "stats say error, the row is an assertion failure",
      { successes: 0, failures: 0, errors: 1 },
      outcomeOf(false, 1),
      "do not reconcile with the summary",
    ],
    [
      "stats say failure, the row is an error",
      { successes: 0, failures: 1, errors: 0 },
      outcomeOf(false, 2),
      "do not reconcile with the summary",
    ],
    [
      "a row passes while naming an error reason",
      { successes: 1, failures: 0, errors: 0 },
      outcomeOf(true, 2),
      "contradicts itself",
    ],
    [
      "a row passes while naming an assertion reason",
      { successes: 1, failures: 0, errors: 0 },
      outcomeOf(true, 1),
      "contradicts itself",
    ],
    [
      "a row with no success flag",
      { successes: 1, failures: 0, errors: 0 },
      { success: REMOVE, failureReason: 0 },
      "no boolean `success`",
    ],
    [
      "a row with no failure reason",
      { successes: 1, failures: 0, errors: 0 },
      { success: true, failureReason: REMOVE },
      "no recognised `failureReason`",
    ],
    [
      "a row with an unknown failure reason",
      { successes: 0, failures: 1, errors: 0 },
      outcomeOf(false, 7),
      "no recognised `failureReason`",
    ],
    [
      "a success flag that is not a boolean",
      { successes: 1, failures: 0, errors: 0 },
      outcomeOf("true", 0),
      "no boolean `success`",
    ],
    [
      "no per-case rows at all",
      { successes: 1, failures: 0, errors: 0 },
      undefined,
      "no per-case results",
    ],
  ] as const)(
    "refuses an artifact where %s",
    async (_label, stats, row, reason) => {
      const outcome = await collectWith(
        artifact(stats, row as Record<string, unknown> | undefined),
      );

      expect(outcome.standing).not.toBe("available");
      expect(outcome.errors[0]?.code).toBe("malformed_output");
      expect(outcome.errors[0]?.message).toContain(reason);
    },
  );

  /**
   * Genuine promptfoo 0.122.0 output, committed as fixtures (machine paths
   * normalised; outcome fields untouched -- see fixtures/PROVENANCE.md). The
   * stand-in program replays the bytes, so the adapter reconciles exactly what
   * the real tool wrote.
   */
  const genuine = (name: string) =>
    readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

  it("reconciles genuine output with one passing and one failing assertion", async () => {
    const outcome = await collectWith(
      await genuine("promptfoo-eval-output-two-cases.json"),
      evaluationSpec({ secondRow: true }),
    );

    expect(outcome.errors).toEqual([]);
    if (!isAvailable(outcome)) throw new Error("expected a result");
    const value = outcome.value.record.value as {
      metrics: Record<string, number>;
    };
    expect(value.metrics.successes).toBe(1);
    expect(value.metrics.failures).toBe(1);
    expect(value.metrics.errors).toBe(0);
  });

  it("refuses the same genuine output with one row's outcome flipped", async () => {
    const tampered = JSON.parse(
      await genuine("promptfoo-eval-output-two-cases.json"),
    ) as {
      results: { results: { success: boolean; failureReason: number }[] };
    };
    // The failing row now claims to pass; the summary still says 1 and 1.
    tampered.results.results[1]!.success = true;
    tampered.results.results[1]!.failureReason = 0;

    const outcome = await collectWith(
      JSON.stringify(tampered),
      evaluationSpec({ secondRow: true }),
    );

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
    expect(outcome.errors[0]?.detail).toMatchObject({
      rows: { successes: 2, failures: 0, errors: 0 },
      stats: { successes: 1, failures: 1, errors: 0 },
    });
  });

  describe("a genuine error row", () => {
    // Captured from promptfoo 0.122.0 calling its `http` provider against a
    // closed LOCALHOST port: nothing left the machine. The row is
    // `success: false, failureReason: 2` and the summary counts one error.
    type Artifact = {
      results: {
        stats: { successes: number; failures: number; errors: number };
        results: {
          provider: unknown;
          success: unknown;
          failureReason: unknown;
        }[];
      };
    };
    const load = async () =>
      JSON.parse(
        await genuine("promptfoo-eval-output-error-row.json"),
      ) as Artifact;
    const statsOf = (artifact: Artifact) => ({
      successes: artifact.results.stats.successes,
      failures: artifact.results.stats.failures,
      errors: artifact.results.stats.errors,
    });

    it("reconciles as one error, not a failure", async () => {
      const artifact = await load();
      const row = artifact.results.results[0]!;

      expect(classifyCaseRow(row)).toEqual({ counted: "errors" });
      expect(
        reconcileCaseOutcomes(
          artifact.results.results,
          statsOf(artifact),
          "http://127.0.0.1:9/",
        ),
      ).toBeNull();
    });

    it("is refused when the row is relabelled as an assertion failure", async () => {
      const artifact = await load();
      artifact.results.results[0]!.failureReason = 1;

      const problem = reconcileCaseOutcomes(
        artifact.results.results,
        statsOf(artifact),
        "http://127.0.0.1:9/",
      );
      expect(problem?.code).toBe("malformed_output");
      expect(problem?.detail).toMatchObject({
        rows: { successes: 0, failures: 1, errors: 0 },
        stats: { successes: 0, failures: 0, errors: 1 },
      });
    });

    it("never becomes evidence, because promptfoo attributes it to a URL", async () => {
      // Real output names this provider `http://127.0.0.1:9/`, not `http`. A
      // URL is not a well-formed provider id, so no registration can match it
      // and the run is refused at attribution -- for the honest reason, before
      // its counts are even considered.
      await installProgram(join(workspace, "trusted"), {
        version: "0.122.0",
        body: await genuine("promptfoo-eval-output-error-row.json"),
      });
      const HTTP = {
        id: "http",
        reach: "remote",
        destination: "127.0.0.1:9",
        credentialEnvNames: [],
      } as const;
      const spec = evaluationSpec({ provider: "http" });
      const prepared = prepareEvaluation(spec, { providers: [HTTP] });
      if ("reasons" in prepared) throw new Error(prepared.reasons.join("; "));

      const outcome = await createPromptfooAdapter({
        clock: fixedClock(...FIXED_TIMES),
        executable: join(workspace, "trusted", "fake-promptfoo"),
        providers: [HTTP],
      }).collect(
        baseRequest({
          spec,
          authorization: {
            provider_id: "http",
            projection_digest: prepared.projection.projection_digest,
            authorized_at: FIXED_TIMES[0],
          },
        }),
      );

      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.code).toBe("ambiguous_attribution");
    });
  });

  it("classifies by failureReason, never by the presence of an error message", async () => {
    // At the pinned source an empty response sets `error = "No output"` but
    // leaves failureReason NONE, and trackRowStats counts it as a FAILURE.
    // Treating any row with an error string as an error would miscount it.
    const outcome = await collectWith(
      artifact(
        { successes: 0, failures: 1, errors: 0 },
        { ...outcomeOf(false, 0), error: "No output" },
      ),
    );

    expect(outcome.errors).toEqual([]);
    expect(outcome.standing).toBe("available");
  });
});

// ---------------------------------------------------------------------------

describe("4. authorization time policy", () => {
  const NOW = "2026-08-20T12:00:00.000Z";
  const REMOTE = {
    id: "example:model-a",
    reach: "remote",
    destination: "api.example.com",
    credentialEnvNames: [],
  } as const;
  const remoteSpec = () => evaluationSpec({ provider: "example:model-a" });

  function digestFor() {
    const prepared = prepareEvaluation(remoteSpec(), {
      providers: [REMOTE],
    } as never);
    if ("reasons" in prepared) throw new Error(prepared.reasons.join("; "));
    return prepared.projection.projection_digest;
  }

  async function collectAt(
    authorizedAt: string,
    policy: Record<string, unknown> = {},
  ) {
    return createPromptfooAdapter({
      clock: fixedClock(NOW),
      executable: join(workspace, "missing-binary"),
      providers: [REMOTE],
      ...policy,
    }).collect(
      baseRequest({
        spec: remoteSpec(),
        authorization: {
          provider_id: REMOTE.id,
          projection_digest: digestFor(),
          authorized_at: authorizedAt,
        },
      }),
    );
  }

  it("refuses an authorization dated 30 minutes in the future under the default policy", async () => {
    const outcome = await collectAt("2026-08-20T12:30:00.000Z");

    expect(outcome.errors[0]?.code).toBe("authorization_required");
    expect(outcome.errors[0]?.detail).toMatchObject({ reason: "future_dated" });
  });

  it("refuses an authorization dated one second in the future with zero skew", async () => {
    const outcome = await collectAt("2026-08-20T12:00:01.000Z");

    expect(outcome.errors[0]?.detail).toMatchObject({ reason: "future_dated" });
  });

  it("accepts a future authorization inside an explicit skew allowance", async () => {
    const outcome = await collectAt("2026-08-20T12:00:30.000Z", {
      authorizationClockSkewMs: 60_000,
    });

    // Past the gate: it now fails for the honest reason that the binary does
    // not exist, not for authorization.
    expect(outcome.errors[0]?.code).not.toBe("authorization_required");
  });

  it("refuses a future authorization beyond the skew allowance even when max age is large", async () => {
    const outcome = await collectAt("2026-08-20T12:02:00.000Z", {
      authorizationClockSkewMs: 60_000,
      authorizationMaxAgeMs: 86_400_000,
    });

    expect(outcome.errors[0]?.detail).toMatchObject({ reason: "future_dated" });
  });

  it.each([
    ["a NaN max age", { authorizationMaxAgeMs: Number.NaN }],
    ["a negative max age", { authorizationMaxAgeMs: -1 }],
    [
      "an infinite max age",
      { authorizationMaxAgeMs: Number.POSITIVE_INFINITY },
    ],
    ["a NaN skew", { authorizationClockSkewMs: Number.NaN }],
    ["a negative skew", { authorizationClockSkewMs: -1 }],
    [
      "an infinite skew",
      { authorizationClockSkewMs: Number.POSITIVE_INFINITY },
    ],
    ["a string max age", { authorizationMaxAgeMs: "3600000" }],
  ])(
    "fails closed on %s before any subprocess starts",
    async (_label, policy) => {
      await installProgram(join(workspace, "trusted"), {
        version: "0.122.0",
        body: ONE_CASE_BODY,
      });
      const adapter = createPromptfooAdapter({
        clock: fixedClock(NOW),
        executable: join(workspace, "trusted", "fake-promptfoo"),
        providers: [ECHO_LOCAL],
        ...policy,
      } as never);

      // A LOCAL provider: policy validity does not depend on reach.
      const collected = await adapter.collect(baseRequest());
      const probed = await adapter.probe();

      expect(collected.standing).toBe("failed");
      expect(collected.errors[0]?.code).toBe("invalid_adapter_policy");
      expect(probed.standing).toBe("failed");
      expect(probed.errors[0]?.code).toBe("invalid_adapter_policy");
      expect(await invocationsOf(join(workspace, "trusted"))).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------

describe("committed fixtures carry no machine identity", () => {
  it("contains no absolute local paths", async () => {
    const directory = new URL("./fixtures/", import.meta.url);
    const offending: string[] = [];
    for (const name of await readdir(directory)) {
      if (!name.endsWith(".json")) continue;
      const text = await readFile(new URL(name, directory), "utf8");
      for (const pattern of [
        /\/Users\/[^"\s]+/,
        /\/home\/[^"\s]+/,
        /\/private\/(?:var|tmp)\/[^"\s]+/,
        /\/var\/folders\/[^"\s]+/,
        /[A-Za-z]:\\\\Users\\\\[^"\s]+/,
      ]) {
        const match = pattern.exec(text);
        if (match !== null) offending.push(`${name}: ${match[0].slice(0, 60)}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
