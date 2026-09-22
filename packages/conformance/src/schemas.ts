import { z } from "zod/v4";

import {
  RefSchema,
  TimestampSchema,
  stableStringify,
} from "@anvilmark/project-contract";
import { LocationSchema, TraceStepSchema, sha256 } from "@anvilmark/scanner";

import { CONFORMANCE_REPORT_FORMAT } from "./version.js";

/**
 * Conformance verdict semantics (Milestone 6):
 * - pass: Sufficient in-scope evidence proves the rule is satisfied.
 * - fail: Sufficient in-scope evidence proves a violation.
 * - unknown: The rule applies, but evidence or analysis scope cannot prove pass/fail.
 * - not_applicable: The rule does not apply to this declared subject/revision.
 */
export const ConformanceVerdictSchema = z.enum([
  "pass",
  "fail",
  "unknown",
  "not_applicable",
]);

export type ConformanceVerdict = z.infer<typeof ConformanceVerdictSchema>;

export const RemediationAlternativeSchema = z.strictObject({
  kind: z.enum([
    "call_approved_candidate",
    "use_allowed_candidate",
    "pass_through_sanitizer",
    "restore_approved_local_candidate",
  ]),
  summary: z.string(),
  candidate_ref: RefSchema.nullable(),
  component_ref: RefSchema.nullable(),
  details: z.string().nullable(),
});

export type RemediationAlternative = z.infer<
  typeof RemediationAlternativeSchema
>;

export const ConformanceResultRecordSchema = z.strictObject({
  id: z.string(),
  rule_ref: z.string(),
  rule_kind: z.enum([
    "forbid_dataflow",
    "provider_allowlist",
    "approved_candidate_only",
  ]),
  severity: z.enum(["error", "warning"]),
  verdict: ConformanceVerdictSchema,
  constraint_ref: RefSchema.nullable(),
  workload_ref: RefSchema.nullable(),
  decision_ref: RefSchema.nullable(),
  candidate_ref: RefSchema.nullable(),
  architecture_node_ref: RefSchema.nullable(),
  evidence_tier: z.enum(["T0", "T1", "T2", "T3"]),
  standing: z.enum(["deterministic", "inferred"]),
  locations: z.array(LocationSchema),
  trace: z.array(TraceStepSchema),
  supported_scope: z.string(),
  unknown_reasons: z.array(z.string()),
  caveats: z.array(z.string()),
  suggested_alternatives: z.array(RemediationAlternativeSchema),
  explanation: z.string(),
  content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

export type ConformanceResultRecord = z.infer<
  typeof ConformanceResultRecordSchema
>;

export const ConformanceReportSummarySchema = z.strictObject({
  total: z.int(),
  pass: z.int(),
  fail: z.int(),
  unknown: z.int(),
  not_applicable: z.int(),
  compliant: z.boolean(),
});

export type ConformanceReportSummary = z.infer<
  typeof ConformanceReportSummarySchema
>;

export const ConformanceReportSchema = z.strictObject({
  format: z.literal(CONFORMANCE_REPORT_FORMAT),
  conformance_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  evaluated_at: TimestampSchema,
  engine: z.strictObject({
    id: z.string(),
    version: z.string(),
  }),
  contract: z.strictObject({
    project_id: z.string(),
    contract_revision: z.int(),
    contract_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    state_revision: z.int().nullable(),
  }),
  scan: z.strictObject({
    content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    observed_at: TimestampSchema,
    scanner_version: z.string(),
    repository_root: z.string(),
    configuration_source: z.enum(["default", "file"]),
    configuration_path: z.string().nullable(),
    snapshot_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }),
  summary: ConformanceReportSummarySchema,
  results: z.array(ConformanceResultRecordSchema),
  analysis_errors: z.array(z.string()),
});

export type ConformanceReport = z.infer<typeof ConformanceReportSchema>;

export type ConformanceReportContent = Omit<
  ConformanceReport,
  "conformance_hash" | "evaluated_at"
>;

export function resultRecordContentHash(
  recordOrContent:
    ConformanceResultRecord | Omit<ConformanceResultRecord, "content_hash">,
): string {
  if ("content_hash" in recordOrContent) {
    const { content_hash, ...content } = recordOrContent;
    void content_hash;
    return sha256(stableStringify(content));
  }
  return sha256(stableStringify(recordOrContent));
}

export function reportConformanceHash(
  reportOrContent: ConformanceReport | ConformanceReportContent,
): string {
  // Wall-clock observation/evaluation times are provenance, not input identity.
  const { observed_at, ...scan } = reportOrContent.scan;
  void observed_at;
  return sha256(
    stableStringify({
      format: reportOrContent.format,
      engine: reportOrContent.engine,
      contract: reportOrContent.contract,
      scan,
      summary: reportOrContent.summary,
      results: reportOrContent.results,
      analysis_errors: reportOrContent.analysis_errors,
    }),
  );
}

export function summarizeResults(
  results: readonly ConformanceResultRecord[],
  errors: readonly string[] = [],
): ConformanceReportSummary {
  const count = (verdict: ConformanceVerdict) =>
    results.filter((r) => r.verdict === verdict).length;
  return {
    total: results.length,
    pass: count("pass"),
    fail: count("fail"),
    unknown: count("unknown"),
    not_applicable: count("not_applicable"),
    compliant:
      errors.length === 0 && count("fail") === 0 && count("unknown") === 0,
  };
}
