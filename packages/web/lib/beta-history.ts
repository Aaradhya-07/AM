import type {
  BetaAttachment,
  BetaTurnProgressSection,
  BetaTurnResponse,
  BetaTurnStreamEvent,
  ClarificationQuestionItem,
  RepoContextSnapshot,
} from "./beta-turn";
import { RepoContextSnapshotSchema } from "./beta-turn";
import type { GeneratedPlan } from "./planner";
import {
  defaultRoutingPreferences,
  quotaModes,
  routingPrefsStorageKey,
  subscriptionIds,
  type QuotaMode,
  type RoutableCandidate,
  type RoutingPreferences,
  type SubscriptionId,
} from "./routing-types";

export const BETA_THREADS_STORAGE_KEY = "anvilmark.beta.threads.v1";
export const MAX_SAVED_THREADS = 20;
export const MAX_PERSISTED_IMAGE_CHARS = 100_000;

export interface StoredAttachment {
  name: string;
  mimeType: BetaAttachment["mimeType"];
  dataUrl?: string;
  stripped?: boolean;
}

export type ThreadEntry =
  | {
      id: number;
      role: "user";
      content: string;
      attachments?: StoredAttachment[];
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
      editedArchitectureIndices?: number[];
    };

export interface SavedBetaThread {
  id: string;
  title: string;
  updatedAt: string;
  entries: ThreadEntry[];
  repoContext?: RepoContextSnapshot | null;
}

export interface LiveStreamState {
  statusPhase: "triage" | "synthesis" | null;
  statusMessage: string | null;
  statusModel: string | null;
  architectReply: string | null;
  progressSection: BetaTurnProgressSection | null;
  progressChars: number;
}

export function createThreadId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function deriveThreadTitle(entries: readonly ThreadEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry && entry.role === "assistant" && entry.mode === "plan") {
      const title = entry.plan.title.trim();
      if (title) return title.slice(0, 80);
    }
  }
  const firstUser = entries.find((entry) => entry.role === "user");
  if (firstUser && firstUser.role === "user") {
    const clean = firstUser.content.replace(/\s+/g, " ").trim();
    if (clean) {
      return clean.length > 72 ? `${clean.slice(0, 71)}…` : clean;
    }
  }
  return "Untitled planning thread";
}

export function sanitizeEntriesForStorage(
  entries: readonly ThreadEntry[],
  stripAllImages = false,
): ThreadEntry[] {
  return entries.map((entry) => {
    if (entry.role !== "user" || !entry.attachments?.length) {
      return entry;
    }
    const sanitizedAttachments: StoredAttachment[] = entry.attachments.map(
      (attachment) => {
        if (
          stripAllImages ||
          !attachment.dataUrl ||
          attachment.dataUrl.length > MAX_PERSISTED_IMAGE_CHARS
        ) {
          return {
            name: attachment.name,
            mimeType: attachment.mimeType,
            stripped: true,
          };
        }
        return {
          name: attachment.name,
          mimeType: attachment.mimeType,
          dataUrl: attachment.dataUrl,
        };
      },
    );
    return {
      ...entry,
      attachments: sanitizedAttachments,
    };
  });
}

function getSafeStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    const store = window.localStorage;
    if (
      store &&
      typeof store.getItem === "function" &&
      typeof store.setItem === "function"
    ) {
      return store;
    }
    return null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidThreadEntry(raw: unknown): raw is ThreadEntry {
  if (!isRecord(raw) || typeof raw.id !== "number") return false;
  if (raw.role === "user") {
    return typeof raw.content === "string";
  }
  if (raw.role === "assistant") {
    if (raw.mode === "chat") {
      return typeof raw.reply === "string";
    }
    if (raw.mode === "clarify") {
      return typeof raw.reply === "string" && Array.isArray(raw.questions);
    }
    if (raw.mode === "plan") {
      return (
        typeof raw.reply === "string" &&
        isRecord(raw.plan) &&
        Array.isArray(raw.candidates) &&
        typeof raw.catalogDate === "string" &&
        typeof raw.strict === "boolean"
      );
    }
  }
  return false;
}

function normalizeSavedThread(raw: unknown): SavedBetaThread | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== "string" ||
    !raw.id.trim() ||
    typeof raw.title !== "string" ||
    typeof raw.updatedAt !== "string" ||
    !Array.isArray(raw.entries)
  ) {
    return null;
  }
  const entries = raw.entries.filter(isValidThreadEntry);
  if (entries.length === 0) return null;

  let repoContext: RepoContextSnapshot | null = null;
  if (raw.repoContext !== undefined && raw.repoContext !== null) {
    const parsedRepo = RepoContextSnapshotSchema.safeParse(raw.repoContext);
    if (parsedRepo.success) {
      repoContext = parsedRepo.data;
    }
  }

  return {
    id: raw.id,
    title: raw.title.trim() || deriveThreadTitle(entries),
    updatedAt: raw.updatedAt,
    entries,
    ...(repoContext ? { repoContext } : {}),
  };
}

function sortAndCapThreads(
  threads: readonly SavedBetaThread[],
): SavedBetaThread[] {
  return [...threads]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_SAVED_THREADS);
}

export function loadSavedThreads(storage?: Storage): SavedBetaThread[] {
  const store = getSafeStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(BETA_THREADS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map(normalizeSavedThread)
      .filter((item): item is SavedBetaThread => item !== null);
    return sortAndCapThreads(normalized);
  } catch {
    return [];
  }
}

export function saveThreads(
  threads: readonly SavedBetaThread[],
  storage?: Storage,
): SavedBetaThread[] {
  const prepared = sortAndCapThreads(
    threads.map((thread) => ({
      ...thread,
      entries: sanitizeEntriesForStorage(thread.entries),
    })),
  );
  const store = getSafeStorage(storage);
  if (!store) return prepared;

  try {
    store.setItem(BETA_THREADS_STORAGE_KEY, JSON.stringify(prepared));
    return prepared;
  } catch {
    // Retry with all attachment dataUrls stripped if storage quota is tight.
    const compact = prepared.map((thread) => ({
      ...thread,
      entries: sanitizeEntriesForStorage(thread.entries, true),
    }));
    for (let count = compact.length; count >= 1; count -= 1) {
      try {
        const subset = compact.slice(0, count);
        store.setItem(BETA_THREADS_STORAGE_KEY, JSON.stringify(subset));
        return subset;
      } catch {
        // Keep trimming oldest entries until within quota.
      }
    }
    return prepared;
  }
}

export function upsertSavedThread(
  threads: readonly SavedBetaThread[],
  thread: SavedBetaThread,
  storage?: Storage,
): SavedBetaThread[] {
  const next: SavedBetaThread = {
    ...thread,
    title: thread.title.trim() || deriveThreadTitle(thread.entries),
    entries: sanitizeEntriesForStorage(thread.entries),
  };
  const filtered = threads.filter((item) => item.id !== next.id);
  return saveThreads([next, ...filtered], storage);
}

export function deleteSavedThread(
  threads: readonly SavedBetaThread[],
  threadId: string,
  storage?: Storage,
): SavedBetaThread[] {
  const remaining = threads.filter((item) => item.id !== threadId);
  return saveThreads(remaining, storage);
}

export function routingPrefsKeyForUser(userId?: string | null): string {
  const trimmed = userId?.trim();
  return trimmed
    ? `${routingPrefsStorageKey}.${trimmed}`
    : routingPrefsStorageKey;
}

export function parseStoredRoutingPrefs(
  raw: string | null,
): RoutingPreferences | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      mode?: unknown;
      subscriptions?: unknown;
      quotaMode?: unknown;
    };
    if (parsed.mode !== "open" && parsed.mode !== "subscriptions") return null;
    const validSet = new Set<string>(subscriptionIds);
    const subs = Array.isArray(parsed.subscriptions)
      ? parsed.subscriptions.filter(
          (item): item is SubscriptionId =>
            typeof item === "string" && validSet.has(item),
        )
      : [];
    const validQuotaSet = new Set<string>(quotaModes);
    const quotaMode: QuotaMode | undefined =
      typeof parsed.quotaMode === "string" &&
      validQuotaSet.has(parsed.quotaMode)
        ? (parsed.quotaMode as QuotaMode)
        : undefined;
    return {
      mode: parsed.mode,
      subscriptions: subs,
      ...(quotaMode ? { quotaMode } : {}),
    };
  } catch {
    return null;
  }
}

export function loadRoutingPrefsForUser(
  userId?: string | null,
  storage?: Storage,
): RoutingPreferences {
  const store = getSafeStorage(storage);
  if (!store) return defaultRoutingPreferences;
  try {
    const userKey = routingPrefsKeyForUser(userId);
    const specific = parseStoredRoutingPrefs(store.getItem(userKey));
    if (specific) return specific;
    if (userKey !== routingPrefsStorageKey) {
      const fallback = parseStoredRoutingPrefs(
        store.getItem(routingPrefsStorageKey),
      );
      if (fallback) return fallback;
    }
  } catch {
    // Storage unavailable in restricted browser mode.
  }
  return defaultRoutingPreferences;
}

export function saveRoutingPrefsForUser(
  prefs: RoutingPreferences,
  userId?: string | null,
  storage?: Storage,
): void {
  const store = getSafeStorage(storage);
  if (!store) return;
  try {
    store.setItem(routingPrefsKeyForUser(userId), JSON.stringify(prefs));
  } catch {
    // Ignore storage quota / privacy block.
  }
}

export function isValidBetaTurnResponse(raw: unknown): raw is BetaTurnResponse {
  if (!isRecord(raw)) return false;
  if (raw.mode === "chat") {
    return typeof raw.reply === "string";
  }
  if (raw.mode === "clarify") {
    return typeof raw.reply === "string" && Array.isArray(raw.questions);
  }
  if (raw.mode === "plan") {
    return (
      typeof raw.reply === "string" &&
      isRecord(raw.plan) &&
      Array.isArray(raw.candidates) &&
      typeof raw.catalogDate === "string" &&
      typeof raw.strict === "boolean"
    );
  }
  return false;
}

function parseSseEventFrame(
  eventName: string,
  payloadText: string,
): BetaTurnStreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  if (
    eventName === "status" &&
    (parsed.phase === "triage" || parsed.phase === "synthesis") &&
    typeof parsed.message === "string" &&
    typeof parsed.model === "string"
  ) {
    return {
      type: "status",
      data: {
        phase: parsed.phase,
        message: parsed.message,
        model: parsed.model,
      },
    };
  }

  if (
    eventName === "architect_summary" &&
    typeof parsed.reply === "string" &&
    typeof parsed.elevatedBrief === "string"
  ) {
    return {
      type: "architect_summary",
      data: {
        reply: parsed.reply,
        elevatedBrief: parsed.elevatedBrief,
      },
    };
  }

  if (
    eventName === "progress" &&
    typeof parsed.chars === "number" &&
    (parsed.section === "overview" ||
      parsed.section === "architecture" ||
      parsed.section === "flows" ||
      parsed.section === "tasks" ||
      parsed.section === "security")
  ) {
    return {
      type: "progress",
      data: {
        chars: parsed.chars,
        section: parsed.section,
      },
    };
  }

  if (eventName === "done" && isValidBetaTurnResponse(parsed)) {
    return { type: "done", data: parsed };
  }

  if (
    eventName === "error" &&
    typeof parsed.error === "string" &&
    typeof parsed.status === "number"
  ) {
    return {
      type: "error",
      data: { error: parsed.error, status: parsed.status },
    };
  }

  return null;
}

/**
 * Reads an SSE Response stream across arbitrary chunk boundaries and invokes
 * `onEvent` for each parsed `BetaTurnStreamEvent`.
 */
export async function consumeBetaTurnSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: BetaTurnStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let currentEvent = "";
  let dataLines: string[] = [];

  const flushFrame = () => {
    if (dataLines.length === 0) {
      currentEvent = "";
      return;
    }
    const payloadText = dataLines.join("\n");
    const eventName = currentEvent || "message";
    currentEvent = "";
    dataLines = [];
    const parsed = parseSseEventFrame(eventName, payloadText);
    if (parsed) {
      onEvent(parsed);
    }
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      flushFrame();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    const colonIdx = line.indexOf(":");
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      currentEvent = value.trim();
    } else if (field === "data") {
      dataLines.push(value);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      let newlineIdx = lineBuffer.indexOf("\n");
      while (newlineIdx !== -1) {
        const line = lineBuffer.slice(0, newlineIdx);
        lineBuffer = lineBuffer.slice(newlineIdx + 1);
        processLine(line);
        newlineIdx = lineBuffer.indexOf("\n");
      }
    }
    lineBuffer += decoder.decode();
    if (lineBuffer.length > 0) {
      const trailingLines = lineBuffer.split("\n");
      for (const line of trailingLines) {
        processLine(line);
      }
    }
    flushFrame();
  } finally {
    reader.releaseLock();
  }
}
