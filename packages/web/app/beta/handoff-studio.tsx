"use client";

import { useState } from "react";

import {
  buildMasterHandoffPrompt,
  buildTaskSlicePrompt,
  resolveCandidateLabel,
} from "../../lib/beta-turn";
import type { GeneratedPlan } from "../../lib/planner";
import type { RoutableCandidate } from "../../lib/routing-types";
import styles from "./beta.module.css";

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "anvilmark-plan";
}

export function LocalHandoffStudio({
  plan,
  candidates,
  strict,
}: {
  plan: GeneratedPlan;
  candidates: readonly RoutableCandidate[];
  strict: boolean;
}) {
  const [tab, setTab] = useState<"master" | "slices">("master");
  const [masterExpanded, setMasterExpanded] = useState(false);
  const [expandedSliceId, setExpandedSliceId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const masterPrompt = buildMasterHandoffPrompt(plan, candidates, strict);

  async function copyPrompt(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2400);
    } catch {
      // Clipboard blocked in restricted browser contexts.
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([masterPrompt], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slugify(plan.title)}.PLAN.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className={styles.handoffStudio}
      aria-label="Shift to local development"
    >
      <div className={styles.handoffBanner}>
        <div className={styles.handoffBannerCopy}>
          <span className={styles.handoffEyebrow}>
            <i aria-hidden="true" /> Ready for your IDE or coding agent
          </span>
          <h3>Shift to local development</h3>
          <p>
            Architecture choices, task slices, and per-task model routing are
            locked into a copy-ready brief for Claude Code, Codex, or Cursor.
          </p>
        </div>
        <div className={styles.handoffPrimaryActions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => void copyPrompt("master", masterPrompt)}
          >
            {copiedId === "master"
              ? "Copied master prompt ✓"
              : "Copy master prompt"}
          </button>
          <button
            type="button"
            className={styles.ghostAction}
            onClick={downloadMarkdown}
          >
            Download PLAN.md
          </button>
        </div>
      </div>

      <div className={styles.handoffTabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "master"}
          className={`${styles.handoffTab} ${tab === "master" ? styles.handoffTabActive : ""}`}
          onClick={() => setTab("master")}
        >
          Master agent prompt
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "slices"}
          className={`${styles.handoffTab} ${tab === "slices" ? styles.handoffTabActive : ""}`}
          onClick={() => setTab("slices")}
        >
          Per-task slice prompts ({plan.tasks.length})
        </button>
      </div>

      {tab === "master" ? (
        <div className={styles.handoffPanel}>
          <div className={styles.handoffSnippetBar}>
            <span>
              Full repository handoff · {plan.tasks.length}{" "}
              {plan.tasks.length === 1 ? "slice" : "slices"} ·{" "}
              {plan.architecture.length}{" "}
              {plan.architecture.length === 1 ? "decision" : "decisions"}
            </span>
            <button
              type="button"
              className={styles.textButton}
              aria-expanded={masterExpanded}
              onClick={() => setMasterExpanded((open) => !open)}
            >
              {masterExpanded ? "Collapse preview" : "Expand full prompt"}
            </button>
          </div>
          <pre
            className={`${styles.handoffCode} ${masterExpanded ? styles.handoffCodeExpanded : ""}`}
          >
            <code>{masterPrompt}</code>
          </pre>
        </div>
      ) : (
        <div className={styles.sliceList}>
          {plan.tasks.map((task, index) => {
            const slicePrompt = buildTaskSlicePrompt(
              plan,
              index,
              candidates,
              strict,
            );
            const label = resolveCandidateLabel(task.model, candidates);
            const candidate = candidates.find((c) => c.model === task.model);
            const isExpanded = expandedSliceId === task.id;
            const copyKey = `slice-${task.id}`;

            return (
              <div className={styles.sliceCard} key={task.id}>
                <div className={styles.sliceTop}>
                  <div className={styles.sliceTitleRow}>
                    <span className={styles.sliceNum}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h4>{task.title}</h4>
                      <p className={styles.sliceModelHint}>
                        Switch model to <code>{task.model}</code> ({label}
                        {candidate ? ` · ${candidate.tier}` : ""})
                      </p>
                    </div>
                  </div>
                  <div className={styles.sliceActions}>
                    <button
                      type="button"
                      className={styles.ghostAction}
                      aria-expanded={isExpanded}
                      onClick={() =>
                        setExpandedSliceId(isExpanded ? null : task.id)
                      }
                    >
                      {isExpanded ? "Hide" : "Inspect"}
                    </button>
                    <button
                      type="button"
                      className={styles.primaryAction}
                      onClick={() => void copyPrompt(copyKey, slicePrompt)}
                    >
                      {copiedId === copyKey
                        ? "Copied ✓"
                        : `Copy slice ${String(index + 1).padStart(2, "0")}`}
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <pre className={styles.sliceCode}>
                    <code>{slicePrompt}</code>
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
