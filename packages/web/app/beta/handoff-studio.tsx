"use client";

import { useState } from "react";

import {
  buildClaudeMdSection,
  buildCodexAgentsSection,
  buildCursorRuleMdc,
  buildMasterHandoffPrompt,
  buildPlanBundle,
  buildPlanBundleJson,
  buildTaskSlicePrompt,
  resolveCandidateLabel,
  type PlanHandoffBundle,
} from "../../lib/beta-turn";
import type { GeneratedPlan } from "../../lib/planner";
import type { QuotaMode, RoutableCandidate } from "../../lib/routing-types";
import styles from "./beta.module.css";

type HandoffTab = "master" | "slices" | "claude" | "cursor" | "codex" | "cli";

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "anvilmark-plan";
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function LocalHandoffStudio({
  plan,
  candidates,
  strict,
  quotaMode,
  bridgeConnected = false,
  bridgeRepoName = null,
  onApplyOverBridge,
}: {
  plan: GeneratedPlan;
  candidates: readonly RoutableCandidate[];
  strict: boolean;
  quotaMode?: QuotaMode | undefined;
  bridgeConnected?: boolean | undefined;
  bridgeRepoName?: string | null | undefined;
  onApplyOverBridge?:
    | ((bundle: PlanHandoffBundle) => Promise<{ writtenFiles: string[] }>)
    | undefined;
}) {
  const [tab, setTab] = useState<HandoffTab>("master");
  const [expandedTabs, setExpandedTabs] = useState<Record<string, boolean>>({});
  const [expandedSliceId, setExpandedSliceId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [bridgeApplyState, setBridgeApplyState] = useState<{
    status: "idle" | "applying" | "applied" | "error";
    writtenFiles?: string[];
    error?: string;
  }>({ status: "idle" });

  const slug = slugify(plan.title);
  const masterPrompt = buildMasterHandoffPrompt(plan, candidates, strict);
  const claudeMdSection = buildClaudeMdSection(plan, candidates, strict);
  const cursorRuleMdc = buildCursorRuleMdc(plan, candidates, strict);
  const codexAgentsSection = buildCodexAgentsSection(plan, candidates, strict);
  const bundleFilename = `${slug}.anvilmark-plan.json`;
  const applyCommand = `anvilmark apply-plan --file ~/Downloads/${bundleFilename} --target all`;

  function toggleExpanded(key: string) {
    setExpandedTabs((current) => ({ ...current, [key]: !current[key] }));
  }

  async function copyText(id: string, text: string) {
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

  async function handleDirectBridgeApply() {
    if (!onApplyOverBridge || bridgeApplyState.status === "applying") return;
    setBridgeApplyState({ status: "applying" });
    try {
      const bundle = buildPlanBundle(
        plan,
        candidates,
        strict,
        new Date().toISOString(),
        quotaMode,
      );
      const res = await onApplyOverBridge(bundle);
      setBridgeApplyState({
        status: "applied",
        writtenFiles: res.writtenFiles,
      });
    } catch (err) {
      setBridgeApplyState({
        status: "error",
        error:
          err instanceof Error
            ? err.message
            : "Could not apply plan over local bridge.",
      });
    }
  }

  function renderCodeTab(opts: {
    tabKey: string;
    targetLabel: string;
    copyId: string;
    copyLabel: string;
    downloadLabel: string;
    filename: string;
    mimeType: string;
    content: string;
  }) {
    const isExpanded = Boolean(expandedTabs[opts.tabKey]);
    return (
      <div className={styles.handoffPanel} role="tabpanel">
        <div className={styles.handoffSnippetBar}>
          <span className={styles.handoffTargetLabel}>{opts.targetLabel}</span>
          <div className={styles.handoffSnippetActions}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => void copyText(opts.copyId, opts.content)}
            >
              {copiedId === opts.copyId ? "Copied ✓" : opts.copyLabel}
            </button>
            <button
              type="button"
              className={styles.textButton}
              onClick={() =>
                downloadTextFile(opts.filename, opts.content, opts.mimeType)
              }
            >
              {opts.downloadLabel}
            </button>
            <button
              type="button"
              className={styles.textButton}
              aria-expanded={isExpanded}
              onClick={() => toggleExpanded(opts.tabKey)}
            >
              {isExpanded ? "Collapse preview" : "Expand full preview"}
            </button>
          </div>
        </div>
        <pre
          className={`${styles.handoffCode} ${isExpanded ? styles.handoffCodeExpanded : ""}`}
        >
          <code>{opts.content}</code>
        </pre>
      </div>
    );
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
            Architecture choices, executable slice contracts, and per-task model
            routing sync instantly into ready-to-apply briefs for Claude Code,
            Cursor, Codex, and the AnvilMark CLI.
          </p>
        </div>
        <div className={styles.handoffPrimaryActions}>
          {bridgeConnected && onApplyOverBridge && (
            <button
              type="button"
              className={styles.bridgeApplyAction}
              disabled={bridgeApplyState.status === "applying"}
              onClick={() => void handleDirectBridgeApply()}
            >
              {bridgeApplyState.status === "applying"
                ? "Applying to repo…"
                : bridgeApplyState.status === "applied"
                  ? `Applied to ${bridgeRepoName ?? "repo"} ✓`
                  : `Apply to ${bridgeRepoName ?? "local repo"} ⚡`}
            </button>
          )}
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => void copyText("master", masterPrompt)}
          >
            {copiedId === "master"
              ? "Copied master prompt ✓"
              : "Copy master prompt"}
          </button>
          <button
            type="button"
            className={styles.ghostAction}
            onClick={() =>
              downloadTextFile(
                "PLAN.md",
                masterPrompt,
                "text/markdown;charset=utf-8",
              )
            }
          >
            Download PLAN.md
          </button>
        </div>
      </div>

      {bridgeApplyState.status === "applied" && (
        <div className={styles.bridgeApplyFeedback} role="status">
          <strong>Applied directly over local bridge ✓</strong>
          {bridgeApplyState.writtenFiles &&
            bridgeApplyState.writtenFiles.length > 0 && (
              <span>Updated: {bridgeApplyState.writtenFiles.join(", ")}</span>
            )}
        </div>
      )}

      {bridgeApplyState.status === "error" && bridgeApplyState.error && (
        <div className={styles.bridgeApplyError} role="alert">
          <span>{bridgeApplyState.error}</span>
        </div>
      )}

      <div
        className={styles.handoffTabs}
        role="tablist"
        aria-label="Local IDE handoff formats"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "master"}
          className={`${styles.handoffTab} ${tab === "master" ? styles.handoffTabActive : ""}`}
          onClick={() => setTab("master")}
        >
          Master prompt
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "slices"}
          className={`${styles.handoffTab} ${tab === "slices" ? styles.handoffTabActive : ""}`}
          onClick={() => setTab("slices")}
        >
          Per-task slices ({plan.tasks.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "claude"}
          className={`${styles.handoffTab} ${tab === "claude" ? styles.handoffTabActive : ""}`}
          onClick={() => setTab("claude")}
        >
          Claude Code
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "cursor"}
          className={`${styles.handoffTab} ${tab === "cursor" ? styles.handoffTabActive : ""}`}
          onClick={() => setTab("cursor")}
        >
          Cursor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "codex"}
          className={`${styles.handoffTab} ${tab === "codex" ? styles.handoffTabActive : ""}`}
          onClick={() => setTab("codex")}
        >
          Codex
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "cli"}
          className={`${styles.handoffTab} ${tab === "cli" ? styles.handoffTabActive : ""}`}
          onClick={() => setTab("cli")}
        >
          CLI Apply
        </button>
      </div>

      {tab === "master" &&
        renderCodeTab({
          tabKey: "master",
          targetLabel: `PLAN.md · ${plan.tasks.length} ${plan.tasks.length === 1 ? "slice" : "slices"} · ${plan.architecture.length} ${plan.architecture.length === 1 ? "decision" : "decisions"}`,
          copyId: "master-inline",
          copyLabel: "Copy PLAN.md",
          downloadLabel: "Download PLAN.md",
          filename: "PLAN.md",
          mimeType: "text/markdown;charset=utf-8",
          content: masterPrompt,
        })}

      {tab === "slices" && (
        <div className={styles.sliceList} role="tabpanel">
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
                      onClick={() => void copyText(copyKey, slicePrompt)}
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

      {tab === "claude" &&
        renderCodeTab({
          tabKey: "claude",
          targetLabel: "CLAUDE.md · Claude Code instructions",
          copyId: "claude",
          copyLabel: "Copy CLAUDE.md",
          downloadLabel: "Download CLAUDE.md",
          filename: "CLAUDE.md",
          mimeType: "text/markdown;charset=utf-8",
          content: claudeMdSection,
        })}

      {tab === "cursor" &&
        renderCodeTab({
          tabKey: "cursor",
          targetLabel: ".cursor/rules/anvilmark-plan.mdc · Cursor rule",
          copyId: "cursor",
          copyLabel: "Copy .mdc rule",
          downloadLabel: "Download anvilmark-plan.mdc",
          filename: "anvilmark-plan.mdc",
          mimeType: "text/markdown;charset=utf-8",
          content: cursorRuleMdc,
        })}

      {tab === "codex" &&
        renderCodeTab({
          tabKey: "codex",
          targetLabel: "AGENTS.md · Codex / agent instructions",
          copyId: "codex",
          copyLabel: "Copy AGENTS.md",
          downloadLabel: "Download AGENTS.md",
          filename: "AGENTS.md",
          mimeType: "text/markdown;charset=utf-8",
          content: codexAgentsSection,
        })}

      {tab === "cli" && (
        <div className={styles.cliPanel} role="tabpanel">
          <p className={styles.cliIntro}>
            Apply this entire plan bundle directly into your local repository.{" "}
            <code>anvilmark apply-plan</code> updates <code>PLAN.md</code>,{" "}
            <code>CLAUDE.md</code>,{" "}
            <code>.cursor/rules/anvilmark-plan.mdc</code>,{" "}
            <code>AGENTS.md</code>, and{" "}
            <code>.anvilmark/development/active-plan.json</code> (including
            executable slice contracts)—preserving your existing instructions.
          </p>

          {bridgeConnected && onApplyOverBridge && (
            <div className={styles.cliStepCard}>
              <div className={styles.cliStepHeader}>
                <span className={styles.cliStepNum}>⚡</span>
                <div>
                  <h4>1-click apply via connected Local Bridge</h4>
                  <p>
                    Connected to <code>{bridgeRepoName ?? "local repo"}</code>{" "}
                    over loopback—writes all target files atomically without
                    downloading a JSON file.
                  </p>
                </div>
              </div>
              <div className={styles.cliStepActions}>
                <button
                  type="button"
                  className={styles.primaryAction}
                  disabled={bridgeApplyState.status === "applying"}
                  onClick={() => void handleDirectBridgeApply()}
                >
                  {bridgeApplyState.status === "applying"
                    ? "Applying to repository…"
                    : bridgeApplyState.status === "applied"
                      ? "Re-apply bundle to repository ✓"
                      : "Apply bundle directly to repository"}
                </button>
              </div>
            </div>
          )}

          <div className={styles.cliSteps}>
            <div className={styles.cliStepCard}>
              <div className={styles.cliStepHeader}>
                <span className={styles.cliStepNum}>01</span>
                <div>
                  <h4>Download signed plan bundle</h4>
                  <p>
                    Includes your latest model picks, slice contracts, swapped
                    decisions, and all IDE targets.
                  </p>
                </div>
              </div>
              <div className={styles.cliStepActions}>
                <button
                  type="button"
                  className={styles.primaryAction}
                  onClick={() =>
                    downloadTextFile(
                      bundleFilename,
                      buildPlanBundleJson(
                        plan,
                        candidates,
                        strict,
                        undefined,
                        quotaMode,
                      ),
                      "application/json;charset=utf-8",
                    )
                  }
                >
                  Download {bundleFilename}
                </button>
              </div>
            </div>

            <div className={styles.cliStepCard}>
              <div className={styles.cliStepHeader}>
                <span className={styles.cliStepNum}>02</span>
                <div>
                  <h4>Run in your repository root</h4>
                  <p>
                    Applies all targets idempotently (or pass{" "}
                    <code>--target claude|cursor|codex</code>).
                  </p>
                </div>
              </div>
              <div className={styles.cliCommandBox}>
                <code>{applyCommand}</code>
                <button
                  type="button"
                  className={styles.ghostAction}
                  onClick={() => void copyText("cli-apply", applyCommand)}
                >
                  {copiedId === "cli-apply" ? "Copied ✓" : "Copy command"}
                </button>
              </div>
            </div>
          </div>

          <div className={styles.cliPreviewToggle}>
            <button
              type="button"
              className={styles.textButton}
              aria-expanded={Boolean(expandedTabs.cliJson)}
              onClick={() => toggleExpanded("cliJson")}
            >
              {expandedTabs.cliJson
                ? "Hide bundle JSON preview"
                : "Inspect bundle JSON"}
            </button>
          </div>
          {expandedTabs.cliJson && (
            <pre
              className={`${styles.handoffCode} ${styles.handoffCodeExpanded}`}
            >
              <code>
                {buildPlanBundleJson(
                  plan,
                  candidates,
                  strict,
                  undefined,
                  quotaMode,
                )}
              </code>
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
