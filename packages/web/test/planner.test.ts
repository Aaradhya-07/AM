import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/plan/route";
import {
  estimateCost,
  makeHandoff,
  type GeneratedPlan,
  type PlanningInput,
} from "../lib/planner";
import {
  deriveModelsUrl,
  listSelfHostedModels,
} from "../lib/self-hosted-models";

const request: PlanningInput = {
  idea: "Prevent duplicate CSV imports.",
  context: "Use the existing database.",
  provider: "google",
  model: "gemini-3.1-flash-lite",
  key: "test-key",
  strict: true,
  candidates: [
    { model: "gpt-5-mini", billing: "api", notes: "" },
    { model: "gpt-5", billing: "subscription", notes: "" },
  ],
};

const draft: GeneratedPlan = {
  title: "Repeatable imports",
  goal: "Prevent duplicate rows",
  users: "Import operators",
  scope: ["Avoid duplicate external IDs"],
  nonGoals: [],
  assumptions: ["Records have stable external IDs"],
  questions: [],
  architecture: [
    {
      title: "Deduplication at write time",
      decision: "Use a scoped uniqueness constraint.",
      why: "Concurrent imports must share the same invariant.",
      alternative: "Deduplicate in memory.",
      tradeoff: "In-memory checks cannot coordinate concurrent importers.",
    },
  ],
  flows: [],
  tasks: [
    {
      id: "deduplicate",
      title: "Enforce uniqueness",
      outcome: "Repeated rows are skipped.",
      dependsOn: [],
      acceptance: ["Repeat imports preserve row count."],
      checks: ["Run import integration tests."],
      model: "gpt-5-mini",
      why: "The task has a narrow, testable scope.",
      alternatives: [
        {
          model: "gpt-5",
          tradeoff: "Use if broader migration design is needed.",
        },
      ],
      inputTokens: 10_000,
      outputTokens: 2_000,
      estimateBasis:
        "One attempt with the importer and integration tests in context.",
    },
  ],
  security: [
    {
      risk: "Rows can cross tenant boundaries",
      control: "Scope uniqueness by tenant.",
      verification:
        "Run a regression test with two tenants using the same external ID.",
    },
  ],
};

function providerResponse(plan: GeneratedPlan) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(plan) }] } }],
    }),
  );
}

function submit(body = request) {
  return POST(
    new Request("http://localhost/api/plan", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("planning route", () => {
  it("uses the selected provider and excludes credentials from model messages and output", async () => {
    const fetch = vi.fn().mockResolvedValue(providerResponse(draft));
    vi.stubGlobal("fetch", fetch);
    const response = await submit();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ plan: draft });
    const [url, upstream] = fetch.mock.calls[0]!;
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(upstream.headers["x-goog-api-key"]).toBe("test-key");
    expect(upstream.body).not.toContain(request.key);
    expect(upstream.redirect).toBe("error");
  });

  it("falls back to the server-side Gemini key when the form key is empty", async () => {
    vi.stubEnv("ANVILMARK_GEMINI_API_KEY", "server-test-key");
    const fetch = vi.fn().mockResolvedValue(providerResponse(draft));
    vi.stubGlobal("fetch", fetch);
    const response = await submit({ ...request, key: "" });
    expect(response.status).toBe(200);
    const upstream = fetch.mock.calls[0]![1];
    expect(upstream.headers["x-goog-api-key"]).toBe("server-test-key");
    expect(upstream.body).not.toContain("server-test-key");
  });

  it("falls back to the server-side OpenAI key when the form key is empty", async () => {
    vi.stubEnv("ANVILMARK_OPENAI_API_KEY", "server-openai-key");
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(draft) } }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await submit({
      ...request,
      provider: "openai",
      model: "gpt-5-mini",
      key: "",
    });
    expect(response.status).toBe(200);
    const [url, upstream] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(upstream.headers.Authorization).toBe("Bearer server-openai-key");
    expect(upstream.body).not.toContain("server-openai-key");
  });

  it("rejects unknown execution models and missing Strict mode verification", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        providerResponse({
          ...draft,
          tasks: [{ ...draft.tasks[0]!, model: "unavailable-model" }],
        }),
      )
      .mockResolvedValueOnce(providerResponse({ ...draft, security: [] }));
    vi.stubGlobal("fetch", fetch);
    expect((await submit()).status).toBe(502);
    expect((await submit()).status).toBe(502);
  });

  it("prices known API rates and preserves the original brief without copying credentials", () => {
    const task = draft.tasks[0]!;
    expect(estimateCost(task, request.candidates[0]!)?.usd).toBeCloseTo(0.0065);
    expect(estimateCost(task, request.candidates[1]!)).toBeNull();
    const handoff = makeHandoff(draft, true, {
      idea: request.idea,
      context: request.context,
    });
    expect(handoff).toContain("Strict verification requirements");
    expect(handoff).toContain(request.idea);
    expect(handoff).not.toContain(request.key);
  });

  it("sends structured json_schema requests to configured self-hosted endpoints and parses <think>-wrapped output", async () => {
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `<think>checking constraints</think>\n${JSON.stringify(draft)}`,
              },
            },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await submit({
      ...request,
      provider: "configured",
      model: "qwen3.5-9b",
      key: "",
    });
    expect(response.status).toBe(200);
    const [url, upstream] = fetch.mock.calls[0]!;
    expect(url).toBe("http://am-server:8080/v1/chat/completions");
    const sent = JSON.parse(upstream.body);
    expect(sent.model).toBe("qwen3.5-9b");
    expect(sent.response_format.type).toBe("json_schema");
    expect(
      sent.response_format.json_schema.schema.properties.tasks.items.properties
        .model.enum,
    ).toEqual(["gpt-5-mini", "gpt-5"]);
  });

  it("discovers self-hosted models from /v1/models with loaded models sorted first", async () => {
    expect(deriveModelsUrl("http://am-server:8080/v1/chat/completions")).toBe(
      "http://am-server:8080/v1/models",
    );
    vi.stubEnv(
      "ANVILMARK_PLANNER_ENDPOINT",
      "http://am-server:8080/v1/chat/completions",
    );
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "gemma-4-12b", status: { value: "unloaded" } },
            { id: "qwen3.5-9b", status: { value: "loaded" } },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const models = await listSelfHostedModels();
    expect(models.map((item) => item.id)).toEqual([
      "qwen3.5-9b",
      "gemma-4-12b",
    ]);
    expect(models[0]?.label).toBe("Qwen 3.5 9B");
    expect(models[0]?.status).toBe("loaded");
  });
});
