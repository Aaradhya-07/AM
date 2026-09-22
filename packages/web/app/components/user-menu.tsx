"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "./auth-provider";
import { TerminalNode } from "./circuitry";

export function UserMenu({
  onOpenAuth,
  onOpenCliConnect,
}: {
  onOpenAuth: () => void;
  onOpenCliConnect?: () => void;
}) {
  const { user, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  if (loading) {
    return (
      <div className="h-9 w-20 animate-pulse rounded-edge bg-graphite/40" />
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={onOpenAuth}
        className="am-ui inline-flex min-h-[40px] items-center gap-2 rounded-edge border border-gold/60 bg-gold/10 px-4 text-xs font-medium uppercase tracking-wider text-gold transition-colors hover:border-gold hover:bg-gold/20"
      >
        <TerminalNode active />
        <span>Sign In</span>
      </button>
    );
  }

  const initials =
    user.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "AM";

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        className="flex items-center gap-2.5 rounded-edge border border-line-muted bg-surface/80 p-1.5 pr-3 text-left transition-colors hover:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold"
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name || "User avatar"}
            width={28}
            height={28}
            referrerPolicy="no-referrer"
            className="h-7 w-7 rounded-full object-cover border border-line-muted"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gold/20 font-mono text-[11px] font-bold text-gold border border-gold/40">
            {initials}
          </div>
        )}
        <div className="hidden sm:block">
          <div className="flex items-center gap-1.5">
            <span className="font-sans text-xs font-medium text-canvas">
              {(user.name || "Engineer").split(" ")[0]}
            </span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold" />
          </div>
          <p className="font-mono text-[10px] text-sand/60">Console</p>
        </div>
        <svg
          className={`h-3 w-3 text-sand/60 transition-transform ${menuOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {menuOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-module border border-line-muted bg-surface p-2 shadow-xl z-50 animate-fadeUp">
          {/* User Info Header */}
          <div className="border-b border-line-muted/60 p-2.5 pb-3">
            <p className="font-sans text-xs font-semibold text-canvas truncate">
              {user.name}
            </p>
            <p className="font-mono text-[11px] text-sand/60 truncate">
              {user.email}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <span className="rounded bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-gold">
                {user.provider}
              </span>
              <span className="font-mono text-[10px] text-sand/40">
                Personal Workspace
              </span>
            </div>
          </div>

          {/* Links */}
          <div className="py-1">
            <Link
              href="/dashboard"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-edge px-2.5 py-2 text-xs font-medium text-sand hover:bg-graphite/60 hover:text-canvas transition-colors"
            >
              <svg
                className="h-4 w-4 text-gold"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>
              <span>Platform Dashboard</span>
            </Link>

            <Link
              href="/studio"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-edge px-2.5 py-2 text-xs font-medium text-sand hover:bg-graphite/60 hover:text-canvas transition-colors"
            >
              <svg
                className="h-4 w-4 text-gold"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
                />
              </svg>
              <span>Architecture Studio</span>
            </Link>

            {onOpenCliConnect && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenCliConnect();
                }}
                className="flex w-full items-center gap-2.5 rounded-edge px-2.5 py-2 text-xs font-medium text-sand hover:bg-graphite/60 hover:text-canvas transition-colors"
              >
                <svg
                  className="h-4 w-4 text-gold"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <span>Connect CLI (`anvilmark login`)</span>
              </button>
            )}
          </div>

          <div className="border-t border-line-muted/60 pt-1">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 rounded-edge px-2.5 py-2 text-xs font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
