import { cp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  appendApproval,
  parseProjectContract,
  unwrap,
  toNormalizedYaml,
} from "@anvilmark/project-contract";
import { REPO_ROOT, cli, scriptedIo, tempDir } from "./helpers.js";

const FIXTURES = join(REPO_ROOT, "packages/scanner/test/fixtures");

export async function approvedRemoteContract(): Promise<string> {
  const text = await readFile(
    join(
      REPO_ROOT,
      "packages/conformance/test/fixtures/approved-remote-atlas.yaml",
    ),
    "utf8",
  );
  return text
    .replace(/^schema: .+$/m, `schema: ${PROJECT_SCHEMA_ID}`)
    .replace(
      /^schema_version: .+$/m,
      `schema_version: ${PROJECT_SCHEMA_VERSION}`,
    );
}

export async function approvedLocalContract(): Promise<string> {
  const baseText = await approvedRemoteContract();
  const base = unwrap(parseProjectContract(baseText, "yaml"));
  const changed = {
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
    approvals: [],
  };
  const approved = unwrap(
    appendApproval(changed, {
      decisionId: "decision.classification",
      actorRef: "test-approver",
      approvedAt: "2026-09-02T00:00:00Z",
    }),
  );
  return (await import("@anvilmark/project-contract")).toNormalizedYaml(
    approved,
  );
}

export const ATLAS_SCAN_CONFIG = `format: anvilmark-scan-config/0.1.0-draft.1
sources:
  - id: source.raw_ticket
    data_classification: raw_customer_ticket
    function:
      path: src/tickets.ts
      export: readTicket
    architecture_node_ref: ticket-intake
sanitizers:
  - id: sanitizer.pii
    function:
      path: src/redact.ts
      export: redactTicket
    clears:
      - raw_customer_ticket
    produces: redacted_customer_ticket
    architecture_node_ref: pii-redactor
sinks:
  - id: sink.openai
    recognizer: openai
    architecture_node_ref: remote-model-provider
    candidate_ref: candidate.classification.remote_unselected
  - id: sink.ollama
    recognizer: ollama
    architecture_node_ref: ticket-classifier
    candidate_ref: candidate.classification.local_unselected
components:
  - id: component.classifier
    path: src/classify.ts
    export: classifyTicket
    architecture_node_ref: ticket-classifier
    workload_ref: classification
`;

export async function setupWorkspace(
  fixtureName: string,
  contractText: string,
) {
  const base = await tempDir("conformance-test-");
  const projectDir = join(base, "project");
  const appDir = join(base, "app");
  const contractTmp = join(base, "contract.yaml");

  await mkdir(projectDir, { recursive: true });
  const contract = unwrap(parseProjectContract(contractText, "yaml"));
  contract.project.repository_roots = ["../app"];
  await writeFile(contractTmp, toNormalizedYaml(contract), "utf8");

  const initIo = scriptedIo({ cwd: projectDir });
  const initCode = await cli(["init", "--from-contract", contractTmp], initIo);
  if (initCode !== 0) {
    throw new Error(`init failed: ${initIo.err()}`);
  }

  await writeFile(
    join(projectDir, ".anvilmark", "scanner.yaml"),
    ATLAS_SCAN_CONFIG,
    "utf8",
  );

  await cp(join(FIXTURES, "repositories", fixtureName), appDir, {
    recursive: true,
  });
  async function pinModels(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await pinModels(path);
      else if (path.endsWith(".ts"))
        await writeFile(
          path,
          (await readFile(path, "utf8")).replaceAll(
            '"gpt-4o-mini"',
            '"gpt-4o-mini-2024-07-18"',
          ),
        );
    }
  }
  await pinModels(appDir);
  for (const sdk of ["openai"]) {
    await cp(
      join(FIXTURES, "synthetic-sdks", sdk),
      join(appDir, "node_modules", sdk),
      { recursive: true },
    );
  }

  return { base, projectDir, appDir };
}
