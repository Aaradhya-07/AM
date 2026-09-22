#!/usr/bin/env node
import { existsSync } from "node:fs";
import { URL } from "node:url";
const entry = new URL("../dist/index.js", import.meta.url);
if (!existsSync(entry)) {
  console.error(
    "ANVILMARK audit MCP is not built. Run node scripts/setup.mjs from the ANVILMARK checkout, then retry.",
  );
  process.exitCode = 2;
} else {
  try {
    await import(entry.href);
  } catch (error) {
    console.error(`ANVILMARK audit MCP could not start: ${error.message}`);
    process.exitCode = 2;
  }
}
