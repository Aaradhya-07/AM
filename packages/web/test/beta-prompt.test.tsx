// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BetaPrompt } from "../app/beta/prompt";
import type { GeneratedPlan } from "../lib/planner";

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
      model: "gpt-5-mini",
      why: "Well-bounded schema and repository change.",
      alternatives: [
        {
          model: "gpt-5",
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
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("BetaPrompt in-page planner workflow", () => {
  it("transitions to active mode, shows working state, hits /api/plan, and renders the plan", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<BetaPrompt configured={false} serverGemini />);
    });

    const main = host.querySelector("main")!;
    expect(main.getAttribute("data-active")).toBe("false");
    expect(host.textContent).toContain("What are you");

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      setNativeValue(
        textarea,
        "Add idempotent CSV imports with preview and duplicate protection.",
      );
    });

    const form = textarea.closest("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/plan");
    expect(init.method).toBe("POST");
    expect(main.getAttribute("data-active")).toBe("true");
    expect(host.textContent).toContain("Building your plan");
    expect(host.textContent).toContain(
      "Add idempotent CSV imports with preview and duplicate protection.",
    );

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ plan: samplePlan }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    expect(host.textContent).toContain("Safe CSV imports");
    expect(host.textContent).toContain("Scoped uniqueness index");
    expect(host.textContent).toContain("Add scoped uniqueness constraint");
    expect(host.textContent).not.toContain("Building your plan");

    const newPlanButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "New plan",
    );
    expect(newPlanButton).toBeTruthy();
    await act(async () => {
      newPlanButton!.click();
    });
    expect(main.getAttribute("data-active")).toBe("false");

    await act(async () => root.unmount());
  });

  it("shows an inline API key form when /api/plan requires a key and retries with the entered key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Enter your provider API key." }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ plan: samplePlan }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<BetaPrompt configured={false} serverGemini={false} />);
    });

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      setNativeValue(
        textarea,
        "Add idempotent CSV imports with preview and duplicate protection.",
      );
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(host.textContent).toContain("Enter your provider API key.");
    const keyInput = host.querySelector<HTMLInputElement>("#beta-inline-key")!;
    expect(keyInput).toBeTruthy();

    await act(async () => {
      setNativeValue(keyInput, "test-gemini-key");
    });
    await act(async () => {
      keyInput
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(
      String(
        (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body,
      ),
    );
    expect(secondBody.key).toBe("test-gemini-key");
    expect(host.textContent).toContain("Safe CSV imports");

    await act(async () => root.unmount());
  });

  it("lists discovered self-hosted OSS models and submits directly with provider configured", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/plan") {
        return Promise.resolve(
          new Response(JSON.stringify({ plan: samplePlan }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ configured: true, models: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
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
            { id: "gemma-4-12b", label: "Gemma 4 12B", status: "unloaded" },
          ]}
        />,
      );
    });

    expect(host.textContent).toContain("Qwen 3.5 9B");
    expect(host.textContent).toContain("Gemma 4 12B");

    const textarea = host.querySelector("textarea")!;
    await act(async () => {
      setNativeValue(
        textarea,
        "Add idempotent CSV imports with preview and duplicate protection.",
      );
    });
    await act(async () => {
      textarea
        .closest("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    const planCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/plan",
    ) as [string, RequestInit];
    expect(planCall).toBeTruthy();
    const payload = JSON.parse(String(planCall[1].body));
    expect(payload.provider).toBe("configured");
    expect(payload.model).toBe("qwen3.5-9b");
    expect(payload.key).toBe("");
    expect(host.textContent).toContain("Safe CSV imports");

    await act(async () => root.unmount());
  });
});
