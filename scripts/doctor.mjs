#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const localEnvironment = {
  ...process.env,
  COREPACK_ENABLE_NETWORK: "0",
};
export function preflight() {
  const expected = JSON.parse(
    readFileSync(join(checkout, "package.json"), "utf8"),
  ).packageManager.split("@")[1];
  const result = spawnSync("pnpm", ["--version"], {
    cwd: checkout,
    env: localEnvironment,
    encoding: "utf8",
    timeout: 5000,
  });
  const version = result.status === 0 ? result.stdout.trim() : null;
  return [
    {
      id: "node",
      ok: Number(process.versions.node.split(".")[0]) === 24,
      detail: process.version,
      action: "Use Node.js 24 for this supported onboarding path.",
    },
    {
      id: "pnpm",
      ok: version === expected,
      detail: version ?? "not available locally",
      action: `Install pnpm@${expected}; doctor does not download or activate it.`,
    },
  ];
}
function available(command) {
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((directory) =>
      extensions.some((extension) => {
        try {
          const file = join(directory, command + extension);
          accessSync(file, constants.X_OK);
          return statSync(file).isFile();
        } catch {
          return false;
        }
      }),
    );
}
export function diagnose() {
  const checks = preflight();
  checks.push({
    id: "dependencies",
    ok: existsSync(join(checkout, "node_modules/typescript/package.json")),
    detail: "workspace dependencies",
    action: "Run node scripts/setup.mjs from the checkout.",
  });
  for (const [id, path] of [
    ["cli", "packages/cli/bin/anvilmark.mjs"],
    ["project_mcp", "packages/mcp/bin/anvilmark-project-mcp.mjs"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [join(checkout, path), "--help"],
      {
        cwd: checkout,
        env: localEnvironment,
        encoding: "utf8",
        timeout: 10000,
      },
    );
    checks.push({
      id,
      ok: result.status === 0,
      detail:
        result.status === 0 ? "entry point ready" : "entry point unavailable",
      action: "Run node scripts/setup.mjs from the checkout.",
    });
  }
  return {
    ok: checks.every((c) => c.ok),
    checks,
    optional: ["promptfoo", "llmfit"].map((name) => ({
      name,
      available_on_path: available(name),
      required: false,
      note: "Presence only; no execution, download or version/compatibility claim. Missing tools leave evidence gaps.",
    })),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--json")) {
    console.error("Usage: node scripts/doctor.mjs [--json]");
    process.exitCode = 2;
  } else {
    const result = diagnose();
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      for (const check of result.checks)
        console.log(
          `${check.ok ? "READY" : "NEEDS ACTION"} ${check.id}: ${check.detail}${check.ok ? "" : ` — ${check.action}`}`,
        );
      for (const tool of result.optional)
        console.log(
          `OPTIONAL ${tool.name}: ${tool.available_on_path ? "on PATH (not verified)" : "absent; core workflow still works"}`,
        );
    }
    process.exitCode = result.ok ? 0 : 1;
  }
}
