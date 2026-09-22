import type { ProjectContract } from "@anvilmark/project-contract";

import type {
  ConstraintFact,
  DecisionFact,
  DecisionStanding,
  ProjectFacts,
} from "./facts.js";
import { buildProjectFacts } from "./facts.js";
import { approvalStandingLine } from "./header.js";
import type { ProjectionName, SourceMarker } from "./source.js";

/**
 * The read-only questions an agent can ask, answered from project facts.
 *
 * These functions are the MCP tools' behaviour without the protocol, so the
 * same answer is produced for any client: the response depends only on the
 * contract, the state revision, `as_of`, the projection and the arguments.
 * Nothing here reads generated artifacts or writes anything.
 */

export const PROJECT_TOOL_NAMES = [
  "get_project_summary",
  "get_constraints",
  "get_workload_decision",
  "get_architecture_context",
  "list_evidence_gaps",
] as const;

export type ProjectToolName = (typeof PROJECT_TOOL_NAMES)[number];

export interface QueryContext {
  readonly contract: ProjectContract;
  readonly stateRevision: number | null;
  readonly asOf: string;
  readonly projection: ProjectionName;
}

export interface QueryEnvelope<T> {
  readonly ok: true;
  readonly tool: ProjectToolName;
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

/**
 * Error codes a tool response may carry. Every message for the project-level
 * codes is fixed text: it never includes a local path, a file name, an
 * exception message or a contract value.
 */
export type QueryErrorCode =
  | "invalid_filter"
  | "invalid_arguments"
  | "project_not_found"
  | "project_unreadable"
  | "project_invalid"
  | "projection_refused"
  | "internal_error";

export interface QueryError {
  readonly ok: false;
  readonly tool: ProjectToolName;
  readonly source: SourceMarker | null;
  readonly error: {
    readonly code: QueryErrorCode;
    readonly message: string;
    readonly field: string | null;
    readonly value: string | null;
    readonly valid_values: readonly string[];
  };
}

export type QueryResult<T = unknown> = QueryEnvelope<T> | QueryError;

const APPROVAL_NOTE =
  "Only decisions with instruction_eligible true (approved_current) are implementation instructions. An approval content hash shows the approved content is unchanged; it does not show that evidence is fresh.";

const AUTHORITY =
  "Answered from .anvilmark/project.yaml. Generated files are never read. Architecture is declared structure, not approved content.";

function allDecisions(facts: ProjectFacts): DecisionFact[] {
  return [
    ...facts.workloads.flatMap((workload) => workload.decisions),
    ...facts.project_decisions,
  ].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

function envelope<T>(
  tool: ProjectToolName,
  facts: ProjectFacts,
  data: T,
  decisions: readonly DecisionFact[] = allDecisions(facts),
): QueryEnvelope<T> {
  return {
    ok: true,
    tool,
    source: facts.source,
    approval_standing: {
      summary: approvalStandingLine(facts),
      decisions: decisions.map((decision) => ({
        id: decision.id,
        standing: decision.standing,
        instruction_eligible: decision.instruction_eligible,
      })),
      note: APPROVAL_NOTE,
    },
    disclosure: facts.disclosure,
    authority: AUTHORITY,
    data,
  };
}

function invalid(
  tool: ProjectToolName,
  facts: ProjectFacts | null,
  field: string,
  value: unknown,
  valid: readonly string[],
  message?: string,
): QueryError {
  const shown = typeof value === "string" ? value : JSON.stringify(value);
  return {
    ok: false,
    tool,
    source: facts?.source ?? null,
    error: {
      code: "invalid_filter",
      message:
        message ??
        `${field} ${JSON.stringify(shown)} does not match anything in this project; valid values: ${valid.join(", ") || "none"}`,
      field,
      value: shown ?? null,
      valid_values: valid,
    },
  };
}

function argumentError(
  tool: ProjectToolName,
  facts: ProjectFacts,
  message: string,
): QueryError {
  return {
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
  };
}

type Args = Readonly<Record<string, unknown>>;

function allowOnly(
  tool: ProjectToolName,
  facts: ProjectFacts,
  args: Args,
  allowed: readonly string[],
): QueryError | null {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return null;
  return argumentError(
    tool,
    facts,
    `unknown argument(s) ${unknown.join(", ")}; ${tool} accepts ${allowed.length === 0 ? "no arguments" : allowed.join(", ")}`,
  );
}

function stringArg(
  tool: ProjectToolName,
  facts: ProjectFacts,
  args: Args,
  name: string,
): string | undefined | QueryError {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    return argumentError(tool, facts, `${name} must be a non-empty string`);
  }
  return value;
}

function isError(value: unknown): value is QueryError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false
  );
}

function workloadIds(facts: ProjectFacts): string[] {
  return facts.workloads.map((workload) => workload.id);
}

/** Answer one tool call. Never throws for bad arguments; returns a QueryError. */
export function runProjectQuery(
  tool: ProjectToolName,
  args: Args,
  context: QueryContext,
): QueryResult {
  const facts = buildProjectFacts(context.contract, {
    asOf: context.asOf,
    projection: context.projection,
    stateRevision: context.stateRevision,
  });
  switch (tool) {
    case "get_project_summary":
      return projectSummary(facts, args);
    case "get_constraints":
      return constraints(facts, args);
    case "get_workload_decision":
      return workloadDecision(facts, args);
    case "get_architecture_context":
      return architectureContext(facts, args);
    case "list_evidence_gaps":
      return evidenceGaps(facts, args);
    default:
      throw new Error(`unknown project tool ${String(tool)}`);
  }
}

function projectSummary(facts: ProjectFacts, args: Args): QueryResult {
  const tool = "get_project_summary";
  const bad = allowOnly(tool, facts, args, []);
  if (bad !== null) return bad;
  const gapCount =
    facts.evidence_gaps.project.length +
    facts.evidence_gaps.workloads.reduce(
      (total, workload) =>
        total +
        workload.gaps.length +
        workload.candidates.reduce(
          (sum, candidate) => sum + candidate.gaps.length,
          0,
        ),
      0,
    );
  return envelope(tool, facts, {
    ...facts.summary,
    workloads: facts.workloads.map((workload) => ({
      id: workload.id,
      name: workload.name,
      effective_decision: workload.effective_decision,
      decisions: workload.decisions.map((decision) => decision.id),
    })),
    counts: {
      constraints: facts.constraints.length,
      hard_constraints: facts.constraints.filter(
        (entry) => entry.severity === "hard",
      ).length,
      architecture_nodes: facts.architecture.nodes.length,
      architecture_relationships: facts.architecture.relationships.length,
      unresolved_architecture_items:
        facts.architecture.nodes.reduce(
          (total, node) => total + node.unresolved.length,
          0,
        ) +
        facts.architecture.relationships.reduce(
          (total, relationship) => total + relationship.unresolved.length,
          0,
        ),
      evidence_gaps: gapCount,
    },
  });
}

const SEVERITIES = ["hard", "soft", "informational"] as const;

function constraints(facts: ProjectFacts, args: Args): QueryResult {
  const tool = "get_constraints";
  const bad = allowOnly(tool, facts, args, ["workload", "severity", "domain"]);
  if (bad !== null) return bad;
  const workload = stringArg(tool, facts, args, "workload");
  const severity = stringArg(tool, facts, args, "severity");
  const domain = stringArg(tool, facts, args, "domain");
  for (const value of [workload, severity, domain]) {
    if (isError(value)) return value;
  }
  if (typeof workload === "string" && !workloadIds(facts).includes(workload)) {
    return invalid(tool, facts, "workload", workload, workloadIds(facts));
  }
  if (
    typeof severity === "string" &&
    !(SEVERITIES as readonly string[]).includes(severity)
  ) {
    return invalid(tool, facts, "severity", severity, SEVERITIES);
  }
  const domains: string[] = [
    ...new Set(facts.constraints.map((entry) => entry.domain as string)),
  ].sort();
  if (typeof domain === "string" && !domains.includes(domain)) {
    return invalid(tool, facts, "domain", domain, domains);
  }

  const labels =
    typeof workload === "string"
      ? (() => {
          const fact = facts.workloads.find((entry) => entry.id === workload);
          return fact === undefined
            ? []
            : [fact.input_classification, fact.output_classification].filter(
                (entry): entry is string => entry !== null,
              );
        })()
      : [];
  const appliesBecause = (constraint: ConstraintFact): string | null => {
    if (typeof workload !== "string") return "no workload filter";
    if (constraint.workload_ref === workload) {
      return `subject names workload ${workload}`;
    }
    const [head, second] = constraint.subject.split(".");
    if (head === "data" && second !== undefined && labels.includes(second)) {
      return `subject names data classification ${second}, which workload ${workload} declares`;
    }
    if (head === "project") return "project-wide subject";
    return null;
  };

  const matched = facts.constraints.flatMap((constraint) => {
    if (typeof severity === "string" && constraint.severity !== severity) {
      return [];
    }
    if (typeof domain === "string" && constraint.domain !== domain) return [];
    const because = appliesBecause(constraint);
    return because === null
      ? []
      : [{ ...constraint, applies_because: because }];
  });
  return envelope(tool, facts, {
    filters: {
      workload: workload ?? null,
      severity: severity ?? null,
      domain: domain ?? null,
    },
    constraints: matched,
  });
}

function workloadDecision(facts: ProjectFacts, args: Args): QueryResult {
  const tool = "get_workload_decision";
  const bad = allowOnly(tool, facts, args, ["workload"]);
  if (bad !== null) return bad;
  const workload = stringArg(tool, facts, args, "workload");
  if (isError(workload)) return workload;
  if (workload === undefined) {
    return invalid(
      tool,
      facts,
      "workload",
      null,
      workloadIds(facts),
      `workload is required; valid values: ${workloadIds(facts).join(", ") || "none"}`,
    );
  }
  const fact = facts.workloads.find((entry) => entry.id === workload);
  if (fact === undefined) {
    return invalid(tool, facts, "workload", workload, workloadIds(facts));
  }
  const gaps = facts.evidence_gaps.workloads.find(
    (entry) => entry.workload_ref === workload,
  );
  return envelope(
    tool,
    facts,
    {
      workload: fact,
      instruction:
        fact.effective_decision === null
          ? `No approved, current decision exists for workload ${workload}. Do not treat any candidate as selected; ask for a decision.`
          : `Decision ${fact.effective_decision} is approved and current for workload ${workload}.`,
      evidence_gaps: gaps ?? null,
    },
    fact.decisions,
  );
}

function architectureContext(facts: ProjectFacts, args: Args): QueryResult {
  const tool = "get_architecture_context";
  const bad = allowOnly(tool, facts, args, ["component", "workload"]);
  if (bad !== null) return bad;
  const component = stringArg(tool, facts, args, "component");
  const workload = stringArg(tool, facts, args, "workload");
  if (isError(component)) return component;
  if (isError(workload)) return workload;
  const nodeIds = facts.architecture.nodes.map((node) => node.id);
  if (typeof component === "string" && !nodeIds.includes(component)) {
    return invalid(tool, facts, "component", component, nodeIds);
  }
  if (typeof workload === "string" && !workloadIds(facts).includes(workload)) {
    return invalid(tool, facts, "workload", workload, workloadIds(facts));
  }

  let relationships = facts.architecture.relationships;
  if (typeof component === "string") {
    relationships = relationships.filter(
      (entry) => entry.source === component || entry.destination === component,
    );
  }
  if (typeof workload === "string") {
    relationships = relationships.filter(
      (entry) => entry.workload_ref === workload,
    );
  }
  const filtered = component !== undefined || workload !== undefined;
  const touched = new Set(
    relationships.flatMap((entry) => [entry.source, entry.destination]),
  );
  if (typeof component === "string") touched.add(component);
  // A component filter keeps the component and its neighbours; a workload
  // filter keeps the nodes its relationships touch; both intersect.
  const nodes = filtered
    ? facts.architecture.nodes.filter((node) => touched.has(node.id))
    : facts.architecture.nodes;
  const nodeSet = new Set(nodes.map((node) => node.id));
  const decisionIds = new Set([
    ...nodes.flatMap((node) =>
      node.decisions.map((entry) => entry.decision_ref),
    ),
    ...relationships.flatMap((entry) =>
      entry.decisions.map((decision) => decision.decision_ref),
    ),
  ]);
  return envelope(
    tool,
    facts,
    {
      filters: { component: component ?? null, workload: workload ?? null },
      authority: facts.architecture.authority,
      knowledge: "declared",
      nodes,
      relationships,
      trust_boundaries: facts.architecture.trust_boundaries
        .map((entry) => ({
          boundary: entry.boundary,
          nodes: entry.nodes.filter((id) => nodeSet.has(id)),
        }))
        .filter((entry) => entry.nodes.length > 0),
      trust_boundary_crossings: relationships
        .filter((entry) => entry.crossing !== null)
        .map((entry) => ({
          relationship: entry.id,
          from: entry.crossing?.from ?? null,
          to: entry.crossing?.to ?? null,
          data_classification: entry.data_classification,
        })),
      conformance_rules: facts.architecture.conformance_rules,
    },
    allDecisions(facts).filter((decision) => decisionIds.has(decision.id)),
  );
}

function evidenceGaps(facts: ProjectFacts, args: Args): QueryResult {
  const tool = "list_evidence_gaps";
  const bad = allowOnly(tool, facts, args, ["workload"]);
  if (bad !== null) return bad;
  const workload = stringArg(tool, facts, args, "workload");
  if (isError(workload)) return workload;
  if (typeof workload === "string" && !workloadIds(facts).includes(workload)) {
    return invalid(tool, facts, "workload", workload, workloadIds(facts));
  }
  return envelope(tool, facts, {
    filters: { workload: workload ?? null },
    as_of: facts.source.as_of,
    workloads:
      typeof workload === "string"
        ? facts.evidence_gaps.workloads.filter(
            (entry) => entry.workload_ref === workload,
          )
        : facts.evidence_gaps.workloads,
    project: typeof workload === "string" ? [] : facts.evidence_gaps.project,
    adapters: facts.evidence_gaps.adapters,
  });
}
