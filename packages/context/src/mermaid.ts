import { createHash } from "node:crypto";

import { mermaidComment, mermaidLabel } from "./escape.js";
import type {
  ArchitectureNodeFact,
  ArchitectureOriginFact,
  ArchitectureRelationshipFact,
  DecisionFact,
  ProjectFacts,
} from "./facts.js";
import { sourceHeaderLines } from "./header.js";

const BOUNDARY_ORDER = [
  "local",
  "internal_network",
  "remote_provider",
  "third_party",
] as const;

/**
 * A Mermaid node id derived from an ANVILMARK id: a readable part plus a digest
 * of the full id, so two ids that sanitize alike never collide, and no id can
 * be a Mermaid keyword such as `end`.
 */
export function mermaidNodeId(id: string): string {
  const readable = id.replace(/[^A-Za-z0-9]/g, "_");
  const digest = createHash("sha256").update(id, "utf8").digest("hex");
  return `n_${readable}_${digest.slice(0, 8)}`;
}

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

type Support = "approved" | "partial" | "unresolved";

function nodeSupport(node: ArchitectureNodeFact): Support {
  const authoritative = node.decisions.filter((entry) => entry.authoritative);
  if (authoritative.some((entry) => entry.standing === "approved_current")) {
    return node.unresolved.length === 0 ? "approved" : "partial";
  }
  return node.decisions.some((entry) => entry.standing.startsWith("approved"))
    ? "partial"
    : "unresolved";
}

function relationshipSupport(
  relationship: ArchitectureRelationshipFact,
): Support {
  if (relationship.unresolved.length === 0) return "approved";
  return relationship.decisions.some(
    (entry) => entry.authoritative && entry.standing === "approved_current",
  )
    ? "partial"
    : "unresolved";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function originText(origin: ArchitectureOriginFact): string {
  if (origin.kind === "user") return "declared by user";
  const proposal = `proposal ${origin.proposal_ref ?? "unknown"}`;
  switch (origin.confirmation) {
    case "confirmed":
      return `agent-proposed (${proposal}), confirmed ${origin.confirmed_at ?? ""}`;
    case "confirmation_stale":
      return `agent-proposed (${proposal}), CONFIRMATION STALE`;
    default:
      return `agent-proposed (${proposal}), UNCONFIRMED`;
  }
}

function inferredText(origin: ArchitectureOriginFact): string {
  return origin.confirmation === "confirmation_stale"
    ? "INFERRED: confirmation stale"
    : "INFERRED: unconfirmed proposal";
}

function nodeLabel(node: ArchitectureNodeFact): string {
  const parts = [`${node.name} (${node.kind})`];
  if (!node.origin.trusted) {
    parts.push(
      inferredText(node.origin),
      `trust boundary UNKNOWN (declared ${node.trust_boundary})`,
    );
  } else if (node.origin.kind === "agent_proposed") {
    parts.push("agent-proposed, confirmed");
  }
  parts.push(
    node.decisions.length === 0
      ? "decision: UNRESOLVED"
      : `decision: ${node.decisions
          .map(
            (entry) =>
              `${entry.decision_ref} ${entry.standing}${entry.authoritative ? "" : " (not authoritative)"}`,
          )
          .join(", ")}`,
  );
  if (node.interfaces.length > 0) {
    parts.push(
      `interfaces: ${node.interfaces
        .map((entry) => `${entry.id} (${entry.protocol ?? "protocol unknown"})`)
        .join(", ")}`,
    );
  }
  parts.push(
    `constraints: ${node.constraints.length === 0 ? "none linked" : unique(node.constraints.map((entry) => entry.constraint_ref)).length}`,
  );
  if (node.unresolved.length > 0) parts.push("UNRESOLVED");
  return mermaidLabel(parts.join(" · "));
}

function relationshipLabel(relationship: ArchitectureRelationshipFact): string {
  const parts = [
    relationship.id,
    relationship.kind,
    `data: ${relationship.data_classification ?? "UNKNOWN"}`,
    `workload: ${relationship.workload_ref ?? "none"}`,
  ];
  if (
    relationship.source_interface_ref !== null ||
    relationship.destination_interface_ref !== null
  ) {
    parts.push(
      `interfaces: ${relationship.source_interface_ref ?? "undeclared"} to ${relationship.destination_interface_ref ?? "undeclared"}`,
    );
  }
  if (!relationship.origin.trusted) {
    parts.push(inferredText(relationship.origin));
  }
  if (relationship.effective_crossing === "crossing") {
    parts.push(
      `crosses ${relationship.crossing?.from ?? ""} to ${relationship.crossing?.to ?? ""}`,
    );
  } else if (relationship.effective_crossing === "unknown") {
    parts.push(
      relationship.crossing === null
        ? "crossing UNKNOWN (depends on unconfirmed architecture)"
        : `POSSIBLE crossing ${relationship.crossing.from} to ${relationship.crossing.to}: UNKNOWN (depends on unconfirmed architecture)`,
    );
  }
  if (relationship.unresolved.length > 0) parts.push("UNRESOLVED");
  return mermaidLabel(parts.join(" · "));
}

function arrow(relationship: ArchitectureRelationshipFact): string {
  if (relationship.effective_crossing === "not_applicable") {
    return "-.->";
  }
  // A declared or possible crossing is drawn thick either way; its label says
  // whether it is effective or unknown, so a possible crossing never looks
  // like an ordinary edge.
  return relationship.crossing === null ? "-->" : "==>";
}

/**
 * Render the declared architecture as a Mermaid flowchart.
 *
 * Trusted nodes are grouped by trust boundary. Unconfirmed or stale
 * agent-proposed nodes are grouped under an unknown boundary, with their
 * declared boundary in the label. Crossings (declared or possible) are thick;
 * structural relationships are dotted. Every node and edge carries its origin,
 * decision standing and an UNRESOLVED marker when support is missing, and a
 * `%%` comment per element lists its ANVILMARK id and every linked decision,
 * constraint and evidence record. All contract text is escaped.
 */
export function renderMermaid(facts: ProjectFacts): string {
  const decisions = decisionIndex(facts);
  const { nodes, relationships, decision_bindings } = facts.architecture;
  const lines: string[] = [
    ...sourceHeaderLines(facts, "Mermaid architecture view").map(
      (line) => `%% ${mermaidComment(line)}`,
    ),
    "%% Legend: solid outline = linked to an approved, current decision; dashed = UNRESOLVED; dotted outline = partly supported (a linked approval is not current, or something else is unresolved).",
    "%% Legend: long dashes = INFERRED (agent-proposed and unconfirmed, or confirmation stale); its trust boundary is unknown and it counts as no support.",
    "%% Legend: thick arrow = trust-boundary crossing, declared or possible (the label says whether it is effective or UNKNOWN); dotted arrow = deployed_in or composed_of.",
    "flowchart LR",
  ];

  if (nodes.length === 0) {
    lines.push(
      `  empty["${mermaidLabel("No architecture nodes are declared in the ANVILMARK contract · UNRESOLVED")}"]`,
    );
  }

  const trusted = nodes.filter((node) => node.origin.trusted);
  const untrusted = nodes.filter((node) => !node.origin.trusted);
  for (const boundary of BOUNDARY_ORDER) {
    const group = trusted.filter((node) => node.trust_boundary === boundary);
    if (group.length === 0) continue;
    lines.push(
      `  subgraph tb_${boundary}["${mermaidLabel(`Trust boundary: ${boundary}`)}"]`,
    );
    for (const node of group) {
      lines.push(`    ${mermaidNodeId(node.id)}["${nodeLabel(node)}"]`);
    }
    lines.push("  end");
  }
  if (untrusted.length > 0) {
    lines.push(
      `  subgraph tb_unknown["${mermaidLabel("Trust boundary: UNKNOWN (unconfirmed agent proposals)")}"]`,
    );
    for (const node of untrusted) {
      lines.push(`    ${mermaidNodeId(node.id)}["${nodeLabel(node)}"]`);
    }
    lines.push("  end");
  }

  for (const relationship of relationships) {
    lines.push(
      `  ${mermaidNodeId(relationship.source)} ${arrow(relationship)}|"${relationshipLabel(relationship)}"| ${mermaidNodeId(relationship.destination)}`,
    );
  }

  lines.push(
    "  classDef approved stroke-width:2px",
    "  classDef partial stroke-dasharray:2 2",
    "  classDef unresolved stroke-dasharray:6 4",
    "  classDef inferred stroke-dasharray:12 4",
  );
  if (nodes.length === 0) lines.push("  class empty unresolved");
  for (const support of ["approved", "partial", "unresolved"] as const) {
    const members = trusted
      .filter((node) => nodeSupport(node) === support)
      .map((node) => mermaidNodeId(node.id));
    if (members.length > 0) {
      lines.push(`  class ${members.join(",")} ${support}`);
    }
  }
  if (untrusted.length > 0) {
    lines.push(
      `  class ${untrusted.map((node) => mermaidNodeId(node.id)).join(",")} inferred`,
    );
  }

  const evidenceFor = (refs: readonly string[]): string[] =>
    unique(
      refs.flatMap(
        (ref) => decisions.get(ref)?.evidence.map((entry) => entry.id) ?? [],
      ),
    );
  const list = (values: readonly string[]): string =>
    values.length === 0 ? "none" : values.join(", ");

  for (const node of nodes) {
    const refs = node.decisions.map((entry) => entry.decision_ref);
    lines.push(
      `%% node ${mermaidComment(node.id)} as ${mermaidNodeId(node.id)} · ${mermaidComment(originText(node.origin))} · effective trust boundary ${node.effective_trust_boundary} · support ${node.origin.trusted ? nodeSupport(node) : "inferred"} · decisions ${mermaidComment(list(node.decisions.map((entry) => `${entry.decision_ref} (${entry.link}, ${entry.standing}${entry.authoritative ? "" : ", not authoritative"})`)))} · interfaces ${mermaidComment(list(node.interfaces.map((entry) => `${entry.id} ${entry.protocol ?? "unknown"}`)))} · constraints ${mermaidComment(list(unique(node.constraints.map((entry) => entry.constraint_ref))))} · evidence ${mermaidComment(list(evidenceFor(refs)))} · unresolved ${mermaidComment(list(node.unresolved))}`,
    );
  }
  for (const relationship of relationships) {
    const refs = relationship.decisions.map((entry) => entry.decision_ref);
    lines.push(
      `%% relationship ${mermaidComment(relationship.id)} · ${mermaidComment(originText(relationship.origin))} · effective crossing ${relationship.effective_crossing} · support ${relationship.origin.trusted ? relationshipSupport(relationship) : "inferred"} · decisions ${mermaidComment(list(relationship.decisions.map((entry) => `${entry.decision_ref} (${entry.standing}${entry.authoritative ? "" : ", not authoritative"})`)))} · constraints ${mermaidComment(list(unique(relationship.constraints.map((entry) => entry.constraint_ref))))} · evidence ${mermaidComment(list(evidenceFor(refs)))} · unresolved ${mermaidComment(list(relationship.unresolved))}`,
    );
  }
  for (const binding of decision_bindings) {
    lines.push(
      `%% binding ${mermaidComment(binding.decision_ref)} · ${mermaidComment(originText(binding.origin))} · decision ${binding.standing} · nodes ${mermaidComment(list(binding.node_refs))}${binding.origin.trusted ? "" : " · not authoritative until confirmed"}`,
    );
  }

  return `${lines.join("\n")}\n`;
}
