import { afterEach, describe, expect, it } from "vitest";

import type { ProjectContract } from "@anvilmark/project-contract";
import { evaluateConformance } from "../src/index.js";
import {
  approvedRemote,
  cleanup,
  declarations,
  materialize,
  scan,
} from "./helpers.js";

afterEach(cleanup);

describe("Milestone 6: Conformance Scenario Tests", () => {
  it("ignores provider names in comments and string literals (not_applicable)", async () => {
    const contract = await approvedRemote();
    const root = await materialize("strings-and-shadowing");
    const scanArtifact = scan(
      root,
      contract,
      declarations({
        include: ["src/strings.ts"],
        sources: [],
        sanitizers: [],
        sinks: [],
      }),
    );

    const report = evaluateConformance({
      contract,
      scan: scanArtifact,
      evaluatedAt: "2026-09-15T12:00:00Z",
    });

    const providerResult = report.results.find(
      (r) => r.rule_kind === "approved_candidate_only",
    );
    expect(providerResult?.verdict, JSON.stringify(providerResult)).toBe(
      "not_applicable",
    );
  });

  it("detects when sanitizer return value is ignored and raw data is sent (fail)", async () => {
    const contract = await approvedRemote();
    const root = await materialize("sanitizer-cases");

    // Scan only the resultIgnored entry
    const scanArtifact = scan(
      root,
      contract,
      declarations({
        components: [
          {
            id: "component.classifier",
            path: "src/cases.ts",
            export: "resultIgnored",
            architecture_node_ref: "ticket-classifier",
            workload_ref: "classification",
          },
        ],
      }),
    );

    const report = evaluateConformance({
      contract,
      scan: scanArtifact,
      evaluatedAt: "2026-09-15T12:00:00Z",
    });

    const flowResult = report.results.find(
      (r) => r.rule_kind === "forbid_dataflow",
    );
    expect(flowResult?.verdict).toBe("fail");
    const traceKinds = flowResult?.trace.map((s) => s.kind) ?? [];
    expect(traceKinds[0]).toBe("source");
    expect(traceKinds[traceKinds.length - 1]).toBe("sink");
    expect(traceKinds).not.toContain("sanitizer");
  });

  it("refuses stale contract approvals", async () => {
    const contract = await approvedRemote();
    const root = await materialize("handoff-approved-sanitized");
    const scanArtifact = scan(root, contract);

    // Create a modified contract with unapproved decision
    const modifiedContract: ProjectContract = {
      ...contract,
      decisions: contract.decisions.map((d) =>
        d.id === "decision.classification"
          ? {
              ...d,
              status: "proposed",
            }
          : d,
      ),
      approvals: [],
    };

    const report = evaluateConformance({
      contract: modifiedContract,
      scan: scanArtifact,
      evaluatedAt: "2026-09-15T12:00:00Z",
    });

    const providerResult = report.results.find(
      (r) => r.rule_kind === "approved_candidate_only",
    );
    expect(providerResult?.verdict).toBe("unknown");
    expect(providerResult?.unknown_reasons).toContain("stale_scan_contract");
  });
});
