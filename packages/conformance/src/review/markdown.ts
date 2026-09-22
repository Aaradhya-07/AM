import type { FindingDiff, PolicyDiff, ReviewDiff } from "./diff.js";
import { policyChanged } from "./diff.js";
import type { ReviewEvidenceGap } from "./types.js";

export interface ReviewMarkdownInput {
  /** Base snapshot against the head evaluated with the base branch's policy. */
  readonly diff: ReviewDiff;
  /** Base policy against the head's own policy. */
  readonly policy: PolicyDiff;
  readonly evidenceGaps?: readonly ReviewEvidenceGap[] | undefined;
  readonly brief?: string | undefined;
  /** Things the reader must know first, such as a check that could not run. */
  readonly notices?: readonly string[] | undefined;
  readonly maxEvidenceGaps?: number | undefined;
}

const NOT_PASSING = new Set(["fail", "unknown"]);

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function where(finding: FindingDiff): string {
  const location = (finding.head ?? finding.base)?.locations[0];
  return location ? `${location.path}:${location.start.line}` : "";
}

function label(finding: FindingDiff): string {
  const headVerdict = finding.head?.verdict;
  if (finding.change === "added") {
    return headVerdict && NOT_PASSING.has(headVerdict) ? "new" : "added";
  }
  if (
    (finding.change === "unchanged" || finding.change === "changed") &&
    headVerdict &&
    NOT_PASSING.has(headVerdict)
  ) {
    return "still open";
  }
  return finding.change;
}

function policyLines(policy: PolicyDiff): string[] {
  const lines: string[] = [];
  const list = (name: string, ids: readonly string[]) => {
    if (ids.length > 0)
      lines.push(`- ${name}: ${ids.map((id) => `\`${id}\``).join(", ")}`);
  };
  if (policy.contract_changed) lines.push("- The contract changed.");
  list("Rules added", policy.rules_added);
  list("Rules removed", policy.rules_removed);
  list("Rules changed", policy.rules_changed);
  list("Decisions changed", policy.decisions_changed);
  list("Constraints changed", policy.constraints_changed);
  if (policy.scan_scope.configuration_changed) {
    lines.push("- Scanner declarations or scan scope changed.");
  }
  if (policy.scan_scope.repository_root_changed) {
    lines.push("- The scanned repository root changed.");
  }
  return lines;
}

/**
 * A pull-request summary that keeps three things apart: how code checks moved
 * under the base branch's policy, what policy the pull request changes, and
 * the evidence code checks cannot supply.
 */
export function renderReviewMarkdown(input: ReviewMarkdownInput): string {
  const { diff } = input;
  const shown = diff.findings.filter(
    (finding) =>
      finding.change !== "unchanged" ||
      (finding.head !== null && NOT_PASSING.has(finding.head.verdict)),
  );
  const count = (name: string) => shown.filter((f) => label(f) === name).length;

  const lines: string[] = ["### ANVILMARK review", ""];
  for (const notice of input.notices ?? [])
    lines.push(`> [!WARNING]\n> ${notice}`, "");

  lines.push(
    "**Code checks.** The head of this pull request was evaluated with the base branch's contract and rules.",
    "",
    [
      `${count("resolved")} resolved`,
      `${count("new") + count("regressed")} new or regressed`,
      `${count("still open")} still open`,
      `${count("removed")} no longer reported`,
    ].join(" · "),
    "",
  );
  if (shown.length === 0) {
    lines.push("No failing or unresolved checks, and no check changed.", "");
  } else {
    lines.push(
      "| Change | Rule | Base | Head | Where |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const finding of shown) {
      lines.push(
        `| ${label(finding)}${finding.policy_affected ? " †" : ""} | \`${cell(finding.rule_ref)}\` | ${finding.base?.verdict ?? "—"} | ${finding.head?.verdict ?? "—"} | ${cell(where(finding))} |`,
      );
    }
    lines.push("");
    if (shown.some((finding) => finding.policy_affected)) {
      lines.push(
        "† This pull request also changes the rule, decision or constraint behind this finding. Review that change on its own; it does not count as a fix.",
        "",
      );
    }
  }

  lines.push("**Policy changes in this pull request.**", "");
  const policy = policyLines(input.policy);
  if (!policyChanged(input.policy)) {
    lines.push("None.", "");
  } else {
    lines.push(
      ...policy,
      "",
      "These changes did not affect the code checks above, which use the base branch's policy.",
      "",
    );
  }

  const gaps = input.evidenceGaps ?? [];
  const maxGaps = input.maxEvidenceGaps ?? 10;
  lines.push(`**Evidence not established by code** (${gaps.length} open).`, "");
  if (gaps.length === 0) {
    lines.push("None recorded.", "");
  } else {
    for (const gap of gaps.slice(0, maxGaps)) {
      const scope =
        gap.scope === "project"
          ? "project"
          : gap.scope === "workload"
            ? `workload \`${gap.workload_ref}\``
            : `candidate \`${gap.candidate_ref}\``;
      lines.push(
        `- \`${gap.subject}\` (${scope}): needs ${gap.required_floor}${
          gap.admissible_kinds.length
            ? ` ${gap.admissible_kinds.join(" or ")}`
            : ""
        }. ${gap.reason}`,
      );
    }
    if (gaps.length > maxGaps)
      lines.push(`- …and ${gaps.length - maxGaps} more.`);
    lines.push("");
  }

  if (input.brief) {
    lines.push(
      "<details><summary>Agent brief for the open findings</summary>",
      "",
      "```text",
      input.brief,
      "```",
      "",
      "</details>",
      "",
    );
  }
  return lines.join("\n");
}
