import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectContract } from "@anvilmark/project-contract";
import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  appendApproval,
  loadAtlasFixture,
  parseProjectContract,
  unwrap,
} from "@anvilmark/project-contract";

import type { ScanArtifact, ScanConfig, ScanInput } from "../src/index.js";
import {
  SCAN_CONFIG_FORMAT,
  ScanConfigSchema,
  finalizeArtifact,
  scanRepository,
} from "../src/index.js";

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const temporary: string[] = [];

export async function tempDir(prefix = "anvilmark-scanner-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

export async function cleanup(): Promise<void> {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
}

export type SyntheticSdk =
  | "openai"
  | "ollama"
  | "bullmq"
  | "@anthropic-ai/sdk"
  | "together-ai"
  | "ai"
  | "@ai-sdk/openai"
  | "@ai-sdk/anthropic"
  | "@openai/agents-realtime"
  | "@types/node";

/** Copy a fixture repository and the named SYNTHETIC SDK declarations to a temp dir. */
export async function materialize(
  name: string,
  sdks: readonly SyntheticSdk[] = ["openai"],
): Promise<string> {
  const root = await tempDir();
  await cp(join(FIXTURES, "repositories", name), root, { recursive: true });
  for (const sdk of sdks) {
    await cp(
      join(FIXTURES, "synthetic-sdks", sdk),
      join(root, "node_modules", sdk),
      {
        recursive: true,
      },
    );
  }
  return root;
}

export function declarations(
  overrides: Partial<Record<keyof ScanConfig, unknown>> = {},
): ScanConfig {
  return ScanConfigSchema.parse({
    format: SCAN_CONFIG_FORMAT,
    sources: [
      {
        id: "source.raw_ticket",
        data_classification: "raw_customer_ticket",
        function: { path: "src/tickets.ts", export: "readTicket" },
        architecture_node_ref: "ticket-intake",
      },
    ],
    sanitizers: [
      {
        id: "sanitizer.pii",
        function: { path: "src/redact.ts", export: "redactTicket" },
        clears: ["raw_customer_ticket"],
        produces: "redacted_customer_ticket",
        architecture_node_ref: "pii-redactor",
      },
      {
        id: "sanitizer.masked",
        function: { path: "src/redact.ts", export: "redactWith" },
        argument: 1,
        clears: ["raw_customer_ticket"],
        produces: "redacted_customer_ticket",
      },
    ],
    sinks: [
      {
        id: "sink.openai",
        recognizer: "openai",
        architecture_node_ref: "remote-model-provider",
        candidate_ref: "candidate.classification.remote_unselected",
      },
      {
        id: "sink.ollama",
        recognizer: "ollama",
        architecture_node_ref: "ticket-classifier",
        candidate_ref: "candidate.classification.local_unselected",
      },
    ],
    ...overrides,
  });
}

export async function atlas(): Promise<ProjectContract> {
  return loadAtlasFixture();
}

/**
 * SYNTHETIC approved Atlas contract (from the approved draft.3 fixture, lifted
 * to the current schema line): decision.classification approved, selecting
 * the REMOTE candidate. Test-only; no real decision is changed.
 */
export async function approvedRemote(): Promise<ProjectContract> {
  const text = (
    await readFile(
      join(
        REPO_ROOT,
        "packages/project-contract/test/fixtures/approved-atlas.draft3.yaml",
      ),
      "utf8",
    )
  )
    .replace(/^schema: .+$/m, `schema: ${PROJECT_SCHEMA_ID}`)
    .replace(
      /^schema_version: .+$/m,
      `schema_version: ${PROJECT_SCHEMA_VERSION}`,
    );
  return unwrap(parseProjectContract(text, "yaml"));
}

/**
 * SYNTHETIC variant in which the approved decision selects the LOCAL
 * candidate, re-approved in memory so the approval is current. Test-only.
 */
export async function approvedLocal(): Promise<ProjectContract> {
  const base = await approvedRemote();
  const changed: ProjectContract = {
    ...base,
    decisions: base.decisions.map((decision) =>
      decision.id === "decision.classification"
        ? {
            ...decision,
            selected_candidate_ref: "candidate.classification.local_unselected",
            alternatives: ["candidate.classification.remote_unselected"],
          }
        : decision,
    ),
  };
  return unwrap(
    appendApproval(changed, {
      decisionId: "decision.classification",
      actorRef: "synthetic-test-approver",
      approvedAt: "2026-09-02T00:00:00Z",
    }),
  );
}

export function scan(
  root: string,
  contract: ProjectContract,
  config: ScanConfig = declarations(),
  extra: Partial<ScanInput> = {},
) {
  return scanRepository({
    repositoryPath: root,
    repositoryRoot: ".",
    repositoryDeclaredInContract: true,
    deniedDirectories: [join(root, ".anvilmark")],
    contract,
    stateRevision: null,
    config,
    configSource: { source: "default" },
    ...extra,
  });
}

export function artifactOf(
  outcome: ReturnType<typeof scan>,
  observedAt = "2026-09-15T00:00:00Z",
): ScanArtifact {
  return finalizeArtifact(outcome.content, {
    observed_at: observedAt,
    basis: "explicit",
  });
}

export function callIn(artifact: ScanArtifact, symbol: string) {
  const call = artifact.observations.find(
    (entry) =>
      entry.kind === "provider_call" && entry.location.symbol === symbol,
  );
  if (call === undefined || call.kind !== "provider_call") {
    throw new Error(`no provider call in ${symbol}`);
  }
  const flow = artifact.data_flows.find(
    (entry) => entry.id === call.data_flow_ref,
  );
  if (flow === undefined) throw new Error(`no data flow for ${symbol}`);
  return { call, flow };
}
