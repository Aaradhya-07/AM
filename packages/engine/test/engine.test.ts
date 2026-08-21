import type { AuditInput } from "@anvilmark/contract";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/index.js";

const input: AuditInput = {
  components: [],
  constraints: {
    budgetMonthlyUsd: null,
    deployment: "cloud",
    privacyRequirements: [],
    latencyRequirementMs: null,
  },
  repoPath: null,
};

describe("runAudit", () => {
  it("returns a contract-valid fixture while the engine is stubbed", async () => {
    const result = await runAudit(input);

    expect(result.schemaVersion).toBe("0.1.0");
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
