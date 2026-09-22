// Protocol-level verification of the read-only project server over real stdio.
//
// Builds a temporary Atlas project with the built CLI, starts
// bin/anvilmark-project-mcp.mjs, and checks: initialize, tools/list (exactly eight
// read-only tools), a call to every tool, invalid filters, identical answers for
// two clients that identify as Claude Code and Codex, and that the project tree
// is byte-identical afterwards. No model, client application or network is used;
// this is not a live-client demonstration.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startStdioServer } from "./stdio-client.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");
const server = join(packageRoot, "bin/anvilmark-project-mcp.mjs");
const cliBin = join(repoRoot, "packages/cli/dist/bin.js");
const asOf = "2026-09-14T00:00:00Z";
const expectedTools = [
  "get_project_summary",
  "get_constraints",
  "get_workload_decision",
  "get_architecture_context",
  "list_evidence_gaps",
  "run_conformance",
  "check_proposed_change",
  "get_conformance_result",
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function digestTree(root) {
  const result = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else
        result[path.slice(root.length + 1)] = createHash("sha256")
          .update(readFileSync(path))
          .digest("hex");
    }
  };
  walk(root);
  return JSON.stringify(result);
}

// --project-dir DIR checks an existing project instead of a temporary Atlas one.
const given = process.argv.indexOf("--project-dir");
const existing = given >= 0 ? resolve(process.argv[given + 1] ?? ".") : null;
const root = existing ?? mkdtempSync(join(tmpdir(), "anvilmark-verify-mcp-"));
try {
  const init =
    existing !== null
      ? { status: 0 }
      : spawnSync(
          process.execPath,
          [
            cliBin,
            "init",
            "--from-contract",
            join(repoRoot, "docs/vnext/fixtures/atlas-project.draft.yaml"),
          ],
          {
            cwd: root,
            encoding: "utf8",
            env: {
              PATH: process.env.PATH ?? "",
              HOME: root,
              ANVILMARK_CONFIG_HOME: join(root, "no-host-config"),
            },
          },
        );
  if (init.status !== 0) throw new Error(`init failed: ${init.stderr}`);
  const before = digestTree(root);

  const clients = [];
  for (const name of ["claude-code", "codex-mcp-client"]) {
    const client = startStdioServer(process.execPath, [
      server,
      "--project-dir",
      root,
      "--as-of",
      asOf,
    ]);
    const response = await client.initialize({ name, version: "verification" });
    console.log(
      `${name}: initialize -> ${response.result.serverInfo.name}@${response.result.serverInfo.version}, protocol ${response.result.protocolVersion}`,
    );
    clients.push(client);
  }

  const list = await clients[0].request("tools/list", {});
  const names = list.result.tools.map((tool) => tool.name);
  if (JSON.stringify(names) !== JSON.stringify(expectedTools))
    fail(`tools/list returned ${names.join(", ")}`);
  if (
    !list.result.tools.every((tool) => tool.annotations?.readOnlyHint === true)
  )
    fail("a tool is not marked readOnlyHint");
  console.log(`tools/list: ${names.join(", ")} (all readOnlyHint)`);

  const calls = [
    ["get_project_summary", {}],
    ["get_constraints", { workload: "classification", severity: "hard" }],
    ["get_workload_decision", { workload: "classification" }],
    ["get_architecture_context", { component: "ticket-classifier" }],
    ["list_evidence_gaps", { workload: "pii_redaction" }],
    ["get_workload_decision", { workload: "billing" }],
    ["get_architecture_context", { component: "mainframe" }],
    ["get_constraints", { unexpected: true }],
    ["run_conformance", { workload: "classification" }],
    [
      "check_proposed_change",
      {
        workload: "classification",
        candidate_ref: "candidate.classification.remote_unselected",
      },
    ],
    ["get_conformance_result", { result_id: "nonexistent" }],
  ];
  let identical = 0;
  for (const [name, args] of calls) {
    const results = [];
    for (const client of clients) {
      const response = await client.request("tools/call", {
        name,
        arguments: args,
      });
      results.push(response.result);
    }
    const body = results[0].structuredContent;
    const marker =
      body.source === null
        ? "no source"
        : `${body.source.contract_hash.slice(0, 19)}… r${body.source.state_revision}`;
    console.log(
      `tools/call ${name} ${JSON.stringify(args)} -> ${body.ok ? "ok" : `error ${body.error.code}`}${results[0].isError ? " (isError)" : ""}; ${marker}`,
    );
    if (JSON.stringify(results[0]) === JSON.stringify(results[1]))
      identical += 1;
    else fail(`${name} differed between clients`);
  }
  console.log(
    `client parity: ${identical}/${calls.length} responses byte-identical`,
  );

  // --component ID prints how both clients see one architecture component.
  const componentFlag = process.argv.indexOf("--component");
  if (componentFlag >= 0) {
    const component = process.argv[componentFlag + 1];
    const views = [];
    for (const client of clients) {
      const response = await client.request("tools/call", {
        name: "get_architecture_context",
        arguments: { component },
      });
      views.push(JSON.stringify(response.result));
    }
    const body = JSON.parse(views[0]).structuredContent;
    if (!body.ok) {
      fail(`get_architecture_context ${component}: ${body.error.code}`);
    } else {
      const node = body.data.nodes.find((entry) => entry.id === component);
      console.log(
        `component ${component}: knowledge ${node.knowledge}; origin ${node.origin.kind}${node.origin.kind === "user" ? "" : ` (${node.origin.confirmation})`}; declared boundary ${node.trust_boundary}; effective boundary ${node.effective_trust_boundary}; interfaces ${node.interfaces.map((entry) => `${entry.id}:${entry.protocol ?? "unknown"}`).join(", ") || "none"}`,
      );
      for (const relationship of body.data.relationships) {
        console.log(
          `  relationship ${relationship.id}: ${relationship.knowledge}; effective crossing ${relationship.effective_crossing}`,
        );
      }
      console.log(
        `component view parity: ${views[0] === views[1] ? "byte-identical" : "DIFFERENT"}`,
      );
      if (views[0] !== views[1])
        fail("component view differed between clients");
    }
  }

  for (const client of clients) {
    if (client.nonProtocol().length > 0)
      fail(`non-protocol stdout: ${client.nonProtocol().join(" | ")}`);
    await client.close();
  }
  console.log("stdout: JSON-RPC only; diagnostics on stderr");
  if (digestTree(root) !== before) fail("the project tree changed");
  else console.log("project tree: unchanged");
} finally {
  if (existing === null) rmSync(root, { recursive: true, force: true });
}
if (process.exitCode === 1) console.error("verification FAILED");
else console.log("verification passed");
