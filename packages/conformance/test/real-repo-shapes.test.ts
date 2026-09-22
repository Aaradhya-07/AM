import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ProjectContract } from "@anvilmark/project-contract";
import type { ScanArtifact } from "@anvilmark/scanner";

import { evaluateConformance } from "../src/index.js";
import {
  ATLAS_COMPONENTS,
  approvedRemote,
  cleanup,
  declarations,
  materialize,
  scan,
} from "./helpers.js";

/**
 * Code shapes found in the real-repository benchmark (benchmarks/real-repos/):
 * raw HTTP calls to provider APIs, OpenAI-compatible providers behind literal
 * base URLs, broad sink declarations, runtime-selected values, and unrelated
 * uncertainty elsewhere in an application.
 */

afterEach(cleanup);

const stamp = "2026-09-17T12:00:00Z";
const evaluate = (contract: ProjectContract, artifact: ScanArtifact) =>
  evaluateConformance({ contract, scan: artifact, evaluatedAt: stamp });
const provider = (report: ReturnType<typeof evaluate>) =>
  report.results.find((r) => r.rule_kind === "approved_candidate_only")!;

const prelude = `import OpenAI from "openai";
import { readTicket } from "./tickets";
import { redactTicket } from "./redact";
const client = new OpenAI();
`;

async function subject(
  source: string,
  extraFiles: Record<string, string> = {},
) {
  const contract = await approvedRemote();
  const root = await materialize("handoff-approved-sanitized");
  await writeFile(join(root, "src/classify.ts"), source);
  for (const [path, text] of Object.entries(extraFiles))
    await writeFile(join(root, path), text);
  return { contract, root };
}

describe("raw HTTP calls to a provider", () => {
  it("fails an unapproved model sent with fetch instead of reporting compliance", async () => {
    const { contract, root } = await subject(
      `${prelude}export async function classifyTicket(id: string) {
  const safe = redactTicket(readTicket(id));
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-4.1", messages: [{ role: "user", content: safe }] }),
  });
}
`,
    );
    const report = evaluate(contract, scan(root, contract));
    expect(report.summary.compliant).toBe(false);
    expect(provider(report)).toMatchObject({ verdict: "fail" });
    expect(provider(report).explanation).toContain("openai model 'gpt-4.1'");
    expect(provider(report).locations[0]?.path).toBe("src/classify.ts");
  });

  it("does not report compliance when a request goes to a URL the scan cannot resolve", async () => {
    const { contract, root } = await subject(
      `${prelude}export async function classifyTicket(id: string, url: string) {
  const safe = redactTicket(readTicket(id));
  return fetch(url, { method: "POST", body: safe });
}
`,
    );
    const report = evaluate(contract, scan(root, contract));
    expect(report.summary.compliant).toBe(false);
    expect(provider(report).verdict).toBe("unknown");
    expect(provider(report).unknown_reasons).toContain(
      "unmodelled_network_hop",
    );
  });
});

describe("OpenAI-compatible providers", () => {
  it("fails a different provider behind a literal base URL, naming it", async () => {
    const { contract, root } = await subject(
      `import OpenAI from "openai";
import { readTicket } from "./tickets";
import { redactTicket } from "./redact";
const groq = new OpenAI({ baseURL: "https://api.groq.com/openai/v1" });
export async function classifyTicket(id: string) {
  return groq.chat.completions.create({ model: "gpt-4o-mini-2024-07-18", messages: [{ role: "user", content: redactTicket(readTicket(id)) }] });
}
`,
    );
    const result = provider(evaluate(contract, scan(root, contract)));
    expect(result.verdict).toBe("fail");
    expect(result.explanation).toContain("candidate_provider_mismatch");
    expect(result.explanation).toContain("groq");
    expect(result.suggested_alternatives[0]?.details).toContain("groq");
    expect(result.suggested_alternatives[0]?.details).not.toContain(
      "candidate.classification.remote_unselected'.",
    );
  });
});

describe("attribution of calls to a workload", () => {
  it("does not judge embeddings or calls outside the workload's components against the chat candidate", async () => {
    const { contract, root } = await subject(
      `${prelude}export async function classifyTicket(id: string) {
  const safe = redactTicket(readTicket(id));
  await client.embeddings.create({ model: "text-embedding-3-small", input: safe });
  return client.chat.completions.create({ model: "gpt-4o-mini-2024-07-18", messages: [{ role: "user", content: safe }] });
}
export async function summarize(text: string) {
  return client.chat.completions.create({ model: "gpt-4-1106-preview", messages: [{ role: "user", content: text }] });
}
`,
    );
    const artifact = scan(root, contract);
    const summarize = artifact.proposed_bindings.find(
      (b) => b.location.symbol === "summarize",
    );
    expect(summarize?.workload.ref).toBeNull();
    expect(summarize?.unbound_reasons).toContain(
      "outside_declared_components_of_workload",
    );
    const result = provider(evaluate(contract, artifact));
    expect(result.verdict).toBe("pass");
    expect(result.caveats.join(" ")).toContain("another operation kind");
  });

  it("does not let unrelated uncertainty elsewhere block a verdict", async () => {
    const { contract, root } = await subject(
      `${prelude}export async function classifyTicket(id: string) {
  return client.chat.completions.create({ model: "gpt-4o-mini-2024-07-18", messages: [{ role: "user", content: redactTicket(readTicket(id)) }] });
}
`,
      {
        "src/ui.ts": `export function onEvent(handler: (value: string) => void, value: string) {
  handler(value);
  return JSON.parse(value).render(value);
}
`,
      },
    );
    const artifact = scan(root, contract);
    expect(artifact.unknowns.some((u) => u.location.path === "src/ui.ts")).toBe(
      true,
    );
    const result = provider(evaluate(contract, artifact));
    expect(result.verdict).toBe("pass");
    expect(result.caveats.join(" ")).toContain("were not treated as blocking");
  });
});

describe("test code", () => {
  it("does not let unresolved imports in test files block a production workload", async () => {
    const { contract, root } = await subject(
      `${prelude}export async function classifyTicket(id: string) {
  return client.chat.completions.create({ model: "gpt-4o-mini-2024-07-18", messages: [{ role: "user", content: redactTicket(readTicket(id)) }] });
}
`,
      {
        "src/classify.test.ts": `// @ts-nocheck
import { test } from "@playwright/test";
test("classify", () => {});
`,
      },
    );
    const artifact = scan(root, contract);
    expect(
      artifact.unknowns.some(
        (u) =>
          u.reason === "unresolved_import" &&
          u.location.path === "src/classify.test.ts",
      ),
    ).toBe(true);
    expect(provider(evaluate(contract, artifact)).verdict).toBe("pass");
    await writeFile(
      join(root, "src/other.ts"),
      `// @ts-nocheck\nimport { hidden } from "not-installed-sdk";\nexport const x = hidden;\n`,
    );
    // The same import in production code still blocks.
    expect(provider(evaluate(contract, scan(root, contract))).verdict).toBe(
      "unknown",
    );
  });
});

describe("declared runtime values", () => {
  const runtimeModel = `${prelude}export async function classifyTicket(id: string, model: string) {
  return client.chat.completions.create({ model, messages: [{ role: "user", content: redactTicket(readTicket(id)) }] });
}
`;
  const sinkWith = (extra: Record<string, unknown>) =>
    declarations({
      ...ATLAS_COMPONENTS,
      sinks: [
        {
          id: "sink.openai",
          recognizer: "openai",
          architecture_node_ref: "remote-model-provider",
          candidate_ref: "candidate.classification.remote_unselected",
          ...extra,
        },
      ],
    });

  it("is unknown for a runtime model without a declaration", async () => {
    const { contract, root } = await subject(runtimeModel);
    const result = provider(evaluate(contract, scan(root, contract)));
    expect(result.verdict).toBe("unknown");
    expect(result.unknown_reasons).toContain("runtime_selected_model");
  });

  it("passes at T1 when the declared runtime models are all approved", async () => {
    const { contract, root } = await subject(runtimeModel);
    const artifact = scan(
      root,
      contract,
      sinkWith({ models: ["gpt-4o-mini-2024-07-18"] }),
    );
    const result = provider(evaluate(contract, artifact));
    expect(result).toMatchObject({ verdict: "pass", evidence_tier: "T1" });
    expect(result.caveats.join(" ")).toContain("sink.openai");
  });

  it("fails when a declared runtime model is not approved", async () => {
    const { contract, root } = await subject(runtimeModel);
    const artifact = scan(
      root,
      contract,
      sinkWith({ models: ["gpt-4o-mini-2024-07-18", "gpt-4.1"] }),
    );
    const result = provider(evaluate(contract, artifact));
    expect(result.verdict).toBe("fail");
    expect(result.explanation).toContain(
      "declared_runtime_models_not_approved",
    );
  });

  it("accepts declared providers for an endpoint chosen at run time", async () => {
    const source = `import OpenAI from "openai";
import { readTicket } from "./tickets";
import { redactTicket } from "./redact";
export async function classifyTicket(id: string, baseURL: string) {
  const configured = new OpenAI({ baseURL });
  return configured.chat.completions.create({ model: "gpt-4o-mini-2024-07-18", messages: [{ role: "user", content: redactTicket(readTicket(id)) }] });
}
`;
    const { contract, root } = await subject(source);
    expect(provider(evaluate(contract, scan(root, contract))).verdict).toBe(
      "unknown",
    );
    const declared = scan(root, contract, sinkWith({ providers: ["openai"] }));
    expect(provider(evaluate(contract, declared))).toMatchObject({
      verdict: "pass",
      evidence_tier: "T1",
    });
  });
});
