"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  BetaTurnProgressSection,
  ClarificationQuestionItem,
  PlanHandoffBundle,
} from "../../lib/beta-turn";
import type { ArchitectureDriftReport } from "../../lib/bridge-client";
import {
  strictChecks,
  type GeneratedPlan,
  type PlanningInput,
} from "../../lib/planner";
import {
  computePlanSavingsSummary,
  estimateTaskUsd,
  subscriptionCatalog,
  type QuotaMode,
  type RoutableCandidate,
  type RoutingPreferences,
  type SubscriptionId,
} from "../../lib/routing-types";
import {
  SliceContractSchema,
  formatReviewerFamilyLabel,
  type SliceContractSpec,
  type SliceVerificationReport,
} from "../../lib/slice-contracts";
import { resolveTwoUiModelOptions } from "../../lib/slice-router";
import { FlowGraph } from "./flow-graph";
import { LocalHandoffStudio } from "./handoff-studio";
import styles from "./beta.module.css";

export interface LiveSliceVerificationState {
  status: "idle" | "queued" | "running" | "passed" | "failed" | "accepted";
  report?: SliceVerificationReport | undefined;
  error?: string | undefined;
}

const thinkingPhrases = [
  "Thinking…",
  "Evaluating scope & missing constraints…",
  "Comparing architecture & model tradeoffs…",
  "Structuring task slices & agent handoff…",
] as const;

const progressSections: readonly {
  id: BetaTurnProgressSection;
  label: string;
}[] = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "flows", label: "Data flows" },
  { id: "tasks", label: "Task slices" },
  { id: "security", label: "Security" },
];

export function AssistantAvatar({ active = false }: { active?: boolean }) {
  return (
    <span
      className={`${styles.avatar} ${active ? styles.avatarActive : ""}`}
      aria-hidden="true"
    >
      <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 2L11.1 6.9L16 9L11.1 11.1L9 16L6.9 11.1L2 9L6.9 6.9L9 2Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function ThinkingRow({
  providerLabel,
  coldLoading = false,
  statusMessage,
  statusModel,
}: {
  providerLabel: string;
  coldLoading?: boolean | undefined;
  statusMessage?: string | null | undefined;
  statusModel?: string | null | undefined;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const phrases = coldLoading
    ? [`Loading ${providerLabel} on am-server…`, ...thinkingPhrases.slice(1)]
    : thinkingPhrases;
  const index = Math.min(phrases.length - 1, Math.floor(elapsedMs / 3200));
  const activeText = statusMessage?.trim() || phrases[index];

  return (
    <div
      className={styles.assistantRow}
      role="status"
      aria-live="polite"
      aria-label="Generating response"
    >
      <AssistantAvatar active />
      <div className={styles.thinkingBody}>
        <span className={styles.shimmerText} key={activeText}>
          {activeText}
        </span>
        {statusModel && (
          <span className={styles.streamModelPill}>{statusModel}</span>
        )}
        {elapsedMs >= 1500 && (
          <span className={styles.thinkingTimer}>
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
    </div>
  );
}

export function StreamingSynthesisRow({
  architectReply,
  statusMessage,
  statusModel,
  progressSection,
  progressChars,
}: {
  architectReply: string;
  statusMessage: string | null;
  statusModel: string | null;
  progressSection: BetaTurnProgressSection | null;
  progressChars: number;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const activeSection: BetaTurnProgressSection = progressSection ?? "overview";
  const activeIndex = Math.max(
    0,
    progressSections.findIndex((item) => item.id === activeSection),
  );

  return (
    <div className={styles.assistantRow} data-streaming="true">
      <AssistantAvatar active />
      <div className={styles.assistantContent}>
        <p className={styles.assistantProse}>{architectReply}</p>

        <div
          className={styles.synthesisProgressCard}
          role="status"
          aria-live="polite"
          aria-label="Synthesizing implementation plan"
        >
          <div className={styles.synthesisProgressTop}>
            <span className={styles.shimmerText}>
              {statusMessage?.trim() ||
                "Synthesizing architecture decisions, slices, and model routing…"}
            </span>
            <div className={styles.synthesisProgressMeta}>
              {statusModel && (
                <span className={styles.streamModelPill}>{statusModel}</span>
              )}
              <span className={styles.streamCharsBadge}>
                {progressChars.toLocaleString()} chars
              </span>
              {elapsedMs >= 1000 && (
                <span className={styles.thinkingTimer}>
                  {(elapsedMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>

          <ol
            className={styles.progressPills}
            aria-label="Plan synthesis stages"
          >
            {progressSections.map((step, index) => {
              const state =
                index < activeIndex
                  ? "done"
                  : index === activeIndex
                    ? "active"
                    : "pending";
              return (
                <li
                  key={step.id}
                  data-stage={step.id}
                  data-state={state}
                  aria-current={state === "active" ? "step" : undefined}
                  className={`${styles.progressPill} ${
                    state === "active"
                      ? styles.progressPillActive
                      : state === "done"
                        ? styles.progressPillDone
                        : ""
                  }`}
                >
                  <span className={styles.progressPillDot} aria-hidden="true">
                    {state === "done" ? "✓" : ""}
                  </span>
                  <span>{step.label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

export function ClarificationWidget({
  questions,
  answered,
  routingPrefs,
  onRoutingPrefsChange,
  onSubmitAnswers,
  onSkipDefaults,
}: {
  questions: readonly ClarificationQuestionItem[];
  answered: boolean;
  routingPrefs: RoutingPreferences;
  onRoutingPrefsChange: (next: RoutingPreferences) => void;
  onSubmitAnswers: (summary: string) => void;
  onSkipDefaults: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [customNotes, setCustomNotes] = useState("");

  function toggleOption(question: ClarificationQuestionItem, option: string) {
    if (answered) return;
    setSelected((current) => {
      const existing = current[question.id] ?? [];
      if (question.allowMultiple) {
        const next = existing.includes(option)
          ? existing.filter((item) => item !== option)
          : [...existing, option];
        return { ...current, [question.id]: next };
      }
      return {
        ...current,
        [question.id]: existing[0] === option ? [] : [option],
      };
    });
  }

  function toggleSubscription(subId: SubscriptionId) {
    if (answered) return;
    const exists = routingPrefs.subscriptions.includes(subId);
    const nextSubs = exists
      ? routingPrefs.subscriptions.filter((id) => id !== subId)
      : [...routingPrefs.subscriptions, subId];
    onRoutingPrefsChange({
      mode: nextSubs.length > 0 ? "subscriptions" : "open",
      subscriptions: nextSubs,
    });
  }

  const hasAnySelection =
    Object.values(selected).some((items) => items.length > 0) ||
    customNotes.trim().length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (answered) return;
    const lines: string[] = [];
    for (const q of questions) {
      const picks = selected[q.id];
      if (picks && picks.length > 0) {
        lines.push(`- ${q.question}: ${picks.join(", ")}`);
      }
    }
    if (customNotes.trim()) {
      lines.push(`- Additional context: ${customNotes.trim()}`);
    }
    if (lines.length === 0) {
      onSkipDefaults();
      return;
    }
    onSubmitAnswers(lines.join("\n"));
  }

  if (answered) {
    return (
      <div className={styles.clarifyCollapsed}>
        <span>Clarification choices applied ✓</span>
      </div>
    );
  }

  return (
    <form className={styles.clarifyCard} onSubmit={submit}>
      <div className={styles.clarifyList}>
        {questions.map((q, idx) => {
          const picks = selected[q.id] ?? [];
          return (
            <div className={styles.clarifyItem} key={q.id}>
              <div className={styles.clarifyPrompt}>
                <span className={styles.clarifyIndex}>
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div>
                  <h4>{q.question}</h4>
                  <p>{q.why}</p>
                </div>
              </div>
              <div className={styles.optionChips}>
                {q.options.map((opt) => {
                  const active = picks.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      aria-pressed={active}
                      className={`${styles.optionChip} ${active ? styles.optionChipActive : ""}`}
                      onClick={() => toggleOption(q, opt)}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className={styles.clarifyItem}>
          <div className={styles.clarifyPrompt}>
            <span className={styles.clarifyIndex}>AI</span>
            <div>
              <h4>Which coding subscriptions or tools do you use?</h4>
              <p>
                Tailors task-by-task model picks to subscriptions you already
                pay for, or chooses openly for best quality &amp; cost.
              </p>
            </div>
          </div>
          <div className={styles.optionChips}>
            <button
              type="button"
              aria-pressed={routingPrefs.mode === "open"}
              className={`${styles.optionChip} ${routingPrefs.mode === "open" ? styles.optionChipActive : ""}`}
              onClick={() =>
                onRoutingPrefsChange({ mode: "open", subscriptions: [] })
              }
            >
              Open best-fit (unrestricted)
            </button>
            {subscriptionCatalog.map((sub) => {
              const isSelected =
                routingPrefs.mode === "subscriptions" &&
                routingPrefs.subscriptions.includes(sub.id);
              return (
                <button
                  key={sub.id}
                  type="button"
                  aria-pressed={isSelected}
                  className={`${styles.optionChip} ${isSelected ? styles.optionChipActive : ""}`}
                  onClick={() => toggleSubscription(sub.id)}
                >
                  {sub.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.clarifyNotesRow}>
        <input
          type="text"
          value={customNotes}
          onChange={(event) => setCustomNotes(event.target.value)}
          placeholder="Optional: add stack details, constraints, or anything else…"
          maxLength={600}
        />
      </div>

      <div className={styles.clarifyFooter}>
        <button type="submit" className={styles.primaryAction}>
          {hasAnySelection
            ? "Build plan with selections →"
            : "Continue with sensible defaults →"}
        </button>
        {hasAnySelection && (
          <button
            type="button"
            className={styles.ghostAction}
            onClick={onSkipDefaults}
          >
            Skip &amp; use defaults
          </button>
        )}
      </div>
    </form>
  );
}

export function ErrorCard({
  error,
  needsKey,
  provider,
  providerLabel,
  apiKey,
  onApiKeyChange,
  onRetry,
}: {
  error: string;
  needsKey: boolean;
  provider: PlanningInput["provider"];
  providerLabel: string;
  apiKey: string;
  onApiKeyChange: (next: string) => void;
  onRetry: (overrideKey?: string) => void;
}) {
  const [inlineKey, setInlineKey] = useState(apiKey);

  useEffect(() => {
    setInlineKey(apiKey);
  }, [apiKey]);

  function handleKeySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = inlineKey.trim();
    if (!trimmed) return;
    onApiKeyChange(trimmed);
    onRetry(trimmed);
  }

  return (
    <div className={styles.errorCard} role="alert">
      <div className={styles.errorTop}>
        <span className={styles.errorDot} aria-hidden="true" />
        <div>
          <h3>
            {needsKey
              ? `Connect a ${providerLabel} API key to continue`
              : "Could not complete this turn"}
          </h3>
          <p>{error}</p>
        </div>
      </div>

      {needsKey && provider !== "configured" && (
        <form className={styles.inlineKeyForm} onSubmit={handleKeySubmit}>
          <label className="sr-only" htmlFor="beta-inline-key">
            {providerLabel} API key
          </label>
          <input
            id="beta-inline-key"
            type="password"
            autoComplete="off"
            value={inlineKey}
            onChange={(event) => {
              setInlineKey(event.target.value);
              onApiKeyChange(event.target.value);
            }}
            placeholder={`Paste your ${providerLabel} API key…`}
          />
          <button
            type="submit"
            className={styles.primaryAction}
            disabled={!inlineKey.trim()}
          >
            Continue
          </button>
        </form>
      )}

      {!needsKey && (
        <div className={styles.errorActions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => onRetry()}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

export function PlanArtifactView({
  plan,
  candidates,
  catalogDate,
  strict,
  quotaMode,
  editedArchitectureIndices = [],
  driftReport,
  onRefreshDrift,
  bridgeConnected = false,
  bridgeRepoName = null,
  onApplyOverBridge,
  sliceVerifications,
  onVerifySlice,
  onSelectQuestion,
  onUpdateTaskModel,
  onUpdateTaskContract,
  onSwapArchitectureDecision,
}: {
  plan: GeneratedPlan;
  candidates: readonly RoutableCandidate[];
  catalogDate: string;
  strict: boolean;
  quotaMode?: QuotaMode | undefined;
  editedArchitectureIndices?: readonly number[] | undefined;
  driftReport?: ArchitectureDriftReport | null | undefined;
  onRefreshDrift?: (() => void) | undefined;
  bridgeConnected?: boolean | undefined;
  bridgeRepoName?: string | null | undefined;
  onApplyOverBridge?:
    | ((bundle: PlanHandoffBundle) => Promise<{ writtenFiles: string[] }>)
    | undefined;
  sliceVerifications?:
    Readonly<Record<string, LiveSliceVerificationState>> | undefined;
  onVerifySlice?: ((sliceId: string) => void) | undefined;
  onSelectQuestion: (question: string) => void;
  onUpdateTaskModel?:
    ((taskIndex: number, nextModel: string) => void) | undefined;
  onUpdateTaskContract?:
    ((taskIndex: number, nextContract: SliceContractSpec) => void) | undefined;
  onSwapArchitectureDecision?: ((decisionIndex: number) => void) | undefined;
}) {
  const [editingContractId, setEditingContractId] = useState<string | null>(
    null,
  );
  const [contractDraft, setContractDraft] = useState<{
    allowedGlobsText: string;
    forbiddenGlobsText: string;
    verificationCommandsText: string;
    allowDependencyChanges: boolean;
    error: string | null;
  } | null>(null);
  const pinnedPairCacheRef = useRef<
    Map<string, ReturnType<typeof resolveTwoUiModelOptions>>
  >(new Map());

  const totalTokens = plan.tasks.reduce(
    (sum, t) => sum + t.inputTokens + t.outputTokens,
    0,
  );
  const savings = computePlanSavingsSummary(plan.tasks, candidates);
  const editedSet = new Set(editedArchitectureIndices);

  function openContractEditor(taskId: string, contract?: SliceContractSpec) {
    if (editingContractId === taskId) {
      setEditingContractId(null);
      setContractDraft(null);
      return;
    }
    setEditingContractId(taskId);
    setContractDraft({
      allowedGlobsText: (contract?.allowedGlobs ?? []).join(", "),
      forbiddenGlobsText: (contract?.forbiddenGlobs ?? [".env", ".env.*"]).join(
        ", ",
      ),
      verificationCommandsText: (contract?.verificationCommands ?? []).join(
        "\n",
      ),
      allowDependencyChanges: Boolean(contract?.allowDependencyChanges),
      error: null,
    });
  }

  function saveContractDraft(taskIndex: number, existing?: SliceContractSpec) {
    if (!contractDraft || !onUpdateTaskContract) return;
    const allowedGlobs = contractDraft.allowedGlobsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const forbiddenGlobs = contractDraft.forbiddenGlobsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const verificationCommands = contractDraft.verificationCommandsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const parsed = SliceContractSchema.safeParse({
      allowedGlobs,
      forbiddenGlobs,
      verificationCommands,
      allowDependencyChanges: contractDraft.allowDependencyChanges,
      expectedBoundaries: existing?.expectedBoundaries ?? [],
      ...(existing?.reviewerFamily
        ? { reviewerFamily: existing.reviewerFamily }
        : {}),
    });

    if (!parsed.success) {
      setContractDraft({
        ...contractDraft,
        error:
          "Use repo-relative POSIX globs (no leading '/' or '..') and non-empty check commands.",
      });
      return;
    }

    onUpdateTaskContract(taskIndex, parsed.data);
    setEditingContractId(null);
    setContractDraft(null);
  }

  return (
    <div className={styles.planArtifact}>
      <div className={styles.blueprintCard}>
        <header className={styles.blueprintHeader}>
          <div>
            <span className={styles.sectionEyebrow}>
              Architecture &amp; task plan
            </span>
            <h2>{plan.title}</h2>
          </div>
          <div className={styles.summaryStats}>
            <span>
              {plan.tasks.length} {plan.tasks.length === 1 ? "slice" : "slices"}
            </span>
            <span>
              {plan.architecture.length}{" "}
              {plan.architecture.length === 1 ? "decision" : "decisions"}
            </span>
            <span>~{totalTokens.toLocaleString()} tokens</span>
          </div>
        </header>

        <p className={styles.planGoal}>{plan.goal}</p>
        <p className={styles.planAudience}>
          <strong>Target users</strong> {plan.users}
        </p>

        {savings && savings.frontierBaselineUsd > 0 && (
          <div className={styles.savingsBanner}>
            <div>
              <strong>
                Routed API-equivalent est.: ${savings.routedUsd.toFixed(4)}
              </strong>
              <span>
                {savings.savedPercent > 0
                  ? ` · ~${savings.savedPercent}% lower than running every slice on ${savings.frontierModelLabel} ($${savings.frontierBaselineUsd.toFixed(4)})`
                  : ` · Matched against ${savings.frontierModelLabel}`}
              </span>
            </div>
            <small>Catalog snapshot {catalogDate}</small>
          </div>
        )}

        <div className={styles.planGrid}>
          <PlanList title="In scope" values={plan.scope} />
          <PlanList title="Explicit non-goals" values={plan.nonGoals} />
          <PlanList title="Assumptions" values={plan.assumptions} />
          {plan.questions.length > 0 && (
            <div className={styles.planSubcard}>
              <h4>Open refinements</h4>
              <ul className={styles.questionList}>
                {plan.questions.map((question, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className={styles.questionChip}
                      onClick={() => onSelectQuestion(question)}
                    >
                      <span>{question}</span>
                      <span className={styles.questionReply} aria-hidden="true">
                        Answer ↵
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <hr className={styles.divider} />

        <section className={styles.blueprintBlock}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>Architecture</span>
            <h3>Key decisions &amp; rejected alternatives</h3>
          </div>
          <div className={styles.planGrid}>
            {plan.architecture.map((choice, index) => {
              const isEdited = editedSet.has(index);
              return (
                <div className={styles.planSubcard} key={index}>
                  <div className={styles.decisionHeader}>
                    <div className={styles.decisionTitleRow}>
                      <h4>{choice.title}</h4>
                      {isEdited && (
                        <span className={styles.editedBadge}>Edited</span>
                      )}
                    </div>
                    {onSwapArchitectureDecision && (
                      <button
                        type="button"
                        className={styles.swapDecisionBtn}
                        aria-label={`Swap ${choice.title} with alternative`}
                        onClick={() => onSwapArchitectureDecision(index)}
                      >
                        Swap with alternative ⇄
                      </button>
                    )}
                  </div>
                  <p className={styles.decisionBody}>{choice.decision}</p>
                  <dl className={styles.decisionMeta}>
                    <div>
                      <dt>Why</dt>
                      <dd>{choice.why}</dd>
                    </div>
                    <div>
                      <dt>Rejected alternative</dt>
                      <dd>{choice.alternative}</dd>
                    </div>
                    <div>
                      <dt>Tradeoff</dt>
                      <dd>{choice.tradeoff}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>

          <FlowGraph
            flows={plan.flows}
            driftReport={driftReport}
            onRefreshDrift={onRefreshDrift}
          />
        </section>

        <hr className={styles.divider} />

        <section className={styles.blueprintBlock}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>
              Execution &amp; model routing
            </span>
            <h3>Ordered task slices</h3>
            <p className={styles.sectionNote}>
              Each slice gives you two quality-calibrated model options—click
              either option pill (or choose from Other…) to recalculate cost and
              Handoff Studio exports live.
            </p>
          </div>

          <ol className={styles.taskList}>
            {plan.tasks.map((task, index) => {
              const candidate = candidates.find((c) => c.model === task.model);
              const taskUsd = candidate
                ? estimateTaskUsd(task, candidate)
                : null;
              const hasCandidateInList = candidates.some(
                (c) => c.model === task.model,
              );
              const pairCacheKey = `${plan.title}::${task.id}::${candidates
                .map((c) => c.model)
                .join(",")}`;
              let twoOptions = pinnedPairCacheRef.current.get(pairCacheKey);
              if (!twoOptions) {
                twoOptions = resolveTwoUiModelOptions({
                  task,
                  projectScale: plan.projectScale,
                  planTitle: plan.title,
                  planGoal: plan.goal,
                  candidates,
                  strict,
                });
                pinnedPairCacheRef.current.set(pairCacheKey, twoOptions);
              }
              const isCustomThirdModel =
                twoOptions.length > 0 &&
                !twoOptions.some((opt) => opt.candidate.model === task.model);
              return (
                <li key={task.id} className={styles.taskCard}>
                  <div className={styles.taskHeader}>
                    <span className={styles.taskIndex}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className={styles.taskTitleGroup}>
                      <h4>{task.title}</h4>
                      <p>{task.outcome}</p>
                    </div>
                    <div className={styles.taskBadges}>
                      {sliceVerifications?.[task.id] &&
                        sliceVerifications[task.id]!.status !== "idle" && (
                          <span
                            className={`${styles.sliceVerifyBadge} ${
                              sliceVerifications[task.id]!.status ===
                                "passed" ||
                              sliceVerifications[task.id]!.status === "accepted"
                                ? styles.sliceVerifyPassed
                                : sliceVerifications[task.id]!.status ===
                                    "failed"
                                  ? styles.sliceVerifyFailed
                                  : styles.sliceVerifyRunning
                            }`}
                          >
                            {sliceVerifications[task.id]!.status === "passed"
                              ? "Verified ✓"
                              : sliceVerifications[task.id]!.status ===
                                  "accepted"
                                ? "Accepted ✓"
                                : sliceVerifications[task.id]!.status ===
                                    "failed"
                                  ? `Failed (${sliceVerifications[task.id]!.report?.violations.length ?? 1})`
                                  : sliceVerifications[task.id]!.status ===
                                      "running"
                                    ? "Verifying…"
                                    : "Queued"}
                          </span>
                        )}
                      {candidate?.observedRuns &&
                        candidate.observedRuns > 0 &&
                        candidate.observedFirstPassRate !== undefined && (
                          <span
                            className={styles.empiricalBadge}
                            title={candidate.empiricalNote}
                          >
                            Proven:{" "}
                            {Math.round(candidate.observedFirstPassRate * 100)}%
                            1st-pass ({candidate.observedRuns})
                          </span>
                        )}
                      {candidate && (
                        <span
                          className={`${styles.tierPill} ${
                            candidate.tier === "frontier"
                              ? styles.tierFrontier
                              : candidate.tier === "balanced"
                                ? styles.tierBalanced
                                : styles.tierFast
                          }`}
                        >
                          {candidate.tier}
                        </span>
                      )}
                      {onUpdateTaskModel && candidates.length > 0 ? (
                        <select
                          className={`${styles.modelSelect} ${
                            isCustomThirdModel ? styles.modelSelectCustom : ""
                          }`}
                          aria-label={`Model for ${task.title}`}
                          title="Switch to any available execution model"
                          value={task.model}
                          onChange={(event) =>
                            onUpdateTaskModel(index, event.target.value)
                          }
                        >
                          {!hasCandidateInList && (
                            <option value={task.model}>{task.model}</option>
                          )}
                          {candidates.map((option) => (
                            <option key={option.model} value={option.model}>
                              {twoOptions.some(
                                (o) => o.candidate.model === option.model,
                              )
                                ? option.label
                                : `Other · ${option.label}`}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className={styles.modelBadge}>
                          {candidate?.label ?? task.model}
                        </span>
                      )}
                    </div>
                  </div>

                  {twoOptions.length >= 2 && onUpdateTaskModel && (
                    <div
                      className={styles.modelPairGrid}
                      role="group"
                      aria-label={`Recommended model options for ${task.title}`}
                    >
                      {twoOptions.map((opt, optIdx) => {
                        const isSelected = opt.candidate.model === task.model;
                        const optUsd = estimateTaskUsd(task, opt.candidate);
                        const costTag =
                          opt.candidate.billing === "local"
                            ? "$0 local"
                            : optUsd !== null
                              ? `~$${optUsd.toFixed(4)}`
                              : opt.candidate.billing;
                        return (
                          <button
                            key={opt.candidate.model}
                            type="button"
                            aria-pressed={isSelected}
                            className={`${styles.modelOptionCard} ${
                              isSelected ? styles.modelOptionCardActive : ""
                            }`}
                            onClick={() =>
                              onUpdateTaskModel(index, opt.candidate.model)
                            }
                          >
                            <div className={styles.modelOptionTop}>
                              <span className={styles.modelOptionIdentity}>
                                <span
                                  className={styles.modelOptionRadio}
                                  aria-hidden="true"
                                >
                                  {isSelected ? "●" : "○"}
                                </span>
                                <strong>{opt.candidate.label}</strong>
                                <span
                                  className={`${styles.modelOptionRole} ${
                                    optIdx === 0
                                      ? styles.modelOptionRolePrimary
                                      : styles.modelOptionRoleSecondary
                                  }`}
                                >
                                  {opt.roleLabel}
                                </span>
                              </span>
                              <span className={styles.modelOptionMeta}>
                                <span
                                  className={`${styles.tierPill} ${
                                    opt.candidate.tier === "frontier"
                                      ? styles.tierFrontier
                                      : opt.candidate.tier === "balanced"
                                        ? styles.tierBalanced
                                        : styles.tierFast
                                  }`}
                                >
                                  {opt.candidate.tier}
                                </span>
                                <span className={styles.modelOptionCost}>
                                  {costTag}
                                </span>
                              </span>
                            </div>
                            <span className={styles.modelOptionReason}>
                              {opt.reason}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {task.dependsOn.length > 0 && (
                    <p className={styles.taskDeps}>
                      <strong>Depends on</strong>{" "}
                      {task.dependsOn
                        .map(
                          (id) =>
                            plan.tasks.find((entry) => entry.id === id)
                              ?.title ?? id,
                        )
                        .join(", ")}
                    </p>
                  )}

                  <div className={styles.planGrid}>
                    <PlanList
                      title="Done when"
                      values={task.acceptance}
                      compact
                    />
                    <PlanList
                      title="Verification checks"
                      values={task.checks}
                      compact
                    />
                  </div>

                  {task.contract && (
                    <div className={styles.sliceContractBox}>
                      <div className={styles.sliceContractBar}>
                        <div className={styles.sliceContractSummary}>
                          <span className={styles.contractTag}>Contract</span>
                          <span>
                            <strong>Scope:</strong>{" "}
                            {task.contract.allowedGlobs.length > 0
                              ? task.contract.allowedGlobs.join(", ")
                              : "unrestricted"}
                          </span>
                          <span>
                            <strong>Deps:</strong>{" "}
                            {task.contract.allowDependencyChanges
                              ? "allowed"
                              : "locked"}
                          </span>
                          {task.contract.reviewerFamily && (
                            <span>
                              <strong>Adversarial review:</strong>{" "}
                              {formatReviewerFamilyLabel(
                                task.contract.reviewerFamily,
                              )}
                            </span>
                          )}
                        </div>
                        <div className={styles.sliceContractActions}>
                          {bridgeConnected && onVerifySlice && (
                            <button
                              type="button"
                              className={styles.miniCopyBtn}
                              disabled={
                                sliceVerifications?.[task.id]?.status ===
                                "running"
                              }
                              onClick={() => onVerifySlice(task.id)}
                            >
                              {sliceVerifications?.[task.id]?.status ===
                              "running"
                                ? "Verifying…"
                                : "Verify slice"}
                            </button>
                          )}
                          {onUpdateTaskContract && (
                            <button
                              type="button"
                              className={styles.miniCopyBtn}
                              aria-expanded={editingContractId === task.id}
                              onClick={() =>
                                openContractEditor(task.id, task.contract)
                              }
                            >
                              {editingContractId === task.id
                                ? "Cancel"
                                : "Edit contract"}
                            </button>
                          )}
                        </div>
                      </div>

                      {editingContractId === task.id && contractDraft && (
                        <div className={styles.contractEditor}>
                          <label className={styles.contractField}>
                            <span>
                              Allowed scope globs (comma-separated, blank =
                              unrestricted)
                            </span>
                            <input
                              type="text"
                              aria-label={`Allowed scope globs for ${task.title}`}
                              value={contractDraft.allowedGlobsText}
                              onChange={(e) =>
                                setContractDraft({
                                  ...contractDraft,
                                  allowedGlobsText: e.target.value,
                                  error: null,
                                })
                              }
                              placeholder="e.g. packages/web/**, test/**"
                            />
                          </label>
                          <label className={styles.contractField}>
                            <span>Forbidden globs (comma-separated)</span>
                            <input
                              type="text"
                              aria-label={`Forbidden globs for ${task.title}`}
                              value={contractDraft.forbiddenGlobsText}
                              onChange={(e) =>
                                setContractDraft({
                                  ...contractDraft,
                                  forbiddenGlobsText: e.target.value,
                                  error: null,
                                })
                              }
                            />
                          </label>
                          <label className={styles.contractField}>
                            <span>
                              Executable verification commands (one per line)
                            </span>
                            <textarea
                              rows={2}
                              aria-label={`Verification commands for ${task.title}`}
                              value={contractDraft.verificationCommandsText}
                              onChange={(e) =>
                                setContractDraft({
                                  ...contractDraft,
                                  verificationCommandsText: e.target.value,
                                  error: null,
                                })
                              }
                            />
                          </label>
                          <div className={styles.contractEditorBottom}>
                            <label className={styles.strictToggle}>
                              <input
                                type="checkbox"
                                checked={contractDraft.allowDependencyChanges}
                                onChange={(e) =>
                                  setContractDraft({
                                    ...contractDraft,
                                    allowDependencyChanges: e.target.checked,
                                  })
                                }
                              />
                              <span>Allow package.json dependency edits</span>
                            </label>
                            <button
                              type="button"
                              className={styles.primaryAction}
                              onClick={() =>
                                saveContractDraft(index, task.contract)
                              }
                            >
                              Save contract
                            </button>
                          </div>
                          {contractDraft.error && (
                            <p className={styles.repoError} role="alert">
                              {contractDraft.error}
                            </p>
                          )}
                        </div>
                      )}

                      {sliceVerifications?.[task.id]?.error && (
                        <p className={styles.repoError} role="alert">
                          {sliceVerifications[task.id]!.error}
                        </p>
                      )}

                      {sliceVerifications?.[task.id]?.report &&
                        sliceVerifications[task.id]!.report!.violations.length >
                          0 && (
                          <ul
                            className={styles.sliceViolationList}
                            aria-label={`Conformance violations for ${task.title}`}
                          >
                            {sliceVerifications[
                              task.id
                            ]!.report!.violations.map((v, vIdx) => (
                              <li key={vIdx}>
                                <code>{v.kind}</code>
                                {v.path ? ` (${v.path})` : ""}: {v.detail}
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  )}

                  <div className={styles.taskFooter}>
                    <p>
                      <strong>Why {candidate?.label ?? task.model}</strong>{" "}
                      {task.why}
                    </p>
                    {task.alternatives.length > 0 && (
                      <p>
                        <strong>Fallbacks</strong>{" "}
                        {task.alternatives
                          .map((item) => {
                            const altLabel =
                              candidates.find((c) => c.model === item.model)
                                ?.label ?? item.model;
                            return `${altLabel} (${item.tradeoff})`;
                          })
                          .join(" · ")}
                      </p>
                    )}
                    <p className={styles.taskTokens}>
                      <span>
                        {task.inputTokens.toLocaleString()} in /{" "}
                        {task.outputTokens.toLocaleString()} out
                      </span>
                      <span>
                        {candidate?.billing === "local" ? (
                          "$0.00 local OSS compute"
                        ) : candidate?.billing === "subscription" &&
                          taskUsd !== null ? (
                          `Included in subscription (~$${taskUsd.toFixed(4)} API eq.)`
                        ) : taskUsd !== null ? (
                          <>
                            ~${taskUsd.toFixed(4)} USD
                            {candidate?.arenaAgentRank
                              ? ` · Agent Arena #${candidate.arenaAgentRank}`
                              : ""}
                            {candidate?.sourceUrl ? (
                              <>
                                {" · "}
                                <a
                                  href={candidate.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  Rates
                                </a>
                              </>
                            ) : null}
                          </>
                        ) : (
                          "Unpriced setup"
                        )}
                      </span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        {(strict || plan.security.length > 0) && (
          <>
            <hr className={styles.divider} />
            <section className={styles.blueprintBlock}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionEyebrow}>Security</span>
                <h3>
                  {strict
                    ? "Strict security verification"
                    : "Security controls"}
                </h3>
              </div>
              <div className={styles.planGrid}>
                {plan.security.map((item, index) => (
                  <div className={styles.planSubcard} key={index}>
                    <h4>{item.risk}</h4>
                    <p className={styles.decisionBody}>{item.control}</p>
                    <p className={styles.verifyLine}>
                      <strong>Verify</strong> {item.verification}
                    </p>
                  </div>
                ))}
              </div>
              {strict && (
                <div className={styles.strictChecklist}>
                  <PlanList
                    title="Required review gates"
                    values={strictChecks}
                  />
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <LocalHandoffStudio
        plan={plan}
        candidates={candidates}
        strict={strict}
        quotaMode={quotaMode}
        bridgeConnected={bridgeConnected}
        bridgeRepoName={bridgeRepoName}
        onApplyOverBridge={onApplyOverBridge}
      />
    </div>
  );
}

function PlanList({
  title,
  values,
  compact = false,
}: {
  title: string;
  values: string[];
  compact?: boolean;
}) {
  if (!values.length) return null;
  return (
    <div className={compact ? styles.planMiniList : styles.planSubcard}>
      <h4>{title}</h4>
      <ul>
        {values.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    </div>
  );
}
