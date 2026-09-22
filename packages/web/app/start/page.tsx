import type { Metadata } from "next";
import Link from "next/link";

import { GITHUB_URL } from "../components/circuitry";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

const CHECKOUT_SETUP = `git clone ${GITHUB_URL}.git
cd ANVILMARK
node scripts/setup.mjs
export ANVILMARK_CHECKOUT="$PWD"
anvilmark() { node "$ANVILMARK_CHECKOUT/packages/cli/bin/anvilmark.mjs" "$@"; }`;

export const metadata: Metadata = {
  title: "Quickstart & Setup · ANVILMARK",
  description:
    "Verified setup instructions for existing AI repositories and new agent-built projects.",
};

export default function StartPage() {
  return (
    <div className="min-h-screen bg-ink font-sans text-canvas selection:bg-gold selection:text-ink">
      <SiteHeader />

      <main className="pt-[var(--am-header-h)]">
        <div className="border-b border-line-muted bg-surface/80 bg-grain">
          <div className="mx-auto max-w-[108rem] px-5 py-8 sm:px-8">
            <div className="mb-2.5 flex items-center gap-2 text-xs text-sand/60">
              <Link
                href="/"
                className="inline-flex items-center gap-1 transition-colors hover:text-gold"
              >
                <span aria-hidden="true">←</span> Back to Home
              </Link>
              <span className="text-line-muted">/</span>
              <span className="text-sand/90">Quickstart</span>
            </div>
            <p className="text-[11px] font-medium uppercase tracking-brand text-gold">
              Setup &amp; Workflow Guide
            </p>
            <h1 className="mt-3 font-brand text-3xl font-light leading-tight text-canvas sm:text-4xl">
              Get Started with ANVILMARK
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-sand/80">
              Zero cloud account setup required. ANVILMARK runs entirely locally
              on your machine and in your browser.
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-[108rem] px-5 py-12 sm:px-8">
          <div className="mb-8 rounded border border-line-muted bg-surface p-6">
            <h2 className="text-xl font-medium text-canvas">
              Set up the CLI from a checkout
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-sand/70">
              The ANVILMARK CLI is not published to npm yet, so{" "}
              <code className="font-mono text-gold">npx</code> will not find it.
              Clone the repository, run setup (Node.js 24 and pnpm), then define
              the <code className="font-mono text-gold">anvilmark</code> command
              for your shell (bash or zsh):
            </p>
            <pre className="mt-4 overflow-x-auto rounded bg-ink p-3 font-mono text-xs text-sand">
              {CHECKOUT_SETUP}
            </pre>
            <p className="mt-2 text-xs text-sand/60">
              Full instructions:{" "}
              <a
                href={`${GITHUB_URL}/blob/main/QUICKSTART.md`}
                className="text-gold hover:underline"
              >
                QUICKSTART.md
              </a>
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Path A: Existing Project */}
            <div className="rounded border border-line-muted bg-surface p-6">
              <span className="rounded bg-gold/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gold">
                Path 1
              </span>
              <h2 className="mt-3 text-xl font-medium text-canvas">
                Existing TypeScript / JavaScript Project
              </h2>
              <p className="mt-2 text-sm text-sand/70">
                You already have an AI integration in code and want to review
                whether it conforms to your intended model and data boundary.
              </p>

              <div className="mt-6 space-y-4 text-xs">
                <div>
                  <p className="font-medium text-canvas">
                    1. Initialize local contract state in your repository:
                  </p>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-ink p-3 font-mono text-sand">
                    anvilmark init
                  </pre>
                </div>

                <div>
                  <p className="font-medium text-canvas">
                    2. Run local conformance check:
                  </p>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-ink p-3 font-mono text-sand">
                    anvilmark check
                  </pre>
                  <p className="mt-1 text-sand/60">
                    The check needs a current recorded decision and scanner
                    declarations that describe your code. See the{" "}
                    <a
                      href={`${GITHUB_URL}/blob/main/packages/cli/README.md`}
                      className="text-gold hover:underline"
                    >
                      CLI guide
                    </a>
                    .
                  </p>
                </div>

                <div>
                  <p className="font-medium text-canvas">
                    3. Export review bundle:
                  </p>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-ink p-3 font-mono text-sand">
                    anvilmark export --include-source
                  </pre>
                </div>

                <div>
                  <p className="font-medium text-canvas">
                    4. Review in browser:
                  </p>
                  <p className="mt-1 text-sand/80">
                    Open{" "}
                    <Link href="/studio" className="text-gold hover:underline">
                      ANVILMARK Studio
                    </Link>{" "}
                    and drop your generated{" "}
                    <code className="font-mono text-gold">
                      .anvilmark/review-bundle.json
                    </code>
                    .
                  </p>
                </div>
              </div>
            </div>

            {/* Path B: New Project with Coding Agents */}
            <div className="rounded border border-line-muted bg-surface p-6">
              <span className="rounded bg-gold/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-gold">
                Path 2
              </span>
              <h2 className="mt-3 text-xl font-medium text-canvas">
                New Project Built with Coding Agents
              </h2>
              <p className="mt-2 text-sm text-sand/70">
                You are about to start a new feature or application using Claude
                Code or Codex and want persistent architectural contracts.
              </p>

              <div className="mt-6 space-y-4 text-xs">
                <div>
                  <p className="font-medium text-canvas">
                    1. Initialize contract from your project idea:
                  </p>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-ink p-3 font-mono text-sand">
                    anvilmark init --idea &quot;Support desk with private
                    redactor&quot;
                  </pre>
                </div>

                <div>
                  <p className="font-medium text-canvas">
                    2. Elicit requirements &amp; constraints:
                  </p>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-ink p-3 font-mono text-sand">
                    anvilmark elicit
                  </pre>
                </div>

                <div>
                  <p className="font-medium text-canvas">
                    3. Compare candidates:
                  </p>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-ink p-3 font-mono text-sand">
                    anvilmark compare
                  </pre>
                  <p className="mt-1 text-sand/60">
                    Recording the decision is interactive and should be run by
                    you in your own terminal, not by your agent. See the Decide
                    commands in{" "}
                    <code className="font-mono">anvilmark help</code>.
                  </p>
                </div>

                <div>
                  <p className="font-medium text-canvas">
                    4. Generate context for your agent:
                  </p>
                  <pre className="mt-1.5 overflow-x-auto rounded bg-ink p-3 font-mono text-sand">
                    anvilmark generate
                  </pre>
                  <p className="mt-1 text-sand/60">
                    Creates AGENTS.md, Mermaid diagrams, and CALM specifications
                    for your coding agent.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
