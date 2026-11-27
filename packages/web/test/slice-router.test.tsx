// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as postBetaTurn } from "../app/api/beta/turn/route";
import { PlanArtifactView } from "../app/beta/plan-output";
import { predictLearnedSliceUtility } from "../lib/learned-router";
import {
  buildMatchedPlanExemplarPrompt,
  buildMatchedTriageExemplarPrompt,
} from "../lib/oss-exemplars";
import type { RepoOutcomesSummary } from "../lib/outcome-priors";
import { validatePlan, type GeneratedPlan } from "../lib/planner";
import { resolveRoutingPool } from "../lib/routing-catalog";
import { calibratePlanRouting } from "../lib/slice-router";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
});

describe("Quality-mindful 2-option slice routing & dynamic slice counts", () => {
  it("demotes GPT-6 Astra on a Todo app (ChatGPT subscription) to GPT-6.1 Sol + GPT-6 Luna without sacrificing UI quality", () => {
    const chatgptPool = resolveRoutingPool({
      mode: "subscriptions",
      subscriptions: ["chatgpt"],
    });

    // Pool ordering puts daily workhorse Sol before specialist Astra
    expect(chatgptPool.candidates[0]?.model).toBe("gpt-6.1-sol");

    const rawHallucinatedTodoPlan = {
      title: "Personal Todo List App",
      goal: "Create, filter, and complete daily todo tasks in a clean Next.js app.",
      users: "Individual users",
      projectScale: "complex_system",
      scope: ["SQLite tasks table", "Task CRUD & filter UI", "Unit tests"],
      nonGoals: ["Multi-tenant enterprise RBAC"],
      assumptions: ["Local SQLite file"],
      questions: [],
      architecture: [
        {
          title: "Local SQLite persistence",
          decision: "Store tasks in SQLite with Drizzle.",
          why: "Zero external setup.",
          alternative: "Hosted Postgres",
          tradeoff: "Single-node storage.",
        },
      ],
      flows: [],
      tasks: [
        {
          id: "todo-schema",
          title: "Add SQLite todo schema and migration",
          outcome: "Creates todos table with id, title, completed, dueDate.",
          dependsOn: [],
          kind: "concurrency_algorithms",
          complexity: "high",
          acceptance: ["Migration creates todos table cleanly."],
          checks: ["pnpm test"],
          model: "gpt-6-astra",
          why: "GPT-6 Astra handles complex state.",
          alternatives: [],
          inputTokens: 8000,
          outputTokens: 1500,
          estimateBasis: "Schema + migration.",
        },
        {
          id: "todo-ui",
          title: "Build interactive Todo list CRUD & filter view",
          outcome: "Users can add, toggle, filter, and delete tasks.",
          dependsOn: ["todo-schema"],
          kind: "crud_ui",
          complexity: "high",
          acceptance: ["Active/completed filters update task list."],
          checks: ["pnpm test"],
          model: "gpt-6-astra",
          why: "GPT-6 Astra for todo UI.",
          alternatives: [],
          inputTokens: 14000,
          outputTokens: 3200,
          estimateBasis: "Components + route handlers.",
        },
      ],
      security: [],
    };

    const calibrated = calibratePlanRouting({
      raw: rawHallucinatedTodoPlan,
      idea: "Build a todo app",
      candidates: chatgptPool.candidates,
      strict: false,
    }) as GeneratedPlan;

    // Clamped projectScale to small_app
    expect(calibrated.projectScale).toBe("small_app");

    // Slice 1 (bounded schema): fast Luna primary + balanced Sol step-up, NEVER Astra
    const schemaTask = calibrated.tasks[0]!;
    expect(schemaTask.model).toBe("gpt-6-luna");
    expect(schemaTask.alternatives[0]?.model).toBe("gpt-6.1-sol");
    expect(schemaTask.why).not.toContain("Astra");

    // Slice 2 (interactive UI & CRUD): balanced Sol primary (protects quality!) + fast Luna Option 2, NEVER Astra
    const uiTask = calibrated.tasks[1]!;
    expect(uiTask.model).toBe("gpt-6.1-sol");
    expect(uiTask.alternatives[0]?.model).toBe("gpt-6-luna");
    expect(
      calibrated.tasks.some(
        (t) =>
          t.model === "gpt-6-astra" ||
          t.alternatives.some((a) => a.model === "gpt-6-astra"),
      ),
    ).toBe(false);
  });

  it("imposes NO artificial cap on frontier models when multiple slices genuinely have high security/concurrency complexity", () => {
    const openPool = resolveRoutingPool({ mode: "open", subscriptions: [] });

    const multiFrontierPlan = {
      title: "Distributed Ledger & Multi-Tenant Auth Engine",
      goal: "Enforce serializable double-entry transfers, WebAuthn session signing, and CRDT conflict resolution.",
      users: "Fintech platform engineers",
      projectScale: "complex_system",
      scope: [
        "Tenant RLS & WebAuthn token verification",
        "Serializable double-entry lock coordinator",
        "CRDT state-sync engine",
        "Operator audit UI",
      ],
      nonGoals: ["Marketing site"],
      assumptions: ["Postgres 17"],
      questions: [],
      architecture: [
        {
          title: "Serializable advisory locks",
          decision: "Acquire ordered account locks per ledger batch.",
          why: "Prevents deadlocks and lost updates.",
          alternative: "Read-committed retries",
          tradeoff: "Slightly higher contention under hot accounts.",
        },
      ],
      flows: [],
      tasks: [
        {
          id: "tenant-auth-rls",
          title: "Implement WebAuthn signature verification & Postgres RLS tenant isolation",
          outcome: "Prevents cross-tenant access and token forgery.",
          dependsOn: [],
          kind: "auth_security",
          complexity: "high",
          acceptance: ["Cross-tenant queries return 0 rows."],
          checks: ["pnpm test"],
          model: "claude-opus-5-5",
          why: "Critical auth and RLS invariants.",
          alternatives: [],
          inputTokens: 25000,
          outputTokens: 5000,
          estimateBasis: "Auth middleware + RLS policies.",
        },
        {
          id: "ledger-concurrency",
          title: "Build deadlock-free concurrent double-entry transfer coordinator",
          outcome: "Guarantees zero balance drift under parallel retries.",
          dependsOn: ["tenant-auth-rls"],
          kind: "concurrency_algorithms",
          complexity: "high",
          acceptance: ["100 concurrent transfers preserve sum invariant."],
          checks: ["pnpm test"],
          model: "claude-opus-5-5",
          why: "Subtle concurrency race prevention.",
          alternatives: [],
          inputTokens: 28000,
          outputTokens: 6000,
          estimateBasis: "Coordinator + concurrency stress test.",
        },
        {
          id: "crdt-merge",
          title: "Implement deterministic CRDT state-machine merge algorithm",
          outcome: "Out-of-order replicas converge identically.",
          dependsOn: ["tenant-auth-rls"],
          kind: "concurrency_algorithms",
          complexity: "high",
          acceptance: ["Commutative property holds across fuzzed events."],
          checks: ["pnpm test"],
          model: "gemini-4-argon",
          why: "Algorithmic state convergence.",
          alternatives: [],
          inputTokens: 24000,
          outputTokens: 5500,
          estimateBasis: "CRDT engine + property tests.",
        },
        {
          id: "audit-feature",
          title: "Build paginated ledger audit workflow and CSV export",
          outcome: "Operators inspect and export filtered transfer history.",
          dependsOn: ["ledger-concurrency"],
          kind: "feature_integration",
          complexity: "medium",
          acceptance: ["Cursor pagination handles 10k rows."],
          checks: ["pnpm test"],
          model: "claude-haiku-5-5",
          why: "Picked weak model by mistake.",
          alternatives: [],
          inputTokens: 18000,
          outputTokens: 3800,
          estimateBasis: "API + table view.",
        },
      ],
      security: [],
    };

    const calibrated = calibratePlanRouting({
      raw: multiFrontierPlan,
      idea: multiFrontierPlan.goal,
      candidates: openPool.candidates,
      strict: true,
    }) as GeneratedPlan;

    const byId = new Map(openPool.candidates.map((c) => [c.model, c]));

    // All 3 high-complexity slices keep frontier models (no hard cap!)
    expect(byId.get(calibrated.tasks[0]!.model)?.tier).toBe("frontier");
    expect(byId.get(calibrated.tasks[1]!.model)?.tier).toBe("frontier");
    expect(byId.get(calibrated.tasks[2]!.model)?.tier).toBe("frontier");

    // Slice 4 (medium feature integration): upgraded from weak fast model to strong balanced workhorse,
    // with frontier step-up offered as Option 2!
    expect(byId.get(calibrated.tasks[3]!.model)?.tier).toBe("balanced");
    expect(byId.get(calibrated.tasks[3]!.alternatives[0]!.model)?.tier).toBe(
      "frontier",
    );
  });

  it("supports multi-wave plans beyond 3 slices (up to 12 vertical slices) and renders 2 stable clickable option pills per slice", async () => {
    const pool = resolveRoutingPool({
      mode: "subscriptions",
      subscriptions: ["claude"],
    });

    const tenSlices = Array.from({ length: 10 }, (_, idx) => ({
      id: `slice-${idx + 1}`,
      title: `Vertical capability slice ${idx + 1}`,
      outcome: `Delivers end-to-end workflow ${idx + 1}.`,
      dependsOn: idx === 0 ? [] : ["slice-1"],
      kind: "feature_integration" as const,
      complexity: "medium" as const,
      acceptance: [`Workflow ${idx + 1} passes integration checks.`],
      checks: ["pnpm test"],
      model: "claude-sonnet-5-5",
      why: "Balanced multi-file coding workhorse.",
      alternatives: [
        {
          model: "claude-opus-5-5",
          tradeoff: "Frontier step-up if subtle invariants arise.",
        },
      ],
      inputTokens: 12000,
      outputTokens: 2500,
      estimateBasis: "Feature slice.",
    }));

    const largePlan = validatePlan(
      {
        title: "10-Slice Multi-Module Platform",
        goal: "Ship 10 parallelizable vertical slices cleanly.",
        users: "Product teams",
        projectScale: "complex_system",
        scope: ["10 vertical capabilities"],
        nonGoals: [],
        assumptions: [],
        questions: [],
        architecture: [
          {
            title: "Modular vertical slices",
            decision: "Shared schema foundation with 9 parallel capability slices.",
            why: "Avoids horizontal bottlenecks.",
            alternative: "3 monolithic layers",
            tradeoff: "Requires explicit slice contracts.",
          },
        ],
        flows: [],
        tasks: tenSlices,
        security: [],
      },
      {
        idea: "Build a 10-module platform",
        context: "",
        strict: false,
        provider: "configured",
        model: "qwen3.5-9b",
        key: "",
        candidates: pool.candidates.map((c) => ({
          model: c.model,
          billing: c.billing,
          notes: c.strengths,
        })),
      },
    );

    expect(largePlan.tasks).toHaveLength(10);

    // Mount PlanArtifactView and verify the 2 side-by-side clickable option pills keep stable positions when toggled
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    let currentPlan: GeneratedPlan = {
      ...largePlan,
      tasks: largePlan.tasks.slice(0, 1),
    };
    const renderView = () =>
      root.render(
        <PlanArtifactView
          plan={currentPlan}
          candidates={pool.candidates}
          catalogDate="2026-10-27"
          strict={false}
          onSelectQuestion={() => {}}
          onUpdateTaskModel={(idx, nextModel) => {
            const target = currentPlan.tasks[idx]!;
            currentPlan = {
              ...currentPlan,
              tasks: [
                {
                  ...target,
                  model: nextModel,
                  alternatives: [
                    {
                      model: target.model,
                      tradeoff: "Previous selection.",
                    },
                  ],
                },
              ],
            };
            renderView();
          }}
        />,
      );

    await act(async () => {
      renderView();
    });

    const optionGroup = host.querySelector(
      '[role="group"][aria-label="Recommended model options for Vertical capability slice 1"]',
    )!;
    expect(optionGroup).toBeTruthy();
    const optionButtons = Array.from(optionGroup.querySelectorAll("button"));
    expect(optionButtons).toHaveLength(2);
    expect(optionButtons[0]!.textContent).toContain("Claude Sonnet 5.5");
    expect(optionButtons[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(optionButtons[1]!.textContent).toContain("Claude Opus 5.5");
    expect(optionButtons[1]!.getAttribute("aria-pressed")).toBe("false");

    // Click Option 2 -> selection flips without swapping button positions!
    await act(async () => {
      optionButtons[1]!.click();
    });

    const afterButtons = Array.from(optionGroup.querySelectorAll("button"));
    expect(afterButtons[0]!.textContent).toContain("Claude Sonnet 5.5");
    expect(afterButtons[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(afterButtons[1]!.textContent).toContain("Claude Opus 5.5");
    expect(afterButtons[1]!.getAttribute("aria-pressed")).toBe("true");

    await act(async () => root.unmount());
  });

  it("calibrates Todo app routing end-to-end inside POST /api/beta/turn", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: "Simple Todo App",
                  goal: "Manage personal tasks cleanly.",
                  users: "Solo users",
                  projectScale: "small_app",
                  scope: ["Add & complete todos"],
                  nonGoals: ["Team sync"],
                  assumptions: ["Browser localStorage"],
                  questions: [],
                  architecture: [
                    {
                      title: "LocalStorage state",
                      decision: "Persist todos in localStorage.",
                      why: "Instant zero-backend setup.",
                      alternative: "SQLite API",
                      tradeoff: "Single browser only.",
                    },
                  ],
                  flows: [],
                  tasks: [
                    {
                      id: "todo-app-ui",
                      title: "Build Todo list UI and localStorage persistence",
                      outcome: "Users add, toggle, and clear completed todos.",
                      dependsOn: [],
                      kind: "crud_ui",
                      complexity: "low",
                      acceptance: ["Todos persist across page reload."],
                      checks: ["pnpm test"],
                      model: "gpt-6-astra",
                      why: "Overkill pick from planner.",
                      alternatives: [],
                      inputTokens: 10000,
                      outputTokens: 2000,
                      estimateBasis: "UI component + test.",
                    },
                  ],
                  security: [],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await postBetaTurn(
      new Request("http://localhost/api/beta/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Build a simple todo app" }],
          effort: "medium",
          strict: false,
          forcePlan: true,
          provider: "configured",
          model: "qwen3.5-9b",
          key: "",
          routingPrefs: {
            mode: "subscriptions",
            subscriptions: ["chatgpt"],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.mode).toBe("plan");
    expect(payload.plan.tasks[0].model).toBe("gpt-6.1-sol");
    expect(payload.plan.tasks[0].alternatives[0].model).toBe("gpt-6-luna");
  });

  it("specializes model picks per package & category on the same repo using hierarchical outcomes + CUDA-trained router", () => {
    const pool = resolveRoutingPool(
      {
        mode: "subscriptions",
        subscriptions: ["claude", "local_oss"],
      },
      [
        {
          id: "qwen3-coder-30b-a3b",
          label: "Qwen 3 Coder 30B",
          status: "loaded",
        },
      ],
    );

    const monorepoOutcomes: RepoOutcomesSummary = {
      schemaVersion: "anvilmark.outcomes-summary.v1",
      generatedAt: "2026-11-27T23:00:00.000Z",
      repoName: "acme-monorepo",
      totalRecordedRuns: 33,
      models: [
        {
          model: "qwen3-coder-30b-a3b",
          provider: "am-server",
          taskCategory: "backend",
          pathPrefix: "packages/cli",
          attempts: 12,
          acceptedFirstPass: 11,
          acceptedAfterRetry: 1,
          rejected: 0,
          meanRetries: 0.08,
          meanReworkRatio: 0.03,
          meanInputTokens: 12000,
          meanOutputTokens: 2400,
          lastObservedAt: "2026-11-27T22:50:00.000Z",
        },
        {
          model: "qwen3-coder-30b-a3b",
          provider: "am-server",
          taskCategory: "frontend",
          pathPrefix: "packages/web",
          attempts: 10,
          acceptedFirstPass: 1,
          acceptedAfterRetry: 1,
          rejected: 8,
          meanRetries: 1.9,
          meanReworkRatio: 0.65,
          meanInputTokens: 15000,
          meanOutputTokens: 3200,
          lastObservedAt: "2026-11-27T22:52:00.000Z",
        },
        {
          model: "claude-sonnet-5-5",
          provider: "Anthropic",
          taskCategory: "frontend",
          pathPrefix: "packages/web",
          attempts: 11,
          acceptedFirstPass: 10,
          acceptedAfterRetry: 1,
          rejected: 0,
          meanRetries: 0.09,
          meanReworkRatio: 0.04,
          meanInputTokens: 16000,
          meanOutputTokens: 3400,
          lastObservedAt: "2026-11-27T22:55:00.000Z",
        },
      ],
    };

    const rawMonorepoPlan = {
      title: "Monorepo CLI + Studio Feature",
      goal: "Add CLI parser in packages/cli and React dashboard card in packages/web.",
      users: "Monorepo developers",
      projectScale: "multi_feature",
      scope: ["packages/cli parser", "packages/web dashboard card"],
      nonGoals: [],
      assumptions: [],
      questions: [],
      architecture: [
        {
          title: "Shared JSON contract",
          decision: "Validate shared output JSON.",
          why: "Type safety.",
          alternative: "Loose object",
          tradeoff: "Schema maintenance.",
        },
      ],
      flows: [],
      tasks: [
        {
          id: "cli-backend-slice",
          title: "Implement JSON flag parser in packages/cli",
          outcome: "CLI command emits structured JSON report.",
          dependsOn: [],
          kind: "feature_integration",
          complexity: "medium",
          acceptance: ["packages/cli parser tests pass."],
          checks: ["pnpm test"],
          model: "claude-sonnet-5-5",
          why: "Default pick.",
          alternatives: [],
          inputTokens: 11000,
          outputTokens: 2200,
          estimateBasis: "CLI module.",
        },
        {
          id: "web-ui-slice",
          title: "Build interactive report viewer in packages/web",
          outcome: "React component renders collapsible report sections.",
          dependsOn: ["cli-backend-slice"],
          kind: "crud_ui",
          complexity: "medium",
          acceptance: ["packages/web UI tests pass."],
          checks: ["pnpm test"],
          model: "qwen3-coder-30b-a3b",
          why: "Default pick.",
          alternatives: [],
          inputTokens: 14000,
          outputTokens: 2900,
          estimateBasis: "Web component.",
        },
      ],
      security: [],
    };

    const calibrated = calibratePlanRouting({
      raw: rawMonorepoPlan,
      idea: rawMonorepoPlan.goal,
      candidates: pool.candidates,
      strict: false,
      outcomes: monorepoOutcomes,
      repoStack: {
        languages: ["TypeScript"],
        frameworks: ["Next.js", "React", "Vitest"],
        totalTrackedFiles: 180,
      },
    }) as GeneratedPlan;

    // packages/cli backend slice routes to qwen3-coder-30b-a3b (11/12 first-pass there!)
    expect(calibrated.tasks[0]!.model).toBe("qwen3-coder-30b-a3b");
    // packages/web frontend slice routes to claude-sonnet-5-5 (10/11 first-pass vs 1/10 for qwen!)
    expect(calibrated.tasks[1]!.model).toBe("claude-sonnet-5-5");

    // Verify CUDA-trained neural router utility ordering directly
    const solUtility = predictLearnedSliceUtility({
      kind: "crud_ui",
      complexity: "low",
      projectScale: "small_app",
      candidate: {
        model: "gpt-6.1-sol",
        tier: "balanced",
        billing: "subscription",
        outputUsdPerMillion: 10,
        arenaAgentRank: 5,
      },
      hasRepoObs: false,
      repoWinRate: 0.78,
    });
    const astraUtility = predictLearnedSliceUtility({
      kind: "crud_ui",
      complexity: "low",
      projectScale: "small_app",
      candidate: {
        model: "gpt-6-astra",
        tier: "frontier",
        billing: "subscription",
        outputUsdPerMillion: 50,
        arenaAgentRank: 3,
      },
      hasRepoObs: false,
      repoWinRate: 0.82,
    });
    expect(solUtility).toBeGreaterThan(astraUtility + 0.15);

    // Verify dynamic 1-shot OSS exemplar binding only references active pool models
    const planExemplar = buildMatchedPlanExemplarPrompt({
      idea: "Build an incident status portal in Next.js + Postgres with webhooks",
      effort: "medium",
      candidates: pool.candidates,
    });
    expect(planExemplar).toContain("multi_feature");
    expect(planExemplar).toContain("claude-sonnet-5-5");
    expect(planExemplar).not.toContain("gpt-6-astra");

    const triageExemplar = buildMatchedTriageExemplarPrompt(
      "Build a daily todo list",
      false,
    );
    expect(triageExemplar).toContain("storage-sync");
  });
});
