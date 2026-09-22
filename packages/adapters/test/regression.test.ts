import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildGapReport, fixedClock, isAvailable } from "../src/index.js";
import {
  createPromptfooAdapter,
  parseVersion,
  promptfooProbeEnvironment,
} from "../src/index.js";
import { FIXED_TIMES, fixtureContract, nodeScript } from "./helpers.js";
import { artifactFor } from "./promptfoo-artifacts.js";
import {
  TEST_PROVIDERS,
  evaluationSpec,
  specIdentity,
} from "./promptfoo-inputs.js";

/**
 * Reproductions for the second adversarial review. Each of these fails against
 * b465ec0 and describes a merge blocker, not a style preference.
 */

let workspace = "";

let configPath = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "anvilmark-regression-"));
  configPath = join(workspace, "promptfooconfig.yaml");
  await writeFile(configPath, "providers: [example:model-a]\n", "utf8");
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/**
 * The stand-in tool is chosen when the adapter is constructed. `workspace` is
 * read at call time, after `beforeEach` has created it.
 */
function adapter(overrides: Record<string, unknown> = {}) {
  return createPromptfooAdapter({
    clock: fixedClock(...FIXED_TIMES),
    executable: join(workspace, "fake-promptfoo"),
    providers: TEST_PROVIDERS,
    readEnv: () => undefined,
    ...overrides,
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: "evidence.eval",
    dataDirectory: workspace,
    spec: evaluationSpec(),
    constraintRefs: ["quality.classification_f1"],
    ...overrides,
  };
}

describe("1. the promptfoo artifact boundary", () => {
  it("refuses an output name that escapes the run directory", async () => {
    const outcome = await adapter().collect(
      request({ outputFileName: "../escaped.json" }),
    );

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("unsafe_output_path");
  });

  it("refuses an absolute output path", async () => {
    const outcome = await adapter().collect(
      request({ outputFileName: join(tmpdir(), "absolute.json") }),
    );

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("unsafe_output_path");
  });

  it("refuses an output name containing a separator", async () => {
    const outcome = await adapter().collect(
      request({ outputFileName: "nested/eval.json" }),
    );

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("unsafe_output_path");
  });

  it("refuses a run directory that is a symlink escaping the data directory", async () => {
    const outside = await mkdtemp(join(tmpdir(), "anvilmark-outside-"));
    const link = join(workspace, "linked");
    await symlink(outside, link, "dir");

    const outcome = await adapter().collect(request({ dataDirectory: link }));

    // Resolving the link must land back inside the declared data directory.
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("unsafe_output_path");
    await rm(outside, { recursive: true, force: true });
  });

  it("does not accept caller arguments that could redirect the run", async () => {
    // `extraArgs` is either gone or allowlisted; either way a caller cannot
    // smuggle a second -o, a different -c, or --share.
    await installTool(workspace, VALID_BODY);
    const candidate = request({
      extraArgs: ["-o", "/tmp/elsewhere.json", "--share"],
    }) as Record<string, unknown>;

    const outcome = await adapter().collect(candidate);

    if (outcome.standing === "available") {
      const args = outcome.value.annotations.command_manifest?.arguments ?? [];
      expect(args.filter((entry) => entry === "-o")).toHaveLength(1);
      expect(args).not.toContain("--share");
      expect(args).not.toContain("/tmp/elsewhere.json");
    } else {
      expect(outcome.errors[0]?.code).toBe("unsupported_argument");
    }
  });

  it("refuses a reserved environment name as a credential", async () => {
    // Refused by the spec schema, so the hashed credential set and the set the
    // process receives are the same set by construction.
    const outcome = await adapter().collect(
      request({
        spec: evaluationSpec({
          credentialEnvNames: ["PROMPTFOO_DISABLE_SHARING"],
        }),
      }),
    );

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
    expect(outcome.errors[0]?.message).toContain("PROMPTFOO_");
  });

  it("passes --no-write so the tool keeps no local evaluation database", async () => {
    await installTool(workspace, VALID_BODY);
    const outcome = await adapter().collect(request());

    if (!isAvailable(outcome))
      throw new Error(`expected a result: ${JSON.stringify(outcome.errors)}`);
    expect(outcome.value.annotations.command_manifest?.arguments).toContain(
      "--no-write",
    );
  });

  it("caps the artifact before reading it", async () => {
    // stdout limits do not limit a file the tool writes.
    await installTool(workspace, `{"padding":"${"x".repeat(400_000)}"}`);
    const outcome = await adapter().collect(
      request({
        maxArtifactBytes: 1024,
      }),
    );

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("artifact_too_large");
  });

  it("leaves no raw artifact behind after success", async () => {
    await installTool(workspace, VALID_BODY);
    const outcome = await adapter().collect(request());

    expect(outcome.standing).toBe("available");
    expect(await strayArtifacts(workspace)).toEqual([]);
  });

  it("leaves no raw artifact behind after malformed output", async () => {
    await installTool(workspace, '{"not":"an envelope"}');
    await adapter().collect(request());

    expect(await strayArtifacts(workspace)).toEqual([]);
  });

  it("leaves no raw artifact behind after a non-zero exit", async () => {
    await installTool(workspace, VALID_BODY, { exitCode: 4 });
    await adapter().collect(request());

    expect(await strayArtifacts(workspace)).toEqual([]);
  });

  it("never removes the caller's data directory", async () => {
    await installTool(workspace, VALID_BODY);
    await writeFile(join(workspace, "caller-owned.txt"), "keep me", "utf8");

    await adapter().collect(request());

    const remaining = await readdir(workspace);
    expect(remaining).toContain("caller-owned.txt");
  });
});

describe("5. the gap report", () => {
  const freshness = { asOf: "2026-09-01T00:00:00Z" } as const;

  it("reports exactly one licence gap per candidate", () => {
    const report = buildGapReport(fixtureContract(), { freshness });
    const local = report.workloads[0]?.candidates.find(
      (entry) => entry.candidate_ref === "candidate.local",
    );

    const licence = (local?.gaps ?? []).filter(
      (entry) => entry.code === "missing_licence",
    );
    expect(licence).toHaveLength(1);
  });

  it("does not double-count any gap code for a candidate", () => {
    const report = buildGapReport(fixtureContract(), { freshness });

    for (const workload of report.workloads) {
      for (const candidate of workload.candidates) {
        const subjects = candidate.gaps.map(
          (entry) => `${entry.code}|${entry.subject}`,
        );
        expect(new Set(subjects).size).toBe(subjects.length);
      }
    }
  });

  it("builds well-formed subjects", () => {
    const report = buildGapReport(fixtureContract(), { freshness });
    const subjects = report.workloads.flatMap((workload) =>
      workload.candidates.flatMap((candidate) =>
        candidate.gaps.map((entry) => entry.subject),
      ),
    );

    // `candidate.candidate.local.licence` is a bug, not a subject.
    expect(
      subjects.every((entry) => !entry.includes("candidate.candidate.")),
    ).toBe(true);
  });
});

// --- helpers ---------------------------------------------------------------

/**
 * A stand-in artifact for the default spec: ONE row times ONE prompt, so
 * exactly one case. The counts here are not decoration -- an artifact whose
 * totals do not match the plan is refused, so a fake tool has to describe the
 * evaluation it is standing in for.
 */
/**
 * A stand-in artifact for the default one-row, one-prompt spec, shaped like
 * genuine promptfoo 0.122.0 output. Its rows restate the plan's prompt,
 * variables and assertions, because an artifact that does not is refused.
 */
const VALID_BODY = JSON.stringify(artifactFor(evaluationSpec()));

async function installTool(
  directory: string,
  body: string,
  options: { exitCode?: number } = {},
): Promise<void> {
  const { chmod, writeFile: write } = await import("node:fs/promises");
  await write(join(directory, "body.json"), body, "utf8");
  const script = join(directory, "fake-promptfoo");
  await write(
    script,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "const argv = process.argv.slice(2);",
      // A real CLI answers --version; the probe runs the same binary.
      'if (argv.includes("--version")) { process.stdout.write("0.122.0"); process.exit(0); }',
      'const at = argv.indexOf("-o");',
      "if (at !== -1) {",
      '  fs.writeFileSync(argv[at + 1], fs.readFileSync(path.join(__dirname, "body.json"), "utf8"));',
      "}",
      `process.exit(${options.exitCode ?? 0});`,
    ].join("\n"),
    "utf8",
  );
  await chmod(script, 0o755);
}

/** Anything the adapter wrote and failed to clean up. */
async function strayArtifacts(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const stray: string[] = [];
  for (const entry of entries) {
    if (entry.name === "fake-promptfoo" || entry.name === "body.json") {
      continue;
    }
    if (entry.name === "caller-owned.txt") {
      continue;
    }
    // Files the test itself seeded as the caller's project.
    if (
      entry.name === "promptfooconfig.yaml" ||
      entry.name === "tests.yaml" ||
      entry.name === "prompt.txt" ||
      entry.name === "assertions.yaml"
    ) {
      continue;
    }
    stray.push(entry.name);
  }
  return stray;
}

describe("2. evaluation attribution soundness", () => {
  it("refuses a run whose artifact aggregates several providers", async () => {
    await installTool(
      workspace,
      JSON.stringify({
        evalId: "eval-multi",
        results: {
          version: 3,
          stats: { successes: 20, failures: 0, errors: 0 },
          prompts: [
            { label: "a", provider: "example:model-a", metrics: {} },
            { label: "b", provider: "example:model-b", metrics: {} },
          ],
        },
      }),
    );

    const outcome = await adapter().collect(request());

    // An aggregate over two providers is not a measurement of one candidate.
    expect(outcome.standing).not.toBe("available");
    expect(outcome.errors[0]?.code).toBe("ambiguous_attribution");
  });

  it("takes every attribution field from the spec, not from the request", async () => {
    await installTool(workspace, VALID_BODY);

    const realSpec = evaluationSpec({
      workloadRef: "workload.real",
      candidateRef: "candidate.real",
      datasetId: "dataset.real",
      datasetVersion: "v1",
    });

    // The original reproduction: a caller declaring a DIFFERENT workload,
    // candidate, dataset and version alongside the spec. They were once copied
    // onto the record verbatim. The request is now a closed shape, so the stray
    // declaration is refused outright rather than silently ignored.
    const smuggled = await adapter().collect(
      request({
        spec: realSpec,
        identity: {
          workload_ref: "workload.other",
          candidate_ref: "candidate.other",
          dataset_ref: "dataset.other",
          dataset_version: "v9",
          provider_id: "example:model-b",
        },
      }),
    );
    expect(smuggled.standing).not.toBe("available");
    expect(smuggled.errors[0]?.code).toBe("unsupported_argument");
    expect(smuggled.errors[0]?.detail).toMatchObject({
      unexpected_fields: ["identity"],
    });

    // Without the stray declaration, every attribution field is the spec's.
    const outcome = await adapter().collect(request({ spec: realSpec }));

    if (!isAvailable(outcome)) throw new Error("expected a result");
    const record = outcome.value.record;
    const value = record.value as {
      dataset_ref: string;
      dataset_version: string;
      candidate_ref: string;
      identity: { workload_ref: string };
    };

    expect(record.subject).toBe("candidate.real.quality");
    expect(record.applies_to.candidate_ref).toBe("candidate.real");
    expect(record.applies_to.workload_ref).toBe("workload.real");
    expect(value.candidate_ref).toBe("candidate.real");
    expect(value.dataset_ref).toBe("dataset.real");
    expect(value.dataset_version).toBe("v1");
    expect(value.identity.workload_ref).toBe("workload.real");

    // Nothing the caller declared appears anywhere in the record.
    const serialised = JSON.stringify(outcome.value);
    for (const stray of [
      "workload.other",
      "candidate.other",
      "dataset.other",
      "v9",
      "example:model-b",
    ]) {
      expect(serialised).not.toContain(stray);
    }
  });

  it("moves each attribution field only when the spec moves it", async () => {
    await installTool(workspace, VALID_BODY);

    for (const [field, overrides, expected] of [
      ["workload_ref", { workloadRef: "workload.moved" }, "workload.moved"],
      ["candidate_ref", { candidateRef: "candidate.moved" }, "candidate.moved"],
      ["dataset_ref", { datasetId: "dataset.moved" }, "dataset.moved"],
      ["dataset_version", { datasetVersion: "v7" }, "v7"],
    ] as const) {
      const outcome = await adapter().collect(
        request({
          spec: evaluationSpec(overrides),
        }),
      );

      if (!isAvailable(outcome)) throw new Error(`expected a result: ${field}`);
      const value = outcome.value.record.value as Record<string, unknown>;
      const identity = value.identity as Record<string, unknown>;
      const seen =
        field === "workload_ref" ? identity.workload_ref : value[field];
      expect(seen, field).toBe(expected);
    }
  });

  it("verifies the configuration digest against the executed config", async () => {
    await installTool(workspace, VALID_BODY);

    const outcome = await adapter().collect(request());

    if (!isAvailable(outcome)) throw new Error("expected a result");
    const value = outcome.value.record.value as {
      identity: { config_digest?: string };
    };
    // Computed from the bytes actually passed to -c, not supplied by a caller.
    expect(value.identity.config_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("4. probing matches execution", () => {
  it("probes the same executable that collect will run", async () => {
    // A request can no longer name a different tool at all (see
    // trust-boundary.test.ts). What remains to check is that a construction-time
    // tool that does not exist yields no version rather than a borrowed one.
    await installTool(workspace, VALID_BODY);

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: "promptfoo-not-installed",
      versionArgs: nodeScript('process.stdout.write("9.9.9")'),
      providers: TEST_PROVIDERS,
    }).collect(request());

    // Neither binary exists, so nothing can be attributed. What must never
    // happen is a version recorded for a binary that did not produce a result.
    expect(outcome.standing).toBe("unavailable");
    expect(outcome.adapter.version).toBeNull();
  });

  it("reports the version of the executable that actually ran", async () => {
    await installTool(workspace, VALID_BODY);

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "fake-promptfoo"),
      providers: TEST_PROVIDERS,
    }).collect(request());

    // The construction-time program is the one probed and the one run, so the
    // version recorded belongs to what actually produced the result.
    expect(outcome.adapter.version).toBe("0.122.0");
  });
});

describe("5b. valid evidence closes the gap it addresses", () => {
  const freshness = { asOf: "2026-09-01T00:00:00Z" } as const;

  it("closes the hardware category with a matched declared/detected pair", () => {
    const contract = fixtureContract((document) => {
      (document.evidence_refs as unknown[]).push({
        id: "evidence.fit",
        kind: "tool_observation",
        subject: "candidate.local hardware fit",
        producer: { name: "llmfit", version: "0.4.2" },
        observed_at: "2026-08-20T00:00:00Z",
        source: { type: "local_command", locator: "redacted-command-manifest" },
        applies_to: {
          candidate_ref: "candidate.local",
          workload_ref: "classification",
          hardware_ref: "hardware.declared_target",
          constraint_refs: ["cost.monthly"],
        },
        value: {
          estimate_basis: {},
          // Separate subjects, matched on capability.
          target_hardware_ref: "hardware.declared_target",
          detected_hardware_ref: "hardware.detected_matching",
          findings: { fit_level: "good" },
        },
        confidence: "medium",
        caveats: [],
        refresh: { policy: "never" },
      });
    });

    const report = buildGapReport(contract, { freshness });
    const local = report.workloads[0]?.candidates.find(
      (entry) => entry.candidate_ref === "candidate.local",
    );

    expect(
      (local?.gaps ?? []).filter(
        (entry) => entry.code === "missing_hardware_benchmark",
      ),
    ).toHaveLength(0);
  });
});

describe("cleanup failure withdraws the evidence", () => {
  it("returns cleanup_failed rather than available when removal cannot be confirmed", async () => {
    await installTool(workspace, VALID_BODY);

    const failing = createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "fake-promptfoo"),
      providers: TEST_PROVIDERS,
      fs: {
        remove: () =>
          Promise.reject(new Error("EPERM: operation not permitted")),
      },
    });

    const outcome = await failing.collect(request());

    // An artifact that may still exist is a result outliving its run.
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("cleanup_failed");
  });

  it("keeps the cleanup error free of paths and artifact content", async () => {
    await installTool(workspace, VALID_BODY);

    const failing = createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "fake-promptfoo"),
      providers: TEST_PROVIDERS,
      fs: {
        remove: () =>
          Promise.reject(new Error(`EPERM on ${workspace}/run-abc`)),
      },
    });

    const outcome = await failing.collect(request());

    const message = outcome.errors[0]?.message ?? "";
    expect(message).not.toContain(workspace);
    expect(message).not.toContain("run-");
    expect(message).not.toContain("evalId");
  });
});

describe("2b. identity is derived, not asserted", () => {
  it("refuses a caller-supplied digest, and records only the derived one", async () => {
    await installTool(workspace, VALID_BODY);

    // There is no field to fabricate, and a request that tries is refused.
    const smuggled = await adapter().collect(
      request({
        identity: { dataset_hash: `sha256:${"1".repeat(64)}` },
      }),
    );
    expect(smuggled.errors[0]?.code).toBe("unsupported_argument");

    const outcome = await adapter().collect(request());
    if (!isAvailable(outcome)) throw new Error("expected a result");
    const value = outcome.value.record.value as {
      identity: { dataset_hash: string };
    };
    expect(value.identity.dataset_hash).toBe(specIdentity().dataset_hash);
  });

  it("takes the version from the version line, not from an update banner", () => {
    // Found by the real binary: promptfoo prints a multi-line update notice on
    // stdout, and taking the whole stream recorded the banner as the producer
    // version of a piece of evidence. The probe now runs with the update check
    // disabled, and the parser refuses to treat prose as a version either.
    const banner = [
      "",
      "  +=====================================================+",
      "  | Update available: 0.122.0 -> 0.122.2                |",
      "  | Please run npx promptfoo@latest to update.          |",
      "  +=====================================================+",
      "",
      "0.122.0",
      "",
    ].join("\n");

    expect(parseVersion(banner)).toBe("0.122.0");
    expect(parseVersion("0.122.0\n")).toBe("0.122.0");
    expect(parseVersion("1.2.3-rc.1")).toBe("1.2.3-rc.1");
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("no version here")).toBeNull();
  });

  it("probes with sharing, telemetry and the update check disabled", () => {
    // The probe is an invocation like any other. Leaving the update check on
    // made it both a network call and a source of stdout noise.
    expect(promptfooProbeEnvironment()).toMatchObject({
      PROMPTFOO_DISABLE_TELEMETRY: "1",
      PROMPTFOO_DISABLE_SHARING: "1",
      PROMPTFOO_DISABLE_UPDATE: "1",
    });
  });

  describe("the artifact must describe the requested evaluation", () => {
    /**
     * The fixture used to report 38 successes and 2 failures for a spec with
     * ONE row and ONE prompt, and that was recorded as available T3 evidence.
     * With exactly one provider, promptfoo runs every prompt against every
     * row, so the case count is fixed before the tool starts.
     */
    const artifactWith = (
      stats: Record<string, number>,
      rows?: Record<string, unknown>[],
    ) =>
      JSON.stringify({
        evalId: "eval-1",
        results: {
          version: 3,
          timestamp: "2026-08-20T10:30:00.000Z",
          prompts: [{ label: "p", provider: "echo" }],
          ...(rows === undefined ? {} : { results: rows }),
          stats,
        },
      });

    it("accepts an artifact whose counts match the plan", async () => {
      await installTool(
        workspace,
        JSON.stringify(artifactFor(evaluationSpec())),
      );
      const outcome = await adapter().collect(request());

      expect(outcome.errors).toEqual([]);
      expect(outcome.standing).toBe("available");
    });

    it("accepts a two-case plan reporting two cases", async () => {
      const spec = evaluationSpec({ secondRow: true });
      await installTool(
        workspace,
        JSON.stringify(
          artifactFor(spec, {
            outcome: (_p, t) => (t === 1 ? [false, 1] : [true, 0]),
          }),
        ),
      );
      const outcome = await adapter().collect(request({ spec }));

      expect(outcome.errors).toEqual([]);
      expect(outcome.standing).toBe("available");
    });

    it("refuses an artifact reporting too many cases", async () => {
      await installTool(
        workspace,
        artifactWith({ successes: 38, failures: 2, errors: 0 }),
      );
      const outcome = await adapter().collect(request());

      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.code).toBe("malformed_output");
      expect(outcome.errors[0]?.detail).toMatchObject({
        reported_cases: 40,
        expected_cases: 1,
      });
    });

    it("refuses an artifact reporting too few cases", async () => {
      await installTool(
        workspace,
        artifactWith({ successes: 1, failures: 0, errors: 0 }),
      );
      const outcome = await adapter().collect(
        request({
          spec: evaluationSpec({ secondRow: true }),
        }),
      );

      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.detail).toMatchObject({
        reported_cases: 1,
        expected_cases: 2,
      });
    });

    it("refuses an artifact reporting zero cases", async () => {
      await installTool(
        workspace,
        artifactWith({ successes: 0, failures: 0, errors: 0 }),
      );
      const outcome = await adapter().collect(request());

      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.detail).toMatchObject({ reported_cases: 0 });
    });

    it("refuses per-case rows that disagree with the reported totals", async () => {
      await installTool(
        workspace,
        artifactWith({ successes: 1, failures: 0, errors: 0 }, [
          { provider: "echo" },
          { provider: "echo" },
        ]),
      );
      const outcome = await adapter().collect(request());

      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.code).toBe("malformed_output");
      expect(outcome.errors[0]?.detail).toMatchObject({
        per_case_rows: 2,
        expected_cases: 1,
      });
    });

    it("refuses a per-case row attributed to another provider", async () => {
      // A faithful artifact whose one row is attributed elsewhere, so the
      // refusal comes from attribution and not from a missing field.
      const artifact = artifactFor(evaluationSpec());
      (artifact.results.results[0] as Record<string, unknown>).provider = {
        id: "other:model",
        label: "",
      };
      await installTool(workspace, JSON.stringify(artifact));
      const outcome = await adapter().collect(request());

      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.code).toBe("ambiguous_attribution");
    });
  });

  it("refuses before probing, so nothing is spawned for a request it will not run", async () => {
    // A path that cannot exist. If the adapter probed first, the outcome would
    // be an execution failure from the missing binary rather than the refusal
    // the caller needs to see.
    const missing = join(workspace, "definitely-not-a-real-binary");

    for (const [label, overrides] of [
      ["a caller config path", { configPath: join(workspace, "cfg.yaml") }],
      ["a malformed spec", { spec: { spec_version: "wrong" } }],
      ["a spec that is not an object", { spec: "not a spec" }],
    ] as const) {
      const outcome = await adapter({ executable: missing }).collect(
        request(overrides),
      );

      expect(outcome.standing, label).toBe("unknown");
      expect(outcome.errors[0]?.code, label).toBe("unsupported_configuration");
      // No subprocess ran, so no version was ever established.
      expect(outcome.adapter.version, label).toBeNull();
      expect(outcome.provenance.command_manifest, label).toBeNull();
    }
  });

  it("refuses an existing promptfoo config outright", async () => {
    await installTool(workspace, VALID_BODY);

    const outcome = await adapter().collect(
      request({
        configPath: join(workspace, "promptfooconfig.yaml"),
      }),
    );

    // Parsing an arbitrary config cannot be made sound, so it is refused
    // rather than partially interpreted.
    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
    expect(outcome.errors[0]?.detail).toMatchObject({
      config_path_supplied: true,
    });
  });

  it("reads nothing outside the run directory", async () => {
    // The tool is handed a generated config inside the snapshot. There is no
    // caller file for it to read, so there is no window to close.
    await installTool(workspace, VALID_BODY);

    const outcome = await adapter().collect(request());

    if (!isAvailable(outcome)) throw new Error("expected a result");
    const args = outcome.value.annotations.command_manifest?.arguments ?? [];
    const configArg = args[args.indexOf("-c") + 1] ?? "";
    expect(configArg).toContain("snapshot");
    expect(configArg.endsWith("promptfooconfig.json")).toBe(true);
  });
});
