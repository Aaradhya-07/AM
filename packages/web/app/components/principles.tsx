import { CircuitField } from "./circuit-field";
import { SectionEyebrow } from "./circuitry";

const PRINCIPLES = [
  {
    index: "P1",
    name: "Local-first",
    body: "Project state and deterministic checks stay under your control. No mandatory account, no repository upload by default.",
  },
  {
    index: "P2",
    name: "Vendor-neutral",
    body: "Compare managed, open-weight, local, and hybrid options without locking the contract to one provider.",
  },
  {
    index: "P3",
    name: "Evidence-backed",
    body: "Sources, timestamps, assumptions, measurements, uncertainty, and rejected alternatives stay attached to the decisions they justify.",
  },
  {
    index: "P4",
    name: "Agent-ready",
    body: "Generate structured context that Claude Code, Codex, or another chosen coding agent can execute against.",
  },
];

export function Principles() {
  return (
    <section
      id="principles"
      className="relative overflow-hidden border-t border-line-muted bg-ink py-24 lg:py-32"
    >
      <CircuitField intensity={0.6} />

      <div className="relative mx-auto max-w-shell px-5 sm:px-8 lg:px-12">
        <div className="max-w-2xl" data-reveal>
          <SectionEyebrow>Principles</SectionEyebrow>
          <h2 className="mt-6 text-[clamp(1.875rem,1.3rem+1.9vw,2.875rem)] leading-[1.1]">
            Four rules the contract has to keep.
          </h2>
        </div>

        <ul className="mt-14 grid gap-5 md:grid-cols-2 lg:gap-6">
          {PRINCIPLES.map((item, index) => (
            <li
              key={item.index}
              data-reveal
              style={
                { "--reveal-delay": `${index * 80}ms` } as React.CSSProperties
              }
            >
              <article className="am-module h-full p-7 lg:p-8">
                <p className="am-label text-gold">{item.index}</p>
                <h3 className="mt-4 text-xl leading-tight">{item.name}</h3>
                <p className="mt-3.5 leading-[1.65] text-sand/70">
                  {item.body}
                </p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
