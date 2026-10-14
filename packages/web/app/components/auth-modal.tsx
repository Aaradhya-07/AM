"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useAuth } from "./auth-provider";
import { GitHubGlyph, TerminalNode } from "./circuitry";
import { GoogleGlyph } from "./google-glyph";

export function AuthModal({
  open,
  onClose,
  initialError,
}: {
  open: boolean;
  onClose: () => void;
  initialError?: string | null;
}) {
  const { signInWithProvider, isConfigured } = useAuth();
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setError(null);
      return;
    }
    setError(initialError ?? null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, initialError]);

  if (!open || !mounted) return null;

  const handleOAuth = async (provider: "github" | "google") => {
    setSubmitting(provider);
    setError(null);
    try {
      await signInWithProvider(provider);
    } catch (err) {
      console.error("Sign-in failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Authentication failed. Please verify provider configuration in console.",
      );
    } finally {
      setSubmitting(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog */}
      <div className="relative my-auto w-full max-w-md rounded-module border border-line/40 bg-surface p-6 shadow-2xl sm:p-8 z-10">
        {/* Terminal Header Accent */}
        <div className="flex items-center justify-between border-b border-line-muted pb-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-gold">
            <TerminalNode active />
            <span>ANVILMARK // IDENTITY</span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-sand/60 transition-colors hover:text-canvas focus:outline-none focus:ring-1 focus:ring-gold"
            aria-label="Close modal"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="mt-6 text-center">
          <h2
            id="auth-modal-title"
            className="font-brand text-2xl font-bold tracking-tight text-canvas"
          >
            Sign in to your workspace
          </h2>
          <p className="mt-2 text-sm text-sand/70">
            Use GitHub or Google to access projects saved to your configured
            Supabase workspace.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-edge border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300"
          >
            {error}
          </div>
        )}

        {/* Auth Buttons */}
        {isConfigured && (
          <div className="mt-8 space-y-3">
            <button
              type="button"
              disabled={Boolean(submitting)}
              onClick={() => handleOAuth("github")}
              className="flex w-full min-h-[46px] items-center justify-center gap-3 rounded-edge border border-line-muted bg-graphite/40 px-4 font-sans text-sm font-medium text-canvas transition-all hover:border-gold hover:bg-graphite/80 focus:outline-none focus:ring-2 focus:ring-gold"
            >
              <GitHubGlyph />
              <span>
                {submitting === "github"
                  ? "Connecting to GitHub..."
                  : "Continue with GitHub"}
              </span>
            </button>

            <button
              type="button"
              disabled={Boolean(submitting)}
              onClick={() => handleOAuth("google")}
              className="flex w-full min-h-[46px] items-center justify-center gap-3 rounded-edge border border-line-muted bg-graphite/40 px-4 font-sans text-sm font-medium text-canvas transition-all hover:border-gold hover:bg-graphite/80 focus:outline-none focus:ring-2 focus:ring-gold"
            >
              <GoogleGlyph />
              <span>
                {submitting === "google"
                  ? "Connecting to Google..."
                  : "Continue with Google"}
              </span>
            </button>
          </div>
        )}

        {!isConfigured && (
          <div className="mt-6 rounded-edge border border-gold/30 bg-gold/5 p-4 text-left">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-gold">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold" />
              <span>Guest workspace available</span>
            </div>
            <p className="mt-1.5 text-xs text-sand/80 leading-relaxed">
              Supabase sign-in is not configured for this deployment. Set{" "}
              <code className="rounded bg-graphite px-1 py-0.5 font-mono text-[10px] text-canvas">
                NEXT_PUBLIC_SUPABASE_URL
              </code>{" "}
              and{" "}
              <code className="rounded bg-graphite px-1 py-0.5 font-mono text-[10px] text-canvas">
                NEXT_PUBLIC_SUPABASE_ANON_KEY
              </code>
              . You can still use the local workspace without signing in.
            </p>
            <Link
              href="/dashboard"
              onClick={onClose}
              className="mt-3 inline-flex min-h-[40px] items-center rounded-edge border border-gold/50 px-3 text-xs font-medium text-gold hover:bg-gold/10"
            >
              Open local workspace
            </Link>
          </div>
        )}

        {/* Privacy Note */}
        <div className="mt-6 border-t border-line-muted/60 pt-4 text-center font-mono text-[11px] text-sand/50">
          Guest projects are stored in this browser. Sign-in requires a
          configured Supabase project.
        </div>
      </div>
    </div>,
    document.body,
  );
}
