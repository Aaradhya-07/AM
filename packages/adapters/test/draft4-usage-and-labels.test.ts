import { describe, expect, it } from "vitest";

import {
  buildGapReport,
  buildIntelligenceRequest,
  buildProjection,
} from "../src/index.js";
import { fixtureContract } from "./helpers.js";

/**
 * Adapter behaviour for draft.4 amendments 6 and 7
 * (docs/vnext/08-milestone-3-scope-proposal.md).
 */

type Doc = Record<string, unknown>;
const workload = (document: Doc) =>
  (document.workloads as Record<string, unknown>[])[0] as Record<
    string,
    unknown
  >;

describe("unknown usage is reported, never read as zero", () => {
  it("adds a missing_usage gap for a workload with unknown monthly calls", () => {
    const contract = fixtureContract((document) => {
      workload(document).expected_usage = {
        basis: "unknown",
        calls_per_month: null,
        input_tokens_per_call: 900,
        output_tokens_per_call: 60,
      };
    });
    const report = buildGapReport(contract, {
      freshness: { asOf: "2026-09-14T00:00:00Z" },
    });
    const gaps =
      report.workloads.find((entry) => entry.workload_ref === "classification")
        ?.gaps ?? [];
    const missing = gaps.filter((entry) => entry.code === "missing_usage");
    expect(missing).toEqual([
      expect.objectContaining({
        subject: "workload.classification.expected_usage.calls_per_month",
        resolved_outcome: "unknown",
        required_floor: "T1",
      }),
    ]);
  });

  it("reports no missing_usage when the volume is declared", () => {
    const report = buildGapReport(fixtureContract(), {
      freshness: { asOf: "2026-09-14T00:00:00Z" },
    });
    expect(
      report.workloads
        .flatMap((entry) => entry.gaps)
        .some((entry) => entry.code === "missing_usage"),
    ).toBe(false);
  });

  it("projects unknown usage as null with its basis, and tells the intelligence what null means", () => {
    const contract = fixtureContract((document) => {
      workload(document).expected_usage = {
        basis: "unknown",
        calls_per_month: null,
      };
    });
    const built = buildIntelligenceRequest(contract, {
      task: "clarify_intent",
      execution: "remote",
    });
    const projected = (
      built.request.projection.workloads as { expected_usage: unknown }[]
    )[0];
    expect(projected?.expected_usage).toMatchObject({
      basis: "unknown",
      calls_per_month: null,
    });
    expect(built.request.instructions).toContain("calls_per_month null");
    expect(built.request.instructions).toContain("output_classification null");
  });
});

describe("declared output labels reach the projection; undeclared ones do not", () => {
  it("includes a declared output classification in data_classification_labels", () => {
    const contract = fixtureContract((document) => {
      workload(document).output_classification = "ticket_routing_decision";
    });
    const projection = buildProjection(contract, {
      execution: "local",
      additionalFields: ["data_classification_labels"],
    });
    expect(projection.payload.data_classification_labels).toEqual([
      "raw_ticket",
      "ticket_routing_decision",
    ]);
  });

  it("adds nothing for an undeclared output classification", () => {
    const projection = buildProjection(fixtureContract(), {
      execution: "local",
      additionalFields: ["data_classification_labels"],
    });
    expect(projection.payload.data_classification_labels).toEqual([
      "raw_ticket",
    ]);
  });
});
