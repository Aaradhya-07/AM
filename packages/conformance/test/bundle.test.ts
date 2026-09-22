import { describe, expect, it } from "vitest";

import { contractHash } from "@anvilmark/context";
import {
  assembleWebReviewBundle,
  computeBundleIntegrityHash,
  readWebReviewBundle,
  redactContractForSharing,
} from "../src/bundle.js";
import type { WebReviewEnvelope } from "../src/bundle.js";
import { reportConformanceHash } from "../src/schemas.js";
import type { ConformanceReport } from "../src/schemas.js";
import { approvedRemote, materialize, scan } from "./helpers.js";
import { evaluateConformance } from "../src/engine.js";

async function evaluated() {
  const contract = await approvedRemote();
  const root = await materialize("handoff-approved-sanitized");
  const scanArtifact = scan(root, contract);
  const report = evaluateConformance({
    contract,
    scan: scanArtifact,
    evaluatedAt: "2026-09-15T12:00:00Z",
  });
  return { contract, scanArtifact, report };
}

function errorsOf(bundle: unknown): string {
  const reading = readWebReviewBundle(bundle);
  return reading.status === "invalid" ? reading.errors.join("\n") : "";
}

function reseal(bundle: WebReviewEnvelope): WebReviewEnvelope {
  const { integrity_hash, ...content } = bundle;
  void integrity_hash;
  return { ...content, integrity_hash: computeBundleIntegrityHash(content) };
}

describe("WebReviewEnvelope and bundle reading", () => {
  it("assembles a valid bundle with contract, scan, and report", async () => {
    const { contract, scanArtifact, report } = await evaluated();

    const bundle = assembleWebReviewBundle({
      contract,
      scan: { artifact: scanArtifact, freshness: "current" },
      report: { artifact: report, freshness: "current" },
      sources: {
        "src/classify.ts": "const x = 1;",
      },
      sourcesOmitted: [{ path: "src/secret.ts", reason: "possible_secret" }],
      sourceControl: { head_sha: "abc123", dirty: false },
      exportedAt: "2026-09-16T12:00:00Z",
    });

    expect(bundle.format).toBe("anvilmark-review-bundle/1");
    expect(bundle.projection).toBe("local");
    expect(bundle.project.id).toBe(contract.project.id);
    expect(bundle.scan).toMatchObject({
      status: "available",
      freshness: "current",
    });
    expect(bundle.report).toMatchObject({
      status: "available",
      freshness: "current",
    });
    expect(bundle.manifest.has_source).toBe(true);
    expect(bundle.manifest.sources_omitted).toHaveLength(1);

    const reading = readWebReviewBundle(bundle);
    expect(reading.status).toBe("valid");
    if (reading.status === "valid") {
      expect(reading.bundle.integrity_hash).toBe(bundle.integrity_hash);
    }
  });

  it("rejects a bundle with tampered contract content", async () => {
    const contract = await approvedRemote();
    const bundle = assembleWebReviewBundle({ contract });

    // Tamper with contract name
    const tampered = {
      ...bundle,
      contract: {
        ...bundle.contract,
        canonical: {
          ...bundle.contract.canonical,
          project: {
            ...bundle.contract.canonical.project,
            name: "Tampered Project Name",
          },
        },
      },
    };

    expect(errorsOf(tampered)).toContain("Contract content hash mismatch");
  });

  it("rejects a bundle with tampered integrity hash", async () => {
    const contract = await approvedRemote();
    const bundle = assembleWebReviewBundle({ contract });

    const tampered = {
      ...bundle,
      integrity_hash:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    };

    expect(errorsOf(tampered)).toContain("Bundle integrity hash mismatch");
  });

  it("assembles a bundle without scan or report (draft / incomplete state)", async () => {
    const contract = await approvedRemote();
    const bundle = assembleWebReviewBundle({
      contract,
      report: {
        artifact: null,
        status: "error",
        problems: ["the stored report does not match its own hash"],
      },
    });

    expect(bundle.scan).toMatchObject({
      status: "missing",
      freshness: null,
      artifact: null,
    });
    expect(bundle.report).toMatchObject({
      status: "error",
      freshness: null,
      artifact: null,
    });
    expect(readWebReviewBundle(bundle).status).toBe("valid");
  });

  it("redacts identities, local paths and credential references for sharing", async () => {
    const { contract, scanArtifact, report } = await evaluated();
    const bundle = assembleWebReviewBundle({
      contract,
      projection: "shareable",
      scan: { artifact: scanArtifact, freshness: "current" },
      report: { artifact: report, freshness: "current" },
    });

    const shared = bundle.contract.canonical;
    expect(bundle.projection).toBe("shareable");
    expect(bundle.contract.content_hash).toBe(contractHash(contract));
    expect(bundle.contract.redactions.length).toBeGreaterThan(0);
    expect(shared.project.repository_roots).toEqual([]);
    expect(shared.project.owners).toEqual([]);
    expect(shared.repository_bindings).toEqual([]);
    for (const approval of shared.approvals) {
      expect(approval.actor.ref).toBe("redacted");
    }
    for (const integration of shared.integrations) {
      if ("credential_ref" in integration) {
        expect(integration.credential_ref).toBeNull();
      }
    }
    // Decision-layer content that a reviewer needs is kept.
    expect(shared.decisions).toEqual(contract.decisions);
    expect(shared.conformance_rules).toEqual(contract.conformance_rules);
    expect(readWebReviewBundle(bundle).status).toBe("valid");
  });

  it("does not modify the contract it redacts", async () => {
    const contract = await approvedRemote();
    const before = JSON.stringify(contract);
    redactContractForSharing(contract);
    expect(JSON.stringify(contract)).toBe(before);
  });

  it("rejects a local bundle that lists redactions", async () => {
    const contract = await approvedRemote();
    const bundle = assembleWebReviewBundle({ contract });
    const tampered = reseal({
      ...bundle,
      contract: { ...bundle.contract, redactions: ["project.owners"] },
    });
    expect(errorsOf(tampered)).toContain("must not list contract redactions");
  });

  it("requires a report for another contract to be marked stale", async () => {
    const { contract, report } = await evaluated();
    const otherContract = {
      ...report,
      contract: {
        ...report.contract,
        contract_hash: `sha256:${"b".repeat(64)}`,
      },
    } satisfies ConformanceReport;
    const resealed = {
      ...otherContract,
      conformance_hash: reportConformanceHash(otherContract),
    };

    const claimedCurrent = assembleWebReviewBundle({
      contract,
      report: { artifact: resealed, freshness: "current" },
    });
    expect(errorsOf(claimedCurrent)).toContain("is not marked stale");

    const markedStale = assembleWebReviewBundle({
      contract,
      report: {
        artifact: resealed,
        freshness: "stale",
        problems: ["contract changed"],
      },
    });
    expect(readWebReviewBundle(markedStale).status).toBe("valid");
  });

  it("rejects a current report that was evaluated on a different scan", async () => {
    const { contract, scanArtifact, report } = await evaluated();
    const otherScan = {
      ...report,
      scan: { ...report.scan, content_hash: `sha256:${"c".repeat(64)}` },
    } satisfies ConformanceReport;
    const bundle = assembleWebReviewBundle({
      contract,
      scan: { artifact: scanArtifact, freshness: "current" },
      report: {
        artifact: {
          ...otherScan,
          conformance_hash: reportConformanceHash(otherScan),
        },
        freshness: "current",
      },
    });
    expect(errorsOf(bundle)).toContain("evaluated on a different scan");
  });

  it("rejects an artifact whose status says it is missing", async () => {
    const { contract, report } = await evaluated();
    const bundle = assembleWebReviewBundle({ contract });
    const tampered = reseal({
      ...bundle,
      report: { ...bundle.report, artifact: report },
    });
    expect(errorsOf(tampered)).toContain(
      "Report status is missing but an artifact is included",
    );
  });
});
