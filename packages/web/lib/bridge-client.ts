import { z } from "zod";

import {
  RepoContextSnapshotSchema,
  type PlanHandoffBundle,
  type RepoContextSnapshot,
} from "./beta-turn";
import {
  RepoOutcomesSummarySchema,
  type RepoOutcomesSummary,
} from "./outcome-priors";
import {
  SliceVerificationReportSchema,
  type SliceVerificationReport,
} from "./slice-contracts";

export const DEFAULT_BRIDGE_BASE_URL = "http://127.0.0.1:4317" as const;
export const BRIDGE_COMMAND_SNIPPET = "anvilmark bridge --port 4317" as const;
export const BRIDGE_SESSION_STORAGE_KEY = "anvilmark.beta.bridge.v1" as const;

export const ArchitectureDriftItemSchema = z.strictObject({
  severity: z.enum(["error", "warning", "info"]),
  kind: z.enum([
    "undeclared_flow",
    "missing_planned_flow",
    "boundary_bypass",
    "unapproved_ai_sdk",
  ]),
  from: z.string().trim().min(1).max(240),
  to: z.string().trim().min(1).max(240),
  boundary: z.string().trim().max(240).optional(),
  evidencePaths: z.array(z.string().trim().max(400)).max(50),
  detail: z.string().trim().min(1).max(2000),
});

export type ArchitectureDriftItem = z.infer<typeof ArchitectureDriftItemSchema>;

export const ArchitectureDriftReportSchema = z.strictObject({
  schemaVersion: z.literal("anvilmark.drift-report.v1"),
  scannedAt: z.string().trim().min(1).max(64),
  planTitle: z.string().trim().max(400),
  status: z.enum(["aligned", "drifted", "no_active_plan"]),
  plannedFlowsCount: z.number().int().nonnegative().max(10_000),
  observedEdgesCount: z.number().int().nonnegative().max(100_000),
  items: z.array(ArchitectureDriftItemSchema).max(200),
});

export type ArchitectureDriftReport = z.infer<
  typeof ArchitectureDriftReportSchema
>;

export const BridgeHealthSchema = z.object({
  ok: z.literal(true),
  version: z.string().trim().min(1).max(32),
  repoName: z.string().trim().min(1).max(240),
  projectDir: z.string().trim().max(1000).optional(),
  hasActivePlan: z.boolean(),
});

export type BridgeHealth = z.infer<typeof BridgeHealthSchema>;

export const BridgeApplyResultSchema = z.object({
  applied: z.literal(true),
  writtenFiles: z.array(z.string().trim().max(500)).max(50),
});

export type BridgeApplyResult = z.infer<typeof BridgeApplyResultSchema>;

export interface BridgeConnectionConfig {
  baseUrl: string;
  token: string;
}

export interface BridgeSyncSnapshot {
  health: BridgeHealth;
  repoContext: RepoContextSnapshot | null;
  outcomes: RepoOutcomesSummary | null;
  drift: ArchitectureDriftReport | null;
}

export type BridgeLiveEvent =
  | {
      type: "slice_status";
      data: {
        sliceId: string;
        status: "queued" | "running" | "passed" | "failed" | "accepted";
        report?: SliceVerificationReport | undefined;
      };
    }
  | {
      type: "plan_applied";
      data: {
        writtenFiles?: string[] | undefined;
      };
    }
  | {
      type: "drift_updated";
      data: ArchitectureDriftReport;
    };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Validates and normalizes a user-entered bridge URL or pairing string.
 * Strictly enforces HTTP loopback (`127.0.0.1`, `localhost`, `[::1]`) so pairing
 * tokens and plan bundles are never sent to external origins.
 */
export function parseBridgePairingInput(
  rawUrlOrPairing: string,
  rawToken = "",
): { ok: true; config: BridgeConnectionConfig } | { ok: false; error: string } {
  const trimmedInput = rawUrlOrPairing.trim() || DEFAULT_BRIDGE_BASE_URL;
  let candidateUrlStr = trimmedInput;

  if (/^:?\d{2,5}$/.test(trimmedInput)) {
    const port = trimmedInput.replace(/^:/, "");
    candidateUrlStr = `http://127.0.0.1:${port}`;
  } else if (
    !/^https?:\/\//i.test(trimmedInput) &&
    /^(127\.0\.0\.1|localhost|\[::1\])(:\d{2,5})?(\/.*)?$/i.test(trimmedInput)
  ) {
    candidateUrlStr = `http://${trimmedInput}`;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidateUrlStr);
  } catch {
    return {
      ok: false,
      error: "Enter a valid loopback bridge URL (e.g. http://127.0.0.1:4317).",
    };
  }

  if (parsedUrl.protocol !== "http:") {
    return {
      ok: false,
      error: "Local bridge URL must use http:// on loopback.",
    };
  }

  if (!LOOPBACK_HOSTS.has(parsedUrl.hostname.toLowerCase())) {
    return {
      ok: false,
      error:
        "Refusing non-loopback bridge host. Only 127.0.0.1 or localhost is permitted.",
    };
  }

  const portNum = parsedUrl.port ? Number(parsedUrl.port) : 80;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return {
      ok: false,
      error: "Bridge port must be between 1 and 65535.",
    };
  }

  const queryToken = parsedUrl.searchParams.get("token")?.trim() ?? "";
  const token = (rawToken.trim() || queryToken).trim();
  if (!token || token.length < 8 || token.length > 256 || /\s/.test(token)) {
    return {
      ok: false,
      error:
        "Paste the pairing token printed by `anvilmark bridge` (8–256 chars).",
    };
  }

  const normalizedOrigin = `${parsedUrl.protocol}//${parsedUrl.host}`;
  return {
    ok: true,
    config: {
      baseUrl: normalizedOrigin,
      token,
    },
  };
}

function assertSafeConnection(config: BridgeConnectionConfig): URL {
  const checked = parseBridgePairingInput(config.baseUrl, config.token);
  if (!checked.ok) {
    throw new Error(checked.error);
  }
  return new URL(checked.config.baseUrl);
}

async function bridgeFetchJson(
  config: BridgeConnectionConfig,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<unknown> {
  const base = assertSafeConnection(config);
  const target = new URL(path, base);
  const timeoutMs = init?.timeoutMs ?? 15_000;

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${config.token}`);
  headers.set("X-Anvilmark-Bridge-Token", config.token);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(target.toString(), {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
    signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Bridge rejected the pairing token. Copy the latest token from your terminal.",
    );
  }

  if (!response.ok) {
    const errPayload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const msg =
      typeof errPayload?.error === "string"
        ? errPayload.error
        : `Bridge request failed with HTTP ${response.status}.`;
    throw new Error(msg);
  }

  return response.json();
}

export async function fetchBridgeHealth(
  config: BridgeConnectionConfig,
): Promise<BridgeHealth> {
  const raw = await bridgeFetchJson(config, "/v1/health", { timeoutMs: 6_000 });
  return BridgeHealthSchema.parse(raw);
}

export async function fetchBridgeRepoContext(
  config: BridgeConnectionConfig,
): Promise<RepoContextSnapshot> {
  const raw = await bridgeFetchJson(config, "/v1/context");
  return RepoContextSnapshotSchema.parse(raw);
}

export async function fetchBridgeOutcomes(
  config: BridgeConnectionConfig,
): Promise<RepoOutcomesSummary> {
  const raw = await bridgeFetchJson(config, "/v1/outcomes");
  return RepoOutcomesSummarySchema.parse(raw);
}

export async function fetchBridgeDrift(
  config: BridgeConnectionConfig,
): Promise<ArchitectureDriftReport> {
  const raw = await bridgeFetchJson(config, "/v1/drift");
  return ArchitectureDriftReportSchema.parse(raw);
}

export async function syncAllFromBridge(
  config: BridgeConnectionConfig,
): Promise<BridgeSyncSnapshot> {
  const health = await fetchBridgeHealth(config);
  const [ctxRes, outcomesRes, driftRes] = await Promise.allSettled([
    fetchBridgeRepoContext(config),
    fetchBridgeOutcomes(config),
    fetchBridgeDrift(config),
  ]);

  return {
    health,
    repoContext: ctxRes.status === "fulfilled" ? ctxRes.value : null,
    outcomes: outcomesRes.status === "fulfilled" ? outcomesRes.value : null,
    drift: driftRes.status === "fulfilled" ? driftRes.value : null,
  };
}

export async function applyPlanOverBridge(
  config: BridgeConnectionConfig,
  bundle: PlanHandoffBundle,
): Promise<BridgeApplyResult> {
  const raw = await bridgeFetchJson(config, "/v1/apply-plan", {
    method: "POST",
    body: JSON.stringify(bundle),
    timeoutMs: 20_000,
  });
  return BridgeApplyResultSchema.parse(raw);
}

export async function verifySliceOverBridge(
  config: BridgeConnectionConfig,
  sliceId: string,
  runChecks = true,
): Promise<SliceVerificationReport> {
  const raw = await bridgeFetchJson(config, "/v1/verify-slice", {
    method: "POST",
    body: JSON.stringify({ sliceId, runChecks }),
    timeoutMs: 120_000,
  });
  return SliceVerificationReportSchema.parse(raw);
}

export function subscribeBridgeEvents(
  config: BridgeConnectionConfig,
  onEvent: (event: BridgeLiveEvent) => void,
  onDisconnect?: () => void,
): () => void {
  if (typeof EventSource === "undefined") {
    return () => {};
  }

  let source: EventSource | null = null;
  try {
    const base = assertSafeConnection(config);
    const eventsUrl = new URL("/v1/events", base);
    eventsUrl.searchParams.set("token", config.token);
    source = new EventSource(eventsUrl.toString());
  } catch {
    return () => {};
  }

  const handleSliceStatus = (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(String(event.data)) as {
        sliceId?: unknown;
        status?: unknown;
        report?: unknown;
      };
      if (typeof parsed.sliceId !== "string") return;
      const validStatuses = new Set([
        "queued",
        "running",
        "passed",
        "failed",
        "accepted",
      ]);
      if (
        typeof parsed.status !== "string" ||
        !validStatuses.has(parsed.status)
      ) {
        return;
      }
      const parsedReport = parsed.report
        ? SliceVerificationReportSchema.safeParse(parsed.report)
        : null;
      onEvent({
        type: "slice_status",
        data: {
          sliceId: parsed.sliceId,
          status: parsed.status as
            "queued" | "running" | "passed" | "failed" | "accepted",
          ...(parsedReport?.success ? { report: parsedReport.data } : {}),
        },
      });
    } catch {
      // Ignore malformed SSE payload.
    }
  };

  const handlePlanApplied = (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(String(event.data)) as {
        writtenFiles?: unknown;
      };
      const writtenFiles = Array.isArray(parsed.writtenFiles)
        ? parsed.writtenFiles.filter((f): f is string => typeof f === "string")
        : undefined;
      onEvent({
        type: "plan_applied",
        data: { ...(writtenFiles ? { writtenFiles } : {}) },
      });
    } catch {
      onEvent({ type: "plan_applied", data: {} });
    }
  };

  const handleDriftUpdated = (event: MessageEvent) => {
    try {
      const parsed = ArchitectureDriftReportSchema.safeParse(
        JSON.parse(String(event.data)),
      );
      if (parsed.success) {
        onEvent({ type: "drift_updated", data: parsed.data });
      }
    } catch {
      // Ignore malformed drift payload.
    }
  };

  source.addEventListener("slice_status", handleSliceStatus as EventListener);
  source.addEventListener("plan_applied", handlePlanApplied as EventListener);
  source.addEventListener("drift_updated", handleDriftUpdated as EventListener);
  source.onerror = () => {
    if (source && source.readyState === EventSource.CLOSED) {
      onDisconnect?.();
    }
  };

  return () => {
    source?.close();
    source = null;
  };
}

export function loadBridgeSessionConfig(
  storage?: Storage,
): BridgeConnectionConfig | null {
  const store =
    storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  if (!store) return null;
  try {
    const raw = store.getItem(BRIDGE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { baseUrl?: unknown; token?: unknown };
    if (
      typeof parsed.baseUrl !== "string" ||
      typeof parsed.token !== "string"
    ) {
      return null;
    }
    const validated = parseBridgePairingInput(parsed.baseUrl, parsed.token);
    return validated.ok ? validated.config : null;
  } catch {
    return null;
  }
}

export function saveBridgeSessionConfig(
  config: BridgeConnectionConfig,
  storage?: Storage,
): void {
  const store =
    storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  if (!store) return;
  try {
    store.setItem(BRIDGE_SESSION_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage block.
  }
}

export function clearBridgeSessionConfig(storage?: Storage): void {
  const store =
    storage ?? (typeof window !== "undefined" ? window.sessionStorage : null);
  if (!store) return;
  try {
    store.removeItem(BRIDGE_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage block.
  }
}
