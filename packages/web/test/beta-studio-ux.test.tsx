// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalHandoffStudio } from "../app/beta/handoff-studio";
import { BetaPrompt } from "../app/beta/prompt";
import {
  BETA_THREADS_STORAGE_KEY,
  MAX_PERSISTED_IMAGE_CHARS,
  MAX_SAVED_THREADS,
  loadRoutingPrefsForUser,
  loadSavedThreads,
  saveRoutingPrefsForUser,
  upsertSavedThread,
  type SavedBetaThread,
} from "../lib/beta-history";
import type { RepoContextSnapshot } from "../lib/beta-turn";
import type { GeneratedPlan } from "../lib/planner";
import {
  catalogRefreshCommand,
  type CatalogFreshness,
  type RoutableCandidate,
} from "../lib/routing-types";

const sampleCandidates: RoutableCandidate[] = [
  {
    model: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "Anthropic",
    tier: "frontier",
    billing: "api",
    inputUsdPerMillion: 4,
    outputUsdPerMillion: 20,
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    arenaAgentRank: 1,
    arenaCodingScore: 1550,
    catalogDate: "2026-10-27",
    strengths: "Top frontier model for tricky invariants and security reviews.",
  },
  {
    model: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "Anthropic",
    tier: "balanced",
    billing: "api",
    inputUsdPerMillion: 2,
    outputUsdPerMillion: 10,
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
    arenaAgentRank: 2,
    arenaCodingScore: 1510,
    catalogDate: "2026-10-27",
    strengths: "Strong multi-file coding workhorse.",
  },
  {
    model: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    provider: "Anthropic",
    tier: "fast",
    billing: "api",
    inputUsdPerMillion: 0.1,
    outputUsdPerMillion: 0.5,
    sourceUrl: "https://platform.claude.com/docs/en/models/haiku-5-5/overview",
    arenaAgentRank: null,
    arenaCodingScore: null,
    catalogDate: "2026-10-27",
    strengths: "Fast low-cost tier for bounded schemas and tests.",
  },
];

const samplePlan: GeneratedPlan = {
  title: "Safe CSV Importer",
  goal: "Make repeat CSV imports idempotent with previewable column mapping.",
  users: "Inventory managers",
  scope: ["Column mapping preview", "Idempotent external ID upsert"],
  nonGoals: ["Bulk image uploads"],
  assumptions: ["Rows carry a stable SKU or external ID."],
  questions: ["Should invalid rows block the whole import or be skipped?"],
  architecture: [
    {
      title: "Scoped uniqueness index",
      decision: "Enforce (workspace_id, external_id) uniqueness in Postgres.",
      why: "Prevents duplicate rows across concurrent retries.",
      alternative: "In-memory deduplication before insert.",
      tradeoff: "In-memory checks race under concurrent uploads.",
    },
  ],
  flows: [
    {
      from: "Browser upload",
      to: "Import API",
      data: "Validated CSV rows",
      boundary: "Workspace-scoped server validation",
    },
  ],
  tasks: [
    {
      id: "schema-constraint",
      title: "Add scoped uniqueness constraint",
      outcome: "Database rejects duplicate imports per workspace.",
      dependsOn: [],
      acceptance: ["Re-uploading the same CSV keeps row count unchanged."],
      checks: ["pnpm test"],
      model: "claude-haiku-5-5",
      why: "Well-bounded schema and repository change.",
      alternatives: [
        {
          model: "claude-sonnet-5-5",
          tradeoff: "Useful if legacy duplicate cleanup is complex.",
        },
      ],
      inputTokens: 50_000,
      outputTokens: 10_000,
      estimateBasis: "Importer module, migration file, and test suite.",
    },
    {
      id: "import-endpoint",
      title: "Implement transactional upsert API",
      outcome: "Server validates rows and performs atomic upsert.",
      dependsOn: ["schema-constraint"],
      acceptance: ["Invalid rows return 400 with per-row error details."],
      checks: ["pnpm test"],
      model: "claude-sonnet-5-5",
      why: "Multi-file API and validation wiring.",
      alternatives: [
        {
          model: "claude-opus-5-5",
          tradeoff: "Higher-cost frontier model for subtle concurrency races.",
        },
      ],
      inputTokens: 40_000,
      outputTokens: 8_000,
      estimateBasis: "API route, parser, and integration tests.",
    },
  ],
  security: [],
};

const sampleRepoContext: RepoContextSnapshot = {
  version: "anvilmark.repo-context.v1",
  exportedAt: "2026-11-26T10:00:00.000Z",
  repoName: "acme-inventory",
  goal: "Add idempotent CSV import",
  languages: ["TypeScript", "SQL"],
  frameworks: ["Next.js", "Vitest", "Drizzle ORM"],
  packageManager: "pnpm",
  scripts: {
    test: "vitest run",
    typecheck: "tsc --noEmit",
  },
  checkCommands: ["pnpm typecheck", "pnpm test"],
  adrPaths: ["docs/adr/0001-tenancy.md"],
  sampleFiles: ["src/app/api/imports/route.ts", "src/db/schema.ts"],
  totalTrackedFiles: 48,
  hasAnvilmarkDir: true,
  summary: "Next.js inventory app using Drizzle ORM and Vitest.",
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

function attachFilesToInput(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function flushMicrotasks(ticks = 6) {
  for (let i = 0; i < ticks; i += 1) {
    await Promise.resolve();
  }
}

async function flushAsync() {
  await new Promise((resolve) => setTimeout(resolve, 25));
  await flushMicrotasks();
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
      return [...map.keys()][index] ?? null;
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
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: createMemoryStorage(),
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
  } else {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  } else {
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Wave 2 Studio UX upgrades", () => {
  it("consumes live SSE stream (architect_summary -> progress -> done) across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/plan/models") {
        return Promise.resolve(
          new Response(JSON.stringify({ configured: true, models: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <BetaPrompt
          configured
          selfHostedModels={[
            { id: "qwen3.5-9b", label: "Qwen 3.5 9B", status: "loaded" },
          ]}
        />,
      );
    });

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      setNativeValue(textarea, "Design an idempotent CSV importer.");
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    // Verify Accept header asks for SSE + JSON fallback.
    const turnCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/beta/turn",
    ) as [string, RequestInit];
    expect(turnCall).toBeTruthy();
    expect((turnCall[1].headers as Record<string, string>).Accept).toContain(
      "text/event-stream",
    );

    // 1. Emit architect_summary split across two arbitrary chunks before Stage 2 completes.
    const summaryFrame = `event: architect_summary\ndata: ${JSON.stringify({
      reply:
        "I tightened your brief around workspace-scoped uniqueness and atomic retry semantics.",
      elevatedBrief: "Elevated engineering spec for CSV importer",
    })}\n\n`;
    const splitAt = Math.floor(summaryFrame.length / 2);

    await act(async () => {
      streamController.enqueue(encoder.encode(summaryFrame.slice(0, splitAt)));
      await flushMicrotasks();
      streamController.enqueue(encoder.encode(summaryFrame.slice(splitAt)));
      await flushMicrotasks();
    });

    // Architect prose is rendered immediately mid-stream before `done`!
    expect(host.textContent).toContain(
      "I tightened your brief around workspace-scoped uniqueness",
    );
    expect(host.querySelector('[data-streaming="true"]')).toBeTruthy();

    // 2. Emit synthesis status + progress update.
    await act(async () => {
      streamController.enqueue(
        encoder.encode(
          `event: status\ndata: ${JSON.stringify({
            phase: "synthesis",
            message:
              "Synthesizing architecture decisions, slices, and model routing...",
            model: "qwen3.5-9b",
          })}\n\nevent: progress\ndata: ${JSON.stringify({
            chars: 1420,
            section: "tasks",
          })}\n\n`,
        ),
      );
      await flushMicrotasks();
    });

    expect(host.textContent).toContain("1,420 chars");
    expect(host.textContent).toContain("Task slices");
    const activeStagePill = host.querySelector(
      '[data-stage="tasks"][data-state="active"]',
    );
    expect(activeStagePill).toBeTruthy();
    expect(
      host.querySelector('[data-stage="architecture"][data-state="done"]'),
    ).toBeTruthy();

    // 3. Emit `done` and close stream.
    await act(async () => {
      streamController.enqueue(
        encoder.encode(
          `event: done\ndata: ${JSON.stringify({
            mode: "plan",
            reply:
              "I tightened your brief around workspace-scoped uniqueness and atomic retry semantics.",
            plan: samplePlan,
            candidates: sampleCandidates,
            catalogDate: "2026-10-27",
            strict: false,
            request: { idea: "CSV importer", context: "" },
          })}\n\n`,
        ),
      );
      streamController.close();
      await flushMicrotasks();
    });

    expect(host.querySelector('[data-streaming="true"]')).toBeNull();
    expect(host.textContent).toContain("Safe CSV Importer");
    // Visual FlowGraph renders nodes, data payload, and trust boundary.
    expect(
      host.querySelector(
        '[aria-label="Data flows and trust boundaries diagram"]',
      ),
    ).toBeTruthy();
    expect(host.textContent).toContain("Browser upload");
    expect(host.textContent).toContain("Import API");
    expect(host.textContent).toContain("Workspace-scoped server validation");

    await act(async () => root.unmount());
  });

  it("supports in-place task model switching and architecture decision swaps with live cost & handoff updates", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/plan/models") {
        return Promise.resolve(
          new Response(JSON.stringify({ configured: true, models: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            mode: "plan",
            reply: "Plan ready.",
            plan: samplePlan,
            candidates: sampleCandidates,
            catalogDate: "2026-10-27",
            strict: false,
            request: { idea: "CSV importer", context: "" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <BetaPrompt
          configured
          selfHostedModels={[
            { id: "qwen3.5-9b", label: "Qwen 3.5 9B", status: "loaded" },
          ]}
        />,
      );
    });

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      setNativeValue(textarea, "Build a safe CSV importer.");
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    const turnCallsBeforeEdit = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/beta/turn",
    ).length;
    expect(turnCallsBeforeEdit).toBe(1);

    // Initial routed cost:
    // Task 1 (haiku $0.1/$0.5): 50k*0.1 + 10k*0.5 = $0.0100
    // Task 2 (sonnet $2/$10): 40k*2 + 8k*10 = $0.1600 -> total $0.1700
    expect(host.textContent).toContain("$0.1700");

    // Switch Task 1 model from claude-haiku-5-5 -> claude-sonnet-5-5 (which was in alternatives!)
    // first, to ensure alternatives pruning removes duplicates, then to claude-opus-5-5.
    const select = host.querySelector(
      'select[aria-label="Model for Add scoped uniqueness constraint"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("claude-haiku-5-5");

    await act(async () => {
      setNativeValue(select, "claude-sonnet-5-5");
    });
    const afterSonnetMaster = host.querySelector("pre code")?.textContent ?? "";
    expect(afterSonnetMaster).toContain(
      "Recommended model:** `claude-sonnet-5-5` (Claude Sonnet 5.5)",
    );
    expect(afterSonnetMaster).toContain(
      "Fallback models:** `claude-haiku-5-5`",
    );
    expect(afterSonnetMaster).not.toContain(
      "Fallback models:** `claude-sonnet-5-5`",
    );

    // Switch Task 1 model to claude-opus-5-5 ($4/$20 -> $0.4000, new total $0.5600)
    await act(async () => {
      setNativeValue(select, "claude-opus-5-5");
    });

    // Zero additional LLM round-trips!
    expect(
      fetchMock.mock.calls.filter((call) => call[0] === "/api/beta/turn")
        .length,
    ).toBe(1);

    // Cost banner updates immediately ($0.4000 + $0.1600 = $0.5600)
    expect(host.textContent).toContain("$0.5600");

    // Master prompt in Handoff Studio updates live to claude-opus-5-5
    const codePreview = host.querySelector("pre code")?.textContent ?? "";
    expect(codePreview).toContain(
      "Recommended model:** `claude-opus-5-5` (Claude Opus 5.5)",
    );

    // Swap architecture decision with alternative in place
    const swapBtn = Array.from(host.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("Swap with alternative"),
    )!;
    expect(swapBtn).toBeTruthy();

    await act(async () => {
      swapBtn.click();
    });

    expect(host.textContent).toContain("Edited");
    const updatedMasterCode = host.querySelector("pre code")?.textContent ?? "";
    expect(updatedMasterCode).toContain(
      "- **Decision:** In-memory deduplication before insert.",
    );
    expect(updatedMasterCode).toContain(
      "- **Rejected alternative:** Enforce (workspace_id, external_id) uniqueness in Postgres.",
    );

    // Verify edits were persisted into localStorage history immediately
    const saved = loadSavedThreads();
    expect(saved.length).toBe(1);
    const savedPlanEntry = saved[0]?.entries.find(
      (entry) => entry.role === "assistant" && entry.mode === "plan",
    );
    expect(
      savedPlanEntry &&
        savedPlanEntry.role === "assistant" &&
        savedPlanEntry.mode === "plan" &&
        savedPlanEntry.plan.tasks[0]?.model,
    ).toBe("claude-opus-5-5");

    await act(async () => root.unmount());
  });

  it("imports RepoContextSnapshot chip, attaches images cleanly, and passes both in /api/beta/turn", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "chat",
          reply: "Got your repository context and screenshot.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <BetaPrompt
          configured
          selfHostedModels={[
            { id: "qwen3.5-9b", label: "Qwen 3.5 9B", status: "loaded" },
          ]}
        />,
      );
    });

    // Open Repo popover and verify export command is shown
    const repoButton = Array.from(host.querySelectorAll("button")).find(
      (btn) => btn.textContent?.trim() === "Repo",
    )!;
    await act(async () => {
      repoButton.click();
    });
    expect(host.textContent).toContain(
      "anvilmark export-context --out repo-context.json",
    );

    // Reject invalid repo context JSON cleanly
    const repoInput = host.querySelector(
      'input[aria-label="Import anvilmark repo context JSON"]',
    ) as HTMLInputElement;
    expect(repoInput).toBeTruthy();
    const badRepoFile = new File(
      [JSON.stringify({ version: "wrong.v0", repoName: "bad" })],
      "bad-context.json",
      { type: "application/json" },
    );
    await act(async () => {
      attachFilesToInput(repoInput, [badRepoFile]);
      await flushAsync();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Invalid repo context JSON",
    );

    // Import valid repo-context.json
    const repoFile = new File(
      [JSON.stringify(sampleRepoContext)],
      "repo-context.json",
      { type: "application/json" },
    );

    await act(async () => {
      attachFilesToInput(repoInput, [repoFile]);
      await flushAsync();
    });

    expect(host.textContent).toContain("Repo: acme-inventory · 48 files");

    // Attach a small PNG image to PromptInput
    const imageInput = host.querySelector(
      'input[accept="image/png,image/jpeg,image/webp,image/gif"]',
    ) as HTMLInputElement;
    expect(imageInput).toBeTruthy();
    const tinyPngBytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const imgFile = new File([tinyPngBytes], "wireframe.png", {
      type: "image/png",
    });

    await act(async () => {
      attachFilesToInput(imageInput, [imgFile]);
      await flushAsync();
    });

    // Preview shows before submit
    expect(host.querySelector('ul[aria-label="Image previews"]')).toBeTruthy();

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      setNativeValue(textarea, "Review this wireframe against our repo.");
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await flushAsync();
    });

    // PromptInput attachments cleared after submit!
    expect(host.querySelector('ul[aria-label="Image previews"]')).toBeNull();

    // User bubble shows compact thumbnail
    const bubbleImg = host.querySelector(
      '[aria-label="Attached images"] img',
    ) as HTMLImageElement | null;
    expect(bubbleImg).toBeTruthy();
    expect(bubbleImg?.getAttribute("alt")).toBe("wireframe.png");

    // Fetch payload contains BOTH repoContext and attachments
    const turnCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/beta/turn",
    ) as [string, RequestInit];
    expect(turnCall).toBeTruthy();
    const payload = JSON.parse(String(turnCall[1].body));
    expect(payload.repoContext.repoName).toBe("acme-inventory");
    expect(payload.repoContext.totalTrackedFiles).toBe(48);
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].name).toBe("wireframe.png");
    expect(payload.attachments[0].mimeType).toBe("image/png");
    expect(payload.attachments[0].dataUrl).toMatch(/^data:image\/png;base64,/);

    // Submit a second turn while repoContext is still attached -> must pass repoContext again
    await act(async () => {
      setNativeValue(textarea, "Follow-up: also check migration scripts.");
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await flushAsync();
    });
    const turnCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/beta/turn",
    ) as Array<[string, RequestInit]>;
    expect(turnCalls).toHaveLength(2);
    const secondPayload = JSON.parse(String(turnCalls[1]![1].body));
    expect(secondPayload.repoContext.repoName).toBe("acme-inventory");
    expect(secondPayload.attachments).toBeUndefined();

    // Clear repo context chip via × button
    const clearRepoBtn = host.querySelector(
      'button[aria-label="Clear repository context"]',
    ) as HTMLButtonElement;
    await act(async () => {
      clearRepoBtn.click();
    });
    expect(host.textContent).not.toContain("Repo: acme-inventory · 48 files");

    await act(async () => root.unmount());
  });

  it("persists saved threads, restores from HistoryDrawer, strips oversized images, and shows catalog freshness", async () => {
    const oversizedDataUrl = `data:image/png;base64,${"A".repeat(
      MAX_PERSISTED_IMAGE_CHARS + 500,
    )}`;
    const seededThread: SavedBetaThread = {
      id: "saved-thread-1",
      title: "Safe CSV Importer",
      updatedAt: new Date().toISOString(),
      repoContext: sampleRepoContext,
      entries: [
        {
          id: 1,
          role: "user",
          content: "Plan CSV importer",
          attachments: [
            {
              name: "huge-diagram.png",
              mimeType: "image/png",
              dataUrl: oversizedDataUrl,
            },
          ],
        },
        {
          id: 2,
          role: "assistant",
          mode: "plan",
          reply: "Restored CSV importer blueprint.",
          plan: samplePlan,
          candidates: sampleCandidates,
          catalogDate: "2026-10-27",
          strict: false,
        },
      ],
    };

    const stored = upsertSavedThread([], seededThread);
    expect(stored).toHaveLength(1);
    // Oversized dataUrl > 100KB was stripped in localStorage!
    const rawStored = window.localStorage.getItem(BETA_THREADS_STORAGE_KEY)!;
    expect(rawStored).not.toContain(oversizedDataUrl);
    const reloaded = loadSavedThreads();
    const firstEntry = reloaded[0]?.entries[0];
    expect(
      firstEntry &&
        firstEntry.role === "user" &&
        firstEntry.attachments?.[0]?.stripped,
    ).toBe(true);

    // Cap enforcement test: > MAX_SAVED_THREADS trims cleanly to MAX_SAVED_THREADS
    let many = reloaded;
    for (let i = 2; i <= MAX_SAVED_THREADS + 4; i += 1) {
      many = upsertSavedThread(many, {
        ...seededThread,
        id: `thread-${i}`,
        title: `Plan #${i}`,
        updatedAt: new Date(Date.now() - i * 1000).toISOString(),
      });
    }
    expect(many).toHaveLength(MAX_SAVED_THREADS);

    // Restore thread from idle HistoryDrawer + check stale catalog freshness in routing menu
    window.localStorage.clear();
    upsertSavedThread([], seededThread);

    const staleFreshness: CatalogFreshness = {
      fetchedAt: "2026-10-01T00:00:00.000Z",
      ageDays: 26,
      isStale: true,
      sources: [
        { id: "anthropic", fetchedAt: "2026-10-01T00:00:00.000Z" },
        { id: "openai", fetchedAt: "2026-10-01T00:00:00.000Z" },
      ],
      refreshCommand: catalogRefreshCommand,
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <BetaPrompt
          configured
          catalogFreshness={staleFreshness}
          selfHostedModels={[
            { id: "qwen3.5-9b", label: "Qwen 3.5 9B", status: "loaded" },
          ]}
        />,
      );
    });

    // Check catalog freshness in Task model routing popover
    const routingBtn = host.querySelector(
      'button[aria-label^="Task model routing:"]',
    ) as HTMLButtonElement;
    await act(async () => {
      routingBtn.click();
    });
    expect(host.textContent).toContain("2026-10-01");
    expect(host.textContent).toContain("2 sources");
    expect(host.textContent).toContain("Stale · 26d");
    expect(host.textContent).toContain(catalogRefreshCommand);

    // Open History drawer from idle stage and restore saved thread
    const historyBtn = Array.from(host.querySelectorAll("button")).find((btn) =>
      btn.textContent?.includes("History"),
    )!;
    await act(async () => {
      historyBtn.click();
    });

    const drawer = host.querySelector(
      '[role="dialog"][aria-label="Saved planning threads"]',
    );
    expect(drawer).toBeTruthy();
    expect(drawer?.textContent).toContain("Safe CSV Importer");

    const restoreBtn = Array.from(drawer!.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("Safe CSV Importer"),
    )!;
    await act(async () => {
      restoreBtn.click();
    });

    expect(host.textContent).toContain("Restored CSV importer blueprint.");
    expect(host.textContent).toContain("Repo: acme-inventory · 48 files");
    expect(host.textContent).toContain("Image: huge-diagram.png");

    // Re-open History drawer from active sessionHeader and delete thread
    const activeHistoryBtn = Array.from(host.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("History"),
    )!;
    await act(async () => {
      activeHistoryBtn.click();
    });
    const deleteBtn = host.querySelector(
      'button[aria-label="Delete thread Safe CSV Importer"]',
    ) as HTMLButtonElement;
    await act(async () => {
      deleteBtn.click();
    });
    expect(loadSavedThreads()).toHaveLength(0);

    await act(async () => root.unmount());
  });

  it("namespaces routing preferences per user ID while preserving anonymous fallback", () => {
    saveRoutingPrefsForUser(
      { mode: "subscriptions", subscriptions: ["claude"] },
      null,
    );
    expect(loadRoutingPrefsForUser(null)).toEqual({
      mode: "subscriptions",
      subscriptions: ["claude"],
    });
    // Signed-in user without custom prefs inherits anonymous fallback
    expect(loadRoutingPrefsForUser("user-a")).toEqual({
      mode: "subscriptions",
      subscriptions: ["claude"],
    });
    // Saving prefs for user-a isolates them from anonymous & user-b
    saveRoutingPrefsForUser(
      { mode: "subscriptions", subscriptions: ["cursor", "local_oss"] },
      "user-a",
    );
    expect(loadRoutingPrefsForUser("user-a").subscriptions).toEqual([
      "cursor",
      "local_oss",
    ]);
    expect(loadRoutingPrefsForUser(null).subscriptions).toEqual(["claude"]);
    expect(loadRoutingPrefsForUser("user-b").subscriptions).toEqual(["claude"]);
  });

  it("renders Claude Code, Cursor, Codex, and CLI Apply tabs in LocalHandoffStudio", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <LocalHandoffStudio
          plan={samplePlan}
          candidates={sampleCandidates}
          strict={false}
        />,
      );
    });

    const clickTab = async (name: string) => {
      const tabBtn = Array.from(host.querySelectorAll('[role="tab"]')).find(
        (btn) => btn.textContent?.trim().startsWith(name),
      ) as HTMLButtonElement;
      expect(tabBtn).toBeTruthy();
      await act(async () => {
        tabBtn.click();
      });
    };

    // Claude Code tab
    await clickTab("Claude Code");
    expect(host.textContent).toContain("CLAUDE.md");
    expect(host.querySelector("pre code")?.textContent).toContain(
      "## AnvilMark Active Plan: Safe CSV Importer",
    );
    expect(host.textContent).toContain("Download CLAUDE.md");

    // Cursor tab
    await clickTab("Cursor");
    expect(host.textContent).toContain(".cursor/rules/anvilmark-plan.mdc");
    const cursorCode = host.querySelector("pre code")?.textContent ?? "";
    expect(cursorCode).toContain("alwaysApply: true");
    expect(cursorCode).toContain("# AnvilMark Plan Rule: Safe CSV Importer");
    expect(host.textContent).toContain("Download anvilmark-plan.mdc");

    // Codex tab
    await clickTab("Codex");
    expect(host.textContent).toContain("AGENTS.md");
    expect(host.querySelector("pre code")?.textContent).toContain(
      "### Agent Execution Protocol",
    );
    expect(host.textContent).toContain("Download AGENTS.md");

    // CLI Apply tab
    await clickTab("CLI Apply");
    const expectedCmd =
      "anvilmark apply-plan --file ~/Downloads/safe-csv-importer.anvilmark-plan.json --target all";
    expect(host.textContent).toContain(expectedCmd);
    expect(host.textContent).toContain(
      "Download safe-csv-importer.anvilmark-plan.json",
    );

    // Copy CLI command button works
    const copyCmdBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Copy command"),
    )!;
    await act(async () => {
      copyCmdBtn.click();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedCmd);

    // Inspect bundle JSON preview is valid anvilmark.plan-handoff.v1 JSON
    const inspectBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Inspect bundle JSON"),
    )!;
    await act(async () => {
      inspectBtn.click();
    });
    const parsedBundle = JSON.parse(
      host.querySelector("pre code")?.textContent ?? "{}",
    );
    expect(parsedBundle.version).toBe("anvilmark.plan-handoff.v1");
    expect(parsedBundle.plan.title).toBe("Safe CSV Importer");
    expect(parsedBundle.claudeMdSection).toContain(
      "Working Rules for Claude Code",
    );
    expect(parsedBundle.cursorRuleMdc).toContain("alwaysApply: true");
    expect(parsedBundle.codexAgentsSection).toContain(
      "Agent Execution Protocol",
    );

    await act(async () => root.unmount());
  });
});
