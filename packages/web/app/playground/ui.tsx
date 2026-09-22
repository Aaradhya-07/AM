import type { ReactNode } from "react";

import { StandingIcon } from "./icons";
import type { Standing } from "./types";

interface StandingToken {
  label: string;
  className: string;
  dashed: boolean;
}

const STANDING_TOKENS: Record<Standing | "not_checked", StandingToken> = {
  pass: {
    label: "Pass",
    className: "text-[#4ade80] bg-[#102a1c] border-[#1d4d33]",
    dashed: false,
  },
  fail: {
    label: "Fail",
    className: "text-[#f87171] bg-[#2e1313] border-[#592323]",
    dashed: false,
  },
  unknown: {
    label: "Unknown",
    className: "text-[#fbbf24] bg-[#291f09] border-[#523e12]",
    dashed: true,
  },
  not_applicable: {
    label: "Not applicable",
    className: "text-steel bg-surface border-line-muted",
    dashed: false,
  },
  not_checked: {
    label: "Not checked",
    className: "text-steel/70 bg-transparent border-line-muted",
    dashed: true,
  },
};

export function standingToken(standing: Standing | "not_checked") {
  return STANDING_TOKENS[standing] ?? STANDING_TOKENS.unknown;
}

export function StandingBadge({
  standing,
  size = "sm",
}: {
  standing: Standing | "not_checked";
  size?: "sm" | "md";
}) {
  const token = standingToken(standing);
  const pad = size === "md" ? "px-3 py-1 text-xs" : "px-2 py-0.5 text-[11px]";
  return (
    <span
      data-testid={`standing-badge-${standing}`}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium uppercase tracking-wide ${pad} ${token.className} ${
        token.dashed ? "border-dashed" : "border-solid"
      }`}
    >
      {standing !== "not_checked" ? (
        <StandingIcon standing={standing} width={13} height={13} />
      ) : null}
      {token.label}
    </span>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-steel">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-6 text-canvas">
        {empty ? <span className="text-steel/50">Unavailable</span> : children}
      </dd>
    </div>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b border-line-muted pb-3">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="m-0 font-brand text-lg font-medium text-canvas">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
