"use client";

import { useEffect, useRef } from "react";

import {
  MAX_SAVED_THREADS,
  type SavedBetaThread,
} from "../../lib/beta-history";
import styles from "./beta.module.css";

function formatThreadTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const diffMs = Date.now() - parsed;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(parsed).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function summarizeThread(thread: SavedBetaThread): string {
  const latestPlan = [...thread.entries]
    .reverse()
    .find((entry) => entry.role === "assistant" && entry.mode === "plan");
  if (
    latestPlan &&
    latestPlan.role === "assistant" &&
    latestPlan.mode === "plan"
  ) {
    const count = latestPlan.plan.tasks.length;
    return `Plan · ${count} ${count === 1 ? "slice" : "slices"}`;
  }
  const count = thread.entries.length;
  return `${count} ${count === 1 ? "message" : "messages"}`;
}

export function HistoryDrawer({
  open,
  threads,
  activeThreadId,
  onSelectThread,
  onNewChat,
  onDeleteThread,
  onClose,
}: {
  open: boolean;
  threads: readonly SavedBetaThread[];
  activeThreadId: string | null;
  onSelectThread: (thread: SavedBetaThread) => void;
  onNewChat: () => void;
  onDeleteThread: (threadId: string) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside
        className={styles.historyDrawer}
        role="dialog"
        aria-modal="true"
        aria-label="Saved planning threads"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.drawerHeader}>
          <div>
            <span className={styles.sectionEyebrow}>Thread history</span>
            <h2>Saved sessions</h2>
          </div>
          <div className={styles.drawerHeaderRight}>
            <span className={styles.drawerCount}>
              {threads.length}/{MAX_SAVED_THREADS}
            </span>
            <button
              ref={closeButtonRef}
              type="button"
              className={styles.drawerClose}
              aria-label="Close history"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        <div className={styles.drawerActions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => {
              onNewChat();
              onClose();
            }}
          >
            + New chat
          </button>
        </div>

        {threads.length === 0 ? (
          <div className={styles.drawerEmpty}>
            <p>No saved planning threads yet.</p>
            <small>
              Conversations and edited architecture plans save automatically to
              this browser.
            </small>
          </div>
        ) : (
          <ul className={styles.drawerList}>
            {threads.map((thread) => {
              const isActive = thread.id === activeThreadId;
              return (
                <li
                  key={thread.id}
                  className={`${styles.drawerItem} ${isActive ? styles.drawerItemActive : ""}`}
                >
                  <button
                    type="button"
                    className={styles.drawerSelectBtn}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      onSelectThread(thread);
                      onClose();
                    }}
                  >
                    <span className={styles.drawerItemTitle}>
                      {thread.title}
                    </span>
                    <span className={styles.drawerItemMeta}>
                      <span>{summarizeThread(thread)}</span>
                      {thread.repoContext && (
                        <span className={styles.drawerRepoTag}>
                          {thread.repoContext.repoName}
                        </span>
                      )}
                      <span>{formatThreadTimestamp(thread.updatedAt)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.drawerDeleteBtn}
                    aria-label={`Delete thread ${thread.title}`}
                    onClick={() => onDeleteThread(thread.id)}
                  >
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 18 18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3.5 5h11M7 5V3.5h4V5m-5.5 0 .7 9.5h5.6l.7-9.5" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
