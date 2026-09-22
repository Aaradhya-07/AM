import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProjectContract } from "@anvilmark/project-contract";

import type { ProviderRecognizer } from "../src/index.js";
import {
  DEFAULT_PIPELINE,
  SCAN_CONFIG_FORMAT,
  defaultRecognizers,
  parseScanConfig,
  serializeArtifact,
} from "../src/index.js";
import {
  artifactOf,
  atlas,
  callIn,
  cleanup,
  declarations,
  materialize,
  scan,
  tempDir,
} from "./helpers.js";

afterEach(cleanup);

async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        result[relative(root, path)] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      }
    }
  };
  await walk(root);
  return result;
}

describe("declarations bind to resolved symbols, not names", () => {
  it("does not treat a same-named function in another file as the declared sanitizer", async () => {
    const root = await materialize("direct-call");
    await writeFile(
      join(root, "src/lookalike.ts"),
      `import OpenAI from "openai";
import { readTicket } from "./tickets";
export function redactTicket(text: string): string { return text; }
const client = new OpenAI();
export async function lookalike(id: string) {
  return client.responses.create({ model: "gpt-4o-mini", input: redactTicket(readTicket(id)) });
}
`,
    );
    const artifact = artifactOf(scan(root, await atlas()));
    expect(callIn(artifact, "lookalike").flow.status).toBe("raw_reaches");
  });

  it("reports declarations that do not resolve or name refs the contract lacks", async () => {
    const root = await materialize("direct-call");
    const config = declarations({
      sources: [
        {
          id: "source.missing",
          data_classification: "not_declared_anywhere",
          function: { path: "src/tickets.ts", export: "noSuchExport" },
        },
      ],
      sanitizers: [],
      sinks: [
        {
          id: "sink.bad",
          recognizer: "openai",
          architecture_node_ref: "no-such-node",
          candidate_ref: "no.such.candidate",
        },
      ],
      components: [
        {
          id: "component.gone",
          path: "src/absent.ts",
          architecture_node_ref: "ticket-classifier",
          workload_ref: "no_such_workload",
        },
      ],
    });
    const artifact = artifactOf(scan(root, await atlas(), config));
    const problems = Object.fromEntries(
      artifact.declarations.map((entry) => [entry.id, entry.problems]),
    );
    expect(problems).toEqual({
      "component.gone": [
        "declared_file_not_in_scan",
        "workload_ref_not_in_contract",
      ],
      "sink.bad": [
        "architecture_node_ref_not_in_contract",
        "candidate_ref_not_in_contract",
      ],
      "source.missing": [
        "data_classification_not_in_contract",
        "declared_export_not_found",
      ],
    });
    // With no resolvable source, the payload derives only from a parameter.
    const { flow } = callIn(artifact, "classifyTicket");
    expect(flow.status).toBe("unresolved");
    expect(flow.classifications).toEqual([]);
    expect(flow.unknown_reasons).toEqual(["parameter_value_from_caller"]);
    const binding = artifact.proposed_bindings[0];
    expect(binding?.provider_node.ref).toBeNull();
    expect(binding?.unbound_reasons).toEqual(
      expect.arrayContaining([
        "sink_architecture_node_not_in_contract",
        "no_candidate_declared",
      ]),
    );
    expect(artifact.completeness.status).toBe("incomplete");
  });

  it("reports no declared data only relative to the declared sources", async () => {
    const root = await materialize("direct-call");
    await writeFile(
      join(root, "src/constant.ts"),
      `import OpenAI from "openai";\nconst client = new OpenAI();\nexport async function constant() {\n  return client.responses.create({ model: "gpt-4o-mini", input: "static prompt" });\n}\n`,
    );
    const artifact = artifactOf(scan(root, await atlas()));
    const { flow } = callIn(artifact, "constant");
    expect(flow).toMatchObject({
      status: "no_declared_data",
      trace_tier: null,
      evidence_tier: "T3",
    });
    expect(flow.caveats).toContain("absence_is_relative_to_declared_sources");
    expect(flow.assumptions).toEqual([
      {
        kind: "declared_sources_complete",
        declaration_ref: null,
        evidence_tier: "T1",
      },
    ]);
  });

  it("keeps heuristic association visibly different from a declared mapping", async () => {
    const root = await materialize("direct-call");
    const artifact = artifactOf(
      scan(root, await atlas(), declarations({ sinks: [] })),
    );
    const binding = artifact.proposed_bindings[0];
    expect(binding).toMatchObject({
      discovery: "heuristic_association",
      confidence: "low",
      evidence_tier: "T0",
      provider_node: {
        ref: "remote-model-provider",
        association: "heuristic_association",
        trust_boundary: "remote_provider",
      },
      contract_projection: { eligible: false, discovery_kind: null },
    });
    expect(JSON.stringify(artifact)).not.toContain("agent_inferred");
  });
});

describe("filesystem and data boundaries", () => {
  it("never reads outside the repository, through links, or into excluded and state directories", async () => {
    const root = await materialize("broken-inputs");
    // Generated and build output is created here rather than committed:
    // Git itself ignores these directories.
    await mkdir(join(root, "dist"));
    await writeFile(
      join(root, "dist", "bundle.js"),
      `const { OpenAI } = require("openai");\nmodule.exports = new OpenAI();\n`,
    );
    await mkdir(join(root, "generated"));
    await writeFile(
      join(root, "generated", "output.ts"),
      `import OpenAI from "openai";\nexport const generated = new OpenAI();\n`,
    );
    const outside = await tempDir("anvilmark-outside-");
    const marker = "OUTSIDE_MARKER_7f3a";
    await writeFile(
      join(outside, "secret.ts"),
      `export const leaked = "${marker}";\n`,
    );
    await mkdir(join(outside, "dir"));
    await writeFile(
      join(outside, "dir", "inner.ts"),
      `export const alsoLeaked = "${marker}";\n`,
    );
    await symlink(
      join(outside, "secret.ts"),
      join(root, "src", "outside-link.ts"),
    );
    await symlink(join(outside, "dir"), join(root, "src", "outside-dir"));
    await writeFile(
      join(root, "src", "importer.ts"),
      `import { leaked } from "./outside-link";\nexport const value = leaked;\n`,
    );
    await mkdir(join(root, ".anvilmark"));
    await writeFile(
      join(root, ".anvilmark", "inside.ts"),
      `export const state = "${marker}";\n`,
    );
    await writeFile(
      join(root, "src", "state-import.ts"),
      `import { state } from "../.anvilmark/inside";\nexport const again = state;\n`,
    );
    const envSecret = "sk-proj-ENVVALUE0123456789abcdefghijklmnop";
    await writeFile(join(root, ".env"), `OPENAI_API_KEY=${envSecret}\n`);
    await writeFile(
      join(root, "src", "env.ts"),
      `declare const process: { env: Record<string, string | undefined> };\nexport const key = process.env.OPENAI_API_KEY;\n`,
    );
    const before = await tree(root);

    const outcome = scan(root, await atlas());
    const artifact = artifactOf(outcome);
    const text = serializeArtifact(artifact);

    expect(text).not.toContain(marker);
    expect(text).not.toContain(envSecret);
    expect(text).not.toContain(root);
    expect(text).not.toContain(outside);
    expect(text).not.toContain(homedir());
    expect(artifact.limits).toEqual(
      expect.arrayContaining([
        { kind: "symlink_not_followed", path: "src/outside-dir", detail: null },
        {
          kind: "symlink_not_followed",
          path: "src/outside-link.ts",
          detail: null,
        },
        {
          kind: "outside_repository_boundary",
          path: "src/outside-link.ts",
          detail: null,
        },
        { kind: "denied_directory", path: ".anvilmark", detail: null },
      ]),
    );
    // Negations and nested .gitignore files are applied, not reported as limits.
    expect(
      artifact.limits.filter((entry) => entry.kind.includes("gitignore")),
    ).toEqual([]);
    expect(artifact.inventory.excluded).toEqual(
      expect.arrayContaining([
        { path: ".anvilmark", reason: "default_excluded_directory" },
        { path: ".env", reason: "environment_file_not_read" },
        { path: "dist", reason: "default_excluded_directory" },
        { path: "generated", reason: "gitignore" },
        { path: "vendor", reason: "default_excluded_directory" },
      ]),
    );
    expect(artifact.repository.inputs.map((entry) => entry.path)).not.toEqual(
      expect.arrayContaining([
        ".env",
        "dist/bundle.js",
        "generated/output.ts",
        "vendor/lib.ts",
        ".anvilmark/inside.ts",
      ]),
    );
    expect(artifact.inventory.environment_variables).toEqual([
      {
        name: "OPENAI_API_KEY",
        locations: [expect.objectContaining({ path: "src/env.ts" })],
      },
    ]);
    // Only the scanned-and-kept call is observed; generated/vendored/dist code is not.
    expect(
      artifact.observations.filter(
        (entry) => entry.kind === "client_instantiation",
      ),
    ).toHaveLength(1);
    // Scanning changes nothing in the repository.
    expect(await tree(root)).toEqual(before);
  });

  it("separates read, parse and configuration errors from analysis unknowns", async () => {
    const root = await materialize("broken-inputs");
    const unreadable = join(root, "src", "unreadable.ts");
    await writeFile(unreadable, "export const hidden = 1;\n");
    await chmod(unreadable, 0o000);
    try {
      const canStillRead = await readFile(unreadable).then(
        () => true,
        () => false,
      );
      const artifact = artifactOf(scan(root, await atlas()));
      const errors = artifact.analysis_errors.map((entry) => [
        entry.kind,
        entry.path,
        entry.code,
      ]);
      expect(errors).toEqual(
        expect.arrayContaining([
          ["tsconfig_invalid", "tsconfig.json", "TS1109"],
          ["parse_error", "src/broken.ts", "TS1005"],
          ["parse_error", "src/broken.ts", "TS1003"],
        ]),
      );
      if (!canStillRead) {
        expect(errors).toContainEqual([
          "file_read_error",
          "src/unreadable.ts",
          "EACCES",
        ]);
      }
      expect(artifact.unknowns).toEqual([]);
      expect(callIn(artifact, "stillScanned").flow.status).toBe("raw_reaches");
      expect(artifact.completeness.status).toBe("incomplete");
      expect(artifact.completeness.reasons.join(" ")).toContain(
        "analysis error",
      );
    } finally {
      await chmod(unreadable, 0o644);
    }
  });

  it("never follows tsconfig extends outside the repository, runs plugins or follows references", async () => {
    const root = await materialize("direct-call");
    const outside = await tempDir("anvilmark-outside-config-");
    await writeFile(
      join(outside, "base.json"),
      JSON.stringify({ compilerOptions: { strict: true, jsx: "react" } }),
    );
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        extends: relative(root, join(outside, "base.json")),
        compilerOptions: {
          plugins: [{ name: "some-typescript-plugin" }],
          allowJs: false,
        },
        references: [{ path: "../other" }],
      }),
    );
    const artifact = artifactOf(scan(root, await atlas()));
    expect(artifact.configuration.compiler.options.strict).toBe(false);
    expect(artifact.configuration.compiler.options.jsx).toBeNull();
    expect(artifact.configuration.compiler.forced).toEqual(["allowJs"]);
    expect(artifact.limits.map((entry) => entry.kind)).toContain(
      "project_references_not_followed",
    );
    // Language-service plugins only affect editors, so they are a note, not a limit.
    expect(artifact.limits.map((entry) => entry.kind)).not.toContain(
      "tsconfig_plugins_not_run",
    );
    expect(artifact.notes.map((entry) => entry.kind)).toContain(
      "tsconfig_plugins_not_run",
    );
    expect(artifact.analysis_errors.map((entry) => entry.kind)).toContain(
      "tsconfig_invalid",
    );
    expect(serializeArtifact(artifact)).not.toContain(outside);
    expect(callIn(artifact, "classifyTicket").flow.status).toBe("raw_reaches");
  });

  it("applies .gitignore negations and nested .gitignore files as Git does", async () => {
    const root = await materialize("direct-call");
    await writeFile(
      join(root, ".gitignore"),
      "generated/*\n!generated/keep.ts\nbuild-output/\n!build-output/inside.ts\n",
    );
    for (const [path, text] of [
      ["generated/drop.ts", "export const drop = 1;\n"],
      ["generated/keep.ts", "export const keep = 1;\n"],
      ["build-output/inside.ts", "export const inside = 1;\n"],
      ["packages/app/.gitignore", "*.local.ts\n!important.local.ts\n"],
      ["packages/app/a.local.ts", "export const a = 1;\n"],
      ["packages/app/important.local.ts", "export const b = 1;\n"],
      ["packages/app/index.ts", "export const c = 1;\n"],
    ] as const) {
      await mkdir(join(root, dirname(path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const artifact = artifactOf(scan(root, await atlas()));
    const scanned = artifact.repository.inputs.map((entry) => entry.path);
    expect(scanned).toEqual(
      expect.arrayContaining([
        "generated/keep.ts",
        "packages/app/important.local.ts",
        "packages/app/index.ts",
      ]),
    );
    for (const path of [
      "generated/drop.ts",
      // A file inside an excluded directory is never re-included.
      "build-output/inside.ts",
      "packages/app/a.local.ts",
    ])
      expect(scanned).not.toContain(path);
    expect(artifact.limits).toEqual([]);
  });

  it("refuses oversized files as a visible limit", async () => {
    const root = await materialize("direct-call");
    await writeFile(
      join(root, "src", "huge.ts"),
      `export const big = "${"x".repeat(4096)}";\n`,
    );
    const artifact = artifactOf(
      scan(root, await atlas(), declarations(), { maxFileBytes: 2048 }),
    );
    expect(artifact.limits).toContainEqual({
      kind: "file_too_large",
      path: "src/huge.ts",
      detail: null,
    });
  });

  it("reads a dependency's oversized type declarations, so its types stay resolvable", async () => {
    const root = await materialize("direct-call");
    const declarationFile = join(root, "node_modules", "openai", "index.d.ts");
    const padding = `// ${"type padding ".repeat(400)}\n`;
    await writeFile(
      declarationFile,
      `${padding}${await readFile(declarationFile, "utf8")}`,
    );
    await writeFile(
      join(root, "src", "huge.ts"),
      `export const big = "${"x".repeat(4096)}";\n`,
    );
    const artifact = artifactOf(
      scan(root, await atlas(), declarations(), { maxFileBytes: 2048 }),
    );
    // Repository source over the cap is still refused, and says so.
    expect(artifact.limits).toEqual([
      { kind: "file_too_large", path: "src/huge.ts", detail: null },
    ]);
    // The SDK's declarations were read, so the call is still recognized.
    expect(
      artifact.observations.filter(
        (observation) => observation.kind === "provider_call",
      ),
    ).toHaveLength(1);
  });

  it("does not persist a model literal that looks like a credential", async () => {
    const root = await materialize("direct-call");
    const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const source = await readFile(join(root, "src/classify.ts"), "utf8");
    await writeFile(
      join(root, "src/classify.ts"),
      source.replace("gpt-4o-mini", secret),
    );
    const artifact = artifactOf(scan(root, await atlas()));
    expect(callIn(artifact, "classifyTicket").call.model).toEqual({
      kind: "redacted_suspected_secret",
    });
    expect(serializeArtifact(artifact)).not.toContain(secret);
  });

  it("marks budget exhaustion as an explicit unknown", async () => {
    const root = await materialize("sanitizer-cases");
    const artifact = artifactOf(
      scan(root, await atlas(), declarations(), { budget: 5 }),
    );
    expect(
      artifact.unknowns.some(
        (entry) => entry.reason === "analysis_budget_exceeded",
      ),
    ).toBe(true);
    expect(artifact.completeness.status).toBe("incomplete");
  });
});

describe("determinism and input identity", () => {
  it("produces identical content for unchanged inputs and leaves sources byte-identical", async () => {
    const root = await materialize("sanitizer-cases");
    const before = await tree(root);
    const contract = await atlas();
    const first = scan(root, contract);
    const second = scan(root, contract);
    expect(second.contentHash).toBe(first.contentHash);
    expect(serializeArtifact(artifactOf(second))).toBe(
      serializeArtifact(artifactOf(first)),
    );
    expect(await tree(root)).toEqual(before);
    // A copy at a different absolute path produces the same content.
    const copy = await materialize("sanitizer-cases");
    expect(scan(copy, contract).contentHash).toBe(first.contentHash);
  });

  it("changes identity when source, declarations, manifests, resolution inputs or the contract change", async () => {
    const root = await materialize("direct-call");
    const contract = await atlas();
    const base = scan(root, contract);

    const changedContract: ProjectContract = {
      ...contract,
      project: {
        ...contract.project,
        name: `${contract.project.name} (renamed)`,
      },
    };
    expect(scan(root, changedContract).contentHash).not.toBe(base.contentHash);
    expect(
      scan(root, contract, declarations({ sanitizers: [] })).contentHash,
    ).not.toBe(base.contentHash);
    expect(
      scan(root, contract, declarations(), {
        configSource: {
          source: "file",
          path: ".anvilmark/scanner.yaml",
          sha256: `sha256:${"1".repeat(64)}`,
        },
      }).contentHash,
    ).not.toBe(base.contentHash);

    const steps: [string, (text: string) => string][] = [
      [
        "src/classify.ts",
        (text) => `${text}\n// a comment changes the source hash\n`,
      ],
      ["package.json", (text) => text.replace("^4.0.0", "^4.1.0")],
      [
        "node_modules/openai/resources/chat/completions.d.ts",
        (text) => `${text}\n`,
      ],
      [
        "tsconfig.json",
        (text) => text.replace('"strict": true', '"strict": false'),
      ],
    ];
    let previous = base.content.repository.snapshot_hash;
    for (const [path, change] of steps) {
      const file = join(root, path);
      await writeFile(file, change(await readFile(file, "utf8")));
      const next = scan(root, contract);
      expect(next.content.repository.snapshot_hash, path).not.toBe(previous);
      expect(next.contentHash, path).not.toBe(base.contentHash);
      previous = next.content.repository.snapshot_hash;
    }
  });

  it("detects a repository change made while the scan ran", async () => {
    const root = await materialize("direct-call");
    const outcome = scan(root, await atlas());
    expect(outcome.recheck()).toEqual([]);
    await writeFile(
      join(root, "src/tickets.ts"),
      "export function readTicket() { return ''; }\n",
    );
    expect(outcome.recheck()).toEqual(["src/tickets.ts"]);
  });

  it("does not modify the contract object it was given", async () => {
    const root = await materialize("direct-call");
    const contract = await atlas();
    const snapshot = JSON.stringify(contract);
    scan(root, contract);
    expect(JSON.stringify(contract)).toBe(snapshot);
    expect(contract.repository_bindings).toEqual([]);
  });
});

describe("replaceable recognizers and stages", () => {
  it("recognizes a new SDK from recognizer data alone", async () => {
    const root = await materialize("direct-call", []);
    await mkdir(join(root, "node_modules/acme-llm"), { recursive: true });
    await writeFile(
      join(root, "node_modules/acme-llm/package.json"),
      JSON.stringify({
        name: "acme-llm",
        version: "1.0.0",
        types: "index.d.ts",
      }),
    );
    await writeFile(
      join(root, "node_modules/acme-llm/index.d.ts"),
      "// SYNTHETIC test declaration\nexport declare class Acme { complete(request: { text: string }): Promise<string>; }\n",
    );
    await writeFile(
      join(root, "src/acme.ts"),
      `import { Acme } from "acme-llm";\nimport { readTicket } from "./tickets";\nconst acme = new Acme();\nexport async function useAcme(id: string) {\n  return acme.complete({ text: readTicket(id) });\n}\n`,
    );
    const acme: ProviderRecognizer = {
      kind: "provider",
      id: "acme",
      version: "1",
      provider: "acme",
      defaultDeployment: "managed_api",
      packages: ["acme-llm"],
      clients: [{ owners: ["Acme"], endpointOptions: [] }],
      operations: [
        {
          id: "complete",
          owners: ["Acme"],
          member: "complete",
          kind: "inference",
          payloadArgument: 0,
          modelProperty: null,
          callPath: ["acme", "complete"],
        },
      ],
      environmentVariables: [],
      basis: "synthetic test recognizer",
    };
    const recognizers = { ...defaultRecognizers(), providers: [acme] };
    const artifact = artifactOf(
      scan(root, await atlas(), declarations({ sinks: [] }), { recognizers }),
    );
    const { call, flow } = callIn(artifact, "useAcme");
    expect(call).toMatchObject({
      provider: "acme",
      operation: "complete",
      model: { kind: "absent" },
    });
    expect(flow.status).toBe("raw_reaches");
    expect(artifact.scanner.recognizers.map((entry) => entry.id)).toContain(
      "acme",
    );
  });

  it("records a replaced stage implementation in the artifact", async () => {
    const root = await materialize("direct-call");
    const artifact = artifactOf(
      scan(root, await atlas(), declarations(), {
        pipeline: {
          evidence: {
            ...DEFAULT_PIPELINE.evidence,
            id: "custom-evidence",
            version: "9",
          },
        },
      }),
    );
    expect(artifact.scanner.stages).toContainEqual({
      stage: "evidence",
      id: "custom-evidence",
      version: "9",
    });
  });

  it("limits providers to configured recognizers and reports unknown ids", async () => {
    const root = await materialize("direct-call");
    const artifact = artifactOf(
      scan(
        root,
        await atlas(),
        declarations({ recognizers: ["ollama", "nope"] }),
      ),
    );
    expect(
      artifact.observations.filter((entry) => entry.kind === "provider_call"),
    ).toEqual([]);
    expect(artifact.limits).toContainEqual({
      kind: "recognizer_id_unknown",
      path: null,
      detail: "nope",
    });
  });
});

describe("scan declaration file", () => {
  it("rejects invalid documents with field paths and no file content", () => {
    const cases = [
      "format: [unclosed",
      `format: ${SCAN_CONFIG_FORMAT}\nunknown_field: true\n`,
      `format: ${SCAN_CONFIG_FORMAT}\nsources:\n  - id: a\n    data_classification: raw_customer_ticket\n    function: { path: /etc/passwd, export: x }\n`,
      `format: ${SCAN_CONFIG_FORMAT}\nexclude: ["../outside"]\n`,
      `format: ${SCAN_CONFIG_FORMAT}\nsinks:\n  - { id: dup, recognizer: openai }\ncomponents:\n  - { id: dup, path: src/a.ts, architecture_node_ref: n }\n`,
      "format: anvilmark-scan-config/9\n",
    ];
    for (const text of cases) {
      const parsed = parseScanConfig(text);
      expect(parsed.ok, text).toBe(false);
      if (parsed.ok) continue;
      expect(JSON.stringify(parsed.issues)).not.toContain("/etc/passwd");
    }
    const ok = parseScanConfig(`format: ${SCAN_CONFIG_FORMAT}\n`);
    expect(ok.ok && ok.config.include).toEqual(["."]);
  });
});

describe("scanner does not reach beyond the machine", () => {
  it("contains no network, process-spawning or file-writing calls in its source", async () => {
    const directory = new URL("../src/", import.meta.url);
    const files: string[] = [];
    const walk = async (path: URL) => {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, path));
        else files.push(await readFile(new URL(entry.name, path), "utf8"));
      }
    };
    await walk(directory);
    const source = files.join("\n");
    expect(source).not.toMatch(
      /from "(?:node:)?(?:child_process|http|https|http2|net|dgram|worker_threads)"/,
    );
    for (const forbidden of [
      "fetch(",
      "writeFileSync",
      "writeFile(",
      "appendFile",
      "spawn(",
      "execSync",
      "execFile",
      "mkdirSync",
      "renameSync",
      "unlinkSync",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    expect(
      (await stat(new URL("../src/boundary.ts", import.meta.url))).isFile(),
    ).toBe(true);
  });
});
