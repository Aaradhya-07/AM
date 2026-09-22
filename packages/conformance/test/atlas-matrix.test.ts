import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateConformance,
  readReport,
  serializeReport,
} from "../src/index.js";
import {
  approvedLocal,
  approvedRemote,
  cleanup,
  materialize,
  scan,
} from "./helpers.js";

afterEach(cleanup);

describe("Milestone 6: Atlas Conformance Matrix", () => {
  describe("Variant 1: Compliant (handoff-approved-sanitized)", () => {
    it("passes both rules deterministically within supported scope", async () => {
      const contract = await approvedRemote();
      const root = await materialize("handoff-approved-sanitized");
      const scanArtifact = scan(root, contract);

      const report = evaluateConformance({
        contract,
        scan: scanArtifact,
        evaluatedAt: "2026-09-15T12:00:00Z",
      });

      expect(report.summary).toEqual({
        total: 2,
        pass: 2,
        fail: 0,
        unknown: 0,
        not_applicable: 0,
        compliant: true,
      });

      const providerResult = report.results.find(
        (r) => r.rule_kind === "approved_candidate_only",
      );
      expect(providerResult).toBeDefined();
      expect(providerResult?.verdict).toBe("pass");
      expect(providerResult?.workload_ref).toBe("classification");
      expect(providerResult?.candidate_ref).toBe(
        "candidate.classification.remote_unselected",
      );
      expect(providerResult?.locations[0]?.path).toBe("src/classify.ts");

      const flowResult = report.results.find(
        (r) => r.rule_kind === "forbid_dataflow",
      );
      expect(flowResult).toBeDefined();
      expect(flowResult?.verdict).toBe("pass");
      expect(flowResult?.constraint_ref).toBe("privacy.raw_ticket_remote");
      expect(flowResult?.architecture_node_ref).toBe("remote-model-provider");
      expect(flowResult?.trace.length).toBeGreaterThan(0);
      expect(flowResult?.trace.map((s) => s.kind)).toContain("sanitizer");
    });
  });

  describe("Variant 2: Direct violation (handoff-disallowed-raw)", () => {
    it("fails both rules with exact file, call site, traces, and contract-approved alternatives", async () => {
      const contract = await approvedLocal();
      const root = await materialize("handoff-disallowed-raw");
      const scanArtifact = scan(root, contract);

      const report = evaluateConformance({
        contract,
        scan: scanArtifact,
        evaluatedAt: "2026-09-15T12:00:00Z",
      });

      expect(report.summary).toEqual({
        total: 2,
        pass: 0,
        fail: 2,
        unknown: 0,
        not_applicable: 0,
        compliant: false,
      });

      // Provider rule failure
      const providerResult = report.results.find(
        (r) => r.rule_kind === "approved_candidate_only",
      );
      expect(providerResult).toBeDefined();
      expect(providerResult?.verdict).toBe("fail");
      expect(providerResult?.workload_ref).toBe("classification");
      expect(providerResult?.decision_ref).toBe("decision.classification");
      expect(providerResult?.locations[0]?.path).toBe("src/classify.ts");
      expect(providerResult?.suggested_alternatives).toEqual([
        expect.objectContaining({
          kind: "restore_approved_local_candidate",
          candidate_ref: "candidate.classification.local_unselected",
        }),
      ]);

      // Dataflow rule failure
      const flowResult = report.results.find(
        (r) => r.rule_kind === "forbid_dataflow",
      );
      expect(flowResult).toBeDefined();
      expect(flowResult?.verdict).toBe("fail");
      expect(flowResult?.constraint_ref).toBe("privacy.raw_ticket_remote");
      expect(flowResult?.locations[0]?.path).toBe("src/classify.ts");
      expect(flowResult?.trace.map((s) => s.kind)).toEqual([
        "source",
        "assignment",
        "sink",
      ]);
      expect(flowResult?.suggested_alternatives).toEqual([
        expect.objectContaining({
          kind: "pass_through_sanitizer",
          component_ref: "pii-redactor",
        }),
      ]);
    });
  });

  describe("Variant 3: Ambiguous runtime path (handoff-ambiguous-runtime)", () => {
    it("evaluates both rules to unknown and refuses to infer pass", async () => {
      const contract = await approvedRemote();
      const root = await materialize("handoff-ambiguous-runtime");
      const scanArtifact = scan(root, contract);

      const report = evaluateConformance({
        contract,
        scan: scanArtifact,
        evaluatedAt: "2026-09-15T12:00:00Z",
      });

      expect(report.summary).toEqual({
        total: 2,
        pass: 0,
        fail: 0,
        unknown: 2,
        not_applicable: 0,
        compliant: false,
      });

      const providerResult = report.results.find(
        (r) => r.rule_kind === "approved_candidate_only",
      );
      expect(providerResult?.verdict).toBe("unknown");
      expect(providerResult?.unknown_reasons).toContain(
        "runtime_selected_import",
      );

      const flowResult = report.results.find(
        (r) => r.rule_kind === "forbid_dataflow",
      );
      expect(flowResult?.verdict).toBe("unknown");
      expect(flowResult?.unknown_reasons).toContain("unresolved_any");
    });
  });

  describe("Determinism and Report Integrity", () => {
    it("produces identical conformance hashes for identical evaluation inputs", async () => {
      const contract = await approvedRemote();
      const root = await materialize("handoff-approved-sanitized");
      const scanArtifact = scan(root, contract);

      const report1 = evaluateConformance({
        contract,
        scan: scanArtifact,
        evaluatedAt: "2026-09-15T12:00:00Z",
      });
      const report2 = evaluateConformance({
        contract,
        scan: scanArtifact,
        evaluatedAt: "2026-09-15T12:00:00Z",
      });

      expect(report1.conformance_hash).toBe(report2.conformance_hash);
      expect(serializeReport(report1)).toBe(serializeReport(report2));
    });

    it("serializes and parses report while validating hash integrity", async () => {
      const contract = await approvedRemote();
      const root = await materialize("handoff-approved-sanitized");
      const scanArtifact = scan(root, contract);

      const report = evaluateConformance({
        contract,
        scan: scanArtifact,
        evaluatedAt: "2026-09-15T12:00:00Z",
      });

      const serialized = serializeReport(report);
      const readBack = readReport(serialized);
      expect(readBack.conformance_hash).toBe(report.conformance_hash);
      expect(readBack.summary.compliant).toBe(true);

      // Tampered hash detection
      const tampered = serialized.replace(
        report.conformance_hash,
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      );
      expect(() => readReport(tampered)).toThrow(/hash mismatch/);
    });
  });
});
