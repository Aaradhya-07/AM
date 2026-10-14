import type { Metadata } from "next";

import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { DemoClient } from "./DemoClient";

export const metadata: Metadata = {
  title: "Draft a decision contract",
  description:
    "Turn an AI project idea into a portable draft contract and compare model candidates with visible evidence gaps.",
};

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-ink text-canvas">
      <SiteHeader />
      <main className="mx-auto max-w-shell px-5 pb-20 pt-[calc(var(--am-header-h)+3rem)] sm:px-8 lg:px-12">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-brand text-gold">
            AM browser demo
          </p>
          <h1 className="mt-3 font-brand text-4xl font-light sm:text-5xl">
            From an idea to a decision draft
          </h1>
          <p className="mt-4 text-base leading-7 text-sand/75">
            Describe one workload, choose a data-flow path, and compare sourced
            model starting points. Download a draft ANVILMARK project contract
            to continue in the CLI and MCP workflow.
          </p>
        </div>
        <DemoClient />
      </main>
      <SiteFooter />
    </div>
  );
}
