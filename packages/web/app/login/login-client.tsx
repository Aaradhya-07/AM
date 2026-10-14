"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthModal } from "../components/auth-modal";
import { SiteHeader } from "../components/site-header";

export function LoginClient({ initialError }: { initialError: string | null }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-screen bg-ink text-canvas">
      <SiteHeader />
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 pt-[var(--am-header-h)] text-center">
        <h1 className="font-brand text-3xl font-bold">
          Sign in to your workspace
        </h1>
        <p className="mt-3 text-sm text-sand/75">
          Connect with GitHub or Google to access your saved projects and
          conformance runs.
        </p>
        {initialError && (
          <p
            role="alert"
            className="mt-5 rounded-edge border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
          >
            Sign-in failed: {initialError}
          </p>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mx-auto mt-6 min-h-[44px] rounded-edge bg-gold px-6 text-sm font-semibold text-ink hover:bg-goldsoft"
        >
          {initialError ? "Try sign-in again" : "Choose a sign-in method"}
        </button>
        <Link
          href="/"
          className="mt-5 text-sm text-sand/70 underline hover:text-canvas"
        >
          Return to home
        </Link>
      </main>
      <AuthModal
        open={open}
        onClose={() => setOpen(false)}
        initialError={initialError}
      />
    </div>
  );
}
