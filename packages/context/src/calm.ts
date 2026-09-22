import { prettyStringify } from "@anvilmark/project-contract";

import type {
  ArchitectureNodeFact,
  ArchitectureOriginFact,
  ArchitectureRelationshipFact,
  DecisionFact,
  ProjectFacts,
} from "./facts.js";
import { approvalStandingLine } from "./header.js";

export const CALM_SCHEMA = "https://calm.finos.org/release/1.2/meta/calm.json";

/**
 * The description written for a node the contract does not describe. CALM 1.2
 * requires a node description; ANVILMARK's is optional. The export says so
 * plainly and records `description-declared: false`, rather than inventing a
 * description that reads as a declared fact.
 */
export const UNDECLARED_DESCRIPTION =
  "Not declared in the ANVILMARK contract (description unknown).";

/**
 * ANVILMARK node kinds to CALM node types. CALM's enumerated types are used
 * where they mean the same thing; `queue` and `runtime` have no CALM
 * equivalent and are exported as plain strings, which CALM 1.2 permits.
 */
const NODE_TYPE: Readonly<Record<string, string>> = {
  service: "service",
  external_system: "system",
  datastore: "database",
  actor: "actor",
  queue: "queue",
  runtime: "runtime",
};

function decisionIndex(facts: ProjectFacts): Map<string, DecisionFact> {
  const index = new Map<string, DecisionFact>();
  for (const workload of facts.workloads) {
    for (const decision of workload.decisions) index.set(decision.id, decision);
  }
  for (const decision of facts.project_decisions) {
    index.set(decision.id, decision);
  }
  return index;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function originRecord(origin: ArchitectureOriginFact): Record<string, unknown> {
  return {
    kind: origin.kind,
    "proposal-ref": origin.proposal_ref,
    confirmation: origin.confirmation,
    "confirmed-at": origin.confirmed_at,
    trusted: origin.trusted,
  };
}

function nodeRecord(
  node: ArchitectureNodeFact,
  decisions: Map<string, DecisionFact>,
): Record<string, unknown> {
  return {
    "unique-id": node.id,
    "node-type": NODE_TYPE[node.kind] ?? node.kind,
    name: node.name,
    description: node.description ?? UNDECLARED_DESCRIPTION,
    // Declared interface ids through the native CALM node interface shape.
    // Protocol and description are ANVILMARK facts, kept in metadata below.
    ...(node.interfaces.length === 0
      ? {}
      : {
          interfaces: node.interfaces.map((entry) => ({
            "unique-id": entry.id,
          })),
        }),
    metadata: {
      anvilmark: {
        knowledge: node.knowledge,
        kind: node.kind,
        origin: originRecord(node.origin),
        "description-declared": node.description !== null,
        "trust-boundary": node.trust_boundary,
        "effective-trust-boundary": node.effective_trust_boundary,
        interfaces: Object.fromEntries(
          node.interfaces.map((entry) => [
            entry.id,
            { protocol: entry.protocol, description: entry.description },
          ]),
        ),
        "associated-workloads": node.associated_workloads,
        decisions: node.decisions.map((entry) => ({
          "decision-ref": entry.decision_ref,
          link: entry.link,
          standing: entry.standing,
          authoritative: entry.authoritative,
          "instruction-eligible": entry.standing === "approved_current",
        })),
        constraints: node.constraints.map((entry) => ({
          "constraint-ref": entry.constraint_ref,
          link: entry.link,
          authoritative: entry.authoritative,
        })),
        evidence: unique(
          node.decisions.flatMap(
            (entry) =>
              decisions
                .get(entry.decision_ref)
                ?.evidence.map((record) => record.id) ?? [],
          ),
        ),
        unresolved: node.unresolved,
      },
    },
  };
}

function relationshipType(
  relationship: ArchitectureRelationshipFact,
  nodeKinds: Map<string, string>,
): Record<string, unknown> {
  switch (relationship.kind) {
    case "deployed_in":
      // "source deployed_in destination": the destination contains the source.
      return {
        "deployed-in": {
          container: relationship.destination,
          nodes: [relationship.source],
        },
      };
    case "composed_of":
      // "source composed_of destination": the source contains the destination.
      return {
        "composed-of": {
          container: relationship.source,
          nodes: [relationship.destination],
        },
      };
    case "uses":
      if (nodeKinds.get(relationship.source) === "actor") {
        return {
          interacts: {
            actor: relationship.source,
            nodes: [relationship.destination],
          },
        };
      }
      break;
    default:
      break;
  }
  // Only declared interface references are exported. No relationship
  // `protocol`, port, host or URL is ever emitted: the contract declares none.
  const end = (node: string, interfaceRef: string | null) =>
    interfaceRef === null ? { node } : { node, interfaces: [interfaceRef] };
  return {
    connects: {
      source: end(relationship.source, relationship.source_interface_ref),
      destination: end(
        relationship.destination,
        relationship.destination_interface_ref,
      ),
    },
  };
}

function relationshipRecord(
  relationship: ArchitectureRelationshipFact,
  nodeKinds: Map<string, string>,
  decisions: Map<string, DecisionFact>,
): Record<string, unknown> {
  return {
    "unique-id": relationship.id,
    "relationship-type": relationshipType(relationship, nodeKinds),
    metadata: {
      anvilmark: {
        knowledge: relationship.knowledge,
        kind: relationship.kind,
        "workload-ref": relationship.workload_ref,
        "data-classification": relationship.data_classification,
        "data-classification-declared":
          relationship.data_classification !== null,
        origin: originRecord(relationship.origin),
        "source-interface-ref": relationship.source_interface_ref,
        "destination-interface-ref": relationship.destination_interface_ref,
        "declared-trust-boundary-crossing": relationship.crossing,
        "effective-trust-boundary-crossing": relationship.effective_crossing,
        decisions: relationship.decisions.map((entry) => ({
          "decision-ref": entry.decision_ref,
          standing: entry.standing,
          authoritative: entry.authoritative,
          "instruction-eligible": entry.standing === "approved_current",
        })),
        constraints: relationship.constraints.map((entry) => ({
          "constraint-ref": entry.constraint_ref,
          link: entry.link,
          authoritative: entry.authoritative,
        })),
        evidence: unique(
          relationship.decisions.flatMap(
            (entry) =>
              decisions
                .get(entry.decision_ref)
                ?.evidence.map((record) => record.id) ?? [],
          ),
        ),
        unresolved: relationship.unresolved,
      },
    },
  };
}

/**
 * Export the declared architecture as a CALM 1.2 architecture document.
 *
 * Export only. Every ANVILMARK-specific fact sits under a `metadata.anvilmark`
 * namespace. Nothing CALM requires that the contract lacks is invented:
 * undeclared descriptions say so, only declared interface ids are emitted, and
 * no relationship protocol, port, endpoint, control or flow is generated. Validity is established by the official CALM CLI, not by
 * this function.
 */
export function renderCalm(facts: ProjectFacts): string {
  const decisions = decisionIndex(facts);
  const { nodes, relationships } = facts.architecture;
  const nodeKinds = new Map(nodes.map((node) => [node.id, node.kind]));
  const source = facts.source;

  const document = {
    $schema: CALM_SCHEMA,
    "unique-id": source.project_id,
    name: facts.summary.name,
    description: `Generated CALM 1.2 export of the ANVILMARK architecture for ${facts.summary.name}. ANVILMARK's contract is authoritative; this export is never read back.`,
    metadata: {
      anvilmark: {
        authority: "generated-export",
        "source-of-truth": ".anvilmark/project.yaml",
        source: {
          "project-id": source.project_id,
          "contract-revision": source.contract_revision,
          "state-revision": source.state_revision,
          "contract-hash": source.contract_hash,
          "schema-version": source.schema_version,
        },
        generator: source.generator,
        projection: source.projection,
        "as-of": source.as_of,
        "approval-standing": approvalStandingLine(facts),
        disclosure: facts.disclosure,
        "architecture-knowledge":
          "declared: architecture nodes and relationships are not covered by any approval hash",
        "trust-boundaries": facts.architecture.trust_boundaries.map(
          (entry) => ({
            boundary: entry.boundary,
            nodes: entry.nodes,
            "unconfirmed-nodes": entry.unconfirmed_nodes,
          }),
        ),
        "decision-bindings": facts.architecture.decision_bindings.map(
          (binding) => ({
            "decision-ref": binding.decision_ref,
            nodes: binding.node_refs,
            standing: binding.standing,
            origin: originRecord(binding.origin),
          }),
        ),
        "interface-protocols":
          "ANVILMARK interface protocols and descriptions are declarations recorded in each node's metadata.anvilmark.interfaces; they are not CALM relationship protocols and nothing was inferred",
        "conformance-rules": facts.architecture.conformance_rules.map(
          (rule) => ({
            id: rule.id,
            kind: rule.kind,
            severity: rule.severity,
            statement: rule.statement,
            evaluated: false,
          }),
        ),
      },
    },
    nodes: nodes.map((node) => nodeRecord(node, decisions)),
    relationships: relationships.map((relationship) =>
      relationshipRecord(relationship, nodeKinds, decisions),
    ),
  };
  return prettyStringify(document);
}
