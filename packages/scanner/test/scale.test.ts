import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ScanArtifact } from "../src/index.js";
import {
  artifactOf,
  atlas,
  callIn,
  cleanup,
  declarations,
  materialize,
  scan,
} from "./helpers.js";

/**
 * How the flow analysis behaves on code too wide or too dynamic to track in
 * full. Every bound below may only widen what is reported: a value that is
 * summarized still reaches the call, and a property that stops being tracked
 * individually is still read through the catch-all member.
 */

afterEach(cleanup);

async function scanSource(source: string): Promise<ScanArtifact> {
  const root = await materialize("direct-call", ["openai"]);
  await writeFile(join(root, "src/classify.ts"), source);
  return artifactOf(scan(root, await atlas(), declarations()));
}

describe("values too large to track in full", () => {
  it("summarizes unresolved values past the cap, still reporting them as unresolved", async () => {
    const parts = Array.from(
      { length: 80 },
      (_, index) =>
        `  parts.push(String((globalThis as Record<string, () => unknown>).source${index}?.()));`,
    ).join("\n");
    const artifact = await scanSource(`import OpenAI from "openai";
const client = new OpenAI();
export async function classifyTicket(id: string) {
  const parts: string[] = [id];
${parts}
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: parts.join(" ") }],
  });
}
`);
    const { flow } = callIn(artifact, "classifyTicket");
    expect(flow.status).toBe("unresolved");
    const reasons = new Set(flow.unknown_reasons);
    // The individual points past the cap become one summary, so the call
    // still reports that something unresolved reaches it.
    expect(reasons.has("analysis_budget_exceeded")).toBe(true);
    expect(
      flow.contexts.flatMap((context) => context.unknowns).length,
    ).toBeLessThan(80);
  });

  it("keeps reading a wide object's fields through the catch-all member", async () => {
    const fields = Array.from(
      { length: 120 },
      (_, index) => `  field${index}: "constant ${index}",`,
    ).join("\n");
    const artifact = await scanSource(`import OpenAI from "openai";
import { readTicket } from "./tickets";
const client = new OpenAI();
export async function classifyTicket(id: string) {
  const record = {
${fields}
    ticket: readTicket(id),
  };
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: record.ticket }],
  });
}
`);
    const { flow } = callIn(artifact, "classifyTicket");
    // The declared source is the 121st field, past the tracked width, so it
    // is read through the catch-all member -- and still reaches the call.
    expect(flow.status).toBe("raw_reaches");
    expect(flow.classifications).toContain("raw_customer_ticket:raw");
  });

  it("does not make a value conditional by joining it with itself", async () => {
    const artifact = await scanSource(`import OpenAI from "openai";
import { readTicket } from "./tickets";
const client = new OpenAI();
export async function classifyTicket(id: string) {
  const ticket = readTicket(id);
  const content = id.length > 3 ? ticket : ticket;
  return client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content }],
  });
}
`);
    const { flow } = callIn(artifact, "classifyTicket");
    expect(flow.status).toBe("raw_reaches");
    expect(
      flow.contexts.flatMap((context) =>
        context.facts.map((fact) => fact.conditional),
      ),
    ).toEqual([false]);
  });
});
