import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ScanArtifact } from "../src/index.js";
import {
  artifactOf,
  atlas,
  callIn,
  cleanup,
  declarations,
  materialize,
  scan,
} from "./helpers.js";
import type { SyntheticSdk } from "./helpers.js";

/**
 * Provider surfaces found in real repositories (benchmarks/real-repos/):
 * SDK resource methods, endpoint hosts, client linking, Anthropic, the Vercel
 * AI SDK and fetch to provider hosts. All SDK declarations are synthetic.
 */

afterEach(cleanup);

async function repository(
  files: Record<string, string>,
  sdks: readonly SyntheticSdk[] = ["openai"],
  tsconfig?: Record<string, unknown>,
): Promise<ScanArtifact> {
  const root = await materialize("direct-call", sdks);
  for (const [path, text] of Object.entries(files))
    await writeFile(join(root, path), text);
  if (tsconfig !== undefined)
    await writeFile(join(root, "tsconfig.json"), JSON.stringify(tsconfig));
  return artifactOf(scan(root, await atlas(), declarations({ sinks: [] })));
}

const calls = (artifact: ScanArtifact) =>
  artifact.observations.filter((o) => o.kind === "provider_call");

describe("OpenAI SDK resource methods", () => {
  it("recognizes file uploads and thread messages, with what they send", async () => {
    const artifact = await repository({
      "src/classify.ts": `import OpenAI from "openai";
import { readTicket } from "./tickets";
const client = new OpenAI();
export async function upload(id: string) {
  return client.files.create({ file: readTicket(id), purpose: "assistants" });
}
export async function post(threadId: string, id: string) {
  return client.beta.threads.messages.create(threadId, { role: "user", content: readTicket(id) });
}
export async function lookup(fileId: string) {
  return client.files.retrieve(fileId);
}
`,
    });
    expect(
      calls(artifact).map((c) => [
        c.location.symbol,
        c.kind === "provider_call" ? c.operation : "",
        c.kind === "provider_call" ? c.operation_kind : "",
      ]),
    ).toEqual([
      ["upload", "files.create", "data_upload"],
      ["post", "beta.threads.messages.create", "data_upload"],
      ["lookup", "files.retrieve", "management"],
    ]);
    expect(callIn(artifact, "upload").flow.status).toBe("raw_reaches");
    expect(callIn(artifact, "post").flow.status).toBe("raw_reaches");
  });
});

describe("Together", () => {
  it("recognizes the Together client's resource methods and its own host", async () => {
    const artifact = await repository(
      {
        "src/classify.ts": `import Together from "together-ai";
const together = new Together();
const local = new Together({ baseURL: "https://router.internal.example/v1" });
export async function classify(text: string) {
  return together.chat.completions.create({
    model: "meta-llama/Llama-3-8b-chat-hf",
    messages: [{ role: "user", content: text }],
  });
}
export async function embed(text: string) {
  return together.embeddings.create({ model: "m2-bert-80M-8k-retrieval", input: text });
}
export async function follow(text: string) {
  return together.chat.completions.stream({
    model: "meta-llama/Llama-3-8b-chat-hf",
    messages: [{ role: "user", content: text }],
  });
}
export async function upload(file: unknown) {
  return together.files.upload({ file });
}
export async function elsewhere(text: string) {
  return local.chat.completions.create({ model: "x", messages: [{ role: "user", content: text }] });
}
`,
      },
      ["together-ai"],
    );
    expect(
      calls(artifact).map((call) => [
        call.location.symbol,
        call.kind === "provider_call" ? call.operation : "",
        call.kind === "provider_call" ? call.operation_kind : "",
        call.kind === "provider_call" ? call.endpoint.provider : "",
        call.kind === "provider_call" ? call.endpoint.host : "",
      ]),
    ).toEqual([
      [
        "classify",
        "chat.completions.create",
        "inference",
        "together",
        "api.together.ai",
      ],
      [
        "embed",
        "embeddings.create",
        "embedding",
        "together",
        "api.together.ai",
      ],
      [
        "follow",
        "chat.completions.stream",
        "inference",
        "together",
        "api.together.ai",
      ],
      ["upload", "files.upload", "data_upload", "together", "api.together.ai"],
      // A base URL override is the endpoint, whatever SDK made the call.
      [
        "elsewhere",
        "chat.completions.create",
        "inference",
        null,
        "router.internal.example",
      ],
    ]);
  });
});

describe("endpoint identity", () => {
  it("maps literal base URLs to providers by host, never by name", async () => {
    const artifact = await repository({
      "src/classify.ts": `import OpenAI from "openai";
const groq = new OpenAI({ baseURL: "https://api.groq.com/openai/v1" });
const unknownHost = new OpenAI({ baseURL: "https://llm.internal.example/v1" });
const local = new OpenAI({ baseURL: "http://localhost:1234/v1" });
const openaiNamedVariable = new OpenAI({ baseURL: \`https://api.mistral.ai/v1\` });
export const a = () => groq.chat.completions.create({ model: "llama-3.1-8b", messages: [] });
export const b = () => unknownHost.chat.completions.create({ model: "x", messages: [] });
export const c = () => local.chat.completions.create({ model: "x", messages: [] });
export const d = () => openaiNamedVariable.chat.completions.create({ model: "x", messages: [] });
`,
    });
    const endpoint = (symbol: string) =>
      (
        calls(artifact).find((c) => c.location.symbol === symbol) as Extract<
          ScanArtifact["observations"][number],
          { kind: "provider_call" }
        >
      ).endpoint;
    expect(endpoint("a")).toEqual({
      selection: "literal_override",
      host: "api.groq.com",
      provider: "groq",
      deployment: "managed_api",
    });
    expect(endpoint("b")).toMatchObject({
      host: "llm.internal.example",
      provider: null,
      deployment: null,
    });
    expect(endpoint("c")).toMatchObject({
      host: "localhost",
      provider: null,
      deployment: "local",
    });
    expect(endpoint("d")).toMatchObject({ provider: "mistral" });
  });

  it("combines reassigned clients and never guesses a single provider", async () => {
    const artifact = await repository({
      "src/classify.ts": `import OpenAI from "openai";
export async function embed(useGroq: boolean, text: string) {
  let client;
  if (useGroq) client = new OpenAI({ baseURL: "https://api.groq.com/openai/v1" });
  else client = new OpenAI();
  return client.embeddings.create({ model: "text-embedding-3-small", input: text });
}
class Service {
  private readonly client: OpenAI;
  constructor() {
    this.client = new OpenAI();
  }
  run(text: string) {
    return this.client.responses.create({ model: "gpt-4o-mini", input: text });
  }
}
export const service = new Service();
export function injected(client: OpenAI, text: string) {
  return client.responses.create({ model: "gpt-4o-mini", input: text });
}
`,
    });
    const byOwner = (symbol: string) =>
      calls(artifact).find((c) => c.location.symbol === symbol) as Extract<
        ScanArtifact["observations"][number],
        { kind: "provider_call" }
      >;
    expect(byOwner("embed")).toMatchObject({
      linkage: "clients",
      endpoint: { selection: "runtime_selected", provider: null },
    });
    expect(byOwner("Service.run")).toMatchObject({
      linkage: "client",
      endpoint: { selection: "default", provider: "openai" },
    });
    // Clients in the repository disagree, so an injected client stays unlinked.
    expect(byOwner("injected")).toMatchObject({
      linkage: "unlinked",
      endpoint: { selection: "unlinked" },
    });
    expect(
      artifact.unknowns.some(
        (u) =>
          u.reason === "runtime_selected_endpoint" &&
          u.location.symbol === "injected",
      ),
    ).toBe(true);
  });

  it("treats Azure clients as configured at run time", async () => {
    const artifact = await repository({
      "src/classify.ts": `import { AzureOpenAI } from "openai";
const client = new AzureOpenAI();
export const call = (text: string) => client.responses.create({ model: "gpt-4o", input: text });
`,
    });
    expect(calls(artifact)[0]).toMatchObject({
      endpoint: { selection: "runtime_selected", provider: "azure_openai" },
    });
  });
});

describe("other SDKs", () => {
  it("recognizes Anthropic messages with their literal model", async () => {
    const artifact = await repository(
      {
        "src/classify.ts": `import Anthropic from "@anthropic-ai/sdk";
import { readTicket } from "./tickets";
const anthropic = new Anthropic();
export async function classify(id: string) {
  return anthropic.messages.create({ model: "claude-3-5-haiku-20241022", max_tokens: 100, messages: [{ role: "user", content: readTicket(id) }] });
}
`,
      },
      ["@anthropic-ai/sdk"],
    );
    const { call, flow } = callIn(artifact, "classify");
    expect(call).toMatchObject({
      recognizer: "anthropic",
      operation: "messages.create",
      model: { kind: "literal", value: "claude-3-5-haiku-20241022" },
      endpoint: { provider: "anthropic", host: "api.anthropic.com" },
    });
    expect(flow.status).toBe("raw_reaches");
  });

  it("resolves Vercel AI SDK models to their provider factory", async () => {
    const artifact = await repository(
      {
        "src/classify.ts": `import { generateText, streamText, convertToCoreMessages } from "ai";
import { openai } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { readTicket } from "./tickets";
const anthropic = createAnthropic({ apiKey: "from-request" });
const proxied = createAnthropic({ baseURL: "https://gateway.example.com/v1" });
export async function classify(id: string) {
  return generateText({ model: openai("gpt-4o"), prompt: readTicket(id) });
}
export async function chat(model: string) {
  convertToCoreMessages([]);
  return streamText({ model: anthropic(model), messages: [] });
}
export async function viaProxy() {
  return streamText({ model: proxied.chat("claude-3-7-sonnet-20250219"), messages: [] });
}
`,
      },
      ["ai", "@ai-sdk/openai", "@ai-sdk/anthropic"],
    );
    expect(calls(artifact)).toHaveLength(3);
    expect(callIn(artifact, "classify").call).toMatchObject({
      recognizer: "ai-sdk",
      operation: "generateText",
      model: { kind: "literal", value: "gpt-4o" },
      endpoint: { selection: "default", provider: "openai" },
      linkage: "factory",
    });
    expect(callIn(artifact, "classify").flow.status).toBe("raw_reaches");
    expect(callIn(artifact, "chat").call).toMatchObject({
      model: { kind: "runtime_selected" },
      endpoint: { selection: "default", provider: "anthropic" },
    });
    expect(callIn(artifact, "viaProxy").call).toMatchObject({
      model: { kind: "literal", value: "claude-3-7-sonnet-20250219" },
      endpoint: {
        selection: "literal_override",
        host: "gateway.example.com",
        provider: null,
      },
    });
  });

  it("flags constructors from unsupported AI SDKs", async () => {
    const artifact = await repository(
      {
        "src/classify.ts": `import { RealtimeSession } from "@openai/agents-realtime";
export const session = new RealtimeSession({}, { model: "gpt-realtime" });
`,
      },
      ["@openai/agents-realtime"],
    );
    expect(
      artifact.unknowns.map((u) => [u.reason, u.detail, u.ai_related]),
    ).toContainEqual([
      "unsupported_provider_sdk",
      ["@openai/agents-realtime"],
      true,
    ]);
  });
});

describe("HTTP requests to AI providers", () => {
  it("treats fetch to a provider host as a provider call with its body model", async () => {
    const artifact = await repository({
      "src/classify.ts": `import { readTicket } from "./tickets";
export async function direct(id: string) {
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: "gpt-4.1", messages: [{ role: "user", content: readTicket(id) }] }),
  });
}
export async function download(fileId: string, container: string | null) {
  const url = container
    ? \`https://api.openai.com/v1/containers/\${container}/files/\${fileId}\`
    : \`https://api.openai.com/v1/container-files/\${fileId}\`;
  return fetch(url);
}
export async function ownServer(id: string) {
  return fetch("/api/classify", { method: "POST", body: readTicket(id) });
}
export async function somewhere(url: string, id: string) {
  return fetch(url, { method: "POST", body: readTicket(id) });
}
`,
    });
    expect(callIn(artifact, "direct").call).toMatchObject({
      recognizer: "http",
      operation_kind: "inference",
      model: { kind: "literal", value: "gpt-4.1" },
      endpoint: { host: "api.openai.com", provider: "openai" },
    });
    expect(callIn(artifact, "direct").flow.status).toBe("raw_reaches");
    expect(callIn(artifact, "download").call).toMatchObject({
      operation_kind: "management",
      endpoint: { provider: "openai" },
    });
    const symbols = calls(artifact).map((c) => c.location.symbol);
    expect(symbols).not.toContain("ownServer");
    expect(symbols).not.toContain("somewhere");
    const hops = artifact.unknowns
      .filter((u) => u.reason === "unmodelled_network_hop")
      .map((u) => u.location.symbol);
    // A same-origin request is not a hop to a third party; an unknown URL is.
    expect(hops).toContain("somewhere");
    expect(hops).not.toContain("ownServer");
  });

  it("recognizes the global fetch declared by Node's type package", async () => {
    const artifact = await repository(
      {
        "src/classify.ts": `export async function direct(text: string) {
  console.log(text);
  return fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: "claude-3-5-haiku-20241022", input: text }) });
}
`,
      },
      ["@types/node"],
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022"],
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
        },
        include: ["src"],
      },
    );
    expect(callIn(artifact, "direct").call).toMatchObject({
      endpoint: { provider: "anthropic" },
      model: { kind: "literal", value: "claude-3-5-haiku-20241022" },
    });
    // console.log from @types/node behaves like the default library.
    expect(
      artifact.unknowns.filter(
        (u) =>
          u.reason === "external_call_not_modelled" &&
          u.location.symbol === "direct",
      ),
    ).toEqual([]);
  });
});

describe("imports that cannot hide code", () => {
  it("does not report data imports, unbuilt output of scanned packages or linked workspace packages", async () => {
    const root = await materialize("direct-call");
    await mkdir(join(root, "packages/widget/src"), { recursive: true });
    await writeFile(
      join(root, "packages/widget/package.json"),
      JSON.stringify({ name: "widget", main: "dist/index.js" }),
    );
    await writeFile(
      join(root, "packages/widget/src/index.ts"),
      "export const widget = 1;\n",
    );
    await mkdir(join(root, "node_modules"), { recursive: true });
    await symlink(
      join(root, "packages/widget"),
      join(root, "node_modules/widget"),
    );
    await writeFile(
      join(root, "src/loaders.ts"),
      `// @ts-nocheck
import { widget } from "widget";
import { run } from "../packages/widget/dist/cli.js";
import { missing } from "./not-there";
export async function messages(language: string) {
  return import(\`../locales/\${language}.json\`);
}
export async function plugin(name: string) {
  return import(\`./plugins/\${name}\`);
}
export const all = [widget, run, missing];
`,
    );
    const artifact = artifactOf(
      scan(root, await atlas(), declarations({ sinks: [] })),
    );
    const found = artifact.unknowns
      .filter((u) => u.location.path === "src/loaders.ts")
      .filter(
        (u) =>
          u.reason === "unresolved_import" ||
          u.reason === "runtime_selected_import",
      )
      .map((u) => [u.reason, u.location.start.line]);
    // Only the genuinely missing module and the plugin loaded by name remain.
    expect(found).toEqual(
      expect.arrayContaining([
        ["unresolved_import", 4],
        ["runtime_selected_import", 9],
      ]),
    );
    const lines = found.map(([, line]) => line);
    expect(lines).not.toContain(2); // linked workspace package
    expect(lines).not.toContain(3); // build output of a scanned package
    expect(lines).not.toContain(6); // data file
  });
});
