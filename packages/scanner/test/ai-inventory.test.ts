import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AiInventory } from "../src/index.js";
import { inventoryRepository } from "../src/index.js";
import { cleanup, materialize } from "./helpers.js";

/**
 * The zero-configuration inventory: what one repository uses, with no
 * project, contract or declarations. Environment variables appear by name
 * only; no value is ever read.
 */

afterEach(cleanup);

async function inventoryOf(): Promise<AiInventory> {
  const root = await materialize("direct-call", [
    "openai",
    "@anthropic-ai/sdk",
    "@openai/agents-realtime",
  ]);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "direct-call",
      private: true,
      dependencies: {
        openai: "^4.0.0",
        "@anthropic-ai/sdk": "^0.30.0",
        "@openai/agents-realtime": "^0.0.5",
      },
    }),
  );
  await writeFile(
    join(root, "src/summarize.ts"),
    `import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
export async function summarize(text: string) {
  return anthropic.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 100,
    messages: [{ role: "user", content: text }],
  });
}
`,
  );
  await writeFile(
    join(root, "src/realtime.ts"),
    `import { RealtimeSession } from "@openai/agents-realtime";
export function session() {
  return new RealtimeSession({ model: "gpt-realtime" });
}
`,
  );
  return inventoryRepository({ repositoryPath: root }).inventory;
}

describe("inventoryRepository", () => {
  it("reports destinations, models, call sites, unsupported SDKs, dependencies and environment names", async () => {
    const inventory = await inventoryOf();

    expect(inventory.format).toBe("anvilmark-ai-inventory/0.1.0-draft.1");
    expect(
      inventory.destinations.map((entry) => [
        entry.destination,
        entry.hosts,
        entry.call_count,
        entry.operation_kinds,
      ]),
    ).toEqual([
      ["anthropic", ["api.anthropic.com"], 1, ["inference"]],
      ["openai", ["api.openai.com"], 1, ["inference"]],
    ]);
    expect(
      inventory.models.map((entry) => [entry.model, entry.destinations]),
    ).toEqual([
      ["claude-3-5-sonnet-latest", ["anthropic"]],
      ["gpt-4o-mini", ["openai"]],
    ]);
    expect(
      inventory.calls.map((call) => [
        call.path,
        call.symbol,
        call.sdk,
        call.operation,
        call.destination,
        call.model,
      ]),
    ).toEqual([
      [
        "src/classify.ts",
        "classifyTicket",
        "openai",
        "chat.completions.create",
        "openai",
        "gpt-4o-mini",
      ],
      [
        "src/summarize.ts",
        "summarize",
        "anthropic",
        "messages.create",
        "anthropic",
        "claude-3-5-sonnet-latest",
      ],
    ]);

    // An AI SDK with no recognizer is named, never inventoried as a call.
    expect(inventory.unsupported_sdks).toEqual([
      { package: "@openai/agents-realtime", files: ["src/realtime.ts"] },
    ]);
    expect(
      inventory.dependencies.map((entry) => [entry.name, entry.category]),
    ).toEqual([
      ["@anthropic-ai/sdk", "provider_sdk"],
      ["@openai/agents-realtime", "unsupported_ai_sdk"],
      ["openai", "provider_sdk"],
    ]);
    // Names only, and only where an AI SDK is used.
    expect(inventory.environment_variables).toEqual([
      { name: "ANTHROPIC_API_KEY", files: ["src/summarize.ts"] },
    ]);
    expect(JSON.stringify(inventory)).not.toContain("sk-");

    const unsupported = inventory.uncertainty.locations.filter(
      (entry) => entry.reason === "unsupported_provider_sdk",
    );
    expect(unsupported.length).toBeGreaterThan(0);
    // Uncertainty about a listed call is marked, so a reader can tell it
    // apart from usage missing from the list altogether.
    expect(unsupported.every((entry) => !entry.listed_call)).toBe(true);
    expect(inventory.uncertainty.all_unknowns).toBeGreaterThanOrEqual(
      inventory.uncertainty.ai_related_unknowns,
    );
  });

  it("says plainly when it recognized nothing, without claiming there is nothing", async () => {
    const root = await materialize("direct-call", []);
    await writeFile(
      join(root, "src/classify.ts"),
      "export const nothing = 1;\n",
    );
    const { inventory } = inventoryRepository({ repositoryPath: root });
    expect(inventory.calls).toEqual([]);
    expect(inventory.destinations).toEqual([]);
    expect(inventory.statement).toContain("not proof");
  });
});
