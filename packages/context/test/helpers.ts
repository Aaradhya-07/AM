import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectContract } from "@anvilmark/project-contract";
import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  computeApprovalHash,
  parseProjectContract,
  readAtlasFixtureText,
  validateProjectContract,
} from "@anvilmark/project-contract";

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
export const AS_OF = "2026-09-14T00:00:00Z";

/** A marker that must never reach a remote-default projection. */
export const LOCAL_MARKER = "localonlymarker7f3a";

export function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; issues: readonly unknown[] },
): T {
  if (!result.ok) {
    throw new Error(`invalid: ${JSON.stringify(result.issues, null, 2)}`);
  }
  return result.value;
}

export async function atlas(): Promise<ProjectContract> {
  return unwrap(parseProjectContract(await readAtlasFixtureText(), "yaml"));
}

/**
 * The synthetic approved Atlas contract from project-contract's fixtures,
 * migrated to the current schema by changing only its version lines. Its approval was
 * produced by the draft.3 CLI for fixture purposes; it is not a real decision.
 */
export function approvedAtlas(): ProjectContract {
  const text = readFileSync(
    join(
      REPO_ROOT,
      "packages/project-contract/test/fixtures/approved-atlas.draft3.yaml",
    ),
    "utf8",
  )
    .replace(
      /^schema: https:\/\/anvilmark\.dev\/schemas\/project\/[^\n]+$/m,
      `schema: ${PROJECT_SCHEMA_ID}`,
    )
    .replace(
      /^schema_version: [^\n]+$/m,
      `schema_version: ${PROJECT_SCHEMA_VERSION}`,
    );
  return unwrap(parseProjectContract(text, "yaml"));
}

export function valid(contract: ProjectContract): ProjectContract {
  return unwrap(validateProjectContract(structuredClone(contract)));
}

/** Re-sign the synthetic fixture approval after a test changes approved content. */
export function resignApproval(
  contract: ProjectContract,
  decisionId: string,
): ProjectContract {
  const next = structuredClone(contract);
  const hash = computeApprovalHash(next, decisionId);
  if (!hash.ok) throw new Error("cannot resolve decision");
  const approval = next.approvals.find(
    (entry) => entry.decision_ref === decisionId,
  );
  if (approval === undefined) throw new Error("no approval");
  approval.content_hash = hash.value;
  return next;
}

/**
 * A non-Atlas architecture exercising every node kind, relationship kind and
 * trust boundary, a component-scoped decision, a decision binding, an unknown
 * classification and a crossing with unknown classification.
 */
export function allKindsContract(): ProjectContract {
  const next = structuredClone(approvedAtlas());
  next.project.id = "all-kinds";
  next.project.name = "All Kinds";
  next.architecture.nodes = [
    {
      id: "agent",
      kind: "actor",
      name: "Support agent",
      trust_boundary: "local",
      description: "A person using the desk",
    },
    {
      id: "api",
      kind: "service",
      name: "Desk API",
      trust_boundary: "internal_network",
      description: null,
    },
    {
      id: "queue",
      kind: "queue",
      name: "Ticket queue",
      trust_boundary: "internal_network",
      description: null,
    },
    {
      id: "store",
      kind: "datastore",
      name: "Ticket store",
      trust_boundary: "internal_network",
      description: null,
    },
    {
      id: "runtime",
      kind: "runtime",
      name: "Container runtime",
      trust_boundary: "internal_network",
      description: null,
    },
    {
      id: "vendor",
      kind: "external_system",
      name: "Vendor CRM",
      trust_boundary: "third_party",
      description: null,
    },
    {
      id: "provider",
      kind: "external_system",
      name: "Model provider",
      trust_boundary: "remote_provider",
      description: null,
    },
  ];
  next.architecture.relationships = [
    {
      id: "agent-uses-api",
      kind: "uses",
      source: "agent",
      destination: "api",
      workload_ref: "classification",
      data_classification: "raw_customer_ticket",
    },
    {
      id: "api-connects-queue",
      kind: "connects",
      source: "api",
      destination: "queue",
      workload_ref: null,
      data_classification: null,
    },
    {
      id: "api-deployed-in-runtime",
      kind: "deployed_in",
      source: "api",
      destination: "runtime",
      workload_ref: null,
      data_classification: null,
    },
    {
      id: "runtime-composed-of-store",
      kind: "composed_of",
      source: "runtime",
      destination: "store",
      workload_ref: null,
      data_classification: null,
    },
    {
      id: "api-to-provider",
      kind: "connects",
      source: "api",
      destination: "provider",
      workload_ref: "classification",
      data_classification: "redacted_customer_ticket",
    },
    {
      id: "api-to-vendor",
      kind: "uses",
      source: "api",
      destination: "vendor",
      workload_ref: "retrieval",
      data_classification: null,
    },
  ];
  next.architecture.decision_bindings = [
    { decision_ref: "decision.classification", node_refs: ["api", "provider"] },
  ];
  next.conformance_rules = next.conformance_rules.filter(
    (rule) => rule.kind !== "forbid_dataflow",
  );
  return valid(next);
}

export interface CalmResult {
  readonly hasErrors: boolean;
  readonly hasWarnings: boolean;
  readonly jsonSchemaValidationOutputs: readonly unknown[];
  readonly spectralSchemaValidationOutputs: readonly unknown[];
}

/**
 * Run the official FINOS CALM CLI on a file. The CLI exits 0 even when the
 * document has errors, so the JSON report is parsed; its log lines before the
 * JSON are skipped.
 */
export function officialCalmValidate(bin: string, file: string): CalmResult {
  const run = spawnSync(bin, ["validate", "-a", file, "-f", "json"], {
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = `${run.stdout}`;
  const start = output.indexOf("{");
  if (start < 0) {
    throw new Error(
      `calm validate produced no JSON (exit ${run.status}): ${output}${run.stderr}`,
    );
  }
  return JSON.parse(output.slice(start)) as CalmResult;
}
