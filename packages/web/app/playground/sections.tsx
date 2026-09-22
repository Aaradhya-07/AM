import { Field, SectionTitle, StandingBadge } from "./ui";
import type { DraftViewModel, OverviewViewModel, VerdictCounts } from "./types";

function Chips({ items }: { items: string[] }) {
  if (items.length === 0)
    return <span className="text-steel/50">Unavailable</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded border border-line-muted bg-ink/70 px-2 py-0.5 font-mono text-xs text-sand"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function PriorityChips({ items }: { items: string[] }) {
  if (items.length === 0)
    return <span className="text-steel/50">Unavailable</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item, idx) => (
        <span key={item} className="inline-flex items-center gap-1.5">
          <span className="rounded border border-line-muted bg-ink/70 px-2 py-0.5 font-mono text-xs text-sand">
            {item}
          </span>
          {idx < items.length - 1 && (
            <span
              aria-hidden="true"
              className="font-mono text-xs text-gold/70 select-none"
            >
              &gt;
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function Overview({
  overview,
  generatedAsOf,
}: {
  overview: OverviewViewModel;
  generatedAsOf: string;
}) {
  return (
    <section
      data-testid="overview-panel"
      className="border border-line-muted bg-surface p-5"
    >
      <SectionTitle eyebrow="Atlas overview" title={overview.name}>
        <span className="rounded border border-line-muted bg-ink/80 px-2 py-0.5 font-mono text-xs uppercase tracking-wide text-sand/80">
          state: {overview.state}
        </span>
      </SectionTitle>

      <p className="mb-5 max-w-3xl text-sm leading-6 text-sand/90">
        {overview.intent}
      </p>

      <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Users">
          <Chips items={overview.users} />
        </Field>
        <Field label="Priority order">
          <PriorityChips items={overview.priorityOrder} />
        </Field>
        <Field label="Non-goals">
          <Chips items={overview.nonGoals} />
        </Field>
        <Field label="Outcomes">
          {overview.outcomes.length === 0 ? null : (
            <ul className="space-y-1">
              {overview.outcomes.map((outcome) => (
                <li key={outcome.measure} className="text-sm">
                  <span className="font-mono text-xs text-steel">
                    {outcome.measure}
                  </span>{" "}
                  <span className="text-canvas">{outcome.target}</span>
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label="Evidence gaps">
          <span className="text-sand">
            {overview.evidenceGapCount > 0
              ? `${overview.evidenceGapCount} unresolved`
              : "None recorded"}
          </span>
        </Field>
        <Field label="Example snapshot">
          <span className="font-mono text-xs text-sand">
            {generatedAsOf || "—"}
          </span>
        </Field>
      </dl>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-steel">
            Workloads
          </h3>
          <ul className="space-y-2" data-testid="overview-workloads">
            {overview.workloads.map((workload) => (
              <li
                key={workload.id}
                className="flex items-center justify-between gap-3 border border-line-muted bg-ink/50 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-canvas">
                    {workload.name}
                  </div>
                  <div className="font-mono text-[11px] text-steel">
                    {workload.callsPerMonth === null
                      ? "calls/mo unavailable"
                      : `${workload.callsPerMonth.toLocaleString("en-US")} calls/mo`}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {workload.decisionStandings.length === 0 ? (
                    <span className="text-xs text-steel/60">no decision</span>
                  ) : (
                    workload.decisionStandings.map((standing, index) => (
                      <span
                        key={`${workload.id}-${index}`}
                        className="rounded border border-line-muted bg-surface px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-sand/80"
                      >
                        {standing}
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-steel">
            Constraints
          </h3>
          <ul className="space-y-1.5" data-testid="overview-constraints">
            {overview.constraints.map((constraint) => (
              <li
                key={constraint.id}
                className="flex items-center justify-between gap-2 border-b border-dashed border-line-muted pb-1.5"
              >
                <span className="min-w-0 break-all font-mono text-xs text-sand/90">
                  {constraint.id}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-steel">
                    {constraint.domain}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      constraint.severity === "hard"
                        ? "border border-[#592323] bg-[#2e1313] text-[#f87171]"
                        : "border border-line-muted bg-surface text-sand/70"
                    }`}
                  >
                    {constraint.severity}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {overview.unresolvedQuestions.length > 0 ? (
        <div className="mt-6 border-l-2 border-gold bg-ink/60 px-4 py-3">
          <h3 className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-steel">
            Unresolved questions
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-sand/90">
            {overview.unresolvedQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function DraftCard({ draft }: { draft: DraftViewModel }) {
  return (
    <div
      data-testid="draft-card"
      className="border border-dashed border-line-muted bg-surface/70 p-4"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-steel">
          Draft (unreviewed)
        </span>
        <StandingBadge standing="not_checked" />
      </div>
      <div className="text-sm font-medium text-canvas">{draft.name}</div>
      <p className="mt-1 text-xs leading-5 text-steel">{draft.intent}</p>
      <p className="mt-3 text-[11px] leading-5 text-steel/70">
        This draft has no conformance report. A missing report reads “Not
        checked”, never a passing result.
      </p>
    </div>
  );
}

export function SummaryCounts({ summary }: { summary: VerdictCounts }) {
  const cells: { key: string; label: string; value: number; tone: string }[] = [
    { key: "pass", label: "Pass", value: summary.pass, tone: "text-[#4ade80]" },
    { key: "fail", label: "Fail", value: summary.fail, tone: "text-[#f87171]" },
    {
      key: "unknown",
      label: "Unknown",
      value: summary.unknown,
      tone: "text-[#fbbf24]",
    },
    {
      key: "na",
      label: "N/A",
      value: summary.notApplicable,
      tone: "text-steel",
    },
  ];
  return (
    <div
      data-testid="summary-counts"
      className="grid grid-cols-4 divide-x divide-line-muted border border-line-muted bg-surface"
    >
      {cells.map((cell) => (
        <div key={cell.key} className="px-3 py-2 text-center">
          <div className={`text-xl font-semibold ${cell.tone}`}>
            {cell.value}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-steel">
            {cell.label}
          </div>
        </div>
      ))}
    </div>
  );
}
