#!/usr/bin/env node
// Exports review bundles for committed synthetic Atlas fixtures only. Never
// reads a user's project. Run after `pnpm build`; pass --check to verify the
// committed bundles reproduce exactly.
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
  finalizeArtifact,
  SCAN_CONFIG_FORMAT,
  ScanConfigSchema,
  scanRepository,
} from "../packages/scanner/dist/index.js";
import {
  assembleWebReviewBundle,
  evaluateConformance,
  readReport,
  readWebReviewBundle,
  serializeReport,
} from "../packages/conformance/dist/index.js";
import { collectReviewSources } from "../packages/cli/dist/review-sources.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const asOf = "2026-09-16T12:00:00Z";
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 1 && args[0] === "--check"),
  "Usage: node scripts/export-review-bundle-fixtures.mjs [--check]",
);

const approvedPath =
  "packages/conformance/test/fixtures/approved-remote-atlas.yaml";
const contract = unwrap(
  parseProjectContract(readFileSync(join(root, approvedPath), "utf8"), "yaml"),
);
const APPROVED_MODEL = "gpt-4o-mini-2024-07-18";

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
      export: "classifyTicket",
      architecture_node_ref: "ticket-classifier",
      workload_ref: "classification",
    },
  ],
});

// [output, repository fixture, model literal, projection, expected verdicts]
const BUNDLES = [
  [
    "packages/web/test/fixtures/review-bundle-pass.json",
    "handoff-approved-sanitized",
    APPROVED_MODEL,
    "local",
    ["pass", "pass"],
  ],
  [
    "packages/web/test/fixtures/review-bundle-fail.json",
    "handoff-disallowed-raw",
    APPROVED_MODEL,
    "local",
    ["pass", "fail"],
  ],
  // Served by Studio's "Load the Atlas example"; published, so shareable.
  [
    "packages/web/public/examples/atlas-review-bundle.json",
    "handoff-disallowed-raw",
    "synthetic-unapproved-model",
    "shareable",
    ["fail", "fail"],
  ],
];

const scratch = mkdtempSync(join(tmpdir(), "anvilmark-review-bundles-"));
try {
  const differences = [];
  for (const [output, fixture, model, projection, verdicts] of BUNDLES) {
    const repository = join(scratch, output.replaceAll("/", "_"));
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
    const pin = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) pin(file);
        else if (entry.name.endsWith(".ts"))
          writeFileSync(
            file,
            readFileSync(file, "utf8").replaceAll(
              '"gpt-4o-mini"',
              JSON.stringify(model),
            ),
          );
      }
    };
    pin(join(repository, "src"));

    const scanned = scanRepository({
      repositoryPath: repository,
      repositoryRoot: ".",
      repositoryDeclaredInContract: true,
      deniedDirectories: [join(repository, ".anvilmark")],
      contract,
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
        evaluateConformance({ contract, scan, evaluatedAt: asOf }),
      ),
    );
    assert.deepEqual(report.analysis_errors, []);
    assert.deepEqual(
      report.results.map((result) => result.verdict),
      verdicts,
      `${output}: unexpected verdicts`,
    );

    const paths = new Set();
    const expectedHashes = new Map(
      scan.repository.inputs.map((input) => [input.path, input.sha256]),
    );
    for (const result of report.results) {
      for (const location of result.locations) paths.add(location.path);
      for (const step of result.trace) if (step.path) paths.add(step.path);
    }
    const collected = await collectReviewSources({
      repositoryRoot: repository,
      paths,
      expectedHashes,
    });
    assert.deepEqual(collected.omitted, []);

    const bundle = assembleWebReviewBundle({
      contract,
      scan: { artifact: scan, freshness: "current" },
      report: { artifact: report, freshness: "current" },
      sources: collected.sources,
      projection,
      sourceControl: null,
      generator: "scripts/export-review-bundle-fixtures.mjs",
      exportedAt: asOf,
    });
    const reading = readWebReviewBundle(bundle);
    assert.equal(
      reading.status,
      "valid",
      reading.status === "invalid" ? reading.errors.join("\n") : "",
    );
    assert.deepEqual(findSecrets(bundle.contract.canonical), []);

    const target = join(root, output);
    const serialized = await format(JSON.stringify(bundle), {
      ...(await resolveConfig(target)),
      parser: "json",
    });
    assert(!serialized.includes(scratch), "Temporary path leaked into bundle");
    assert(
      !/\/Users\/|\/private\/var\/|\/private\/tmp\/|\/home\//.test(serialized),
      `Absolute host path in ${output}`,
    );

    if (args[0] === "--check") {
      let committed = null;
      try {
        committed = readFileSync(target, "utf8");
      } catch {
        // Reported as a difference below.
      }
      if (committed !== serialized) differences.push(output);
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, serialized);
    }
  }

  if (args[0] === "--check") {
    assert.deepEqual(
      differences,
      [],
      "Review bundles differ; regenerate them with node scripts/export-review-bundle-fixtures.mjs and review the change",
    );
    console.log(`${BUNDLES.length} review bundles reproduce exactly.`);
  } else {
    console.log(`Exported ${BUNDLES.length} synthetic Atlas review bundles.`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
