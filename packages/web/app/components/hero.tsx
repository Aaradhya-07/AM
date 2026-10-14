"use client";

import Link from "next/link";

import { TerminalNode } from "./circuitry";
import { HeroMedia } from "./hero-media";

const RUNTIMES = ["Claude Code", "Codex", "API", "Local model"];

const HEADLINE = "Review the decisions behind your AI feature.".split(" ");

export function Hero() {
  return (
    <>
      <section
        id="top"
        className="relative isolate flex flex-col overflow-hidden bg-ink lg:block"
      >
        <HeroMedia />
        <div
          className="am-hero-scrim z-[1] hidden lg:block"
          aria-hidden="true"
        />

        <div className="relative z-10 order-1 mx-auto flex w-full max-w-shell flex-col justify-center px-5 pb-12 pt-[calc(var(--am-header-h)+3rem)] sm:px-8 sm:pb-16 lg:min-h-[min(100svh,50rem)] lg:px-12 lg:pb-20 lg:pt-[calc(var(--am-header-h)+3.25rem)]">
          <div className="max-w-[36rem]">
            <p className="am-eyebrow flex flex-wrap items-center gap-x-3 gap-y-2">
              <TerminalNode active />
              <span>Browser-local</span>
              <span aria-hidden="true" className="text-steel">
                ·
              </span>
              <span>Agent-ready</span>
              <span aria-hidden="true" className="text-steel">
                ·
              </span>
              <span>Verifiable contract</span>
            </p>

            <h1 className="mt-6 text-[clamp(2.4rem,1.4rem+4.2vw,5rem)] leading-[1.02] text-canvas">
              {HEADLINE.map((word, index) => (
                <span
                  key={`${word}-${index}`}
                  className="am-word"
                  style={{ "--am-word-index": index } as React.CSSProperties}
                >
                  {word}
                  {index < HEADLINE.length - 1 ? "\u00A0" : ""}
                </span>
              ))}
            </h1>

            <p className="mt-5 max-w-[34rem] text-[1.0625rem] leading-[1.65] text-sand/85 sm:text-lg">
              Bring your own intelligence. Keep the decision. ANVILMARK verifies
              whether your agent-built code follows your recorded model choice,
              budget, and data boundary — with copyable precision prompts to
              close the loop.
            </p>

            <div className="mt-8 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Link
                  href="/demo"
                  data-magnetic
                  data-testid="hero-contract-cta"
                  className="am-btn am-btn-primary am-magnetic inline-flex items-center gap-2"
                >
                  <span>Create a contract</span>
                  <span aria-hidden="true" className="text-xs">
                    →
                  </span>
                </Link>
                <Link
                  href="/studio"
                  data-magnetic
                  className="am-btn am-btn-secondary am-magnetic"
                >
                  Review a bundle
                </Link>
                <Link
                  href="/start"
                  data-magnetic
                  className="am-btn am-btn-secondary am-magnetic text-sand/70 hover:text-canvas"
                >
                  Quickstart
                </Link>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-sand/60">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>
                  No account required for the browser draft or local CLI.
                </span>
              </div>
            </div>

            {/* Technical metadata, not an endorsement row. Held to two lines
                inside the copy column so the labels never run over the anvil. */}
            <div className="mt-9">
              <span className="am-trace-x block" aria-hidden="true" />
              <div className="mt-4 flex flex-col gap-2.5">
                <span className="am-label text-sand/75">
                  Bring your own intelligence
                </span>
                <ul className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {RUNTIMES.map((item, index) => (
                    <li key={item} className="flex items-center gap-3">
                      {index > 0 ? (
                        <span
                          aria-hidden="true"
                          className="block h-3 w-px bg-sand/20"
                        />
                      ) : null}
                      <span className="am-label text-sand/60">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        <span
          aria-hidden="true"
          className="am-trace-x absolute inset-x-0 bottom-0 z-10 hidden lg:block"
        />
      </section>
    </>
  );
}
