"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  PromptInput,
  type PromptOption,
} from "../../components/ui/ai-chat-input";
import { betaEfforts, betaIdeaMax } from "../../lib/beta-draft";
import type {
  BetaTurnResponse,
  ClarificationQuestionItem,
} from "../../lib/beta-turn";
import type { GeneratedPlan, PlanningInput } from "../../lib/planner";
import {
  defaultRoutingPreferences,
  formatRoutingSummary,
  routingPrefsStorageKey,
  subscriptionCatalog,
  subscriptionIds,
  type RoutableCandidate,
  type RoutingPreferences,
  type SubscriptionId,
} from "../../lib/routing-types";
import type { SelfHostedModel } from "../../lib/self-hosted-models";
import {
  AssistantAvatar,
  ClarificationWidget,
  ErrorCard,
  PlanArtifactView,
  ThinkingRow,
} from "./plan-output";
import styles from "./beta.module.css";

type Provider = PlanningInput["provider"];
type Effort = (typeof betaEfforts)[number]["id"];

const examples = [
  {
    label: "Build an internal tool",
    idea: "Build an internal dashboard that shows which scheduled jobs are failing, who owns them, and how to retry a failed job safely.",
  },
  {
    label: "Clarify a rough idea",
    idea: "Build a todo app for a small engineering team.",
  },
  {
    label: "Plan a feature",
    idea: "Add CSV imports to a small inventory app. Users should preview column mappings, see invalid rows, and avoid creating duplicates when they retry an import.",
  },
];

type ThreadEntry =
  | {
      id: number;
      role: "user";
      content: string;
    }
  | {
      id: number;
      role: "assistant";
      mode: "chat";
      reply: string;
    }
  | {
      id: number;
      role: "assistant";
      mode: "clarify";
      reply: string;
      questions: ClarificationQuestionItem[];
    }
  | {
      id: number;
      role: "assistant";
      mode: "plan";
      reply: string;
      plan: GeneratedPlan;
      candidates: RoutableCandidate[];
      catalogDate: string;
      strict: boolean;
    };

export interface BetaPromptProps {
  configured: boolean;
  configuredModel?: string;
  selfHostedModels?: SelfHostedModel[];
  serverGemini?: boolean;
  serverOpenAI?: boolean;
}

const configuredPrefix = "configured:";

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

function parseStoredRoutingPrefs(
  raw: string | null,
): RoutingPreferences | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      mode?: unknown;
      subscriptions?: unknown;
    };
    if (parsed.mode !== "open" && parsed.mode !== "subscriptions") return null;
    const validSet = new Set<string>(subscriptionIds);
    const subs = Array.isArray(parsed.subscriptions)
      ? parsed.subscriptions.filter(
          (item): item is SubscriptionId =>
            typeof item === "string" && validSet.has(item),
        )
      : [];
    return { mode: parsed.mode, subscriptions: subs };
  } catch {
    return null;
  }
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
  const [lastEffort, setLastEffort] = useState<Effort>("medium");
  const [modelIds, setModelIds] =
    useState<Record<Provider, string>>(defaultModelIds);
  const [apiKeys, setApiKeys] = useState<Record<Provider, string>>({
    google: "",
    openai: "",
    configured: "",
  });
  const [strict, setStrict] = useState(false);
  const [routingPrefs, setRoutingPrefs] = useState<RoutingPreferences>(
    defaultRoutingPreferences,
  );
  const [toolsOpen, setToolsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [coldLoading, setColdLoading] = useState(false);
  const [turnError, setTurnError] = useState<{
    message: string;
    needsKey: boolean;
    forcePlan: boolean;
  } | null>(null);

  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const entryIdRef = useRef(0);

  const toolsMenuId = useId();
  const settingsPanelId = useId();
  const modelInputId = useId();
  const keyInputId = useId();

  const { provider, explicitModelId } = parseSelection(selection);
  const active = entries.length > 0;
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

  const latestPlanEntry = [...entries]
    .reverse()
    .find(
      (
        item,
      ): item is Extract<ThreadEntry, { role: "assistant"; mode: "plan" }> =>
        item.role === "assistant" && item.mode === "plan",
    );

  useEffect(() => {
    try {
      const saved = parseStoredRoutingPrefs(
        window.localStorage.getItem(routingPrefsStorageKey),
      );
      if (saved) setRoutingPrefs(saved);
    } catch {
      // Storage unavailable in restricted browser mode.
    }
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  function updateRoutingPrefs(next: RoutingPreferences) {
    setRoutingPrefs(next);
    try {
      window.localStorage.setItem(routingPrefsStorageKey, JSON.stringify(next));
    } catch {
      // Ignore storage quota / privacy block.
    }
  }

  function toggleSubscription(subId: SubscriptionId) {
    const exists = routingPrefs.subscriptions.includes(subId);
    const nextSubs = exists
      ? routingPrefs.subscriptions.filter((id) => id !== subId)
      : [...routingPrefs.subscriptions, subId];
    updateRoutingPrefs({
      mode: nextSubs.length > 0 ? "subscriptions" : "open",
      subscriptions: nextSubs,
    });
  }

  useEffect(() => {
    if (!settingsOpen && !toolsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (settingsOpen && !settingsRef.current?.contains(event.target)) {
        setSettingsOpen(false);
      }
      if (toolsOpen && !toolsRef.current?.contains(event.target)) {
        setToolsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [settingsOpen, toolsOpen]);

  useEffect(() => {
    if (!active) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    threadBottomRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "end",
    });
  }, [active, entries.length, busy, turnError]);

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
      // Keep existing OSS list if refresh fails.
    }
  }

  function serializeMessages(list: readonly ThreadEntry[]) {
    return list.slice(-20).map((entry) => {
      if (entry.role === "user") {
        return { role: "user" as const, content: entry.content };
      }
      if (entry.mode === "clarify") {
        const qList = entry.questions.map((q) => `- ${q.question}`).join("\n");
        return {
          role: "assistant" as const,
          content: `${entry.reply}\n\nClarifying questions asked:\n${qList}`,
        };
      }
      if (entry.mode === "plan") {
        return {
          role: "assistant" as const,
          content: `${entry.reply}\n\nGenerated plan "${entry.plan.title}": ${entry.plan.goal}`,
        };
      }
      return { role: "assistant" as const, content: entry.reply };
    });
  }

  async function runTurn(params: {
    nextEntries: ThreadEntry[];
    provider: Provider;
    modelId: string;
    effort: Effort;
    key: string;
    strict: boolean;
    forcePlan: boolean;
    prefs: RoutingPreferences;
    isCold: boolean;
  }) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setEntries(params.nextEntries);
    setBusy(true);
    setColdLoading(params.isCold);
    setTurnError(null);

    try {
      const response = await fetch("/api/beta/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: serializeMessages(params.nextEntries),
          effort: params.effort,
          strict: params.strict,
          forcePlan: params.forcePlan,
          provider: params.provider,
          model: params.modelId,
          key: params.key.trim(),
          routingPrefs: params.prefs,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof data?.error === "string"
            ? data.error
            : "Could not complete this turn.";
        setTurnError({
          message,
          needsKey: isKeyError(response.status, message),
          forcePlan: params.forcePlan,
        });
        return;
      }

      const turn = data as BetaTurnResponse | undefined;
      if (
        !turn ||
        (turn.mode !== "chat" &&
          turn.mode !== "clarify" &&
          (turn.mode !== "plan" || !turn.plan))
      ) {
        setTurnError({
          message: "Received an invalid response from the planner.",
          needsKey: false,
          forcePlan: params.forcePlan,
        });
        return;
      }

      const assistantId = ++entryIdRef.current;
      const newEntry: ThreadEntry =
        turn.mode === "chat"
          ? {
              id: assistantId,
              role: "assistant",
              mode: "chat",
              reply: turn.reply,
            }
          : turn.mode === "clarify"
            ? {
                id: assistantId,
                role: "assistant",
                mode: "clarify",
                reply: turn.reply,
                questions: turn.questions,
              }
            : {
                id: assistantId,
                role: "assistant",
                mode: "plan",
                reply: turn.reply,
                plan: turn.plan,
                candidates: turn.candidates,
                catalogDate: turn.catalogDate,
                strict: turn.strict,
              };
      setEntries((current) => [...current, newEntry]);

      if (params.provider === "configured") {
        void refreshSelfHostedModels();
      }
    } catch (failure) {
      if (failure instanceof Error && failure.name === "AbortError") {
        setTurnError({
          message: "Generation stopped.",
          needsKey: false,
          forcePlan: params.forcePlan,
        });
        return;
      }
      setTurnError({
        message:
          failure instanceof Error
            ? failure.message
            : "Could not reach the planning model.",
        needsKey: false,
        forcePlan: params.forcePlan,
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusy(false);
        setColdLoading(false);
      }
    }
  }

  function submitUserMessage(
    text: string,
    options: {
      selectedModel?: string;
      effort?: Effort;
      forcePlan?: boolean;
    } = {},
  ) {
    const modelChoice = options.selectedModel ?? selection;
    const chosenEffort = options.effort ?? lastEffort;
    const parsed = parseSelection(modelChoice);
    const resolvedModelId = (
      parsed.explicitModelId ??
      modelIds[parsed.provider] ??
      defaultModelIds[parsed.provider]
    ).trim();
    const matchedOss =
      parsed.provider === "configured"
        ? ossModels.find((item) => item.id === resolvedModelId)
        : undefined;

    setSelection(modelChoice);
    setLastEffort(chosenEffort);
    setSettingsOpen(false);
    setToolsOpen(false);
    setPrompt("");

    const userEntry: ThreadEntry = {
      id: ++entryIdRef.current,
      role: "user",
      content: text,
    };

    void runTurn({
      nextEntries: [...entries, userEntry],
      provider: parsed.provider,
      modelId: resolvedModelId,
      effort: chosenEffort,
      key: apiKeys[parsed.provider],
      strict,
      forcePlan: Boolean(options.forcePlan),
      prefs: routingPrefs,
      isCold: Boolean(matchedOss && matchedOss.status !== "loaded"),
    });
  }

  function handleComposerSubmit(
    value: string,
    meta: { model: string; effort: string; attachments: File[] },
  ) {
    submitUserMessage(value, {
      selectedModel: meta.model,
      effort: meta.effort as Effort,
      forcePlan: false,
    });
  }

  function handleRetry(overrideKey?: string) {
    if (entries.length === 0) return;
    const matchedOss =
      provider === "configured"
        ? ossModels.find((item) => item.id === activeModelId)
        : undefined;
    void runTurn({
      nextEntries: entries,
      provider,
      modelId: activeModelId,
      effort: lastEffort,
      key: overrideKey ?? apiKeys[provider],
      strict,
      forcePlan: turnError?.forcePlan ?? false,
      prefs: routingPrefs,
      isCold: Boolean(matchedOss && matchedOss.status !== "loaded"),
    });
  }

  function handleReset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setColdLoading(false);
    setEntries([]);
    setTurnError(null);
    setPrompt("");
  }

  const toolbarControls = (
    <>
      <div
        className={styles.settingsPicker}
        ref={toolsRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setToolsOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && toolsOpen) {
            setToolsOpen(false);
            toolsButtonRef.current?.focus();
          }
        }}
      >
        <button
          type="button"
          ref={toolsButtonRef}
          className={styles.settingsButton}
          aria-expanded={toolsOpen}
          aria-controls={toolsMenuId}
          aria-label={`Task model routing: ${formatRoutingSummary(routingPrefs)}`}
          onClick={() => {
            setToolsOpen((open) => !open);
            setSettingsOpen(false);
          }}
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
            <path d="M3 5h8M14 5h1M3 9h3m4 0h5M3 13h9m3 0h0" />
            <circle cx="12.5" cy="5" r="1.5" />
            <circle cx="8" cy="9" r="1.5" />
            <circle cx="13.5" cy="13" r="1.5" />
          </svg>
          <span>{formatRoutingSummary(routingPrefs)}</span>
        </button>

        <div
          id={toolsMenuId}
          className={styles.toolsMenu}
          role="group"
          aria-label="Coding subscriptions and routing preferences"
          hidden={!toolsOpen}
        >
          <div className={styles.toolsMenuHeader}>
            <strong>Task model routing</strong>
            <p>
              Pick the subscriptions or IDEs you use so plans recommend models
              you already have—or keep Open best-fit.
            </p>
          </div>
          <button
            type="button"
            aria-pressed={routingPrefs.mode === "open"}
            className={`${styles.toolRow} ${routingPrefs.mode === "open" ? styles.toolRowActive : ""}`}
            onClick={() =>
              updateRoutingPrefs({ mode: "open", subscriptions: [] })
            }
          >
            <div>
              <span>Open best-fit (unrestricted)</span>
              <small>
                Routes across latest Arena & catalog leaders for best quality /
                cost
              </small>
            </div>
            <i aria-hidden="true">{routingPrefs.mode === "open" ? "✓" : ""}</i>
          </button>

          <div className={styles.toolsSubheading}>My subscriptions & tools</div>
          {subscriptionCatalog.map((item) => {
            const checked =
              routingPrefs.mode === "subscriptions" &&
              routingPrefs.subscriptions.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={checked}
                className={`${styles.toolRow} ${checked ? styles.toolRowActive : ""}`}
                onClick={() => toggleSubscription(item.id)}
              >
                <div>
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </div>
                <i aria-hidden="true">{checked ? "✓" : ""}</i>
              </button>
            );
          })}
        </div>
      </div>

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
          onClick={() => {
            setSettingsOpen((open) => !open);
            setToolsOpen(false);
          }}
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
              ? "Runs directly on your OSS server over Tailscale."
              : "Keys stay in memory for this tab only and are never saved."}
          </p>
        </div>
      </div>
    </>
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
            Start with an idea. We’ll clarify what matters, lock architecture
            decisions, route each task to the right model, and build your agent
            prompt.
          </p>
        </div>
      </div>

      <section
        className={styles.threadArea}
        aria-label="Conversation"
        aria-hidden={!active}
      >
        {active && (
          <>
            <header className={styles.sessionHeader}>
              <div className={styles.sessionMeta}>
                <span className={styles.sessionTitle}>
                  {latestPlanEntry
                    ? latestPlanEntry.plan.title
                    : "Planning conversation"}
                </span>
                <span className={styles.sessionPill}>
                  Routing: {formatRoutingSummary(routingPrefs)}
                </span>
              </div>
              <button
                type="button"
                className={styles.newChatButton}
                onClick={handleReset}
              >
                New chat
              </button>
            </header>

            <div className={styles.threadScroll} ref={threadScrollRef}>
              <div className={styles.threadList}>
                {entries.map((entry, idx) => {
                  if (entry.role === "user") {
                    return (
                      <div className={styles.userRow} key={entry.id}>
                        <div className={styles.userBubble}>{entry.content}</div>
                      </div>
                    );
                  }

                  const hasLaterEntry = idx < entries.length - 1;

                  return (
                    <div className={styles.assistantRow} key={entry.id}>
                      <AssistantAvatar />
                      <div className={styles.assistantContent}>
                        <p className={styles.assistantProse}>{entry.reply}</p>

                        {entry.mode === "clarify" && (
                          <ClarificationWidget
                            questions={entry.questions}
                            answered={hasLaterEntry || busy}
                            routingPrefs={routingPrefs}
                            onRoutingPrefsChange={updateRoutingPrefs}
                            onSubmitAnswers={(summary) =>
                              submitUserMessage(summary, { forcePlan: true })
                            }
                            onSkipDefaults={() =>
                              submitUserMessage(
                                "Use clean, pragmatic defaults for v1 and generate the implementation plan.",
                                { forcePlan: true },
                              )
                            }
                          />
                        )}

                        {entry.mode === "plan" && (
                          <PlanArtifactView
                            plan={entry.plan}
                            candidates={entry.candidates}
                            catalogDate={entry.catalogDate}
                            strict={entry.strict}
                            onSelectQuestion={(question) => {
                              setPrompt(`Regarding "${question}": `);
                              setFocusTrigger((count) => count + 1);
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                {busy && (
                  <ThinkingRow
                    providerLabel={providerLabel}
                    coldLoading={coldLoading}
                  />
                )}

                {!busy && turnError && (
                  <div className={styles.assistantRow}>
                    <AssistantAvatar />
                    <div className={styles.assistantContent}>
                      <ErrorCard
                        error={turnError.message}
                        needsKey={turnError.needsKey}
                        provider={provider}
                        providerLabel={providerLabel}
                        apiKey={activeKey}
                        onApiKeyChange={(next) =>
                          setApiKeys((current) => ({
                            ...current,
                            [provider]: next,
                          }))
                        }
                        onRetry={handleRetry}
                      />
                    </div>
                  </div>
                )}

                <div ref={threadBottomRef} className={styles.scrollAnchor} />
              </div>
            </div>
          </>
        )}
      </section>

      <div className={styles.composerDock}>
        <PromptInput
          value={prompt}
          onChange={setPrompt}
          onSubmit={handleComposerSubmit}
          models={models}
          efforts={betaEfforts}
          model={selection}
          onModelChange={setSelection}
          placeholder={
            active
              ? "Reply, refine decisions, or ask anything…"
              : "Ask anything or describe what you want to build…"
          }
          submitLabel={active ? "Send message" : "Send"}
          minLength={1}
          maxLength={betaIdeaMax}
          settled={active}
          busy={busy}
          onCancel={() => abortRef.current?.abort()}
          toolbarExtra={toolbarControls}
          focusTrigger={focusTrigger}
        />

        <div className={styles.examplesWrap} aria-hidden={active}>
          <div className={styles.examplesInner}>
            <ul className={styles.examples} aria-label="Example prompts">
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
