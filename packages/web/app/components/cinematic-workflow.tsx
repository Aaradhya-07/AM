import { CircuitField } from "./circuit-field";
import { SectionEyebrow, TerminalNode } from "./circuitry";
import { ContractPreview } from "./contract-preview";
import { ScrollScrubVideo } from "./section-video";

const CONTRACT_PARTS = [
  ["Input", "Workload + constraints"],
  ["Decision", "Architecture + model"],
  ["Evidence", "Sources + evaluation"],
  ["Rules", "Repository conformance"],
];

const STAGES = [
  ["01", "Declare"],
  ["02", "Decide"],
  ["03", "Verify"],
];

function ChapterLabel({
  index,
  children,
}: {
  index: string;
  children: string;
}) {
  return (
    <p className="am-label flex items-center gap-3 text-sand/70">
      <span className="text-gold">{index}</span>
      <span aria-hidden="true" className="h-px w-8 bg-line-muted" />
      {children}
    </p>
  );
}

export function SystemFlow() {
  return (
    <section
      id="flow"
      className="am-system-flow relative overflow-clip border-t border-line-muted bg-ink"
      aria-labelledby="flow-title"
    >
      <div className="relative isolate overflow-hidden">
        <CircuitField intensity={0.58} depth={0.04} />
        <div className="relative z-[1] mx-auto max-w-shell px-5 pb-8 pt-24 sm:px-8 lg:px-12 lg:pt-32">
          <div className="max-w-2xl" data-reveal>
            <SectionEyebrow>The system</SectionEyebrow>
            <h2
              id="flow-title"
              className="mt-6 text-[clamp(1.875rem,1.3rem+1.9vw,2.875rem)] leading-[1.08]"
            >
              One continuous loop from intent to implementation.
            </h2>
            <p className="mt-5 max-w-xl text-[1.0625rem] leading-[1.65] text-sand/75">
              Scroll through the system. The films move with you because the
              contract is not a presentation&#8202;—&#8202;it is a living
              engineering object.
            </p>
          </div>

          <ol
            className="mt-10 flex max-w-2xl items-center"
            aria-label="System stages"
          >
            {STAGES.map(([index, label], itemIndex) => (
              <li key={index} className="flex min-w-0 flex-1 items-center">
                <span className="flex min-w-0 items-center gap-2">
                  <TerminalNode active={itemIndex === 1} />
                  <span className="am-label truncate text-sand/65">
                    {index} {label}
                  </span>
                </span>
                {itemIndex < STAGES.length - 1 ? (
                  <span
                    className="mx-3 h-px min-w-4 flex-1 bg-line-muted"
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <article data-scroll-chapter className="am-flow-chapter">
        <CircuitField intensity={0.72} depth={0.075} />
        <div className="am-flow-chapter-inner mx-auto grid w-full max-w-shell items-center gap-10 px-5 sm:px-8 xl:grid-cols-[0.82fr_1.18fr] xl:gap-16 xl:px-12">
          <div className="max-w-[31rem]" data-reveal>
            <ChapterLabel index="01">Assemble</ChapterLabel>
            <h3 className="mt-5 text-[clamp(1.75rem,1.35rem+1.5vw,2.5rem)] leading-[1.1]">
              Turn scattered inputs into one decision object.
            </h3>
            <p className="mt-5 leading-[1.7] text-sand/75">
              Requirements, architecture, evidence, constraints, and verified
              decisions lock together without becoming another loose brief for
              an agent to reinterpret.
            </p>
          </div>

          <ScrollScrubVideo
            label="Contract assembly"
            poster="/media/contract-assembly-poster.webp"
            src="/media/contract-assembly-loop.mp4"
          />
        </div>
      </article>

      <div
        id="contract"
        className="am-flow-anchor relative isolate mx-auto max-w-shell overflow-hidden px-5 sm:px-8 lg:px-12"
      >
        <CircuitField intensity={0.42} depth={0.03} />
        <div className="am-flow-contract relative z-[1]" data-reveal="wipe">
          <div>
            <ChapterLabel index="02">Contract</ChapterLabel>
            <h3 className="mt-5 max-w-xl text-[clamp(1.65rem,1.3rem+1vw,2.15rem)] leading-[1.12]">
              The source of truth stays structured, versioned, and yours.
            </h3>
            <p className="mt-5 max-w-md leading-[1.7] text-sand/70">
              A versioned file in your repository, not a diagram image.
              Diagrams, reports, and agent context are generated from it, so
              they never become competing sources of truth.
            </p>

            <dl className="mt-8 grid gap-px bg-line-muted sm:grid-cols-2">
              {CONTRACT_PARTS.map(([term, detail]) => (
                <div key={term} className="bg-ink px-4 py-4">
                  <dt className="am-label text-gold">{term}</dt>
                  <dd className="mt-2 text-sm leading-[1.5] text-sand/70">
                    {detail}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="min-w-0">
            <ContractPreview />
            <p className="am-mono mt-3 text-steel">
              Illustrative excerpt · values are examples, not live project data
            </p>
          </div>
        </div>
      </div>

      <article
        id="conformance"
        data-scroll-chapter
        className="am-flow-anchor am-flow-chapter"
      >
        <CircuitField intensity={0.72} depth={0.075} />
        <div className="am-flow-chapter-inner mx-auto grid w-full max-w-shell items-center gap-10 px-5 sm:px-8 xl:grid-cols-[1.18fr_0.82fr] xl:gap-16 xl:px-12">
          <div
            className="max-w-[31rem] xl:col-start-2 xl:row-start-1"
            data-reveal
          >
            <ChapterLabel index="03">Verify</ChapterLabel>
            <h3 className="mt-5 text-[clamp(1.75rem,1.35rem+1.5vw,2.5rem)] leading-[1.1]">
              Trace every change back to the decision that shaped it.
            </h3>
            <p className="mt-5 leading-[1.7] text-sand/75">
              As the repository changes, deterministic rules follow ratified
              constraints through files, components, and dataflows. Drift
              becomes a concrete finding before it becomes architecture debt.
            </p>
          </div>

          <div className="flex justify-center xl:col-start-1 xl:row-start-1">
            <ScrollScrubVideo
              label="Repository conformance"
              poster="/media/conformance-scan-poster.webp"
              src="/media/conformance-scan-loop.mp4"
            />
          </div>
        </div>
      </article>
    </section>
  );
}
