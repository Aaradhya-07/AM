import { z } from "zod/v4";
import type {
  DecisionStanding,
  ProjectionName,
  SourceMarker,
} from "@anvilmark/context";
import { approvalStandingLine, buildProjectFacts } from "@anvilmark/context";
import type { ProjectContract } from "@anvilmark/project-contract";
import type { ScanArtifact } from "@anvilmark/scanner";
import { evaluateConformance } from "./engine.js";
import { currentDecision } from "./rules/shared.js";
import type { ConformanceResultRecord } from "./schemas.js";
import { summarizeResults } from "./schemas.js";

export type ConformanceToolName =
  "run_conformance" | "check_proposed_change" | "get_conformance_result";
export interface ConformanceQueryContext {
  readonly contract: ProjectContract;
  readonly stateRevision: number | null;
  readonly asOf: string;
  readonly projection: ProjectionName;
  /** Fresh snapshot supplied and rechecked by the filesystem adapter. */
  readonly scan: ScanArtifact | null;
  readonly scanStatus?: "missing" | "unavailable";
}
export interface ConformanceEnvelope<T = unknown> {
  readonly ok: true;
  readonly tool: ConformanceToolName;
  readonly source: SourceMarker;
  readonly approval_standing: {
    readonly summary: string;
    readonly decisions: readonly {
      readonly id: string;
      readonly standing: DecisionStanding;
      readonly instruction_eligible: boolean;
    }[];
    readonly note: string;
  };
  readonly disclosure: string;
  readonly authority: string;
  readonly data: T;
}
export interface ConformanceError {
  readonly ok: false;
  readonly tool: ConformanceToolName;
  readonly source: SourceMarker | null;
  readonly error: {
    readonly code: "invalid_arguments" | "internal_error";
    readonly message: string;
    readonly field: string | null;
    readonly value: string | null;
    readonly valid_values: readonly string[];
  };
}
export type ConformanceQueryResult<T = unknown> =
  ConformanceEnvelope<T> | ConformanceError;

const id = z.string().min(1);
export const CONFORMANCE_ARGUMENTS = {
  run_conformance: z.strictObject({ workload: id.optional() }),
  check_proposed_change: z.strictObject({
    workload: id.optional(),
    candidate_ref: id.optional(),
    files: z.array(id).min(1).max(100).optional(),
  }),
  get_conformance_result: z.strictObject({ result_id: id }),
};

/** Remote responses contain no local record fragments or source-derived text. */
function projectResult(
  result: ConformanceResultRecord,
  projection: ProjectionName,
) {
  if (projection === "local-disclosed") return result;
  return {
    id: result.id,
    rule_ref: result.rule_ref,
    rule_kind: result.rule_kind,
    severity: result.severity,
    verdict: result.verdict,
    content_hash: result.content_hash,
    details_available_locally: true,
  };
}

export function runConformanceQuery(
  tool: ConformanceToolName,
  args: Readonly<Record<string, unknown>>,
  context: ConformanceQueryContext,
): ConformanceQueryResult {
  const facts = buildProjectFacts(context.contract, {
    asOf: context.asOf,
    projection: context.projection,
    stateRevision: context.stateRevision,
  });
  const error = (
    message = "Arguments do not match the required tool parameters.",
  ): ConformanceError => ({
    ok: false,
    tool,
    source: facts.source,
    error: {
      code: "invalid_arguments",
      message,
      field: null,
      value: null,
      valid_values: [],
    },
  });
  if (!CONFORMANCE_ARGUMENTS[tool].safeParse(args).success) return error();
  const workload = args.workload as string | undefined;
  const candidateRef = args.candidate_ref as string | undefined;
  const files = args.files as string[] | undefined;
  if (
    workload !== undefined &&
    !context.contract.workloads.some((w) => w.id === workload)
  )
    return error();
  if (
    candidateRef !== undefined &&
    !context.contract.candidates.some(
      (c) => c.id === candidateRef && c.workload_ref === workload,
    )
  )
    return error();
  if (
    tool === "check_proposed_change" &&
    ((workload === undefined) !== (candidateRef === undefined) ||
      (files === undefined && candidateRef === undefined))
  )
    return error();
  const decisions = facts.workloads
    .flatMap((w) => w.decisions)
    .concat(facts.project_decisions)
    .map((d) => ({
      id: d.id,
      standing: d.standing,
      instruction_eligible: d.instruction_eligible,
    }));
  const envelope = (data: unknown): ConformanceEnvelope => ({
    ok: true,
    tool,
    source: facts.source,
    approval_standing: {
      summary: approvalStandingLine(facts),
      decisions,
      note: "Read-only checks cannot modify state or approve decisions.",
    },
    disclosure: facts.disclosure,
    authority:
      "Bounded static checks against current contract rules. Declared sources and sanitizer effectiveness remain assumptions; this is not runtime enforcement.",
    data,
  });
  const candidatePolicy =
    candidateRef === undefined
      ? null
      : (() => {
          const current = currentDecision(context.contract, workload!);
          const rules = context.contract.conformance_rules.filter(
            (r) => r.kind !== "forbid_dataflow" && r.workload_ref === workload,
          );
          const approvedRules = rules.filter(
            (r) => r.kind === "approved_candidate_only",
          );
          const decisions = approvedRules.map((r) =>
            currentDecision(
              context.contract,
              workload!,
              r.kind === "approved_candidate_only"
                ? r.approved_decision_ref
                : null,
            ),
          );
          const unknown = current === null || decisions.some((d) => d === null);
          const disallowed =
            (current !== null &&
              current.selected_candidate_ref !== candidateRef) ||
            rules.some(
              (r) =>
                r.kind === "provider_allowlist" &&
                !r.allowed_candidate_refs.includes(candidateRef),
            ) ||
            decisions.some(
              (d) => d !== null && d.selected_candidate_ref !== candidateRef,
            );
          return {
            scope: "candidate_policy_only",
            verdict: disallowed ? "fail" : unknown ? "unknown" : "pass",
            compliant: !disallowed && !unknown,
            suggested_alternatives: current?.selected_candidate_ref
              ? [current.selected_candidate_ref]
              : [],
            note: "Candidate eligibility only; no proposed implementation is inferred from this comparison.",
          };
        })();
  if (tool === "check_proposed_change" && files === undefined)
    return envelope(candidatePolicy);
  if (context.scan === null)
    return envelope({
      status:
        context.scanStatus === "unavailable"
          ? "scan_unavailable"
          : "scan_missing",
      message:
        "Run a local scan with explicit repository/configuration inputs before checking source conformance.",
      summary: {
        total: 0,
        pass: 0,
        fail: 0,
        unknown: 0,
        not_applicable: 0,
        compliant: false,
      },
      results: [],
      conformance_hash: null,
    });
  if (files !== undefined) {
    // Scan the whole declared repository so wrappers and cross-file direct calls
    // keep their context. Selected paths must actually be scanned source inputs.
    const sourcePaths = new Set(
      context.scan.repository.inputs
        .filter((i) => i.role === "source")
        .map((i) => i.path),
    );
    if (
      files.some(
        (f) =>
          f.includes("\\") ||
          f.startsWith("/") ||
          f.split("/").some((p) => p === ".." || p === "." || p === "") ||
          !sourcePaths.has(f),
      )
    )
      return error(
        "Selected files must be repository-relative source paths included in the current scan.",
      );
  }
  const report = evaluateConformance({
    contract: context.contract,
    scan: context.scan,
    stateRevision: context.stateRevision,
    evaluatedAt: context.asOf,
  });
  if (tool === "get_conformance_result") {
    const found = report.results.find((r) => r.id === args.result_id);
    // Never echo an arbitrary, potentially private result ID from the request.
    return envelope({
      found: found !== undefined,
      result: found ? projectResult(found, context.projection) : null,
      analysis_error_count: report.analysis_errors.length,
    });
  }
  const results =
    workload === undefined
      ? report.results
      : report.results.filter(
          (r) =>
            r.workload_ref === workload || r.rule_kind === "forbid_dataflow",
        );
  const summary = summarizeResults(results, report.analysis_errors);
  return envelope({
    status: report.analysis_errors.length > 0 ? "analysis_error" : "evaluated",
    scope: "full_repository",
    hash_scope: "full_repository_report",
    conformance_hash: report.conformance_hash,
    summary,
    results: results.map((r) => projectResult(r, context.projection)),
    analysis_error_count: report.analysis_errors.length,
    ...(context.projection === "local-disclosed"
      ? { analysis_errors: report.analysis_errors }
      : {}),
    ...(files === undefined
      ? {}
      : {
          selected_file_count: new Set(files).size,
          ...(context.projection === "local-disclosed"
            ? { files_checked: [...new Set(files)] }
            : {}),
          candidate_policy: candidatePolicy,
          compliant:
            summary.compliant &&
            (candidatePolicy === null || candidatePolicy.compliant),
          note: "Selected files were read in a fresh analysis of the full repository; results may also concern other files.",
        }),
  });
}
