// Typed view models for the ANVILMARK example playground.
// These narrow the committed synthetic sample bundle into display-only shapes.
// No verdict engine or fixture mutation happens here.

export type Verdict = "pass" | "fail" | "unknown" | "not_applicable";
export type Standing = "not_checked" | Verdict;

export interface SourceLocation {
  path: string;
  symbol: string | null;
  startLine: number;
  startColumn: number | null;
  endLine: number;
  endColumn: number | null;
}

export interface SuggestedAlternative {
  kind: string;
  summary: string;
  details: string | null;
  candidateRef: string | null;
  componentRef: string | null;
}

export interface FindingViewModel {
  id: string;
  title: string;
  explanation: string;
  verdict: Verdict;
  severity: string;
  ruleRef: string;
  ruleKind: string;
  constraintRef: string | null;
  workloadRef: string | null;
  decisionRef: string | null;
  candidateRef: string | null;
  architectureNodeRef: string | null;
  evidenceTier: string | null;
  standing: string | null;
  location: SourceLocation | null;
  supportedScope: string | null;
  caveats: string[];
  unknownReasons: string[];
  suggestedAlternatives: SuggestedAlternative[];
}

export interface VerdictCounts {
  total: number;
  pass: number;
  fail: number;
  unknown: number;
  notApplicable: number;
  compliant: boolean;
}

export interface ScenarioViewModel {
  id: string;
  label: string;
  overallStanding: Standing;
  modelLiteral: string | null;
  fixture: string | null;
  summary: VerdictCounts;
  findings: FindingViewModel[];
  analysisErrorCount: number;
  evaluatedAt: string | null;
  conformanceHash: string | null;
  contractHash: string | null;
  engine: string | null;
  sourceFiles: Record<string, string>;
}

export interface OverviewViewModel {
  name: string;
  state: string;
  intent: string;
  users: string[];
  priorityOrder: string[];
  outcomes: { measure: string; target: string }[];
  nonGoals: string[];
  unresolvedQuestions: string[];
  workloads: {
    id: string;
    name: string;
    callsPerMonth: number | null;
    decisionStandings: string[];
  }[];
  constraints: {
    id: string;
    severity: string;
    domain: string;
  }[];
  evidenceGapCount: number;
}

export interface DraftViewModel {
  name: string;
  state: string;
  intent: string;
  hasReport: false;
}

export interface IntegrityViewModel {
  contractHashConsistent: boolean;
  contractHash: string | null;
}

export interface PlaygroundModel {
  notice: string;
  generatedAsOf: string;
  source: {
    baseCommit: string;
    generator: string;
    draftContract: string;
    syntheticContract: string;
  };
  overview: OverviewViewModel;
  draft: DraftViewModel;
  scenarios: ScenarioViewModel[];
  integrity: IntegrityViewModel;
}

export class PlaygroundDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaygroundDataError";
  }
}
