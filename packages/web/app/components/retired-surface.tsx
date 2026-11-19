import Link from "next/link";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

export function RetiredSurface() {
  return (
    <div className="alpha alpha-page">
      <a href="#main" className="alpha-skip">
        Skip to content
      </a>
      <SiteHeader />
      <main tabIndex={-1} id="main" className="alpha-shell alpha-retired">
        <p className="alpha-label">VERSION ALPHA / A NEW CHAPTER</p>
        <h1>
          We’ve moved
          <br />
          <em>the work forward.</em>
        </h1>
        <p>
          The earlier application-contract demos and example console have been
          retired from this website. Alpha focuses on development decisions: the
          setup you choose, what your agent delivered and the review that
          follows.
        </p>
        <div className="alpha-hero-actions">
          <Link className="alpha-button" href="/start">
            Start with your project ↗
          </Link>
          <Link className="alpha-text-link" href="/workspace">
            Open a development record ↗
          </Link>
        </div>
        <p className="alpha-note">
          Older application-contract bundles are a different format. The record
          viewer does not convert them into development evidence.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
