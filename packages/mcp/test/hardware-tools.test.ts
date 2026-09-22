import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createPlanningInput } from "@anvilmark/hardware-sizing";
// @ts-expect-error plain ESM protocol harness shared with verification script
import { startStdioServer } from "../scripts/stdio-client.mjs";
const server = resolve("bin/anvilmark-project-mcp.mjs");
async function connect(flags: string[]) {
  const client = startStdioServer(process.execPath, [
    server,
    "--project-dir",
    "/tmp/anvilmark-unused-hardware-test",
    "--as-of",
    "2026-09-18T00:00:00Z",
    ...flags,
  ]);
  await client.initialize({ name: "hardware-test", version: "1" });
  return client;
}
describe("explicit hardware MCP capabilities", () => {
  it("keeps the default surface at eight tools and requires a sizing opt-in", async () => {
    const client = await connect([]);
    try {
      const list = await client.request("tools/list", {});
      expect(list.result.tools).toHaveLength(8);
      expect(
        list.result.tools.some((t: { name: string }) =>
          t.name.includes("hardware"),
        ),
      ).toBe(false);
    } finally {
      await client.close();
    }
  });
  it("adds pure calculators with strict schemas and reproducible output", async () => {
    const client = await connect(["--hardware-sizing"]);
    try {
      const list = await client.request("tools/list", {});
      expect(list.result.tools).toHaveLength(10);
      const tool = list.result.tools.find(
        (t: { name: string }) => t.name === "estimate_hardware_fit",
      );
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations.openWorldHint).toBe(false);
      const args = {
        name: "estimate_hardware_fit",
        arguments: { input: createPlanningInput() },
      };
      const first = await client.request("tools/call", args);
      const second = await client.request("tools/call", args);
      expect(first.result).toEqual(second.result);
      expect(
        JSON.parse(first.result.content[0].text).result.contract_evidence,
      ).toBe("unattached");
      const bad = await client.request("tools/call", {
        name: "estimate_hardware_fit",
        arguments: { input: createPlanningInput(), host: "private-host" },
      });
      expect(bad.error ?? bad.result?.isError).toBeTruthy();
    } finally {
      await client.close();
    }
  });
  it("exposes bounded local capabilities only by opt-in, without SSH destinations", async () => {
    const client = await connect(["--hardware-probe"]);
    try {
      const list = await client.request("tools/list", {});
      expect(list.result.tools).toHaveLength(10);
      for (const name of [
        "probe_local_hardware",
        "discover_local_model_inventory",
      ]) {
        const t = list.result.tools.find(
          (t: { name: string }) => t.name === name,
        );
        expect(t.inputSchema.additionalProperties).toBe(false);
        expect(t.inputSchema.properties).toEqual({});
        expect(t.annotations).toMatchObject({
          readOnlyHint: true,
          openWorldHint: true,
          idempotentHint: false,
        });
      }
      expect(
        list.result.tools.some((t: { name: string }) => t.name.includes("ssh")),
      ).toBe(false);
    } finally {
      await client.close();
    }
  });
});
