import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [resolve(packageRoot, "dist/index.js")], {
  cwd: packageRoot,
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let initialized = false;

const timeout = setTimeout(() => {
  child.kill();
  throw new Error(`Timed out waiting for tools/list. ${stderr}`);
}, 10_000);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
  const lines = stdout.split("\n");
  stdout = lines.pop() ?? "";

  for (const line of lines.filter(Boolean)) {
    const message = JSON.parse(line);

    if (message.id === 1 && !initialized) {
      initialized = true;
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    }

    if (message.id === 2) {
      clearTimeout(timeout);
      const names = message.result.tools.map((tool) => tool.name).sort();
      const expected = [
        "audit_system",
        "estimate_cost",
        "explain_finding",
      ].sort();

      if (JSON.stringify(names) !== JSON.stringify(expected)) {
        child.kill();
        throw new Error(
          `Unexpected tools/list response: ${JSON.stringify(message)}`,
        );
      }

      console.log(`tools/list OK: ${names.join(", ")}`);
      child.kill();
    }
  }
});

child.on("error", (error) => {
  clearTimeout(timeout);
  throw error;
});

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2026-07-28",
    capabilities: {},
    clientInfo: { name: "anvilmark-smoke-test", version: "0.1.0" },
  },
});
