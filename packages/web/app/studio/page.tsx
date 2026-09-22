import type { Metadata } from "next";

import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { StudioClient } from "./StudioClient";

export const metadata: Metadata = {
  title: "ANVILMARK Studio · Browser-Local Review Cockpit",
  description:
    "Review locally exported project review bundles in memory with zero cloud uploads or telemetry.",
};

export default function StudioPage() {
  return (
    <div className="min-h-screen bg-ink font-sans text-canvas selection:bg-gold selection:text-ink">
      <SiteHeader />
      <main className="pt-[var(--am-header-h)]">
        <StudioClient />
      </main>
      <SiteFooter />
    </div>
  );
}
