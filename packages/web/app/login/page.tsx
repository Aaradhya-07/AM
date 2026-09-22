"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../components/auth-provider";
import { GitHubGlyph, TerminalNode } from "../components/circuitry";
import { GoogleGlyph } from "../components/google-glyph";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const [authError, setAuthError] = useState<string | null>(error);
  const { user, loading, signInWithProvider, signInDemo, isConfigured } =
    useAuth();
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard");
    }
  }, [user, loading, router]);

  const handleOAuth = async (provider: "github" | "google") => {
    setSubmitting(provider);
    setAuthError(null);
    try {
      if (!isConfigured) {
        signInDemo(provider === "github" ? "developer" : "architect");
        router.push("/dashboard");
        return;
      }
      await signInWithProvider(provider);
    } catch (err) {
      console.error("Sign-in failed:", err);
      setAuthError(
        err instanceof Error
          ? err.message
          : "Authentication failed. Please verify provider configuration.",
      );
    } finally {
      setSubmitting(null);
    }
  };

  const handleDemo = (role: "developer" | "architect") => {
    signInDemo(role);
    router.push("/dashboard");
  };

  return (
    <div className="w-full max-w-md rounded-module border border-line/40 bg-surface p-6 shadow-2xl sm:p-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line-muted pb-4">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-gold">
          <TerminalNode active />
          <span>ANVILMARK // CONSOLE</span>
        </div>
        <Link
          href="/"
          className="text-xs font-mono text-sand/60 hover:text-gold transition-colors"
        >
          Back to Home
        </Link>
      </div>

      <div className="mt-6 text-center">
        <h1 className="font-brand text-2xl font-bold tracking-tight text-canvas">
          Sign In to Platform
        </h1>
        <p className="mt-2 text-sm text-sand/70">
          Turn your repositories into evidence-backed architecture contracts and
          monitor agent conformance.
        </p>
      </div>

      {authError && (
        <div className="mt-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
          {authError}
        </div>
      )}

      {/* Buttons */}
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

      {/* Sandbox mode */}
      {!isConfigured && (
        <div className="mt-6 rounded-edge border border-gold/30 bg-gold/5 p-4 text-left">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-gold">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold" />
            <span>Preview Mode (Supabase keys pending)</span>
          </div>
          <p className="mt-1.5 text-xs text-sand/80 leading-relaxed">
            Supabase credentials are not yet set in{" "}
            <code className="rounded bg-graphite px-1 py-0.5 font-mono text-[10px] text-canvas">
              .env.local
            </code>
            . Click below to inspect the platform dashboard using test roles:
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleDemo("developer")}
              className="rounded-edge border border-line-muted bg-surface px-2.5 py-1.5 font-mono text-xs text-sand hover:border-gold hover:text-gold transition-colors"
            >
              Developer Role
            </button>
            <button
              type="button"
              onClick={() => handleDemo("architect")}
              className="rounded-edge border border-line-muted bg-surface px-2.5 py-1.5 font-mono text-xs text-sand hover:border-gold hover:text-gold transition-colors"
            >
              Lead Architect
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-line-muted/60 pt-4 text-center font-mono text-[11px] text-sand/50">
        Local-first & privacy-respecting. Your source code stays on your
        machine.
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-ink font-sans text-canvas selection:bg-gold selection:text-ink flex flex-col">
      <SiteHeader />

      <main className="flex-1 flex items-center justify-center px-4 pt-28 pb-16">
        <Suspense
          fallback={
            <div className="h-64 w-full max-w-md animate-pulse rounded-module border border-line-muted bg-surface/40" />
          }
        >
          <LoginForm />
        </Suspense>
      </main>

      <SiteFooter />
    </div>
  );
}
