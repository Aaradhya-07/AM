import type { Metadata } from "next";
import { SessionSurface } from "../components/session-surface";
import { SiteFooter } from "../components/site-footer";
import { RunReader } from "./run-reader";
export const metadata: Metadata = {
  title: "Your development records",
  description:
    "Read a local development-run record in browser memory. Inspect configured and tool-reported models, recorded checks, changes and cost basis.",
};
export default function WorkspacePage() {
  return (
    <SessionSurface>
      <a href="#main" className="alpha-skip">
        Skip to content
      </a>
      <main tabIndex={-1} id="main" className="alpha-shell alpha-workspace">
        <div className="alpha-page-heading">
          <p className="alpha-label">YOUR RECORDS / READ-ONLY COMPANION</p>
          <h1>
            The work happened.
            <br />
            <em>Keep it in view.</em>
          </h1>
          <p>
            Open a local development run to read the setup, associated changes,
            recorded checks and cost basis. Your file stays in this browser’s
            memory.
          </p>
        </div>
        <RunReader />
      </main>
      <SiteFooter />
    </SessionSurface>
  );
}
