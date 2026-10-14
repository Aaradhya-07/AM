import { describe, expect, it } from "vitest";

import { validateProjectContract } from "@anvilmark/project-contract";

import { createDraftContract, demoExample } from "../lib/draft-contract";
import {
  MODEL_STARTERS,
  candidateFromStarter,
  starterFit,
} from "../lib/model-starters";

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
    expect(draft.architecture.nodes).toHaveLength(3);
    expect(draft.architecture.relationships).toHaveLength(2);
    expect(
      draft.architecture.nodes.every((node) => node.trust_boundary === "local"),
    ).toBe(true);
  });

  it("rejects an invalid privacy data label before export", () => {
    expect(() =>
      createDraftContract(
        { ...demoExample, inputClassification: "Customer Ticket" },
        "2026-10-14T00:00:00.000Z",
      ),
    ).toThrow("lower_snake_case");
  });

  it("exports a redaction path as a draft graph without approving it", () => {
    const draft = createDraftContract(
      { ...demoExample, architecturePattern: "redacted_remote" },
      "2026-10-14T00:00:00.000Z",
    );
    const result = validateProjectContract(draft);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.issues)).toBe(
      true,
    );
    expect(
      draft.architecture.nodes.find((node) => node.id === "redactor")
        ?.trust_boundary,
    ).toBe("local");
    expect(
      draft.architecture.nodes.find((node) => node.id === "model-provider")
        ?.trust_boundary,
    ).toBe("remote_provider");
    expect(
      draft.architecture.relationships.find(
        (edge) => edge.id === "redactor-to-provider",
      )?.data_classification,
    ).toBe("redacted_customer_ticket");
    expect(draft.intent.unresolved_questions).toContain(
      "Does the local redactor remove prohibited data before remote transfer?",
    );
    expect(draft.approvals).toHaveLength(0);
  });

  it("blocks a direct remote path for local-only input", () => {
    expect(() =>
      createDraftContract(
        { ...demoExample, architecturePattern: "direct_remote" },
        "2026-10-14T00:00:00.000Z",
      ),
    ).toThrow("conflicts with the declared local-only data boundary");
  });

  it("allows a direct remote draft when the user permits remote input", () => {
    const draft = createDraftContract(
      {
        ...demoExample,
        privacy: "remote_allowed",
        architecturePattern: "direct_remote",
      },
      "2026-10-14T00:00:00.000Z",
    );
    expect(validateProjectContract(draft).ok).toBe(true);
    expect(draft.architecture.relationships.at(-1)?.data_classification).toBe(
      "customer_ticket",
    );
  });
});

describe("sourced model starting points", () => {
  it("fills the candidate path and reports boundary fit without treating a profile as evidence", () => {
    const haiku = MODEL_STARTERS.find(
      (starter) => starter.id === "claude-haiku-5-5",
    )!;
    expect(candidateFromStarter(haiku)).toMatchObject({
      model: "claude-haiku-5-5",
      deployment: "managed_api",
      provider: "anthropic",
    });
    expect(starterFit(haiku, demoExample)).toContain("Conflicts");
    expect(
      starterFit(haiku, {
        ...demoExample,
        architecturePattern: "redacted_remote",
      }),
    ).toContain("verified redaction");
    expect(haiku.sourceUrl).toMatch(/^https:\/\//);
  });
});
