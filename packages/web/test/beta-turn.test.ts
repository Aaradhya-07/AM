import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/beta/turn/route";
import {
  buildMasterHandoffPrompt,
  buildTaskSlicePrompt,
  type BetaTurnInput,
} from "../lib/beta-turn";
import type { GeneratedPlan } from "../lib/planner";
import {
  computePlanSavingsSummary,
  resolveRoutingPool,
} from "../lib/routing-catalog";

const baseInput: BetaTurnInput = {
  messages: [{ role: "user", content: "hello" }],
  effort: "medium",
  strict: false,
  provider: "configured",
  model: "qwen3.5-9b",
  key: "",
  routingPrefs: { mode: "open", subscriptions: [] },
};

function makeUpstreamJson(payload: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function submitTurn(body: BetaTurnInput) {
  return POST(
    new Request("http://localhost/api/beta/turn", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("3-mode /api/beta/turn & SQLite routing catalog", () => {
  it("resolves live Arena & priced candidates from models.sqlite for open and subscription modes", () => {
    const openPool = resolveRoutingPool({ mode: "open", subscriptions: [] }, [
      {
        id: "qwen3-coder-30b-a3b",
        label: "Qwen 3 Coder 30B",
        status: "unloaded",
      },
    ]);
    expect(openPool.candidates.length).toBeGreaterThanOrEqual(5);
    expect(openPool.candidates.some((c) => c.model === "claude-opus-5-5")).toBe(
      true,
    );
    expect(
      openPool.candidates.some((c) => c.model === "qwen3-coder-30b-a3b"),
    ).toBe(true);

    const claudeOnly = resolveRoutingPool({
      mode: "subscriptions",
      subscriptions: ["claude"],
    });
    expect(claudeOnly.candidates.every((c) => c.provider === "Anthropic")).toBe(
      true,
    );
    expect(claudeOnly.candidates.map((c) => c.model)).toContain(
      "claude-haiku-5-5",
    );

    const savings = computePlanSavingsSummary(
      [
        { model: "claude-haiku-5-5", inputTokens: 20_000, outputTokens: 4_000 },
        { model: "claude-opus-5-5", inputTokens: 10_000, outputTokens: 2_000 },
      ],
      claudeOnly.candidates,
    );
    expect(savings).not.toBeNull();
    expect(savings!.savedUsd).toBeGreaterThan(0);
    expect(savings!.savedPercent).toBeGreaterThan(30);
  });

  it("handles natural chat greetings without generating a plan", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeUpstreamJson({
        mode: "chat",
        reply:
          "Hey! I help turn rough software ideas into vetted architecture decisions, bounded task slices, and cost-smart model picks. What are you planning to build today?",
        questions: [],
        elevatedBrief: "",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await submitTurn(baseInput);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.mode).toBe("chat");
    expect(data.reply).toContain("What are you planning to build today?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns structured clarification questions for underspecified prompts", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(
      makeUpstreamJson({
        mode: "clarify",
        reply:
          "Happy to help plan a todo app—let's pin down a couple of basics before choosing an architecture.",
        questions: [
          {
            id: "audience",
            question: "Who will use this todo app?",
            why: "Determines whether we need auth and shared workspaces.",
            options: ["Personal local app", "Small team with shared lists"],
            allowMultiple: false,
          },
          {
            id: "platform",
            question: "Which platform are you targeting?",
            why: "Sets the runtime and UI framework.",
            options: ["Web app", "CLI", "Mobile"],
            allowMultiple: false,
          },
        ],
        elevatedBrief: "",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await submitTurn({
      ...baseInput,
      messages: [{ role: "user", content: "build a todo app" }],
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.mode).toBe("clarify");
    expect(data.questions).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("synthesizes an elevated plan with subscription routing and builds Master + Slice prompts", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );
    const claudePool = resolveRoutingPool({
      mode: "subscriptions",
      subscriptions: ["claude"],
    });
    const draftPlan: GeneratedPlan = {
      title: "Idempotent CSV Inventory Importer",
      goal: "Allow operators to preview column mappings and safely retry CSV imports without duplicates.",
      users: "Warehouse & inventory operators",
      scope: ["Column mapping preview", "Scoped SKU upsert"],
      nonGoals: ["ERP sync"],
      assumptions: ["Each row has a stable SKU"],
      questions: [],
      architecture: [
        {
          title: "Database uniqueness invariant",
          decision:
            "Enforce UNIQUE(workspace_id, sku) with ON CONFLICT DO UPDATE.",
          why: "Guarantees idempotency across concurrent retries.",
          alternative: "Application-layer pre-check SELECT.",
          tradeoff: "Pre-check queries race under concurrent requests.",
        },
      ],
      flows: [
        {
          from: "CSV Upload UI",
          to: "Import Route",
          data: "Validated CSV rows",
          boundary: "Authenticated workspace session",
        },
      ],
      tasks: [
        {
          id: "db-migration",
          title: "Add scoped SKU uniqueness migration",
          outcome: "Database enforces duplicate protection per workspace.",
          dependsOn: [],
          acceptance: ["Duplicate SKU upsert updates existing row cleanly."],
          checks: ["pnpm test -- migration"],
          model: "claude-haiku-5-5",
          why: "Bounded SQL schema task fits fast tier at minimal token cost.",
          alternatives: [
            {
              model: "claude-sonnet-5-5",
              tradeoff:
                "Use if complex legacy deduplication backfill is needed.",
            },
          ],
          inputTokens: 8000,
          outputTokens: 1500,
          estimateBasis: "Schema file and migration test.",
        },
      ],
      security: [],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        makeUpstreamJson({
          mode: "plan",
          reply:
            "Your CSV import requirements are clear—I added workspace-scoped database idempotency so retries never race.",
          questions: [],
          elevatedBrief:
            "Build an idempotent workspace-scoped CSV importer with column preview and row validation.",
        }),
      )
      .mockResolvedValueOnce(makeUpstreamJson(draftPlan));
    vi.stubGlobal("fetch", fetchMock);

    const response = await submitTurn({
      ...baseInput,
      routingPrefs: { mode: "subscriptions", subscriptions: ["claude"] },
      messages: [
        {
          role: "user",
          content:
            "Add CSV imports to a Next.js + Postgres inventory app with column mapping preview, row validation, and safe retries without duplicates.",
        },
      ],
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.mode).toBe("plan");
    expect(data.plan.title).toBe("Idempotent CSV Inventory Importer");

    const masterPrompt = buildMasterHandoffPrompt(
      data.plan,
      claudePool.candidates,
      false,
    );
    expect(masterPrompt).toContain("# Implementation Handoff");
    expect(masterPrompt).toContain("`claude-haiku-5-5` (Claude Haiku 5.5)");

    const slicePrompt = buildTaskSlicePrompt(
      data.plan,
      0,
      claudePool.candidates,
      false,
    );
    expect(slicePrompt).toContain("Slice 01 of 1");
    expect(slicePrompt).toContain("`claude-haiku-5-5`");
  });
});
