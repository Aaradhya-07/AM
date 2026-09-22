#!/usr/bin/env node
import { existsSync } from "node:fs";
import { URL } from "node:url";
const entry = new URL("../dist/project-server.js", import.meta.url);
if (!existsSync(entry)) {
  console.error(
    "ANVILMARK project MCP is not built. Run node scripts/setup.mjs from the ANVILMARK checkout, then retry.",
  );
  process.exitCode = 2;
} else {
  try {
    await import(entry.href);
  } catch (error) {
    console.error(
      `ANVILMARK project MCP could not start: ${error.message}\nRun node scripts/setup.mjs from the checkout to restore dependencies and build.`,
    );
    process.exitCode = 2;
  }
}
