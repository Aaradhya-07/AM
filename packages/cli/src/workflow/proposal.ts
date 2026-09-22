import type {
  IntelligenceProposal,
  ProposedCandidate,
  ProposedConstraint,
} from "@anvilmark/adapters";
import { proposedArchitecture, reviewProposal } from "@anvilmark/adapters";
import type { ProjectContract } from "@anvilmark/project-contract";
import {
  approvalState,
  findSecrets,
  validateProjectContract,
} from "@anvilmark/project-contract";

export interface ProposalProblem {
  readonly code: string;
  readonly message: string;
}

export interface AppliedProposal {
  readonly contract: ProjectContract;
  readonly proposal: IntelligenceProposal;
  readonly added: {
    readonly constraints: readonly string[];
    readonly candidates: readonly string[];
    readonly questions: readonly string[];
    readonly inferences: readonly string[];
    /** Protocol draft.2: agent-proposed, unconfirmed architecture. */
    readonly architecture_nodes: readonly string[];
    readonly relationships: readonly string[];
    /** Decision refs of the bindings added. */
    readonly decision_bindings: readonly string[];
  };
  /** Questions the contract already held, so nothing new was recorded. */
  readonly duplicate_questions: readonly string[];
  /** Generated prose that has no place in the contract, kept as provenance. */
  readonly generated_rationale: {
    readonly summary: IntelligenceProposal["rationale"];
    readonly constraints: Readonly<Record<string, string>>;
    readonly candidates: Readonly<Record<string, string>>;
  };
}

export type ProposalApplication =
  | { readonly ok: true; readonly value: AppliedProposal }
  | { readonly ok: false; readonly problems: readonly ProposalProblem[] };

function refuse(problems: readonly ProposalProblem[]): ProposalApplication {
  return { ok: false, problems };
}

function mapConstraint(
  entry: ProposedConstraint,
): { readonly value: Record<string, unknown> } | { readonly problem: string } {
  if (entry.severity === "soft" && entry.direction === null) {
    return {
      problem: `proposed constraint "${entry.id}" is soft but states no direction (minimize, maximize or target)`,
    };
  }
  if (entry.severity !== "soft" && entry.direction !== null) {
    return {
      problem: `proposed constraint "${entry.id}" is ${entry.severity} and cannot carry a direction; only soft constraints are preferences`,
    };
  }
  return {
    value: {
      id: entry.id,
      domain: entry.domain,
      severity: entry.severity,
      ...(entry.severity === "soft" ? { direction: entry.direction } : {}),
      subject: entry.subject,
      operator: entry.operator,
      value: entry.value,
      source: "agent_proposed",
      rationale: entry.rationale,
      condition: null,
      exceptions: [],
    },
  };
}

function mapCandidate(
  entry: ProposedCandidate,
): { readonly value: Record<string, unknown> } | { readonly problem: string } {
  if (entry.model_family === null && entry.model_version !== null) {
    return {
      problem: `proposed candidate "${entry.id}" gives a model version without a model family`,
    };
  }
  if (entry.deployment_mode === "local" && entry.provider !== null) {
    return {
      problem: `proposed candidate "${entry.id}" is local but names a provider; a local deployment records a runtime and hardware, which the user supplies`,
    };
  }
  const deployment =
    entry.deployment_mode === "local"
      ? { mode: "local", runtime: null, hardware_ref: null }
      : entry.deployment_mode === "managed_api"
        ? { mode: "managed_api", provider: entry.provider, region: null }
        : {
            mode: "self_hosted",
            provider: entry.provider,
            region: null,
            runtime: null,
          };
  return {
    value: {
      id: entry.id,
      workload_ref: entry.workload_ref,
      component_kind: entry.component_kind,
      model:
        entry.model_family === null
          ? null
          : {
              family: entry.model_family,
              version: entry.model_version,
              // A generated reference is never recorded as pinned. The
              // proposal protocol has no mutability field, and a version
              // string such as "latest" or "8b" does not by itself name an
              // immutable artifact. The user confirms pinning explicitly
              // with "candidate model" after checking.
              version_mutability: "floating",
              quantization: null,
              license_evidence_ref: null,
            },
      deployment,
      measurements: {},
      estimates: {},
      constraint_results: [],
      // Every proposed option starts undiscovered-by-evidence. A proposal has
      // no status field, so it cannot claim viability.
      status: "discovered",
    },
  };
}

/**
 * Apply an intelligence proposal to a contract, all or nothing.
 *
 * Order: secret scan of the raw document; `reviewProposal` (schema, forbidden
 * fields, hard-constraint redefinition); refusal of any id that already exists,
 * because a proposal ADDS and never replaces; mapping into contract shapes;
 * full validation of the ASSEMBLED contract (schema, references, floors,
 * approval hashes, secrets); and a check that no current approval became
 * non-current. Any failure returns problems and no contract.
 *
 * Inferences become `agent_inference` evidence: tier T0, attributed to no
 * candidate or constraint, so they can never satisfy an evidence floor.
 *
 * Protocol draft.2 architecture becomes agent-proposed, unconfirmed nodes,
 * relationships and decision bindings naming this proposal. Existing ids and
 * bindings are never overwritten or extended, and every reference must resolve
 * to an existing element or one proposed in the same document.
 */
export function applyProposal(
  contract: ProjectContract,
  raw: unknown,
  provenance: {
    readonly proposalId: string;
    readonly adapterId: string;
    readonly receivedAt: string;
    readonly sourceType: "api" | "file";
  },
): ProposalApplication {
  if (findSecrets(raw).length > 0) {
    return refuse([
      {
        code: "secret_detected",
        message:
          "the proposal contains a secret-shaped value; it was rejected and its content was not stored",
      },
    ]);
  }

  const review = reviewProposal(contract, raw);
  if (!review.accepted || review.proposal === null) {
    return refuse(
      review.errors.map((entry) => {
        const problems = Array.isArray(entry.detail.problems)
          ? `: ${(entry.detail.problems as string[]).join("; ")}`
          : "";
        return { code: entry.code, message: `${entry.message}${problems}` };
      }),
    );
  }
  const proposal = review.proposal;
  const problems: ProposalProblem[] = [];

  const existingConstraints = new Set(contract.constraints.map((e) => e.id));
  const existingCandidates = new Set(contract.candidates.map((e) => e.id));
  for (const entry of proposal.proposed_constraints) {
    if (existingConstraints.has(entry.id)) {
      problems.push({
        code: "overwrite_refused",
        message: `constraint "${entry.id}" already exists; a proposal can add constraints but never replace or weaken one`,
      });
    }
  }
  for (const entry of proposal.proposed_candidates) {
    if (existingCandidates.has(entry.id)) {
      problems.push({
        code: "overwrite_refused",
        message: `candidate "${entry.id}" already exists; a proposal can add candidates but never replace one`,
      });
    }
  }

  // Protocol draft.2 architecture. A proposal ADDS new elements and never
  // replaces or extends existing ones; every reference must resolve to an
  // existing node or one proposed in this same document. Imported elements
  // are agent-proposed and unconfirmed: nothing here can confirm them.
  const architecture = proposedArchitecture(proposal);
  const existingNodes = new Set(contract.architecture.nodes.map((e) => e.id));
  const existingRelationships = new Set(
    contract.architecture.relationships.map((e) => e.id),
  );
  const boundDecisions = new Set(
    contract.architecture.decision_bindings.map((e) => e.decision_ref),
  );
  const proposedNodes = new Set<string>();
  for (const entry of architecture.nodes) {
    if (existingNodes.has(entry.id)) {
      problems.push({
        code: "overwrite_refused",
        message: `architecture node "${entry.id}" already exists; a proposal can add nodes but never replace one`,
      });
    } else if (proposedNodes.has(entry.id)) {
      problems.push({
        code: "schema_rejected",
        message: `architecture node "${entry.id}" is proposed more than once`,
      });
    }
    proposedNodes.add(entry.id);
  }
  const nodeExists = (id: string) =>
    existingNodes.has(id) || proposedNodes.has(id);
  const proposedRelationships = new Set<string>();
  for (const entry of architecture.relationships) {
    if (existingRelationships.has(entry.id)) {
      problems.push({
        code: "overwrite_refused",
        message: `architecture relationship "${entry.id}" already exists; a proposal can add relationships but never replace one`,
      });
    } else if (proposedRelationships.has(entry.id)) {
      problems.push({
        code: "schema_rejected",
        message: `architecture relationship "${entry.id}" is proposed more than once`,
      });
    }
    proposedRelationships.add(entry.id);
    for (const [end, ref] of [
      ["source", entry.source],
      ["destination", entry.destination],
    ] as const) {
      if (!nodeExists(ref)) {
        problems.push({
          code: "reference_not_found",
          message: `proposed relationship "${entry.id}" names ${end} "${ref}", which is neither an existing node nor a node proposed in this document`,
        });
      }
    }
  }
  const proposedBindings = new Set<string>();
  for (const entry of architecture.bindings) {
    if (boundDecisions.has(entry.decision_ref)) {
      problems.push({
        code: "overwrite_refused",
        message: `decision "${entry.decision_ref}" already has an architecture binding; a proposal cannot extend or replace an existing binding`,
      });
    } else if (proposedBindings.has(entry.decision_ref)) {
      problems.push({
        code: "schema_rejected",
        message: `a binding for decision "${entry.decision_ref}" is proposed more than once`,
      });
    }
    proposedBindings.add(entry.decision_ref);
    if (new Set(entry.node_refs).size !== entry.node_refs.length) {
      problems.push({
        code: "schema_rejected",
        message: `the proposed binding for "${entry.decision_ref}" names a node more than once`,
      });
    }
    for (const ref of entry.node_refs) {
      if (!nodeExists(ref)) {
        problems.push({
          code: "reference_not_found",
          message: `the proposed binding for "${entry.decision_ref}" names node "${ref}", which is neither an existing node nor a node proposed in this document`,
        });
      }
    }
  }
  const proposedOrigin = {
    kind: "agent_proposed",
    proposal_ref: provenance.proposalId,
    confirmed_at: null,
    confirmed_content_hash: null,
  };

  const constraints: Record<string, unknown>[] = [];
  for (const entry of proposal.proposed_constraints) {
    const mapped = mapConstraint(entry);
    if ("problem" in mapped) {
      problems.push({ code: "schema_rejected", message: mapped.problem });
    } else {
      constraints.push(mapped.value);
    }
  }
  const candidates: Record<string, unknown>[] = [];
  for (const entry of proposal.proposed_candidates) {
    const mapped = mapCandidate(entry);
    if ("problem" in mapped) {
      problems.push({ code: "schema_rejected", message: mapped.problem });
    } else {
      candidates.push(mapped.value);
    }
  }
  if (problems.length > 0) {
    return refuse(problems);
  }

  const questions: string[] = [];
  const duplicates: string[] = [];
  for (const question of proposal.questions) {
    if (
      contract.intent.unresolved_questions.includes(question) ||
      questions.includes(question)
    ) {
      duplicates.push(question);
    } else {
      questions.push(question);
    }
  }

  const inferences = proposal.inferences.map((entry, index) => ({
    id: `evidence.inference.${provenance.proposalId}.${index + 1}`,
    kind: "agent_inference",
    subject: entry.subject,
    producer: { name: provenance.adapterId, version: null },
    observed_at: provenance.receivedAt,
    source: { type: provenance.sourceType, locator: null },
    confidence: entry.confidence,
    caveats: [
      ...entry.caveats,
      `T0 agent inference generated through "${provenance.adapterId}"; not a measurement, and never sufficient for any evidence floor`,
    ],
    refresh: { policy: "never", expires_at: null },
    applies_to: {
      candidate_ref: null,
      workload_ref: null,
      hardware_ref: null,
      constraint_refs: [],
    },
    value: { claim: entry.claim },
  }));

  const document = structuredClone(contract) as unknown as {
    constraints: unknown[];
    candidates: unknown[];
    evidence_refs: unknown[];
    intent: { unresolved_questions: string[] };
    project: { updated_at: string };
    architecture: {
      nodes: unknown[];
      relationships: unknown[];
      decision_bindings: unknown[];
    };
  };
  document.architecture.nodes.push(
    ...architecture.nodes.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      name: entry.name,
      trust_boundary: entry.trust_boundary,
      description: entry.description,
      interfaces: [],
      origin: proposedOrigin,
    })),
  );
  document.architecture.relationships.push(
    ...architecture.relationships.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      source: entry.source,
      destination: entry.destination,
      workload_ref: entry.workload_ref,
      data_classification: entry.data_classification,
      source_interface_ref: null,
      destination_interface_ref: null,
      origin: proposedOrigin,
    })),
  );
  document.architecture.decision_bindings.push(
    ...architecture.bindings.map((entry) => ({
      decision_ref: entry.decision_ref,
      node_refs: [...entry.node_refs],
      origin: proposedOrigin,
    })),
  );
  document.constraints.push(...constraints);
  document.candidates.push(...candidates);
  document.evidence_refs.push(...inferences);
  document.intent.unresolved_questions.push(...questions);
  document.project.updated_at = provenance.receivedAt;

  const assembled = validateProjectContract(document);
  if (!assembled.ok) {
    return refuse(
      assembled.issues.map((entry) => ({
        code: entry.code,
        message: `the contract this proposal would produce is invalid at ${entry.path}: ${entry.message}`,
      })),
    );
  }

  for (const decision of contract.decisions) {
    if (
      approvalState(contract, decision.id).state === "current" &&
      approvalState(assembled.value, decision.id).state !== "current"
    ) {
      return refuse([
        {
          code: "overwrite_refused",
          message: `the proposal would change content approved in decision "${decision.id}"; proposals cannot alter approved content`,
        },
      ]);
    }
  }

  return {
    ok: true,
    value: {
      contract: assembled.value,
      proposal,
      added: {
        constraints: proposal.proposed_constraints.map((entry) => entry.id),
        candidates: proposal.proposed_candidates.map((entry) => entry.id),
        questions,
        inferences: inferences.map((entry) => entry.id),
        architecture_nodes: architecture.nodes.map((entry) => entry.id),
        relationships: architecture.relationships.map((entry) => entry.id),
        decision_bindings: architecture.bindings.map(
          (entry) => entry.decision_ref,
        ),
      },
      duplicate_questions: duplicates,
      generated_rationale: {
        summary: proposal.rationale,
        constraints: Object.fromEntries(
          proposal.proposed_constraints
            .filter((entry) => entry.rationale !== null)
            .map((entry) => [entry.id, entry.rationale as string]),
        ),
        candidates: Object.fromEntries(
          proposal.proposed_candidates
            .filter((entry) => entry.rationale !== null)
            .map((entry) => [entry.id, entry.rationale as string]),
        ),
      },
    },
  };
}
