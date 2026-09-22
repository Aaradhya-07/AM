import type {
  ReviewEvidenceGap,
  ReviewResult,
} from "@anvilmark/conformance/review";

import type { WebReviewEnvelope } from "../../lib/review-bundle";

export function verdictBadgeClass(verdict: string): string {
  if (verdict === "pass") return "bg-[#14532d] text-[#4ade80]";
  if (verdict === "fail") return "bg-[#451a1a] text-[#f87171]";
  if (verdict === "unknown") return "bg-[#3e2c0e] text-[#fbbf24]";
  return "bg-surface text-sand";
}

interface VerdictSummary {
  readonly fail: number;
  readonly unknown: number;
  readonly compliant: boolean;
}

/** Failures outrank unknowns; a report is only "pass" when it is compliant. */
export function summaryVerdict(summary: VerdictSummary): string {
  if (summary.fail > 0) return "fail";
  if (summary.unknown > 0 || !summary.compliant) return "unknown";
  return "pass";
}

export function summaryLabel(summary: VerdictSummary): string {
  if (summary.fail > 0) return `${summary.fail} failing`;
  if (summary.unknown > 0) return `${summary.unknown} unresolved`;
  return summary.compliant ? "All rules pass" : "Not compliant";
}

function gapWhere(gap: ReviewEvidenceGap): string {
  if (gap.scope === "project") return "Project";
  if (gap.scope === "workload") return `Workload ${gap.workload_ref}`;
  return `Selected candidate ${gap.candidate_ref}`;
}

function gapNeeds(gap: ReviewEvidenceGap): string {
  return gap.admissible_kinds.length > 0
    ? `${gap.required_floor} · ${gap.admissible_kinds.join(" or ")}`
    : gap.required_floor;
}

function Card({
  title,
  status,
  tone,
  children,
  note,
}: {
  readonly title: string;
  readonly status: string;
  readonly tone: string;
  readonly children?: React.ReactNode;
  readonly note: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-line-muted bg-ink/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-steel">
          {title}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${tone}`}
        >
          {status}
        </span>
      </div>
      {children}
      <p className="mt-auto text-[11px] leading-relaxed text-sand/50">{note}</p>
    </div>
  );
}

/**
 * The four statuses a bundle reports, kept apart because none implies another:
 * a recorded decision is not evidence, evidence is not conforming code, and a
 * consistent file is not proof of who produced it.
 */
export function StatusDimensions({
  bundle,
  gaps,
  hashesVerified,
}: {
  readonly bundle: WebReviewEnvelope;
  readonly gaps: readonly ReviewEvidenceGap[];
  readonly hashesVerified: boolean;
}) {
  const decisions = bundle.contract.canonical.decisions;
  const report = bundle.report.artifact;
  const analysisErrors = report?.analysis_errors ?? [];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        title="Decision"
        status={
          decisions.length === 0
            ? "none recorded"
            : `${decisions.length} recorded`
        }
        tone="bg-surface text-sand"
        note="What was decided and its recorded status. It says nothing about evidence or code."
      >
        <ul className="space-y-1 font-mono text-xs text-sand/80">
          {decisions.slice(0, 3).map((decision) => (
            <li key={decision.id}>
              {decision.id} · {decision.status} · rev {decision.revision}
            </li>
          ))}
          {decisions.length > 3 && <li>+{decisions.length - 3} more</li>}
        </ul>
      </Card>

      <Card
        title="Evidence"
        status={
          gaps.length === 0 ? "no recorded gaps" : `${gaps.length} open gaps`
        }
        tone={
          gaps.length === 0
            ? "bg-surface text-sand"
            : "bg-[#3e2c0e] text-[#fbbf24]"
        }
        note="Measured or documented support recorded in the contract. Code checks do not add to it."
      />

      <Card
        title="Implementation"
        status={
          report
            ? analysisErrors.length > 0
              ? "analysis errors"
              : summaryLabel(report.summary)
            : bundle.report.status === "error"
              ? "report unreadable"
              : "no report"
        }
        tone={
          report
            ? analysisErrors.length > 0
              ? "bg-[#3e2c0e] text-[#fbbf24]"
              : verdictBadgeClass(summaryVerdict(report.summary))
            : "bg-surface text-sand"
        }
        note="Code checked against each rule within that rule's stated scope. Not runtime behaviour or overall safety."
      >
        {report && (
          <p className="font-mono text-xs text-sand/80">
            {report.summary.pass} pass · {report.summary.fail} fail ·{" "}
            {report.summary.unknown} unknown
            {analysisErrors.length > 0
              ? ` · ${analysisErrors.length} analysis error(s)`
              : ""}
          </p>
        )}
      </Card>

      <Card
        title="Snapshot"
        status={
          bundle.report.freshness === "stale" ||
          bundle.scan.freshness === "stale"
            ? "exported stale"
            : hashesVerified
              ? "consistent"
              : "not rechecked"
        }
        tone={
          bundle.report.freshness === "stale" ||
          bundle.scan.freshness === "stale"
            ? "bg-[#3e2c0e] text-[#fbbf24]"
            : "bg-surface text-sand"
        }
        note="Whether this file changed after export. It does not show who exported it or whether the code has changed since."
      >
        <p className="font-mono text-xs text-sand/80">
          {bundle.projection} · exported {bundle.exported_at.slice(0, 10)}
        </p>
      </Card>
    </div>
  );
}

/** Code checks beside the evidence gaps they do not close. */
export function CodeAndEvidence({
  results,
  gaps,
  onInspect,
}: {
  readonly results: readonly ReviewResult[] | null;
  readonly gaps: readonly ReviewEvidenceGap[];
  readonly onInspect: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <section aria-labelledby="checked-in-code">
        <h4
          id="checked-in-code"
          className="text-xs font-semibold uppercase tracking-wider text-steel"
        >
          Checked in code
        </h4>
        <p className="mt-1 text-xs text-sand/60">
          Deterministic checks of the source against the contract&apos;s rules.
        </p>
        {results === null ? (
          <p className="mt-3 rounded border border-line-muted bg-ink/40 p-4 text-sm text-sand/70">
            No conformance report is included. Run{" "}
            <code className="font-mono text-gold">anvilmark check</code> and
            export again.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-muted rounded border border-line-muted bg-ink/40">
            {results.map((result, index) => (
              <li key={result.id ?? index} className="space-y-1.5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${verdictBadgeClass(result.verdict)}`}
                  >
                    {result.verdict}
                  </span>
                  <span className="font-mono text-xs text-sand/80">
                    {result.rule_ref}
                  </span>
                  {(result.standing || result.evidence_tier) && (
                    <span className="text-[11px] text-steel">
                      {[result.standing, result.evidence_tier]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </div>
                <p className="text-sm text-canvas">{result.explanation}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-sand/60">
                    {result.locations
                      .map(
                        (location) => `${location.path}:${location.start.line}`,
                      )
                      .join(", ")}
                  </span>
                  <button
                    type="button"
                    onClick={() => onInspect(index)}
                    className="text-xs text-gold hover:underline"
                  >
                    Inspect trace →
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="not-established-by-code">
        <h4
          id="not-established-by-code"
          className="text-xs font-semibold uppercase tracking-wider text-steel"
        >
          Not established by code
        </h4>
        <p className="mt-1 text-xs text-sand/60">
          Evidence the contract still needs. Passing code checks does not supply
          it.
        </p>
        {gaps.length === 0 ? (
          <p className="mt-3 rounded border border-line-muted bg-ink/40 p-4 text-sm text-sand/70">
            The contract records no open evidence gaps.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line-muted rounded border border-[#78350f]/60 bg-ink/40">
            {gaps.map((gap, index) => {
              const related =
                gap.constraint_ref === null
                  ? []
                  : (results ?? []).filter(
                      (result) => result.constraint_ref === gap.constraint_ref,
                    );
              return (
                <li key={`${gap.subject}-${index}`} className="space-y-1 p-4">
                  <p className="font-mono text-xs text-canvas">{gap.subject}</p>
                  <p className="text-xs text-sand/70">
                    {gapWhere(gap)} · needs {gapNeeds(gap)}
                  </p>
                  <p className="text-xs text-sand/60">{gap.reason}</p>
                  {related.map((result) => (
                    <p key={result.rule_ref} className="text-[11px] text-steel">
                      Code check on this constraint: {result.rule_ref} (
                      {result.verdict}). It checks the implementation, not this
                      evidence.
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function EvidenceGapTable({
  gaps,
}: {
  readonly gaps: readonly ReviewEvidenceGap[];
}) {
  if (gaps.length === 0) {
    return (
      <p className="text-sm text-sand/60">
        The contract records no open evidence gaps.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line-muted text-xs uppercase tracking-wider text-steel">
            <th className="pb-2 pr-4 font-medium">Subject</th>
            <th className="pb-2 pr-4 font-medium">Where</th>
            <th className="pb-2 pr-4 font-medium">Needs</th>
            <th className="pb-2 font-medium">Why it is open</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-muted">
          {gaps.map((gap, index) => (
            <tr key={`${gap.subject}-${index}`} className="align-top">
              <td className="py-2.5 pr-4 font-mono text-xs text-canvas">
                {gap.subject}
              </td>
              <td className="py-2.5 pr-4 text-xs text-sand/80">
                {gapWhere(gap)}
              </td>
              <td className="py-2.5 pr-4 text-xs text-[#fbbf24]">
                {gapNeeds(gap)}
              </td>
              <td className="py-2.5 text-xs text-sand/70">{gap.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface LineMarker {
  readonly from: number;
  readonly to: number;
  readonly label: string;
}

/** Source with line numbers; lines named by a location or trace step are marked. */
export function SourceView({
  path,
  source,
  markers,
}: {
  readonly path: string;
  readonly source: string;
  readonly markers: readonly LineMarker[];
}) {
  const lines = source.replace(/\n$/, "").split("\n");
  return (
    <div>
      <h5 className="mb-2 font-mono text-xs text-steel">{path}</h5>
      <div className="overflow-x-auto rounded border border-line-muted bg-[#080a08]">
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {lines.map((text, index) => {
              const line = index + 1;
              const labels = markers
                .filter((marker) => line >= marker.from && line <= marker.to)
                .map((marker) => marker.label);
              const marked = labels.length > 0;
              return (
                <tr
                  key={line}
                  className={marked ? "bg-gold/10" : undefined}
                  data-marked={marked ? "true" : undefined}
                >
                  <td className="select-none border-r border-line-muted px-3 py-0.5 text-right text-steel">
                    {line}
                  </td>
                  <td className="whitespace-pre px-3 py-0.5 text-sand/90">
                    {text}
                  </td>
                  <td className="whitespace-nowrap px-3 py-0.5 text-right text-[10px] uppercase text-gold">
                    {[...new Set(labels)].join(" · ")}
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

export function ResultDetails({
  result,
  sources,
}: {
  readonly result: ReviewResult;
  readonly sources: Readonly<Record<string, string>> | undefined;
}) {
  const markersByPath = new Map<string, LineMarker[]>();
  const mark = (
    path: string | undefined,
    start: { line: number } | undefined,
    end: { line: number } | undefined,
    label: string,
  ) => {
    if (!path || !start) return;
    const list = markersByPath.get(path) ?? [];
    list.push({ from: start.line, to: end?.line ?? start.line, label });
    markersByPath.set(path, list);
  };
  for (const location of result.locations) {
    mark(location.path, location.start, location.end, "finding");
  }
  result.trace.forEach((step, index) =>
    mark(step.path, step.start, step.end, `${index + 1} ${step.kind}`),
  );

  return (
    <div className="space-y-5 rounded border border-line-muted bg-ink/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium text-canvas">
          {result.rule_ref}
        </span>
        <span className="flex items-center gap-2">
          {[result.standing, result.evidence_tier]
            .filter(Boolean)
            .map((label) => (
              <span
                key={label}
                className="rounded border border-line-muted px-2 py-0.5 text-[10px] uppercase text-sand"
              >
                {label}
              </span>
            ))}
          <span
            className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${verdictBadgeClass(result.verdict)}`}
          >
            {result.verdict}
          </span>
        </span>
      </div>

      <p className="text-sm text-sand/90">{result.explanation}</p>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        {(
          [
            ["Constraint", result.constraint_ref],
            ["Decision", result.decision_ref],
            ["Workload", result.workload_ref],
            ["Candidate", result.candidate_ref],
          ] as const
        )
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-steel">{label}</dt>
              <dd className="font-mono text-sand/80">{value}</dd>
            </div>
          ))}
      </dl>

      {(result.unknown_reasons ?? []).length > 0 && (
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-steel">
            Why it is unresolved
          </h5>
          <ul className="mt-1 list-inside list-disc text-xs text-[#fbbf24]">
            {result.unknown_reasons?.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {result.trace.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-steel">
            Data-flow trace
          </h5>
          <ol className="mt-2 space-y-1 font-mono text-xs">
            {result.trace.map((step, index) => (
              <li key={index} className="flex flex-wrap gap-2">
                <span className="text-steel">{index + 1}.</span>
                <span
                  className={
                    step.kind === "sanitizer" ? "text-[#4ade80]" : "text-canvas"
                  }
                >
                  {step.kind}
                </span>
                {step.path && step.start && (
                  <span className="text-sand/70">
                    {step.path}:{step.start.line}
                  </span>
                )}
                {step.symbol && (
                  <span className="text-sand/50">{step.symbol}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {result.suggested_alternatives.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-steel">
            Expected change
          </h5>
          <ul className="mt-1 space-y-1 text-xs text-sand/80">
            {result.suggested_alternatives.map((alternative, index) => (
              <li key={index}>{alternative.summary}</li>
            ))}
          </ul>
        </div>
      )}

      {(result.supported_scope || (result.caveats ?? []).length > 0) && (
        <div className="rounded border border-line-muted bg-surface/40 p-3 text-xs text-sand/70">
          <h5 className="font-semibold uppercase tracking-wider text-steel">
            What this check covers
          </h5>
          {result.supported_scope && (
            <p className="mt-1">{result.supported_scope}</p>
          )}
          <ul className="mt-1 list-inside list-disc">
            {result.caveats?.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}

      {[...markersByPath].map(([path, markers]) =>
        sources?.[path] !== undefined ? (
          <SourceView
            key={path}
            path={path}
            source={sources[path]}
            markers={markers}
          />
        ) : (
          <p key={path} className="text-xs text-sand/50">
            Source for <code className="font-mono">{path}</code> is not in this
            bundle.
          </p>
        ),
      )}
    </div>
  );
}
