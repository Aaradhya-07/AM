import type { ProjectContract } from "@anvilmark/project-contract";
import { approvalState } from "@anvilmark/project-contract";

import type {
  LocationRecord,
  NodeAssociation,
  Observation,
  ProposedBinding,
} from "./artifact.js";
import type { DeclarationSet } from "./declarations.js";
import { nodeAssociation } from "./declarations.js";
import { compareStrings, stableId } from "./model.js";
import type { RecognizerSet } from "./recognizers/index.js";
import type { SemanticFacts } from "./semantics.js";

/**
 * Binding stage: propose how each observed provider call relates to the
 * approved architecture and decisions. Nothing is written to the contract.
 *
 * - `declared_mapping`: a scan declaration names the architecture node,
 *   candidate or component for this resolved call site.
 * - `heuristic_association`: no declaration; the scanner associated a remote
 *   SDK's call with the contract's ONLY `remote_provider` node. This is a
 *   structural guess made by the scanner, not an assertion by any agent.
 * - `unbound`: missing or ambiguous; the reasons say which.
 */

type CallObservation = Extract<Observation, { kind: "provider_call" }>;

function unboundNode(): NodeAssociation {
  return {
    ref: null,
    association: "unbound",
    declaration_ref: null,
    trust_boundary: null,
    standing: null,
    content_hash: null,
    trusted: null,
  };
}

function contains(
  outer:
    | LocationRecord
    | {
        start: { line: number; column: number };
        end: { line: number; column: number };
      },
  inner: LocationRecord,
): boolean {
  const before = (
    a: { line: number; column: number },
    b: { line: number; column: number },
  ) => a.line < b.line || (a.line === b.line && a.column <= b.column);
  return before(outer.start, inner.start) && before(inner.end, outer.end);
}

/** Why an operation cannot be attributed to a candidate, or null when it can. */
export function operationFitsCandidate(
  kind: CallObservation["operation_kind"],
  componentKind: ProjectContract["candidates"][number]["component_kind"],
): string | null {
  if (kind === "data_upload" || kind === "management")
    return "operation_does_not_invoke_a_model";
  if (kind === "embedding")
    return componentKind === "embedding_model"
      ? null
      : "operation_kind_incompatible_with_candidate";
  return componentKind === "embedding_model"
    ? "operation_kind_incompatible_with_candidate"
    : null;
}

function remoteDestination(
  call: CallObservation,
  recognizerDefault: "managed_api" | "local" | undefined,
): boolean {
  return call.endpoint.deployment !== null
    ? call.endpoint.deployment === "managed_api"
    : (recognizerDefault ?? call.default_deployment) === "managed_api";
}

export function proposeBindings(input: {
  readonly contract: ProjectContract;
  readonly declarations: DeclarationSet;
  readonly observations: readonly Observation[];
  readonly semantics: SemanticFacts;
  readonly recognizers: RecognizerSet;
  readonly repositoryRoot: string;
  readonly componentLocations: ReadonlyMap<string, LocationRecord | null>;
}): ProposedBinding[] {
  const { contract, declarations, observations, recognizers } = input;
  const bindings: ProposedBinding[] = [];
  const remoteNodes = contract.architecture.nodes.filter(
    (node) => node.trust_boundary === "remote_provider",
  );

  for (const observation of observations) {
    if (observation.kind !== "provider_call") continue;
    const call: CallObservation = observation;
    const reasons: string[] = [];

    // Provider node and candidate, from sink declarations.
    const sinks = declarations.sinks.filter(
      (sink) =>
        sink.recognizer === call.recognizer &&
        (sink.operations.length === 0 ||
          sink.operations.includes(call.operation)) &&
        (sink.paths.length === 0 ||
          sink.paths.some(
            (path) =>
              path === "." ||
              call.location.path === path ||
              call.location.path.startsWith(`${path}/`),
          )),
    );
    let providerNode = unboundNode();
    let candidate: ProposedBinding["candidate"] = {
      ref: null,
      association: "unbound",
      declaration_ref: null,
    };
    const recognizer = recognizers.providers.find(
      (entry) => entry.id === call.recognizer,
    );
    if (sinks.length === 1) {
      const sink = sinks[0]!;
      const record = declarations.records.find((entry) => entry.id === sink.id);
      providerNode = record?.architectureNode ?? unboundNode();
      if (sink.architecture_node_ref === null)
        reasons.push("sink_declaration_has_no_architecture_node");
      else if (providerNode.ref === null)
        reasons.push("sink_architecture_node_not_in_contract");
      const declaredCandidate =
        sink.candidate_ref === null
          ? undefined
          : contract.candidates.find(
              (entry) => entry.id === sink.candidate_ref,
            );
      const compatibility =
        declaredCandidate === undefined
          ? null
          : operationFitsCandidate(
              call.operation_kind,
              declaredCandidate.component_kind,
            );
      if (declaredCandidate === undefined) {
        reasons.push("no_candidate_declared");
      } else if (compatibility !== null) {
        // An embedding call is not the chat model; a file upload invokes no model.
        reasons.push(compatibility);
      } else {
        candidate = {
          ref: declaredCandidate.id,
          association: "declared_mapping",
          declaration_ref: sink.id,
        };
      }
    } else if (sinks.length > 1) {
      reasons.push("multiple_sink_declarations_match");
    } else if (
      remoteDestination(call, recognizer?.defaultDeployment) &&
      remoteNodes.length === 1
    ) {
      providerNode = nodeAssociation(
        contract,
        remoteNodes[0]!.id,
        "heuristic_association",
        null,
      );
      reasons.push("no_sink_declaration", "no_candidate_declared");
    } else {
      reasons.push(
        "no_sink_declaration",
        ...(remoteDestination(call, recognizer?.defaultDeployment) &&
        remoteNodes.length > 1
          ? ["multiple_remote_provider_nodes"]
          : []),
        "no_candidate_declared",
      );
    }

    // Component (the implementation node), from component declarations.
    const matching = declarations.components
      .filter(
        (entry) =>
          entry.usable && entry.declaration.path === call.location.path,
      )
      .filter((entry) => {
        if (entry.declaration.export === null) return true;
        const where = input.componentLocations.get(entry.declaration.id);
        return (
          where !== null &&
          where !== undefined &&
          contains(where, call.location)
        );
      });
    const specific = matching.filter(
      (entry) => entry.declaration.export !== null,
    );
    const chosen = specific.length > 0 ? specific : matching;
    let component = unboundNode();
    let componentWorkload: string | null = null;
    let componentId: string | null = null;
    if (chosen.length === 1) {
      const entry = chosen[0]!;
      componentId = entry.declaration.id;
      const record = declarations.records.find(
        (item) => item.id === entry.declaration.id,
      );
      component = record?.architectureNode ?? unboundNode();
      if (component.ref === null)
        reasons.push("component_architecture_node_not_in_contract");
      componentWorkload = contract.workloads.some(
        (workload) => workload.id === entry.declaration.workload_ref,
      )
        ? entry.declaration.workload_ref
        : null;
    } else if (chosen.length > 1) {
      reasons.push("ambiguous_component_declarations");
    } else {
      reasons.push("no_component_declaration");
    }

    // Workload, from the component or the declared candidate.
    const candidateWorkload =
      candidate.ref === null
        ? null
        : (contract.candidates.find((entry) => entry.id === candidate.ref)
            ?.workload_ref ?? null);
    let workload: ProposedBinding["workload"] = {
      ref: null,
      association: "unbound",
      declaration_ref: null,
    };
    if (
      componentWorkload !== null &&
      candidateWorkload !== null &&
      componentWorkload !== candidateWorkload
    ) {
      reasons.push("component_and_candidate_workloads_differ");
    } else if (componentWorkload !== null) {
      workload = {
        ref: componentWorkload,
        association: "declared_mapping",
        declaration_ref: componentId,
      };
    } else if (
      candidateWorkload !== null &&
      declarations.components.some(
        (entry) =>
          entry.usable && entry.declaration.workload_ref === candidateWorkload,
      )
    ) {
      // The workload's files are declared, and this call is not in them.
      reasons.push("outside_declared_components_of_workload");
    } else if (candidateWorkload !== null) {
      workload = {
        ref: candidateWorkload,
        association: "declared_mapping",
        declaration_ref: candidate.declaration_ref,
      };
    } else {
      reasons.push("no_workload_association");
    }

    // Decision, from the contract for that workload.
    let decision: ProposedBinding["decision"] = {
      ref: null,
      association: "unbound",
      status: null,
      approval_state: null,
      selected_candidate_ref: null,
    };
    if (workload.ref !== null) {
      const declared =
        contract.workloads.find((entry) => entry.id === workload.ref)
          ?.current_decision_ref ?? null;
      const open = contract.decisions.filter(
        (entry) =>
          entry.scope.kind === "workload" &&
          entry.scope.workload_ref === workload.ref &&
          entry.status !== "rejected" &&
          entry.status !== "superseded",
      );
      const found =
        declared !== null
          ? contract.decisions.find((entry) => entry.id === declared)
          : open.length === 1
            ? open[0]
            : undefined;
      if (found !== undefined) {
        decision = {
          ref: found.id,
          association: "contract_workload_decision",
          status: found.status,
          approval_state: approvalState(contract, found.id).state,
          selected_candidate_ref: found.selected_candidate_ref,
        };
      } else {
        reasons.push(
          open.length > 1
            ? "multiple_decisions_for_workload"
            : "no_decision_for_workload",
        );
      }
    }

    const parts = [
      providerNode.association,
      component.association,
      candidate.association,
      workload.association,
    ];
    const discovery = parts.includes("heuristic_association")
      ? "heuristic_association"
      : parts.includes("declared_mapping")
        ? "declared_mapping"
        : "unresolved";
    const blocking = reasons.filter(
      (reason) => reason !== "no_candidate_declared",
    );
    const confidence =
      discovery === "declared_mapping"
        ? blocking.length === 0 && decision.ref !== null
          ? "high"
          : "medium"
        : discovery === "heuristic_association"
          ? "low"
          : null;

    const projectionReasons: string[] = [];
    if (discovery !== "declared_mapping")
      projectionReasons.push(`discovery_${discovery}_not_projectable`);
    if (decision.ref === null) projectionReasons.push("no_decision");
    else if (decision.approval_state !== "current")
      projectionReasons.push("decision_approval_not_current");
    if (
      component.association === "heuristic_association" ||
      providerNode.association === "heuristic_association"
    ) {
      projectionReasons.push("heuristic_part");
    }

    bindings.push({
      id: stableId("binding", [call.id]),
      observation_ref: call.id,
      client_ref: call.client_ref,
      data_flow_ref: call.data_flow_ref,
      repository_root: input.repositoryRoot,
      location: call.location,
      component,
      provider_node: providerNode,
      workload,
      candidate,
      decision,
      discovery,
      confidence,
      evidence_tier: discovery === "declared_mapping" ? "T1" : "T0",
      unbound_reasons: [...new Set(reasons)].sort(compareStrings),
      contract_projection: {
        eligible: projectionReasons.length === 0,
        discovery_kind: projectionReasons.length === 0 ? "deterministic" : null,
        reasons: [...new Set(projectionReasons)].sort(compareStrings),
      },
    });
  }
  return bindings.sort((left, right) => compareStrings(left.id, right.id));
}
