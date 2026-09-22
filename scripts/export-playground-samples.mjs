#!/usr/bin/env node
// Exports committed synthetic fixtures only. Never reads a user's project.
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  findSecrets,
  parseProjectContract,
  unwrap,
} from "../packages/project-contract/dist/index.js";
import {
  buildProjectFacts,
  renderMermaid,
} from "../packages/context/dist/index.js";
import {
  finalizeArtifact,
  SCAN_CONFIG_FORMAT,
  ScanConfigSchema,
  scanRepository,
} from "../packages/scanner/dist/index.js";
import {
  evaluateConformance,
  readReport,
  serializeReport,
} from "../packages/conformance/dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(
  root,
  "docs/handoffs/emergent-playground/samples/atlas.json",
);
const asOf = "2026-09-16T12:00:00Z";
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 1 && args[0] === "--check"),
  "Usage: node scripts/export-playground-samples.mjs [--check]",
);
const readContract = (path) =>
  unwrap(parseProjectContract(readFileSync(join(root, path), "utf8"), "yaml"));
const draftPath = "docs/vnext/fixtures/atlas-project.draft.yaml";
const approvedPath =
  "packages/conformance/test/fixtures/approved-remote-atlas.yaml";
const draft = readContract(draftPath);
const approved = readContract(approvedPath);
assert.equal(draft.approvals.length, 0);
const facts = (contract) =>
  buildProjectFacts(contract, {
    asOf,
    projection: "remote-default",
    stateRevision: null,
  });
const draftFacts = facts(draft);
const approvedFacts = facts(approved);
const config = ScanConfigSchema.parse({
  format: SCAN_CONFIG_FORMAT,
  sources: [
    {
      id: "source.raw_ticket",
      data_classification: "raw_customer_ticket",
      function: { path: "src/tickets.ts", export: "readTicket" },
      architecture_node_ref: "ticket-intake",
    },
  ],
  sanitizers: [
    {
      id: "sanitizer.pii",
      function: { path: "src/redact.ts", export: "redactTicket" },
      clears: ["raw_customer_ticket"],
      produces: "redacted_customer_ticket",
      architecture_node_ref: "pii-redactor",
    },
  ],
  sinks: [
    {
      id: "sink.openai",
      recognizer: "openai",
      architecture_node_ref: "remote-model-provider",
      candidate_ref: "candidate.classification.remote_unselected",
    },
  ],
  components: [
    {
      id: "component.classifier",
      path: "src/classify.ts",
      architecture_node_ref: "ticket-classifier",
      workload_ref: "classification",
    },
  ],
});
const scratch = mkdtempSync(join(tmpdir(), "anvilmark-playground-samples-"));
try {
  const scenarios = [];
  for (const [id, fixture, model, verdict, label] of [
    [
      "violation",
      "handoff-disallowed-raw",
      "synthetic-unapproved-model",
      "fail",
      "Wrong model and raw ticket data",
    ],
    [
      "corrected",
      "handoff-approved-sanitized",
      "gpt-4o-mini-2024-07-18",
      "pass",
      "Corrected model and declared redaction",
    ],
    [
      "ambiguous",
      "handoff-ambiguous-runtime",
      "gpt-4o-mini-2024-07-18",
      "unknown",
      "Unresolved runtime dispatch",
    ],
  ]) {
    const repository = join(scratch, id);
    cpSync(
      join(root, "packages/scanner/test/fixtures/repositories", fixture),
      repository,
      { recursive: true },
    );
    cpSync(
      join(root, "packages/scanner/test/fixtures/synthetic-sdks/openai"),
      join(repository, "node_modules/openai"),
      { recursive: true },
    );
    const sourceFiles = {};
    function pin(directory, relative = "src") {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
        (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      )) {
        const file = join(directory, entry.name);
        const path = `${relative}/${entry.name}`;
        if (entry.isDirectory()) pin(file, path);
        else if (entry.name.endsWith(".ts")) {
          const content = readFileSync(file, "utf8").replaceAll(
            '"gpt-4o-mini"',
            JSON.stringify(model),
          );
          writeFileSync(file, content);
          sourceFiles[path] = content;
        }
      }
    }
    pin(join(repository, "src"));
    const scanned = scanRepository({
      repositoryPath: repository,
      repositoryRoot: ".",
      repositoryDeclaredInContract: true,
      deniedDirectories: [join(repository, ".anvilmark")],
      contract: approved,
      stateRevision: null,
      config,
      configSource: { source: "default" },
    });
    const scan = finalizeArtifact(scanned.content, {
      observed_at: asOf,
      basis: "explicit",
    });
    const report = readReport(
      serializeReport(
        evaluateConformance({ contract: approved, scan, evaluatedAt: asOf }),
      ),
    );
    assert.deepEqual(report.analysis_errors, []);
    assert.deepEqual(
      report.results.map((result) => result.verdict),
      [verdict, verdict],
    );
    assert.equal(
      report.contract.contract_hash,
      approvedFacts.source.contract_hash,
    );
    for (const result of report.results) {
      for (const location of result.locations)
        assert(
          Object.hasOwn(sourceFiles, location.path),
          `Missing source sample: ${location.path}`,
        );
    }
    scenarios.push({
      id,
      label,
      contract_ref: "synthetic_approved",
      fixture,
      model_literal: model,
      report,
      source_files: sourceFiles,
    });
  }
  const bundle = {
    format: "anvilmark-playground-samples/1",
    synthetic: true,
    notice:
      "Recorded synthetic examples, not live scans. Fixture approval represents no real person's decision. No provider calls or empirical redaction measurements were made.",
    generated_as_of: asOf,
    source: {
      base_commit: "04a35556325f47e627f6c2bfafd8bf7499c6cc2f",
      generator: "scripts/export-playground-samples.mjs",
      draft_contract: draftPath,
      synthetic_approved_contract: approvedPath,
    },
    contracts: {
      draft: {
        label: "Unapproved Atlas draft",
        facts: draftFacts,
        mermaid: renderMermaid(draftFacts),
      },
      synthetic_approved: {
        label: "Synthetic approved example",
        facts: approvedFacts,
        mermaid: renderMermaid(approvedFacts),
      },
    },
    scan_declarations: config,
    scenarios,
  };
  assert.deepEqual(findSecrets(bundle), []);
  const serialized = await format(JSON.stringify(bundle), {
    ...(await resolveConfig(output)),
    parser: "json",
  });
  assert(
    !serialized.includes(scratch),
    "Temporary host path leaked into samples",
  );
  assert(
    !/\/Users\/|\/private\/var\/|\/private\/tmp\//.test(serialized),
    "Absolute host path in samples",
  );
  if (args[0] === "--check") {
    assert.equal(
      readFileSync(output, "utf8"),
      serialized,
      "Samples differ; regenerate and review them",
    );
    console.log(
      "Playground samples reproduce exactly: fail, pass, unknown; report hashes and source links validated.",
    );
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, serialized);
    console.log(
      "Exported synthetic Atlas playground samples with validated engine results.",
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
