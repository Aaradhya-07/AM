import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSelfHostedPlannerAccess } from "../lib/planner-access";
import { listSelfHostedModels } from "../lib/self-hosted-models";

const { readHeaders } = vi.hoisted(() => ({
  readHeaders: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: readHeaders }));

const endpoint = "https://models.example.com/v1/chat/completions";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ANVILMARK_PLANNER_ENDPOINT", endpoint);
  vi.stubEnv("ANVILMARK_PLANNER_AUTH", "vercel-oidc");
  vi.stubEnv("ANVILMARK_PLANNER_MODELS_URL", "");
  readHeaders.mockResolvedValue(
    new Headers({ "x-vercel-oidc-token": "token" }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("protected model gateway", () => {
  it("requires the deployment token without requiring a visitor account", async () => {
    expect(await getSelfHostedPlannerAccess()).toEqual({
      endpoint,
      token: "token",
    });

    readHeaders.mockResolvedValue(new Headers());
    expect(await getSelfHostedPlannerAccess()).toBeNull();
  });

  it("preserves local HTTP inference and disallows HTTP with Vercel authentication", async () => {
    const localEndpoint = "http://127.0.0.1:8080/v1/chat/completions";
    vi.stubEnv("ANVILMARK_PLANNER_ENDPOINT", localEndpoint);
    expect(await getSelfHostedPlannerAccess()).toBeNull();

    vi.stubEnv("ANVILMARK_PLANNER_AUTH", "");
    expect(await getSelfHostedPlannerAccess()).toEqual({
      endpoint: localEndpoint,
    });
    expect(readHeaders).not.toHaveBeenCalled();
  });

  it("only sends discovery credentials to the configured HTTPS origin", async () => {
    const fetchModels = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [{ id: "test-model" }] }));
    vi.stubGlobal("fetch", fetchModels);
    expect(await listSelfHostedModels()).toEqual([]);
    vi.stubEnv(
      "ANVILMARK_PLANNER_MODELS_URL",
      "https://other.example.com/v1/models",
    );
    expect(await listSelfHostedModels("token")).toEqual([]);
    expect(fetchModels).not.toHaveBeenCalled();

    vi.stubEnv("ANVILMARK_PLANNER_MODELS_URL", "");
    expect(await listSelfHostedModels("token")).toMatchObject([
      { id: "test-model" },
    ]);
    expect(fetchModels).toHaveBeenCalledWith(
      "https://models.example.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });
});
