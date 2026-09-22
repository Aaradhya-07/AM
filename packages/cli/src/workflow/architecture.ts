import type {
  ArchitectureElement,
  ArchitectureNode,
  ArchitectureOrigin,
  ArchitectureRelationship,
  ConfirmationStanding,
  DecisionBinding,
  ProjectContract,
} from "@anvilmark/project-contract";
import {
  DataClassificationSchema,
  IdSchema,
  InterfaceProtocolSchema,
  NodeKindSchema,
  RelationshipKindSchema,
  TrustBoundarySchema,
  architectureContentHash,
  confirmationStanding,
} from "@anvilmark/project-contract";

import { WorkflowError, clone } from "./edit.js";

/**
 * Architecture edits over the draft.5 fields.
 *
 * Every function returns a new contract; nothing is written here. The caller
 * commits through the ordinary store, so an edit is validated as a complete
 * contract -- references, classifications, approvals and secret scanning --
 * before `project.yaml` changes, and a refused edit changes nothing.
 *
 * Architecture is declared structure. It is not part of any decision's
 * approval content, so editing it never makes an approval stale; a binding to
 * a decision that is not approved and current is reported, never upgraded.
 *
 * Confirmation (amendment 8): an edit that changes the covered content of a
 * confirmed agent-proposed element clears its confirmation, with a notice. No
 * edit sets confirmation; only `confirmArchitectureElement`, called by the
 * interactive `architecture confirm` command, does.
 */

type Edit = {
  readonly contract: ProjectContract;
  readonly summary: string;
  readonly notices: readonly string[];
};

function touch(contract: ProjectContract, now: string): ProjectContract {
  contract.project.updated_at = now;
  return contract;
}

const USER_ORIGIN: ArchitectureOrigin = {
  kind: "user",
  proposal_ref: null,
  confirmed_at: null,
  confirmed_content_hash: null,
};

export type ArchitectureTargetKind = "node" | "relationship" | "binding";

export interface ArchitectureTarget {
  readonly kind: ArchitectureTargetKind;
  /** Node id, relationship id, or the binding's decision_ref. */
  readonly ref: string;
}

function elementsOf(
  contract: ProjectContract,
): { target: ArchitectureTarget; element: ArchitectureElement }[] {
  return [
    ...contract.architecture.nodes.map((value) => ({
      target: { kind: "node" as const, ref: value.id },
      element: { type: "node" as const, value },
    })),
    ...contract.architecture.relationships.map((value) => ({
      target: { kind: "relationship" as const, ref: value.id },
      element: { type: "relationship" as const, value },
    })),
    ...contract.architecture.decision_bindings.map((value) => ({
      target: { kind: "binding" as const, ref: value.decision_ref },
      element: { type: "decision_binding" as const, value },
    })),
  ];
}

/**
 * Finish an edit: clear the confirmation of every confirmed agent-proposed
 * element whose covered content this edit changed. An element whose record was
 * already stale before the edit (a manual edit) keeps it for inspection unless
 * this edit also changed it.
 */
function finish(
  before: ProjectContract,
  next: ProjectContract,
  now: string,
  summary: string,
  notices: readonly string[],
): Edit {
  const previous = new Map(
    elementsOf(before).map(({ target, element }) => [
      `${target.kind}:${target.ref}`,
      architectureContentHash(element),
    ]),
  );
  const cleared: string[] = [];
  for (const { target, element } of elementsOf(next)) {
    const origin = element.value.origin;
    if (origin.kind !== "agent_proposed" || origin.confirmed_at === null) {
      continue;
    }
    const earlier = previous.get(`${target.kind}:${target.ref}`);
    if (earlier !== undefined && earlier === architectureContentHash(element)) {
      continue;
    }
    element.value.origin = {
      ...origin,
      confirmed_at: null,
      confirmed_content_hash: null,
    };
    cleared.push(
      `${target.kind} ${target.ref} was confirmed, and this edit changed its confirmed content; it is agent-proposed and unconfirmed again (confirm it with anvilmark architecture confirm ${target.kind} ${target.ref})`,
    );
  }
  return {
    contract: touch(next, now),
    summary,
    notices: [...notices, ...cleared],
  };
}

function choice<T extends string>(
  schema: { readonly options: readonly T[] },
  value: string,
  label: string,
): T {
  if (!(schema.options as readonly string[]).includes(value)) {
    throw new WorkflowError(
      `${label} must be one of ${schema.options.join(", ")}; got "${value}"`,
    );
  }
  return value as T;
}

function checkId(value: string, label: string): string {
  const result = IdSchema.safeParse(value);
  if (!result.success) {
    throw new WorkflowError(
      `${label} "${value}" is not a valid id: ${result.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return value;
}

function declaredLabels(contract: ProjectContract): Set<string> {
  return new Set(
    contract.workloads.flatMap((workload) =>
      workload.output_classification === null
        ? [workload.input_classification]
        : [workload.input_classification, workload.output_classification],
    ),
  );
}

function checkClassification(contract: ProjectContract, value: string): string {
  if (!DataClassificationSchema.safeParse(value).success) {
    throw new WorkflowError(
      `data classification "${value}" must be lower_snake_case`,
    );
  }
  const labels = declaredLabels(contract);
  if (!labels.has(value)) {
    throw new WorkflowError(
      `data classification "${value}" is not declared as the input or output of any workload; declared: ${[...labels].sort().join(", ") || "none"}. Declare it on a workload first, or leave the relationship's classification unknown`,
    );
  }
  return value;
}

function findNode(contract: ProjectContract, id: string): ArchitectureNode {
  const node = contract.architecture.nodes.find((entry) => entry.id === id);
  if (node === undefined) {
    const known = contract.architecture.nodes.map((entry) => entry.id);
    throw new WorkflowError(
      `architecture node "${id}" does not exist; nodes: ${known.join(", ") || "none"}`,
    );
  }
  return node;
}

function findRelationship(
  contract: ProjectContract,
  id: string,
): ArchitectureRelationship {
  const relationship = contract.architecture.relationships.find(
    (entry) => entry.id === id,
  );
  if (relationship === undefined) {
    const known = contract.architecture.relationships.map((entry) => entry.id);
    throw new WorkflowError(
      `architecture relationship "${id}" does not exist; relationships: ${known.join(", ") || "none"}`,
    );
  }
  return relationship;
}

function checkWorkload(contract: ProjectContract, id: string): string {
  if (!contract.workloads.some((entry) => entry.id === id)) {
    throw new WorkflowError(
      `workload "${id}" does not exist; workloads: ${contract.workloads.map((entry) => entry.id).join(", ") || "none"}`,
    );
  }
  return id;
}

function flowNotices(
  contract: ProjectContract,
  relationship: ArchitectureRelationship,
): string[] {
  const notices: string[] = [];
  const source = contract.architecture.nodes.find(
    (entry) => entry.id === relationship.source,
  );
  const destination = contract.architecture.nodes.find(
    (entry) => entry.id === relationship.destination,
  );
  const flow = relationship.kind === "connects" || relationship.kind === "uses";
  if (
    flow &&
    source !== undefined &&
    destination !== undefined &&
    source.trust_boundary !== destination.trust_boundary
  ) {
    notices.push(
      `${relationship.id} crosses the trust boundary from ${source.trust_boundary} to ${destination.trust_boundary}`,
    );
  }
  if (flow && relationship.data_classification === null) {
    notices.push(
      `${relationship.id} has no declared data classification; it is shown as unknown and unresolved`,
    );
  }
  return notices;
}

export interface NodeInput {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly trustBoundary: string;
  readonly description: string | null;
}

export function addArchitectureNode(
  contract: ProjectContract,
  input: NodeInput,
  now: string,
): Edit {
  const next = clone(contract);
  checkId(input.id, "node id");
  if (next.architecture.nodes.some((entry) => entry.id === input.id)) {
    throw new WorkflowError(`architecture node "${input.id}" already exists`);
  }
  next.architecture.nodes.push({
    id: input.id,
    kind: choice(NodeKindSchema, input.kind, "--kind"),
    name: input.name,
    trust_boundary: choice(
      TrustBoundarySchema,
      input.trustBoundary,
      "--trust-boundary",
    ),
    description: input.description,
    interfaces: [],
    origin: { ...USER_ORIGIN },
  });
  return finish(
    contract,
    next,
    now,
    `added architecture node ${input.id} (${input.kind}, ${input.trustBoundary})`,
    [
      `${input.id} is declared structure; it has no linked decision until you bind one`,
    ],
  );
}

export function updateArchitectureNode(
  contract: ProjectContract,
  id: string,
  change: {
    readonly kind?: string;
    readonly name?: string;
    readonly trustBoundary?: string;
    /** Null clears the description. */
    readonly description?: string | null;
  },
  now: string,
): Edit {
  const next = clone(contract);
  const node = findNode(next, id);
  const changed: string[] = [];
  if (change.kind !== undefined) {
    node.kind = choice(NodeKindSchema, change.kind, "--kind");
    changed.push("kind");
  }
  if (change.name !== undefined) {
    node.name = change.name;
    changed.push("name");
  }
  if (change.trustBoundary !== undefined) {
    node.trust_boundary = choice(
      TrustBoundarySchema,
      change.trustBoundary,
      "--trust-boundary",
    );
    changed.push("trust boundary");
  }
  if (change.description !== undefined) {
    node.description = change.description;
    changed.push("description");
  }
  if (changed.length === 0) {
    throw new WorkflowError(`nothing to change for architecture node "${id}"`);
  }
  const notices = next.architecture.relationships
    .filter((entry) => entry.source === id || entry.destination === id)
    .flatMap((entry) => flowNotices(next, entry));
  return finish(
    contract,
    next,
    now,
    `updated architecture node ${id}: ${changed.join(", ")}`,
    notices,
  );
}

export function removeArchitectureNode(
  contract: ProjectContract,
  id: string,
  now: string,
): Edit {
  const next = clone(contract);
  findNode(next, id);
  const references = [
    ...next.architecture.relationships
      .filter((entry) => entry.source === id || entry.destination === id)
      .map((entry) => `relationship ${entry.id}`),
    ...next.architecture.decision_bindings
      .filter((entry) => entry.node_refs.includes(id))
      .map((entry) => `decision binding for ${entry.decision_ref}`),
    ...next.decisions
      .filter(
        (entry) =>
          entry.scope.kind === "component" && entry.scope.component_ref === id,
      )
      .map((entry) => `decision ${entry.id} (component scope)`),
    ...next.repository_bindings
      .filter((entry) => entry.architecture_node_ref === id)
      .map((entry) => `repository binding ${entry.id}`),
    ...next.conformance_rules.flatMap((rule) =>
      rule.kind === "forbid_dataflow" &&
      rule.unless !== null &&
      rule.unless.passes_through.some((entry) => entry.component_ref === id)
        ? [`conformance rule ${rule.id}`]
        : [],
    ),
  ];
  if (references.length > 0) {
    throw new WorkflowError(
      `architecture node "${id}" is still referenced by ${references.join(", ")}; remove or change those first`,
    );
  }
  next.architecture.nodes = next.architecture.nodes.filter(
    (entry) => entry.id !== id,
  );
  return finish(contract, next, now, `removed architecture node ${id}`, []);
}

export interface RelationshipInput {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly destination: string;
  readonly workload: string | null;
  readonly dataClassification: string | null;
  readonly sourceInterface?: string | null;
  readonly destinationInterface?: string | null;
}

function interfaceOwner(
  contract: ProjectContract,
  interfaceId: string,
): ArchitectureNode | undefined {
  return contract.architecture.nodes.find((node) =>
    node.interfaces.some((entry) => entry.id === interfaceId),
  );
}

function checkInterfaceRef(
  contract: ProjectContract,
  relationship: ArchitectureRelationship,
  end: "source" | "destination",
  interfaceId: string,
): string {
  if (relationship.kind !== "connects") {
    throw new WorkflowError(
      `only connects relationships may reference interfaces; "${relationship.id}" is ${relationship.kind}`,
    );
  }
  const owner = interfaceOwner(contract, interfaceId);
  const endpoint =
    end === "source" ? relationship.source : relationship.destination;
  if (owner === undefined) {
    const declared = contract.architecture.nodes
      .find((node) => node.id === endpoint)
      ?.interfaces.map((entry) => entry.id);
    throw new WorkflowError(
      `interface "${interfaceId}" does not exist; ${end} node "${endpoint}" declares: ${declared?.join(", ") || "none"}`,
    );
  }
  if (owner.id !== endpoint) {
    throw new WorkflowError(
      `interface "${interfaceId}" is declared on node "${owner.id}", not on the ${end} node "${endpoint}"`,
    );
  }
  return interfaceId;
}

export function addArchitectureRelationship(
  contract: ProjectContract,
  input: RelationshipInput,
  now: string,
): Edit {
  const next = clone(contract);
  checkId(input.id, "relationship id");
  if (next.architecture.relationships.some((entry) => entry.id === input.id)) {
    throw new WorkflowError(
      `architecture relationship "${input.id}" already exists`,
    );
  }
  findNode(next, input.source);
  findNode(next, input.destination);
  if (input.source === input.destination) {
    throw new WorkflowError(
      `a relationship must connect two different nodes; got "${input.source}" twice`,
    );
  }
  const relationship: ArchitectureRelationship = {
    id: input.id,
    kind: choice(RelationshipKindSchema, input.kind, "--kind"),
    source: input.source,
    destination: input.destination,
    workload_ref:
      input.workload === null ? null : checkWorkload(next, input.workload),
    data_classification:
      input.dataClassification === null
        ? null
        : checkClassification(next, input.dataClassification),
    source_interface_ref: null,
    destination_interface_ref: null,
    origin: { ...USER_ORIGIN },
  };
  if (input.sourceInterface != null) {
    relationship.source_interface_ref = checkInterfaceRef(
      next,
      relationship,
      "source",
      input.sourceInterface,
    );
  }
  if (input.destinationInterface != null) {
    relationship.destination_interface_ref = checkInterfaceRef(
      next,
      relationship,
      "destination",
      input.destinationInterface,
    );
  }
  next.architecture.relationships.push(relationship);
  return finish(
    contract,
    next,
    now,
    `added architecture relationship ${input.id}: ${input.source} ${input.kind} ${input.destination}`,
    flowNotices(next, relationship),
  );
}

export function updateArchitectureRelationship(
  contract: ProjectContract,
  id: string,
  change: {
    readonly kind?: string;
    readonly source?: string;
    readonly destination?: string;
    /** Null clears it. */
    readonly workload?: string | null;
    /** Null records the classification as unknown. */
    readonly dataClassification?: string | null;
    /** Null clears the reference. */
    readonly sourceInterface?: string | null;
    readonly destinationInterface?: string | null;
  },
  now: string,
): Edit {
  const next = clone(contract);
  const relationship = findRelationship(next, id);
  const changed: string[] = [];
  if (change.kind !== undefined) {
    relationship.kind = choice(RelationshipKindSchema, change.kind, "--kind");
    changed.push("kind");
  }
  if (change.source !== undefined) {
    findNode(next, change.source);
    relationship.source = change.source;
    changed.push("source");
  }
  if (change.destination !== undefined) {
    findNode(next, change.destination);
    relationship.destination = change.destination;
    changed.push("destination");
  }
  if (relationship.source === relationship.destination) {
    throw new WorkflowError(
      `a relationship must connect two different nodes; got "${relationship.source}" twice`,
    );
  }
  if (change.workload !== undefined) {
    relationship.workload_ref =
      change.workload === null ? null : checkWorkload(next, change.workload);
    changed.push("workload");
  }
  if (change.dataClassification !== undefined) {
    relationship.data_classification =
      change.dataClassification === null
        ? null
        : checkClassification(next, change.dataClassification);
    changed.push("data classification");
  }
  for (const [end, value] of [
    ["source", change.sourceInterface],
    ["destination", change.destinationInterface],
  ] as const) {
    if (value === undefined) continue;
    const field =
      end === "source" ? "source_interface_ref" : "destination_interface_ref";
    relationship[field] =
      value === null ? null : checkInterfaceRef(next, relationship, end, value);
    changed.push(`${end} interface`);
  }
  // A moved endpoint or a new kind must still satisfy the interface rules.
  for (const end of ["source", "destination"] as const) {
    const field =
      end === "source" ? "source_interface_ref" : "destination_interface_ref";
    const ref = relationship[field];
    if (ref !== null) checkInterfaceRef(next, relationship, end, ref);
  }
  if (changed.length === 0) {
    throw new WorkflowError(
      `nothing to change for architecture relationship "${id}"`,
    );
  }
  return finish(
    contract,
    next,
    now,
    `updated architecture relationship ${id}: ${changed.join(", ")}`,
    flowNotices(next, relationship),
  );
}

export function removeArchitectureRelationship(
  contract: ProjectContract,
  id: string,
  now: string,
): Edit {
  const next = clone(contract);
  findRelationship(next, id);
  next.architecture.relationships = next.architecture.relationships.filter(
    (entry) => entry.id !== id,
  );
  return finish(
    contract,
    next,
    now,
    `removed architecture relationship ${id}`,
    [],
  );
}

export function bindDecision(
  contract: ProjectContract,
  decisionRef: string,
  nodeRefs: readonly string[],
  now: string,
  standing: string,
): Edit {
  const next = clone(contract);
  if (!next.decisions.some((entry) => entry.id === decisionRef)) {
    throw new WorkflowError(
      `decision "${decisionRef}" does not exist; decisions: ${next.decisions.map((entry) => entry.id).join(", ") || "none"}`,
    );
  }
  if (nodeRefs.length === 0) {
    throw new WorkflowError("give at least one --node");
  }
  for (const ref of nodeRefs) findNode(next, ref);
  const existing = next.architecture.decision_bindings.find(
    (entry) => entry.decision_ref === decisionRef,
  );
  const binding: DecisionBinding = existing ?? {
    decision_ref: decisionRef,
    node_refs: [],
    origin: { ...USER_ORIGIN },
  };
  if (existing === undefined) {
    next.architecture.decision_bindings.push(binding);
  }
  const added = [...new Set(nodeRefs)].filter(
    (ref) => !binding.node_refs.includes(ref),
  );
  if (added.length === 0) {
    throw new WorkflowError(
      `decision "${decisionRef}" is already bound to ${nodeRefs.join(", ")}`,
    );
  }
  binding.node_refs.push(...added);
  const notices =
    standing === "approved_current"
      ? []
      : [
          `decision ${decisionRef} is ${standing}; the binding links it to the architecture but does not make it an approved instruction`,
        ];
  return finish(
    contract,
    next,
    now,
    `bound decision ${decisionRef} to ${added.join(", ")}`,
    notices,
  );
}

export function unbindDecision(
  contract: ProjectContract,
  decisionRef: string,
  nodeRefs: readonly string[],
  now: string,
): Edit {
  const next = clone(contract);
  const binding = next.architecture.decision_bindings.find(
    (entry) => entry.decision_ref === decisionRef,
  );
  if (binding === undefined) {
    throw new WorkflowError(
      `decision "${decisionRef}" has no architecture binding`,
    );
  }
  const removing = nodeRefs.length === 0 ? [...binding.node_refs] : nodeRefs;
  const missing = removing.filter((ref) => !binding.node_refs.includes(ref));
  if (missing.length > 0) {
    throw new WorkflowError(
      `decision "${decisionRef}" is not bound to ${missing.join(", ")}; bound: ${binding.node_refs.join(", ")}`,
    );
  }
  binding.node_refs = binding.node_refs.filter(
    (ref) => !removing.includes(ref),
  );
  if (binding.node_refs.length === 0) {
    next.architecture.decision_bindings =
      next.architecture.decision_bindings.filter(
        (entry) => entry.decision_ref !== decisionRef,
      );
  }
  return finish(
    contract,
    next,
    now,
    `unbound decision ${decisionRef} from ${removing.join(", ")}`,
    [],
  );
}

export function setGeneratedViewPaths(
  contract: ProjectContract,
  change: {
    /** Null restores the default location. */
    readonly mermaid?: string | null;
    readonly calm?: string | null;
  },
  now: string,
): Edit {
  const next = clone(contract);
  const changed: string[] = [];
  if (change.mermaid !== undefined) {
    next.architecture.generated.mermaid = change.mermaid;
    changed.push(`mermaid ${change.mermaid ?? "(default)"}`);
  }
  if (change.calm !== undefined) {
    next.architecture.generated.calm_1_2 = change.calm;
    changed.push(`calm_1_2 ${change.calm ?? "(default)"}`);
  }
  if (changed.length === 0) {
    throw new WorkflowError("give --mermaid, --calm, or a --default-* option");
  }
  return {
    contract: touch(next, now),
    summary: `set generated view paths: ${changed.join(", ")}`,
    notices: [
      "generated views are outputs; run anvilmark generate to write them at the new paths",
    ],
  };
}

// --- interfaces (amendment 9) -----------------------------------------------

export function addArchitectureInterface(
  contract: ProjectContract,
  nodeId: string,
  input: {
    readonly id: string;
    readonly protocol: string | null;
    readonly description: string | null;
  },
  now: string,
): Edit {
  const next = clone(contract);
  const node = findNode(next, nodeId);
  checkId(input.id, "interface id");
  const owner = interfaceOwner(next, input.id);
  if (owner !== undefined) {
    throw new WorkflowError(
      `interface "${input.id}" already exists on node "${owner.id}"; interface ids are unique across the contract`,
    );
  }
  node.interfaces.push({
    id: input.id,
    protocol:
      input.protocol === null
        ? null
        : choice(InterfaceProtocolSchema, input.protocol, "--protocol"),
    description: input.description,
  });
  return finish(
    contract,
    next,
    now,
    `added interface ${input.id} to architecture node ${nodeId}${input.protocol === null ? " (protocol unknown)" : ` (${input.protocol})`}`,
    [],
  );
}

export function updateArchitectureInterface(
  contract: ProjectContract,
  interfaceId: string,
  change: {
    /** Null records the protocol as unknown. */
    readonly protocol?: string | null;
    /** Null clears the description. */
    readonly description?: string | null;
  },
  now: string,
): Edit {
  const next = clone(contract);
  const owner = interfaceOwner(next, interfaceId);
  const entry = owner?.interfaces.find((item) => item.id === interfaceId);
  if (owner === undefined || entry === undefined) {
    throw new WorkflowError(`interface "${interfaceId}" does not exist`);
  }
  const changed: string[] = [];
  if (change.protocol !== undefined) {
    entry.protocol =
      change.protocol === null
        ? null
        : choice(InterfaceProtocolSchema, change.protocol, "--protocol");
    changed.push("protocol");
  }
  if (change.description !== undefined) {
    entry.description = change.description;
    changed.push("description");
  }
  if (changed.length === 0) {
    throw new WorkflowError(`nothing to change for interface "${interfaceId}"`);
  }
  return finish(
    contract,
    next,
    now,
    `updated interface ${interfaceId} on architecture node ${owner.id}: ${changed.join(", ")}`,
    [],
  );
}

export function removeArchitectureInterface(
  contract: ProjectContract,
  interfaceId: string,
  now: string,
): Edit {
  const next = clone(contract);
  const owner = interfaceOwner(next, interfaceId);
  if (owner === undefined) {
    throw new WorkflowError(`interface "${interfaceId}" does not exist`);
  }
  const references = next.architecture.relationships
    .filter(
      (entry) =>
        entry.source_interface_ref === interfaceId ||
        entry.destination_interface_ref === interfaceId,
    )
    .map((entry) => entry.id);
  if (references.length > 0) {
    throw new WorkflowError(
      `interface "${interfaceId}" is still referenced by relationship ${references.join(", ")}; clear those references first`,
    );
  }
  owner.interfaces = owner.interfaces.filter(
    (entry) => entry.id !== interfaceId,
  );
  return finish(
    contract,
    next,
    now,
    `removed interface ${interfaceId} from architecture node ${owner.id}`,
    [],
  );
}

// --- confirmation (amendment 8) ---------------------------------------------

export interface DescribedElement {
  readonly target: ArchitectureTarget;
  readonly element: ArchitectureElement;
  readonly origin: ArchitectureOrigin;
  readonly standing: ConfirmationStanding;
  /** The content hash a confirmation made now would record. */
  readonly content_hash: string;
}

export function describeArchitectureElement(
  contract: ProjectContract,
  target: ArchitectureTarget,
): DescribedElement {
  const found = elementsOf(contract).find(
    (entry) =>
      entry.target.kind === target.kind && entry.target.ref === target.ref,
  );
  if (found === undefined) {
    const known = elementsOf(contract)
      .filter((entry) => entry.target.kind === target.kind)
      .map((entry) => entry.target.ref);
    throw new WorkflowError(
      `architecture ${target.kind} "${target.ref}" does not exist; ${target.kind === "binding" ? "bindings (by decision)" : `${target.kind}s`}: ${known.join(", ") || "none"}`,
    );
  }
  return {
    target: found.target,
    element: found.element,
    origin: found.element.value.origin,
    standing: confirmationStanding(found.element),
    content_hash: architectureContentHash(found.element),
  };
}

/**
 * Record a confirmation of an agent-proposed element's CURRENT content.
 *
 * Pure: the caller must already have verified, against committed local
 * history, that the element's proposal was accepted and lists it, and must have
 * obtained the user's interactive confirmation of `expectedHash`.
 */
export function confirmArchitectureElement(
  contract: ProjectContract,
  target: ArchitectureTarget,
  expectedHash: string,
  now: string,
): Edit {
  const next = clone(contract);
  const described = describeArchitectureElement(next, target);
  if (described.origin.kind !== "agent_proposed") {
    throw new WorkflowError(
      `architecture ${target.kind} "${target.ref}" was declared by the user; only agent-proposed elements are confirmed`,
    );
  }
  if (described.standing === "confirmed") {
    throw new WorkflowError(
      `architecture ${target.kind} "${target.ref}" is already confirmed for its current content`,
    );
  }
  if (described.content_hash !== expectedHash) {
    throw new WorkflowError(
      `the content of architecture ${target.kind} "${target.ref}" is not the content that was shown; nothing was confirmed`,
    );
  }
  described.element.value.origin = {
    ...described.origin,
    confirmed_at: now,
    confirmed_content_hash: described.content_hash,
  };
  return {
    contract: touch(next, now),
    summary: `confirmed agent-proposed architecture ${target.kind} ${target.ref} (content sha-256 ${described.content_hash}; proposal ${described.origin.proposal_ref ?? "unknown"})`,
    notices: [
      "confirmation records that you accepted this exact content; it does not approve a decision, make anything measured, or authorize any remote evaluation",
    ],
  };
}
