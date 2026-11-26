import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { cleanup } from "../../cli/test/helpers.js";
import { repo } from "../../cli/test/slice-fixture.js";
// @ts-expect-error plain ESM protocol harness shared with verification script
import { startStdioServer } from "../scripts/stdio-client.mjs";

afterEach(cleanup);

async function connectStudioServer(root: string) {
  const client = startStdioServer(process.execPath, [
    resolve("bin/anvilmark-project-mcp.mjs"),
    "--project-dir",
    root,
    "--slice-execution",
    "--local-studio",
  ]);
  await client.initialize({ name: "local-studio-test", version: "1.0.0" });
  return client;
}

it("serves ui://anvilmark/cockpit.html MCP App resource and executes prepare_planning_context -> lock_execution_plan -> open_anvilmark_cockpit over stdio", async () => {
  const root = await repo();
  const client = await connectStudioServer(root);

  try {
    // 1. Verify MCP App UI resource registration
    const resourcesRes = await client.request("resources/list", {});
    const cockpitRes = resourcesRes.result.resources.find(
      (r: { uri: string }) => r.uri === "ui://anvilmark/cockpit.html",
    );
    expect(cockpitRes).toBeDefined();
    expect(cockpitRes.mimeType).toBe("text/html;profile=mcp-app");

    const readRes = await client.request("resources/read", {
      uri: "ui://anvilmark/cockpit.html",
    });
    expect(readRes.result.contents[0].mimeType).toBe(
      "text/html;profile=mcp-app",
    );
    expect(readRes.result.contents[0].text).toContain(
      "ANVILMARK CONTROL COCKPIT",
    );

    // 2. Verify tool metadata includes MCP App resourceUri & Antigravity entrypoints
    const toolsRes = await client.request("tools/list", {});
    const openCockpitTool = toolsRes.result.tools.find(
      (t: { name: string }) => t.name === "open_anvilmark_cockpit",
    );
    expect(openCockpitTool?._meta?.ui?.resourceUri).toBe(
      "ui://anvilmark/cockpit.html",
    );
    expect(
      openCockpitTool?._meta?.["com.google.antigravity/ui"]?.entrypoints,
    ).toEqual([
      { type: "aux_pane", title: "AnvilMark Cockpit" },
      { type: "global", title: "AnvilMark Cockpit" },
    ]);

    // 3. Call prepare_planning_context with exhausted frontier quota
    const prep = await client.request("tools/call", {
      name: "prepare_planning_context",
      arguments: {
        goal: "Add webhook signature verification",
        quota_mode: "exhausted",
      },
    });
    const prepStruct = prep.result.structuredContent;
    expect(prepStruct.ok).toBe(true);
    expect(prepStruct.repo_context.version).toBe("anvilmark.repo-context.v1");
    expect(
      prepStruct.ranked_candidates.every(
        (c: { billing: string; tier: string }) =>
          c.billing === "local" || c.tier !== "frontier",
      ),
    ).toBe(true);

    // 4. Call lock_execution_plan and verify deterministic SliceContractSpec + repo files
    const lock = await client.request("tools/call", {
      name: "lock_execution_plan",
      arguments: {
        strict: true,
        quota_mode: "conserve",
        plan: {
          title: "Webhook Signature Gate",
          goal: "Verify HMAC-SHA256 webhook signatures before enqueueing.",
          users: "Webhook consumers",
          scope: ["Add HMAC verifier in packages/api"],
          nonGoals: ["UI dashboard"],
          assumptions: [],
          questions: [],
          architecture: [
            {
              title: "Constant-time HMAC compare",
              decision: "Use timingSafeEqual over raw request bytes.",
              why: "Prevents timing side channels.",
              alternative: "String equality",
              tradeoff: "Requires raw body buffer.",
            },
          ],
          flows: [
            {
              from: "Webhook Sender",
              to: "packages/api/webhook",
              data: "Signed JSON body",
              boundary: "HMAC-SHA256 verification gate",
            },
          ],
          tasks: [
            {
              id: "hmac-verifier",
              title: "Implement packages/api webhook verifier",
              outcome: "Rejects invalid signatures with 401.",
              dependsOn: [],
              acceptance: ["Tampered payloads return 401."],
              checks: ["npm test"],
              model: "gpt-6.1-sol",
              why: "Fast accurate TypeScript slice.",
              alternatives: [
                {
                  model: "qwen3-coder-30b",
                  tradeoff: "Zero-cost local fallback.",
                },
              ],
              inputTokens: 9000,
              outputTokens: 1600,
              estimateBasis: "Verifier + unit test.",
            },
          ],
          security: [
            {
              risk: "Replay attack",
              control: "Enforce 5-minute timestamp window.",
              verification: "Stale timestamp negative test.",
            },
          ],
        },
      },
    });
    expect(lock.result.isError).toBeUndefined();
    expect(lock.result.structuredContent.locked).toBe(true);
    expect(
      lock.result.structuredContent.slices[0].contract.allowedGlobs,
    ).toEqual(["packages/api/**"]);
    expect(
      lock.result.structuredContent.slices[0].contract.reviewerFamily,
    ).not.toBe("openai");

    const claudeMd = await readFile(join(root, "CLAUDE.md"), "utf8");
    expect(claudeMd).toContain("Webhook Signature Gate");

    // 5. Call open_anvilmark_cockpit with empty arguments {} (entrypoint contract)
    const cockpit = await client.request("tools/call", {
      name: "open_anvilmark_cockpit",
      arguments: {},
    });
    expect(cockpit.result.structuredContent.activePlan.title).toBe(
      "Webhook Signature Gate",
    );
    expect(cockpit.result.structuredContent.slices).toHaveLength(1);
  } finally {
    await client.close();
  }
});
