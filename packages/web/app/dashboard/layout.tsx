import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";

export const metadata: Metadata = {
  title: "Console · ANVILMARK Platform",
  description:
    "Manage repository decision contracts, inspect CALM architectures, and monitor agent conformance in real time.",
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink font-sans text-canvas selection:bg-gold selection:text-ink flex flex-col">
      <SiteHeader />
      <main className="flex-1 pt-[var(--am-header-h)]">{children}</main>
      <SiteFooter />
    </div>
  );
}
