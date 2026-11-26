"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

import {
  PromptInput,
  type PromptOption,
} from "../../components/ui/ai-chat-input";
import { betaEfforts, betaIdeaMax } from "../../lib/beta-draft";
import {
  consumeBetaTurnSse,
  createThreadId,
  deleteSavedThread,
  deriveThreadTitle,
  isValidBetaTurnResponse,
  loadRoutingPrefsForUser,
  loadSavedThreads,
  saveRoutingPrefsForUser,
  upsertSavedThread,
  type LiveStreamState,
  type SavedBetaThread,
  type StoredAttachment,
  type ThreadEntry,
} from "../../lib/beta-history";
import {
  BetaAttachmentSchema,
  RepoContextSnapshotSchema,
  type BetaAttachment,
  type BetaTurnResponse,
  type PlanHandoffBundle,
  type RepoContextSnapshot,
} from "../../lib/beta-turn";
import {
  BRIDGE_COMMAND_SNIPPET,
  DEFAULT_BRIDGE_BASE_URL,
  applyPlanOverBridge,
  clearBridgeSessionConfig,
  fetchBridgeDrift,
  loadBridgeSessionConfig,
  parseBridgePairingInput,
  saveBridgeSessionConfig,
  subscribeBridgeEvents,
  syncAllFromBridge,
  verifySliceOverBridge,
  type ArchitectureDriftReport,
  type BridgeConnectionConfig,
} from "../../lib/bridge-client";
import {
  RepoOutcomesSummarySchema,
  type RepoOutcomesSummary,
} from "../../lib/outcome-priors";
import type { PlanningInput } from "../../lib/planner";
import {
  defaultRoutingPreferences,
  formatRoutingSummary,
  quotaModeCatalog,
  subscriptionCatalog,
  type CatalogFreshness,
  type QuotaMode,
  type RoutingPreferences,
  type SubscriptionId,
} from "../../lib/routing-types";
import type { SelfHostedModel } from "../../lib/self-hosted-models";
import {
  pickCrossVendorReviewer,
  type SliceContractSpec,
} from "../../lib/slice-contracts";
import { useAuth } from "../components/auth-provider";
import { HistoryDrawer } from "./history-drawer";
import {
  AssistantAvatar,
  ClarificationWidget,
  ErrorCard,
  PlanArtifactView,
  StreamingSynthesisRow,
  ThinkingRow,
  type LiveSliceVerificationState,
} from "./plan-output";
import styles from "./beta.module.css";

type Provider = PlanningInput["provider"];
type Effort = (typeof betaEfforts)[number]["id"];

const REPO_EXPORT_COMMAND =
  "anvilmark export-context --out repo-context.json" as const;
const MAX_ATTACHMENTS = 4;
const MAX_UNSCALED_IMAGE_BYTES = 1_400_000;
const MAX_DATA_URL_CHARS = 2_000_000;
const ACCEPTED_IMAGE_MIMES = new Set<BetaAttachment["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

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

export interface BetaPromptProps {
  configured: boolean;
  configuredModel?: string | undefined;
  selfHostedModels?: SelfHostedModel[] | undefined;
  serverGemini?: boolean | undefined;
  serverOpenAI?: boolean | undefined;
  catalogFreshness?: CatalogFreshness | undefined;
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read image data."));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read text file."));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("File read failed."));
    reader.readAsText(file);
  });
}

function downscaleDataUrlOnCanvas(
  dataUrl: string,
): Promise<{ dataUrl: string; mimeType: BetaAttachment["mimeType"] } | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      result: { dataUrl: string; mimeType: BetaAttachment["mimeType"] } | null,
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };

    const timer = window.setTimeout(() => finish(null), 1500);
    const img = new Image();
    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        if (!naturalWidth || !naturalHeight) {
          finish(null);
          return;
        }
        const maxSides = [1600, 1280, 960];
        const qualities = [0.84, 0.72, 0.58];
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish(null);
          return;
        }
        for (const maxSide of maxSides) {
          const ratio = Math.min(
            1,
            maxSide / Math.max(naturalWidth, naturalHeight),
          );
          canvas.width = Math.max(1, Math.round(naturalWidth * ratio));
          canvas.height = Math.max(1, Math.round(naturalHeight * ratio));
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          for (const quality of qualities) {
            const candidate = canvas.toDataURL("image/jpeg", quality);
            if (
              candidate.startsWith("data:image/jpeg;base64,") &&
              candidate.length <= MAX_DATA_URL_CHARS
            ) {
              finish({ dataUrl: candidate, mimeType: "image/jpeg" });
              return;
            }
          }
        }
        finish(null);
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = dataUrl;
  });
}

async function prepareBetaAttachments(
  files: readonly File[],
): Promise<BetaAttachment[]> {
  const prepared: BetaAttachment[] = [];
  for (const file of files.slice(0, MAX_ATTACHMENTS)) {
    const mimeType = file.type as BetaAttachment["mimeType"];
    if (!ACCEPTED_IMAGE_MIMES.has(mimeType)) continue;
    try {
      let dataUrl = await readFileAsDataUrl(file);
      let finalMime: BetaAttachment["mimeType"] = mimeType;
      if (
        file.size > MAX_UNSCALED_IMAGE_BYTES ||
        dataUrl.length > MAX_DATA_URL_CHARS
      ) {
        const scaled = await downscaleDataUrlOnCanvas(dataUrl);
        if (scaled) {
          dataUrl = scaled.dataUrl;
          finalMime = scaled.mimeType;
        }
      }
      const parsed = BetaAttachmentSchema.safeParse({
        name: file.name.trim().slice(0, 120) || "image.png",
        mimeType: finalMime,
        dataUrl,
      });
      if (parsed.success) {
        prepared.push(parsed.data);
      }
    } catch {
      // Skip unreadable file cleanly.
    }
  }
  return prepared;
}

function toAssistantEntry(
  id: number,
  turn: BetaTurnResponse,
): Extract<ThreadEntry, { role: "assistant" }> {
  if (turn.mode === "chat") {
    return {
      id,
      role: "assistant",
      mode: "chat",
      reply: turn.reply,
    };
  }
  if (turn.mode === "clarify") {
    return {
      id,
      role: "assistant",
      mode: "clarify",
      reply: turn.reply,
      questions: turn.questions,
    };
  }
  return {
    id,
    role: "assistant",
    mode: "plan",
    reply: turn.reply,
    plan: turn.plan,
    candidates: turn.candidates,
    catalogDate: turn.catalogDate,
    strict: turn.strict,
  };
}

export function BetaPrompt({
  configured,
  configuredModel = "",
  selfHostedModels = [],
  serverGemini = false,
  serverOpenAI = false,
  catalogFreshness,
}: BetaPromptProps) {
  const { user } = useAuth();
  const authUserId = user?.id ?? null;

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
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoContext, setRepoContext] = useState<RepoContextSnapshot | null>(
    null,
  );
  const [repoOutcomes, setRepoOutcomes] = useState<RepoOutcomesSummary | null>(
    null,
  );
  const [driftReport, setDriftReport] =
    useState<ArchitectureDriftReport | null>(null);
  const [bridgeConfig, setBridgeConfig] =
    useState<BridgeConnectionConfig | null>(null);
  const [bridgeRepoName, setBridgeRepoName] = useState<string | null>(null);
  const [bridgeUrlInput, setBridgeUrlInput] = useState<string>(
    DEFAULT_BRIDGE_BASE_URL,
  );
  const [bridgeTokenInput, setBridgeTokenInput] = useState<string>("");
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [sliceVerifications, setSliceVerifications] = useState<
    Record<string, LiveSliceVerificationState>
  >({});
  const [repoError, setRepoError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [savedThreads, setSavedThreads] = useState<SavedBetaThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [entries, setEntries] = useState<ThreadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [coldLoading, setColdLoading] = useState(false);
  const [streamState, setStreamState] = useState<LiveStreamState | null>(null);
  const [turnError, setTurnError] = useState<{
    message: string;
    needsKey: boolean;
    forcePlan: boolean;
  } | null>(null);

  const toolsRef = useRef<HTMLDivElement>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const repoRef = useRef<HTMLDivElement>(null);
  const repoButtonRef = useRef<HTMLButtonElement>(null);
  const repoFileInputRef = useRef<HTMLInputElement>(null);
  const outcomesFileInputRef = useRef<HTMLInputElement>(null);
  const threadScrollRef = useRef<HTMLDivElement>(null);
  const threadBottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const entryIdRef = useRef(0);
  const lastTurnAttachmentsRef = useRef<BetaAttachment[]>([]);

  const toolsMenuId = useId();
  const settingsPanelId = useId();
  const repoPanelId = useId();
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
    setSavedThreads(loadSavedThreads());
    const storedBridge = loadBridgeSessionConfig();
    if (storedBridge) {
      setBridgeUrlInput(storedBridge.baseUrl);
      setBridgeTokenInput(storedBridge.token);
      void syncAllFromBridge(storedBridge)
        .then((snapshot) => {
          setBridgeConfig(storedBridge);
          setBridgeRepoName(snapshot.health.repoName);
          if (snapshot.repoContext) setRepoContext(snapshot.repoContext);
          if (snapshot.outcomes) setRepoOutcomes(snapshot.outcomes);
          if (snapshot.drift) setDriftReport(snapshot.drift);
        })
        .catch(() => {
          // Local bridge daemon not currently running; keep inputs prefilled.
        });
    }
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!bridgeConfig) return;
    const unsubscribe = subscribeBridgeEvents(
      bridgeConfig,
      (event) => {
        if (event.type === "slice_status") {
          setSliceVerifications((current) => ({
            ...current,
            [event.data.sliceId]: {
              status: event.data.status,
              ...(event.data.report ? { report: event.data.report } : {}),
            },
          }));
        } else if (event.type === "drift_updated") {
          setDriftReport(event.data);
        } else if (event.type === "plan_applied") {
          void fetchBridgeDrift(bridgeConfig)
            .then((nextDrift) => setDriftReport(nextDrift))
            .catch(() => {});
        }
      },
      () => {
        // Keep bridge config so user can re-sync if daemon restarts.
      },
    );
    return unsubscribe;
  }, [bridgeConfig]);

  useEffect(() => {
    setRoutingPrefs(loadRoutingPrefsForUser(authUserId));
  }, [authUserId]);

  function persistThread(
    threadId: string,
    nextEntries: readonly ThreadEntry[],
    nextRepoContext: RepoContextSnapshot | null,
  ) {
    if (nextEntries.length === 0) return;
    setSavedThreads((current) =>
      upsertSavedThread(current, {
        id: threadId,
        title: deriveThreadTitle(nextEntries),
        updatedAt: new Date().toISOString(),
        entries: [...nextEntries],
        repoContext: nextRepoContext,
      }),
    );
  }

  function updateRoutingPrefs(next: RoutingPreferences) {
    setRoutingPrefs(next);
    saveRoutingPrefsForUser(next, authUserId);
  }

  function toggleSubscription(subId: SubscriptionId) {
    const exists = routingPrefs.subscriptions.includes(subId);
    const nextSubs = exists
      ? routingPrefs.subscriptions.filter((id) => id !== subId)
      : [...routingPrefs.subscriptions, subId];
    updateRoutingPrefs({
      mode: nextSubs.length > 0 ? "subscriptions" : "open",
      subscriptions: nextSubs,
      quotaMode: routingPrefs.quotaMode ?? "plenty",
    });
  }

  function selectQuotaMode(nextQuotaMode: QuotaMode) {
    updateRoutingPrefs({
      ...routingPrefs,
      quotaMode: nextQuotaMode,
    });
  }

  async function copySnippet(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 2200);
    } catch {
      // Clipboard blocked in restricted browser contexts.
    }
  }

  useEffect(() => {
    if (!settingsOpen && !toolsOpen && !repoOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (settingsOpen && !settingsRef.current?.contains(event.target)) {
        setSettingsOpen(false);
      }
      if (toolsOpen && !toolsRef.current?.contains(event.target)) {
        setToolsOpen(false);
      }
      if (repoOpen && !repoRef.current?.contains(event.target)) {
        setRepoOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [settingsOpen, toolsOpen, repoOpen]);

  useEffect(() => {
    if (!active) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    threadBottomRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "end",
    });
  }, [
    active,
    entries.length,
    busy,
    turnError,
    streamState?.architectReply,
    streamState?.progressSection,
  ]);

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

  async function handleRepoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRepoError(null);
    try {
      const text = await readFileAsText(file);
      const raw: unknown = JSON.parse(text);
      const parsed = RepoContextSnapshotSchema.safeParse(raw);
      if (!parsed.success) {
        setRepoError(
          "Invalid repo context JSON. Generate it with `anvilmark export-context --out repo-context.json`.",
        );
        return;
      }
      setRepoContext(parsed.data);
      setRepoOpen(false);
      if (activeThreadId && entries.length > 0) {
        persistThread(activeThreadId, entries, parsed.data);
      }
    } catch {
      setRepoError(
        "Could not parse JSON file. Select the file produced by `anvilmark export-context`.",
      );
    }
  }

  function clearRepoContext() {
    setRepoContext(null);
    setRepoError(null);
    if (activeThreadId && entries.length > 0) {
      persistThread(activeThreadId, entries, null);
    }
  }

  async function handleOutcomesFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRepoError(null);
    try {
      const text = await readFileAsText(file);
      const raw: unknown = JSON.parse(text);
      const parsed = RepoOutcomesSummarySchema.safeParse(raw);
      if (!parsed.success) {
        setRepoError(
          "Invalid outcomes JSON. Generate it with `anvilmark outcomes --write`.",
        );
        return;
      }
      setRepoOutcomes(parsed.data);
      setRepoOpen(false);
    } catch {
      setRepoError(
        "Could not parse outcomes JSON file. Select `.anvilmark/development/outcomes-summary.json`.",
      );
    }
  }

  async function handleConnectBridge() {
    setRepoError(null);
    const parsed = parseBridgePairingInput(bridgeUrlInput, bridgeTokenInput);
    if (!parsed.ok) {
      setRepoError(parsed.error);
      return;
    }
    setBridgeBusy(true);
    try {
      const snapshot = await syncAllFromBridge(parsed.config);
      setBridgeConfig(parsed.config);
      setBridgeUrlInput(parsed.config.baseUrl);
      setBridgeTokenInput(parsed.config.token);
      setBridgeRepoName(snapshot.health.repoName);
      saveBridgeSessionConfig(parsed.config);
      if (snapshot.repoContext) {
        setRepoContext(snapshot.repoContext);
        if (activeThreadId && entries.length > 0) {
          persistThread(activeThreadId, entries, snapshot.repoContext);
        }
      }
      if (snapshot.outcomes) setRepoOutcomes(snapshot.outcomes);
      if (snapshot.drift) setDriftReport(snapshot.drift);
      setRepoOpen(false);
    } catch (err) {
      setRepoError(
        err instanceof Error
          ? err.message
          : "Could not reach local bridge on loopback.",
      );
    } finally {
      setBridgeBusy(false);
    }
  }

  function handleDisconnectBridge() {
    setBridgeConfig(null);
    setBridgeRepoName(null);
    clearBridgeSessionConfig();
  }

  async function handleRefreshDrift() {
    if (!bridgeConfig) return;
    try {
      const nextDrift = await fetchBridgeDrift(bridgeConfig);
      setDriftReport(nextDrift);
    } catch {
      // Ignore transient refresh failure.
    }
  }

  async function handleApplyOverBridge(bundle: PlanHandoffBundle) {
    if (!bridgeConfig) {
      throw new Error("Local bridge is not connected.");
    }
    const result = await applyPlanOverBridge(bridgeConfig, bundle);
    void fetchBridgeDrift(bridgeConfig)
      .then((nextDrift) => setDriftReport(nextDrift))
      .catch(() => {});
    return result;
  }

  async function handleVerifySlice(sliceId: string) {
    if (!bridgeConfig) return;
    setSliceVerifications((current) => ({
      ...current,
      [sliceId]: { status: "running" },
    }));
    try {
      const report = await verifySliceOverBridge(bridgeConfig, sliceId, true);
      setSliceVerifications((current) => ({
        ...current,
        [sliceId]: {
          status: report.passed ? "passed" : "failed",
          report,
        },
      }));
      void fetchBridgeDrift(bridgeConfig)
        .then((nextDrift) => setDriftReport(nextDrift))
        .catch(() => {});
    } catch (err) {
      setSliceVerifications((current) => ({
        ...current,
        [sliceId]: {
          status: "failed",
          error:
            err instanceof Error
              ? err.message
              : "Could not verify slice over local bridge.",
        },
      }));
    }
  }

  function handleUpdateTaskModel(
    entryId: number,
    taskIndex: number,
    nextModelId: string,
  ) {
    setEntries((current) => {
      let changed = false;
      const updated = current.map((item) => {
        if (
          item.id !== entryId ||
          item.role !== "assistant" ||
          item.mode !== "plan"
        ) {
          return item;
        }
        const targetTask = item.plan.tasks[taskIndex];
        if (!targetTask || targetTask.model === nextModelId) {
          return item;
        }
        changed = true;
        const prunedAlternatives = targetTask.alternatives.filter(
          (alt) => alt.model !== nextModelId,
        );
        const prevCandidate = item.candidates.find(
          (c) => c.model === targetTask.model,
        );
        const nextAlternatives =
          prevCandidate &&
          !prunedAlternatives.some((alt) => alt.model === targetTask.model)
            ? [
                {
                  model: targetTask.model,
                  tradeoff: `Original planner recommendation (${prevCandidate.tier} tier).`,
                },
                ...prunedAlternatives,
              ].slice(0, 2)
            : prunedAlternatives;

        const nextTasks = item.plan.tasks.map((task, idx) => {
          if (idx !== taskIndex) return task;
          const nextReviewer = pickCrossVendorReviewer(
            nextModelId,
            item.candidates,
          );
          const updatedContract = task.contract
            ? {
                ...task.contract,
                ...(nextReviewer ? { reviewerFamily: nextReviewer } : {}),
              }
            : undefined;
          return {
            ...task,
            model: nextModelId,
            alternatives: nextAlternatives,
            ...(updatedContract ? { contract: updatedContract } : {}),
          };
        });
        return {
          ...item,
          plan: {
            ...item.plan,
            tasks: nextTasks,
          },
        };
      });

      if (changed) {
        const threadId = activeThreadId ?? createThreadId();
        if (!activeThreadId) setActiveThreadId(threadId);
        persistThread(threadId, updated, repoContext);
      }
      return updated;
    });
  }

  function handleUpdateTaskContract(
    entryId: number,
    taskIndex: number,
    nextContract: SliceContractSpec,
  ) {
    setEntries((current) => {
      let changed = false;
      const updated = current.map((item) => {
        if (
          item.id !== entryId ||
          item.role !== "assistant" ||
          item.mode !== "plan"
        ) {
          return item;
        }
        const targetTask = item.plan.tasks[taskIndex];
        if (!targetTask) return item;
        changed = true;
        const nextTasks = item.plan.tasks.map((task, idx) =>
          idx === taskIndex ? { ...task, contract: nextContract } : task,
        );
        return {
          ...item,
          plan: {
            ...item.plan,
            tasks: nextTasks,
          },
        };
      });

      if (changed) {
        const threadId = activeThreadId ?? createThreadId();
        if (!activeThreadId) setActiveThreadId(threadId);
        persistThread(threadId, updated, repoContext);
      }
      return updated;
    });
  }

  function handleSwapArchitectureDecision(
    entryId: number,
    decisionIndex: number,
  ) {
    setEntries((current) => {
      let changed = false;
      const updated = current.map((item) => {
        if (
          item.id !== entryId ||
          item.role !== "assistant" ||
          item.mode !== "plan"
        ) {
          return item;
        }
        const choice = item.plan.architecture[decisionIndex];
        if (!choice) return item;
        changed = true;
        const nextArchitecture = item.plan.architecture.map((entry, idx) =>
          idx === decisionIndex
            ? {
                ...entry,
                decision: entry.alternative,
                alternative: entry.decision,
              }
            : entry,
        );
        const existingEdited = new Set(item.editedArchitectureIndices ?? []);
        if (existingEdited.has(decisionIndex)) {
          existingEdited.delete(decisionIndex);
        } else {
          existingEdited.add(decisionIndex);
        }
        return {
          ...item,
          plan: {
            ...item.plan,
            architecture: nextArchitecture,
          },
          editedArchitectureIndices: [...existingEdited].sort((a, b) => a - b),
        };
      });

      if (changed) {
        const threadId = activeThreadId ?? createThreadId();
        if (!activeThreadId) setActiveThreadId(threadId);
        persistThread(threadId, updated, repoContext);
      }
      return updated;
    });
  }

  async function runTurn(params: {
    threadId: string;
    nextEntries: ThreadEntry[];
    provider: Provider;
    modelId: string;
    effort: Effort;
    key: string;
    strict: boolean;
    forcePlan: boolean;
    prefs: RoutingPreferences;
    isCold: boolean;
    attachments: BetaAttachment[];
    repoContextSnapshot: RepoContextSnapshot | null;
    repoOutcomesSnapshot: RepoOutcomesSummary | null;
  }) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    lastTurnAttachmentsRef.current = params.attachments;
    setActiveThreadId(params.threadId);
    setEntries(params.nextEntries);
    persistThread(
      params.threadId,
      params.nextEntries,
      params.repoContextSnapshot,
    );
    setBusy(true);
    setColdLoading(params.isCold);
    setStreamState(null);
    setTurnError(null);

    try {
      const requestBody: Record<string, unknown> = {
        messages: serializeMessages(params.nextEntries),
        effort: params.effort,
        strict: params.strict,
        forcePlan: params.forcePlan,
        provider: params.provider,
        model: params.modelId,
        key: params.key.trim(),
        routingPrefs: params.prefs,
      };
      if (params.attachments.length > 0) {
        requestBody.attachments = params.attachments;
      }
      if (params.repoContextSnapshot) {
        requestBody.repoContext = params.repoContextSnapshot;
      }
      if (params.repoOutcomesSnapshot) {
        requestBody.repoOutcomes = params.repoOutcomesSnapshot;
      }

      const response = await fetch("/api/beta/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody),
      });

      const contentType = (
        response.headers.get("content-type") ?? ""
      ).toLowerCase();

      if (
        response.ok &&
        contentType.includes("text/event-stream") &&
        response.body
      ) {
        let finalTurn: BetaTurnResponse | null = null;
        let streamFailure: { message: string; status: number } | null = null;

        await consumeBetaTurnSse(response.body, (event) => {
          if (event.type === "status") {
            setStreamState((current) => ({
              statusPhase: event.data.phase,
              statusMessage: event.data.message,
              statusModel: event.data.model,
              architectReply: current?.architectReply ?? null,
              progressSection: current?.progressSection ?? null,
              progressChars: current?.progressChars ?? 0,
            }));
          } else if (event.type === "architect_summary") {
            setStreamState((current) => ({
              statusPhase: current?.statusPhase ?? "synthesis",
              statusMessage: current?.statusMessage ?? null,
              statusModel: current?.statusModel ?? null,
              architectReply: event.data.reply,
              progressSection: current?.progressSection ?? "overview",
              progressChars: current?.progressChars ?? 0,
            }));
          } else if (event.type === "progress") {
            setStreamState((current) => ({
              statusPhase: current?.statusPhase ?? "synthesis",
              statusMessage: current?.statusMessage ?? null,
              statusModel: current?.statusModel ?? null,
              architectReply: current?.architectReply ?? null,
              progressSection: event.data.section,
              progressChars: event.data.chars,
            }));
          } else if (event.type === "done") {
            finalTurn = event.data;
          } else if (event.type === "error") {
            streamFailure = {
              message: event.data.error,
              status: event.data.status,
            };
          }
        });

        setStreamState(null);

        if (streamFailure) {
          const err: { message: string; status: number } = streamFailure;
          setTurnError({
            message: err.message,
            needsKey: isKeyError(err.status, err.message),
            forcePlan: params.forcePlan,
          });
          return;
        }

        if (!finalTurn) {
          setTurnError({
            message:
              "The planner stream ended before finishing. Try sending your request again.",
            needsKey: false,
            forcePlan: params.forcePlan,
          });
          return;
        }

        const assistantId = ++entryIdRef.current;
        const newEntry = toAssistantEntry(assistantId, finalTurn);
        const completedEntries = [...params.nextEntries, newEntry];
        setEntries(completedEntries);
        persistThread(
          params.threadId,
          completedEntries,
          params.repoContextSnapshot,
        );

        if (params.provider === "configured") {
          void refreshSelfHostedModels();
        }
        return;
      }

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

      if (!isValidBetaTurnResponse(data)) {
        setTurnError({
          message: "Received an invalid response from the planner.",
          needsKey: false,
          forcePlan: params.forcePlan,
        });
        return;
      }

      const assistantId = ++entryIdRef.current;
      const newEntry = toAssistantEntry(assistantId, data);
      const completedEntries = [...params.nextEntries, newEntry];
      setEntries(completedEntries);
      persistThread(
        params.threadId,
        completedEntries,
        params.repoContextSnapshot,
      );

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
        setStreamState(null);
      }
    }
  }

  function submitUserMessage(
    text: string,
    options: {
      selectedModel?: string;
      effort?: Effort;
      forcePlan?: boolean;
      files?: File[];
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
    setRepoOpen(false);
    setPrompt("");

    const threadId = activeThreadId ?? createThreadId();
    const rawFiles = options.files ?? [];

    const dispatch = (preparedAttachments: BetaAttachment[]) => {
      const storedAttachments: StoredAttachment[] | undefined =
        preparedAttachments.length > 0
          ? preparedAttachments.map((att) => ({
              name: att.name,
              mimeType: att.mimeType,
              dataUrl: att.dataUrl,
            }))
          : undefined;
      const userEntry: ThreadEntry = {
        id: ++entryIdRef.current,
        role: "user",
        content: text,
        ...(storedAttachments ? { attachments: storedAttachments } : {}),
      };

      void runTurn({
        threadId,
        nextEntries: [...entries, userEntry],
        provider: parsed.provider,
        modelId: resolvedModelId,
        effort: chosenEffort,
        key: apiKeys[parsed.provider],
        strict,
        forcePlan: Boolean(options.forcePlan),
        prefs: routingPrefs,
        isCold: Boolean(matchedOss && matchedOss.status !== "loaded"),
        attachments: preparedAttachments,
        repoContextSnapshot: repoContext,
        repoOutcomesSnapshot: repoOutcomes,
      });
    };

    if (rawFiles.length > 0) {
      void prepareBetaAttachments(rawFiles).then(dispatch);
    } else {
      dispatch([]);
    }
  }

  function handleComposerSubmit(
    value: string,
    meta: { model: string; effort: string; attachments: File[] },
  ) {
    submitUserMessage(value, {
      selectedModel: meta.model,
      effort: meta.effort as Effort,
      forcePlan: false,
      files: meta.attachments,
    });
  }

  function handleRetry(overrideKey?: string) {
    if (entries.length === 0) return;
    const matchedOss =
      provider === "configured"
        ? ossModels.find((item) => item.id === activeModelId)
        : undefined;
    const threadId = activeThreadId ?? createThreadId();
    void runTurn({
      threadId,
      nextEntries: entries,
      provider,
      modelId: activeModelId,
      effort: lastEffort,
      key: overrideKey ?? apiKeys[provider],
      strict,
      forcePlan: turnError?.forcePlan ?? false,
      prefs: routingPrefs,
      isCold: Boolean(matchedOss && matchedOss.status !== "loaded"),
      attachments: lastTurnAttachmentsRef.current,
      repoContextSnapshot: repoContext,
      repoOutcomesSnapshot: repoOutcomes,
    });
  }

  function handleReset() {
    abortRef.current?.abort();
    abortRef.current = null;
    lastTurnAttachmentsRef.current = [];
    setBusy(false);
    setColdLoading(false);
    setStreamState(null);
    setActiveThreadId(null);
    setEntries([]);
    setRepoContext(null);
    setRepoError(null);
    setTurnError(null);
    setPrompt("");
  }

  function handleSelectSavedThread(thread: SavedBetaThread) {
    abortRef.current?.abort();
    abortRef.current = null;
    lastTurnAttachmentsRef.current = [];
    setBusy(false);
    setColdLoading(false);
    setStreamState(null);
    setTurnError(null);
    setPrompt("");

    const maxId = thread.entries.reduce(
      (max, entry) => Math.max(max, entry.id),
      entryIdRef.current,
    );
    entryIdRef.current = maxId;

    setActiveThreadId(thread.id);
    setEntries(thread.entries);
    setRepoContext(thread.repoContext ?? null);
    setRepoError(null);
  }

  function handleDeleteSavedThread(threadId: string) {
    setSavedThreads((current) => deleteSavedThread(current, threadId));
    if (activeThreadId === threadId) {
      handleReset();
    }
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
            setRepoOpen(false);
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
            <div className={styles.toolsHeaderRow}>
              <strong>Task model routing</strong>
              {user && (
                <span className={styles.profileSyncBadge}>
                  Synced · {user.name}
                </span>
              )}
            </div>
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
              updateRoutingPrefs({
                mode: "open",
                subscriptions: [],
                quotaMode: routingPrefs.quotaMode ?? "plenty",
              })
            }
          >
            <div>
              <span>Open best-fit (unrestricted)</span>
              <small>
                Routes across latest Arena &amp; catalog leaders for best
                quality / cost
              </small>
            </div>
            <i aria-hidden="true">{routingPrefs.mode === "open" ? "✓" : ""}</i>
          </button>

          <div className={styles.toolsSubheading}>
            My subscriptions &amp; tools
          </div>
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

          <div className={styles.toolsSubheading}>Frontier quota arbitrage</div>
          {quotaModeCatalog.map((qItem) => {
            const activeQuota =
              (routingPrefs.quotaMode ?? "plenty") === qItem.id;
            return (
              <button
                key={qItem.id}
                type="button"
                aria-pressed={activeQuota}
                className={`${styles.toolRow} ${activeQuota ? styles.toolRowActive : ""}`}
                onClick={() => selectQuotaMode(qItem.id)}
              >
                <div>
                  <span>{qItem.label}</span>
                  <small>{qItem.description}</small>
                </div>
                <i aria-hidden="true">{activeQuota ? "✓" : ""}</i>
              </button>
            );
          })}

          {catalogFreshness && (
            <div className={styles.catalogFreshnessBox}>
              <div className={styles.catalogFreshnessTop}>
                <span>
                  Catalog snapshot{" "}
                  <strong>{catalogFreshness.fetchedAt.slice(0, 10)}</strong> ·{" "}
                  {catalogFreshness.sources.length}{" "}
                  {catalogFreshness.sources.length === 1 ? "source" : "sources"}
                </span>
                {catalogFreshness.isStale ? (
                  <span className={styles.staleBadge}>
                    Stale · {catalogFreshness.ageDays}d
                  </span>
                ) : (
                  <span className={styles.freshBadge}>Fresh</span>
                )}
              </div>
              {catalogFreshness.isStale && (
                <div className={styles.catalogRefreshRow}>
                  <code>{catalogFreshness.refreshCommand}</code>
                  <button
                    type="button"
                    className={styles.miniCopyBtn}
                    onClick={() =>
                      void copySnippet(
                        "catalog-refresh",
                        catalogFreshness.refreshCommand,
                      )
                    }
                  >
                    {copiedKey === "catalog-refresh" ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              )}
            </div>
          )}
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
            setRepoOpen(false);
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

      <div
        className={styles.settingsPicker}
        ref={repoRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setRepoOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && repoOpen) {
            setRepoOpen(false);
            repoButtonRef.current?.focus();
          }
        }}
      >
        <button
          type="button"
          ref={repoButtonRef}
          className={`${styles.settingsButton} ${
            bridgeConfig || repoContext || repoOutcomes
              ? styles.repoButtonActive
              : ""
          }`}
          aria-expanded={repoOpen}
          aria-controls={repoPanelId}
          aria-label={
            bridgeConfig
              ? `Local bridge connected: ${bridgeRepoName ?? "repo"}`
              : repoContext
                ? `Repository context attached: ${repoContext.repoName}`
                : "Attach local repository context"
          }
          onClick={() => {
            setRepoOpen((open) => !open);
            setToolsOpen(false);
            setSettingsOpen(false);
            setRepoError(null);
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
            <path d="M2.75 5.25A1.75 1.75 0 0 1 4.5 3.5h3l1.6 1.75h4.4a1.75 1.75 0 0 1 1.75 1.75v6A1.75 1.75 0 0 1 13.5 14.75h-9A1.75 1.75 0 0 1 2.75 13V5.25Z" />
          </svg>
          <span>{bridgeConfig ? "Bridge · Live" : "Repo"}</span>
          {(bridgeConfig || repoContext || repoOutcomes) && (
            <i className={styles.repoDot} aria-hidden="true" />
          )}
        </button>

        <div
          id={repoPanelId}
          className={styles.repoMenu}
          role="group"
          aria-label="Local repository context intake"
          hidden={!repoOpen}
        >
          <div className={styles.toolsMenuHeader}>
            <strong>Local repository &amp; live bridge</strong>
            <p>
              Pair over loopback for live context, 1-click plan apply, slice
              verification, and drift radar—or import offline JSON snapshots.
            </p>
          </div>

          <div className={styles.bridgeBox}>
            <span className={styles.repoStepLabel}>
              Live Local Bridge (zero-copy)
            </span>
            <div className={styles.catalogRefreshRow}>
              <code>{BRIDGE_COMMAND_SNIPPET}</code>
              <button
                type="button"
                className={styles.miniCopyBtn}
                onClick={() =>
                  void copySnippet("bridge-cmd", BRIDGE_COMMAND_SNIPPET)
                }
              >
                {copiedKey === "bridge-cmd" ? "Copied ✓" : "Copy"}
              </button>
            </div>
            {bridgeConfig ? (
              <div className={styles.repoSummaryBox}>
                <div>
                  <strong>
                    Connected · {bridgeRepoName ?? bridgeConfig.baseUrl}
                  </strong>
                  <small>{bridgeConfig.baseUrl} · SSE live</small>
                </div>
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={handleDisconnectBridge}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className={styles.bridgeInputs}>
                <input
                  type="text"
                  aria-label="Local bridge loopback URL"
                  value={bridgeUrlInput}
                  onChange={(e) => setBridgeUrlInput(e.target.value)}
                  placeholder="http://127.0.0.1:4317"
                />
                <input
                  type="password"
                  autoComplete="off"
                  aria-label="Local bridge pairing token"
                  value={bridgeTokenInput}
                  onChange={(e) => setBridgeTokenInput(e.target.value)}
                  placeholder="Paste bridge pairing token…"
                />
                <button
                  type="button"
                  className={styles.primaryAction}
                  disabled={bridgeBusy}
                  onClick={() => void handleConnectBridge()}
                >
                  {bridgeBusy ? "Connecting…" : "Connect & sync repo"}
                </button>
              </div>
            )}
          </div>

          <div className={styles.repoStep}>
            <span className={styles.repoStepLabel}>
              Offline 1. Generate in your repo
            </span>
            <div className={styles.catalogRefreshRow}>
              <code>{REPO_EXPORT_COMMAND}</code>
              <button
                type="button"
                className={styles.miniCopyBtn}
                onClick={() =>
                  void copySnippet("repo-export", REPO_EXPORT_COMMAND)
                }
              >
                {copiedKey === "repo-export" ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>

          <div className={styles.repoStep}>
            <span className={styles.repoStepLabel}>
              Offline 2. Import context or outcomes JSON
            </span>
            <div className={styles.repoImportButtons}>
              <button
                type="button"
                className={styles.ghostAction}
                onClick={() => repoFileInputRef.current?.click()}
              >
                {repoContext
                  ? "Replace repo-context.json"
                  : "Import repo-context.json"}
              </button>
              <button
                type="button"
                className={styles.ghostAction}
                onClick={() => outcomesFileInputRef.current?.click()}
              >
                {repoOutcomes
                  ? `Outcomes (${repoOutcomes.totalRecordedRuns} runs)`
                  : "Import outcomes-summary.json"}
              </button>
            </div>
            <input
              ref={repoFileInputRef}
              type="file"
              accept=".json,application/json"
              aria-label="Import anvilmark repo context JSON"
              hidden
              onChange={handleRepoFileChange}
            />
            <input
              ref={outcomesFileInputRef}
              type="file"
              accept=".json,application/json"
              aria-label="Import anvilmark outcomes summary JSON"
              hidden
              onChange={handleOutcomesFileChange}
            />
          </div>

          {repoError && (
            <p className={styles.repoError} role="alert">
              {repoError}
            </p>
          )}

          {repoContext && (
            <div className={styles.repoSummaryBox}>
              <div>
                <strong>{repoContext.repoName}</strong>
                <small>
                  {repoContext.totalTrackedFiles} files
                  {repoContext.frameworks.length > 0
                    ? ` · ${repoContext.frameworks.slice(0, 3).join(", ")}`
                    : ""}
                </small>
              </div>
              <button
                type="button"
                className={styles.textButton}
                onClick={clearRepoContext}
              >
                Remove
              </button>
            </div>
          )}
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
      {!active && (
        <div className={styles.idleTopBar}>
          <button
            type="button"
            className={styles.historyButton}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(true)}
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
              <path d="M3.25 9a5.75 5.75 0 1 0 1.4-3.75M3.25 3.75v2.75H6" />
              <path d="M9 6.25V9l2 1.25" />
            </svg>
            <span>History</span>
            {savedThreads.length > 0 && (
              <span className={styles.historyCountPill}>
                {savedThreads.length}
              </span>
            )}
          </button>
        </div>
      )}

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
              <div className={styles.sessionActions}>
                <button
                  type="button"
                  className={styles.historyButton}
                  aria-expanded={historyOpen}
                  onClick={() => setHistoryOpen(true)}
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
                    <path d="M3.25 9a5.75 5.75 0 1 0 1.4-3.75M3.25 3.75v2.75H6" />
                    <path d="M9 6.25V9l2 1.25" />
                  </svg>
                  <span>History</span>
                  {savedThreads.length > 0 && (
                    <span className={styles.historyCountPill}>
                      {savedThreads.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className={styles.newChatButton}
                  onClick={handleReset}
                >
                  New chat
                </button>
              </div>
            </header>

            <div className={styles.threadScroll} ref={threadScrollRef}>
              <div className={styles.threadList}>
                {entries.map((entry, idx) => {
                  if (entry.role === "user") {
                    return (
                      <div className={styles.userRow} key={entry.id}>
                        <div className={styles.userBubble}>
                          {entry.attachments &&
                            entry.attachments.length > 0 && (
                              <div
                                className={styles.userAttachmentGrid}
                                aria-label="Attached images"
                              >
                                {entry.attachments.map((att, attIdx) =>
                                  att.dataUrl ? (
                                    <figure
                                      key={`${att.name}-${attIdx}`}
                                      className={styles.userAttachmentItem}
                                    >
                                      <img
                                        src={att.dataUrl}
                                        alt={att.name}
                                        className={styles.userAttachmentThumb}
                                      />
                                      <figcaption>{att.name}</figcaption>
                                    </figure>
                                  ) : (
                                    <span
                                      key={`${att.name}-${attIdx}`}
                                      className={styles.userAttachmentPill}
                                    >
                                      Image: {att.name}
                                    </span>
                                  ),
                                )}
                              </div>
                            )}
                          <div>{entry.content}</div>
                        </div>
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
                            quotaMode={routingPrefs.quotaMode ?? "plenty"}
                            editedArchitectureIndices={
                              entry.editedArchitectureIndices ?? []
                            }
                            driftReport={driftReport}
                            onRefreshDrift={
                              bridgeConfig
                                ? () => void handleRefreshDrift()
                                : undefined
                            }
                            bridgeConnected={Boolean(bridgeConfig)}
                            bridgeRepoName={bridgeRepoName}
                            onApplyOverBridge={
                              bridgeConfig ? handleApplyOverBridge : undefined
                            }
                            sliceVerifications={sliceVerifications}
                            onVerifySlice={
                              bridgeConfig
                                ? (sliceId) => void handleVerifySlice(sliceId)
                                : undefined
                            }
                            onSelectQuestion={(question) => {
                              setPrompt(`Regarding "${question}": `);
                              setFocusTrigger((count) => count + 1);
                            }}
                            onUpdateTaskModel={(taskIndex, nextModel) =>
                              handleUpdateTaskModel(
                                entry.id,
                                taskIndex,
                                nextModel,
                              )
                            }
                            onUpdateTaskContract={(taskIndex, nextContract) =>
                              handleUpdateTaskContract(
                                entry.id,
                                taskIndex,
                                nextContract,
                              )
                            }
                            onSwapArchitectureDecision={(decisionIndex) =>
                              handleSwapArchitectureDecision(
                                entry.id,
                                decisionIndex,
                              )
                            }
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                {busy && streamState?.architectReply ? (
                  <StreamingSynthesisRow
                    architectReply={streamState.architectReply}
                    statusMessage={streamState.statusMessage}
                    statusModel={streamState.statusModel}
                    progressSection={streamState.progressSection}
                    progressChars={streamState.progressChars}
                  />
                ) : busy ? (
                  <ThinkingRow
                    providerLabel={providerLabel}
                    coldLoading={coldLoading}
                    statusMessage={streamState?.statusMessage ?? null}
                    statusModel={streamState?.statusModel ?? null}
                  />
                ) : null}

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
        {(bridgeConfig || repoContext || repoOutcomes) && (
          <div className={styles.repoChipBar}>
            {bridgeConfig && (
              <div className={styles.repoChip} role="status">
                <span>
                  Bridge: {bridgeRepoName ?? bridgeConfig.baseUrl} · Live
                </span>
                <button
                  type="button"
                  className={styles.repoChipClear}
                  aria-label="Disconnect local bridge"
                  onClick={handleDisconnectBridge}
                >
                  ×
                </button>
              </div>
            )}
            {repoContext && (
              <div className={styles.repoChip} role="status">
                <svg
                  aria-hidden="true"
                  width="13"
                  height="13"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.75 5.25A1.75 1.75 0 0 1 4.5 3.5h3l1.6 1.75h4.4a1.75 1.75 0 0 1 1.75 1.75v6A1.75 1.75 0 0 1 13.5 14.75h-9A1.75 1.75 0 0 1 2.75 13V5.25Z" />
                </svg>
                <span>
                  Repo: {repoContext.repoName} · {repoContext.totalTrackedFiles}{" "}
                  files
                </span>
                <button
                  type="button"
                  className={styles.repoChipClear}
                  aria-label="Clear repository context"
                  onClick={clearRepoContext}
                >
                  ×
                </button>
              </div>
            )}
            {repoOutcomes && (
              <div className={styles.repoChip} role="status">
                <span>
                  Outcomes: {repoOutcomes.repoName} ·{" "}
                  {repoOutcomes.totalRecordedRuns} runs
                </span>
                <button
                  type="button"
                  className={styles.repoChipClear}
                  aria-label="Clear repository outcomes"
                  onClick={() => setRepoOutcomes(null)}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

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

      <HistoryDrawer
        open={historyOpen}
        threads={savedThreads}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectSavedThread}
        onNewChat={handleReset}
        onDeleteThread={handleDeleteSavedThread}
        onClose={() => setHistoryOpen(false)}
      />
    </main>
  );
}
