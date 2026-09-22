import Link from "next/link";

import { CircuitField } from "./circuit-field";
import { ExternalGlyph, GITHUB_URL, GitHubGlyph } from "./circuitry";
import { PillarCircuit } from "./pillar-circuit";

export function Closing() {
  return (
    <section
      id="closing"
      className="relative overflow-hidden border-t border-line-muted bg-ink py-24 lg:py-32"
    >
      <CircuitField intensity={0.9} />

      <div className="relative mx-auto max-w-shell px-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-4xl text-center" data-reveal>
          <PillarCircuit className="mx-auto mb-10 max-w-xl" />
          <h2 className="am-statement mx-auto max-w-[52rem]">
            Bring your own intelligence. Keep the decision.
          </h2>
          <p className="mx-auto mt-7 max-w-xl text-[1.0625rem] leading-[1.65] text-sand/80">
            ANVILMARK is a free-to-use engineering project in active
            development. No hosted model, no ANVILMARK API key, no mandatory
            account&#8202;—&#8202;your project state stays in your repository.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/playground"
              data-magnetic
              className="am-btn am-btn-primary am-magnetic"
            >
              <span>Explore Playground</span>
              <span aria-hidden="true" className="text-xs">
                →
              </span>
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              data-magnetic
              className="am-btn am-btn-secondary am-magnetic"
            >
              <GitHubGlyph />
              View the repository
              <span className="sr-only">(opens in a new tab)</span>
              <ExternalGlyph />
            </a>
          </div>

          <p className="am-mono mt-6 text-sand/60">
            github.com/N6118/ANVILMARK
          </p>
        </div>
      </div>
    </section>
  );
}
