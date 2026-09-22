#!/usr/bin/env node

import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { assertTimestamp } from "@anvilmark/context";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createProjectServer } from "./project-tools.js";

const USAGE = `Usage: anvilmark-project-mcp --project-dir DIR [--projection remote-default|local-disclosed] [--as-of TIMESTAMP]

A read-only MCP server over stdio for the ANVILMARK project in DIR (the directory
containing .anvilmark/). Tools: get_project_summary, get_constraints,
get_workload_decision, get_architecture_context, list_evidence_gaps,
run_conformance, check_proposed_change, get_conformance_result.

Protocol messages use stdout only; diagnostics go to stderr.
--projection defaults to remote-default. local-disclosed adds local-only fields;
a local server does not by itself authorize a client to send them to a remote model.
--as-of fixes the instant evidence freshness is evaluated; by default each call
uses the current time and reports it as as_of.
--hardware-sizing adds pure catalog and estimate tools.
--hardware-probe adds bounded local inventory and fixed loopback discovery;
these opt-in tools disclose machine facts and run read-only collectors. No SSH tool is exposed.`;

function fail(message: string): never {
  process.stderr.write(`anvilmark-project-mcp: ${message}\n\n${USAGE}\n`);
  process.exit(2);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      "project-dir": { type: "string" },
      "hardware-sizing": { type: "boolean" },
      "hardware-probe": { type: "boolean" },
      projection: { type: "string" },
      "as-of": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  }));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (values.help === true) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(0);
}

const projection = values.projection ?? "remote-default";
if (projection !== "remote-default" && projection !== "local-disclosed") {
  fail(
    `--projection must be remote-default or local-disclosed, got "${projection}"`,
  );
}
const asOf = values["as-of"];
if (asOf !== undefined) {
  try {
    assertTimestamp(asOf);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
if (values["project-dir"] === undefined) {
  fail("--project-dir is required");
}
const root = resolve(values["project-dir"]);

const server = createProjectServer({
  root,
  projection,
  hardwareSizing: values["hardware-sizing"] === true,
  hardwareProbe: values["hardware-probe"] === true,
  ...(asOf === undefined ? {} : { asOf }),
  clock: () => new Date().toISOString(),
  diagnostics: (message) => {
    process.stderr.write(`anvilmark-project-mcp: ${message}\n`);
  },
});
await server.connect(new StdioServerTransport());
process.stderr.write(
  `anvilmark-project-mcp: serving ${root} read-only (${projection})\n`,
);
