import Link from "next/link";
import { GITHUB_URL } from "./circuitry";

export function SiteFooter() {
  return (
    <footer className="alpha alpha-footer">
      <div className="alpha-shell">
        <div className="alpha-footer-top">
          <Link className="alpha-footer-wordmark" href="/">
            ANVILMARK<span aria-hidden="true">✳</span>
          </Link>
          <p>
            Better decisions.
            <br />A record to build on.
          </p>
        </div>
        <div className="alpha-footer-bottom">
          <span className="alpha-label">Independent. Local-first. Yours.</span>
          <nav aria-label="Footer">
            <Link href="/start">Start locally ↗</Link>
            <Link href="/models">Model research ↗</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener">
              Source on GitHub ↗
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </nav>
          <span className="alpha-label">VERSION ALPHA · 2026</span>
        </div>
      </div>
    </footer>
  );
}
