"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  PromptInput,
  type PromptOption,
} from "../../components/ui/ai-chat-input";
import {
  betaEfforts,
  betaIdeaMax,
  betaIdeaMin,
  betaPlanningDepth,
} from "../../lib/beta-draft";
import {
  makeHandoff,
  strictChecks,
  type GeneratedPlan,
  type PlanningInput,
} from "../../lib/planner";
import type { SelfHostedModel } from "../../lib/self-hosted-models";
import { ErrorCard, PlanResultView, WorkingCard } from "./plan-output";
import styles from "./beta.module.css";

type Provider = PlanningInput["provider"];
type Effort = (typeof betaEfforts)[number]["id"];
type Candidate = PlanningInput["candidates"][number];

const examples = [
  {
    label: "Build an internal tool",
    idea: "Build an internal dashboard that shows which scheduled jobs are failing, who owns them, and how to retry a failed job safely.",
  },
  {
    label: "Integrate a local LLM",
    idea: "Connect a self-hosted LLM to my web app so users can generate structured project plans. Include timeouts and a way to check whether the endpoint is healthy.",
  },
  {
    label: "Plan a feature",
    idea: "Add CSV imports to a small inventory app. Users should preview column mappings, see invalid rows, and avoid creating duplicates when they retry an import.",
  },
];

const defaultCandidates: Candidate[] = [
  {
    model: "gpt-5-mini",
    billing: "api",
    notes: "Use for narrow, well-specified tasks if available.",
  },
  {
    model: "gpt-5",
    billing: "api",
    notes:
      "Consider for larger changes or ambiguous architecture if available.",
  },
];

interface PromptTurn {
  id: number;
  text: string;
  providerLabel: string;
  effortLabel: string;
}

interface PlanSession {
  baseIdea: string;
  refinements: string[];
  turns: PromptTurn[];
  plan: GeneratedPlan | null;
  request: { idea: string; context: string } | null;
  strict: boolean;
  provider: Provider;
  providerLabel: string;
  modelId: string;
  coldLoading: boolean;
  effort: Effort;
  effortLabel: string;
  error: string;
  needsKey: boolean;
}

export interface BetaPromptProps {
  configured: boolean;
  configuredModel?: string;
  selfHostedModels?: SelfHostedModel[];
  serverGemini?: boolean;
  serverOpenAI?: boolean;
}

const configuredPrefix = "configured:";

function buildContext(effort: Effort, refinements: string[]): string {
  return [
    `Planning depth: ${betaPlanningDepth[effort]}`,
    ...refinements.map((item, index) => `Follow-up ${index + 1}: ${item}`),
  ].join("\n\n");
}

function buildLocalFirstPrompt(
  idea: string,
  context: string,
  strict: boolean,
): string {
  return [
    "Help me turn this rough request into a reviewed implementation plan. Inspect this repository and its instructions first. Use available AnvilMark planning tools if connected. Ask only questions that change scope, architecture, or verification. Explain architecture decisions and alternatives. Identify ordered tasks, acceptance checks and model suggestions, and show the plan for approval before changing application code.",
    `My request:\n${idea.trim()}`,
    context.trim() ? `Context:\n${context.trim()}` : "",
    strict ? `Strict verification:\n- ${strictChecks.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function isKeyError(status: number, message: string): boolean {
  return (
    (status === 400 && /api key/i.test(message)) ||
    /rejected this key/i.test(message)
  );
}

function parseSelection(selection: string): {
  provider: Provider;
  explicitModelId: string | null;
} {
  if (selection.startsWith(configuredPrefix)) {
    return {
      provider: "configured",
      explicitModelId: selection.slice(configuredPrefix.length),
    };
  }
  if (selection === "configured" || selection === "openai") {
    return { provider: selection, explicitModelId: null };
  }
  return { provider: "google", explicitModelId: null };
}

export function BetaPrompt({
  configured,
  configuredModel = "",
  selfHostedModels = [],
  serverGemini = false,
  serverOpenAI = false,
}: BetaPromptProps) {
  const [ossModels, setOssModels] =
    useState<SelfHostedModel[]>(selfHostedModels);

  const showCloudGroup = ossModels.length > 0 || configured;
  const cloudOptions: PromptOption[] = [
    {
      id: "google",
      label: "Gemini",
      ...(showCloudGroup ? { group: "Cloud API" } : {}),
      badge: serverGemini ? "Ready" : "API key",
      badgeTone: serverGemini ? "ready" : "muted",
    },
    {
      id: "openai",
      label: "OpenAI",
      ...(showCloudGroup ? { group: "Cloud API" } : {}),
      badge: serverOpenAI ? "Ready" : "API key",
      badgeTone: serverOpenAI ? "ready" : "muted",
    },
  ];

  const ossOptions: PromptOption[] =
    ossModels.length > 0
      ? ossModels.map((item) => ({
          id: `${configuredPrefix}${item.id}`,
          label: item.label,
          group: "OSS · am-server",
          badge:
            item.status === "loaded"
              ? "Loaded"
              : item.status === "loading"
                ? "Loading"
                : "On demand",
          badgeTone: item.status === "loaded" ? "ready" : "muted",
        }))
      : configured
        ? [
            {
              id: "configured",
              label: "Self-hosted",
              group: "OSS · am-server",
              badge: "Endpoint",
              badgeTone: "muted",
            },
          ]
        : [];

  const models = [...ossOptions, ...cloudOptions] as [
    PromptOption,
    ...PromptOption[],
  ];

  const defaultModelIds: Record<Provider, string> = {
    google: "gemini-3.1-flash-lite",
    openai: "gpt-5-mini",
    configured: ossModels[0]?.id ?? (configuredModel || "qwen3.5-9b"),
  };

  const [prompt, setPrompt] = useState("");
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [selection, setSelection] = useState<string>(models[0].id);
  const [modelIds, setModelIds] =
    useState<Record<Provider, string>>(defaultModelIds);
  const [apiKeys, setApiKeys] = useState<Record<Provider, string>>({
    google: "",
    openai: "",
    configured: "",
  });
  const [strict, setStrict] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [session, setSession] = useState<PlanSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedHandoff, setCopiedHandoff] = useState(false);
  const [copiedLocal, setCopiedLocal] = useState(false);

  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnCounter = useRef(0);
  const settingsPanelId = useId();
  const modelInputId = useId();
  const keyInputId = useId();

  const { provider, explicitModelId } = parseSelection(selection);
  const active = session !== null;
  const activeKey = apiKeys[provider];
  const activeModelId = (
    explicitModelId ??
    modelIds[provider] ??
    defaultModelIds[provider]
  ).trim();
  const selectedOption =
    models.find((option) => option.id === selection) ?? models[0];
  const providerLabel = selectedOption.label;
  const hasServerKey =
    (provider === "google" && serverGemini) ||
    (provider === "openai" && serverOpenAI);
  const keyReady =
    provider === "configured" || hasServerKey || activeKey.trim().length > 0;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !settingsRef.current?.contains(event.target)
      ) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [settingsOpen]);

  useEffect(() => {
    const container = outputScrollRef.current;
    if (!container || !active) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    container.scrollTo({
      top: busy ? container.scrollHeight : 0,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [active, busy, session?.turns.length, session?.plan]);

  async function refreshSelfHostedModels() {
    if (!configured) return;
    try {
      const response = await fetch("/api/plan/models", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data?.models) && data.models.length > 0) {
        setOssModels(data.models as SelfHostedModel[]);
      }
    } catch {
      // Keep the existing model list if the status refresh fails.
    }
  }

  async function requestPlan(params: {
    baseIdea: string;
    refinements: string[];
    turns: PromptTurn[];
    provider: Provider;
    providerLabel: string;
    modelId: string;
    coldLoading: boolean;
    effort: Effort;
    effortLabel: string;
    key: string;
    strict: boolean;
    previousPlan: GeneratedPlan | null;
    previousRequest: { idea: string; context: string } | null;
  }) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const context = buildContext(params.effort, params.refinements);
    setBusy(true);
    setCopiedHandoff(false);
    setCopiedLocal(false);
    setSession({
      baseIdea: params.baseIdea,
      refinements: params.refinements,
      turns: params.turns,
      plan: params.previousPlan,
      request: params.previousRequest,
      strict: params.strict,
      provider: params.provider,
      providerLabel: params.providerLabel,
      modelId: params.modelId,
      coldLoading: params.coldLoading,
      effort: params.effort,
      effortLabel: params.effortLabel,
      error: "",
      needsKey: false,
    });

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          idea: params.baseIdea,
          context,
          strict: params.strict,
          provider: params.provider,
          model: params.modelId,
          key: params.key.trim(),
          candidates: defaultCandidates,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string"
            ? data.error
            : "Could not generate a plan.";
        setSession((current) =>
          current
            ? {
                ...current,
                error: message,
                needsKey: isKeyError(response.status, message),
              }
            : current,
        );
        return;
      }
      setSession((current) =>
        current
          ? {
              ...current,
              plan: data.plan as GeneratedPlan,
              request: { idea: params.baseIdea, context },
              error: "",
              needsKey: false,
            }
          : current,
      );
      if (params.provider === "configured") {
        void refreshSelfHostedModels();
      }
    } catch (failure) {
      if (failure instanceof Error && failure.name === "AbortError") {
        setSession((current) =>
          current
            ? {
                ...current,
                error: "Request cancelled.",
                needsKey: false,
              }
            : current,
        );
        return;
      }
      setSession((current) =>
        current
          ? {
              ...current,
              error:
                failure instanceof Error
                  ? failure.message
                  : "Could not reach the planner model.",
              needsKey: false,
            }
          : current,
      );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  function handleSubmit(
    value: string,
    meta: { model: string; effort: string; attachments: File[] },
  ) {
    const parsed = parseSelection(meta.model);
    const selectedEffort = meta.effort as Effort;
    const option = models.find((item) => item.id === meta.model) ?? models[0];
    const selectedEffortLabel =
      betaEfforts.find((item) => item.id === selectedEffort)?.label ?? "Medium";
    const resolvedModelId = (
      parsed.explicitModelId ??
      modelIds[parsed.provider] ??
      defaultModelIds[parsed.provider]
    ).trim();
    const matchedOss =
      parsed.provider === "configured"
        ? ossModels.find((item) => item.id === resolvedModelId)
        : undefined;
    const coldLoading = Boolean(matchedOss && matchedOss.status !== "loaded");

    setSelection(meta.model);
    setSettingsOpen(false);
    setPrompt("");

    const nextTurn: PromptTurn = {
      id: ++turnCounter.current,
      text: value,
      providerLabel: option.label,
      effortLabel: selectedEffortLabel,
    };

    const isFollowUp = session !== null;
    const baseIdea = isFollowUp ? session.baseIdea : value;
    const refinements = isFollowUp ? [...session.refinements, value] : [];
    const turns = isFollowUp ? [...session.turns, nextTurn] : [nextTurn];

    void requestPlan({
      baseIdea,
      refinements,
      turns,
      provider: parsed.provider,
      providerLabel: option.label,
      modelId: resolvedModelId,
      coldLoading,
      effort: selectedEffort,
      effortLabel: selectedEffortLabel,
      key: apiKeys[parsed.provider],
      strict,
      previousPlan: isFollowUp ? session.plan : null,
      previousRequest: isFollowUp ? session.request : null,
    });
  }

  function handleRetry(overrideKey?: string) {
    if (!session) return;
    const matchedOss =
      provider === "configured"
        ? ossModels.find((item) => item.id === activeModelId)
        : undefined;
    void requestPlan({
      baseIdea: session.baseIdea,
      refinements: session.refinements,
      turns: session.turns,
      provider,
      providerLabel,
      modelId: activeModelId,
      coldLoading: Boolean(matchedOss && matchedOss.status !== "loaded"),
      effort: session.effort,
      effortLabel: session.effortLabel,
      key: overrideKey ?? apiKeys[provider],
      strict,
      previousPlan: session.plan,
      previousRequest: session.request,
    });
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  function handleReset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setSession(null);
    setPrompt("");
    setCopiedHandoff(false);
    setCopiedLocal(false);
  }

  async function copyText(text: string, kind: "handoff" | "local") {
    try {
      await navigator.clipboard.writeText(text);
      if (kind === "handoff") {
        setCopiedHandoff(true);
        window.setTimeout(() => setCopiedHandoff(false), 2400);
      } else {
        setCopiedLocal(true);
        window.setTimeout(() => setCopiedLocal(false), 2400);
      }
    } catch {
      // Clipboard unavailable in restricted browser contexts.
    }
  }

  const settingsControl = (
    <div
      className={styles.settingsPicker}
      ref={settingsRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setSettingsOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && settingsOpen) {
          setSettingsOpen(false);
          settingsButtonRef.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={settingsButtonRef}
        className={`${styles.settingsButton} ${!keyReady ? styles.settingsAttention : ""}`}
        aria-expanded={settingsOpen}
        aria-controls={settingsPanelId}
        aria-label="Model settings and API key"
        onClick={() => setSettingsOpen((open) => !open)}
      >
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="6.5" cy="11.5" r="3.25" />
          <path d="m9 9 6-6m-2.5 2.5 2 2M13 5l1.8 1.8" />
        </svg>
        <span>{keyReady ? "Config" : "API key"}</span>
        {strict && <i className={styles.strictDot} aria-hidden="true" />}
      </button>
      <div
        id={settingsPanelId}
        className={styles.settingsMenu}
        role="group"
        aria-label="Planner settings"
        hidden={!settingsOpen}
      >
        <div className={styles.settingsField}>
          <label htmlFor={modelInputId}>
            {provider === "configured"
              ? "Server model ID"
              : `${providerLabel} model ID`}
          </label>
          <input
            id={modelInputId}
            type="text"
            maxLength={120}
            value={activeModelId}
            readOnly={Boolean(explicitModelId)}
            onChange={(event) => {
              const next = event.target.value;
              setModelIds((current) => ({ ...current, [provider]: next }));
            }}
          />
        </div>
        {provider !== "configured" && (
          <div className={styles.settingsField}>
            <label htmlFor={keyInputId}>
              API key{" "}
              <small>{hasServerKey ? "Server key ready" : "Required"}</small>
            </label>
            <input
              id={keyInputId}
              type="password"
              autoComplete="off"
              maxLength={512}
              value={activeKey}
              placeholder={
                hasServerKey
                  ? "Using server key (optional override)"
                  : `Paste your ${providerLabel} key`
              }
              onChange={(event) => {
                const next = event.target.value;
                setApiKeys((current) => ({ ...current, [provider]: next }));
              }}
            />
          </div>
        )}
        <label className={styles.strictToggle}>
          <input
            type="checkbox"
            checked={strict}
            onChange={(event) => setStrict(event.target.checked)}
          />
          <span>Strict security review</span>
        </label>
        <p className={styles.settingsHint}>
          {provider === "configured"
            ? "Runs directly on your configured OSS server with no cloud API key."
            : "Keys stay in memory for this tab only and are never saved."}
        </p>
      </div>
    </div>
  );

  return (
    <main
      id="main"
      className={styles.stage}
      data-active={active ? "true" : "false"}
    >
      <div className={styles.topSpacer} aria-hidden="true" />

      <div className={styles.heroWrap} aria-hidden={active}>
        <div className={styles.heroInner}>
          <h1>
            What are you
            <br className={styles.break} /> building?
          </h1>
          <p>
            Start with an idea. We’ll turn it into a plan your coding agent can
            use.
          </p>
        </div>
      </div>

      <section
        className={styles.outputArea}
        aria-label="Plan output"
        aria-hidden={!active}
      >
        {session && (
          <div className={styles.outputBox}>
            <header className={styles.outputBar}>
              <div className={styles.outputBarLeft}>
                <span
                  className={`${styles.statusOrb} ${
                    busy
                      ? styles.statusOrbBusy
                      : session.error
                        ? styles.statusOrbError
                        : styles.statusOrbReady
                  }`}
                  aria-hidden="true"
                />
                <span className={styles.outputTitle}>
                  {busy
                    ? "Generating plan…"
                    : session.plan
                      ? session.plan.title
                      : "Planning session"}
                </span>
                <span className={styles.outputBadge}>
                  {session.providerLabel} · {session.effortLabel}
                </span>
              </div>
              <div className={styles.outputBarActions}>
                {session.plan && session.request && (
                  <button
                    type="button"
                    className={styles.barAction}
                    onClick={() =>
                      void copyText(
                        makeHandoff(
                          session.plan!,
                          session.strict,
                          session.request!,
                        ),
                        "handoff",
                      )
                    }
                  >
                    {copiedHandoff ? "Copied ✓" : "Copy handoff"}
                  </button>
                )}
                <button
                  type="button"
                  className={styles.barAction}
                  onClick={handleReset}
                >
                  New plan
                </button>
              </div>
            </header>

            <div className={styles.outputScroll} ref={outputScrollRef}>
              <div className={styles.promptHistory}>
                {session.turns.map((turn, index) => (
                  <div className={styles.userTurn} key={turn.id}>
                    <span className={styles.turnTag}>
                      {index === 0 ? "Your prompt" : `Refinement ${index}`}
                    </span>
                    <p>{turn.text}</p>
                  </div>
                ))}
              </div>

              {session.plan && session.request && (
                <div className={busy ? styles.planDimmed : undefined}>
                  <PlanResultView
                    plan={session.plan}
                    strict={session.strict}
                    candidates={defaultCandidates}
                    request={session.request}
                    onSelectQuestion={(question) => {
                      setPrompt(`Regarding "${question}": `);
                      setFocusTrigger((count) => count + 1);
                    }}
                    onCopyHandoff={() =>
                      void copyText(
                        makeHandoff(
                          session.plan!,
                          session.strict,
                          session.request!,
                        ),
                        "handoff",
                      )
                    }
                    copiedHandoff={copiedHandoff}
                  />
                </div>
              )}

              {busy && (
                <WorkingCard
                  providerLabel={session.providerLabel}
                  modelId={session.modelId}
                  effortLabel={session.effortLabel}
                  isRefinement={session.plan !== null}
                  coldLoading={session.coldLoading}
                />
              )}

              {!busy && session.error && (
                <ErrorCard
                  error={session.error}
                  needsKey={session.needsKey}
                  provider={provider}
                  providerLabel={providerLabel}
                  apiKey={activeKey}
                  onApiKeyChange={(next) =>
                    setApiKeys((current) => ({ ...current, [provider]: next }))
                  }
                  onRetry={handleRetry}
                  onCopyLocalPrompt={() =>
                    void copyText(
                      buildLocalFirstPrompt(
                        session.baseIdea,
                        buildContext(session.effort, session.refinements),
                        strict,
                      ),
                      "local",
                    )
                  }
                  copiedLocal={copiedLocal}
                />
              )}
            </div>
          </div>
        )}
      </section>

      <div className={styles.composerDock}>
        <PromptInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleSubmit}
          models={models}
          efforts={betaEfforts}
          model={selection}
          onModelChange={setSelection}
          placeholder={
            active
              ? "Answer open questions or refine this plan…"
              : "Describe what you want to build…"
          }
          submitLabel={active ? "Refine plan" : "Generate plan"}
          minLength={active ? 2 : betaIdeaMin}
          maxLength={betaIdeaMax}
          settled={active}
          busy={busy}
          onCancel={handleCancel}
          toolbarExtra={settingsControl}
          focusTrigger={focusTrigger}
        />

        <div className={styles.examplesWrap} aria-hidden={active}>
          <div className={styles.examplesInner}>
            <ul className={styles.examples} aria-label="Example ideas">
              {examples.map((example) => (
                <li key={example.label}>
                  <button
                    type="button"
                    tabIndex={active ? -1 : undefined}
                    disabled={active}
                    onClick={() => {
                      setPrompt(example.idea);
                      setFocusTrigger((count) => count + 1);
                    }}
                  >
                    {example.label} <span aria-hidden="true">↗</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className={styles.bottomSpacer} aria-hidden="true" />
    </main>
  );
}
