"use client";

import type { ReactNode } from "react";
import { GlyphBackground } from "../../components/ui/backgrounds-glyph";
import { useAuth } from "./auth-provider";
import { SiteHeader } from "./site-header";
import "./session-surface.css";

export function SessionSurface({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const dark = Boolean(user);
  return (
    <div
      className="alpha alpha-page session-surface"
      data-theme={dark ? "dark" : "light"}
    >
      <GlyphBackground dark={dark} />
      <SiteHeader tone={dark ? "dark" : "light"} />
      {children}
    </div>
  );
}
