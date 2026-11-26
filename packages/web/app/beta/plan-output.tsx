"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  estimateCost,
  makeHandoff,
  ratesChecked,
  strictChecks,
  type GeneratedPlan,
  type PlanningInput,
} from "../../lib/planner";
import styles from "./beta.module.css";

type Candidate = PlanningInput["candidates"][number];

const workingStages = [
  "Sending your brief to the planning model…",
  "Mapping scope, assumptions, and open questions…",
  "Weighing architecture decisions and tradeoffs…",
  "Sequencing implementation tasks and checks…",
  "Validating plan schema and model routing…",
] as const;

export function WorkingCard({
  providerLabel,
  modelId,
  effortLabel,
  isRefinement,
  coldLoading = false,
}: {
  providerLabel: string;
  modelId: string;
  effortLabel: string;
  isRefinement: boolean;
  coldLoading?: boolean;
}) {
  const [stageIndex, setStageIndex] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const stages = coldLoading
    ? [
        `Loading ${providerLabel} on am-server and preparing your brief…`,
        ...workingStages.slice(1),
      ]
    : workingStages;

  useEffect(() => {
    const started = Date.now();
    const tick = window.setInterval(() => {
      const nextElapsed = Date.now() - started;
      setElapsedMs(nextElapsed);
      setStageIndex(
        Math.min(
          stages.length - 1,
          Math.floor(nextElapsed / (coldLoading ? 3600 : 2400)),
        ),
      );
    }, 100);
    return () => window.clearInterval(tick);
  }, [coldLoading, stages.length]);

  const seconds = (elapsedMs / 1000).toFixed(1);

  return (
    <div
      className={styles.workingCard}
      role="status"
      aria-live="polite"
      aria-label="Generating plan"
    >
      <div className={styles.workingTrace} aria-hidden="true" />
      <div className={styles.workingHeader}>
        <div className={styles.pixelLoader} aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => (
            <span
              key={index}
              className={styles.pixelCell}
              style={{
                animationDelay: `${((index % 3) + Math.floor(index / 3)) * 110}ms`,
              }}
            />
          ))}
        </div>
        <div className={styles.workingCopy}>
          <p className={styles.workingTitle}>
            {isRefinement ? "Refining your plan" : "Building your plan"}
          </p>
          <p className={styles.workingStage} key={stageIndex}>
            {stages[stageIndex]}
          </p>
        </div>
        <div className={styles.workingMeta}>
          <span className={styles.metaChip}>
            {modelId && modelId !== providerLabel
              ? `${providerLabel} · ${modelId}`
              : providerLabel}
          </span>
          <span className={styles.metaChip}>{effortLabel}</span>
          <span className={styles.timer}>{seconds}s</span>
        </div>
      </div>
      <div className={styles.skeletonGrid} aria-hidden="true">
        <div className={styles.skeletonLineWide} />
        <div className={styles.skeletonLineMid} />
        <div className={styles.skeletonCards}>
          <div className={styles.skeletonCard}>
            <span />
            <span />
          </div>
          <div className={styles.skeletonCard}>
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
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
  onCopyLocalPrompt,
  copiedLocal,
}: {
  error: string;
  needsKey: boolean;
  provider: PlanningInput["provider"];
  providerLabel: string;
  apiKey: string;
  onApiKeyChange: (next: string) => void;
  onRetry: (overrideKey?: string) => void;
  onCopyLocalPrompt: () => void;
  copiedLocal: boolean;
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
              ? `Connect a ${providerLabel} API key to generate this plan`
              : "Could not complete this plan"}
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
            Generate plan
          </button>
        </form>
      )}

      {needsKey && (
        <p className={styles.keyNote}>
          Sent only to {providerLabel} through this server and never saved. For
          a local default, set{" "}
          <code>
            {provider === "openai"
              ? "ANVILMARK_OPENAI_API_KEY"
              : "ANVILMARK_GEMINI_API_KEY"}
          </code>{" "}
          in <code>packages/web/.env.local</code>.
        </p>
      )}

      <div className={styles.errorActions}>
        {!needsKey && (
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => onRetry()}
          >
            Try again
          </button>
        )}
        <button
          type="button"
          className={styles.ghostAction}
          onClick={onCopyLocalPrompt}
        >
          {copiedLocal
            ? "Copied local-first prompt ✓"
            : "Copy local-first prompt"}
        </button>
      </div>
    </div>
  );
}

export function PlanResultView({
  plan,
  strict,
  candidates,
  request,
  onSelectQuestion,
  onCopyHandoff,
  copiedHandoff,
}: {
  plan: GeneratedPlan;
  strict: boolean;
  candidates: Candidate[];
  request: { idea: string; context: string };
  onSelectQuestion: (question: string) => void;
  onCopyHandoff: () => void;
  copiedHandoff: boolean;
}) {
  const [handoffOpen, setHandoffOpen] = useState(false);

  const totalInput = plan.tasks.reduce(
    (sum, task) => sum + task.inputTokens,
    0,
  );
  const totalOutput = plan.tasks.reduce(
    (sum, task) => sum + task.outputTokens,
    0,
  );
  const taskCosts = plan.tasks.map((task) => {
    const candidate = candidates.find((item) => item.model === task.model);
    return candidate ? estimateCost(task, candidate) : null;
  });
  const knownCost = taskCosts.every(Boolean)
    ? taskCosts.reduce((sum, item) => sum + (item?.usd ?? 0), 0)
    : null;
  const handoff = makeHandoff(plan, strict, request);

  return (
    <article className={styles.planResult} aria-label="Generated plan">
      <section className={styles.planSection}>
        <div className={styles.planHeading}>
          <div>
            <span className={styles.sectionEyebrow}>Overview</span>
            <h2>{plan.title}</h2>
          </div>
          <div className={styles.summaryStats}>
            <span>
              {plan.tasks.length} {plan.tasks.length === 1 ? "task" : "tasks"}
            </span>
            <span>
              {plan.architecture.length}{" "}
              {plan.architecture.length === 1 ? "decision" : "decisions"}
            </span>
            <span>~{(totalInput + totalOutput).toLocaleString()} tokens</span>
            {knownCost !== null && <span>~${knownCost.toFixed(4)} est.</span>}
          </div>
        </div>

        <p className={styles.planGoal}>{plan.goal}</p>
        <p className={styles.planAudience}>
          <strong>Who it’s for</strong> {plan.users}
        </p>

        <div className={styles.planGrid}>
          <PlanList title="In scope" values={plan.scope} />
          <PlanList title="Out of scope" values={plan.nonGoals} />
          <PlanList title="Assumptions" values={plan.assumptions} />
          {plan.questions.length > 0 && (
            <div className={styles.planSubcard}>
              <h4>Open questions</h4>
              <ul className={styles.questionList}>
                {plan.questions.map((question, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      className={styles.questionChip}
                      onClick={() => onSelectQuestion(question)}
                      title="Click to answer this question in the prompt box below"
                    >
                      <span>{question}</span>
                      <span className={styles.questionReply} aria-hidden="true">
                        Reply ↵
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className={styles.planSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>Architecture</span>
          <h3>Architecture decisions</h3>
          <p className={styles.sectionNote}>
            Proposed from your brief. Confirm against the actual repository
            before editing code.
          </p>
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
                  <dt>Alternative</dt>
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
            <h4>Data flows</h4>
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

      <section className={styles.planSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>Execution</span>
          <h3>Implementation tasks</h3>
          <p className={styles.sectionNote}>
            Token and cost estimates cover one attempt and exclude retries.
            Published rates checked {ratesChecked}.
          </p>
        </div>

        <ol className={styles.taskList}>
          {plan.tasks.map((task, index) => {
            const candidate = candidates.find(
              (item) => item.model === task.model,
            );
            const selection = candidate ? estimateCost(task, candidate) : null;
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
                  <span className={styles.modelBadge}>{task.model}</span>
                </div>

                {task.dependsOn.length > 0 && (
                  <p className={styles.taskDeps}>
                    <strong>After</strong>{" "}
                    {task.dependsOn
                      .map(
                        (id) =>
                          plan.tasks.find((entry) => entry.id === id)?.title ??
                          id,
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
                    title="Checks to run"
                    values={task.checks}
                    compact
                  />
                </div>

                <div className={styles.taskFooter}>
                  <p>
                    <strong>Model fit</strong> {task.why}
                  </p>
                  {task.alternatives.length > 0 && (
                    <p>
                      <strong>Alternatives</strong>{" "}
                      {task.alternatives
                        .map((item) => `${item.model} (${item.tradeoff})`)
                        .join(" · ")}
                    </p>
                  )}
                  <p className={styles.taskTokens}>
                    <span>
                      {task.inputTokens.toLocaleString()} in /{" "}
                      {task.outputTokens.toLocaleString()} out
                    </span>
                    <span>
                      {selection ? (
                        <>
                          ${selection.usd.toFixed(4)} USD ·{" "}
                          <a
                            href={selection.source}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Published rates
                          </a>
                        </>
                      ) : candidate?.billing === "subscription" ? (
                        "Subscription cost unknown"
                      ) : candidate?.billing === "local" ? (
                        "Local compute unestimated"
                      ) : (
                        "No sourced rate"
                      )}
                    </span>
                  </p>
                  <p className={styles.taskBasis}>{task.estimateBasis}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {(strict || plan.security.length > 0) && (
        <section className={styles.planSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionEyebrow}>Verification</span>
            <h3>
              {strict ? "Strict security review" : "Security considerations"}
            </h3>
            <p className={styles.sectionNote}>
              Verification is pending until your local coding agent runs checks
              in the repository.
            </p>
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
              <PlanList title="Required review steps" values={strictChecks} />
            </div>
          )}
        </section>
      )}

      <section className={styles.handoffSection}>
        <div className={styles.handoffTop}>
          <div>
            <span className={styles.sectionEyebrow}>Agent handoff</span>
            <h3>Continue in your repository</h3>
            <p className={styles.sectionNote}>
              Paste this structured brief into Claude Code or Codex to inspect
              the codebase and execute task by task.
            </p>
          </div>
          <div className={styles.handoffButtons}>
            <button
              type="button"
              className={styles.primaryAction}
              onClick={onCopyHandoff}
            >
              {copiedHandoff ? "Copied handoff ✓" : "Copy agent handoff"}
            </button>
            <button
              type="button"
              className={styles.ghostAction}
              aria-expanded={handoffOpen}
              onClick={() => setHandoffOpen((current) => !current)}
            >
              {handoffOpen ? "Hide prompt" : "Preview prompt"}
            </button>
          </div>
        </div>
        {handoffOpen && (
          <pre className={styles.handoffPreview}>
            <code>{handoff}</code>
          </pre>
        )}
      </section>
    </article>
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
