#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateCases,
  summarize,
  taskProfileRequest,
  validateCases,
} from "./task-profile.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const sample = join(root, "cases.sample.json");
const defaultPricing = {
  inputUsdPerMillion: 0.042,
  outputUsdPerMillion: 0,
  observed_at: "2026-10-17",
  source: "https://typesafe.ai/",
};

function options(argv) {
  const parsed = {
    mode: "preview",
    cases: sample,
    model: "jev-latest",
    report: null,
    pricing: { ...defaultPricing },
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") return { help: true };
    if (arg === "--live") {
      parsed.mode = "live";
      continue;
    }
    if (arg === "--preview") {
      parsed.mode = "preview";
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`missing value for ${arg}`);
    if (arg === "--cases") parsed.cases = resolve(value);
    else if (arg === "--model") parsed.model = value;
    else if (arg === "--report") parsed.report = resolve(value);
    else if (arg === "--input-usd-per-million")
      parsed.pricing.inputUsdPerMillion = Number(value);
    else if (arg === "--output-usd-per-million")
      parsed.pricing.outputUsdPerMillion = Number(value);
    else throw new Error(`unknown option ${arg}`);
  }
  if (
    ![
      parsed.pricing.inputUsdPerMillion,
      parsed.pricing.outputUsdPerMillion,
    ].every((n) => Number.isFinite(n) && n >= 0)
  ) {
    throw new Error("prices must be nonnegative numbers");
  }
  if (
    parsed.pricing.inputUsdPerMillion !== defaultPricing.inputUsdPerMillion ||
    parsed.pricing.outputUsdPerMillion !== defaultPricing.outputUsdPerMillion
  ) {
    parsed.pricing.observed_at = "user_supplied";
    parsed.pricing.source = "command_line";
  }
  return parsed;
}

function help() {
  return `Jev task-profile experiment

Usage:
  node experiments/jev-task-profile/run.mjs [--cases FILE] [--preview]
  node experiments/jev-task-profile/run.mjs --live [--cases FILE] [--model ID]
       [--report FILE] [--input-usd-per-million N] [--output-usd-per-million N]

Preview prints the exact task descriptions and questions that a live run would send.
Live mode sends them to TypeSafe and requires TYPESAFE_API_KEY. It writes a local
JSON report with labels, timing, token usage and estimated provider cost.
`;
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(help());
    return;
  }
  const cases = validateCases(JSON.parse(await readFile(opts.cases, "utf8")));
  if (opts.mode === "preview") {
    process.stdout.write(
      `${cases.length} cases. Each request below contains exactly what live mode sends.\n`,
    );
    for (const item of cases) {
      process.stdout.write(
        `\nCase ${item.id}:\n${JSON.stringify(taskProfileRequest(item, opts.model), null, 2)}\n`,
      );
    }
    return;
  }
  if (!process.env.TYPESAFE_API_KEY)
    throw new Error("set TYPESAFE_API_KEY before --live");
  const results = await evaluateCases(cases, {
    apiKey: process.env.TYPESAFE_API_KEY,
    model: opts.model,
    pricing: opts.pricing,
  });
  const summary = summarize(results);
  const report = {
    format: "anvilmark-jev-task-profile-experiment/1",
    recorded_at: new Date().toISOString(),
    dataset: opts.cases,
    model_requested: opts.model,
    models_observed: [
      ...new Set(results.filter((row) => row.model).map((row) => row.model)),
    ],
    pricing: opts.pricing,
    summary,
    results,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path =
    opts.report ??
    join(root, "results", `${stamp}-${randomBytes(3).toString("hex")}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify(summary, null, 2)}\nReport: ${path}\n`,
  );
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message ?? error}\n`);
  process.exitCode = 1;
});
