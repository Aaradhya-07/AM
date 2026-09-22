#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { checkout, diagnose, localEnvironment, preflight } from "./doctor.mjs";
const args = process.argv.slice(2);
if (args.length > 0) {
  console.error("Usage: node scripts/setup.mjs");
  process.exitCode = 2;
} else {
  try {
    const unmet = preflight().filter((check) => !check.ok);
    if (unmet.length)
      throw new Error(
        unmet.map((check) => `${check.id}: ${check.action}`).join("\n"),
      );
    for (const args of [
      ["install", "--frozen-lockfile"],
      ["run", "build:core"],
    ]) {
      const result = spawnSync("pnpm", args, {
        cwd: checkout,
        env: localEnvironment,
        stdio: "inherit",
      });
      if (result.status !== 0)
        throw new Error(
          `pnpm ${args.join(" ")} failed; correct the reported error and rerun setup.`,
        );
    }
    const result = diagnose();
    if (!result.ok)
      throw new Error(
        "Core entry-point checks failed; run node scripts/doctor.mjs for details.",
      );
    console.log(
      "Core setup ready. Run node scripts/doctor.mjs, then pnpm run workshop --help for the guided Atlas path.",
    );
  } catch (error) {
    console.error(`Setup: ${error.message}`);
    process.exitCode = 1;
  }
}
