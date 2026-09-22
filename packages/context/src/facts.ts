import type {
  AdapterIdentity,
  AdapterStanding,
  EvidenceGapEntry,
} from "@anvilmark/adapters";
import {
  buildGapReport,
  evaluateCandidateConstraint,
  freshnessOf,
} from "@anvilmark/adapters";
import type {
  ArchitectureElement,
  Candidate,
  ConfirmationStanding,
  Constraint,
  Decision,
  EvidenceRecord,
  ProjectContract,
  TrustBoundary,
} from "@anvilmark/project-contract";
import {
  approvalState,
  compareCodeUnits,
  confirmationStanding,
  findSecrets,
  resolveDecision,
  tierForEvidence,
} from "@anvilmark/project-contract";

import type { ProjectionName, SourceMarker } from "./source.js";
import { sourceMarker } from "./source.js";

/**
 * How a fact came to be known. Every fact a consumer reads carries one, so an
 * agent can tell an approved instruction from a declaration, a measurement, an
 * estimate, an inference, and an honest unknown.
 *
 * - `approved`: an approved decision whose approval is current for its
 *   resolved content. The only knowledge that is an implementation instruction.
 * - `declared`: stated by the user in the contract (constraints, workloads,
 *   architecture, hardware), or published by an attributable source.
 * - `measured`: T3 observation or measurement evidence.
 * - `estimated`: a tool estimate or a candidate's projected figures.
 * - `inferred`: agent-proposed or agent-inferred content.
 * - `unknown`: not recorded, not yet evaluated, or recorded as unknown.
 */
export type Knowledge =
  "approved" | "declared" | "measured" | "estimated" | "inferred" | "unknown";

export type DecisionStanding =
  | "approved_current"
  | "approved_stale"
  | "approved_unresolvable"
  | "proposed_unapproved"
  | "draft"
  | "rejected"
  | "superseded";

export interface EvidenceFact {
  readonly id: string;
  readonly kind: string;
  readonly tier: string;
  readonly knowledge: Knowledge;
  readonly subject: string;
  readonly observed_at: string;
  /** Freshness evaluated at the marker's `as_of`. */
  readonly freshness: string;
  readonly freshness_reason: string;
  readonly caveats: readonly string[];
  /** Local projection only: where the evidence came from. */
  readonly local_locator?: string | null;
}

export interface ConstraintFact {
  readonly id: string;
  readonly severity: Constraint["severity"];
  readonly domain: Constraint["domain"];
  readonly subject: string;
  readonly operator: string;
  readonly value: Constraint["value"];
  readonly direction: string | null;
  readonly condition: string | null;
  readonly rationale: string | null;
  readonly knowledge: Knowledge;
  readonly source: Constraint["source"];
  readonly workload_ref: string | null;
  readonly exceptions: readonly {
    readonly id: string;
    readonly reason: string;
    readonly decision_ref: string | null;
    readonly expires_at: string | null;
    readonly review_at: string | null;
    readonly active_at_as_of: boolean;
    readonly review_due_at_as_of: boolean;
    /** Local projection only: the approving person or role. */
    readonly local_approved_by?: string;
  }[];
}

export interface CandidateFact {
  readonly id: string;
  readonly status: Candidate["status"];
  readonly workload_ref: string | null;
  readonly component_kind: Candidate["component_kind"];
  readonly deployment: {
    readonly mode: string;
    readonly runtime: string | null;
    readonly provider: string | null;
    readonly region: string | null;
    /** A projection-local alias such as `hardware-1`, never the contract id. */
    readonly hardware: string | null;
  };
  readonly model: {
    readonly family: string;
    readonly version: string | null;
    readonly version_mutability: string;
    readonly quantization: string | null;
  } | null;
  readonly estimates: {
    readonly knowledge: Knowledge;
    readonly tokens_per_call: number | null;
    readonly latency_p95_ms: number | null;
    readonly monthly_effective_cost_usd: number | null;
    readonly basis: string | null;
    readonly assumptions: readonly string[];
  };
  readonly constraint_standings: readonly {
    readonly constraint_ref: string;
    readonly recorded_status: string | null;
    readonly outcome: string;
    /**
     * How the outcome is known, from the admissible current evidence and the
     * calculation basis, never from pass/fail alone.
     */
    readonly knowledge: Knowledge;
    readonly knowledge_basis: string;
  }[];
}

export interface DecisionFact {
  readonly id: string;
  readonly revision: number;
  readonly status: Decision["status"];
  readonly standing: DecisionStanding;
  /** True only for `approved_current`: the one standing that is an instruction. */
  readonly instruction_eligible: boolean;
  readonly knowledge: Knowledge;
  readonly scope: {
    readonly kind: Decision["scope"]["kind"];
    readonly ref: string | null;
  };
  readonly approval: {
    readonly state: string;
    /**
     * The approved content hash. It proves the approved content is unchanged;
     * it says nothing about whether the evidence behind it is still fresh.
     */
    readonly content_hash: string | null;
    readonly approved_revision: number | null;
    readonly approved_at: string | null;
    /** Local projection only: who approved. */
    readonly local_actor?: string;
  };
  readonly selected_candidate: CandidateFact | null;
  readonly alternatives: readonly string[];
  readonly satisfies: readonly string[];
  readonly unresolved: readonly string[];
  readonly rationale: {
    readonly summary: string;
    readonly provenance: "user" | "generated";
  };
  readonly evidence: readonly EvidenceFact[];
  /** Cited evidence that is not current at `as_of`, even if approval is current. */
  readonly evidence_not_current: readonly string[];
}

export interface WorkloadFact {
  readonly id: string;
  readonly name: string;
  readonly input_classification: string;
  readonly output_classification: string | null;
  readonly output_format: string;
  readonly usage: {
    readonly knowledge: Knowledge;
    readonly basis: string;
    readonly calls_per_month: number | null;
  };
  readonly decisions: readonly DecisionFact[];
  /** The approved, current decision for the workload, if any. */
  readonly effective_decision: string | null;
}

/**
 * Origin and confirmation of an architecture element (amendment 8).
 *
 * `confirmation` is derived by recomputing the content hash. It is portable
 * content-match standing: it does not claim `proposal_ref` was verified
 * against local committed history, which only the local CLI checks.
 */
export interface ArchitectureOriginFact {
  readonly kind: "user" | "agent_proposed";
  readonly proposal_ref: string | null;
  readonly confirmation: ConfirmationStanding;
  readonly confirmed_at: string | null;
  /** User-declared, or confirmed with matching content. */
  readonly trusted: boolean;
}

export type EffectiveTrustBoundary = TrustBoundary | "unknown";

export interface ArchitectureLink {
  /**
   * False when the link depends on an untrusted (unconfirmed or stale)
   * element. A non-authoritative link is shown for review and never counts as
   * support.
   */
  readonly authoritative: boolean;
}

export interface ArchitectureNodeFact {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly description: string | null;
  /** The declared boundary, kept for review whatever the origin. */
  readonly trust_boundary: string;
  /** The declared boundary when the node is trusted; otherwise unknown. */
  readonly effective_trust_boundary: EffectiveTrustBoundary;
  readonly knowledge: Knowledge;
  readonly origin: ArchitectureOriginFact;
  readonly interfaces: readonly {
    readonly id: string;
    /** Null: the protocol is unknown. */
    readonly protocol: string | null;
    readonly description: string | null;
  }[];
  /**
   * Workloads associated with this node through relationships that name them.
   * An association, not declared execution placement: no field declares where
   * a workload actually runs.
   */
  readonly associated_workloads: readonly string[];
  readonly decisions: readonly (ArchitectureLink & {
    readonly decision_ref: string;
    readonly link: "binding" | "component_scope" | "workload_association";
    readonly standing: DecisionStanding | "missing";
  })[];
  readonly constraints: readonly (ArchitectureLink & {
    readonly constraint_ref: string;
    readonly link: string;
  })[];
  readonly unresolved: readonly string[];
  /** Local projection only: repository bindings for this node. */
  readonly local_repository_bindings?: readonly {
    readonly id: string;
    readonly repository_root: string;
    readonly locations: readonly string[];
  }[];
}

export interface ArchitectureRelationshipFact {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly destination: string;
  readonly workload_ref: string | null;
  readonly data_classification: string | null;
  readonly source_interface_ref: string | null;
  readonly destination_interface_ref: string | null;
  readonly knowledge: Knowledge;
  readonly origin: ArchitectureOriginFact;
  /** The crossing the declared boundaries describe, kept for review. */
  readonly crossing: {
    readonly from: string;
    readonly to: string;
  } | null;
  /**
   * `crossing` or `none` only when this relationship and both endpoints are
   * trusted; `unknown` otherwise, so a possible crossing is never shown as
   * absent. `not_applicable` for deployed_in and composed_of.
   */
  readonly effective_crossing:
    "crossing" | "none" | "unknown" | "not_applicable";
  readonly decisions: readonly (ArchitectureLink & {
    readonly decision_ref: string;
    readonly standing: DecisionStanding;
  })[];
  readonly constraints: readonly (ArchitectureLink & {
    readonly constraint_ref: string;
    readonly link: string;
  })[];
  readonly unresolved: readonly string[];
}

export interface DecisionBindingFact {
  readonly decision_ref: string;
  readonly node_refs: readonly string[];
  readonly standing: DecisionStanding | "missing";
  readonly knowledge: Knowledge;
  readonly origin: ArchitectureOriginFact;
}

export interface ProjectFacts {
  readonly source: SourceMarker;
  readonly disclosure: string;
  readonly summary: {
    readonly name: string;
    readonly state: string;
    readonly intent: string;
    readonly users: readonly string[];
    readonly outcomes: readonly {
      readonly measure: string;
      readonly target: string;
    }[];
    readonly non_goals: readonly string[];
    readonly priority_order: readonly string[];
    readonly unresolved_questions: readonly string[];
    readonly decision_standings: Readonly<Record<string, number>>;
    /** Local projection only. */
    readonly local_repository_roots?: readonly string[];
  };
  readonly constraints: readonly ConstraintFact[];
  readonly workloads: readonly WorkloadFact[];
  readonly project_decisions: readonly DecisionFact[];
  readonly hardware_capabilities: readonly {
    readonly alias: string;
    readonly knowledge: Knowledge;
    readonly cpu_cores: number;
    readonly ram_gb: number;
    readonly accelerators: readonly string[];
    readonly backend: string | null;
    readonly operating_system: string;
  }[];
  readonly architecture: {
    readonly authority: "anvilmark";
    readonly nodes: readonly ArchitectureNodeFact[];
    readonly relationships: readonly ArchitectureRelationshipFact[];
    readonly decision_bindings: readonly DecisionBindingFact[];
    readonly trust_boundaries: readonly {
      readonly boundary: string;
      /** Nodes declaring this boundary. */
      readonly nodes: readonly string[];
      /** Of those, the nodes whose boundary is not effective (untrusted). */
      readonly unconfirmed_nodes: readonly string[];
    }[];
    readonly conformance_rules: readonly {
      readonly id: string;
      readonly kind: string;
      readonly severity: string;
      readonly statement: string;
    }[];
  };
  readonly evidence_gaps: {
    readonly workloads: readonly {
      readonly workload_ref: string;
      readonly gaps: readonly EvidenceGapEntry[];
      readonly candidates: readonly {
        readonly candidate_ref: string;
        readonly gaps: readonly EvidenceGapEntry[];
      }[];
    }[];
    readonly project: readonly EvidenceGapEntry[];
    readonly adapters: readonly {
      readonly adapter_id: string;
      readonly standing: string;
      readonly reason: string;
    }[];
  };
}

export const REMOTE_DISCLOSURE =
  "Remote-default projection: decision-layer facts and non-identifying hardware capabilities only. Repository roots, repository bindings and source locations, owners and approver identities, integration credential references and data directories, evidence locators and evidence values (including evaluation rows), command lines and source-quoting explanations are not included.";

export const LOCAL_DISCLOSURE =
  "LOCAL-DISCLOSED projection: in addition to the remote-default facts, this includes repository roots and bindings, evidence locators, approver identities and exception approvers. It is for tools that run on this machine. Producing it locally does not authorize sending it to a remote model or service.";

/**
 * Specific local values the remote projection must never contain: machine
 * identifiers, repository roots and source locations, credential references,
 * integration data directories and evidence locators. Short or generic values
 * are skipped so an unrelated word cannot trip the check.
 */
function deniedValues(contract: ProjectContract): string[] {
  const values = [
    ...contract.resources.hardware.map((entry) => entry.id),
    ...contract.project.repository_roots,
    ...contract.repository_bindings.flatMap((binding) => [
      binding.repository_root,
      ...binding.locations.map((location) => location.path),
    ]),
    ...contract.integrations.flatMap((integration) => {
      const record = integration as Record<string, unknown>;
      return [record.credential_ref, record.data_directory].filter(
        (value): value is string => typeof value === "string",
      );
    }),
    ...contract.evidence_refs.flatMap((record) =>
      record.source.locator === null ? [] : [record.source.locator],
    ),
  ];
  return [...new Set(values)].filter((value) => value.length >= 8);
}

function sortById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => compareCodeUnits(left.id, right.id));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function evidenceKnowledge(record: EvidenceRecord): Knowledge {
  switch (record.kind) {
    case "measured_evaluation":
    case "runtime_measurement":
    case "deterministic_observation":
    case "source_code":
      return "measured";
    case "tool_observation":
      return "estimated";
    case "official_documentation":
    case "official_pricing":
    case "user_declared":
    case "vendor_claim":
      return "declared";
    case "agent_inference":
      return "inferred";
    default:
      return "unknown";
  }
}

/** Floor subjects whose settled outcome is a projection, not an observation. */
const ESTIMATE_SUBJECTS: ReadonlySet<string> = new Set([
  "projected_cost_comparison",
  "hardware_compatibility_estimate",
]);

const KNOWLEDGE_RANK: Readonly<Record<Knowledge, number>> = {
  measured: 5,
  estimated: 4,
  declared: 3,
  inferred: 2,
  approved: 1,
  unknown: 0,
};

/**
 * The knowledge label of one candidate/constraint outcome (correction R4).
 *
 * Pass and fail say what the outcome is, not how it is known. The label comes
 * from what supports it:
 *
 * - not settled (`unknown`, `not_applicable`): unknown;
 * - a result recorded as inferred: inferred;
 * - a projected cost comparison or hardware-compatibility estimate: estimated,
 *   because deterministic arithmetic over pricing and assumed usage is still a
 *   projection;
 * - otherwise the strongest admissible, current cited evidence: measured
 *   (evaluations, runtime measurements, deterministic observations, source),
 *   estimated (tool observations), declared (official documents and pricing,
 *   user declarations, vendor claims), or inferred (agent inference);
 * - a settled outcome with no admissible current evidence (possible only
 *   where no floor applies, or for a preserved fail): declared, as a recorded
 *   result.
 */
function standingKnowledge(
  constraint: Constraint,
  outcome: string,
  result: { readonly determinism: string } | null,
  cited: readonly EvidenceRecord[],
  evaluation: {
    readonly assessment: {
      readonly floorSubject: string | null;
      readonly excluded: readonly { readonly id: string }[];
    };
    readonly staleExcluded?: readonly {
      readonly record: { readonly id: string };
    }[];
  } | null,
): { readonly knowledge: Knowledge; readonly basis: string } {
  if (outcome !== "pass" && outcome !== "fail") {
    return {
      knowledge: "unknown",
      basis: "not settled by admissible, current evidence",
    };
  }
  if (result?.determinism === "inferred") {
    return {
      knowledge: "inferred",
      basis: "the result is recorded as inferred",
    };
  }
  const floorSubject = evaluation?.assessment.floorSubject ?? null;
  if (floorSubject !== null && ESTIMATE_SUBJECTS.has(floorSubject)) {
    return {
      knowledge: "estimated",
      basis:
        floorSubject === "projected_cost_comparison"
          ? `projected cost for ${constraint.id}: pricing evidence with recorded arithmetic and usage assumptions, not a measured cost`
          : `hardware compatibility estimate for ${constraint.id}, not a benchmark`,
    };
  }
  const excluded = new Set([
    ...(evaluation?.assessment.excluded ?? []).map((entry) => entry.id),
    ...(evaluation?.staleExcluded ?? []).map((entry) => entry.record.id),
  ]);
  const supporting = cited.filter((record) => !excluded.has(record.id));
  let best: Knowledge | null = null;
  for (const record of supporting) {
    const knowledge = evidenceKnowledge(record);
    if (best === null || KNOWLEDGE_RANK[knowledge] > KNOWLEDGE_RANK[best]) {
      best = knowledge;
    }
  }
  if (best === null || best === "unknown") {
    return {
      knowledge: "declared",
      basis:
        "a recorded result without admissible, current supporting evidence",
    };
  }
  return {
    knowledge: best,
    basis: `strongest admissible, current evidence: ${supporting
      .filter((record) => evidenceKnowledge(record) === best)
      .map((record) => `${record.id} (${record.kind})`)
      .join(", ")}`,
  };
}

export function decisionStanding(
  contract: ProjectContract,
  decision: Decision,
): DecisionStanding {
  switch (decision.status) {
    case "approved": {
      const state = approvalState(contract, decision.id).state;
      return state === "current"
        ? "approved_current"
        : state === "stale"
          ? "approved_stale"
          : "approved_unresolvable";
    }
    case "proposed":
      return "proposed_unapproved";
    default:
      return decision.status;
  }
}

/** The workload a constraint subject names, when it names one. */
function constraintWorkload(constraint: Constraint): string | null {
  const [head, second] = constraint.subject.split(".");
  return head === "workload" && second !== undefined ? second : null;
}

function constraintDataLabel(constraint: Constraint): string | null {
  const [head, second] = constraint.subject.split(".");
  return head === "data" && second !== undefined ? second : null;
}

/**
 * Build every fact a generated artifact or an MCP response may contain.
 *
 * The result is built field by field for the requested projection. Nothing is
 * produced by serializing the contract and removing keys: a field reaches the
 * output only because it is named here. Local-only fields are prefixed `local_`
 * and are set only for the `local-disclosed` projection. A final secret scan
 * over the whole result refuses to return anything secret-shaped.
 */
export function buildProjectFacts(
  contract: ProjectContract,
  options: {
    readonly asOf: string;
    readonly projection?: ProjectionName;
    readonly stateRevision?: number | null;
    readonly adapters?: readonly {
      readonly identity: AdapterIdentity;
      readonly standing: AdapterStanding;
      readonly reason: string;
    }[];
  },
): ProjectFacts {
  const projection = options.projection ?? "remote-default";
  const local = projection === "local-disclosed";
  const asOf = options.asOf;
  const source = sourceMarker(contract, {
    asOf,
    projection,
    stateRevision: options.stateRevision ?? null,
  });
  const now = Date.parse(asOf);

  const hardwareAlias = new Map(
    contract.resources.hardware.map((entry, index) => [
      entry.id,
      `hardware-${index + 1}`,
    ]),
  );
  const alias = (id: string | null): string | null =>
    id === null ? null : (hardwareAlias.get(id) ?? "hardware-unknown");
  // Text written by other components (gap and freshness reasons) quotes
  // contract ids, including hardware ids, which are machine identifiers and
  // are not part of either projection. They are replaced with the same aliases,
  // longest id first so an id that prefixes another is not partially replaced.
  const hardwareIds = [...hardwareAlias.keys()].sort(
    (left, right) => right.length - left.length,
  );
  const aliasText = (text: string): string =>
    hardwareIds.reduce(
      (current, id) =>
        current.split(id).join(hardwareAlias.get(id) ?? "hardware-unknown"),
      text,
    );
  const gapFact = (gap: EvidenceGapEntry): EvidenceGapEntry => ({
    code: gap.code,
    constraint_ref: gap.constraint_ref,
    subject: aliasText(gap.subject),
    required_floor: gap.required_floor,
    admissible_kinds: [...gap.admissible_kinds],
    resolved_outcome: gap.resolved_outcome,
    reason: aliasText(gap.reason),
  });

  const evidenceFact = (record: EvidenceRecord): EvidenceFact => {
    const verdict = freshnessOf(record, contract.evidence_refs, {
      asOf,
      contract,
    });
    return {
      id: record.id,
      kind: record.kind,
      tier: tierForEvidence(record),
      knowledge: evidenceKnowledge(record),
      subject: aliasText(record.subject),
      observed_at: record.observed_at,
      freshness: verdict.state,
      freshness_reason: aliasText(verdict.reason),
      caveats: [...record.caveats],
      ...(local ? { local_locator: record.source.locator } : {}),
    };
  };

  const candidateFact = (candidate: Candidate): CandidateFact => {
    const deployment = candidate.deployment;
    return {
      id: candidate.id,
      status: candidate.status,
      workload_ref: candidate.workload_ref,
      component_kind: candidate.component_kind,
      deployment: {
        mode: deployment.mode,
        runtime: deployment.mode === "managed_api" ? null : deployment.runtime,
        provider: deployment.mode === "local" ? null : deployment.provider,
        region: deployment.mode === "local" ? null : deployment.region,
        hardware:
          deployment.mode === "local" ? alias(deployment.hardware_ref) : null,
      },
      model:
        candidate.model === null
          ? null
          : {
              family: candidate.model.family,
              version: candidate.model.version,
              version_mutability: candidate.model.version_mutability,
              quantization: candidate.model.quantization,
            },
      estimates: {
        knowledge:
          candidate.estimates.tokens_per_call === null &&
          candidate.estimates.latency_p95_ms === null &&
          candidate.estimates.monthly_effective_cost_usd === null
            ? "unknown"
            : "estimated",
        tokens_per_call: candidate.estimates.tokens_per_call,
        latency_p95_ms: candidate.estimates.latency_p95_ms,
        monthly_effective_cost_usd:
          candidate.estimates.monthly_effective_cost_usd,
        basis: candidate.estimates.basis,
        assumptions: [...candidate.estimates.assumptions],
      },
      constraint_standings: sortById(contract.constraints)
        .filter((constraint) => {
          const workload = constraintWorkload(constraint);
          return workload === null || workload === candidate.workload_ref;
        })
        .map((constraint) => {
          const { result, cited, evaluation } = evaluateCandidateConstraint(
            contract,
            constraint,
            candidate,
            { asOf, contract },
          );
          const outcome =
            constraint.severity === "informational"
              ? "not_applicable"
              : (evaluation?.outcome ?? "unknown");
          const settled = standingKnowledge(
            constraint,
            outcome,
            result ?? null,
            cited,
            evaluation,
          );
          return {
            constraint_ref: constraint.id,
            recorded_status: result?.status ?? null,
            outcome,
            knowledge: settled.knowledge,
            knowledge_basis: settled.basis,
          };
        }),
    };
  };

  const decisionFact = (decision: Decision): DecisionFact => {
    const standing = decisionStanding(contract, decision);
    const state = approvalState(contract, decision.id);
    const approval =
      state.state === "current" || state.state === "stale"
        ? state.approval
        : null;
    const resolved = resolveDecision(contract, decision.id);
    const cited = resolved.ok
      ? resolved.value.content.cited_evidence
      : contract.evidence_refs.filter((record) =>
          decision.evidence_refs.includes(record.id),
        );
    const evidence = sortById(cited).map(evidenceFact);
    const selected = contract.candidates.find(
      (entry) => entry.id === decision.selected_candidate_ref,
    );
    return {
      id: decision.id,
      revision: decision.revision,
      status: decision.status,
      standing,
      instruction_eligible: standing === "approved_current",
      knowledge: standing === "approved_current" ? "approved" : "declared",
      scope: {
        kind: decision.scope.kind,
        ref:
          decision.scope.kind === "workload"
            ? decision.scope.workload_ref
            : decision.scope.kind === "component"
              ? decision.scope.component_ref
              : null,
      },
      approval: {
        state: state.state,
        content_hash: approval?.content_hash ?? null,
        approved_revision: approval?.decision_revision ?? null,
        approved_at: approval?.approved_at ?? null,
        ...(local && approval !== null
          ? { local_actor: approval.actor.ref }
          : {}),
      },
      selected_candidate:
        selected === undefined ? null : candidateFact(selected),
      alternatives: unique(decision.alternatives),
      satisfies: unique(decision.satisfies_constraints),
      unresolved: unique(decision.unresolved_constraints),
      rationale: {
        summary: decision.rationale.summary,
        provenance:
          decision.rationale.generated_by === null ? "user" : "generated",
      },
      evidence,
      evidence_not_current: evidence
        .filter((entry) => entry.freshness !== "current")
        .map((entry) => entry.id),
    };
  };

  const decisions = sortById(contract.decisions);
  const decisionFacts = new Map(
    decisions.map((decision) => [decision.id, decisionFact(decision)]),
  );
  const factOf = (id: string): DecisionFact | undefined =>
    decisionFacts.get(id);

  const workloadDecisionIds = (workloadId: string): string[] =>
    decisions
      .filter(
        (decision) =>
          decision.scope.kind === "workload" &&
          decision.scope.workload_ref === workloadId,
      )
      .map((decision) => decision.id);

  const constraints: ConstraintFact[] = sortById(contract.constraints).map(
    (constraint) => ({
      id: constraint.id,
      severity: constraint.severity,
      domain: constraint.domain,
      subject: constraint.subject,
      operator: constraint.operator,
      value: constraint.value,
      direction: constraint.severity === "soft" ? constraint.direction : null,
      condition: constraint.condition,
      rationale: constraint.rationale,
      knowledge:
        constraint.source === "agent_proposed" ? "inferred" : "declared",
      source: constraint.source,
      workload_ref: constraintWorkload(constraint),
      exceptions: sortById(constraint.exceptions).map((exception) => ({
        id: exception.id,
        reason: exception.reason,
        decision_ref: exception.decision_ref,
        expires_at: exception.expires_at,
        review_at: exception.review_at,
        active_at_as_of:
          exception.expires_at === null ||
          Date.parse(exception.expires_at) > now,
        review_due_at_as_of:
          exception.review_at !== null &&
          Date.parse(exception.review_at) <= now,
        ...(local ? { local_approved_by: exception.approved_by } : {}),
      })),
    }),
  );

  const workloads: WorkloadFact[] = sortById(contract.workloads).map(
    (workload) => {
      const ids = workloadDecisionIds(workload.id);
      const facts = ids
        .map(factOf)
        .filter((entry): entry is DecisionFact => entry !== undefined);
      return {
        id: workload.id,
        name: workload.name,
        input_classification: workload.input_classification,
        output_classification: workload.output_classification,
        output_format: workload.output_contract.kind,
        usage: {
          knowledge:
            workload.expected_usage.calls_per_month === null
              ? "unknown"
              : workload.expected_usage.basis === "measured"
                ? "measured"
                : workload.expected_usage.basis === "agent_inference"
                  ? "inferred"
                  : "declared",
          basis: workload.expected_usage.basis,
          calls_per_month: workload.expected_usage.calls_per_month,
        },
        decisions: facts,
        effective_decision:
          facts.find((entry) => entry.standing === "approved_current")?.id ??
          null,
      };
    },
  );

  // --- architecture ----------------------------------------------------------
  const architecture = contract.architecture;
  const relationships = sortById(architecture.relationships);

  const originFact = (element: ArchitectureElement): ArchitectureOriginFact => {
    const origin = element.value.origin;
    const confirmation = confirmationStanding(element);
    return {
      kind: origin.kind,
      proposal_ref: origin.proposal_ref,
      confirmation,
      confirmed_at: origin.confirmed_at,
      trusted: confirmation === "user_declared" || confirmation === "confirmed",
    };
  };
  const nodeOrigins = new Map(
    architecture.nodes.map((node) => [
      node.id,
      originFact({ type: "node", value: node }),
    ]),
  );
  const nodeTrusted = (id: string) => nodeOrigins.get(id)?.trusted ?? false;
  const relationshipOrigins = new Map(
    architecture.relationships.map((relationship) => [
      relationship.id,
      originFact({ type: "relationship", value: relationship }),
    ]),
  );
  const bindingOrigins = new Map(
    architecture.decision_bindings.map((binding) => [
      binding.decision_ref,
      originFact({ type: "decision_binding", value: binding }),
    ]),
  );
  const nodesById = new Map(architecture.nodes.map((node) => [node.id, node]));
  const untrustedNote = (
    kind: "node" | "relationship" | "binding",
    ref: string,
    origin: ArchitectureOriginFact,
  ): string | null =>
    origin.trusted
      ? null
      : origin.confirmation === "confirmation_stale"
        ? `agent-proposed ${kind} ${ref} was confirmed, but its content has changed since; it is inferred until confirmed again (anvilmark architecture confirm ${kind} ${ref})`
        : `agent-proposed ${kind} ${ref} is unconfirmed; it is inferred until confirmed (anvilmark architecture confirm ${kind} ${ref})`;

  const constraintLinksForWorkload = (
    workloadId: string,
    via: string,
    authoritative: boolean,
  ) =>
    constraints
      .filter((constraint) => constraint.workload_ref === workloadId)
      .map((constraint) => ({
        constraint_ref: constraint.id,
        link: `${via} names workload ${workloadId}`,
        authoritative,
      }));
  const byConstraintThenLink = (
    left: { constraint_ref: string; link: string },
    right: { constraint_ref: string; link: string },
  ) =>
    compareCodeUnits(left.constraint_ref, right.constraint_ref) ||
    compareCodeUnits(left.link, right.link);

  const nodes: ArchitectureNodeFact[] = sortById(architecture.nodes).map(
    (node) => {
      const origin = nodeOrigins.get(node.id) as ArchitectureOriginFact;
      const trusted = origin.trusted;
      const touching = relationships.filter(
        (relationship) =>
          relationship.source === node.id ||
          relationship.destination === node.id,
      );
      // workload -> authoritative when at least one trusted relationship
      // associates it (and the node itself is trusted).
      const associations = new Map<string, boolean>();
      for (const relationship of touching) {
        if (relationship.workload_ref === null) continue;
        const viaTrusted =
          trusted &&
          (relationshipOrigins.get(relationship.id)?.trusted ?? false);
        associations.set(
          relationship.workload_ref,
          (associations.get(relationship.workload_ref) ?? false) || viaTrusted,
        );
      }
      const associated = unique([...associations.keys()]);

      const links: {
        decision_ref: string;
        link: "binding" | "component_scope" | "workload_association";
        standing: DecisionStanding | "missing";
        authoritative: boolean;
      }[] = [];
      for (const binding of architecture.decision_bindings) {
        if (binding.node_refs.includes(node.id)) {
          links.push({
            decision_ref: binding.decision_ref,
            link: "binding",
            standing: factOf(binding.decision_ref)?.standing ?? "missing",
            authoritative:
              trusted &&
              (bindingOrigins.get(binding.decision_ref)?.trusted ?? false),
          });
        }
      }
      for (const decision of decisions) {
        if (
          decision.scope.kind === "component" &&
          decision.scope.component_ref === node.id
        ) {
          links.push({
            decision_ref: decision.id,
            link: "component_scope",
            standing: factOf(decision.id)?.standing ?? "missing",
            authoritative: trusted,
          });
        }
      }
      for (const workloadId of associated) {
        for (const id of workloadDecisionIds(workloadId)) {
          if (!links.some((entry) => entry.decision_ref === id)) {
            links.push({
              decision_ref: id,
              link: "workload_association",
              standing: factOf(id)?.standing ?? "missing",
              authoritative: associations.get(workloadId) ?? false,
            });
          }
        }
      }
      links.sort(
        (left, right) =>
          compareCodeUnits(left.decision_ref, right.decision_ref) ||
          compareCodeUnits(left.link, right.link),
      );

      const constraintLinks = [
        ...associated.flatMap((workloadId) =>
          constraintLinksForWorkload(
            workloadId,
            "constraint subject",
            associations.get(workloadId) ?? false,
          ),
        ),
        ...contract.conformance_rules.flatMap((rule) =>
          rule.kind === "forbid_dataflow" &&
          rule.unless !== null &&
          rule.unless.passes_through.some(
            (entry) => entry.component_ref === node.id,
          )
            ? [
                {
                  constraint_ref: rule.constraint_ref,
                  link: `sanitizer named by conformance rule ${rule.id}`,
                  authoritative: trusted,
                },
              ]
            : [],
        ),
        ...links.flatMap((entry) => {
          const fact = factOf(entry.decision_ref);
          return fact === undefined
            ? []
            : [
                ...fact.satisfies.map((ref) => ({
                  constraint_ref: ref,
                  link: `claimed satisfied by decision ${fact.id}`,
                  authoritative: entry.authoritative,
                })),
                ...fact.unresolved.map((ref) => ({
                  constraint_ref: ref,
                  link: `declared unresolved by decision ${fact.id}`,
                  authoritative: entry.authoritative,
                })),
              ];
        }),
      ].sort(byConstraintThenLink);

      const unresolved: string[] = [];
      const note = untrustedNote("node", node.id, origin);
      if (note !== null) unresolved.push(note);
      if (links.length === 0) {
        unresolved.push("no decision is linked to this component");
      } else if (
        !links.some(
          (entry) =>
            entry.authoritative && entry.standing === "approved_current",
        )
      ) {
        unresolved.push(
          links.some((entry) => entry.standing === "approved_current")
            ? "an approved, current decision is linked only through unconfirmed architecture, which does not count as support"
            : "no linked decision is approved and current",
        );
      }
      for (const binding of architecture.decision_bindings) {
        const bindingOrigin = bindingOrigins.get(binding.decision_ref);
        if (
          binding.node_refs.includes(node.id) &&
          bindingOrigin !== undefined &&
          !bindingOrigin.trusted
        ) {
          unresolved.push(
            untrustedNote("binding", binding.decision_ref, bindingOrigin) ?? "",
          );
        }
      }
      if (touching.length === 0) {
        unresolved.push("no relationship is declared for this component");
      }

      const bindings = contract.repository_bindings
        .filter((binding) => binding.architecture_node_ref === node.id)
        .sort((left, right) => compareCodeUnits(left.id, right.id))
        .map((binding) => ({
          id: binding.id,
          repository_root: binding.repository_root,
          locations: binding.locations.map(
            (location) =>
              `${location.path}${location.symbol === null ? "" : `#${location.symbol}`}${location.line === null ? "" : `:${location.line}`}`,
          ),
        }));

      return {
        id: node.id,
        kind: node.kind,
        name: node.name,
        description: node.description,
        trust_boundary: node.trust_boundary,
        effective_trust_boundary: trusted ? node.trust_boundary : "unknown",
        knowledge: trusted ? ("declared" as const) : ("inferred" as const),
        origin,
        interfaces: [...node.interfaces]
          .sort((left, right) => compareCodeUnits(left.id, right.id))
          .map((entry) => ({
            id: entry.id,
            protocol: entry.protocol,
            description: entry.description,
          })),
        associated_workloads: associated,
        decisions: links,
        constraints: constraintLinks,
        unresolved,
        ...(local ? { local_repository_bindings: bindings } : {}),
      };
    },
  );

  const relationshipFacts: ArchitectureRelationshipFact[] = relationships.map(
    (relationship) => {
      const origin = relationshipOrigins.get(
        relationship.id,
      ) as ArchitectureOriginFact;
      const source = nodesById.get(relationship.source);
      const destination = nodesById.get(relationship.destination);
      const flow =
        relationship.kind === "connects" || relationship.kind === "uses";
      const crossing =
        flow &&
        source !== undefined &&
        destination !== undefined &&
        source.trust_boundary !== destination.trust_boundary
          ? { from: source.trust_boundary, to: destination.trust_boundary }
          : null;
      const endpointsTrusted =
        nodeTrusted(relationship.source) &&
        nodeTrusted(relationship.destination);
      const fullyTrusted = origin.trusted && endpointsTrusted;
      const effective_crossing = !flow
        ? ("not_applicable" as const)
        : !fullyTrusted
          ? ("unknown" as const)
          : crossing === null
            ? ("none" as const)
            : ("crossing" as const);
      const label = relationship.data_classification;
      const constraintLinks = [
        ...(relationship.workload_ref === null
          ? []
          : constraintLinksForWorkload(
              relationship.workload_ref,
              "constraint subject",
              origin.trusted,
            )),
        ...(label === null
          ? []
          : contract.constraints
              .filter((constraint) => constraintDataLabel(constraint) === label)
              .map((constraint) => ({
                constraint_ref: constraint.id,
                link: `constraint subject names data classification ${label}`,
                authoritative: origin.trusted,
              }))),
        ...(label === null || destination === undefined
          ? []
          : contract.conformance_rules.flatMap((rule) =>
              rule.kind === "forbid_dataflow" &&
              rule.from.data_classification === label &&
              rule.to.trust_boundary === destination.trust_boundary
                ? [
                    {
                      constraint_ref: rule.constraint_ref,
                      link: `conformance rule ${rule.id} forbids ${label} reaching ${rule.to.trust_boundary}${rule.unless === null ? "" : ` unless it passes through ${rule.unless.passes_through.map((entry) => entry.component_ref).join(", ")}`}; not evaluated in Milestone 4`,
                      authoritative: fullyTrusted,
                    },
                  ]
                : [],
            )),
      ].sort(byConstraintThenLink);
      const decisionLinks =
        relationship.workload_ref === null
          ? []
          : workloadDecisionIds(relationship.workload_ref).map((id) => ({
              decision_ref: id,
              standing: factOf(id)?.standing ?? ("draft" as DecisionStanding),
              authoritative: origin.trusted,
            }));
      const unresolved: string[] = [];
      const note = untrustedNote("relationship", relationship.id, origin);
      if (note !== null) unresolved.push(note);
      if (flow && !fullyTrusted) {
        const untrusted = [
          ...(origin.trusted ? [] : [`relationship ${relationship.id}`]),
          ...[relationship.source, relationship.destination]
            .filter((id, index, all) => all.indexOf(id) === index)
            .filter((id) => !nodeTrusted(id))
            .map((id) => `node ${id}`),
        ];
        unresolved.push(
          crossing === null
            ? `effective trust-boundary crossing is unknown: it depends on unconfirmed ${untrusted.join(" and ")} (declared boundaries do not differ)`
            : `effective trust-boundary crossing is unknown: the declared boundaries describe a possible crossing from ${crossing.from} to ${crossing.to}, which depends on unconfirmed ${untrusted.join(" and ")}`,
        );
      }
      if (flow && label === null) {
        unresolved.push(
          crossing === null
            ? "data classification not declared"
            : `data classification not declared on a flow crossing from ${crossing.from} to ${crossing.to}`,
        );
      }
      if (relationship.workload_ref === null) {
        unresolved.push("no workload is declared for this relationship");
      } else if (
        !decisionLinks.some(
          (entry) =>
            entry.authoritative && entry.standing === "approved_current",
        )
      ) {
        unresolved.push(
          decisionLinks.some((entry) => entry.standing === "approved_current")
            ? `workload ${relationship.workload_ref} has an approved, current decision, but this unconfirmed relationship does not count as support for it`
            : `workload ${relationship.workload_ref} has no approved, current decision`,
        );
      }
      return {
        id: relationship.id,
        kind: relationship.kind,
        source: relationship.source,
        destination: relationship.destination,
        workload_ref: relationship.workload_ref,
        data_classification: label,
        source_interface_ref: relationship.source_interface_ref,
        destination_interface_ref: relationship.destination_interface_ref,
        knowledge: origin.trusted
          ? ("declared" as const)
          : ("inferred" as const),
        origin,
        crossing,
        effective_crossing,
        decisions: decisionLinks,
        constraints: constraintLinks,
        unresolved,
      };
    },
  );

  const bindingFacts: DecisionBindingFact[] = [
    ...architecture.decision_bindings,
  ]
    .sort((left, right) =>
      compareCodeUnits(left.decision_ref, right.decision_ref),
    )
    .map((binding) => {
      const origin = bindingOrigins.get(
        binding.decision_ref,
      ) as ArchitectureOriginFact;
      return {
        decision_ref: binding.decision_ref,
        node_refs: unique(binding.node_refs),
        standing: factOf(binding.decision_ref)?.standing ?? "missing",
        knowledge: origin.trusted
          ? ("declared" as const)
          : ("inferred" as const),
        origin,
      };
    });

  const boundaries = unique(
    architecture.nodes.map((node) => node.trust_boundary),
  );

  const conformance = sortById(contract.conformance_rules).map((rule) => ({
    id: rule.id,
    kind: rule.kind,
    severity: rule.severity,
    statement:
      rule.kind === "forbid_dataflow"
        ? `data classified ${rule.from.data_classification} must not reach the ${rule.to.trust_boundary} trust boundary${rule.unless === null ? "" : ` unless it passes through ${rule.unless.passes_through.map((entry) => entry.component_ref).join(", ")}`} (constraint ${rule.constraint_ref})`
        : rule.kind === "approved_candidate_only"
          ? `only the approved candidate may implement workload ${rule.workload_ref}${rule.approved_decision_ref === null ? " (no approved decision is recorded on the rule)" : ` (decision ${rule.approved_decision_ref})`}`
          : `only candidates ${rule.allowed_candidate_refs.join(", ")} may serve workload ${rule.workload_ref}`,
  }));

  const report = buildGapReport(contract, {
    freshness: { asOf, contract },
    ...(options.adapters === undefined ? {} : { adapters: options.adapters }),
  });

  const standingCounts: Record<string, number> = {};
  for (const fact of decisionFacts.values()) {
    standingCounts[fact.standing] = (standingCounts[fact.standing] ?? 0) + 1;
  }

  const facts: ProjectFacts = {
    source,
    disclosure: local ? LOCAL_DISCLOSURE : REMOTE_DISCLOSURE,
    summary: {
      name: contract.project.name,
      state: contract.project.state,
      intent: contract.intent.summary,
      users: [...contract.intent.users],
      outcomes: contract.intent.outcomes.map((outcome) => ({
        measure: outcome.measure,
        target: outcome.target,
      })),
      non_goals: [...contract.intent.non_goals],
      priority_order: [...contract.project.priority_order],
      unresolved_questions: [...contract.intent.unresolved_questions],
      decision_standings: Object.fromEntries(
        Object.entries(standingCounts).sort(([left], [right]) =>
          compareCodeUnits(left, right),
        ),
      ),
      ...(local
        ? { local_repository_roots: [...contract.project.repository_roots] }
        : {}),
    },
    constraints,
    workloads,
    project_decisions: decisions
      .filter((decision) => decision.scope.kind !== "workload")
      .map((decision) => decisionFacts.get(decision.id))
      .filter((entry): entry is DecisionFact => entry !== undefined),
    hardware_capabilities: contract.resources.hardware.map((entry, index) => ({
      alias: `hardware-${index + 1}`,
      knowledge:
        entry.evidence_kind === "user_declared"
          ? ("declared" as const)
          : ("measured" as const),
      cpu_cores: entry.cpu.cores,
      ram_gb: entry.ram_gb,
      accelerators: entry.accelerators.map(
        (accelerator) =>
          `${accelerator.count}x ${accelerator.vendor} ${accelerator.model} ${accelerator.vram_gb} GB`,
      ),
      backend: entry.backend,
      operating_system: entry.operating_system,
    })),
    architecture: {
      authority: "anvilmark",
      nodes,
      relationships: relationshipFacts,
      decision_bindings: bindingFacts,
      trust_boundaries: boundaries.map((boundary) => {
        const declared = unique(
          architecture.nodes
            .filter((node) => node.trust_boundary === boundary)
            .map((node) => node.id),
        );
        return {
          boundary,
          nodes: declared,
          unconfirmed_nodes: declared.filter((id) => !nodeTrusted(id)),
        };
      }),
      conformance_rules: conformance,
    },
    evidence_gaps: {
      workloads: report.workloads.map((entry) => ({
        workload_ref: entry.workload_ref,
        gaps: entry.gaps.map(gapFact),
        candidates: entry.candidates.map((candidate) => ({
          candidate_ref: candidate.candidate_ref,
          gaps: candidate.gaps.map(gapFact),
        })),
      })),
      project: report.project.map(gapFact),
      adapters: report.adapters.map((entry) => ({
        adapter_id: entry.adapter_id,
        standing: entry.standing,
        reason: aliasText(entry.reason),
      })),
    },
  };

  if (!local) {
    // Construction above names every field; this is a second, independent
    // check that no known local value reached the remote projection through
    // free text written by another component.
    const serialized = JSON.stringify(facts);
    const leaked = deniedValues(contract).filter((value) =>
      serialized.includes(value),
    );
    if (leaked.length > 0) {
      throw new Error(
        `refusing to produce remote-default facts: ${leaked.length} local-only value(s) would be included`,
      );
    }
  }

  const secrets = findSecrets(facts);
  if (secrets.length > 0) {
    throw new Error(
      `refusing to produce ${projection} facts: secret-shaped values at ${secrets.map((entry) => entry.path).join(", ")}`,
    );
  }
  return facts;
}
