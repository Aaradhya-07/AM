"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { ClarificationQuestionItem } from "../../lib/beta-turn";
import {
  strictChecks,
  type GeneratedPlan,
  type PlanningInput,
} from "../../lib/planner";
import {
  computePlanSavingsSummary,
  estimateTaskUsd,
  subscriptionCatalog,
  type RoutableCandidate,
  type RoutingPreferences,
  type SubscriptionId,
} from "../../lib/routing-types";
import { LocalHandoffStudio } from "./handoff-studio";
import styles from "./beta.module.css";

const thinkingPhrases = [
  "Thinking…",
  "Evaluating scope & missing constraints…",
  "Comparing architecture & model tradeoffs…",
  "Structuring task slices & agent handoff…",
] as const;

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
}: {
  providerLabel: string;
  coldLoading?: boolean;
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

  return (
    <div
      className={styles.assistantRow}
      role="status"
      aria-live="polite"
      aria-label="Generating response"
    >
      <AssistantAvatar active />
      <div className={styles.thinkingBody}>
        <span className={styles.shimmerText} key={index}>
          {phrases[index]}
        </span>
        {elapsedMs >= 1500 && (
          <span className={styles.thinkingTimer}>
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
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
                pay for, or chooses openly for best quality & cost.
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
            Skip & use defaults
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
  onSelectQuestion,
}: {
  plan: GeneratedPlan;
  candidates: readonly RoutableCandidate[];
  catalogDate: string;
  strict: boolean;
  onSelectQuestion: (question: string) => void;
}) {
  const totalTokens = plan.tasks.reduce(
    (sum, t) => sum + t.inputTokens + t.outputTokens,
    0,
  );
  const savings = computePlanSavingsSummary(plan.tasks, candidates);

  return (
    <div className={styles.planArtifact}>
      <div className={styles.blueprintCard}>
        <header className={styles.blueprintHeader}>
          <div>
            <span className={styles.sectionEyebrow}>
              Architecture & task plan
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
            <h3>Key decisions & rejected alternatives</h3>
          </div>
          <div className={styles.planGrid}>
            {plan.architecture.map((choice, index) => (
              <div className={styles.planSubcard} key={index}>
                <h4>{choice.title}</h4>
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
            ))}
          </div>

          {plan.flows.length > 0 && (
            <div className={styles.flowsBlock}>
              <h4>Data flows & boundaries</h4>
              <div className={styles.flowsList}>
                {plan.flows.map((flow, index) => (
                  <div className={styles.flowRow} key={index}>
                    <strong>
                      {flow.from} → {flow.to}
                    </strong>
                    <p>
                      {flow.data} · <span>{flow.boundary}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <hr className={styles.divider} />

        <section className={styles.blueprintBlock}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>
              Execution & model routing
            </span>
            <h3>Ordered task slices</h3>
            <p className={styles.sectionNote}>
              Each slice is matched to the lowest-cost eligible model tier that
              clears its scope and risk bar.
            </p>
          </div>

          <ol className={styles.taskList}>
            {plan.tasks.map((task, index) => {
              const candidate = candidates.find((c) => c.model === task.model);
              const taskUsd = candidate
                ? estimateTaskUsd(task, candidate)
                : null;
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
                      <span className={styles.modelBadge}>
                        {candidate?.label ?? task.model}
                      </span>
                    </div>
                  </div>

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

      <LocalHandoffStudio plan={plan} candidates={candidates} strict={strict} />
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
