"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { TerminalNode } from "../../components/circuitry";
import { useAuth } from "../../components/auth-provider";
import { createClient } from "../../../lib/supabase/client";

export function CliConnectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    if (supabase && user) {
      void supabase.auth.getSession().then(({ data }) => {
        if (data?.session?.access_token) {
          setSessionToken(data.session.access_token);
        }
      });
    }
  }, [open, user]);

  if (!open || !mounted) return null;

  const isLocal =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");
  const endpointFlag = isLocal ? ` --endpoint ${window.location.origin}` : "";

  const tokenDisplay =
    sessionToken || (user ? `<YOUR_SESSION_TOKEN>` : `<API_TOKEN>`);
  const command = `anvilmark login --token ${tokenDisplay}${endpointFlag}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cli-modal-title"
    >
      <div
        className="fixed inset-0 bg-ink/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative my-auto w-full max-w-lg rounded-module border border-line/40 bg-surface p-6 shadow-2xl sm:p-8 z-10">
        <div className="flex items-center justify-between border-b border-line-muted pb-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-gold">
            <TerminalNode active />
            <span>LOCAL CLI // WORKSPACE SYNC</span>
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

        <div className="mt-5">
          <h2
            id="cli-modal-title"
            className="font-brand text-xl font-bold tracking-tight text-canvas"
          >
            Connect Your Local CLI
          </h2>
          <p className="mt-2 text-sm text-sand/70">
            Keep your code private on your machine while syncing your verified
            contracts and conformance audits to your ANVILMARK platform console.
          </p>
          {user && sessionToken && (
            <div className="mt-3 rounded-edge border border-amber-500/30 bg-amber-500/10 p-3 text-xs font-mono text-amber-200/90">
              <span className="font-semibold text-amber-300">
                This is your session token:
              </span>{" "}
              it authenticates as you and expires with the session, typically
              within an hour. `anvilmark push` will return 401 once it does;
              reopen this dialog for a current one. Per-user CLI tokens that do
              not expire are not issued yet.
            </div>
          )}
          {!user && (
            <div className="mt-3 rounded-edge border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200/90 font-mono">
              <span className="font-semibold text-amber-300">
                Guest Sandbox Notice:
              </span>{" "}
              This command connects to a temporary guest session. Sign in with
              GitHub or Google to tie CLI pushes permanently to your private
              dashboard.
            </div>
          )}
        </div>

        {/* Command Box */}
        <div className="mt-6 rounded-edge border border-line-muted bg-ink p-4">
          <div className="flex items-center justify-between text-xs text-sand/60">
            <span className="font-mono text-[11px] text-gold">
              Terminal Command
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 font-mono text-[11px] text-gold hover:text-canvas transition-colors"
            >
              {copied ? (
                <>
                  <svg
                    className="h-3.5 w-3.5 text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span className="text-green-400">Copied!</span>
                </>
              ) : (
                <>
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <div className="mt-2.5 overflow-x-auto font-mono text-xs text-canvas selection:bg-gold selection:text-ink">
            <code>{command}</code>
          </div>
        </div>

        {/* Instruction steps */}
        <div className="mt-6 space-y-3 font-mono text-xs text-sand/80">
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-graphite font-bold text-gold text-[10px]">
              1
            </span>
            <p>Run the login command in your repository root.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-graphite font-bold text-gold text-[10px]">
              2
            </span>
            <p>
              Run{" "}
              <code className="text-canvas bg-graphite px-1 py-0.5 rounded">
                anvilmark scan
              </code>{" "}
              to evaluate your project conformance.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-graphite font-bold text-gold text-[10px]">
              3
            </span>
            <p>
              Run{" "}
              <code className="text-canvas bg-graphite px-1 py-0.5 rounded">
                anvilmark push
              </code>{" "}
              to publish contract hashes to this dashboard.
            </p>
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-edge border border-line-muted bg-graphite/40 px-5 py-2 font-mono text-xs uppercase tracking-wider text-sand hover:border-gold hover:text-gold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
