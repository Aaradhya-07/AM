import { contractHash } from "@anvilmark/context";
import type {
  ConformanceRule,
  ProjectContract,
} from "@anvilmark/project-contract";
import { approvalState } from "@anvilmark/project-contract";
import type { LocationRecord, ScanArtifact } from "@anvilmark/scanner";
import { stableId } from "@anvilmark/scanner";
import type { ConformanceResultRecord } from "../schemas.js";
import { resultRecordContentHash } from "../schemas.js";
import { CONFORMANCE_ENGINE_VERSION } from "../version.js";

export function currentDecision(
  contract: ProjectContract,
  workload: string,
  explicit?: string | null,
) {
  const selected = contract.workloads.find(
    (w) => w.id === workload,
  )?.current_decision_ref;
  if (selected == null || (explicit != null && explicit !== selected))
    return null;
  const id = explicit ?? selected;
  const decision = contract.decisions.find((d) => d.id === id);
  return decision?.scope.kind === "workload" &&
    decision.scope.workload_ref === workload &&
    approvalState(contract, decision.id).state === "current"
    ? decision
    : null;
}

/**
 * Where a workload is declared to live: the files of its resolved component
 * declarations, and the files declared for other workloads.
 */
export function workloadScope(
  scan: ScanArtifact,
  workload: string,
): {
  /** Files holding any component of the workload. */
  readonly declaredFiles: ReadonlySet<string>;
  /** Files declared as a whole (no export) for the workload. */
  readonly wholeFiles: ReadonlySet<string>;
  readonly otherWorkloadFiles: ReadonlySet<string>;
} {
  const declaredFiles = new Set<string>();
  const wholeFiles = new Set<string>();
  const otherWorkloadFiles = new Set<string>();
  for (const declaration of scan.declarations) {
    if (
      declaration.kind !== "component" ||
      declaration.status !== "resolved" ||
      declaration.workload_ref === null
    )
      continue;
    const path = declaration.component?.path ?? declaration.location?.path;
    if (path === undefined) continue;
    if (declaration.workload_ref === workload) {
      declaredFiles.add(path);
      if (declaration.component?.export === null) wholeFiles.add(path);
    } else otherWorkloadFiles.add(path);
  }
  return { declaredFiles, wholeFiles, otherWorkloadFiles };
}

/** Gaps that prevent claims about the entire selected inventory. */
export function inventoryGaps(scan: ScanArtifact): string[] {
  return [
    ...scan.limits.map((l) => `inventory_limit:${l.kind}`),
    ...scan.declarations
      .filter((d) => d.status === "problem")
      .map((d) => `declaration_unresolved:${d.id}`),
  ];
}

export function uniqueLocations(
  locations: readonly LocationRecord[],
): LocationRecord[] {
  return [...new Map(locations.map((l) => [JSON.stringify(l), l])).values()];
}

export function resultRecord(
  rule: ConformanceRule,
  contract: ProjectContract,
  scan: ScanArtifact,
  fields: Partial<ConformanceResultRecord> &
    Pick<ConformanceResultRecord, "verdict" | "explanation">,
): ConformanceResultRecord {
  const record: Omit<ConformanceResultRecord, "content_hash"> = {
    id: stableId("conformance.result", {
      rule: rule.id,
      contract: contractHash(contract),
      scan: scan.content_hash,
      engine: CONFORMANCE_ENGINE_VERSION,
    }),
    rule_ref: rule.id,
    rule_kind: rule.kind,
    severity: rule.severity,
    constraint_ref:
      rule.kind === "forbid_dataflow" ? rule.constraint_ref : null,
    workload_ref: rule.kind === "forbid_dataflow" ? null : rule.workload_ref,
    decision_ref: null,
    candidate_ref: null,
    architecture_node_ref: null,
    evidence_tier: fields.verdict === "unknown" ? "T0" : "T3",
    standing: "deterministic",
    locations: [],
    trace: [],
    supported_scope:
      "Selected TypeScript/JavaScript inventory; bounded static analysis only.",
    unknown_reasons: [],
    caveats: [],
    suggested_alternatives: [],
    ...fields,
  };
  return { ...record, content_hash: resultRecordContentHash(record) };
}
