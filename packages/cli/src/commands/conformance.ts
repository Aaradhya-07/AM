import { resolve } from "node:path";

import type {
  ConformanceReport,
  ConformanceResultRecord,
} from "@anvilmark/conformance";
import { assertTimestamp } from "@anvilmark/context";

import type { CliIo, ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines } from "../render.js";
import {
  CONFORMANCE_OUTPUT_PATH,
  checkConformance,
  runConformance,
} from "../conformance.js";
import { SCAN_CONFIG_PATH } from "../scan.js";
import { StoreError, findProjectRoot } from "../store.js";
import type { CommandContext, OptionSpec, Parsed } from "./common.js";
import { UsageError, flag, parse, stringOption, writeJson } from "./common.js";

export const CONFORMANCE_USAGE = `Usage:
  anvilmark conformance [--repository PATH] [--config FILE] [--evaluated-at TIMESTAMP] [--json]
  anvilmark conformance --check [--repository PATH] [--config FILE] [--json]
  anvilmark check [...]

Evaluates the observed repository against the approved project contract and
produces deterministic, evidence-linked compliance verdicts:
  pass           Sufficient in-scope evidence proves the rule is satisfied.
  fail           Sufficient in-scope evidence proves a violation.
  unknown        The rule applies, but evidence or analysis scope cannot prove pass/fail.
  not_applicable The rule does not apply to this declared subject/revision.

Writes one file:
  ${CONFORMANCE_OUTPUT_PATH}   conformance results, summary, hashes and traces

Inputs
  --repository PATH   the repository (otherwise configuration, saved selection, or contract root)
  --config FILE       scan declarations (otherwise saved configuration or ${SCAN_CONFIG_PATH})
  --evaluated-at TS   evaluation timestamp (default: clock)
  --check             verify whether the stored report is fresh and matches current state
  --json              emit the full report as JSON

Exit codes
  conformance         0 compliant (all rules passed or not applicable)
                      1 conformance violation (one or more rules failed)
                      2 unknown/inconclusive or error
  conformance --check 0 stored report is current and fresh
                      1 missing, stale, invalid, or tampered report
                      2 usage or internal error`;

async function projectRoot(io: CliIo, parsed: Parsed): Promise<string> {
  const explicit = stringOption(parsed, "project-dir");
  const root =
    explicit === undefined
      ? await findProjectRoot(io.cwd)
      : resolve(io.cwd, explicit);
  if (root === null) {
    throw new StoreError(
      `no ANVILMARK project found in ${io.cwd} or any parent directory; run "anvilmark init" first`,
    );
  }
  return root;
}

function renderResult(result: ConformanceResultRecord): string[] {
  const badge = `[${result.verdict.toUpperCase()}]`;
  const ruleLine = `  ${badge} ${result.rule_ref} (${result.rule_kind}, severity: ${result.severity})`;
  const detailLines: string[] = [];

  if (result.workload_ref !== null) {
    detailLines.push(`      workload:    ${result.workload_ref}`);
  }
  if (result.constraint_ref !== null) {
    detailLines.push(`      constraint:  ${result.constraint_ref}`);
  }
  if (result.decision_ref !== null) {
    detailLines.push(`      decision:    ${result.decision_ref}`);
  }
  if (result.locations.length > 0) {
    const locs = result.locations
      .map(
        (l) =>
          `${l.path}:${l.start.line}:${l.start.column}${l.symbol ? ` (${l.symbol})` : ""}`,
      )
      .join(", ");
    detailLines.push(`      location:    ${locs}`);
  }
  if (result.trace.length > 0) {
    const traceStr = result.trace.map((s) => s.kind).join(" -> ");
    detailLines.push(`      trace:       ${traceStr}`);
  }
  detailLines.push(`      explanation: ${result.explanation}`);

  if (result.unknown_reasons.length > 0) {
    detailLines.push(`      unknown:     ${result.unknown_reasons.join(", ")}`);
  }

  const hasUnresolvedImports =
    result.verdict === "unknown" &&
    result.unknown_reasons.includes("unresolved_import");

  const offendingPaths: string[] = [];
  if (hasUnresolvedImports) {
    const importLocations = result.locations.filter((l) => l.symbol === null);
    const candidateLocations =
      importLocations.length > 0 ? importLocations : result.locations;
    for (const loc of candidateLocations) {
      if (!offendingPaths.includes(loc.path)) {
        offendingPaths.push(loc.path);
        if (offendingPaths.length === 5) break;
      }
    }
  }

  if (offendingPaths.length > 0) {
    detailLines.push("      offending paths:");
    for (const p of offendingPaths) {
      detailLines.push(`        - ${p}`);
    }
  }

  if (result.caveats.length > 0) {
    detailLines.push(`      caveats:     ${result.caveats.join("; ")}`);
  }

  const remediations: string[] = [];
  for (const alt of result.suggested_alternatives) {
    remediations.push(`        - ${alt.summary}`);
  }
  if (offendingPaths.length > 0) {
    remediations.push(
      "        - Scope them out in scanner.yaml:",
      "            exclude:",
      ...offendingPaths.map((p) => `              - ${p}`),
    );
  }

  if (remediations.length > 0) {
    detailLines.push("      suggested remediation:", ...remediations);
  }

  return [ruleLine, ...detailLines];
}

function renderReport(report: ConformanceReport): string {
  const out: string[] = [
    "ANVILMARK Conformance Report",
    `  evaluated_at:     ${report.evaluated_at}`,
    `  conformance_hash: ${report.conformance_hash}`,
    `  contract:         ${report.contract.project_id} revision ${report.contract.contract_revision} (${report.contract.contract_hash})`,
    `  repository:       ${report.scan.repository_root} snapshot ${report.scan.snapshot_hash}`,
    `  engine:           ${report.engine.id} ${report.engine.version}`,
    "",
    "Results:",
  ];

  for (const r of report.results) {
    out.push(...renderResult(r));
  }

  out.push("");
  out.push(
    `Summary: ${report.summary.total} rule(s) evaluated (${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.unknown} unknown, ${report.summary.not_applicable} not applicable)`,
  );

  if (report.analysis_errors.length > 0) {
    out.push(
      "Overall Status: ANALYSIS ERROR (no conformance verdict)",
      ...report.analysis_errors.map((e) => `  - ${e}`),
    );
  } else if (report.summary.compliant) {
    out.push("Overall Status: COMPLIANT");
  } else if (report.summary.fail > 0) {
    out.push("Overall Status: CONFORMANCE VIOLATIONS DETECTED");
  } else {
    out.push(
      "Overall Status: UNKNOWN / INCONCLUSIVE (analysis refused to guess)",
    );
  }

  return lines(out);
}

const CONFORMANCE_OPTIONS: OptionSpec = {
  repository: { type: "string" },
  config: { type: "string" },
  check: { type: "boolean" },
  "evaluated-at": { type: "string" },
};

export async function conformanceCommand(
  ctx: CommandContext,
  args: readonly string[],
): Promise<ExitCode> {
  const parsed = parse(args, CONFORMANCE_OPTIONS, CONFORMANCE_USAGE);
  if (flag(parsed, "help") || args.includes("help")) {
    ctx.io.stdout(`${CONFORMANCE_USAGE}\n`);
    return EXIT.ok;
  }
  const root = await projectRoot(ctx.io, parsed);
  const repositoryOption = stringOption(parsed, "repository");
  const configOption = stringOption(parsed, "config");
  const asJson = flag(parsed, "json");
  const isCheck = flag(parsed, "check");
  const evaluatedAt = stringOption(parsed, "evaluated-at");

  if (evaluatedAt !== undefined) {
    try {
      assertTimestamp(evaluatedAt);
    } catch {
      throw new UsageError(
        "--evaluated-at must be an RFC 3339 timestamp with an explicit offset, e.g. 2026-09-15T00:00:00Z",
        CONFORMANCE_USAGE,
      );
    }
  }

  const inputs = {
    root,
    clock: ctx.io.clock,
    ...(repositoryOption === undefined
      ? {}
      : { repository: resolve(ctx.io.cwd, repositoryOption) }),
    ...(configOption === undefined
      ? {}
      : { config: resolve(ctx.io.cwd, configOption) }),
    ...(evaluatedAt === undefined ? {} : { evaluatedAt }),
  };

  if (isCheck) {
    const outcome = await checkConformance(inputs);

    if (asJson) {
      writeJson(ctx.io, outcome);
      return outcome.status === "current" ? EXIT.ok : EXIT.failed;
    }

    if (outcome.status === "current") {
      ctx.io.stdout(
        lines(
          "conformance check: stored report is CURRENT and matches project state",
          `  conformance_hash: ${outcome.stored_conformance_hash}`,
        ),
      );
      return EXIT.ok;
    }

    ctx.io.stderr(
      lines(
        `conformance check: stored report is ${outcome.status.toUpperCase()}`,
        ...outcome.reasons.map((r) => `  - ${r}`),
      ),
    );
    return EXIT.failed;
  }

  const runOutcome = await runConformance(inputs);

  if (asJson) {
    writeJson(ctx.io, runOutcome.report);
  } else {
    ctx.io.stdout(renderReport(runOutcome.report));
  }

  if (runOutcome.report.analysis_errors.length > 0) return EXIT.usage;
  if (runOutcome.report.summary.fail > 0) {
    return EXIT.failed; // Exit 1: violation
  }
  if (runOutcome.report.summary.unknown > 0) {
    return EXIT.usage; // Exit 2: unknown
  }
  return EXIT.ok; // Exit 0: compliant
}
