import {
  cp,
  link,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildProjectFacts,
  runProjectQuery,
  PROJECT_TOOL_NAMES,
} from "@anvilmark/context";
import { parseProjectContract, unwrap } from "@anvilmark/project-contract";
import { parseScanConfig, readArtifact } from "@anvilmark/scanner";

import { SCAN_OUTPUT_PATH, checkScan, scanProject } from "../src/index.js";
import {
  ATLAS,
  REPO_ROOT,
  cleanup,
  cli,
  exists,
  readTree,
  scriptedIo,
  spawnCli,
  tempDir,
} from "./helpers.js";

afterEach(cleanup);

const FIXTURES = join(REPO_ROOT, "packages/scanner/test/fixtures");

const ATLAS_DECLARATIONS_FILE = join(
  REPO_ROOT,
  "docs/vnext/fixtures/atlas-scanner.yaml",
);
const ATLAS_DECLARATIONS = await readFile(ATLAS_DECLARATIONS_FILE, "utf8");

/** `<tmp>/project` (Atlas contract + declarations) next to `<tmp>/app` (the repository). */
async function workspace(options: { declarations?: string | null } = {}) {
  const base = await tempDir("anvilmark-scan-");
  const project = join(base, "project");
  const app = join(base, "app");
  await mkdir(project);
  await cp(join(FIXTURES, "repositories", "atlas-support"), app, {
    recursive: true,
  });
  for (const sdk of ["openai", "ollama"]) {
    await cp(
      join(FIXTURES, "synthetic-sdks", sdk),
      join(app, "node_modules", sdk),
      { recursive: true },
    );
  }
  expect(
    await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: project })),
  ).toBe(0);
  const declarations =
    options.declarations === undefined
      ? ATLAS_DECLARATIONS
      : options.declarations;
  if (declarations !== null) {
    await writeFile(join(project, ".anvilmark", "scanner.yaml"), declarations);
  }
  return { base, project, app };
}

function stateWithoutScans(tree: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(tree).filter(
      ([path]) => !path.startsWith(".anvilmark/scans/"),
    ),
  );
}

describe("anvilmark scan", () => {
  it("writes only the scan artifact, changes no project state and leaves the repository byte-identical", async () => {
    const { project, app } = await workspace();
    const projectBefore = await readTree(project);
    const appBefore = await readTree(app);
    const io = scriptedIo({ cwd: project });
    expect(await cli(["scan"], io)).toBe(0);
    expect(io.err()).toBe("");
    expect(io.out()).toContain(`Repository scan written: ${SCAN_OUTPUT_PATH}`);
    expect(io.out()).toContain("not conformance results");
    expect(io.out()).toContain("(not in the contract's repository_roots)");

    const projectAfter = await readTree(project);
    expect(stateWithoutScans(projectAfter)).toEqual(projectBefore);
    expect(
      Object.keys(projectAfter).filter((path) => !(path in projectBefore)),
    ).toEqual([SCAN_OUTPUT_PATH]);
    expect(await readTree(app)).toEqual(appBefore);

    const reading = readArtifact(projectAfter[SCAN_OUTPUT_PATH] as string);
    expect(reading.status).toBe("valid");
    if (reading.status !== "valid") return;
    const artifact = reading.artifact;
    expect(artifact.repository.root).toBe("../app");
    expect(artifact.configuration).toMatchObject({
      source: "file",
      path: ".anvilmark/scanner.yaml",
    });
    expect(artifact.observation.basis).toBe("clock");
    expect(projectAfter[SCAN_OUTPUT_PATH]).not.toContain(project);
    expect(projectAfter[SCAN_OUTPUT_PATH]).not.toContain(app);

    const statuses = Object.fromEntries(
      artifact.observations
        .filter((entry) => entry.kind === "provider_call")
        .map((entry) => [
          `${entry.location.symbol}:${entry.operation}`,
          artifact.data_flows.find((flow) => flow.observation_ref === entry.id)
            ?.status,
        ]),
    );
    expect(statuses).toEqual({
      "classifyRemotely:chat.completions.create": "sanitized_only",
      "classifyTicket:chat": "sanitized_only",
      "escalateTicket:responses.create": "raw_reaches",
    });
    // The contract is unchanged: no binding was recorded.
    expect(projectAfter[".anvilmark/project.yaml"]).toContain(
      "repository_bindings: []",
    );
  });

  it("is byte-identical when nothing changed, and rescans with a new observation when inputs change", async () => {
    const { project, app } = await workspace();
    expect(await cli(["scan"], scriptedIo({ cwd: project }))).toBe(0);
    const first = await readFile(join(project, SCAN_OUTPUT_PATH), "utf8");

    const again = scriptedIo({
      cwd: project,
      clock: () => "2030-01-01T00:00:00.000Z",
    });
    expect(await cli(["scan"], again)).toBe(0);
    expect(again.out()).toContain("Repository scan unchanged");
    expect(await readFile(join(project, SCAN_OUTPUT_PATH), "utf8")).toBe(first);
    expect(await cli(["scan", "--check"], scriptedIo({ cwd: project }))).toBe(
      0,
    );

    await writeFile(
      join(app, "src", "escalation.ts"),
      `${await readFile(join(app, "src", "escalation.ts"), "utf8")}\n// edited\n`,
    );
    const check = scriptedIo({ cwd: project });
    expect(await cli(["scan", "--check", "--json"], check)).toBe(1);
    expect(JSON.parse(check.out())).toMatchObject({
      status: "stale",
      reasons: ["repository inputs changed"],
    });
    expect(await readFile(join(project, SCAN_OUTPUT_PATH), "utf8")).toBe(first);

    const rescan = scriptedIo({
      cwd: project,
      clock: () => "2030-01-01T00:00:00.000Z",
    });
    expect(await cli(["scan", "--json"], rescan)).toBe(0);
    expect(JSON.parse(rescan.out())).toMatchObject({
      status: "written",
      observation: { observed_at: "2030-01-01T00:00:00.000Z", basis: "clock" },
    });

    await writeFile(
      join(project, ".anvilmark", "scanner.yaml"),
      ATLAS_DECLARATIONS.replace(
        "  - id: component.escalation",
        "  - id: component.escalation_renamed",
      ),
    );
    const configCheck = scriptedIo({ cwd: project });
    expect(await cli(["scan", "--check", "--json"], configCheck)).toBe(1);
    expect(JSON.parse(configCheck.out()).reasons).toEqual([
      "scan declarations changed",
    ]);

    const projectFile = join(project, ".anvilmark", "project.yaml");
    await writeFile(
      projectFile,
      (await readFile(projectFile, "utf8")).replace(
        /^ {2}name: .+$/m,
        "  name: Atlas Support Renamed",
      ),
    );
    const contractCheck = scriptedIo({ cwd: project });
    expect(await cli(["scan", "--check", "--json"], contractCheck)).toBe(1);
    expect(JSON.parse(contractCheck.out()).reasons).toEqual(
      expect.arrayContaining(["contract changed", "scan declarations changed"]),
    );

    const explicit = scriptedIo({ cwd: project });
    expect(
      await cli(
        ["scan", "--observed-at", "2026-09-15T12:00:00Z", "--json"],
        explicit,
      ),
    ).toBe(0);
    expect(JSON.parse(explicit.out()).observation).toEqual({
      observed_at: "2026-09-15T12:00:00Z",
      basis: "explicit",
    });
  });

  it("excludes its own output when the project lives inside the scanned repository", async () => {
    const base = await tempDir("anvilmark-scan-inside-");
    await cp(join(FIXTURES, "repositories", "direct-call"), base, {
      recursive: true,
    });
    await cp(
      join(FIXTURES, "synthetic-sdks", "openai"),
      join(base, "node_modules", "openai"),
      { recursive: true },
    );
    expect(
      await cli(["init", "--from-contract", ATLAS], scriptedIo({ cwd: base })),
    ).toBe(0);
    expect(
      await cli(["scan", "--repository", "."], scriptedIo({ cwd: base })),
    ).toBe(0);
    const first = await readFile(join(base, SCAN_OUTPUT_PATH), "utf8");
    const reading = readArtifact(first);
    expect(
      reading.status === "valid" &&
        reading.artifact.repository.inputs.some((entry) =>
          entry.path.startsWith(".anvilmark"),
        ),
    ).toBe(false);
    expect(
      reading.status === "valid" && reading.artifact.inventory.excluded,
    ).toContainEqual({
      path: ".anvilmark",
      reason: "default_excluded_directory",
    });
    expect(
      await cli(["scan", "--repository", "."], scriptedIo({ cwd: base })),
    ).toBe(0);
    expect(await readFile(join(base, SCAN_OUTPUT_PATH), "utf8")).toBe(first);
  });

  it("shows sections, refuses a tampered artifact and reports missing ones", async () => {
    const { project } = await workspace();
    const missing = scriptedIo({ cwd: project });
    expect(await cli(["scan", "show"], missing)).toBe(1);
    expect(missing.err()).toContain('run "anvilmark scan"');
    expect(await cli(["scan", "--check"], scriptedIo({ cwd: project }))).toBe(
      1,
    );

    expect(await cli(["scan"], scriptedIo({ cwd: project }))).toBe(0);
    for (const section of [
      "summary",
      "inventory",
      "declarations",
      "observations",
      "flows",
      "bindings",
      "unknowns",
      "errors",
      "limits",
      "all",
    ]) {
      const io = scriptedIo({ cwd: project });
      expect(
        await cli(["scan", "show", "--section", section], io),
        section,
      ).toBe(0);
      const json = scriptedIo({ cwd: project });
      expect(
        await cli(["scan", "show", "--section", section, "--json"], json),
        section,
      ).toBe(0);
      expect(() => JSON.parse(json.out())).not.toThrow();
    }
    const flows = scriptedIo({ cwd: project });
    await cli(["scan", "show", "--section", "flows"], flows);
    expect(flows.out()).toContain(
      "raw_customer_ticket raw: source@8 -> sink@8",
    );
    const bindings = scriptedIo({ cwd: project });
    await cli(["scan", "show", "--section", "bindings"], bindings);
    expect(bindings.out()).toContain(
      "Proposed bindings (not recorded in the contract)",
    );
    expect(bindings.out()).toContain("decision unbound");

    const file = join(project, SCAN_OUTPUT_PATH);
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        '"raw_reaches"',
        '"sanitized_only"',
      ),
    );
    const tampered = scriptedIo({ cwd: project });
    expect(await cli(["scan", "show"], tampered)).toBe(1);
    expect(tampered.err()).toContain("does not match its own content hash");
    const check = scriptedIo({ cwd: project });
    expect(await cli(["scan", "--check", "--json"], check)).toBe(1);
    expect(JSON.parse(check.out()).status).toBe("tampered");

    await writeFile(file, "{ not json");
    const invalid = scriptedIo({ cwd: project });
    expect(await cli(["scan", "show", "--json"], invalid)).toBe(1);
    expect(JSON.parse(invalid.out())).toEqual({
      status: "invalid",
      path: SCAN_OUTPUT_PATH,
    });
  });
});

describe("scan failures and usage", () => {
  it("refuses invalid declarations, missing inputs and bad options without writing", async () => {
    const { project } = await workspace({
      declarations:
        "format: anvilmark-scan-config/0.1.0-draft.1\nsources: [{ id: x }]\n",
    });
    const invalid = scriptedIo({ cwd: project });
    expect(await cli(["scan"], invalid)).toBe(1);
    expect(invalid.err()).toContain("is not a valid scan declaration file");
    expect(invalid.err()).toContain("sources.0.");
    expect(await exists(join(project, SCAN_OUTPUT_PATH))).toBe(false);

    const missingConfig = scriptedIo({ cwd: project });
    expect(
      await cli(
        ["scan", "--config", "nope.yaml", "--repository", "../app"],
        missingConfig,
      ),
    ).toBe(1);
    expect(missingConfig.err()).toContain("does not exist");

    await rm(join(project, ".anvilmark", "scanner.yaml"));
    const noRepository = scriptedIo({ cwd: project });
    expect(await cli(["scan"], noRepository)).toBe(1);
    expect(noRepository.err()).toContain("no repository to scan");
    const notDirectory = scriptedIo({ cwd: project });
    expect(
      await cli(["scan", "--repository", "../missing"], notDirectory),
    ).toBe(1);
    expect(await exists(join(project, SCAN_OUTPUT_PATH))).toBe(false);

    for (const argv of [
      ["scan", "bogus"],
      ["scan", "--observed-at", "yesterday", "--repository", "../app"],
      ["scan", "show", "--section", "everything"],
      ["scan", "--check", "--observed-at", "2026-09-15T00:00:00Z"],
      ["scan", "extra-positional-after-flag", "--json"],
    ]) {
      expect(
        await cli(argv, scriptedIo({ cwd: project })),
        argv.join(" "),
      ).toBe(2);
    }
    expect(await exists(join(project, SCAN_OUTPUT_PATH))).toBe(false);
  });

  it("scans with no declarations and keeps every mapping unbound or heuristic", async () => {
    const { project } = await workspace({ declarations: null });
    const io = scriptedIo({ cwd: project });
    expect(await cli(["scan", "--repository", "../app", "--json"], io)).toBe(0);
    const reading = readArtifact(
      await readFile(join(project, SCAN_OUTPUT_PATH), "utf8"),
    );
    expect(reading.status).toBe("valid");
    if (reading.status !== "valid") return;
    expect(reading.artifact.configuration.source).toBe("default");
    expect(
      new Set(
        reading.artifact.proposed_bindings.map((binding) => binding.discovery),
      ),
    ).toEqual(new Set(["heuristic_association", "unresolved"]));
    expect(
      reading.artifact.data_flows.every(
        (flow) => flow.classifications.length === 0,
      ),
    ).toBe(true);
  });

  it("detects inputs changed while scanning and publishes nothing", async () => {
    const { project, app } = await workspace();
    await expect(
      scanProject({
        root: project,
        clock: () => "2026-09-15T00:00:00.000Z",
        hooks: {
          afterScan: async () => {
            await writeFile(
              join(app, "src", "intake.ts"),
              "export function readTicket() { return ''; }\n",
            );
          },
        },
      }),
    ).rejects.toThrow(
      /repository file\(s\) changed while scanning \(src\/intake\.ts\); no scan output was changed/,
    );
    expect(await exists(join(project, SCAN_OUTPUT_PATH))).toBe(false);
    expect(await exists(join(project, ".anvilmark", "scans"))).toBe(true);
    // The project lock was released.
    expect(await exists(join(project, ".anvilmark", ".lock"))).toBe(false);

    await expect(
      scanProject({
        root: project,
        clock: () => "2026-09-15T00:00:00.000Z",
        hooks: {
          afterScan: async () => {
            const file = join(project, ".anvilmark", "scanner.yaml");
            await writeFile(file, `${await readFile(file, "utf8")}# edited\n`);
          },
        },
      }),
    ).rejects.toThrow(/declaration file changed while scanning/);
    expect(await exists(join(project, SCAN_OUTPUT_PATH))).toBe(false);
  });
});

describe("scan output boundary", () => {
  it("refuses the old artifact format until explicitly rescanned", async () => {
    const { project } = await workspace();
    const options = { root: project, clock: () => "2026-09-15T00:00:00Z" };
    const result = await scanProject(options);
    await writeFile(
      join(project, SCAN_OUTPUT_PATH),
      JSON.stringify({
        ...result.artifact,
        format: "anvilmark-repository-scan/0.1.0-draft.1",
      }),
    );
    expect((await checkScan(options)).status).toBe("invalid");
    await scanProject(options);
    expect((await checkScan(options)).status).toBe("current");
  });
  it.each([false, true])(
    "refuses a new provider source before publication (previous output: %s)",
    async (existing) => {
      const { project, app } = await workspace();
      const options = { root: project, clock: () => "2026-09-15T00:00:00Z" };
      if (existing) await scanProject(options);
      const before = await readTree(project);
      await expect(
        scanProject({
          ...options,
          hooks: {
            afterScan: async () => {
              await writeFile(
                join(app, "src/late.ts"),
                'import OpenAI from "openai"; import {readTicket} from "./intake.js"; const c=new OpenAI(); export function late(){return c.responses.create({model:"changed-model",input:readTicket("synthetic")});}',
              );
            },
          },
        }),
      ).rejects.toThrow(/late\.ts/);
      expect(await readTree(project)).toEqual(before);
    },
  );

  it("detects default declarations appearing during a scan", async () => {
    const { project, app } = await workspace({ declarations: null });
    await expect(
      scanProject({
        root: project,
        repository: app,
        clock: () => "2026-09-15T00:00:00Z",
        hooks: {
          afterScan: async () => {
            await writeFile(
              join(project, ".anvilmark/scanner.yaml"),
              ATLAS_DECLARATIONS,
            );
          },
        },
      }),
    ).rejects.toThrow(/declaration file appeared/);
    expect(await exists(join(project, SCAN_OUTPUT_PATH))).toBe(false);
  });

  it("refuses a symlinked scans directory without writing through it", async () => {
    const { project } = await workspace();
    const outside = await tempDir("anvilmark-scan-outside-");
    await symlink(outside, join(project, ".anvilmark", "scans"));
    const io = scriptedIo({ cwd: project });
    expect(await cli(["scan"], io)).toBe(1);
    expect(io.err()).toContain("symbolic link");
    expect(await readTree(outside)).toEqual({});
  });

  it("refuses an output that is a link to, or the same file as, protected state", async () => {
    const { project } = await workspace();
    await mkdir(join(project, ".anvilmark", "scans"));
    const output = join(project, SCAN_OUTPUT_PATH);
    const projectFile = join(project, ".anvilmark", "project.yaml");
    const contractBefore = await readFile(projectFile, "utf8");

    await symlink(projectFile, output);
    const linked = scriptedIo({ cwd: project });
    expect(await cli(["scan"], linked)).toBe(1);
    expect(linked.err()).toContain("symbolic link");
    await rm(output);

    await link(projectFile, output);
    const hard = scriptedIo({ cwd: project });
    expect(await cli(["scan"], hard)).toBe(1);
    expect(hard.err()).toContain("same file as .anvilmark/project.yaml");
    await rm(output);

    const declarations = join(project, ".anvilmark", "scanner.yaml");
    const declarationsBefore = await readFile(declarations, "utf8");
    await link(declarations, output);
    const config = scriptedIo({ cwd: project });
    expect(await cli(["scan"], config)).toBe(1);
    expect(config.err()).toContain("same file as .anvilmark/scanner.yaml");
    await rm(output);

    const external = join(project, "declarations.yaml");
    await writeFile(external, ATLAS_DECLARATIONS);
    await link(external, output);
    const explicit = scriptedIo({ cwd: project });
    expect(await cli(["scan", "--config", "declarations.yaml"], explicit)).toBe(
      1,
    );
    expect(explicit.err()).toContain("same file as the scan declaration file");

    expect(await readFile(projectFile, "utf8")).toBe(contractBefore);
    expect(await readFile(declarations, "utf8")).toBe(declarationsBefore);
    expect(await readFile(external, "utf8")).toBe(ATLAS_DECLARATIONS);
  });

  it("keeps generated views from overwriting scan state", async () => {
    const base = await tempDir("anvilmark-scan-generate-");
    const contractFile = join(base, "atlas.yaml");
    for (const [target, protectedName] of [
      ["./scans/repository-scan.json", "scans"],
      ["./scanner.yaml", "scanner.yaml"],
    ] as const) {
      const project = join(base, protectedName.replace(".", "-"));
      await mkdir(project);
      await writeFile(
        contractFile,
        (await readFile(ATLAS, "utf8")).replace(
          "mermaid: ./architecture/view.mmd",
          `mermaid: ${target}`,
        ),
      );
      expect(
        await cli(
          ["init", "--from-contract", contractFile],
          scriptedIo({ cwd: project }),
        ),
      ).toBe(0);
      const io = scriptedIo({ cwd: project });
      expect(await cli(["generate"], io), target).toBe(1);
      expect(io.err()).toContain("protected project state");
    }
  });
});

describe("read-only MCP tools are unaffected by scanning", () => {
  it("answers identically before and after a scan, with no repository detail", async () => {
    const { project } = await workspace();
    const answer = async () => {
      const contract = unwrap(
        parseProjectContract(
          await readFile(join(project, ".anvilmark", "project.yaml"), "utf8"),
          "yaml",
        ),
      );
      buildProjectFacts(contract, {
        asOf: "2026-09-15T00:00:00Z",
        projection: "remote-default",
        stateRevision: 1,
      });
      return JSON.stringify(
        PROJECT_TOOL_NAMES.map((tool) =>
          runProjectQuery(
            tool,
            tool === "get_workload_decision"
              ? { workload: "classification" }
              : {},
            {
              contract,
              asOf: "2026-09-15T00:00:00Z",
              projection: "remote-default",
              stateRevision: 1,
            },
          ),
        ),
      );
    };
    const before = await answer();
    expect(await cli(["scan"], scriptedIo({ cwd: project }))).toBe(0);
    const after = await answer();
    expect(after).toBe(before);
    for (const detail of [
      "src/classifier.ts",
      "escalateTicket",
      "../app",
      "raw_reaches",
      "repository-scan",
    ]) {
      expect(after).not.toContain(detail);
    }
  });
});

describe("built CLI", () => {
  it("scans, shows, checks and reports exit codes as documented", async () => {
    const { project, app } = await workspace();
    const scanned = await spawnCli(["scan", "--json"], { cwd: project });
    expect(scanned.stderr).toBe("");
    expect(scanned.code).toBe(0);
    expect(JSON.parse(scanned.stdout)).toMatchObject({
      status: "written",
      path: SCAN_OUTPUT_PATH,
    });

    const repeated = await spawnCli(["scan", "--json"], { cwd: project });
    expect(JSON.parse(repeated.stdout)).toMatchObject({
      status: "unchanged",
      observed_at_basis: "reused",
      observation: { basis: "clock" },
    });

    const unknowns = await spawnCli(
      ["scan", "show", "--section", "unknowns", "--json"],
      { cwd: project },
    );
    expect(unknowns.code).toBe(0);
    // The Atlas application is analysed completely within call depth 3.
    expect(JSON.parse(unknowns.stdout)).toEqual([]);

    const bindings = await spawnCli(["scan", "show", "--section", "bindings"], {
      cwd: project,
    });
    expect(bindings.stdout).toContain("declared_mapping");

    expect((await spawnCli(["scan", "--check"], { cwd: project })).code).toBe(
      0,
    );
    await writeFile(join(app, "src", "server.ts"), "export {};\n");
    const stale = await spawnCli(["scan", "--check"], { cwd: project });
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain("stale");

    const usage = await spawnCli(["scan", "--observed-at", "not-a-time"], {
      cwd: project,
    });
    expect(usage.code).toBe(2);
    const help = await spawnCli(["scan", "--help"], { cwd: project });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("not conformance results");

    await writeFile(
      join(project, ".anvilmark", "scanner.yaml"),
      "format: wrong\n",
    );
    const refused = await spawnCli(["scan"], { cwd: project });
    expect(refused.code).toBe(1);
  });

  it("scans each M6 handoff fixture through the built binary", async () => {
    for (const name of [
      "handoff-approved-sanitized",
      "handoff-disallowed-raw",
      "handoff-ambiguous-runtime",
    ]) {
      const base = await tempDir("anvilmark-scan-handoff-");
      await cp(join(FIXTURES, "repositories", name), base, { recursive: true });
      await cp(
        join(FIXTURES, "synthetic-sdks", "openai"),
        join(base, "node_modules", "openai"),
        { recursive: true },
      );
      expect(
        await cli(
          ["init", "--from-contract", ATLAS],
          scriptedIo({ cwd: base }),
        ),
      ).toBe(0);
      await writeFile(
        join(base, ".anvilmark", "scanner.yaml"),
        `format: anvilmark-scan-config/0.1.0-draft.1
repository_root: .
sources:
  - { id: source.raw_ticket, data_classification: raw_customer_ticket, function: { path: src/tickets.ts, export: readTicket } }
sanitizers:
  - { id: sanitizer.pii, function: { path: src/redact.ts, export: redactTicket }, clears: [raw_customer_ticket], produces: redacted_customer_ticket }
sinks:
  - { id: sink.openai, recognizer: openai, architecture_node_ref: remote-model-provider }
`,
      );
      const result = await spawnCli(
        ["scan", "show", "--section", "flows", "--json"],
        { cwd: base },
      );
      expect(result.code, name).toBe(1); // nothing scanned yet
      expect((await spawnCli(["scan"], { cwd: base })).code, name).toBe(0);
      const flows = JSON.parse(
        (
          await spawnCli(["scan", "show", "--section", "flows", "--json"], {
            cwd: base,
          })
        ).stdout,
      ) as { status: string }[];
      const expected = {
        "handoff-approved-sanitized": ["sanitized_only"],
        "handoff-disallowed-raw": ["raw_reaches"],
        "handoff-ambiguous-runtime": ["unresolved"],
      }[name];
      expect(
        flows.map((flow) => flow.status),
        name,
      ).toEqual(expected);
    }
  });
});

describe("scan draft-config", () => {
  it("prints a parseable draft from a scan without declarations and writes nothing", async () => {
    const { project } = await workspace();
    const before = await readTree(project);
    const io = scriptedIo({ cwd: project });
    expect(await cli(["scan", "draft-config"], io)).toBe(0);
    const draft = io.out();
    // The existing file's repository_root is kept; its declarations are not.
    expect(draft).toContain('repository_root: "../app"');
    expect(draft).toContain("# DRAFT scan declarations");
    const parsed = parseScanConfig(draft);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.config.sources).toEqual([]);
      expect(
        parsed.config.sinks.map((sink) => [sink.recognizer, sink.paths]),
      ).toEqual([
        ["ollama", ["src"]],
        ["openai", ["src"]],
      ]);
    }
    expect(await readTree(project)).toEqual(before);
    expect(await exists(join(project, SCAN_OUTPUT_PATH))).toBe(false);
  });
});

describe("check API", () => {
  it("reports missing before the first scan", async () => {
    const { project } = await workspace();
    expect(
      await checkScan({ root: project, clock: () => "2026-09-15T00:00:00Z" }),
    ).toMatchObject({ status: "missing" });
  });
});
