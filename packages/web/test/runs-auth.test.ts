import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Who may record conformance telemetry.
 *
 * The feed is an audit trail: a run anyone can forge is worse than no run at
 * all. These tests exist because an earlier gate accepted any token whose name
 * started with a particular prefix, which reads like authentication and is
 * not. Supabase is unconfigured here, so the only verifiable credential is the
 * deployment's own service token.
 */

const body = {
  projectId: "demo-project",
  commitSha: "abc1234",
  agentTrigger: "Local CLI (anvilmark push)",
  status: "pass",
  details: "3/3 rules verified compliant.",
};

async function post(headers: Record<string, string>) {
  const { POST } = await import("../app/api/runs/route");
  return POST(
    new Request("http://localhost/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

afterEach(() => {
  delete process.env.ANVILMARK_API_TOKEN;
  vi.resetModules();
});

describe("POST /api/runs credentials", () => {
  it("refuses a request with no credentials", async () => {
    const response = await post({});
    expect(response.status).toBe(401);
  });

  it("refuses the anonymous session string", async () => {
    const response = await post({ Authorization: "Bearer anon_cli_session" });
    expect(response.status).toBe(401);
  });

  it("refuses an invented token, whatever it is called", async () => {
    // Every one of these is a string a stranger can type.
    for (const token of [
      "am_live_iMadeThisUp",
      "am_live_0000000000000000",
      "am_live_",
      "Bearer am_live_nested",
      "sk_live_lookingOfficial",
    ]) {
      const response = await post({ Authorization: `Bearer ${token}` });
      expect(response.status, token).toBe(401);
    }
  });

  it("accepts the deployment's own service token, and nothing near it", async () => {
    process.env.ANVILMARK_API_TOKEN = "service-secret-value";
    expect(
      (await post({ Authorization: "Bearer service-secret-value" })).status,
    ).toBe(200);
    // A prefix of the secret, or the secret plus anything, is not the secret.
    expect(
      (await post({ Authorization: "Bearer service-secret" })).status,
    ).toBe(401);
    expect(
      (await post({ Authorization: "Bearer service-secret-value-x" })).status,
    ).toBe(401);
  });
});

describe("POST /api/runs details validation", () => {
  async function postWithBody(customBody: Record<string, unknown>) {
    const { POST } = await import("../app/api/runs/route");
    return POST(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer service-secret-value",
        },
        body: JSON.stringify(customBody),
      }),
    );
  }

  it("returns 400 when details contains 'src/app.ts'", async () => {
    process.env.ANVILMARK_API_TOKEN = "service-secret-value";
    const response = await postWithBody({
      ...body,
      details: "Violations found in src/app.ts",
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("details");
  });

  it("returns 400 when details is exactly 'src/app.ts'", async () => {
    process.env.ANVILMARK_API_TOKEN = "service-secret-value";
    const response = await postWithBody({
      ...body,
      details: "src/app.ts",
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("details");
  });

  it("returns 400 when details violates other constraints (length, backslash, newline, forbidden chars)", async () => {
    process.env.ANVILMARK_API_TOKEN = "service-secret-value";
    for (const invalidDetails of [
      "dir/file.py",
      "path\\to\\file",
      "has a \\ backslash",
      "has a \n newline",
      "has a \r return",
      "a".repeat(501),
      "has $dollar",
      "has <tag>",
      123,
      null,
    ]) {
      const response = await postWithBody({
        ...body,
        details: invalidDetails,
      });
      expect(response.status, String(invalidDetails)).toBe(400);
    }
  });

  it("accepts valid details strings", async () => {
    process.env.ANVILMARK_API_TOKEN = "service-secret-value";
    for (const validDetails of [
      "3/3 rules verified compliant.",
      "Synchronized contract schema 0.1.0 (3 decisions, 5 constraints)",
      "Automated architectural boundary check",
      "Ratio: 10/12; compliant (100%) - verified.",
    ]) {
      const response = await postWithBody({
        ...body,
        details: validDetails,
      });
      expect(response.status, validDetails).toBe(200);
    }
  });
});
