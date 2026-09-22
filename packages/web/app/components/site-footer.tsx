import Image from "next/image";
import Link from "next/link";

import { BRIEF_URL, ExternalGlyph, GITHUB_URL } from "./circuitry";

const LINKS: Array<{ href: string; label: string; external?: boolean }> = [
  { href: "/", label: "Home" },
  { href: "/playground", label: "Playground" },
  { href: GITHUB_URL, label: "Repository", external: true },
  { href: BRIEF_URL, label: "Canonical brief", external: true },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line-muted bg-ink">
      <div className="mx-auto max-w-shell px-5 py-10 sm:px-8 lg:px-12">
        <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center">
          <Image
            src="/brand/logo-horizontal-reversed-transparent.png"
            alt="ANVILMARK"
            width={320}
            height={84}
            className="-ml-1 h-10 w-auto sm:h-11"
          />

          <nav aria-label="Footer" className="min-w-0">
            <ul className="flex flex-wrap items-center gap-x-8 gap-y-3 sm:justify-end">
              {LINKS.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="am-ui inline-flex min-h-[44px] items-center gap-2 rounded-edge text-sand/75 transition-colors hover:text-gold"
                    >
                      {link.label}
                      <span className="sr-only">(opens in a new tab)</span>
                      <ExternalGlyph />
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="am-ui inline-flex min-h-[44px] items-center rounded-edge text-sand/75 transition-colors hover:text-gold"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>

          <p className="am-label text-sand/60 sm:col-span-2">
            Free to use · Local-first · Vendor-neutral
          </p>
        </div>

        <p className="mt-7 border-t border-line-muted pt-5 text-sm leading-[1.6] text-sand/60">
          Early development. Schemas and interfaces are still changing.
        </p>
      </div>
    </footer>
  );
}
