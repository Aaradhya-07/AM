import { describe, expect, it } from "vitest";

import { TOOL_NAMES, createServer } from "../src/server.js";

describe("Anvilmark MCP server", () => {
  it("constructs with exactly the three scaffold tools", () => {
    expect(createServer()).toBeDefined();
    expect(TOOL_NAMES).toEqual([
      "audit_system",
      "explain_finding",
      "estimate_cost",
    ]);
  });
});
