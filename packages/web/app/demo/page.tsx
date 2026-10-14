import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { GITHUB_URL } from "../components/circuitry";
import { SiteFooter } from "../components/site-footer";
import { DemoClient } from "./DemoClient";

export const metadata: Metadata = {
  title: "Draft a decision contract",
  description:
    "Turn an AI project idea into a portable draft contract and compare model candidates with visible evidence gaps.",
};

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-ink text-canvas">
      <header className="border-b border-line-muted bg-ink/95">
        <div className="mx-auto flex min-h-[var(--am-header-h)] max-w-shell flex-wrap items-center justify-between gap-4 px-5 py-2 sm:px-8 lg:px-12">
          <Link href="/demo" aria-label="ANVILMARK demo home">
            <Image
              src="/brand/logo-horizontal-reversed-transparent.png"
              alt="ANVILMARK"
              width={320}
              height={84}
              className="h-11 w-auto"
              priority
            />
          </Link>
          <nav
            aria-label="Demo navigation"
            className="flex flex-wrap gap-5 text-xs text-sand/75 sm:text-sm"
          >
            <Link href="/demo" aria-current="page" className="text-gold">
              Create a contract
            </Link>
            <Link href="/studio" className="hover:text-gold">
              Review bundle
            </Link>
            <Link href="/start" className="hover:text-gold">
              CLI &amp; MCP
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-gold"
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-shell px-5 pb-20 pt-12 sm:px-8 lg:px-12">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-brand text-gold">
            AM browser demo
          </p>
          <h1 className="mt-3 font-brand text-4xl font-light sm:text-5xl">
            From an idea to a decision draft
          </h1>
          <p className="mt-4 text-base leading-7 text-sand/75">
            Describe one workload, set its restrictions, and compare two ways to
            run it. Download a real ANVILMARK project contract to continue in
            the CLI and MCP workflow.
          </p>
        </div>
        <DemoClient />
      </main>
      <SiteFooter />
    </div>
  );
}
