"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createClient } from "../../lib/supabase/client";
import { useAuth } from "../components/auth-provider";
import { GoogleGlyph } from "../components/google-glyph";
import styles from "./login.module.css";

export function LoginClient({ initialError }: { initialError: string | null }) {
  const { user, loading, isConfigured, signInWithProvider } = useAuth();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<"google" | "email" | null>(null);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");

  async function googleSignIn() {
    setPending("google");
    setError(null);
    setNotice("");
    try {
      await signInWithProvider("google", "/workspace");
    } catch {
      setError("Google sign-in could not start. Try again or use email.");
      setPending(null);
    }
  }

  async function emailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase || pending) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const confirmation = new URL("/auth/callback", window.location.origin);
    confirmation.searchParams.set("next", "/workspace");
    setPending("email");
    setError(null);
    setNotice("");

    try {
      const { data, error } = creating
        ? await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: confirmation.href },
          })
        : await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setError(
          error.code === "email_not_confirmed"
            ? "Confirm your email address before signing in."
            : error.status === 429
              ? "Too many attempts. Wait a moment and try again."
              : creating
                ? "Could not create the account. Check your email and password, then try again."
                : "Sign-in failed. Check your email and password, then try again.",
        );
      } else if (data.session) {
        window.location.replace("/workspace");
      } else if (creating) {
        setNotice("Check your inbox for a link to confirm your email address.");
      }
    } catch {
      setError("Could not reach the sign-in service. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <main id="main" className={styles.main}>
      <section className={styles.card} aria-labelledby="login-title">
        <h1 id="login-title">
          {user
            ? "You’re signed in"
            : creating
              ? "Create your account"
              : "Sign in to AnvilMark"}
        </h1>
        {user ? (
          <>
            <p className={styles.intro}>{user.email}</p>
            <Link className={styles.submit} href="/workspace">
              Open your records ↗
            </Link>
          </>
        ) : (
          <>
            <p className={styles.intro}>
              Use your Google account or continue with email.
            </p>
            <button
              className={styles.google}
              type="button"
              disabled={loading || !isConfigured || pending !== null}
              onClick={googleSignIn}
            >
              <GoogleGlyph />
              {pending === "google"
                ? "Opening Google…"
                : "Continue with Google"}
            </button>
            <div className={styles.divider}>
              <span>or use email</span>
            </div>
            <form className={styles.form} onSubmit={emailSignIn}>
              <label htmlFor="login-email">Email address</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                required
              />
              <label htmlFor="login-password">Password</label>
              <input
                key={String(creating)}
                id="login-password"
                name="password"
                type="password"
                autoComplete={creating ? "new-password" : "current-password"}
                minLength={creating ? 8 : undefined}
                required
              />
              {creating && <small>Use at least 8 characters.</small>}
              <button
                className={styles.submit}
                disabled={loading || !isConfigured || pending !== null}
                type="submit"
              >
                {pending === "email"
                  ? "Please wait…"
                  : creating
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            {!isConfigured && (
              <p role="status" className={styles.notice}>
                Sign-in is unavailable until Supabase is configured.
              </p>
            )}
            {notice && (
              <p role="status" className={styles.notice}>
                {notice}
              </p>
            )}
            <p className={styles.switch}>
              {creating ? "Already have an account?" : "New to AnvilMark?"}{" "}
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  setCreating(!creating);
                  setError(null);
                  setNotice("");
                }}
              >
                {creating ? "Sign in" : "Create an account"}
              </button>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
