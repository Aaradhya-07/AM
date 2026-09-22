import type { ReactNode } from "react";

export const GITHUB_URL = "https://github.com/N6118/ANVILMARK";
export const BRIEF_URL =
  "https://github.com/N6118/ANVILMARK/blob/main/ANVILMARK-CANONICAL-BRIEF.md";

/** Small circular terminal node, the recurring joint of the logo linework. */
export function TerminalNode({
  active = false,
  className = "",
}: {
  active?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${active ? "text-gold" : "text-sand/45"} ${className}`}
    >
      <circle
        cx="5"
        cy="5"
        r="3.25"
        fill={active ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

/**
 * Section divider: a hairline trace that steps through a terminal node on the
 * page's central axis, continuing the board pattern from the hero clip.
 */
export function CircuitDivider() {
  return (
    <div
      className="flex w-full items-center gap-0 text-sand/40"
      aria-hidden="true"
    >
      <span className="am-trace-x flex-1" />
      <svg
        viewBox="0 0 96 16"
        width="96"
        height="16"
        className="shrink-0"
        focusable="false"
      >
        <path
          d="M0 8h20l6-6h18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.5"
        />
        <path
          d="M96 8H76l-6 6H52"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.5"
        />
        <path
          d="M44 2h8M44 14h8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.5"
        />
        <circle cx="48" cy="8" r="2.75" className="fill-gold" />
      </svg>
      <span className="am-trace-x flex-1" />
    </div>
  );
}

/** Eyebrow preceded by a short trace and a terminal node. Uses the wordmark
 *  echo treatment so each section opens in the logotype's voice. */
export function SectionEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="am-eyebrow flex items-center gap-3">
      <span aria-hidden="true" className="flex items-center gap-2">
        <span className="block h-px w-6 bg-sand/30" />
        <TerminalNode />
      </span>
      {children}
    </p>
  );
}

/** Accessible external-link glyph. */
export function ExternalGlyph() {
  return (
    <svg
      viewBox="0 0 14 14"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path
        d="M5 2h7v7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="square"
      />
      <path
        d="M12 2 6 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="square"
      />
      <path
        d="M10 9.5V12H2V4h2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function GitHubGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
      fill="currentColor"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
