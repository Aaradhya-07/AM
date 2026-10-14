import { describe, expect, it } from "vitest";

import { validateProjectContract } from "@anvilmark/project-contract";

import { createDraftContract, demoExample } from "../lib/draft-contract";

describe("browser draft contract", () => {
  it("exports a full-validator-compatible draft with explicit unknowns", () => {
    const draft = createDraftContract(demoExample, "2026-10-14T00:00:00.000Z");
    const result = validateProjectContract(draft);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.issues)).toBe(
      true,
    );
    expect(draft.project.state).toBe("draft");
    expect(draft.workloads[0]?.expected_usage.calls_per_month).toBeNull();
    expect(draft.candidates).toHaveLength(2);
    expect(
      draft.candidates.every((candidate) => candidate.status === "unevaluated"),
    ).toBe(true);
    expect(draft.decisions).toHaveLength(0);
    expect(draft.approvals).toHaveLength(0);
  });

  it("rejects an invalid privacy data label before export", () => {
    expect(() =>
      createDraftContract(
        { ...demoExample, inputClassification: "Customer Ticket" },
        "2026-10-14T00:00:00.000Z",
      ),
    ).toThrow("lower_snake_case");
  });
});
