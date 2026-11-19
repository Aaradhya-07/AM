import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { CopyCommand } from "../components/alpha-interactions";
import { GITHUB_URL } from "../components/circuitry";

export const metadata: Metadata = {
  title: "Start locally",
  description:
    "Set up Anvilmark and inspect your repository's development landscape. Your repository, agent and records stay under your control.",
};
const setup = `git clone ${GITHUB_URL}.git
cd AM
node scripts/setup.mjs
export ANVILMARK_CHECKOUT="$PWD"
anvilmark() { node "$ANVILMARK_CHECKOUT/packages/cli/bin/anvilmark.mjs" "$@"; }`;

export default function StartPage() {
  return (
    <div className="alpha alpha-page">
      <a href="#main" className="alpha-skip">
        Skip to content
      </a>
      <SiteHeader />
      <main tabIndex={-1} id="main" className="alpha-shell alpha-guide">
        <div className="alpha-page-heading">
          <p className="alpha-label">GETTING STARTED / LOCAL FIRST</p>
          <h1>
            A little setup.
            <br />
            <em>A clearer starting point.</em>
          </h1>
          <p>
            Bring a Git repository and the coding agent you already use. Start
            by understanding the work, then make one bounded decision.
          </p>
          <span className="alpha-label">
            NODE.JS 24+ · PNPM 11.16.0 · BASH OR ZSH
          </span>
        </div>
        <div className="alpha-guide-layout">
          <aside>
            <p className="alpha-label">ON THIS PAGE</p>
            <a href="#install">01 / Get the tools</a>
            <a href="#landscape">02 / Understand your repo</a>
            <a href="#decision">03 / Make a bounded plan</a>
            <a href="#record">04 / Read your run</a>
            <p>
              No account required.
              <br />
              You supply the agent and model access.
            </p>
          </aside>
          <div>
            <section id="install">
              <span className="alpha-label">01 / GET THE TOOLS</span>
              <h2>Start from the source.</h2>
              <p>
                Run setup from a checkout, then define a shell helper that works
                from your own repository. Setup prepares the local workspace and
                its dependencies.
              </p>
              <CopyCommand command={setup} />
              <a
                className="alpha-text-link"
                href={`${GITHUB_URL}/blob/main/QUICKSTART.md`}
              >
                Full setup guide ↗
              </a>
            </section>
            <section id="landscape">
              <span className="alpha-label">02 / UNDERSTAND YOUR REPO</span>
              <h2>Look before you choose.</h2>
              <p>
                Move to your project and inspect its development landscape:
                structure, working conventions and recorded history. Replace the
                path and goal with your own.
              </p>
              <CopyCommand
                command={
                  'cd /path/to/your/repository\nanvilmark development landscape --goal "Describe the change you want to make"'
                }
              />
              <p className="alpha-note">
                This inspects local repository facts. Missing coding-agent
                history stays unattributed; an AI SDK import does not identify
                who wrote the code.
              </p>
            </section>
            <section id="decision">
              <span className="alpha-label">03 / MAKE A BOUNDED PLAN</span>
              <h2>One task. Explicit boundaries.</h2>
              <p>
                The development plan records the task, allowed configurations
                and acceptance checks. Follow the local workflow guide to
                prepare a plan, compare candidates and approve the exact choice
                before an agent runs.
              </p>
              <CopyCommand command="anvilmark development --help" />
              <div className="alpha-guide-links">
                <a
                  href={`${GITHUB_URL}/blob/main/packages/cli/README.md`}
                  className="alpha-text-link"
                >
                  Development CLI guide ↗
                </a>
                <a
                  href={`${GITHUB_URL}/blob/main/docs/vnext/10-node-development-provenance-plan.md`}
                  className="alpha-text-link"
                >
                  How the record works ↗
                </a>
              </div>
              <p className="alpha-note">
                This is a local pilot. Public evidence supports provisional
                choices; it does not establish quality or savings for your task.
                Approval and execution remain in your terminal.
              </p>
            </section>
            <section id="record">
              <span className="alpha-label">04 / READ YOUR RUN</span>
              <h2>Bring the result into focus.</h2>
              <p>
                After a recorded local run, open its JSON file from{" "}
                <code>.anvilmark/development/runs/</code> in the read-only
                browser companion. The file stays in browser memory. No
                repository connection or upload is needed.
              </p>
              <Link href="/workspace" className="alpha-button">
                Open your records <span aria-hidden="true">↗</span>
              </Link>
              <p className="alpha-note">
                The companion displays recorded fields. It cannot independently
                verify the file, current repository state or human acceptance.
                Use the local CLI for authoritative review.
              </p>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
