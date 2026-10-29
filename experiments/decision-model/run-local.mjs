#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateCases,
  summarize,
  validateCases,
} from "../jev-task-profile/task-profile.mjs";
import { classifyLocal } from "./lexical-baseline.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const defaultCases = join(root, "..", "jev-task-profile", "cases.sample.json");

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 2 || (args.length === 2 && args[0] !== "--cases")) {
    throw new Error(
      "usage: node experiments/decision-model/run-local.mjs [--cases FILE]",
    );
  }
  const casesPath = args.length === 2 ? resolve(args[1]) : defaultCases;
  const cases = validateCases(JSON.parse(await readFile(casesPath, "utf8")));
  const results = await evaluateCases(cases, {
    call: async (request) => {
      const started = performance.now();
      const response = classifyLocal(request);
      return {
        response,
        duration_ms: Number((performance.now() - started).toFixed(3)),
      };
    },
  });
  const summary = summarize(results);
  const report = {
    format: "anvilmark-decision-model-experiment/1",
    recorded_at: new Date().toISOString(),
    dataset: casesPath,
    model: "anvilmark-lexical-baseline/0.1",
    probability_status: "uncalibrated",
    cost_basis: "local CPU cost not measured",
    summary,
    results,
  };
  const path = join(
    root,
    "results",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify(summary, null, 2)}\nReport: ${path}\n`,
  );
  if (summary.failed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message ?? error}\n`);
  process.exitCode = 1;
});
