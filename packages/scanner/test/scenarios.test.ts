import { afterEach, describe, expect, it } from "vitest";

import {
  ScanArtifactSchema,
  readArtifact,
  serializeArtifact,
} from "../src/index.js";
import {
  artifactOf,
  atlas,
  callIn,
  cleanup,
  declarations,
  materialize,
  scan,
} from "./helpers.js";

/**
 * Required Milestone 5 fixtures, scanned with the real TypeScript compiler
 * and type checker. SDK declarations are synthetic (see fixtures/README.md).
 */

afterEach(cleanup);

async function scanFixture(
  name: string,
  sdks: ("openai" | "ollama" | "bullmq")[] = ["openai"],
  config = declarations(),
) {
  const root = await materialize(name, sdks);
  const artifact = artifactOf(scan(root, await atlas(), config));
  expect(ScanArtifactSchema.safeParse(artifact).success).toBe(true);
  expect(readArtifact(serializeArtifact(artifact)).status).toBe("valid");
  return { root, artifact };
}

function kinds(
  artifact: Awaited<ReturnType<typeof scanFixture>>["artifact"],
  kind: string,
) {
  return artifact.observations.filter((entry) => entry.kind === kind);
}

describe("direct SDK import and call", () => {
  it("distinguishes dependency, import, client, call and data reaching the call", async () => {
    const { artifact } = await scanFixture("direct-call");
    expect(artifact.inventory.ai_dependencies).toEqual([
      expect.objectContaining({
        name: "openai",
        declared: "^4.0.0",
        installed_version: "4.0.0-synthetic",
        category: "provider_sdk",
        recognizer: "openai",
      }),
    ]);
    expect(kinds(artifact, "sdk_import")).toHaveLength(1);
    const [client] = kinds(artifact, "client_instantiation");
    expect(client).toMatchObject({
      provider: "openai",
      owner: "OpenAI",
      endpoint: {
        selection: "default",
        host: "api.openai.com",
        provider: "openai",
        deployment: "managed_api",
      },
      discovery: "deterministic_observation",
      evidence_tier: "T3",
      location: { path: "src/classify.ts", start: { line: 4, column: 16 } },
    });
    const { call, flow } = callIn(artifact, "classifyTicket");
    expect(call).toMatchObject({
      operation: "chat.completions.create",
      model: { kind: "literal", value: "gpt-4o-mini" },
      client_ref: client?.id,
      default_deployment: "managed_api",
      location: {
        path: "src/classify.ts",
        symbol: "classifyTicket",
        start: { line: 8, column: 10 },
        end: { line: 11, column: 5 },
      },
    });
    expect(call.location.source_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(flow.status).toBe("raw_reaches");
    expect(flow.classifications).toEqual(["raw_customer_ticket:raw"]);
    const fact = flow.contexts[0]?.facts[0];
    expect(fact?.trace.map((step) => step.kind)).toEqual([
      "source",
      "assignment",
      "sink",
    ]);
    expect(fact?.trace[0]).toMatchObject({
      path: "src/classify.ts",
      declaration_ref: "source.raw_ticket",
      start: { line: 7 },
    });
    expect(flow.assumptions).toEqual([
      {
        kind: "declared_source",
        declaration_ref: "source.raw_ticket",
        evidence_tier: "T1",
      },
    ]);
    expect(artifact.completeness.status).toBe(
      "complete_within_supported_scope",
    );
  });
});

describe("aliased imports and stored member references", () => {
  it("resolves re-exports, namespace imports and aliased members to the SDK symbol", async () => {
    const { artifact } = await scanFixture("aliased-import");
    expect(kinds(artifact, "client_instantiation")).toHaveLength(2);
    const reExport = callIn(artifact, "viaReExport");
    expect(reExport.call.operation).toBe("chat.completions.create");
    // Every client in the repository uses the default endpoint, so the
    // re-exported client's endpoint is known without a direct link.
    expect(reExport.call.linkage).toBe("repository_uniform");
    expect(reExport.call.caveats).toContain(
      "client_linked_by_repository_uniform_endpoint",
    );
    expect(reExport.flow.status).toBe("raw_reaches");
    const namespace = callIn(artifact, "viaNamespace");
    expect(namespace.call.operation).toBe("responses.create");
    expect(namespace.call.client_ref).not.toBeNull();
    expect(namespace.flow.status).toBe("raw_reaches");
    expect(
      namespace.flow.contexts[0]?.facts[0]?.trace.filter(
        (step) => step.kind === "assignment",
      ),
    ).toHaveLength(2);
  });
});

describe("resolved wrappers", () => {
  it("propagates arguments and return values through a direct call", async () => {
    const { artifact } = await scanFixture("wrapper-depth");
    const { flow } = callIn(artifact, "complete");
    expect(flow.status).toBe("raw_reaches");
    const direct = flow.contexts.filter(
      (context) => context.kind === "direct_call",
    );
    expect(direct.map((context) => context.root.symbol).sort()).toEqual([
      "oneLevel",
      "returnPropagation",
    ]);
    expect(direct.every((context) => context.status === "raw_reaches")).toBe(
      true,
    );
    const returned = direct.find(
      (context) => context.root.symbol === "returnPropagation",
    );
    expect(returned?.facts[0]?.trace.map((step) => step.kind)).toContain(
      "return",
    );
    // Every in-repository reference to `complete` was followed, so its
    // parameter-only context is superseded rather than reported as unknown.
    const own = flow.contexts.find(
      (context) => context.kind === "intraprocedural",
    );
    expect(own?.superseded).toBe(true);
    expect(flow.unknown_reasons).toEqual([]);
  });

  it("follows nested wrappers up to the documented depth", async () => {
    const { artifact } = await scanFixture("wrapper-depth");
    // twoLevels -> middle -> deepest -> embeddings.create is within depth 3.
    const { flow } = callIn(artifact, "deepest");
    expect(flow.status).toBe("raw_reaches");
    expect(
      flow.contexts
        .filter((context) => context.kind === "direct_call")
        .map((context) => context.root.symbol),
    ).toContain("twoLevels");
  });

  it("stops beyond the documented depth with an explicit unknown", async () => {
    const { artifact } = await scanFixture("wrapper-depth");
    expect(artifact.scanner.flow_model.call_depth).toBe(3);
    const deeper = artifact.unknowns.find(
      (entry) => entry.reason === "call_depth_exceeded",
    );
    // fourLevels -> level1 -> level2 -> level3 -> level4: the fourth call is not followed.
    expect(deeper).toMatchObject({
      stage: "flow",
      location: { path: "src/llm.ts", symbol: "level3", start: { line: 26 } },
      classifications: ["raw_customer_ticket:raw"],
      context: { kind: "direct_call", root: { symbol: "fourLevels" } },
    });
    expect(deeper?.trace[0]?.kind).toBe("source");
    const { flow } = callIn(artifact, "level4");
    expect(flow.status).toBe("unresolved");
    expect(flow.classifications).toEqual([]);
    expect(artifact.completeness.status).toBe("incomplete");
  });
});

describe("declared sanitizer semantics", () => {
  it("clears only the sanitizer's return value, on the declared argument", async () => {
    const { artifact } = await scanFixture("sanitizer-cases");
    const status = (symbol: string) => callIn(artifact, symbol).flow;
    expect(status("sanitizedDirect")).toMatchObject({
      status: "sanitized_only",
      classifications: ["redacted_customer_ticket:sanitized"],
      caveats: expect.arrayContaining(["declared_sanitizer_assumed_effective"]),
    });
    expect(
      status("sanitizedDirect").assumptions.map((entry) => entry.kind),
    ).toEqual([
      "declared_sanitizer",
      "declared_source",
      "declared_sources_complete",
    ]);
    // Calling the sanitizer and then sending the original is still raw.
    expect(status("resultIgnored").status).toBe("raw_reaches");
    expect(status("resultIgnored").classifications).toEqual([
      "raw_customer_ticket:raw",
    ]);
    expect(status("reassigned").status).toBe("sanitized_only");
    const mixed = status("mixedBranch");
    expect(mixed.status).toBe("raw_reaches");
    expect(mixed.caveats).toContain("raw_on_some_paths_only");
    expect(
      mixed.contexts[0]?.facts.map((fact) => [fact.state, fact.conditional]),
    ).toEqual([
      ["raw", true],
      ["sanitized", true],
    ]);
    expect(status("propertySelected").status).toBe("sanitized_only");
    expect(status("propertyLeaks").status).toBe("raw_reaches");
    expect(status("declaredArgumentPosition").status).toBe("sanitized_only");
    // Raw data in an argument the sanitizer does not clear is carried.
    expect(status("undeclaredArgumentPosition").status).toBe("raw_reaches");
  });
});

describe("missing sanitizer", () => {
  it("reports raw data reaching the call through a template and a library method", async () => {
    const { artifact } = await scanFixture("missing-sanitizer");
    const { flow } = callIn(artifact, "classifyTicket");
    expect(flow.status).toBe("raw_reaches");
    expect(flow.caveats).not.toContain("declared_sanitizer_assumed_effective");
    expect(JSON.stringify(artifact)).not.toContain("conformance_result");
  });
});

describe("JavaScript through allowJs", () => {
  it("scans CommonJS and ESM JavaScript with resolved symbols", async () => {
    const config = declarations({
      sources: [
        {
          id: "source.raw_ticket",
          data_classification: "raw_customer_ticket",
          function: { path: "src/tickets.js", export: "readTicket" },
        },
      ],
      sanitizers: [],
    });
    const { artifact } = await scanFixture(
      "javascript-allowjs",
      ["openai", "ollama"],
      config,
    );
    expect(artifact.configuration.compiler.tsconfig).toBeNull();
    expect(
      artifact.declarations.find((entry) => entry.id === "source.raw_ticket")
        ?.status,
    ).toBe("resolved");
    const commonjs = callIn(artifact, "classify");
    expect(commonjs.call.location.path).toBe("src/classify.js");
    expect(commonjs.flow.status).toBe("raw_reaches");
    const esm = callIn(artifact, "summarize");
    expect(esm.call).toMatchObject({
      provider: "ollama",
      operation: "generate",
      default_deployment: "local",
    });
    expect(esm.call.caveats).toContain("endpoint_overridden_in_code");
    expect(esm.flow.status).toBe("unresolved");
    expect(esm.flow.unknown_reasons).toEqual(["parameter_value_from_caller"]);
  });
});

describe("dynamic import and runtime-selected provider or endpoint", () => {
  it("records explicit unknowns and never invents a provider call", async () => {
    const { artifact } = await scanFixture("dynamic-runtime", [
      "openai",
      "ollama",
    ]);
    const reasons = artifact.unknowns.map((entry) => [
      entry.reason,
      entry.location.start.line,
    ]);
    expect(reasons).toEqual(
      expect.arrayContaining([
        ["runtime_selected_import", 8],
        ["unresolved_any", 9],
        ["runtime_selected_provider", 15],
        ["dynamic_dispatch", 15],
        ["runtime_selected_endpoint", 19],
      ]),
    );
    expect(
      artifact.unknowns.find(
        (entry) => entry.reason === "runtime_selected_provider",
      )?.detail,
    ).toEqual(["ollama", "openai"]);
    expect(
      artifact.unknowns.find((entry) => entry.reason === "unresolved_any")
        ?.classifications,
    ).toEqual(["raw_customer_ticket:raw"]);
    const calls = kinds(artifact, "provider_call");
    expect(calls.map((entry) => entry.location.symbol)).toEqual([
      "runtimeEndpoint",
    ]);
    expect(callIn(artifact, "runtimeEndpoint").call.caveats).toContain(
      "endpoint_selected_at_runtime",
    );
    expect(
      artifact.inventory.environment_variables.map((entry) => entry.name),
    ).toEqual(["CLASSIFIER_MODULE", "LLM_BASE_URL"]);
  });
});

describe("unresolved any", () => {
  it("flags a possible operation as unknown and the raw data passed into it", async () => {
    const { artifact } = await scanFixture("unresolved-any");
    expect(kinds(artifact, "provider_call")).toEqual([]);
    expect(
      artifact.unknowns.map((entry) => [
        entry.reason,
        entry.stage,
        entry.location.start.line,
      ]),
    ).toEqual([
      ["unresolved_import", "resolution", 3],
      ["possible_provider_operation_unresolved", "semantics", 7],
      ["unresolved_any", "flow", 7],
      ["unresolved_any", "flow", 15],
    ]);
    expect(artifact.unknowns[0]?.detail).toEqual(["static", "missing-llm-sdk"]);
    expect(artifact.completeness.status).toBe("incomplete");
  });
});

describe("queue handoff outside the supported boundary", () => {
  it("makes both sides of the handoff explicit unknowns", async () => {
    const { artifact } = await scanFixture("queue-handoff", [
      "openai",
      "bullmq",
    ]);
    const producer = artifact.unknowns.find(
      (entry) => entry.location.path === "src/producer.ts",
    );
    expect(producer).toMatchObject({
      reason: "unmodelled_handoff",
      detail: ["queue"],
      classifications: ["raw_customer_ticket:raw"],
    });
    const consumerCall = kinds(artifact, "provider_call")[0];
    const flow = artifact.data_flows.find(
      (entry) => entry.observation_ref === consumerCall?.id,
    );
    expect(flow?.status).toBe("unresolved");
    expect(flow?.unknown_reasons).toEqual(["unmodelled_handoff"]);
    expect(flow?.evidence_tier).toBe("T0");
  });
});

describe("provider names in strings and comments, and shadowed symbols", () => {
  it("produces no client or call from text or same-named local code", async () => {
    const { artifact } = await scanFixture("strings-and-shadowing");
    expect(kinds(artifact, "client_instantiation")).toEqual([]);
    expect(kinds(artifact, "provider_call")).toEqual([]);
    expect(
      artifact.unknowns.filter(
        (entry) => entry.reason === "possible_provider_operation_unresolved",
      ),
    ).toEqual([]);
    // The shadowing parameter is an interface-typed value: honest unknown, not a provider.
    expect(
      artifact.unknowns.map((entry) => [entry.reason, entry.location.symbol]),
    ).toEqual([["dynamic_dispatch", "shadowedParameter"]]);
  });
});
