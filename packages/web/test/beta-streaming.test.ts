import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getCatalogStatus } from "../app/api/beta/catalog-status/route";
import { POST as postBetaTurn } from "../app/api/beta/turn/route";
import {
  BetaTurnRequest,
  buildClaudeMdSection,
  buildCodexAgentsSection,
  buildCursorRuleMdc,
  buildPlanBundleJson,
  detectPlanProgressSection,
  type BetaAttachment,
  type BetaTurnInput,
  type RepoContextSnapshot,
} from "../lib/beta-turn";
import type { GeneratedPlan } from "../lib/planner";
import {
  getCatalogFreshness,
  resolveRoutingPool,
} from "../lib/routing-catalog";

const SAMPLE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=";

const sampleAttachment: BetaAttachment = {
  name: "checkout-wireframe.png",
  mimeType: "image/png",
  dataUrl: SAMPLE_PNG_DATA_URL,
};

const sampleRepoContext: RepoContextSnapshot = {
  version: "anvilmark.repo-context.v1",
  exportedAt: "2026-11-26T09:00:00.000Z",
  repoName: "acme-inventory",
  goal: "Add idempotent CSV import with dry-run preview",
  languages: ["TypeScript", "SQL"],
  frameworks: ["Next.js", "Vitest", "Drizzle ORM"],
  packageManager: "pnpm",
  scripts: {
    dev: "next dev",
    test: "vitest run",
    typecheck: "tsc --noEmit",
    lint: "eslint .",
  },
  checkCommands: ["pnpm typecheck", "pnpm lint", "pnpm test"],
  adrPaths: ["docs/adr/0003-workspace-tenancy.md"],
  sampleFiles: [
    "src/app/api/imports/route.ts",
    "src/db/schema.ts",
    "src/lib/csv-parser.ts",
  ],
  totalTrackedFiles: 48,
  hasAnvilmarkDir: true,
  summary:
    "Next.js TypeScript inventory web app with Drizzle ORM and Vitest tests.",
};

const samplePlan: GeneratedPlan = {
  title: 'Safe "Idempotent" CSV Importer',
  goal: "Preview CSV mappings and safely retry imports without duplicate SKU rows.",
  users: "Warehouse operators",
  scope: ["Column mapping preview", "Scoped SKU upsert"],
  nonGoals: ["Live ERP webhooks"],
  assumptions: ["Each CSV row includes a stable external SKU column."],
  questions: [
    "Should malformed rows fail the whole batch or skip with report?",
  ],
  architecture: [
    {
      title: "Scoped database uniqueness",
      decision:
        "Enforce UNIQUE(workspace_id, sku) in Postgres with ON CONFLICT DO UPDATE.",
      why: "Eliminates duplicate rows under concurrent retries.",
      alternative: "SELECT-before-INSERT deduplication in application code.",
      tradeoff: "Pre-check queries race when two requests overlap.",
    },
  ],
  flows: [
    {
      from: "Upload Form",
      to: "src/app/api/imports/route.ts",
      data: "Validated CSV rows",
      boundary: "Workspace-authenticated server route",
    },
  ],
  tasks: [
    {
      id: "sku-constraint",
      title: "Add workspace-scoped SKU uniqueness constraint",
      outcome: "Postgres rejects duplicate SKU rows within the same workspace.",
      dependsOn: [],
      acceptance: ["Re-uploading the same CSV keeps row counts identical."],
      checks: ["pnpm typecheck", "pnpm test"],
      model: "claude-haiku-5-5",
      why: "Bounded schema migration fits the fast tier at low token cost.",
      alternatives: [
        {
          model: "claude-sonnet-5-5",
          tradeoff: "Choose if legacy duplicate backfill logic is complex.",
        },
      ],
      inputTokens: 9000,
      outputTokens: 1800,
      estimateBasis:
        "Drizzle schema, migration SQL, and Vitest integration spec.",
    },
    {
      id: "import-route",
      title: "Implement idempotent CSV upsert endpoint",
      outcome: "API validates rows and performs transactional batch upsert.",
      dependsOn: ["sku-constraint"],
      acceptance: ["Malformed rows return 400 with per-row error details."],
      checks: ["pnpm lint", "pnpm test"],
      model: "claude-sonnet-5-5",
      why: "Multi-file route + parser integration fits the balanced tier.",
      alternatives: [
        {
          model: "claude-opus-5-5",
          tradeoff:
            "Higher-cost frontier model for subtle concurrency edge cases.",
        },
      ],
      inputTokens: 18000,
      outputTokens: 4200,
      estimateBasis: "Route handler, CSV parser, and integration tests.",
    },
  ],
  security: [
    {
      risk: "Cross-workspace SKU overwrite",
      control: "Scope upsert conflict key and session check to workspace_id.",
      verification: "Add negative test asserting workspace A cannot update B.",
    },
  ],
};

const baseTurnInput: BetaTurnInput = {
  messages: [
    {
      role: "user",
      content:
        "Add idempotent CSV imports with column mapping preview to our Next.js + Postgres inventory app.",
    },
  ],
  effort: "medium",
  strict: true,
  provider: "configured",
  model: "qwen3-coder-30b-a3b",
  key: "",
  routingPrefs: { mode: "subscriptions", subscriptions: ["claude"] },
};

function makeModelsResponse(
  models: Array<{ id: string; status: "loaded" | "unloaded" | "loading" }>,
) {
  return new Response(
    JSON.stringify({
      data: models.map((item) => ({
        id: item.id,
        status: { value: item.status },
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeOpenAiJsonResponse(payload: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeOpenAiSseResponse(payload: unknown, chunkSize = 110) {
  const fullJson = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < fullJson.length; i += chunkSize) {
        const piece = fullJson.slice(i, i + chunkSize);
        const frame = `data: ${JSON.stringify({
          choices: [{ delta: { content: piece } }],
        })}\n\n`;
        controller.enqueue(encoder.encode(frame));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

async function readSseEvents(
  response: Response,
): Promise<Array<{ event: string; data: unknown }>> {
  const raw = await response.text();
  const blocks = raw
    .split(/\r?\n\r?\n/)
    .filter((block) => block.trim().length > 0);
  return blocks.map((block) => {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    return {
      event,
      data: JSON.parse(dataLines.join("\n")),
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Wave 1 SSE streaming, warm triage, multimodal, repoContext & catalog status", () => {
  it("streams status -> architect_summary -> status -> progress -> done in order and routes warm triage on am-server", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    const completionBodies: Array<Record<string, unknown>> = [];
    let modelsCalls = 0;
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/models")) {
          modelsCalls += 1;
          return Promise.resolve(
            makeModelsResponse([
              { id: "gemma-4-12b", status: "loaded" },
              { id: "qwen3.5-9b", status: "loaded" },
              { id: "qwen3-coder-30b-a3b", status: "unloaded" },
            ]),
          );
        }
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        completionBodies.push(parsedBody);
        if (completionBodies.length === 1) {
          return Promise.resolve(
            makeOpenAiJsonResponse({
              mode: "plan",
              reply:
                "Sharpened your brief with Postgres workspace-scoped SKU idempotency and two ordered slices.",
              questions: [],
              elevatedBrief:
                "Build a workspace-scoped idempotent CSV importer with mapping preview and transactional batch upserts.",
            }),
          );
        }
        return Promise.resolve(makeOpenAiSseResponse(samplePlan, 95));
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          ...baseTurnInput,
          routingPrefs: { mode: "open", subscriptions: [] },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-transform",
    );

    const events = await readSseEvents(response);

    // Stage 1 and Stage 2 share one cached /v1/models lookup.
    expect(modelsCalls).toBe(1);
    expect(completionBodies).toHaveLength(2);
    // Stage 1 triage routed to warm qwen3.5-9b instead of unloaded qwen3-coder-30b-a3b.
    expect(completionBodies[0]?.model).toBe("qwen3.5-9b");
    expect(completionBodies[0]?.stream).toBeUndefined();
    // Stage 2 synthesis still uses user's exact selected model with stream: true.
    expect(completionBodies[1]?.model).toBe("qwen3-coder-30b-a3b");
    expect(completionBodies[1]?.stream).toBe(true);

    const eventTypes = events.map((e) => e.event);

    expect(eventTypes[0]).toBe("status");
    expect(events[0]?.data).toMatchObject({
      phase: "triage",
      model: "qwen3.5-9b",
    });

    expect(eventTypes[1]).toBe("architect_summary");
    expect(events[1]?.data).toMatchObject({
      reply: expect.stringContaining("workspace-scoped SKU idempotency"),
      elevatedBrief: expect.stringContaining("transactional batch upserts"),
    });

    expect(eventTypes[2]).toBe("status");
    expect(events[2]?.data).toMatchObject({
      phase: "synthesis",
      model: "qwen3-coder-30b-a3b",
    });

    const progressEvents = events.filter((e) => e.event === "progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(4);
    const seenSections = progressEvents.map(
      (e) => (e.data as { section: string }).section,
    );
    expect(seenSections).toContain("architecture");
    expect(seenSections).toContain("flows");
    expect(seenSections).toContain("tasks");
    expect(seenSections).toContain("security");

    // Chars strictly increase across progress events.
    const charCounts = progressEvents.map(
      (e) => (e.data as { chars: number }).chars,
    );
    for (let i = 1; i < charCounts.length; i += 1) {
      expect(charCounts[i]!).toBeGreaterThan(charCounts[i - 1]!);
    }

    expect(eventTypes.at(-1)).toBe("done");
    const donePayload = events.at(-1)?.data as {
      mode: string;
      plan: GeneratedPlan;
    };
    expect(donePayload.mode).toBe("plan");
    expect(donePayload.plan.title).toBe(samplePlan.title);
  });

  it("falls back to first loaded model for triage when qwen3.5-9b is not loaded", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    const completionModels: string[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/models")) {
          return Promise.resolve(
            makeModelsResponse([
              { id: "gemma-4-12b", status: "loaded" },
              { id: "qwen3-coder-30b-a3b", status: "unloaded" },
            ]),
          );
        }
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          model: string;
        };
        completionModels.push(body.model);
        return Promise.resolve(
          makeOpenAiJsonResponse({
            mode: "chat",
            reply: "Hi! What software are we designing today?",
            questions: [],
            elevatedBrief: "",
          }),
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...baseTurnInput,
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.mode).toBe("chat");
    expect(completionModels).toEqual(["gemma-4-12b"]);
  });

  it("emits architect_summary immediately on forcePlan and falls back when stream: true fails", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    let callIndex = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) {
        return Promise.resolve(
          new Response("streaming unsupported", { status: 501 }),
        );
      }
      return Promise.resolve(makeOpenAiJsonResponse(samplePlan));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          ...baseTurnInput,
          forcePlan: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const events = await readSseEvents(response);
    expect(events[0]?.event).toBe("architect_summary");
    expect(events[1]?.event).toBe("status");
    expect(events[1]?.data).toMatchObject({ phase: "synthesis" });
    expect(events.at(-1)?.event).toBe("done");
    expect(callIndex).toBe(2);
  });

  it("emits an SSE error event when upstream returns 429 rate-limit", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/v1/models")) {
        return Promise.resolve(
          makeModelsResponse([{ id: "qwen3-coder-30b-a3b", status: "loaded" }]),
        );
      }
      return Promise.resolve(new Response("rate limited", { status: 429 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(baseTurnInput),
      }),
    );

    expect(response.status).toBe(200);
    const events = await readSseEvents(response);
    expect(events.map((e) => e.event)).toEqual(["status", "error"]);
    expect(events[1]?.data).toMatchObject({
      status: 429,
      error: expect.stringContaining("rate-limited"),
    });
  });

  it("grounds both Stage 1 and Stage 2 prompts with verified repoContext while stating file contents were not read", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    const sentPayloads: Array<{
      messages: Array<{ role: string; content: string }>;
    }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/models")) {
          return Promise.resolve(
            makeModelsResponse([
              { id: "qwen3-coder-30b-a3b", status: "loaded" },
            ]),
          );
        }
        sentPayloads.push(
          JSON.parse(String(init?.body ?? "{}")) as {
            messages: Array<{ role: string; content: string }>;
          },
        );
        if (sentPayloads.length === 1) {
          return Promise.resolve(
            makeOpenAiJsonResponse({
              mode: "plan",
              reply: "Grounded plan in your verified repo commands.",
              questions: [],
              elevatedBrief:
                "Add CSV import to src/app/api/imports/route.ts verified by pnpm typecheck and pnpm test.",
            }),
          );
        }
        return Promise.resolve(makeOpenAiJsonResponse(samplePlan));
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...baseTurnInput,
          repoContext: sampleRepoContext,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(sentPayloads).toHaveLength(2);

    for (const call of sentPayloads) {
      const systemMsg = call.messages[0]?.content ?? "";
      const userMsg = call.messages[1]?.content ?? "";
      expect(systemMsg).toContain("checkCommands");
      expect(systemMsg).toMatch(/file contents were NOT read/i);
      expect(userMsg).toContain("acme-inventory");
      expect(userMsg).toContain("pnpm typecheck");
      expect(userMsg).toContain("docs/adr/0003-workspace-tenancy.md");
      expect(userMsg).toContain("src/app/api/imports/route.ts");
      expect(userMsg).toContain("Drizzle ORM");
    }
  });

  it("validates multimodal attachments and retries configured text-only GGUF when image_url returns 400/500", async () => {
    // Validation rejects > 4 attachments, invalid MIME types, or mismatched data URLs.
    expect(
      BetaTurnRequest.safeParse({
        ...baseTurnInput,
        attachments: [
          sampleAttachment,
          sampleAttachment,
          sampleAttachment,
          sampleAttachment,
          sampleAttachment,
        ],
      }).success,
    ).toBe(false);

    expect(
      BetaTurnRequest.safeParse({
        ...baseTurnInput,
        attachments: [
          {
            name: "bad.svg",
            mimeType: "image/svg+xml",
            dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      BetaTurnRequest.safeParse({
        ...baseTurnInput,
        attachments: [
          {
            name: "mismatch.png",
            mimeType: "image/jpeg",
            dataUrl: SAMPLE_PNG_DATA_URL,
          },
        ],
      }).success,
    ).toBe(false);

    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    const completionBodies: Array<{
      messages: Array<{ role: string; content: unknown }>;
    }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/models")) {
          return Promise.resolve(
            makeModelsResponse([
              { id: "qwen3-coder-30b-a3b", status: "loaded" },
            ]),
          );
        }
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          messages: Array<{ role: string; content: unknown }>;
        };
        completionBodies.push(parsed);
        // Simulate text-only GGUF without mmproj rejecting image_url array with HTTP 500.
        if (Array.isArray(parsed.messages[1]?.content)) {
          return Promise.resolve(
            new Response("vision projector not loaded", { status: 500 }),
          );
        }
        return Promise.resolve(
          makeOpenAiJsonResponse({
            mode: "chat",
            reply:
              "I noted your attached file checkout-wireframe.png. Tell me the key flow you want to build.",
            questions: [],
            elevatedBrief: "",
          }),
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...baseTurnInput,
          attachments: [sampleAttachment],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.mode).toBe("chat");

    // Attempt 1 sent image_url content array; Attempt 2 retried text-only noting filename.
    expect(completionBodies).toHaveLength(2);
    expect(Array.isArray(completionBodies[0]?.messages[1]?.content)).toBe(true);
    const firstParts = completionBodies[0]?.messages[1]?.content as Array<{
      type: string;
      image_url?: { url: string };
    }>;
    expect(firstParts[1]?.type).toBe("image_url");
    expect(firstParts[1]?.image_url?.url).toBe(SAMPLE_PNG_DATA_URL);

    expect(typeof completionBodies[1]?.messages[1]?.content).toBe("string");
    expect(String(completionBodies[1]?.messages[1]?.content)).toContain(
      "checkout-wireframe.png",
    );
  });

  it("sends Google inline_data vision parts when provider is google", async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init?: RequestInit) => {
        capturedBodies.push(
          JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          mode: "chat",
                          reply: "Got the wireframe! What stack are you using?",
                          questions: [],
                          elevatedBrief: "",
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...baseTurnInput,
          provider: "google",
          model: "gemini-3.8-flash",
          key: "test-gemini-key",
          attachments: [sampleAttachment],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(capturedBodies).toHaveLength(1);
    const contents = capturedBodies[0]?.contents as Array<{
      parts: Array<{
        text?: string;
        inline_data?: { mime_type: string; data: string };
      }>;
    }>;
    expect(contents[0]?.parts).toHaveLength(2);
    expect(contents[0]?.parts[1]?.inline_data).toEqual({
      mime_type: "image/png",
      data: SAMPLE_PNG_DATA_URL.split(",")[1],
    });
  });

  it("detects top-level JSON progress sections without false positives inside string values", () => {
    expect(
      detectPlanProgressSection(
        '{"title":"Build architecture for tasks and security","goal":"',
      ),
    ).toBe("overview");
    expect(
      detectPlanProgressSection(
        '{"title":"Plan","architecture":[{"title":"DB","decision":"Use SQL"}]',
      ),
    ).toBe("architecture");
    expect(
      detectPlanProgressSection(
        '{"title":"Plan","architecture":[],"flows":[{"from":"UI","to":"API"}]',
      ),
    ).toBe("flows");
    expect(
      detectPlanProgressSection(
        '{"title":"Plan","architecture":[],"flows":[],"tasks":[{"id":"t1"}]',
      ),
    ).toBe("tasks");
    expect(
      detectPlanProgressSection(
        '{"title":"Plan","architecture":[],"flows":[],"tasks":[],"security":[{"risk":"r"}]',
      ),
    ).toBe("security");
  });

  it("builds consistent CLAUDE.md, Cursor .mdc, AGENTS.md, and anvilmark.plan-handoff.v1 JSON exports", () => {
    const pool = resolveRoutingPool({
      mode: "subscriptions",
      subscriptions: ["claude"],
    });

    const claudeMd = buildClaudeMdSection(samplePlan, pool.candidates, true);
    expect(claudeMd).toContain(`## AnvilMark Active Plan: ${samplePlan.title}`);
    expect(claudeMd).toContain("`claude-haiku-5-5`");
    expect(claudeMd).toContain("Live ERP webhooks");
    expect(claudeMd).toContain("Security & Verification Gate");

    const cursorMdc = buildCursorRuleMdc(samplePlan, pool.candidates, true);
    expect(cursorMdc.startsWith("---\n")).toBe(true);
    expect(cursorMdc).toContain(
      'description: "AnvilMark active plan: Safe \\"Idempotent\\" CSV Importer"',
    );
    expect(cursorMdc).toContain("alwaysApply: true");
    expect(cursorMdc).toContain("Scoped database uniqueness");
    expect(cursorMdc).toContain("`claude-sonnet-5-5`");

    const codexAgents = buildCodexAgentsSection(
      samplePlan,
      pool.candidates,
      true,
    );
    expect(codexAgents).toContain("Agent Execution Protocol");
    expect(codexAgents).toContain("`sku-constraint`");
    expect(codexAgents).toContain("Security & Strict Gate");

    const bundleRaw = buildPlanBundleJson(
      samplePlan,
      pool.candidates,
      true,
      "2026-11-26T10:00:00.000Z",
    );
    const bundle = JSON.parse(bundleRaw) as Record<string, unknown>;
    expect(bundle.version).toBe("anvilmark.plan-handoff.v1");
    expect(bundle.createdAt).toBe("2026-11-26T10:00:00.000Z");
    expect(bundle.strict).toBe(true);
    expect(bundle.claudeMdSection).toBe(claudeMd);
    expect(bundle.cursorRuleMdc).toBe(cursorMdc);
    expect(bundle.codexAgentsSection).toBe(codexAgents);
    expect(typeof bundle.masterPrompt).toBe("string");

    const bundleCandidates = bundle.candidates as Array<
      Record<string, unknown>
    >;
    expect(bundleCandidates.length).toBeGreaterThan(0);
    for (const candidate of bundleCandidates) {
      expect(Object.keys(candidate).sort()).toEqual([
        "billing",
        "label",
        "model",
        "provider",
        "tier",
      ]);
    }
  });

  it("reports SQLite catalog freshness and exposes GET /api/beta/catalog-status with no-store", async () => {
    const fresh = getCatalogFreshness(new Date("2026-11-05T12:00:00.000Z"));
    expect(fresh.sources.length).toBeGreaterThanOrEqual(4);
    expect(fresh.sources.map((s) => s.id)).toContain("arena");
    expect(fresh.ageDays).toBeLessThanOrEqual(14);
    expect(fresh.isStale).toBe(false);
    expect(fresh.refreshCommand).toBe(
      "pnpm --filter @anvilmark/web catalog:refresh",
    );

    const stale = getCatalogFreshness(new Date("2026-11-26T12:00:00.000Z"));
    expect(stale.ageDays).toBeGreaterThan(14);
    expect(stale.isStale).toBe(true);

    const response = await getCatalogStatus();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      fetchedAt: string;
      ageDays: number;
      isStale: boolean;
      sources: Array<{ id: string; fetchedAt: string }>;
      refreshCommand: string;
    };
    expect(body.fetchedAt).toBeTruthy();
    expect(typeof body.ageDays).toBe("number");
    expect(body.isStale).toBe(body.ageDays > 14);
    expect(body.sources.length).toBeGreaterThanOrEqual(4);
    expect(body.refreshCommand).toBe(
      "pnpm --filter @anvilmark/web catalog:refresh",
    );
  });

  it("flushes architect_summary before Stage 2 resolves and retries Stage 2 text-only on vision-rejected GGUF", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    let releaseStage2!: () => void;
    const stage2Gate = new Promise<void>((resolve) => {
      releaseStage2 = resolve;
    });

    const stage2Bodies: Array<{
      messages: Array<{ role: string; content: unknown }>;
    }> = [];
    let completionIndex = 0;

    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/v1/models")) {
          return makeModelsResponse([
            { id: "qwen3.5-9b", status: "loaded" },
            { id: "qwen3-coder-30b-a3b", status: "unloaded" },
          ]);
        }
        completionIndex += 1;
        const parsed = JSON.parse(String(init?.body ?? "{}")) as {
          messages: Array<{ role: string; content: unknown }>;
        };
        if (completionIndex === 1) {
          // Stage 1 succeeds on warm qwen3.5-9b.
          return makeOpenAiJsonResponse({
            mode: "plan",
            reply: "Immediate architectural take ready before synthesis.",
            questions: [],
            elevatedBrief:
              "Build a workspace-scoped idempotent CSV importer with mapping preview.",
          });
        }
        // Stage 2 waits until test verifies architect_summary was already flushed!
        await stage2Gate;
        stage2Bodies.push(parsed);
        if (Array.isArray(parsed.messages[1]?.content)) {
          return new Response("no mmproj for qwen3-coder-30b-a3b", {
            status: 400,
          });
        }
        return makeOpenAiSseResponse(samplePlan, 140);
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          ...baseTurnInput,
          attachments: [sampleAttachment],
        }),
      }),
    );

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!buffer.includes("event: architect_summary")) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }

    // architect_summary arrived BEFORE Stage 2 was even released!
    expect(buffer).toContain("event: architect_summary");
    expect(buffer).toContain(
      "Immediate architectural take ready before synthesis.",
    );
    expect(stage2Bodies).toHaveLength(0);

    releaseStage2();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }

    expect(buffer).toContain("event: progress");
    expect(buffer).toContain("event: done");
    expect(stage2Bodies).toHaveLength(2);
    expect(Array.isArray(stage2Bodies[0]?.messages[1]?.content)).toBe(true);
    expect(typeof stage2Bodies[1]?.messages[1]?.content).toBe("string");
    expect(String(stage2Bodies[1]?.messages[1]?.content)).toContain(
      "checkout-wireframe.png",
    );
  });
});
