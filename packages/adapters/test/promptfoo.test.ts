import {
  chmod,
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
  createPromptfooAdapter,
  fixedClock,
  isAvailable,
  isEvaluationCurrentFor,
  promptfooEnvironment,
  verifiedIdentityOf,
} from "../src/index.js";
import { FIXED_TIMES, NODE, nodeScript } from "./helpers.js";
import {
  TEST_PROVIDERS,
  echoAllowing,
  evaluationSpec,
  planFor,
  specIdentity,
} from "./promptfoo-inputs.js";

/**
 * Fixtures reproduce the documented `promptfoo eval -o <file>.json` envelope.
 * See `test/fixtures/PROVENANCE.md` for upstream URLs and retrieval date.
 */
const NESTED = new URL(
  "./fixtures/promptfoo-eval-output.json",
  import.meta.url,
);
const MULTI = new URL(
  "./fixtures/promptfoo-eval-output-multi-provider.json",
  import.meta.url,
);
/** A real two-case run: one assertion holds, one fails. */
const TWO_CASES = new URL(
  "./fixtures/promptfoo-eval-output-two-cases.json",
  import.meta.url,
);

let SPEC: Record<string, unknown> = evaluationSpec();

let dataDirectory = "";
let toolPath = "";

/**
 * A stand-in tool that behaves like the real one: an executable that reads
 * `-o` out of its own argv and writes the artifact there. Nothing is assumed
 * about stdout, which promptfoo uses for human-readable progress.
 *
 * Installing it as a real executable also exercises PATH-based resolution,
 * since the shebang needs `env` and `node` to be findable.
 */
async function installFakeTool(body: string): Promise<string> {
  const script = join(dataDirectory, "fake-promptfoo");
  await writeFile(join(dataDirectory, "body.json"), body, "utf8");
  await writeFile(
    script,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      // A real CLI answers --version; the probe runs this same binary.
      'if (argv.includes("--version")) { process.stdout.write("0.122.0"); process.exit(0); }',
      'const at = argv.indexOf("-o");',
      'if (at === -1) { process.stderr.write("no -o"); process.exit(2); }',
      'const body = fs.readFileSync(path.join(__dirname, "body.json"), "utf8");',
      'if (body !== "__SKIP__") { fs.writeFileSync(argv[at + 1], body); }',
      'process.stdout.write("Evaluation complete.\\n");',
    ].join("\n"),
    "utf8",
  );
  await chmod(script, 0o755);
  return script;
}

async function bodyOf(fixture: URL): Promise<string> {
  return readFile(fixture, "utf8");
}

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "anvilmark-promptfoo-"));
  toolPath = await installFakeTool(await bodyOf(NESTED));
  SPEC = evaluationSpec();
});

afterEach(async () => {
  await rm(dataDirectory, { recursive: true, force: true });
});

/**
 * The program, its environment and credential lookup are construction-time
 * choices. A request cannot carry them.
 */
function adapter(overrides: Record<string, unknown> = {}) {
  return createPromptfooAdapter({
    clock: fixedClock(...FIXED_TIMES),
    executable: toolPath,
    providers: TEST_PROVIDERS,
    readEnv: () => undefined,
    ...overrides,
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: "evidence.eval.classification",
    spec: SPEC,
    dataDirectory,
    constraintRefs: ["quality.classification_f1"],
    metricUnits: { token_usage_total: "tokens" },
    ...overrides,
  };
}

describe("the optional evaluation adapter", () => {
  it("parses the documented output-file envelope", async () => {
    const outcome = await adapter().collect(request());

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.value.record.kind).toBe("measured_evaluation");
    expect(outcome.value.tier).toBe("T3");

    const value = outcome.value.record.value as {
      metrics: Record<string, number>;
      configuration_hash: string;
      identity: Record<string, string | null>;
      result_artifact_hash: string;
    };
    // Documented counts, mapped without changing their meaning.
    expect(value.metrics.successes).toBe(1);
    expect(value.metrics.failures).toBe(0);
    expect(value.metrics.errors).toBe(0);
    expect(value.metrics.pass_rate).toBeCloseTo(1);
    expect(value.metrics.prompt_score).toBe(1);
    // `echo` is local and consumes no tokens, so the real artifact reports 0.
    expect(value.metrics.token_usage_total).toBe(0);
    expect(value.metrics.cases_attempted).toBe(1);
  });

  it("refuses an artifact naming two providers", async () => {
    await installFakeTool(await bodyOf(MULTI));
    const outcome = await adapter().collect(request());

    // An aggregate over two providers is not a measurement of one candidate.
    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("ambiguous_attribution");
  });

  it("takes the version from the probe, not from the artifact", async () => {
    const outcome = await adapter().collect(request());

    if (!isAvailable(outcome)) throw new Error("expected a result");
    // The version comes from --version, and the artifact's own promptfooVersion must agree with it.
    expect(outcome.adapter.version).toBe("0.122.0");
    expect(outcome.value.record.producer.version).toBe("0.122.0");
  });

  it("refuses to run when the tool will not identify itself", async () => {
    const outcome = await adapter({
      executable: NODE,
      versionArgs: nodeScript('process.stdout.write("")'),
    }).collect(request());

    expect(outcome.standing).toBe("unsupported");
    expect(outcome.errors[0]?.code).toBe("version_unavailable");
  });

  it("writes its artifact inside a run directory beneath the data directory", async () => {
    const outcome = await adapter().collect(
      request({ outputFileName: "custom-eval.json" }),
    );
    if (!isAvailable(outcome)) throw new Error("expected a result");

    // promptfoo runs INSIDE the run directory, so the artifact is named
    // relative to it and the manifest carries no machine path. That the working
    // directory really is a run directory beneath the data directory is shown
    // by a program that records its cwd, in acceptance.test.ts.
    const manifest = outcome.value.annotations.command_manifest;
    const args = manifest?.arguments ?? [];
    expect(args[args.indexOf("-o") + 1]).toBe("custom-eval.json");
    expect(manifest?.working_directory).toBe("<run-directory>");
    // The run directory is removed afterwards; nothing is left behind.
    const { readdir } = await import("node:fs/promises");
    expect(
      (await readdir(await realpath(dataDirectory))).filter((name) =>
        name.startsWith("run-"),
      ),
    ).toEqual([]);
  });

  it("hashes the actual artifact bytes", async () => {
    const outcome = await adapter().collect(request());
    if (!isAvailable(outcome)) throw new Error("expected a result");

    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update(await bodyOf(NESTED), "utf8")
      .digest("hex");

    const value = outcome.value.record.value as {
      result_artifact_hash: string;
    };
    expect(value.result_artifact_hash).toBe(expected);
    expect(outcome.provenance.raw_result_hash).toBe(expected);
  });

  it("preserves every identity individually in the contract record", async () => {
    const outcome = await adapter().collect(request());
    if (!isAvailable(outcome)) throw new Error("expected a result");

    const value = outcome.value.record.value as {
      configuration_hash: string;
      identity: Record<string, string | null>;
      dataset_ref: string;
      dataset_version: string;
    };
    // Not hidden in an adapter annotation that vanishes on attach.
    expect(value.identity).toMatchObject({
      workload_ref: "classification",
      // Derived by the adapter from the files, not taken on trust.
      dataset_hash: specIdentity().dataset_hash,
      prompt_hash: specIdentity().prompt_hash,
      evaluator_hash: specIdentity().evaluator_hash,
      model_configuration_hash: specIdentity().model_configuration_hash,
      provider_id: "echo",
    });
    expect(value.identity.config_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(value.dataset_ref).toBe("dataset.classification");
    expect(value.dataset_version).toBe("v1");
    expect(value.configuration_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("isolates its runtime inside the run directory and disables network features", () => {
    const env = promptfooEnvironment("/tmp/anvilmark-run");

    for (const name of [
      "PROMPTFOO_CONFIG_DIR",
      "PROMPTFOO_CACHE_PATH",
      "HOME",
      "TMPDIR",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
    ]) {
      expect(env[name]?.startsWith("/tmp/anvilmark-run/"), name).toBe(true);
    }
    expect(env.PROMPTFOO_DISABLE_TELEMETRY).toBe("1");
    expect(env.PROMPTFOO_DISABLE_SHARING).toBe("1");
    expect(env.PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS).toBe("1");
    expect(env.PROMPTFOO_PASS_RATE_THRESHOLD).toBe("0");
  });

  it("builds the supported invocation itself", async () => {
    const outcome = await adapter().collect(request());
    if (!isAvailable(outcome)) throw new Error("expected a result");

    const args = outcome.value.annotations.command_manifest?.arguments ?? [];
    expect(args).toContain("eval");
    expect(args).toContain("-c");
    expect(args).toContain("-o");
    expect(args).toContain("--no-share");
    expect(args).toContain("--no-progress-bar");
    expect(args).toContain("--no-table");
  });

  it("stops when a requested credential is absent", async () => {
    const outcome = await adapter({
      providers: echoAllowing(["MISSING_KEY"]),
    }).collect(
      request({
        spec: evaluationSpec({ credentialEnvNames: ["MISSING_KEY"] }),
      }),
    );

    // Running without it would silently evaluate something else.
    expect(outcome.standing).toBe("unavailable");
    expect(outcome.errors[0]?.detail).toMatchObject({
      missing_credential_names: ["MISSING_KEY"],
    });
  });

  it("passes a present credential by reference and never records its value", async () => {
    const outcome = await adapter({
      providers: echoAllowing(["EXAMPLE_API_KEY"]),
      readEnv: (name: string) =>
        name === "EXAMPLE_API_KEY"
          ? "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD"
          : undefined,
    }).collect(
      request({
        spec: evaluationSpec({ credentialEnvNames: ["EXAMPLE_API_KEY"] }),
      }),
    );

    expect(outcome.standing).toBe("available");
    expect(JSON.stringify(outcome)).not.toContain("sk-abcdefghij");
    if (!isAvailable(outcome)) return;
    expect(
      outcome.value.annotations.command_manifest?.environment_names,
    ).toContain("EXAMPLE_API_KEY");
  });

  it("stops being evidence when any identity-defining input changes", async () => {
    const outcome = await adapter().collect(request());
    if (!isAvailable(outcome)) throw new Error("expected a result");
    const record = outcome.value.record;

    const verified = verifiedIdentityOf(planFor(), TEST_PROVIDERS[0]!);
    expect(isEvaluationCurrentFor(record, verified)).toBe(true);

    const changed = `sha256:${"f".repeat(64)}`;
    for (const identity of [
      { ...verified, dataset_version: "v2" },
      { ...verified, dataset_hash: changed },
      { ...verified, prompt_hash: changed },
      { ...verified, evaluator_hash: changed },
      { ...verified, model_configuration_hash: changed },
      { ...verified, config_digest: changed },
      { ...verified, provider_id: "example:model-b" },
      { ...verified, candidate_ref: "candidate.remote" },
      { ...verified, workload_ref: "extraction" },
      { ...verified, provider_reach: "remote" as const },
      { ...verified, destination_identity: "api.example.com" },
    ]) {
      expect(isEvaluationCurrentFor(record, identity)).toBe(false);
    }
  });

  it("records failures and errors from the run as caveats", async () => {
    // A real two-row run: one assertion holds, one fails. The spec and the
    // artifact describe the same two cases.
    await installFakeTool(await bodyOf(TWO_CASES));
    const outcome = await adapter().collect(
      request({ spec: evaluationSpec({ secondRow: true }) }),
    );
    if (!isAvailable(outcome)) throw new Error("expected a result");

    expect(outcome.value.record.caveats.join(" ")).toContain(
      "1 case(s) failed",
    );
  });

  it("rejects an artifact that is not the documented envelope", async () => {
    await installFakeTool('{"ok":true}');
    const outcome = await adapter().collect(request());

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
  });

  it("rejects non-numeric metrics", async () => {
    await installFakeTool(
      JSON.stringify({
        results: { stats: { successes: "many", failures: 0 } },
      }),
    );
    const outcome = await adapter().collect(request());

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
  });

  it("fails when the tool exits cleanly but writes no artifact", async () => {
    await installFakeTool("__SKIP__");
    const outcome = await adapter().collect(request());

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
    expect(outcome.errors[0]?.message).toContain("no result artifact");
  });

  it("reports a missing tool as an evidence gap", async () => {
    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: "promptfoo-not-installed",
      providers: TEST_PROVIDERS,
    }).collect(request());

    expect(outcome.standing).toBe("unavailable");
    expect(outcome.errors[0]?.code).toBe("executable_not_found");
  });

  it("says results do not transfer to a different configuration", async () => {
    const outcome = await adapter().collect(request());
    if (!isAvailable(outcome)) throw new Error("expected a result");

    expect(outcome.value.annotations.exclusions.join(" ")).toContain(
      "do not transfer",
    );
  });
});
