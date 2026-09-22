import type {
  ReviewEvidenceGap,
  ReviewLocation,
  ReviewResult,
  ReviewTraceStep,
} from "./types.js";

export interface AgentBriefInput {
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly contract_revision: number;
    readonly contract_hash: string;
  };
  readonly results: readonly ReviewResult[];
  readonly evidenceGaps: readonly ReviewEvidenceGap[];
  /** Freshness of the report the results came from, when known. */
  readonly reportFreshness?: "current" | "stale" | null | undefined;
  /** How the agent reruns the check, e.g. the CLI invocation for its setup. */
  readonly recheckCommand?: string | undefined;
  /** Evidence gaps listed before the rest are summarised. */
  readonly maxEvidenceGaps?: number | undefined;
}

const DEFAULT_RECHECK = "anvilmark check";

function position(
  path: string | undefined,
  step: ReviewLocation | ReviewTraceStep,
) {
  if (!step.start) return path ?? "unknown location";
  const end =
    step.end && step.end.line !== step.start.line ? `–${step.end.line}` : "";
  return `${path ?? "?"}:${step.start.line}${end}`;
}

function named(symbol: string | null | undefined): string {
  return symbol ? ` ${symbol}` : "";
}

function labels(result: ReviewResult): string {
  return [result.verdict, result.standing, result.evidence_tier]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

function refs(result: ReviewResult): string | null {
  const parts = [
    result.constraint_ref ? `constraint ${result.constraint_ref}` : null,
    result.decision_ref ? `decision ${result.decision_ref}` : null,
    result.workload_ref ? `workload ${result.workload_ref}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

function finding(heading: string, result: ReviewResult): string[] {
  const lines = [`${heading} ${result.rule_ref}  [${labels(result)}]`];
  const references = refs(result);
  if (references) lines.push(`  ${references}`);
  for (const location of result.locations) {
    lines.push(
      `  at ${position(location.path, location)}${named(location.symbol)}`,
    );
  }
  if (result.trace.length > 0) {
    lines.push(
      `  trace: ${result.trace
        .map(
          (step) =>
            `${step.kind} ${position(step.path, step)}${named(step.symbol)}`,
        )
        .join(" → ")}`,
    );
  }
  lines.push(`  finding: ${result.explanation}`);
  for (const reason of result.unknown_reasons ?? []) {
    lines.push(`  unresolved because: ${reason}`);
  }
  for (const alternative of result.suggested_alternatives) {
    lines.push(
      `  expected: ${alternative.summary}${
        alternative.details && alternative.details !== alternative.summary
          ? ` (${alternative.details})`
          : ""
      }`,
    );
  }
  if (
    result.verdict === "unknown" &&
    result.suggested_alternatives.length === 0
  ) {
    lines.push(
      "  expected: make this path statically resolvable, for example a literal model id or a direct call to the declared sanitizer",
    );
  }
  if (result.supported_scope) lines.push(`  scope: ${result.supported_scope}`);
  for (const caveat of result.caveats ?? []) {
    lines.push(`  limit: ${caveat}`);
  }
  return lines;
}

function gapLine(gap: ReviewEvidenceGap): string {
  const where =
    gap.scope === "project"
      ? "project"
      : gap.scope === "workload"
        ? `workload ${gap.workload_ref}`
        : `selected candidate ${gap.candidate_ref}`;
  const needs = gap.admissible_kinds.length
    ? ` needs ${gap.required_floor} ${gap.admissible_kinds.join(" or ")}`
    : ` needs ${gap.required_floor} evidence`;
  return `  - ${gap.subject} (${where}):${needs}. ${gap.reason}`;
}

const SCOPE_ORDER = { workload: 0, selected_candidate: 1, project: 2 };

/**
 * The evidence gaps a code change cannot close, for the workloads these
 * results cover and for the project. Gaps on a constraint that a code check
 * already reports on are left to that result, and a subject recorded at more
 * than one scope is listed once, at its narrowest scope.
 */
export function openEvidenceGaps(
  results: readonly ReviewResult[],
  gaps: readonly ReviewEvidenceGap[],
): ReviewEvidenceGap[] {
  const workloads = new Set(results.map((result) => result.workload_ref));
  const checked = new Set(results.map((result) => result.constraint_ref));
  const seen = new Set<string>();
  return gaps
    .filter(
      (gap) =>
        (gap.scope === "project" || workloads.has(gap.workload_ref)) &&
        !(gap.constraint_ref !== null && checked.has(gap.constraint_ref)),
    )
    .sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope])
    .filter((gap) => {
      if (seen.has(gap.subject)) return false;
      seen.add(gap.subject);
      return true;
    });
}

/**
 * A bounded, verifiable brief for a coding agent. It names what to change and
 * where, forbids changing the policy that produced the finding, keeps
 * unmeasured evidence out of the agent's hands, and states when the work is
 * done. It never tells an agent to produce evidence.
 */
export function buildAgentBrief(input: AgentBriefInput): string {
  const { project } = input;
  const recheck = input.recheckCommand ?? DEFAULT_RECHECK;
  const failing = input.results.filter((result) => result.verdict === "fail");
  const unresolved = input.results.filter(
    (result) => result.verdict === "unknown",
  );
  const gaps = openEvidenceGaps(input.results, input.evidenceGaps);
  const maxGaps = input.maxEvidenceGaps ?? 8;

  const lines: string[] = [
    `ANVILMARK review brief · ${project.name} (${project.id}) · contract ${project.contract_hash.slice(0, 19)}… (revision ${project.contract_revision})`,
    `If \`${recheck}\` reports a different contract hash, stop and report back instead of continuing.`,
  ];
  if (input.reportFreshness === "stale") {
    lines.push(
      `These results were exported from a stale report. Run \`${recheck}\` first and work from its results.`,
    );
  }
  lines.push(
    "",
    "DO NOT MODIFY: .anvilmark/** (the contract, scanner declarations and rules), sanitizer declarations or evidence records.",
    "Do not change a rule, a declaration or the scanned scope to make a check pass, and do not replace a literal model id with one read at runtime from environment variables or configuration.",
  );

  if (failing.length === 0 && unresolved.length === 0) {
    lines.push(
      "",
      "No code check is failing or unresolved. Do not change code for ANVILMARK.",
    );
  }
  for (const result of failing) lines.push("", ...finding("FIX", result));
  for (const result of unresolved)
    lines.push("", ...finding("RESOLVE", result));

  if (gaps.length > 0) {
    lines.push(
      "",
      "NOT CODE TASKS: code checks do not measure these, and you must not create metrics, evaluation results or evidence files for them. Report them as still open.",
      ...gaps.slice(0, maxGaps).map(gapLine),
    );
    if (gaps.length > maxGaps) {
      lines.push(
        `  - ${gaps.length - maxGaps} more evidence gap(s); see Studio.`,
      );
    }
  }

  if (failing.length > 0 || unresolved.length > 0) {
    lines.push(
      "",
      `DONE WHEN: \`${recheck}\` shows every rule above as pass and no other rule's verdict gets worse. Report the diff and the final \`${recheck}\` output.`,
    );
  }
  lines.push(
    "If the ANVILMARK MCP server is connected, run_conformance and get_conformance_result return the same results without copying this brief.",
  );
  return lines.join("\n");
}
