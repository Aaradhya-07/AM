import {
  cp,
  mkdtemp,
  readFile,
  rm,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectContract } from "@anvilmark/project-contract";
import { parseProjectContract, unwrap } from "@anvilmark/project-contract";
import type { ScanArtifact, ScanConfig, ScanInput } from "@anvilmark/scanner";
import {
  SCAN_CONFIG_FORMAT,
  ScanConfigSchema,
  finalizeArtifact,
  scanRepository,
} from "@anvilmark/scanner";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const FIXTURES = join(REPO_ROOT, "packages/scanner/test/fixtures");

const temporary: string[] = [];

export async function tempDir(
  prefix = "anvilmark-conformance-",
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

export async function cleanup(): Promise<void> {
  for (const directory of temporary.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
}

export type SyntheticSdk = "openai" | "ollama" | "bullmq";

export async function materialize(
  name: string,
  sdks: readonly SyntheticSdk[] = ["openai"],
): Promise<string> {
  const root = await tempDir();
  await cp(join(FIXTURES, "repositories", name), root, { recursive: true });
  const pinModels = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await pinModels(file);
      else if (file.endsWith(".ts"))
        await writeFile(
          file,
          (await readFile(file, "utf8")).replaceAll(
            '"gpt-4o-mini"',
            '"gpt-4o-mini-2024-07-18"',
          ),
        );
    }
  };
  await pinModels(root);
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

export const ATLAS_COMPONENTS = {
  components: [
    {
      id: "component.classifier",
      path: "src/classify.ts",
      export: "classifyTicket",
      architecture_node_ref: "ticket-classifier",
      workload_ref: "classification",
    },
  ],
};

export async function approvedRemote(): Promise<ProjectContract> {
  return unwrap(
    parseProjectContract(
      await readFile(
        join(
          REPO_ROOT,
          "packages/conformance/test/fixtures/approved-remote-atlas.yaml",
        ),
        "utf8",
      ),
      "yaml",
    ),
  );
}

export async function approvedLocal(): Promise<ProjectContract> {
  return unwrap(
    parseProjectContract(
      await readFile(
        join(
          REPO_ROOT,
          "packages/conformance/test/fixtures/approved-local-atlas.yaml",
        ),
        "utf8",
      ),
      "yaml",
    ),
  );
}

export function scan(
  root: string,
  contract: ProjectContract,
  config: ScanConfig = declarations(ATLAS_COMPONENTS),
  extra: Partial<ScanInput> = {},
): ScanArtifact {
  const outcome = scanRepository({
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
  return finalizeArtifact(outcome.content, {
    observed_at: "2026-09-15T00:00:00Z",
    basis: "explicit",
  });
}
