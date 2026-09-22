import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProjectContract } from "@anvilmark/project-contract";

import { draftDeclarations, parseScanConfig } from "../src/index.js";
import type { ScanConfig } from "../src/index.js";
import { atlas, cleanup, declarations, materialize, scan } from "./helpers.js";

afterEach(cleanup);

const NO_DECLARATIONS = declarations({
  sources: [],
  sanitizers: [],
  sinks: [],
  components: [],
});

async function repository(): Promise<string> {
  const root = await materialize("direct-call", [
    "openai",
    "@anthropic-ai/sdk",
  ]);
  await writeFile(
    join(root, "src/summarize.ts"),
    `import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic();
export async function POST(request: Request) {
  const body = await request.json();
  return anthropic.messages.create({ model: body.model, max_tokens: 100, messages: [] });
}
`,
  );
  return root;
}

function draftFor(root: string, contract: ProjectContract): string {
  return draftDeclarations({
    content: scan(root, contract, NO_DECLARATIONS).content,
    contract,
    repositoryRoot: ".",
  });
}

function parsed(draft: string): ScanConfig {
  const result = parseScanConfig(draft);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.config;
}

describe("draftDeclarations", () => {
  it("drafts a valid declaration file from observed calls, asserting only what the contract leaves no choice about", async () => {
    const root = await repository();
    const draft = draftFor(root, await atlas());
    const config = parsed(draft);

    expect(draft).toContain(
      "#   src/classify.ts:8 openai chat.completions.create [inference] -> openai, model gpt-4o-mini",
    );
    expect(draft).toContain(
      "#   src/summarize.ts:5 anthropic messages.create [inference] -> anthropic, model runtime_selected",
    );
    // Atlas has one remote_provider node, so the sinks name it; its remote
    // candidate has no provider, so no candidate is asserted.
    expect(config.sinks).toEqual([
      expect.objectContaining({
        id: "sink.anthropic",
        recognizer: "anthropic",
        paths: ["src"],
        architecture_node_ref: "remote-model-provider",
        candidate_ref: null,
      }),
      expect.objectContaining({
        id: "sink.openai",
        recognizer: "openai",
        paths: ["src"],
        architecture_node_ref: "remote-model-provider",
        candidate_ref: null,
      }),
    ]);
    expect(draft).toContain("# models: [...]");
    // Sources, sanitizers and components are only suggested: Atlas has several
    // local service nodes, and data classifications are the user's to assign.
    expect(config.sources).toEqual([]);
    expect(config.sanitizers).toEqual([]);
    expect(config.components).toEqual([]);
    expect(draft).toContain(
      '#    function: { path: "src/summarize.ts", export: POST }',
    );
    expect(draft).toContain('#    path: "src/classify.ts"');

    // The draft is usable as is: rescanning with it resolves every declaration.
    const rescanned = scan(root, await atlas(), config).content;
    expect(
      rescanned.declarations.map((entry) => [entry.id, entry.status]),
    ).toEqual([
      ["sink.anthropic", "resolved"],
      ["sink.openai", "resolved"],
    ]);
  });

  it("fills a candidate only when exactly one fits the provider and operation kind", async () => {
    const root = await repository();
    const base = await atlas();
    const contract: ProjectContract = {
      ...base,
      candidates: base.candidates.map((candidate) =>
        candidate.deployment.mode === "managed_api"
          ? {
              ...candidate,
              deployment: { ...candidate.deployment, provider: "openai" },
            }
          : candidate,
      ),
    };
    const config = parsed(draftFor(root, contract));
    expect(
      config.sinks.map((sink) => [sink.recognizer, sink.candidate_ref]),
    ).toEqual([
      ["anthropic", null],
      ["openai", "candidate.classification.remote_unselected"],
    ]);
  });
});
