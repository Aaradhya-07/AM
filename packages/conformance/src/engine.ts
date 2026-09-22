import { assertTimestamp, contractHash } from "@anvilmark/context";
import type { ProjectContract } from "@anvilmark/project-contract";
import type { ScanArtifact } from "@anvilmark/scanner";
import {
  assessArtifactStanding,
  readArtifact,
  serializeArtifact,
  SCANNER_VERSION,
  FLOW_MODEL,
} from "@anvilmark/scanner";
import { evaluateForbidDataflowRule } from "./rules/forbid-dataflow.js";
import { evaluateProviderRule } from "./rules/provider-allowlist.js";
import { resultRecord } from "./rules/shared.js";
import type { ConformanceReport, ConformanceResultRecord } from "./schemas.js";
import { reportConformanceHash, summarizeResults } from "./schemas.js";
import {
  CONFORMANCE_ENGINE_ID,
  CONFORMANCE_ENGINE_VERSION,
  CONFORMANCE_REPORT_FORMAT,
} from "./version.js";

export interface ConformanceEvaluationInput {
  readonly contract: ProjectContract;
  /** A complete, self-consistent snapshot. Filesystem callers must recheck freshness. */
  readonly scan: ScanArtifact;
  readonly stateRevision?: number | null;
  readonly evaluatedAt?: string;
}

export function evaluateConformance(
  input: ConformanceEvaluationInput,
): ConformanceReport {
  const { contract, scan } = input;
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  assertTimestamp(evaluatedAt);
  const reading = readArtifact(serializeArtifact(scan));
  const analysisErrors =
    reading.status !== "valid"
      ? ["invalid_scan_artifact"]
      : scan.analysis_errors.map(
          (e) => `${e.kind}: ${e.path ?? ""}${e.code ? ` (${e.code})` : ""}`,
        );
  const standing = assessArtifactStanding(scan, contract);
  const unusable =
    !standing.current ||
    !standing.contract_revision_matches ||
    scan.contract.project_id !== contract.project.id
      ? "stale_scan_contract"
      : scan.scanner.version !== SCANNER_VERSION ||
          scan.scanner.flow_model.id !== FLOW_MODEL.id ||
          scan.scanner.flow_model.version !== FLOW_MODEL.version
        ? "stale_scanner_version"
        : null;
  const results: ConformanceResultRecord[] = [];
  // Execution errors are separate from conformance verdicts. Do not fabricate
  // per-rule pass/fail/unknown results from an invalid analysis.
  if (analysisErrors.length === 0)
    for (const rule of contract.conformance_rules) {
      results.push(
        unusable !== null
          ? resultRecord(rule, contract, scan, {
              verdict: "unknown",
              unknown_reasons: [unusable],
              explanation:
                "The scan does not describe the current contract and supported detector. Rescan before evaluating this rule.",
            })
          : rule.kind === "forbid_dataflow"
            ? evaluateForbidDataflowRule({ rule, contract, scan })
            : evaluateProviderRule({ rule, contract, scan }),
      );
    }
  results.sort((a, b) =>
    a.rule_ref < b.rule_ref ? -1 : a.rule_ref > b.rule_ref ? 1 : 0,
  );
  const content = {
    format: CONFORMANCE_REPORT_FORMAT,
    engine: { id: CONFORMANCE_ENGINE_ID, version: CONFORMANCE_ENGINE_VERSION },
    contract: {
      project_id: contract.project.id,
      contract_revision: contract.project.contract_revision,
      contract_hash: contractHash(contract),
      state_revision:
        input.stateRevision === undefined
          ? scan.contract.state_revision
          : input.stateRevision,
    },
    scan: {
      content_hash: scan.content_hash,
      observed_at: scan.observation.observed_at,
      scanner_version: scan.scanner.version,
      repository_root: scan.repository.root,
      configuration_source: scan.configuration.source,
      configuration_path: scan.configuration.path,
      snapshot_hash: scan.repository.snapshot_hash,
    },
    summary: summarizeResults(results, analysisErrors),
    results,
    analysis_errors: analysisErrors,
  };
  return {
    ...content,
    conformance_hash: reportConformanceHash(content),
    evaluated_at: evaluatedAt,
  };
}
