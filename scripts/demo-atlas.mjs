#!/usr/bin/env node
// Offline fixture replay. This exercises built CLI and MCP binaries; it does not
// record a real human approval, launch agent applications, or accept Milestone 7.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseProjectContract,
  toNormalizedYaml,
  unwrap,
} from "../packages/project-contract/dist/index.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_BIN = join(REPO_ROOT, "packages/cli/dist/bin.js");
const MCP_SERVER = join(REPO_ROOT, "packages/mcp/dist/project-server.js");
const FIXTURES = join(REPO_ROOT, "packages/scanner/test/fixtures");
const AS_OF = "2026-09-15T12:00:00Z";
const MODEL = "gpt-4o-mini-2024-07-18";
const step = (number, title) => console.log(`\n[Step ${number}/8] ${title}`);
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function runCli(args, cwd, expected = 0) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      ANVILMARK_CONFIG_HOME: join(cwd, "no-host-config"),
      FORCE_COLOR: "0",
    },
  });
  assert(
    result.status === expected,
    `${args[0]} expected exit ${expected}, received ${result.status}: ${result.stderr}\n${result.stdout}`,
  );
  return result.stdout;
}

async function runDemo() {
  console.log("ANVILMARK — Offline Atlas fixture replay");
  step(1, "Preflight & Packaging Verification");
  assert(
    Number.parseInt(process.versions.node.split(".")[0], 10) >= 20,
    "Node >= 20 required",
  );
  statSync(CLI_BIN);
  statSync(MCP_SERVER);
  const workspace = mkdtempSync(join(tmpdir(), "anvilmark-demo-workspace-"));
  const keep = process.argv.slice(2).includes("--keep");
  const draft = join(workspace, "draft");
  const project = join(workspace, "project");
  const repository = join(workspace, "app");
  const clients = [];
  try {
    mkdirSync(draft);
    mkdirSync(project);
    mkdirSync(repository);
    step(2, "Initialize Atlas Project from Contract Specification");
    runCli(
      [
        "init",
        "--from-contract",
        join(REPO_ROOT, "docs/vnext/fixtures/atlas-project.draft.yaml"),
        "--intelligence",
        "handoff",
      ],
      draft,
    );
    step(3, "Compare Workload Candidates & Identify Evidence Gaps");
    const comparison = runCli(
      ["compare", "--workload", "classification", "--as-of", AS_OF],
      draft,
    );
    assert(
      comparison.includes("classification"),
      "Comparison must identify the requested workload",
    );
    console.log(
      "Compared the draft contract candidates; no live evidence or provider evaluation was requested.",
    );

    step(4, "Synthetic Approval Fixture & Context Generation");
    const contract = unwrap(
      parseProjectContract(
        readFileSync(
          join(
            REPO_ROOT,
            "packages/conformance/test/fixtures/approved-remote-atlas.yaml",
          ),
          "utf8",
        ),
        "yaml",
      ),
    );
    contract.project.repository_roots = ["../app"];
    const contractFile = join(workspace, "fixture.yaml");
    writeFileSync(contractFile, toNormalizedYaml(contract));
    runCli(
      ["init", "--from-contract", contractFile, "--intelligence", "handoff"],
      project,
    );
    runCli(["generate", "--as-of", AS_OF], project);
    console.log(
      `Loaded a synthetic approved OpenAI/${MODEL} decision in a separate test project. No real human approval is represented.`,
    );
    const contractBefore = readFileSync(
      join(project, ".anvilmark/project.yaml"),
      "utf8",
    );

    step(5, "MCP Stdio Harness Consistency");
    const { startStdioServer } =
      await import("../packages/mcp/scripts/stdio-client.mjs");
    for (const name of ["atlas-fixture-client-a", "atlas-fixture-client-b"]) {
      const client = startStdioServer(process.execPath, [
        MCP_SERVER,
        "--project-dir",
        project,
        "--as-of",
        AS_OF,
      ]);
      clients.push(client);
      const initialized = await client.initialize({
        name,
        version: "fixture-replay",
      });
      assert(initialized.result?.serverInfo, "MCP initialize failed");
    }
    const listed = await clients[0].request("tools/list", {});
    assert(listed.result.tools.length === 8, "Expected eight project tools");
    for (const [name, args] of [
      ["get_project_summary", {}],
      ["get_workload_decision", { workload: "classification" }],
      ["get_architecture_context", { component: "ticket-classifier" }],
      ["get_constraints", { workload: "classification", severity: "hard" }],
    ]) {
      const responses = await Promise.all(
        clients.map((c) => c.request("tools/call", { name, arguments: args })),
      );
      assert(
        responses.every(
          (r) =>
            r.result && !r.result.isError && r.result.structuredContent?.ok,
        ),
        `${name} returned an error`,
      );
      assert(
        JSON.stringify(responses[0].result) ===
          JSON.stringify(responses[1].result),
        `${name} response mismatch`,
      );
    }
    console.log(
      "Four queries matched across two stdio harness clients. Agent application compatibility is not tested here.",
    );

    const config = `format: anvilmark-scan-config/0.1.0-draft.1
sources:
  - id: source.raw_ticket
    data_classification: raw_customer_ticket
    function: { path: src/tickets.ts, export: readTicket }
    architecture_node_ref: ticket-intake
sanitizers:
  - id: sanitizer.pii
    function: { path: src/redact.ts, export: redactTicket }
    clears: [raw_customer_ticket]
    produces: redacted_customer_ticket
    architecture_node_ref: pii-redactor
sinks:
  - id: sink.openai
    recognizer: openai
    architecture_node_ref: remote-model-provider
    candidate_ref: candidate.classification.remote_unselected
components:
  - id: component.classifier
    path: src/classify.ts
    architecture_node_ref: ticket-classifier
    workload_ref: classification
`;
    writeFileSync(join(project, ".anvilmark/scanner.yaml"), config);
    cpSync(
      join(FIXTURES, "synthetic-sdks/openai"),
      join(repository, "node_modules/openai"),
      { recursive: true },
    );
    function prepareSource(fixture, model = MODEL) {
      // Only replace the synthetic source inside this freshly created workspace.
      rmSync(join(repository, "src"), { recursive: true, force: true });
      cpSync(join(FIXTURES, "repositories", fixture), repository, {
        recursive: true,
      });
      function pin(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) pin(path);
          else if (path.endsWith(".ts"))
            writeFileSync(
              path,
              readFileSync(path, "utf8").replaceAll(
                '"gpt-4o-mini"',
                JSON.stringify(model),
              ),
            );
        }
      }
      pin(join(repository, "src"));
    }
    function conformance(expectedExit, expectedVerdicts) {
      const report = JSON.parse(
        runCli(
          [
            "conformance",
            "--repository",
            repository,
            "--evaluated-at",
            AS_OF,
            "--json",
          ],
          project,
          expectedExit,
        ),
      );
      assert(
        report.analysis_errors.length === 0,
        "Fixture evaluation had analysis errors",
      );
      for (const [kind, verdict] of Object.entries(expectedVerdicts))
        assert(
          report.results.some(
            (r) => r.rule_kind === kind && r.verdict === verdict,
          ),
          `Missing ${kind}=${verdict}`,
        );
      assert(
        report.results.length === 2,
        "Expected two independent Atlas rule results",
      );
      assert(
        readFileSync(join(project, ".anvilmark/project.yaml"), "utf8") ===
          contractBefore,
        "The contract changed during replay",
      );
      return report;
    }
    step(6, "Deliberate Violation — Wrong Model & Raw Customer Data");
    prepareSource("handoff-disallowed-raw", "synthetic-unapproved-model");
    runCli(
      ["scan", "--repository", repository, "--observed-at", AS_OF],
      project,
    );
    const failure = conformance(1, {
      approved_candidate_only: "fail",
      forbid_dataflow: "fail",
    });
    assert(
      failure.results.every((r) => r.locations.length > 0),
      "Violations require source locations",
    );
    console.log(
      "Both rules FAIL (exit 1), with source locations and independent provider/privacy findings.",
    );

    step(7, "Correct Source & Recheck the Same Contract");
    prepareSource("handoff-approved-sanitized");
    // Conformance must re-read source even though the saved scan is still the failing one.
    const passing = conformance(0, {
      approved_candidate_only: "pass",
      forbid_dataflow: "pass",
    });
    assert(passing.summary.compliant, "Compliant fixture must pass");
    runCli(["conformance", "--check", "--repository", repository], project);
    const reportPath = join(project, ".anvilmark/conformance/conformance.json");
    const reportBytes = readFileSync(reportPath, "utf8");
    runCli(
      [
        "conformance",
        "--repository",
        repository,
        "--evaluated-at",
        "2026-09-16T12:00:00Z",
      ],
      project,
    );
    assert(
      readFileSync(reportPath, "utf8") === reportBytes,
      "Unchanged report bytes must remain stable",
    );
    console.log(
      "Both rules PASS (exit 0), with a current, byte-stable report and unchanged contract.",
    );

    step(8, "Ambiguous Runtime Dispatch Remains Unknown");
    prepareSource("handoff-ambiguous-runtime");
    conformance(2, {
      approved_candidate_only: "unknown",
      forbid_dataflow: "unknown",
    });
    console.log(
      "Both rules UNKNOWN (exit 2); unsupported dispatch is not counted as compliant.",
    );
    console.log("\nOFFLINE ATLAS FIXTURE REPLAY COMPLETE");
    console.log(
      "Verified bounded fixture behavior through built binaries. This is not a real-project approval, runtime privacy guarantee, or Milestone 7 acceptance.",
    );
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    if (keep) console.log(`Workspace preserved at: ${workspace}`);
    else rmSync(workspace, { recursive: true, force: true });
  }
}
runDemo().catch((error) => {
  console.error(`DEMO FAILED: ${error.message}`);
  process.exitCode = 1;
});
