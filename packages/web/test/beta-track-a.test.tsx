// @vitest-environment happy-dom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postBetaTurn } from "../app/api/beta/turn/route";
import { PlanArtifactView } from "../app/beta/plan-output";
import { BetaPrompt } from "../app/beta/prompt";
import { AuthProvider } from "../app/components/auth-provider";
import {
  buildClaudeMdSection,
  buildCodexAgentsSection,
  buildPlanBundle,
  type RepoContextSnapshot,
} from "../lib/beta-turn";
import {
  applyPlanOverBridge,
  parseBridgePairingInput,
  subscribeBridgeEvents,
  syncAllFromBridge,
  verifySliceOverBridge,
  type ArchitectureDriftReport,
} from "../lib/bridge-client";
import {
  applyEmpiricalOutcomePriors,
  type RepoOutcomesSummary,
} from "../lib/outcome-priors";
import type { GeneratedPlan } from "../lib/planner";
import { resolveRoutingPool } from "../lib/routing-catalog";
import {
  SliceContractSchema,
  compileSliceContractForTask,
  inferModelFamily,
  pickCrossVendorReviewer,
  type SliceVerificationReport,
} from "../lib/slice-contracts";

const sampleRepoContext: RepoContextSnapshot = {
  version: "anvilmark.repo-context.v1",
  exportedAt: "2026-11-27T01:00:00.000Z",
  repoName: "anvilmark-monorepo",
  goal: "Upgrade control plane",
  languages: ["TypeScript"],
  frameworks: ["Next.js", "Vitest"],
  packageManager: "pnpm",
  scripts: {
    test: "vitest run",
    typecheck: "tsc --noEmit",
  },
  checkCommands: ["pnpm typecheck", "pnpm test"],
  adrPaths: ["docs/vnext/11-groundbreaking-roadmap-and-work-split.md"],
  sampleFiles: ["packages/web/app/beta/prompt.tsx", "packages/cli/src/cli.ts"],
  totalTrackedFiles: 120,
  hasAnvilmarkDir: true,
  summary: "TypeScript monorepo with web studio and deterministic CLI.",
};

const sampleOutcomes: RepoOutcomesSummary = {
  schemaVersion: "anvilmark.outcomes-summary.v1",
  generatedAt: "2026-11-27T01:30:00.000Z",
  repoName: "anvilmark-monorepo",
  totalRecordedRuns: 18,
  models: [
    {
      model: "qwen3-coder-30b",
      provider: "am-server",
      taskCategory: "backend",
      attempts: 10,
      acceptedFirstPass: 9,
      acceptedAfterRetry: 1,
      rejected: 0,
      meanRetries: 0.1,
      meanReworkRatio: 0.04,
      meanInputTokens: 18000,
      meanOutputTokens: 3200,
      observedUsdPerAccepted: 0,
      lastObservedAt: "2026-11-27T01:20:00.000Z",
    },
    {
      model: "claude-opus-5-5",
      provider: "Anthropic",
      taskCategory: "architecture",
      attempts: 8,
      acceptedFirstPass: 2,
      acceptedAfterRetry: 2,
      rejected: 4,
      meanRetries: 1.8,
      meanReworkRatio: 0.55,
      meanInputTokens: 34000,
      meanOutputTokens: 6100,
      observedUsdPerAccepted: 0.42,
      lastObservedAt: "2026-11-27T01:25:00.000Z",
    },
  ],
};

const sampleDriftReport: ArchitectureDriftReport = {
  schemaVersion: "anvilmark.drift-report.v1",
  scannedAt: "2026-11-27T01:45:00.000Z",
  planTitle: "Billing Service Hardening",
  status: "drifted",
  plannedFlowsCount: 1,
  observedEdgesCount: 4,
  items: [
    {
      severity: "error",
      kind: "boundary_bypass",
      from: "Checkout UI",
      to: "Stripe Secret SDK",
      boundary: "Server-only payment boundary",
      evidencePaths: ["packages/web/app/checkout/direct-stripe.ts"],
      detail:
        "Client bundle imports server payment helper directly without crossing API route.",
    },
  ],
};

const sampleVerificationFailed: SliceVerificationReport = {
  schemaVersion: "anvilmark.slice-verification.v1",
  verifiedAt: "2026-11-27T01:50:00.000Z",
  sliceId: "slice-web-ui",
  passed: false,
  changedFiles: ["packages/web/app/beta/prompt.tsx", ".env.production"],
  violations: [
    {
      kind: "forbidden_file",
      path: ".env.production",
      detail: "Modified forbidden secret path matching .env.*",
    },
  ],
  checkResults: [
    {
      command: "pnpm test",
      exitCode: 0,
      durationMs: 920,
      outputExcerpt: "All tests passed",
    },
  ],
};

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 25));
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

const activeCleanups: Array<() => void> = [];

function mount(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  const rerender = (next: ReactElement) => {
    act(() => {
      root.render(next);
    });
  };
  activeCleanups.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  return { container, rerender };
}

function findButtonByText(
  container: HTMLElement,
  pattern: RegExp,
): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll("button"));
  const found = buttons.find(
    (b) =>
      pattern.test(b.textContent ?? "") ||
      pattern.test(b.getAttribute("aria-label") ?? ""),
  );
  if (!found) {
    throw new Error(`Button matching ${pattern} not found`);
  }
  return found;
}

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    writable: true,
    configurable: true,
    value: createMemoryStorage(),
  });
  Object.defineProperty(window, "sessionStorage", {
    writable: true,
    configurable: true,
    value: createMemoryStorage(),
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  for (const fn of activeCleanups.splice(0)) {
    fn();
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Track A: Executable Slice Contracts, Bayesian Outcome/Quota Router, Local Bridge & Drift Radar", () => {
  it("compiles deterministic SliceContractSpec with safe globs, sanitized check commands, and cross-vendor reviewers", () => {
    const pool = resolveRoutingPool({ mode: "open", subscriptions: [] });
    const contract = compileSliceContractForTask({
      task: {
        id: "slice-web-ui",
        title: "Update packages/web Studio UI without adding dependencies",
        outcome: "Renders Checkout UI flow cleanly inside packages/web.",
        acceptance: ["UI updates live without touching secrets."],
        checks: [
          "pnpm --filter @anvilmark/web test",
          "Review UI manually in browser",
          "pnpm test; rm -rf /",
        ],
        model: "claude-opus-5-5",
      },
      flows: [
        {
          from: "Checkout UI",
          to: "Payments API",
          data: "Tokenized cart",
          boundary: "Authenticated HTTPS API",
        },
      ],
      candidates: pool.candidates,
      repoCheckCommands: ["pnpm typecheck"],
      sampleFiles: sampleRepoContext.sampleFiles,
      strict: true,
    });

    expect(SliceContractSchema.safeParse(contract).success).toBe(true);
    expect(contract.allowedGlobs).toEqual(["packages/web/**"]);
    expect(contract.forbiddenGlobs).toContain(".env");
    expect(contract.forbiddenGlobs).toContain(".github/workflows/**");
    expect(contract.allowDependencyChanges).toBe(false);
    expect(contract.verificationCommands).toEqual([
      "pnpm --filter @anvilmark/web test",
      "pnpm typecheck",
    ]);
    expect(contract.expectedBoundaries).toContain("Authenticated HTTPS API");
    expect(inferModelFamily("claude-opus-5-5", "Anthropic", "api")).toBe(
      "anthropic",
    );
    expect(contract.reviewerFamily).toBeDefined();
    expect(contract.reviewerFamily).not.toBe("anthropic");
    expect(pickCrossVendorReviewer("gpt-6.1-sol", pool.candidates)).not.toBe(
      "openai",
    );
  });

  it("ranks proven repo winners above failing frontier models via Empirical Bayes and enforces quota arbitrage", () => {
    const selfHosted = [
      {
        id: "qwen3-coder-30b",
        label: "Qwen 3 Coder 30B",
        status: "loaded" as const,
      },
      {
        id: "gemma-4-12b",
        label: "Gemma 4 12B",
        status: "unloaded" as const,
      },
    ];

    const openWithOutcomes = resolveRoutingPool(
      { mode: "open", subscriptions: [], quotaMode: "plenty" },
      selfHosted,
      sampleOutcomes,
    );
    const localCoder = openWithOutcomes.candidates.find(
      (c) => c.model === "qwen3-coder-30b",
    );
    const failingOpus = openWithOutcomes.candidates.find(
      (c) => c.model === "claude-opus-5-5",
    );
    expect(localCoder).toBeDefined();
    expect(failingOpus).toBeDefined();
    expect(localCoder!.observedRuns).toBe(10);
    expect(localCoder!.observedFirstPassRate).toBe(0.9);
    expect(localCoder!.empiricalScore!).toBeGreaterThan(
      failingOpus!.empiricalScore!,
    );
    expect(openWithOutcomes.candidates[0]?.model).toBe("qwen3-coder-30b");

    const exhaustedPool = resolveRoutingPool(
      {
        mode: "subscriptions",
        subscriptions: ["claude", "chatgpt"],
        quotaMode: "exhausted",
      },
      selfHosted,
    );
    expect(
      exhaustedPool.candidates.every(
        (c) => c.billing === "local" || c.tier !== "frontier",
      ),
    ).toBe(true);
    expect(exhaustedPool.candidates[0]?.model).toBe("qwen3-coder-30b");

    const conservePool = resolveRoutingPool(
      { mode: "open", subscriptions: [], quotaMode: "conserve" },
      selfHosted,
    );
    const cloudFrontiers = conservePool.candidates.filter(
      (c) => c.tier === "frontier" && c.billing !== "local",
    );
    expect(cloudFrontiers.length).toBeLessThanOrEqual(1);

    const priorOnly = applyEmpiricalOutcomePriors(
      conservePool.candidates,
      null,
    );
    expect(priorOnly.length).toBe(conservePool.candidates.length);
  });

  it("synthesizes SliceContractSpec and honors quotaMode + repoOutcomes inside POST /api/beta/turn", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    const mockLlmPlan = {
      title: "Quota-Safe Local Feature",
      goal: "Ship endpoint with zero frontier quota burn.",
      users: "Internal developers",
      scope: ["Add packages/web endpoint"],
      nonGoals: ["External billing"],
      assumptions: ["SQLite file is writable"],
      questions: [],
      architecture: [
        {
          title: "Loopback validation",
          decision: "Bind strictly to 127.0.0.1.",
          why: "Prevents LAN exposure.",
          alternative: "Bind 0.0.0.0 with firewall.",
          tradeoff: "Requires local browser.",
        },
      ],
      flows: [
        {
          from: "Browser Studio",
          to: "Local Daemon",
          data: "Plan bundle JSON",
          boundary: "Loopback bearer token",
        },
      ],
      tasks: [
        {
          id: "bridge-endpoint",
          title: "Add loopback health route in packages/web",
          outcome: "Returns health payload cleanly.",
          dependsOn: [],
          acceptance: ["Rejects missing token with 401."],
          checks: ["pnpm test"],
          model: "qwen3-coder-30b",
          why: "Proven 90% first-pass on this repo at $0 local OSS cost.",
          alternatives: [
            {
              model: "claude-haiku-5-5",
              tradeoff: "Fast cloud fallback if am-server is busy.",
            },
          ],
          inputTokens: 12000,
          outputTokens: 2400,
          estimateBasis: "Route handler and unit test.",
        },
      ],
      security: [
        {
          risk: "Token leak",
          control: "Timing-safe bearer token check.",
          verification: "Negative 401 unit test.",
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "qwen3-coder-30b", status: { value: "loaded" } },
              { id: "qwen3.5-9b", status: { value: "loaded" } },
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(mockLlmPlan) } }],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost:3000/api/beta/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content:
                "Build a loopback health endpoint in packages/web with bearer token validation.",
            },
          ],
          effort: "medium",
          strict: true,
          forcePlan: true,
          provider: "configured",
          model: "qwen3-coder-30b",
          key: "",
          routingPrefs: {
            mode: "subscriptions",
            subscriptions: ["claude"],
            quotaMode: "exhausted",
          },
          repoContext: sampleRepoContext,
          repoOutcomes: sampleOutcomes,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      mode: string;
      plan: GeneratedPlan;
      candidates: Array<{ model: string; tier: string; billing: string }>;
    };
    expect(data.mode).toBe("plan");
    expect(
      data.candidates.every(
        (c) => c.billing === "local" || c.tier !== "frontier",
      ),
    ).toBe(true);
    const task = data.plan.tasks[0]!;
    expect(task.contract).toBeDefined();
    expect(task.contract?.allowedGlobs).toEqual(["packages/web/**"]);
    expect(task.contract?.reviewerFamily).toBe("anthropic");
  });

  it("enforces strict loopback security in bridge-client and handles sync, apply, verify, and SSE events", async () => {
    expect(
      parseBridgePairingInput(
        "https://evil.example.com:4317",
        "secret-token-1234",
      ).ok,
    ).toBe(false);
    expect(
      parseBridgePairingInput("http://192.168.1.44:4317", "secret-token-1234")
        .ok,
    ).toBe(false);
    expect(parseBridgePairingInput("http://127.0.0.1:4317", "short").ok).toBe(
      false,
    );

    const urlWithQueryToken = parseBridgePairingInput(
      "http://localhost:4317/pair?token=bridge-hex-token-99887766",
    );
    expect(urlWithQueryToken).toEqual({
      ok: true,
      config: {
        baseUrl: "http://localhost:4317",
        token: "bridge-hex-token-99887766",
      },
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        expect(headers.get("X-Anvilmark-Bridge-Token")).toBe(
          "bridge-hex-token-99887766",
        );
        if (url.endsWith("/v1/health")) {
          return new Response(
            JSON.stringify({
              ok: true,
              version: "1",
              repoName: "anvilmark-monorepo",
              hasActivePlan: true,
            }),
          );
        }
        if (url.endsWith("/v1/context")) {
          return new Response(JSON.stringify(sampleRepoContext));
        }
        if (url.endsWith("/v1/outcomes")) {
          return new Response(JSON.stringify(sampleOutcomes));
        }
        if (url.endsWith("/v1/drift")) {
          return new Response(JSON.stringify(sampleDriftReport));
        }
        if (url.endsWith("/v1/verify-slice")) {
          return new Response(JSON.stringify(sampleVerificationFailed));
        }
        return new Response("Not found", { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const conn = {
      baseUrl: "http://127.0.0.1:4317",
      token: "bridge-hex-token-99887766",
    };
    const synced = await syncAllFromBridge(conn);
    expect(synced.health.repoName).toBe("anvilmark-monorepo");
    expect(synced.repoContext?.repoName).toBe("anvilmark-monorepo");
    expect(synced.outcomes?.totalRecordedRuns).toBe(18);
    expect(synced.drift?.status).toBe("drifted");

    const verifyReport = await verifySliceOverBridge(
      conn,
      "slice-web-ui",
      true,
    );
    expect(verifyReport.passed).toBe(false);
    expect(verifyReport.violations[0]?.kind).toBe("forbidden_file");

    const listeners = new Map<string, EventListener>();
    let constructedUrl = "";
    class MockEventSource {
      static CLOSED = 2;
      readyState = 1;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor(url: string) {
        constructedUrl = url;
      }
      addEventListener(type: string, cb: EventListener) {
        listeners.set(type, cb);
      }
    }
    vi.stubGlobal("EventSource", MockEventSource);

    const received: string[] = [];
    const unsubscribe = subscribeBridgeEvents(conn, (ev) => {
      received.push(ev.type);
    });
    expect(constructedUrl).toContain(
      "http://127.0.0.1:4317/v1/events?token=bridge-hex-token-99887766",
    );
    listeners.get("drift_updated")?.(
      new MessageEvent("drift_updated", {
        data: JSON.stringify(sampleDriftReport),
      }),
    );
    expect(received).toEqual(["drift_updated"]);
    unsubscribe();
  });

  it("renders Drift Radar, inline Slice Contract editing, empirical repo badges, and 1-click Bridge Apply & Verify", async () => {
    const pool = resolveRoutingPool(
      { mode: "open", subscriptions: [], quotaMode: "conserve" },
      [
        {
          id: "qwen3-coder-30b",
          label: "Qwen 3 Coder 30B",
          status: "loaded",
        },
      ],
      sampleOutcomes,
    );

    const planWithContract: GeneratedPlan = {
      title: "Billing Service Hardening",
      goal: "Isolate payment secrets behind server route.",
      users: "Checkout customers",
      scope: ["Move Stripe calls to server route"],
      nonGoals: ["Crypto payments"],
      assumptions: [],
      questions: [],
      architecture: [
        {
          title: "Server-only Stripe boundary",
          decision: "Keep secret keys strictly inside server API handlers.",
          why: "Prevents secret leakage to browser bundles.",
          alternative: "Edge proxy",
          tradeoff: "Extra server hop.",
        },
      ],
      flows: [
        {
          from: "Checkout UI",
          to: "Payments Route",
          data: "Checkout intent",
          boundary: "Server-only payment boundary",
        },
      ],
      tasks: [
        {
          id: "slice-web-ui",
          title: "Isolate checkout client component",
          outcome: "Client calls /api/checkout only.",
          dependsOn: [],
          acceptance: ["Zero Stripe secret imports in client."],
          checks: ["pnpm test"],
          model: "qwen3-coder-30b",
          why: "90% first-pass success on this repository.",
          alternatives: [],
          inputTokens: 14000,
          outputTokens: 2500,
          estimateBasis: "Single slice",
          contract: {
            allowedGlobs: ["packages/web/**"],
            forbiddenGlobs: [".env", ".env.*"],
            verificationCommands: ["pnpm test"],
            allowDependencyChanges: false,
            expectedBoundaries: ["Server-only payment boundary"],
            reviewerFamily: "anthropic",
          },
        },
      ],
      security: [],
    };

    let latestEditedContract = planWithContract.tasks[0]!.contract!;
    const onApplySpy = vi.fn(async (bundle) => {
      const applied = await applyPlanOverBridge(
        { baseUrl: "http://127.0.0.1:4317", token: "bridge-token-12345678" },
        bundle,
      );
      return { writtenFiles: applied.writtenFiles };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            applied: true,
            writtenFiles: [
              ".anvilmark/development/active-plan.json",
              "CLAUDE.md",
            ],
          }),
        ),
      ),
    );
    const onVerifySpy = vi.fn();

    const { container, rerender } = mount(
      <PlanArtifactView
        plan={planWithContract}
        candidates={pool.candidates}
        catalogDate="2026-10-27"
        strict={false}
        quotaMode="conserve"
        driftReport={sampleDriftReport}
        bridgeConnected
        bridgeRepoName="anvilmark-monorepo"
        onApplyOverBridge={onApplySpy}
        sliceVerifications={{
          "slice-web-ui": {
            status: "failed",
            report: sampleVerificationFailed,
          },
        }}
        onVerifySlice={onVerifySpy}
        onSelectQuestion={() => {}}
        onUpdateTaskContract={(_idx, next) => {
          latestEditedContract = next;
        }}
      />,
    );

    expect(container.textContent).toContain("Drift radar: 1 finding");
    expect(container.textContent).toContain("Boundary bypass");
    expect(container.textContent).toContain(
      "packages/web/app/checkout/direct-stripe.ts",
    );
    expect(container.textContent).toContain("Proven: 90% 1st-pass (10)");
    expect(container.textContent).toContain("Failed (1)");
    expect(container.textContent).toContain("forbidden_file");

    act(() => {
      findButtonByText(container, /Edit contract/i).click();
    });
    const scopeInput = container.querySelector(
      'input[aria-label*="Allowed scope globs"]',
    ) as HTMLInputElement;
    expect(scopeInput).toBeTruthy();
    act(() => {
      setNativeValue(
        scopeInput,
        "packages/web/app/checkout/**, packages/web/test/**",
      );
    });
    act(() => {
      findButtonByText(container, /Save contract/i).click();
    });

    expect(latestEditedContract.allowedGlobs).toEqual([
      "packages/web/app/checkout/**",
      "packages/web/test/**",
    ]);

    const updatedPlan: GeneratedPlan = {
      ...planWithContract,
      tasks: [
        {
          ...planWithContract.tasks[0]!,
          contract: latestEditedContract,
        },
      ],
    };
    const claudeMd = buildClaudeMdSection(updatedPlan, pool.candidates, false);
    const codexMd = buildCodexAgentsSection(
      updatedPlan,
      pool.candidates,
      false,
    );
    const bundle = buildPlanBundle(
      updatedPlan,
      pool.candidates,
      false,
      "2026-11-27T02:00:00.000Z",
      "conserve",
    );
    expect(claudeMd).toContain("packages/web/app/checkout/**");
    expect(codexMd).toContain("reviewer=anthropic");
    expect(bundle.quotaMode).toBe("conserve");
    expect(bundle.plan.tasks[0]?.contract?.allowedGlobs).toContain(
      "packages/web/app/checkout/**",
    );

    rerender(
      <PlanArtifactView
        plan={updatedPlan}
        candidates={pool.candidates}
        catalogDate="2026-10-27"
        strict={false}
        quotaMode="conserve"
        driftReport={sampleDriftReport}
        bridgeConnected
        bridgeRepoName="anvilmark-monorepo"
        onApplyOverBridge={onApplySpy}
        onVerifySlice={onVerifySpy}
        onSelectQuestion={() => {}}
      />,
    );

    await act(async () => {
      findButtonByText(container, /Apply to anvilmark-monorepo/i).click();
      await flushAsync();
    });
    expect(onApplySpy).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Applied directly over local bridge",
    );

    act(() => {
      findButtonByText(container, /Verify slice/i).click();
    });
    expect(onVerifySpy).toHaveBeenCalledWith("slice-web-ui");
  });

  it("pairs with Local Bridge from BetaPrompt toolbar and switches Frontier Quota Arbitrage modes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/auth/me")) {
          return new Response(JSON.stringify({ user: null }));
        }
        if (url.endsWith("/v1/health")) {
          return new Response(
            JSON.stringify({
              ok: true,
              version: "1",
              repoName: "paired-local-repo",
              hasActivePlan: false,
            }),
          );
        }
        if (url.endsWith("/v1/context")) {
          return new Response(
            JSON.stringify({
              ...sampleRepoContext,
              repoName: "paired-local-repo",
            }),
          );
        }
        if (url.endsWith("/v1/outcomes")) {
          return new Response(
            JSON.stringify({
              ...sampleOutcomes,
              repoName: "paired-local-repo",
            }),
          );
        }
        if (url.endsWith("/v1/drift")) {
          return new Response(JSON.stringify(sampleDriftReport));
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const { container } = mount(
      <AuthProvider>
        <BetaPrompt configured configuredModel="qwen3.5-9b" />
      </AuthProvider>,
    );

    act(() => {
      findButtonByText(container, /Task model routing:/i).click();
    });
    act(() => {
      findButtonByText(container, /Conserve frontier quota/i).click();
    });
    expect(
      findButtonByText(container, /Open best-fit · Conserve/i),
    ).toBeTruthy();

    act(() => {
      findButtonByText(container, /Attach local repository context/i).click();
    });
    const tokenInput = container.querySelector(
      'input[aria-label="Local bridge pairing token"]',
    ) as HTMLInputElement;
    expect(tokenInput).toBeTruthy();
    act(() => {
      setNativeValue(tokenInput, "valid-loopback-token-12345");
    });

    await act(async () => {
      findButtonByText(container, /Connect & sync repo/i).click();
      await flushAsync();
    });

    expect(container.textContent).toContain("Bridge: paired-local-repo · Live");
    expect(container.textContent).toContain("Repo: paired-local-repo");
    expect(container.textContent).toContain(
      "Outcomes: paired-local-repo · 18 runs",
    );
  });
});
