import { describe, expect, it } from "vitest";

import { fixedClock, importManualEvidence, isAvailable } from "../src/index.js";
import { FIXED_TIMES } from "./helpers.js";

const clock = () => fixedClock(...FIXED_TIMES);

const ATTRIBUTED = {
  publisher: "Example Provider",
  locator: "https://example.invalid/pricing",
  retrieved_at: "2026-08-20T00:00:00Z",
};

function pricing(overrides: Record<string, unknown> = {}) {
  return {
    id: "evidence.pricing.example",
    subject: "pricing",
    claim: "published price per 1k input tokens",
    exact_subject: "example-managed-model",
    exact_version: "2026-06-01",
    source: ATTRIBUTED,
    applies_to: {
      candidate_ref: "candidate.remote",
      constraint_refs: ["cost.monthly"],
    },
    currency: "USD",
    unit: "1k_input_tokens",
    amount: 0.5,
    region: "eu-west-1",
    tier: "standard",
    exclusions: ["does not include storage or egress"],
    assumptions: ["40000 calls per month at 900 input tokens"],
    ...overrides,
  };
}

describe("the manual evidence importer", () => {
  it("records attributable pricing as official pricing", () => {
    const outcome = importManualEvidence(pricing(), { clock: clock() });

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.value.record.kind).toBe("official_pricing");
    expect(outcome.value.tier).toBe("T2");

    const value = outcome.value.record.value as {
      currency: string;
      unit: string;
      region: string | null;
      exclusions: string[];
    };
    expect(value.currency).toBe("USD");
    expect(value.unit).toBe("1k_input_tokens");
    expect(value.region).toBe("eu-west-1");
    expect(value.exclusions).toContain("does not include storage or egress");
  });

  it("keeps the retrieval time and publisher", () => {
    const outcome = importManualEvidence(pricing(), { clock: clock() });
    if (!isAvailable(outcome)) throw new Error("expected an import");

    expect(outcome.value.record.observed_at).toBe("2026-08-20T00:00:00Z");
    expect(outcome.value.record.producer.name).toBe("Example Provider");
    expect(outcome.value.record.source.locator).toBe(
      "https://example.invalid/pricing",
    );
  });

  it("downgrades a claim with no publisher to a vendor claim", () => {
    const outcome = importManualEvidence(
      pricing({ source: { ...ATTRIBUTED, publisher: null } }),
      { clock: clock() },
    );

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    // A copied claim without an attributable source stays T1, never T2.
    expect(outcome.value.record.kind).toBe("vendor_claim");
    expect(outcome.value.tier).toBe("T1");
    expect(outcome.diagnostics.join(" ")).toContain("vendor claim");
  });

  it("downgrades a claim with no source locator to a vendor claim", () => {
    const outcome = importManualEvidence(
      pricing({ source: { ...ATTRIBUTED, locator: null } }),
      { clock: clock() },
    );

    if (!isAvailable(outcome)) throw new Error("expected an import");
    expect(outcome.value.tier).toBe("T1");
    expect(outcome.value.record.caveats.join(" ")).toContain("attributable");
  });

  it("imports licence, residency, provider capability, and model documentation", () => {
    for (const subject of [
      "licence",
      "residency",
      "provider_capability",
      "model_documentation",
    ]) {
      const outcome = importManualEvidence(
        {
          id: `evidence.${subject}`,
          subject,
          claim: `published ${subject} fact`,
          exact_subject: "example-managed-model",
          exact_version: "2026-06-01",
          source: ATTRIBUTED,
          applies_to: {
            candidate_ref: "candidate.remote",
            constraint_refs: ["policy.example"],
          },
          details: { note: "as published" },
        },
        { clock: clock() },
      );

      expect(outcome.standing).toBe("available");
      if (!isAvailable(outcome)) continue;
      expect(outcome.value.record.kind).toBe("official_documentation");
      expect(outcome.value.tier).toBe("T2");
    }
  });

  it("refuses an import with no constraint attribution", () => {
    const outcome = importManualEvidence(
      pricing({
        applies_to: { candidate_ref: "candidate.remote", constraint_refs: [] },
      }),
      { clock: clock() },
    );

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("schema_rejected");
  });

  it("refuses an import with no retrieval time", () => {
    const outcome = importManualEvidence(
      pricing({
        source: { publisher: "Example", locator: "https://example.invalid" },
      }),
      { clock: clock() },
    );

    expect(outcome.standing).toBe("failed");
  });

  it("refuses an import carrying a credential", () => {
    const outcome = importManualEvidence(
      pricing({
        assumptions: [
          "fetched with sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD",
        ],
      }),
      { clock: clock() },
    );

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("secret_detected");
  });

  it("carries an expiry when one is supplied", () => {
    const outcome = importManualEvidence(
      pricing({ expires_at: "2026-12-31T00:00:00Z" }),
      { clock: clock() },
    );

    if (!isAvailable(outcome)) throw new Error("expected an import");
    expect(outcome.value.record.refresh.expires_at).toBe(
      "2026-12-31T00:00:00Z",
    );
  });
});
