import type {
  ProjectContract,
  RepositoryBinding,
} from "@anvilmark/project-contract";
import {
  RepositoryBindingSchema,
  approvalState,
  architectureContentHash,
  confirmationStanding,
} from "@anvilmark/project-contract";
import { contractHash } from "@anvilmark/context";

import type {
  NodeAssociation,
  ProposedBinding,
  ScanArtifact,
} from "./artifact.js";

/**
 * The Milestone 6 handoff API: read-only functions over a verified scan
 * artifact and the CURRENT contract. None of them evaluates a rule.
 */

export type ContractProjection =
  | { readonly ok: true; readonly binding: RepositoryBinding }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Project one proposed binding onto the draft.5 `RepositoryBinding` shape,
 * only when the binding is a declared mapping to a decision whose approval
 * was current at scan time. `discovery.kind` is `deterministic`: the scanner
 * applied compiler facts and user-authored declarations mechanically.
 * Heuristic associations are never projected, `agent_inferred` is never used
 * (no agent took part), and M5 never produces `user_confirmed` or
 * `runtime_confirmed`. Spans, hashes, traces and unknowns stay in the local
 * artifact; the projection loses them, which is why it is not the handoff.
 *
 * This returns a value; nothing writes it into a contract.
 */
export function toContractRepositoryBinding(
  artifact: ScanArtifact,
  binding: ProposedBinding,
): ContractProjection {
  if (!binding.contract_projection.eligible || binding.decision.ref === null) {
    return {
      ok: false,
      reasons:
        binding.contract_projection.reasons.length > 0
          ? binding.contract_projection.reasons
          : ["not_eligible"],
    };
  }
  const parsed = RepositoryBindingSchema.safeParse({
    id: binding.id,
    decision_ref: binding.decision.ref,
    architecture_node_ref: binding.component.ref,
    repository_root: binding.repository_root,
    locations: [
      {
        path: binding.location.path,
        symbol: binding.location.symbol,
        line: binding.location.start.line,
      },
    ],
    discovery: {
      kind: "deterministic",
      detector: `${artifact.scanner.id}@${artifact.scanner.version}`,
      observed_at: artifact.observation.observed_at,
    },
    confidence: binding.confidence ?? "low",
  });
  return parsed.success
    ? { ok: true, binding: parsed.data }
    : { ok: false, reasons: ["draft5_shape_rejected"] };
}

export interface NodeStandingCheck {
  readonly ref: string;
  readonly recorded_content_hash: string | null;
  readonly current_content_hash: string | null;
  readonly recorded_standing: NodeAssociation["standing"];
  readonly current_standing: NodeAssociation["standing"];
  readonly changed: boolean;
}

export interface ArtifactStanding {
  /** True only when the contract hash matches and no referenced standing changed. */
  readonly current: boolean;
  readonly contract_hash_matches: boolean;
  readonly contract_revision_matches: boolean;
  readonly decisions: readonly {
    readonly binding_ref: string;
    readonly ref: string;
    readonly recorded_approval_state: string | null;
    readonly current_approval_state: string | null;
    readonly changed: boolean;
  }[];
  readonly architecture_nodes: readonly NodeStandingCheck[];
}

/**
 * Recheck an artifact against the current contract through the hash-aware
 * approval and confirmation APIs. A stale artifact must be rescanned before
 * its bindings are relied on.
 */
export function assessArtifactStanding(
  artifact: ScanArtifact,
  contract: ProjectContract,
): ArtifactStanding {
  const contractMatches =
    artifact.contract.contract_hash === contractHash(contract);
  const decisions = artifact.proposed_bindings
    .filter((binding) => binding.decision.ref !== null)
    .map((binding) => {
      const ref = binding.decision.ref as string;
      const exists = contract.decisions.some((entry) => entry.id === ref);
      const current = exists ? approvalState(contract, ref).state : null;
      return {
        binding_ref: binding.id,
        ref,
        recorded_approval_state: binding.decision.approval_state,
        current_approval_state: current,
        changed: current !== binding.decision.approval_state,
      };
    });
  const nodes = new Map<string, NodeStandingCheck>();
  const check = (association: NodeAssociation | null) => {
    if (
      association === null ||
      association.ref === null ||
      nodes.has(association.ref)
    )
      return;
    const node = contract.architecture.nodes.find(
      (entry) => entry.id === association.ref,
    );
    const element =
      node === undefined ? null : { type: "node" as const, value: node };
    const currentHash =
      element === null ? null : architectureContentHash(element);
    const currentStanding =
      element === null ? null : confirmationStanding(element);
    nodes.set(association.ref, {
      ref: association.ref,
      recorded_content_hash: association.content_hash,
      current_content_hash: currentHash,
      recorded_standing: association.standing,
      current_standing: currentStanding,
      changed:
        currentHash !== association.content_hash ||
        currentStanding !== association.standing,
    });
  };
  for (const binding of artifact.proposed_bindings) {
    check(binding.component);
    check(binding.provider_node);
  }
  for (const declaration of artifact.declarations)
    check(declaration.architecture_node);
  const architecture = [...nodes.values()].sort((left, right) =>
    left.ref < right.ref ? -1 : 1,
  );
  return {
    current:
      contractMatches &&
      decisions.every((entry) => !entry.changed) &&
      architecture.every((entry) => !entry.changed),
    contract_hash_matches: contractMatches,
    contract_revision_matches:
      artifact.contract.contract_revision ===
      contract.project.contract_revision,
    decisions,
    architecture_nodes: architecture,
  };
}
