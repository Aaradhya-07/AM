import { describe, expect, it } from "vitest";

import { loadAtlasFixture, stableStringify } from "@anvilmark/project-contract";
import { buildGapReport } from "../src/index.js";
import { fixtureContract } from "./helpers.js";

const AS_OF = "2026-09-01T00:00:00Z";
const freshness = { asOf: AS_OF } as const;

describe("the Atlas evidence-gap report", () => {
  it("is deterministic for the same contract and moment", async () => {
    const contract = await loadAtlasFixture();

    const first = buildGapReport(contract, { freshness });
    const second = buildGapReport(contract, { freshness });

    expect(stableStringify(second)).toBe(stableStringify(first));
  });

  it("groups gaps by workload and candidate", async () => {
    const contract = await loadAtlasFixture();
    const report = buildGapReport(contract, { freshness });

    expect(report.project_id).toBe("atlas-support-desk");
    expect(report.workloads.map((entry) => entry.workload_ref)).toEqual([
      "classification",
      "extraction",
      "pii_redaction",
      "response_drafting",
      "retrieval",
    ]);

    const classification = report.workloads.find(
      (entry) => entry.workload_ref === "classification",
    );
    expect(
      classification?.candidates.map((entry) => entry.candidate_ref),
    ).toEqual([
      "candidate.classification.local_unselected",
      "candidate.classification.remote_unselected",
    ]);
  });

  it("reports missing quality measurement independently", async () => {
    const contract = await loadAtlasFixture();
    const report = buildGapReport(contract, { freshness });

    const redaction = report.workloads.find(
      (entry) => entry.workload_ref === "pii_redaction",
    );
    const gap = redaction?.gaps.find(
      (entry) => entry.subject === "workload.pii_redaction.metric.recall",
    );

    expect(gap?.code).toBe("missing_evidence");
    expect(gap?.required_floor).toBe("T3");
    expect(gap?.admissible_kinds).toEqual(["measured_evaluation"]);
    expect(gap?.resolved_outcome).toBe("unknown");
  });

  it("reports a missing target-hardware benchmark independently", async () => {
    const contract = await loadAtlasFixture();
    const report = buildGapReport(contract, { freshness });

    const local = report.workloads
      .find((entry) => entry.workload_ref === "classification")
      ?.candidates.find(
        (entry) =>
          entry.candidate_ref === "candidate.classification.local_unselected",
      );
    const gap = local?.gaps.find(
      (entry) => entry.code === "missing_hardware_benchmark",
    );

    expect(gap?.reason).toContain("hardware.local_gpu_1");
    expect(gap?.required_floor).toBe("T2");
  });

  it("reports a missing provider region independently", async () => {
    const contract = await loadAtlasFixture();
    const report = buildGapReport(contract, { freshness });

    const remote = report.workloads
      .find((entry) => entry.workload_ref === "classification")
      ?.candidates.find(
        (entry) =>
          entry.candidate_ref === "candidate.classification.remote_unselected",
      );

    expect(
      remote?.gaps.some((entry) => entry.code === "missing_provider_region"),
    ).toBe(true);
  });

  it("reports missing pricing independently", async () => {
    const contract = await loadAtlasFixture();
    const report = buildGapReport(contract, { freshness });

    const candidates = report.workloads.flatMap((entry) => entry.candidates);
    expect(
      candidates.every((entry) =>
        entry.gaps.some((gap) => gap.code === "missing_pricing"),
      ),
    ).toBe(true);
  });

  it("reports missing licence independently once a model is named", () => {
    // Atlas names no models yet, so licence is not a gap there. It becomes one
    // as soon as a candidate declares a model without licence evidence.
    const contract = fixtureContract();
    const report = buildGapReport(contract, { freshness });

    const local = report.workloads[0]?.candidates.find(
      (entry) => entry.candidate_ref === "candidate.local",
    );
    const gap = local?.gaps.find((entry) => entry.code === "missing_licence");

    expect(gap?.required_floor).toBe("T2");
    expect(gap?.reason).toContain("never permissive");
  });

  it("never reports a pass; every entry is an unresolved claim", async () => {
    const contract = await loadAtlasFixture();
    const report = buildGapReport(contract, { freshness });

    const every = [
      ...report.project,
      ...report.workloads.flatMap((entry) => [
        ...entry.gaps,
        ...entry.candidates.flatMap((candidate) => candidate.gaps),
      ]),
    ];

    expect(every.length).toBeGreaterThan(0);
    expect(every.every((entry) => entry.resolved_outcome !== "pass")).toBe(
      true,
    );
  });

  it("lists an absent optional tool as a gap rather than a failure", async () => {
    const contract = await loadAtlasFixture();

    const report = buildGapReport(contract, {
      freshness,
      adapters: [
        {
          identity: {
            id: "llmfit",
            kind: "hardware_fit",
            version: null,
            execution: "local",
            protocol_version: "0.1.0-draft.1",
          },
          standing: "unavailable",
          reason: "the tool is not installed",
        },
        {
          identity: {
            id: "promptfoo",
            kind: "evaluation",
            version: null,
            execution: "local",
            protocol_version: "0.1.0-draft.1",
          },
          standing: "unavailable",
          reason: "the tool is not installed",
        },
      ],
    });

    expect(report.adapters.map((entry) => entry.adapter_id)).toEqual([
      "llmfit",
      "promptfoo",
    ]);
    expect(
      report.adapters.every((entry) => entry.standing === "unavailable"),
    ).toBe(true);
  });

  it("omits adapters that are working", async () => {
    const contract = await loadAtlasFixture();

    const report = buildGapReport(contract, {
      freshness,
      adapters: [
        {
          identity: {
            id: "promptfoo",
            kind: "evaluation",
            version: "0.118.4",
            execution: "local",
            protocol_version: "0.1.0-draft.1",
          },
          standing: "available",
          reason: "",
        },
      ],
    });

    expect(report.adapters).toEqual([]);
  });

  it("still produces a report when no optional adapter exists at all", async () => {
    const contract = await loadAtlasFixture();

    // The whole product must work with nothing installed.
    const report = buildGapReport(contract, { freshness });

    expect(report.adapters).toEqual([]);
    expect(report.workloads).toHaveLength(5);
  });
});

/**
 * Existence is not enough to close a category. A record has to be the right
 * kind, correctly attributed, at the required tier, and current.
 */
describe("gap categories require usable evidence, not merely present evidence", () => {
  const OBSERVED = "2026-08-20T00:00:00Z";

  function evidence(
    overrides: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      producer: { name: "source", version: "1.0.0" },
      observed_at: OBSERVED,
      source: { type: "url", locator: "https://example.invalid/doc" },
      confidence: "high",
      caveats: [],
      refresh: { policy: "never" },
      ...overrides,
    };
  }

  const pricing = (overrides: Record<string, unknown> = {}) =>
    evidence({
      id: "evidence.pricing",
      kind: "official_pricing",
      subject: "candidate.local pricing",
      applies_to: {
        candidate_ref: "candidate.local",
        constraint_refs: ["cost.monthly"],
      },
      value: {
        currency: "USD",
        unit: "1k_tokens",
        amount: 0.5,
        exclusions: [],
      },
      ...overrides,
    });

  const licence = (overrides: Record<string, unknown> = {}) =>
    evidence({
      id: "evidence.licence",
      kind: "official_documentation",
      subject: "example-open-model licence",
      applies_to: {
        candidate_ref: "candidate.local",
        constraint_refs: ["cost.monthly"],
      },
      value: { licence: "Apache-2.0" },
      ...overrides,
    });

  const fit = (overrides: Record<string, unknown> = {}) =>
    evidence({
      id: "evidence.fit",
      kind: "tool_observation",
      subject: "candidate.local hardware fit",
      applies_to: {
        candidate_ref: "candidate.local",
        hardware_ref: "hardware.declared_target",
        constraint_refs: ["cost.monthly"],
      },
      value: {
        estimate_basis: {},
        target_hardware_ref: "hardware.declared_target",
        detected_hardware_ref: "hardware.detected_matching",
        findings: { fit_level: "good" },
      },
      ...overrides,
    });

  function gapsFor(
    mutate: (document: Record<string, unknown>) => void,
    asOf = "2026-09-01T00:00:00Z",
  ) {
    const contract = fixtureContract(mutate);
    const report = buildGapReport(contract, { freshness: { asOf } });
    return (
      report.workloads[0]?.candidates.find(
        (entry) => entry.candidate_ref === "candidate.local",
      )?.gaps ?? []
    );
  }

  const codes = (entries: readonly { code: string }[]) =>
    entries.map((entry) => entry.code);

  it("closes pricing only with current, correctly attributed official pricing", () => {
    expect(codes(gapsFor(() => {}))).toContain("missing_pricing");

    const withPricing = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(pricing());
    });
    expect(codes(withPricing)).not.toContain("missing_pricing");
  });

  it("does not let pricing for another candidate close the category", () => {
    const gaps = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(
        pricing({
          applies_to: {
            candidate_ref: "candidate.remote",
            constraint_refs: ["cost.monthly"],
          },
        }),
      );
    });

    expect(codes(gaps)).toContain("missing_pricing");
  });

  it("does not let a vendor claim close the pricing category", () => {
    const gaps = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(
        pricing({ kind: "vendor_claim", value: { amount: 0.5 } }),
      );
    });

    // T1 does not reach the T2 floor for a projected cost comparison.
    expect(codes(gaps)).toContain("missing_pricing");
  });

  it("reports stale pricing separately from missing pricing", () => {
    const gaps = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(
        pricing({
          refresh: { policy: "never", expires_at: "2026-08-25T00:00:00Z" },
        }),
      );
    });

    expect(codes(gaps)).toContain("stale_evidence");
    expect(codes(gaps)).not.toContain("missing_pricing");
  });

  it("closes licence only when the exact referenced record is usable", () => {
    expect(codes(gapsFor(() => {}))).toContain("missing_licence");

    const wired = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(licence());
      const candidates = d.candidates as Record<string, unknown>[];
      (candidates[0]?.model as Record<string, unknown>).license_evidence_ref =
        "evidence.licence";
    });
    expect(codes(wired)).not.toContain("missing_licence");
  });

  it("does not let a different licence record close the category", () => {
    const gaps = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(
        licence({ id: "evidence.other_licence" }),
      );
      const candidates = d.candidates as Record<string, unknown>[];
      (candidates[0]?.model as Record<string, unknown>).license_evidence_ref =
        "evidence.other_licence";
      // The candidate points at a record that exists, but the report must
      // check that exact record, not merely that some licence fact exists.
    });

    expect(codes(gaps)).not.toContain("missing_licence");
  });

  it("reports expired licence evidence as stale", () => {
    const gaps = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(
        licence({
          refresh: { policy: "never", expires_at: "2026-08-25T00:00:00Z" },
        }),
      );
      const candidates = d.candidates as Record<string, unknown>[];
      (candidates[0]?.model as Record<string, unknown>).license_evidence_ref =
        "evidence.licence";
    });

    expect(codes(gaps)).toContain("stale_evidence");
    expect(codes(gaps)).not.toContain("missing_licence");
  });

  it("closes the hardware category only with a current observation of the target", () => {
    expect(codes(gapsFor(() => {}))).toContain("missing_hardware_benchmark");

    const observed = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(fit());
    });
    expect(codes(observed)).not.toContain("missing_hardware_benchmark");
  });

  it("does not let an observation of another machine close the category", () => {
    const gaps = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(
        fit({
          applies_to: {
            candidate_ref: "candidate.local",
            hardware_ref: "hardware.detected_matching",
            constraint_refs: ["cost.monthly"],
          },
          value: {
            estimate_basis: {},
            target_hardware_ref: null,
            detected_hardware_ref: null,
            findings: {},
          },
        }),
      );
    });

    expect(codes(gaps)).toContain("missing_hardware_benchmark");
  });

  it("reports a superseded hardware observation as stale", () => {
    const gaps = gapsFor((d) => {
      (d.evidence_refs as unknown[]).push(
        fit({ refresh: { policy: "periodic", expires_at: null } }),
      );
    }, "2027-01-01T00:00:00Z");

    // A periodic record with no configured window cannot be shown current.
    expect(codes(gaps)).toContain("stale_evidence");
  });
});
