// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BetaPrompt } from "../app/beta/prompt";
import type { GeneratedPlan } from "../lib/planner";
import type { RoutableCandidate } from "../lib/routing-types";

const sampleCandidates: RoutableCandidate[] = [
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
  title: "Safe CSV imports",
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
      data: "CSV rows",
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
      checks: ["Run database migration and import integration tests."],
      model: "claude-haiku-5-5",
      why: "Well-bounded schema and repository change.",
      alternatives: [
        {
          model: "claude-sonnet-5-5",
          tradeoff: "Useful if legacy duplicate cleanup is complex.",
        },
      ],
      inputTokens: 12000,
      outputTokens: 2500,
      estimateBasis: "Importer module, migration file, and test suite.",
    },
  ],
  security: [],
};

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const proto = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("BetaPrompt 3-mode conversational UI", () => {
  it("handles short natural language greetings (mode: chat) without minLength block", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "chat",
          reply:
            "Hey! I help turn ideas into vetted architecture plans and model-routed agent prompts. What are you planning to build today?",
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

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      setNativeValue(textarea, "hi");
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/beta/turn",
      expect.objectContaining({ method: "POST" }),
    );
    expect(host.textContent).toContain("What are you planning to build today?");
    expect(host.textContent).not.toContain("Shift to local development");

    await act(async () => root.unmount());
  });

  it("renders interactive clarification options (mode: clarify) and synthesizes plan + Local Handoff Studio on answer", async () => {
    let turnCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/plan/models") {
        return Promise.resolve(
          new Response(JSON.stringify({ configured: true, models: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      turnCount += 1;
      if (turnCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              mode: "clarify",
              reply: "Let's clarify two quick details for your todo app first.",
              questions: [
                {
                  id: "scope",
                  question: "Who is this todo app for?",
                  why: "Decides auth and sync architecture.",
                  options: ["Solo local use", "Team workspace"],
                  allowMultiple: false,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            mode: "plan",
            reply: "Here is your sharpened plan and model routing.",
            plan: samplePlan,
            candidates: sampleCandidates,
            catalogDate: "2026-10-27",
            strict: false,
            request: { idea: "Todo app", context: "" },
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
      setNativeValue(textarea, "build a todo app");
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(host.textContent).toContain("Who is this todo app for?");
    const chip = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Team workspace",
    )!;
    expect(chip).toBeTruthy();

    await act(async () => {
      chip.click();
    });

    const buildBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Build plan with selections"),
    )!;
    expect(buildBtn).toBeTruthy();

    await act(async () => {
      buildBtn
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    const secondTurnCall = fetchMock.mock.calls.filter(
      (c) => c[0] === "/api/beta/turn",
    )[1] as [string, RequestInit];
    const sentPayload = JSON.parse(String(secondTurnCall[1].body));
    expect(sentPayload.forcePlan).toBe(true);

    expect(host.textContent).toContain("Safe CSV imports");
    expect(host.textContent).toContain("Shift to local development");
    expect(host.textContent).toContain("Master agent prompt");
    expect(host.textContent).toContain("Per-task slice prompts (1)");

    await act(async () => root.unmount());
  });
});
