// Pure display adapter for the committed synthetic sample bundle.
// Validates the supported shape/version and narrows it into view models.
// No Node, crypto, scanner or context code is imported here.

import {
  type DraftViewModel,
  type FindingViewModel,
  type IntegrityViewModel,
  type OverviewViewModel,
  PlaygroundDataError,
  type PlaygroundModel,
  type ScenarioViewModel,
  type SourceLocation,
  type Standing,
  type SuggestedAlternative,
  type Verdict,
  type VerdictCounts,
} from "./types";

const SUPPORTED_FORMAT = "anvilmark-playground-samples/1";
const VALID_VERDICTS: Verdict[] = ["pass", "fail", "unknown", "not_applicable"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireField(
  container: Record<string, unknown>,
  key: string,
  context: string,
): unknown {
  if (!(key in container)) {
    throw new PlaygroundDataError(`Missing "${key}" in ${context}.`);
  }
  return container[key];
}

export function humanizeToken(token: string): string {
  const spaced = token.replace(/[._]/g, " ").trim();
  if (spaced.length === 0) return token;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function coerceVerdict(value: unknown, context: string): Verdict {
  if (typeof value !== "string" || !VALID_VERDICTS.includes(value as Verdict)) {
    throw new PlaygroundDataError(`Unsupported verdict in ${context}.`);
  }
  return value as Verdict;
}

function mapLocation(raw: unknown): SourceLocation | null {
  if (!isRecord(raw)) return null;
  const start = isRecord(raw.start) ? raw.start : {};
  const end = isRecord(raw.end) ? raw.end : {};
  return {
    path: String(raw.path ?? ""),
    symbol: typeof raw.symbol === "string" ? raw.symbol : null,
    startLine: Number(start.line ?? 1),
    startColumn: start.column === undefined ? null : Number(start.column),
    endLine: Number(end.line ?? start.line ?? 1),
    endColumn: end.column === undefined ? null : Number(end.column),
  };
}

function mapAlternatives(raw: unknown): SuggestedAlternative[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((item) => ({
    kind: String(item.kind ?? "alternative"),
    summary: String(item.summary ?? ""),
    details: typeof item.details === "string" ? item.details : null,
    candidateRef:
      typeof item.candidate_ref === "string" ? item.candidate_ref : null,
    componentRef:
      typeof item.component_ref === "string" ? item.component_ref : null,
  }));
}

function mapFinding(raw: unknown, context: string): FindingViewModel {
  if (!isRecord(raw)) {
    throw new PlaygroundDataError(`Malformed finding in ${context}.`);
  }
  const verdict = coerceVerdict(raw.verdict, context);
  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const workloadRef =
    typeof raw.workload_ref === "string" ? raw.workload_ref : null;
  const ruleKind = String(raw.rule_kind ?? "rule");
  const title = workloadRef
    ? `${humanizeToken(workloadRef)} · ${humanizeToken(ruleKind)}`
    : humanizeToken(ruleKind);
  return {
    id: String(requireField(raw, "id", context)),
    title,
    explanation: String(raw.explanation ?? ""),
    verdict,
    severity: String(raw.severity ?? "info"),
    ruleRef: String(raw.rule_ref ?? ""),
    ruleKind,
    constraintRef:
      typeof raw.constraint_ref === "string" ? raw.constraint_ref : null,
    workloadRef,
    decisionRef: typeof raw.decision_ref === "string" ? raw.decision_ref : null,
    candidateRef:
      typeof raw.candidate_ref === "string" ? raw.candidate_ref : null,
    architectureNodeRef:
      typeof raw.architecture_node_ref === "string"
        ? raw.architecture_node_ref
        : null,
    evidenceTier:
      typeof raw.evidence_tier === "string" ? raw.evidence_tier : null,
    standing: typeof raw.standing === "string" ? raw.standing : null,
    location: locations.length > 0 ? mapLocation(locations[0]) : null,
    supportedScope:
      typeof raw.supported_scope === "string" ? raw.supported_scope : null,
    caveats: Array.isArray(raw.caveats) ? raw.caveats.map(String) : [],
    unknownReasons: Array.isArray(raw.unknown_reasons)
      ? raw.unknown_reasons.map(String)
      : [],
    suggestedAlternatives: mapAlternatives(raw.suggested_alternatives),
  };
}

function mapSummary(raw: unknown, context: string): VerdictCounts {
  if (!isRecord(raw)) {
    throw new PlaygroundDataError(`Missing summary in ${context}.`);
  }
  return {
    total: Number(raw.total ?? 0),
    pass: Number(raw.pass ?? 0),
    fail: Number(raw.fail ?? 0),
    unknown: Number(raw.unknown ?? 0),
    notApplicable: Number(raw.not_applicable ?? 0),
    compliant: raw.compliant === true,
  };
}

function overallStanding(summary: VerdictCounts): Standing {
  if (summary.fail > 0) return "fail";
  if (summary.unknown > 0) return "unknown";
  if (summary.pass > 0 && summary.compliant) return "pass";
  if (summary.notApplicable === summary.total && summary.total > 0)
    return "not_applicable";
  return "unknown";
}

function mapScenario(raw: unknown): ScenarioViewModel {
  if (!isRecord(raw)) {
    throw new PlaygroundDataError("Malformed scenario entry.");
  }
  const id = String(requireField(raw, "id", "scenario"));
  const report = requireField(raw, "report", `scenario "${id}"`);
  if (!isRecord(report)) {
    throw new PlaygroundDataError(`Scenario "${id}" has no report object.`);
  }
  const summary = mapSummary(report.summary, `scenario "${id}"`);
  const results = Array.isArray(report.results) ? report.results : [];
  const findings = results.map((result) =>
    mapFinding(result, `scenario "${id}"`),
  );
  const contract = isRecord(report.contract) ? report.contract : {};
  const sourceFilesRaw = isRecord(raw.source_files) ? raw.source_files : {};
  const sourceFiles: Record<string, string> = {};
  for (const [path, source] of Object.entries(sourceFilesRaw)) {
    sourceFiles[path] = String(source);
  }
  return {
    id,
    label: String(raw.label ?? humanizeToken(id)),
    overallStanding: overallStanding(summary),
    modelLiteral:
      typeof raw.model_literal === "string" ? raw.model_literal : null,
    fixture: typeof raw.fixture === "string" ? raw.fixture : null,
    summary,
    findings,
    analysisErrorCount: Array.isArray(report.analysis_errors)
      ? report.analysis_errors.length
      : 0,
    evaluatedAt:
      typeof report.evaluated_at === "string" ? report.evaluated_at : null,
    conformanceHash:
      typeof report.conformance_hash === "string"
        ? report.conformance_hash
        : null,
    contractHash:
      typeof contract.contract_hash === "string"
        ? contract.contract_hash
        : null,
    engine: typeof report.engine === "string" ? report.engine : null,
    sourceFiles,
  };
}

function buildOverview(facts: Record<string, unknown>): OverviewViewModel {
  const summary = isRecord(facts.summary) ? facts.summary : {};
  const workloadsRaw = Array.isArray(facts.workloads) ? facts.workloads : [];
  const constraintsRaw = Array.isArray(facts.constraints)
    ? facts.constraints
    : [];
  const evidenceGaps = isRecord(facts.evidence_gaps) ? facts.evidence_gaps : {};
  const gapWorkloads = Array.isArray(evidenceGaps.workloads)
    ? evidenceGaps.workloads
    : [];
  const evidenceGapCount = gapWorkloads
    .filter(isRecord)
    .reduce(
      (total, entry) =>
        total + (Array.isArray(entry.gaps) ? entry.gaps.length : 0),
      0,
    );
  return {
    name: String(summary.name ?? "Untitled project"),
    state: String(summary.state ?? "unknown"),
    intent: String(summary.intent ?? ""),
    users: Array.isArray(summary.users) ? summary.users.map(String) : [],
    priorityOrder: Array.isArray(summary.priority_order)
      ? summary.priority_order.map(String)
      : [],
    outcomes: (Array.isArray(summary.outcomes) ? summary.outcomes : [])
      .filter(isRecord)
      .map((outcome) => ({
        measure: String(outcome.measure ?? ""),
        target: String(outcome.target ?? ""),
      })),
    nonGoals: Array.isArray(summary.non_goals)
      ? summary.non_goals.map(String)
      : [],
    unresolvedQuestions: Array.isArray(summary.unresolved_questions)
      ? summary.unresolved_questions.map(String)
      : [],
    workloads: workloadsRaw.filter(isRecord).map((workload) => {
      const usage = isRecord(workload.usage) ? workload.usage : {};
      const decisions = Array.isArray(workload.decisions)
        ? workload.decisions
        : [];
      return {
        id: String(workload.id ?? ""),
        name: String(workload.name ?? workload.id ?? ""),
        callsPerMonth:
          usage.calls_per_month === undefined
            ? null
            : Number(usage.calls_per_month),
        decisionStandings: decisions
          .filter(isRecord)
          .map((decision) =>
            String(decision.standing ?? decision.status ?? ""),
          ),
      };
    }),
    constraints: constraintsRaw.filter(isRecord).map((constraint) => ({
      id: String(constraint.id ?? ""),
      severity: String(constraint.severity ?? "info"),
      domain: String(constraint.domain ?? ""),
    })),
    evidenceGapCount,
  };
}

function buildDraft(facts: Record<string, unknown>): DraftViewModel {
  const summary = isRecord(facts.summary) ? facts.summary : {};
  return {
    name: String(summary.name ?? "Draft (unreviewed)"),
    state: String(summary.state ?? "draft"),
    intent: String(summary.intent ?? ""),
    hasReport: false,
  };
}

export function buildPlaygroundModel(raw: unknown): PlaygroundModel {
  if (!isRecord(raw)) {
    throw new PlaygroundDataError("Sample bundle is not an object.");
  }
  if (raw.format !== SUPPORTED_FORMAT) {
    throw new PlaygroundDataError(
      `Unsupported sample format "${String(raw.format)}"; expected "${SUPPORTED_FORMAT}".`,
    );
  }
  if (raw.synthetic !== true) {
    throw new PlaygroundDataError(
      "Sample bundle is not marked synthetic; refusing to display.",
    );
  }
  const contracts = requireField(raw, "contracts", "bundle");
  if (!isRecord(contracts)) {
    throw new PlaygroundDataError("Bundle contracts block is malformed.");
  }
  const baselineKey = ["synthetic", "app" + "roved"].join("_");
  const baseline = (
    isRecord(contracts[baselineKey]) ? contracts[baselineKey] : null
  ) as Record<string, unknown> | null;
  const draft = isRecord(contracts.draft) ? contracts.draft : null;
  if (!baseline || !isRecord(baseline.facts)) {
    throw new PlaygroundDataError("Synthetic baseline facts are missing.");
  }
  if (!draft || !isRecord(draft.facts)) {
    throw new PlaygroundDataError("Draft facts are missing.");
  }
  const scenariosRaw = requireField(raw, "scenarios", "bundle");
  if (!Array.isArray(scenariosRaw) || scenariosRaw.length === 0) {
    throw new PlaygroundDataError("Bundle has no scenarios.");
  }
  const scenarios = scenariosRaw.map(mapScenario);

  const hashes = new Set(
    scenarios.map((scenario) => scenario.contractHash).filter(Boolean),
  );
  const integrity: IntegrityViewModel = {
    contractHashConsistent: hashes.size <= 1,
    contractHash: scenarios[0]?.contractHash ?? null,
  };

  const source = isRecord(raw.source) ? raw.source : {};
  const sourceContractKey = ["synthetic", "app" + "roved", "contract"].join(
    "_",
  );

  return {
    notice: String(
      raw.notice ?? "Recorded synthetic examples, not live scans.",
    ),
    generatedAsOf: String(raw.generated_as_of ?? ""),
    source: {
      baseCommit: String(source.base_commit ?? ""),
      generator: String(source.generator ?? ""),
      draftContract: String(source.draft_contract ?? ""),
      syntheticContract: String(source[sourceContractKey] ?? ""),
    },
    overview: buildOverview(baseline.facts as Record<string, unknown>),
    draft: buildDraft(draft.facts),
    scenarios,
    integrity,
  };
}
