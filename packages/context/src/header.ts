import type { ProjectFacts } from "./facts.js";

/**
 * The source identity every generated artifact starts with, as plain lines.
 * Each renderer wraps them in its own comment or table syntax.
 */
export function sourceHeaderLines(
  facts: ProjectFacts,
  title: string,
): string[] {
  const source = facts.source;
  return [
    `ANVILMARK generated ${title}. This file is an output of .anvilmark/project.yaml: edits here are never read back, and it is not an authoritative input.`,
    `source.project_id: ${source.project_id}`,
    `source.contract_revision: ${source.contract_revision}`,
    `source.state_revision: ${stateRevisionText(source.state_revision)}`,
    `source.contract_hash: ${source.contract_hash}`,
    `schema_version: ${source.schema_version}`,
    `generator: ${source.generator}`,
    `projection: ${source.projection}`,
    `as_of: ${source.as_of} (the instant evidence freshness and exception expiry were evaluated; not a generation clock)`,
    `approval standing: ${approvalStandingLine(facts)}`,
    `disclosure: ${facts.disclosure}`,
  ];
}

/** A one-line count of decision standings, e.g. `approved_current 1, draft 2`. */
export function approvalStandingLine(facts: ProjectFacts): string {
  const entries = Object.entries(facts.summary.decision_standings);
  return entries.length === 0
    ? "no decisions recorded"
    : entries.map(([standing, count]) => `${standing} ${count}`).join(", ");
}

export function stateRevisionText(revision: number | null): string {
  return revision === null
    ? "none (project.yaml matches no committed CLI revision)"
    : `r${revision}`;
}
