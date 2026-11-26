import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { SliceVerificationReportSchema } from "@anvilmark/conformance";
import { cleanup } from "../../cli/test/helpers.js";
import { put, repo } from "../../cli/test/slice-fixture.js";
// @ts-expect-error plain ESM protocol harness shared with verification script
import { startStdioServer } from "../scripts/stdio-client.mjs";

afterEach(cleanup);

async function connect(root: string, execution: boolean) {
  const client = startStdioServer(process.execPath, [
    resolve("bin/anvilmark-project-mcp.mjs"),
    "--project-dir",
    root,
    ...(execution ? ["--slice-execution"] : []),
  ]);
  await client.initialize({ name: "slice-test", version: "1" });
  return client;
}

it("keeps slice execution opt-in and exposes four strict tools", async () => {
  const root = await repo();
  const base = await connect(root, false);
  try {
    expect((await base.request("tools/list", {})).result.tools).toHaveLength(8);
  } finally {
    await base.close();
  }
  const client = await connect(root, true);
  try {
    const list = (await client.request("tools/list", {})).result.tools;
    expect(list.slice(-4).map(({ name }: { name: string }) => name)).toEqual([
      "list_plan_slices",
      "get_slice_contract",
      "verify_slice",
      "record_slice_outcome",
    ]);
    expect(list.at(-1).inputSchema.additionalProperties).toBe(false);
    const response = await client.request("tools/call", {
      name: "get_slice_contract",
      arguments: { slice_id: "labels" },
    });
    expect(response.result.structuredContent).toMatchObject({
      id: "labels",
      contract: { allowDependencyChanges: false },
    });
  } finally {
    await client.close();
  }
});

it("verifies current changes, refuses acceptance on violations, and lists recorded outcomes", async () => {
  const root = await repo();
  const client = await connect(root, true);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.request("tools/call", { name, arguments: args })).result;
  const input = {
    slice_id: "labels",
    status: "accepted",
    configured_model: "gpt",
    attempts: 1,
    retries: 0,
    input_tokens: 10,
  };
  try {
    await put(root, "src/new.ts", "export const a = 1;");
    expect(
      SliceVerificationReportSchema.parse(
        (await call("verify_slice", { slice_id: "labels", run_checks: false }))
          .structuredContent,
      ).changedFiles,
    ).toEqual(["src/new.ts"]);
    const accepted = await call("record_slice_outcome", input);
    expect(accepted.structuredContent).toMatchObject({
      recorded: true,
      outcome: { configured_model: "gpt", verification_passed: true },
    });
    await put(root, "outside.ts", "const private_source = 1;");
    const refused = await call("record_slice_outcome", input);
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toMatchObject({
      recorded: false,
      verification: { passed: false },
    });
    const listed = await call("list_plan_slices", {});
    expect(listed.structuredContent.tasks[0]).toMatchObject({
      latestVerification: { passed: false },
      latestOutcome: { status: "accepted" },
    });
    const invalid = await client.request("tools/call", {
      name: "get_slice_contract",
      arguments: { slice_id: "../../escape" },
    });
    expect(invalid.error ?? invalid.result?.isError).toBeTruthy();
  } finally {
    await client.close();
  }
});

it("keeps read-only verification static and requires exact approval for custom commands", async () => {
  const root = await repo();
  const { fixture } = await import("../../cli/test/slice-fixture.js");
  const bundle = fixture();
  bundle.plan.tasks[0]!.contract!.verificationCommands = [
    "printf human-approved",
  ];
  await put(root, ".anvilmark/development/active-plan.json", bundle);
  const connectWithFlags = async (...flags: string[]) => {
    const client = startStdioServer(process.execPath, [
      resolve("bin/anvilmark-project-mcp.mjs"),
      "--project-dir",
      root,
      ...flags,
    ]);
    await client.initialize({ name: "slice-test", version: "1" });
    return client;
  };
  const verify = { name: "verify_slice", arguments: { slice_id: "labels" } };
  const read = await connectWithFlags("--slice-read-only");
  try {
    expect((await read.request("tools/list", {})).result.tools).toHaveLength(
      11,
    );
    const reply = await read.request("tools/call", verify);
    expect(reply.result.structuredContent).toMatchObject({
      passed: true,
      checkResults: [],
    });
    const run = await read.request("tools/call", {
      ...verify,
      arguments: { ...verify.arguments, run_checks: true },
    });
    expect(run.result.isError).toBe(true);
  } finally {
    await read.close();
  }
  const execution = await connectWithFlags(
    "--slice-execution",
    "--allow-check",
    "printf human-approved",
  );
  try {
    const reply = await execution.request("tools/call", verify);
    const report = SliceVerificationReportSchema.parse(
      reply.result.structuredContent,
    );
    expect(report).toMatchObject({
      passed: true,
      checkResults: [{ exitCode: 0 }],
    });
    expect(report.checkResults[0]!.outputExcerpt).not.toContain(
      "human-approved",
    );
  } finally {
    await execution.close();
  }
});
