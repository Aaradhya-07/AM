import { lstat, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { SliceVerificationReportSchema } from "@anvilmark/conformance";
import { afterEach, expect, it, type TestContext } from "vitest";

import { startBridge } from "../src/commands/bridge.js";
import { ArchitectureDriftReportSchema } from "../src/commands/drift.js";
import { RepoOutcomesSummarySchema } from "../src/commands/outcomes.js";
import { cleanup, exists } from "./helpers.js";
import { fixture, git, now, put, repo } from "./slice-fixture.js";

afterEach(cleanup);

async function listen(
  context: TestContext,
  root: string,
  extra: Parameters<typeof startBridge>[0] = { root },
) {
  try {
    return await startBridge({
      port: 0,
      host: "127.0.0.1",
      clock: () => now,
      ...extra,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM")
      context.skip("Sandbox blocks loopback listen");
    throw error;
  }
}

it("uses ephemeral loopback, requires authentication, validates Host and CORS, and secures the token file", async (context) => {
  const root = await repo();
  await expect(startBridge({ root, host: "0.0.0.0", port: 0 })).rejects.toThrow(
    /127.0.0.1/,
  );
  await expect(
    startBridge({
      root,
      allowOrigins: ["https://studio.example/path"],
      port: 0,
    }),
  ).rejects.toThrow(/origin/i);
  const bridge = await listen(context, root, {
    root,
    tokenFile: true,
    allowOrigins: ["https://studio.example"],
  });
  try {
    expect(bridge.url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*$/);
    expect(bridge.token).toMatch(/^[a-f0-9]{64}$/);
    const health = bridge.url + "/v1/health";
    expect((await fetch(health)).status).toBe(401);
    expect((await fetch(health + "?token=" + bridge.token)).status).toBe(401);
    expect(
      (
        await fetch(health, {
          headers: { Authorization: "Bearer " + "f".repeat(64) },
        })
      ).status,
    ).toBe(401);
    const denied = await fetch(health, {
      headers: {
        Origin: "http://localhost:3000.evil.example",
        Authorization: "Bearer " + bridge.token,
      },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    const preflight = await fetch(bridge.url + "/v1/verify-slice", {
      method: "OPTIONS",
      headers: {
        Origin: "https://studio.example",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://studio.example",
    );
    const response = await fetch(health, {
      headers: {
        Origin: "http://127.0.0.1:3000",
        "X-Anvilmark-Bridge-Token": bridge.token,
      },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(await response.json()).toEqual({
      ok: true,
      version: "1",
      repoName: "label-service",
      projectDir: root,
      hasActivePlan: true,
    });
    const secretPath = join(root, ".anvilmark/development/bridge.json");
    expect((await lstat(secretPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(secretPath, "utf8"))).toEqual({
      url: bridge.url,
      token: bridge.token,
    });
  } finally {
    await bridge.close();
  }
});

it("serves exact reports and authenticated SSE events, rejects oversized and malformed bodies", async (context) => {
  const root = await repo(null);
  const bridge = await listen(context, root);
  const headers = {
    Authorization: "Bearer " + bridge.token,
    "Content-Type": "application/json",
  };
  const get = (path: string) => fetch(bridge.url + "/v1/" + path, { headers });
  const post = (path: string, data: unknown) =>
    fetch(bridge.url + "/v1/" + path, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
  const stream = new AbortController();
  try {
    expect((await fetch(bridge.url + "/v1/events")).status).toBe(401);
    const response = await fetch(
      bridge.url + "/v1/events?token=" + bridge.token,
      { signal: stream.signal },
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let events = "";
    const readThrough = async (event: string) => {
      while (!events.includes(event)) {
        const next = await reader.read();
        if (next.done) throw new Error("Bridge closed the event stream early");
        events += decoder.decode(next.value, { stream: true });
      }
    };
    await readThrough(": connected");
    expect(
      ArchitectureDriftReportSchema.parse(await (await get("drift")).json())
        .status,
    ).toBe("no_active_plan");
    expect(
      RepoOutcomesSummarySchema.parse(await (await get("outcomes")).json())
        .models,
    ).toEqual([]);
    expect(await (await get("context")).json()).toMatchObject({
      version: "anvilmark.repo-context.v1",
    });
    expect((await post("apply-plan", "x".repeat(2 * 1024 * 1024))).status).toBe(
      413,
    );
    expect((await post("apply-plan", { version: "bad" })).status).toBe(400);
    expect((await post("verify-slice", { sliceId: "../../x" })).status).toBe(
      400,
    );
    expect(
      (await post("verify-slice", { sliceId: "labels", runChecks: "true" }))
        .status,
    ).toBe(400);
    const applied = await post("apply-plan", fixture());
    expect(await applied.json()).toEqual({
      applied: true,
      writtenFiles: [
        ".anvilmark/development/active-plan.json",
        "PLAN.md",
        "CLAUDE.md",
        ".cursor/rules/anvilmark-plan.mdc",
        "AGENTS.md",
      ],
    });
    await readThrough("event: plan_applied");
    git(
      root,
      "add",
      "--",
      "PLAN.md",
      "CLAUDE.md",
      ".cursor/rules/anvilmark-plan.mdc",
      "AGENTS.md",
    );
    git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "Plan",
    );
    await put(root, "src/index.ts", "const private_source_marker = 1;");
    const report = SliceVerificationReportSchema.parse(
      await (await post("verify-slice", { sliceId: "labels" })).json(),
    );
    expect(report).toMatchObject({
      passed: true,
      changedFiles: ["src/index.ts"],
    });
    await readThrough("event: slice_status");
    await readThrough("event: drift_updated");
    expect(events).not.toContain("private_source_marker");
  } finally {
    stream.abort();
    await bridge.close();
  }
});

it("leaves active-plan and instruction files intact when any apply destination is unsafe", async (context) => {
  const root = await repo();
  const original = await readFile(
    join(root, ".anvilmark/development/active-plan.json"),
    "utf8",
  );
  await put(root, "private.txt", "original bytes");
  await symlink(join(root, "private.txt"), join(root, "AGENTS.md"));
  const bridge = await listen(context, root);
  try {
    const bundle = fixture();
    bundle.masterPrompt = "Updated plan.";
    const reply = await fetch(bridge.url + "/v1/apply-plan", {
      method: "POST",
      headers: { Authorization: "Bearer " + bridge.token },
      body: JSON.stringify(bundle),
    });
    expect(reply.status).toBe(422);
    expect(
      await readFile(
        join(root, ".anvilmark/development/active-plan.json"),
        "utf8",
      ),
    ).toBe(original);
    expect(await readFile(join(root, "private.txt"), "utf8")).toBe(
      "original bytes",
    );
    expect(await exists(join(root, "PLAN.md"))).toBe(false);
    expect(await exists(join(root, ".cursor"))).toBe(false);
  } finally {
    await bridge.close();
  }
});

it("keeps browser-supplied checks inert unless locally approved", async (context) => {
  const bundle = fixture();
  bundle.plan.tasks[0]!.contract!.verificationCommands = [
    "printf marker > src/created.ts",
  ];
  const root = await repo(bundle);
  const bridge = await listen(context, root);
  try {
    const response = await fetch(bridge.url + "/v1/verify-slice", {
      method: "POST",
      headers: { Authorization: "Bearer " + bridge.token },
      body: JSON.stringify({ sliceId: "labels", runChecks: true }),
    });
    expect(
      SliceVerificationReportSchema.parse(await response.json()),
    ).toMatchObject({
      passed: false,
      checkResults: [{ exitCode: 126 }],
    });
    expect(await exists(join(root, "src/created.ts"))).toBe(false);
  } finally {
    await bridge.close();
  }
});
