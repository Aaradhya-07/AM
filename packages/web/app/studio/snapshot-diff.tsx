import {
  collapseUnchanged,
  diffLines,
  diffReviewBundles,
  policyChanged,
} from "@anvilmark/conformance/review";
import type { FindingDiff, ReviewResult } from "@anvilmark/conformance/review";

import type { WebReviewEnvelope } from "../../lib/review-bundle";

const CHANGE_TONE: Record<string, string> = {
  resolved: "bg-[#14532d] text-[#4ade80]",
  regressed: "bg-[#451a1a] text-[#f87171]",
  added: "bg-[#451a1a] text-[#f87171]",
  removed: "bg-[#3e2c0e] text-[#fbbf24]",
  changed: "bg-[#3e2c0e] text-[#fbbf24]",
  unchanged: "bg-surface text-sand",
};

function label(finding: FindingDiff): string {
  const verdict = finding.head?.verdict;
  const open = verdict === "fail" || verdict === "unknown";
  if (finding.change === "added") return open ? "new" : "added";
  if (
    open &&
    (finding.change === "unchanged" || finding.change === "changed")
  ) {
    return "still open";
  }
  return finding.change;
}

function linesOf(
  results: readonly ReviewResult[],
  path: string,
): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  const add = (line: number | undefined, text: string) => {
    if (line === undefined) return;
    marks.set(line, [...(marks.get(line) ?? []), text]);
  };
  for (const result of results) {
    for (const location of result.locations) {
      if (location.path === path) add(location.start.line, result.verdict);
    }
    for (const step of result.trace) {
      if (step.path === path) add(step.start?.line, step.kind);
    }
  }
  return marks;
}

function FileDiff({
  path,
  baseSource,
  headSource,
  baseMarks,
  headMarks,
}: {
  readonly path: string;
  readonly baseSource: string | undefined;
  readonly headSource: string | undefined;
  readonly baseMarks: Map<number, string[]>;
  readonly headMarks: Map<number, string[]>;
}) {
  if (baseSource === undefined && headSource === undefined) {
    return (
      <p className="text-xs text-sand/60">
        <code className="font-mono">{path}</code>: neither bundle includes this
        source, so its lines cannot be compared. Export with{" "}
        <code className="font-mono text-gold">--include-source</code>.
      </p>
    );
  }

  const diff = diffLines(baseSource ?? "", headSource ?? "");
  const rows = collapseUnchanged(diff, 3);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h5 className="font-mono text-xs text-steel">{path}</h5>
        <span className="font-mono text-[11px] text-sand/60">
          +{diff.added} −{diff.removed}
          {diff.truncated
            ? " · too large to align; shown as a replacement"
            : ""}
          {baseSource === undefined ? " · not in the base bundle" : ""}
          {headSource === undefined ? " · not in the head bundle" : ""}
        </span>
      </div>
      <div className="overflow-x-auto rounded border border-line-muted bg-[#080a08]">
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {rows.map((row, index) => {
              if (row.kind === "gap") {
                return (
                  <tr key={`gap-${index}`} className="text-steel">
                    <td colSpan={4} className="px-3 py-0.5 text-center">
                      ⋯ {row.hidden} unchanged line(s)
                    </td>
                  </tr>
                );
              }
              const marks =
                row.kind === "removed"
                  ? (row.base_line !== null && baseMarks.get(row.base_line)) ||
                    []
                  : (row.head_line !== null && headMarks.get(row.head_line)) ||
                    [];
              return (
                <tr
                  key={index}
                  data-kind={row.kind}
                  className={
                    row.kind === "added"
                      ? "bg-[#0c2415]"
                      : row.kind === "removed"
                        ? "bg-[#2e1313]"
                        : undefined
                  }
                >
                  <td className="select-none border-r border-line-muted px-2 py-0.5 text-right text-steel">
                    {row.base_line ?? ""}
                  </td>
                  <td className="select-none border-r border-line-muted px-2 py-0.5 text-right text-steel">
                    {row.head_line ?? ""}
                  </td>
                  <td className="whitespace-pre px-3 py-0.5 text-sand/90">
                    {row.kind === "added"
                      ? "+"
                      : row.kind === "removed"
                        ? "−"
                        : " "}{" "}
                    {row.text}
                  </td>
                  <td className="whitespace-nowrap px-3 py-0.5 text-right text-[10px] uppercase text-gold">
                    {[...new Set(marks)].join(" · ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Two snapshots of one project: how each finding moved, what policy changed,
 * and the lines that changed in the files the findings name. A finding that
 * disappeared because its rule or the scanned scope changed is never shown as
 * a fix.
 */
export function SnapshotComparison({
  base,
  head,
}: {
  readonly base: WebReviewEnvelope;
  readonly head: WebReviewEnvelope;
}) {
  const diff = diffReviewBundles(base, head);
  const changed = diff.findings.filter(
    (finding) =>
      finding.change !== "unchanged" ||
      finding.head?.verdict === "fail" ||
      finding.head?.verdict === "unknown",
  );

  const paths = [
    ...new Set(
      changed.flatMap((finding) =>
        [finding.base, finding.head].flatMap((result) =>
          result
            ? [
                ...result.locations.map((location) => location.path),
                ...result.trace.flatMap((step) =>
                  step.path ? [step.path] : [],
                ),
              ]
            : [],
        ),
      ),
    ),
  ].sort();

  const baseResults = base.report.artifact?.results ?? [];
  const headResults = head.report.artifact?.results ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {(
          [
            ["Resolved", diff.counts.resolved],
            ["Regressed or new", diff.counts.regressed + diff.counts.added],
            ["Changed", diff.counts.changed],
            ["No longer reported", diff.counts.removed],
          ] as const
        ).map(([name, value]) => (
          <div
            key={name}
            className="rounded border border-line-muted bg-ink/40 p-3"
          >
            <p className="text-[11px] uppercase tracking-wider text-steel">
              {name}
            </p>
            <p className="mt-1 text-lg text-canvas">{value}</p>
          </div>
        ))}
      </div>

      <div
        className={`rounded border p-4 text-xs ${
          diff.policy_changed
            ? "border-[#78350f] bg-[#291e0a] text-[#fbbf24]"
            : "border-line-muted bg-ink/40 text-sand/70"
        }`}
      >
        <h4 className="text-xs font-semibold uppercase tracking-wider">
          Policy changes between these snapshots
        </h4>
        {policyChanged(diff.policy) ? (
          <>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {diff.policy.contract_changed && <li>The contract changed.</li>}
              {diff.policy.rules_added.length > 0 && (
                <li>Rules added: {diff.policy.rules_added.join(", ")}</li>
              )}
              {diff.policy.rules_removed.length > 0 && (
                <li>Rules removed: {diff.policy.rules_removed.join(", ")}</li>
              )}
              {diff.policy.rules_changed.length > 0 && (
                <li>Rules changed: {diff.policy.rules_changed.join(", ")}</li>
              )}
              {diff.policy.decisions_changed.length > 0 && (
                <li>
                  Decisions changed: {diff.policy.decisions_changed.join(", ")}
                </li>
              )}
              {diff.policy.constraints_changed.length > 0 && (
                <li>
                  Constraints changed:{" "}
                  {diff.policy.constraints_changed.join(", ")}
                </li>
              )}
              {diff.policy.scan_scope.configuration_changed && (
                <li>Scanner declarations or scan scope changed.</li>
              )}
              {diff.policy.scan_scope.repository_root_changed && (
                <li>The scanned repository root changed.</li>
              )}
            </ul>
            <p className="mt-2">
              Removing or weakening a rule, or shrinking the scanned scope, is
              not a fix. Review each change on its own.
            </p>
          </>
        ) : (
          <p className="mt-2">
            None. Both snapshots were evaluated against the same contract, rules
            and scan scope.
          </p>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line-muted text-xs uppercase tracking-wider text-steel">
              <th className="pb-2 pr-4 font-medium">Change</th>
              <th className="pb-2 pr-4 font-medium">Rule</th>
              <th className="pb-2 pr-4 font-medium">Base</th>
              <th className="pb-2 pr-4 font-medium">Head</th>
              <th className="pb-2 font-medium">Where</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-muted">
            {changed.length === 0 && (
              <tr>
                <td colSpan={5} className="py-3 text-sm text-sand/70">
                  No check changed, and none is failing or unresolved.
                </td>
              </tr>
            )}
            {changed.map((finding) => {
              const location = (finding.head ?? finding.base)?.locations[0];
              return (
                <tr key={finding.key}>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        CHANGE_TONE[finding.change] ?? "bg-surface text-sand"
                      }`}
                    >
                      {label(finding)}
                    </span>
                    {finding.policy_affected && (
                      <span
                        className="ml-1 text-[#fbbf24]"
                        title="This snapshot also changes the rule, decision or constraint behind this finding."
                      >
                        †
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-xs text-canvas">
                    {finding.rule_ref}
                  </td>
                  <td className="py-2.5 pr-4 text-xs uppercase text-sand/80">
                    {finding.base?.verdict ?? "—"}
                  </td>
                  <td className="py-2.5 pr-4 text-xs uppercase text-sand/80">
                    {finding.head?.verdict ?? "—"}
                  </td>
                  <td className="py-2.5 font-mono text-xs text-sand/60">
                    {location ? `${location.path}:${location.start.line}` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paths.length > 0 && (
        <div className="space-y-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-steel">
            Source the findings point at
          </h4>
          {paths.map((path) => (
            <FileDiff
              key={path}
              path={path}
              baseSource={base.sources?.[path]}
              headSource={head.sources?.[path]}
              baseMarks={linesOf(baseResults, path)}
              headMarks={linesOf(headResults, path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
