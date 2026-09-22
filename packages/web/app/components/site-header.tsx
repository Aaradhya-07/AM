"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ExternalGlyph, GITHUB_URL, GitHubGlyph } from "./circuitry";
import { AuthModal } from "./auth-modal";
import { useAuth } from "./auth-provider";
import { UserMenu } from "./user-menu";
import { CliConnectModal } from "../dashboard/components/cli-connect-modal";

const NAV = [
  { href: "/#flow", label: "The flow", anchor: "flow" },
  { href: "/#contract", label: "The contract", anchor: "contract" },
  { href: "/playground", label: "Playground" },
  { href: "/studio", label: "Studio" },
  { href: "/start", label: "Quickstart" },
];

const SECTION_IDS = NAV.filter((item) => item.anchor).map(
  (item) => item.anchor!,
);

export function SiteHeader() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [cliModalOpen, setCliModalOpen] = useState(false);
  const isPlayground = pathname === "/playground";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const navItems = user
    ? [{ href: "/dashboard", label: "Dashboard" }, ...NAV]
    : NAV;

  useEffect(() => {
    let raf = 0;

    const measure = () => {
      raf = 0;
      const y = window.scrollY;
      setScrolled(y > 12);

      const total = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = total > 0 ? Math.min(1, Math.max(0, y / total)) : 0;
      railRef.current?.style.setProperty("--am-progress", ratio.toFixed(4));
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  /* Scrollspy. rootMargin pins the trigger line just under the header so a
     section counts as current once its heading clears the chrome. */
  useEffect(() => {
    const sections = SECTION_IDS.map((id) =>
      document.getElementById(id),
    ).filter((node): node is HTMLElement => node !== null);
    if (sections.length === 0) return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting)
            visible.set(entry.target.id, entry.intersectionRatio);
          else visible.delete(entry.target.id);
        }
        let best: string | null = null;
        let bestRatio = 0;
        for (const [id, ratio] of visible) {
          if (ratio >= bestRatio) {
            bestRatio = ratio;
            best = id;
          }
        }
        setCurrent(best);
      },
      {
        rootMargin: "-25% 0px -55% 0px",
        threshold: [0, 0.15, 0.35, 0.6, 1],
      },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 border-b backdrop-blur-sm transition-colors duration-200 ${
          scrolled || open
            ? "border-line-muted bg-ink/95"
            : "border-line-muted/40 bg-ink/80"
        }`}
      >
        <div className="am-inset-x mx-auto flex h-[var(--am-header-h)] max-w-shell items-center justify-between gap-4 px-5 sm:px-8 lg:px-12">
          {/* The logotype is light and very widely tracked. It gets its own clear
            space and a hairline separator so it is never read as the first word
            of the navigation line. */}
          <div className="flex items-center gap-5 lg:gap-8">
            <Link
              href="/"
              className="-my-2 flex items-center rounded-edge"
              aria-label="ANVILMARK — back to home"
            >
              <Image
                src="/brand/logo-horizontal-reversed-transparent.png"
                alt="ANVILMARK"
                width={320}
                height={84}
                priority
                className="h-12 w-auto lg:h-14"
              />
            </Link>

            <span
              aria-hidden="true"
              className="am-trace-y hidden h-8 md:block"
            />

            <nav
              aria-label="Primary"
              className="hidden items-center gap-8 md:flex"
            >
              {navItems.map((item) => {
                const isCurrent =
                  pathname === item.href ||
                  (item.href === "/dashboard" &&
                    pathname.startsWith("/dashboard"));
                return item.anchor ? (
                  <a
                    key={item.href}
                    href={item.href}
                    aria-current={
                      !isPlayground && current === item.anchor
                        ? "true"
                        : undefined
                    }
                    className="am-ui am-nav-link rounded-edge py-2 text-sand/80 transition-colors hover:text-canvas"
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isCurrent ? "page" : undefined}
                    className={`am-ui am-nav-link rounded-edge py-2 font-medium transition-colors ${
                      isCurrent
                        ? "text-gold after:scale-x-100"
                        : "text-gold/90 hover:text-gold"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          isCurrent
                            ? "bg-gold shadow-[0_0_6px_#D08D2E]"
                            : "bg-gold/60"
                        }`}
                      />
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <UserMenu
              onOpenAuth={() => setAuthModalOpen(true)}
              onOpenCliConnect={() => setCliModalOpen(true)}
            />

            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="am-ui hidden min-h-[40px] items-center gap-2 rounded-edge border border-line-muted px-4 text-sand/80 transition-colors hover:border-gold hover:text-gold sm:inline-flex"
            >
              <GitHubGlyph />
              <span>GitHub</span>
              <span className="sr-only">(opens in a new tab)</span>
              <ExternalGlyph />
            </a>

            <button
              ref={toggleRef}
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              className="am-ui inline-flex min-h-[40px] items-center rounded-edge border border-line-muted px-4 text-sand/80 transition-colors hover:border-gold hover:text-gold md:hidden"
            >
              {open ? "Close" : "Menu"}
            </button>
          </div>
        </div>

        <span ref={railRef} className="am-progress" aria-hidden="true" />

        <div
          id="mobile-nav"
          hidden={!open}
          className="border-t border-line-muted bg-ink md:hidden"
        >
          <nav aria-label="Primary, mobile" className="px-5 py-3 sm:px-8">
            <ul className="flex flex-col">
              {navItems.map((item) => {
                const isCurrent =
                  pathname === item.href ||
                  (item.href === "/dashboard" &&
                    pathname.startsWith("/dashboard"));
                return (
                  <li
                    key={item.href}
                    className="border-b border-line-muted last:border-b-0"
                  >
                    {item.anchor ? (
                      <a
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={
                          !isPlayground && current === item.anchor
                            ? "true"
                            : undefined
                        }
                        className="am-ui block min-h-[44px] py-3.5 text-sand/80 transition-colors aria-[current]:text-gold hover:text-canvas"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={isCurrent ? "page" : undefined}
                        className="am-ui flex min-h-[44px] items-center gap-2 py-3.5 font-medium text-gold transition-colors hover:text-sand"
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            isCurrent
                              ? "bg-gold shadow-[0_0_6px_#D08D2E]"
                              : "bg-gold/60"
                          }`}
                        />
                        {item.label}
                      </Link>
                    )}
                  </li>
                );
              })}
              <li className="border-t border-line-muted sm:hidden">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={() => setOpen(false)}
                  className="am-ui flex items-center gap-2 py-4 text-sand/80 transition-colors hover:text-canvas"
                >
                  <GitHubGlyph />
                  View on GitHub
                  <span className="sr-only">(opens in a new tab)</span>
                  <ExternalGlyph />
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <AuthModal open={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      <CliConnectModal
        open={cliModalOpen}
        onClose={() => setCliModalOpen(false)}
      />
    </>
  );
}
