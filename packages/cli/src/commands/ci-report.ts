import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  parse,
  projectDirectory,
  stringOption,
  writeJson,
} from "./common.js";
import { measureDrift } from "./drift.js";
import { exportRepoContext } from "./export-context.js";
import { runHookGate } from "./hooks.js";
import { aggregateOutcomes, readSliceOutcomes } from "./outcomes.js";
import { loadSlicePlan } from "./slice-storage.js";
import { sliceDigest } from "./slice-worktree.js";
import { verifySlice } from "./verify-slice.js";

export const CI_REPORT_USAGE = `Usage:
  anvilmark ci-report [-C DIR] [--out FILE] [--strict-gate] [--json]

Generates a deterministic GitHub-Flavored Markdown Conformance, Drift &
Provenance report for pull requests and CI summaries ($GITHUB_STEP_SUMMARY).

Options
  --out FILE         write Markdown report to FILE instead of stdout
  --strict-gate      exit 1 if active-plan slice violations, secret leaks, or
                     error-severity architecture drift findings are present
  -C, --project-dir  repository root (default: current directory)
  --json             emit structured JSON report`;

export async function generateCiReport(directory: string, now: string) {
  const root = await realpath(directory);
  const [repo, bundle, drift, gate, outcomes, rawOutcomes] = await Promise.all([
    exportRepoContext(root, { now }),
    loadSlicePlan(root),
    measureDrift(root, now),
    runHookGate(root, now),
    aggregateOutcomes(root, now),
    readSliceOutcomes(root).catch(() => []),
  ]);

  if (!bundle) {
    const markdown =
      [
        `## AnvilMark CI Report — \`${repo.repoName}\``,
        "",
        `- **Repository:** \`${repo.repoName}\` (${repo.totalTrackedFiles} tracked files · ${repo.languages.join(", ") || "no languages detected"})`,
        `- **Active Plan:** _None locked in \`.anvilmark/development/active-plan.json\`_`,
        `- **Recorded Model Runs:** ${outcomes.totalRecordedRuns}`,
        "",
        `> Tip: Run \`npx anvilmark connect --with-hooks\` locally or lock an execution plan to enable slice-scope & trust-boundary PR enforcement.`,
      ].join("\n") + "\n";

    return {
      schemaVersion: "anvilmark.ci-report.v1" as const,
      generatedAt: now,
      repoName: repo.repoName,
      passed: true,
      hasActivePlan: false,
      driftStatus: drift.status,
      guardrailViolations: [] as string[],
      sliceResults: [] as Array<{
        id: string;
        title: string;
        model: string;
        reviewerFamily: string | null;
        outcomeStatus: string;
        conformancePassed: boolean;
        violationCount: number;
      }>,
      outcomes,
      markdown,
    };
  }

  const planSha = sliceDigest(JSON.stringify(bundle));
  const outcomeMap = new Map(
    rawOutcomes
      .filter((r) => r.plan_sha256 === undefined || r.plan_sha256 === planSha)
      .map((r) => [r.slice_id, r]),
  );

  const sliceResults = await Promise.all(
    bundle.plan.tasks.map(async (task) => {
      const report = await verifySlice({
        root,
        bundle,
        sliceId: task.id,
        runChecks: false,
        clock: () => now,
      });
      const rec = outcomeMap.get(task.id);
      return {
        id: task.id,
        title: task.title,
        model: task.model,
        reviewerFamily: task.contract?.reviewerFamily ?? null,
        outcomeStatus: rec?.status ?? "pending",
        conformancePassed: report.passed,
        violationCount: report.violations.length,
        violations: report.violations,
      };
    }),
  );

  const errorDriftCount = drift.items.filter(
    (i) => i.severity === "error",
  ).length;
  const anySliceFailed = sliceResults.some((s) => !s.conformancePassed);
  const passed = gate.passed && errorDriftCount === 0 && !anySliceFailed;

  const statusBadge = passed ? "PASSED ✓" : "VIOLATIONS DETECTED ✗";
  const driftBadge =
    drift.status === "aligned"
      ? `Aligned ✓ (${drift.observedEdgesCount} observed edges)`
      : `Drifted (${drift.items.length} finding(s))`;

  const mdLines: string[] = [
    `## AnvilMark Conformance & Provenance — ${statusBadge}`,
    "",
    `- **Plan:** ${bundle.plan.title} (\`${repo.repoName}\`)`,
    `- **Drift Radar:** ${driftBadge}`,
    `- **Guardrail Gate:** ${gate.passed ? "Clean ✓" : `${gate.violations.length} issue(s)`}`,
    "",
    `### Task Slices & Contracts`,
    "",
    `| Slice | Routed Model | Cross-Vendor Review | Outcome | Static Conformance |`,
    `| --- | --- | --- | --- | --- |`,
    ...sliceResults.map(
      (s) =>
        `| \`${s.id}\` — ${s.title.replace(/\|/g, "\\|")} | \`${s.model}\` | ${s.reviewerFamily ?? "—"} | ${s.outcomeStatus} | ${s.conformancePassed ? "Pass ✓" : `Fail (${s.violationCount})`} |`,
    ),
  ];

  if (drift.items.length > 0) {
    mdLines.push(
      "",
      `### Architecture Drift Findings (${drift.items.length})`,
      "",
      ...drift.items.map(
        (item) =>
          `- **[${item.severity.toUpperCase()} · \`${item.kind}\`]** \`${item.from}\` → \`${item.to}\`: ${item.detail}${item.evidencePaths.length > 0 ? ` (${item.evidencePaths.map((p) => `\`${p}\``).join(", ")})` : ""}`,
      ),
    );
  }

  if (gate.violations.length > 0) {
    mdLines.push(
      "",
      `### Guardrail Violations`,
      "",
      ...gate.violations.map((v) => `- ${v}`),
    );
  }

  if (outcomes.models.length > 0) {
    mdLines.push(
      "",
      `### Observed Repository Model Provenance (${outcomes.totalRecordedRuns} runs)`,
      "",
      `| Model | Attempts | 1st-Pass Accepted | Avg Rework | Avg Retries |`,
      `| --- | --- | --- | --- | --- |`,
      ...outcomes.models.map((m) => {
        const pct =
          m.attempts > 0
            ? Math.round((m.acceptedFirstPass / m.attempts) * 100)
            : 0;
        return `| \`${m.model}\` | ${m.attempts} | ${m.acceptedFirstPass}/${m.attempts} (${pct}%) | ${Math.round(m.meanReworkRatio * 100)}% | ${m.meanRetries.toFixed(1)} |`;
      }),
    );
  }

  const markdown = mdLines.join("\n") + "\n";

  return {
    schemaVersion: "anvilmark.ci-report.v1" as const,
    generatedAt: now,
    repoName: repo.repoName,
    planTitle: bundle.plan.title,
    passed,
    hasActivePlan: true,
    driftStatus: drift.status,
    driftItems: drift.items,
    guardrailViolations: gate.violations,
    sliceResults: sliceResults.map(
      ({
        id,
        title,
        model,
        reviewerFamily,
        outcomeStatus,
        conformancePassed,
        violationCount,
      }) => ({
        id,
        title,
        model,
        reviewerFamily,
        outcomeStatus,
        conformancePassed,
        violationCount,
      }),
    ),
    outcomes,
    markdown,
  };
}

async function writeSafeOutFile(targetPath: string, content: string) {
  const st = await lstat(targetPath).catch(() => null);
  if (st?.isSymbolicLink()) {
    throw new Error(`Refusing to write through symbolic link: ${targetPath}`);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.anvilmark-${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, targetPath);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export async function ciReportCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const { io } = context;
  const parsed = parse(
    context.args,
    {
      out: { type: "string" },
      "strict-gate": { type: "boolean" },
    },
    CI_REPORT_USAGE,
  );

  if (flag(parsed, "help")) {
    io.stdout(`${CI_REPORT_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected argument "${parsed.positionals[0]}"`,
      CI_REPORT_USAGE,
    );
  }

  const root = projectDirectory(io, parsed);
  const report = await generateCiReport(root, io.clock());
  const outOpt = stringOption(parsed, "out");

  if (outOpt) {
    const outPath = resolve(io.cwd, outOpt);
    await writeSafeOutFile(
      outPath,
      flag(parsed, "json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : report.markdown,
    );
    io.stdout(`Wrote CI report to ${outPath}\n`);
  } else if (flag(parsed, "json")) {
    writeJson(io, report);
  } else {
    io.stdout(report.markdown);
  }

  if (flag(parsed, "strict-gate") && !report.passed) {
    return EXIT.failed;
  }
  return EXIT.ok;
}
