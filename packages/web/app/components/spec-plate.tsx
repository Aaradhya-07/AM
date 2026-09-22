import { TerminalNode } from "./circuitry";

/**
 * Facts about the shipped contract schema, not usage metrics.
 *
 * Every value here is checked against packages/project-contract:
 *   version  -> PROJECT_SCHEMA_VERSION in src/version.ts
 *   kinds    -> the 11-member evidence-kind enum in src/schema/evidence.ts
 *   subjects -> the 14-member constraint-subject enum in the same file
 * If the schema moves, these move with it.
 */
const SPECS: Array<[label: string, value: string, note: string]> = [
  [
    "Schema version",
    "0.1.0-draft.3",
    "Versioned, and diffable between revisions",
  ],
  ["Evidence kinds", "11", "From deterministic observation to agent inference"],
  ["Constraint subjects", "14", "Each one evaluated deterministically"],
];

export function SpecPlate() {
  return (
    <section aria-label="Contract schema specification" className="bg-ink">
      <div className="mx-auto max-w-shell px-5 sm:px-8 lg:px-12">
        <dl className="am-spec-grid">
          {SPECS.map(([label, value, note], index) => (
            <div
              key={label}
              className="am-spec-cell"
              data-reveal="wipe"
              style={
                { "--reveal-delay": `${index * 70}ms` } as React.CSSProperties
              }
            >
              <dt className="am-label flex items-center gap-2.5 text-sand/65">
                <TerminalNode active={index === 0} />
                {label}
              </dt>
              <dd className="mt-3 font-brand text-[clamp(1.75rem,1.2rem+1.6vw,2.5rem)] font-light leading-none text-canvas">
                {value}
              </dd>
              <p className="mt-2.5 text-sm leading-[1.5] text-sand/55">
                {note}
              </p>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
