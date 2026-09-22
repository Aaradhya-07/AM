#!/usr/bin/env node
// Post-deploy check for the Playground API: every variant must return the
// engine's own two rule results with no analysis errors.
//
//   node scripts/smoke-playground.mjs [base-url]

/* global fetch */

const base = (process.argv[2] ?? "https://anvilmark.vercel.app").replace(
  /\/$/,
  "",
);

const VARIANTS = [
  ["selected", "redacted", "pass", "pass"],
  ["selected", "raw", "pass", "fail"],
  ["different", "redacted", "fail", "pass"],
  ["different", "raw", "fail", "fail"],
  ["dynamic", "redacted", "unknown", "pass"],
  ["dynamic", "raw", "unknown", "fail"],
];

let failures = 0;
for (const [model, dataHandling, expectedModel, expectedFlow] of VARIANTS) {
  const label = `${model} + ${dataHandling}`;
  let problem = null;
  try {
    const response = await fetch(`${base}/api/playground/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, dataHandling }),
    });
    const body = await response.json();
    const results = body.report?.results ?? [];
    const verdict = (kind) =>
      results.find((entry) => entry.rule_kind === kind)?.verdict;
    const analysisErrors = body.report?.analysis_errors ?? body.analysisErrors;

    if (response.status !== 200) {
      problem = `HTTP ${response.status} ${JSON.stringify(analysisErrors ?? body.error)}`;
    } else if (analysisErrors?.length > 0 || results.length !== 2) {
      problem = `engine produced ${results.length} results, analysis errors ${JSON.stringify(analysisErrors)}`;
    } else if (
      verdict("approved_candidate_only") !== expectedModel ||
      verdict("forbid_dataflow") !== expectedFlow
    ) {
      problem = `verdicts model=${verdict("approved_candidate_only")} flow=${verdict("forbid_dataflow")}, expected ${expectedModel}/${expectedFlow}`;
    }
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }

  if (problem) {
    failures += 1;
    console.log(`FAIL ${label}: ${problem}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

if (failures > 0) {
  console.log(`\n${failures} of ${VARIANTS.length} variants failed at ${base}`);
  process.exit(1);
}
console.log(
  `\nAll ${VARIANTS.length} variants returned engine results at ${base}`,
);
