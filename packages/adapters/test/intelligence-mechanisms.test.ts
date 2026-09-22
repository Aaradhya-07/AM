import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type {
  IntelligenceRequest,
  ValidatedRegistration,
} from "../src/index.js";
import {
  ADAPTER_PROTOCOL_VERSION,
  buildHandoffDocument,
  buildIntelligenceRequest,
  createHandoffAdapter,
  createOpenAiCompatibleAdapter,
  createOutboundConsentStore,
  describeHandoffDisclosure,
  describeProviderDisclosure,
  extractJsonContent,
  fixedClock,
  intelligenceRequestDigest,
  validateRegistration,
} from "../src/index.js";
import { fixtureContract } from "./helpers.js";

// A key-shaped value that the secret detector recognises. Never a real key.
const FAKE_KEY = "sk-proj-TESTONLYabcdefghijklmnopqrstuvwxyz0123";

const PROPOSAL = {
  protocol_version: ADAPTER_PROTOCOL_VERSION,
  proposed_constraints: [
    {
      id: "latency.extraction_p95",
      domain: "latency",
      severity: "soft",
      direction: "minimize",
      subject: "workload.classification.latency_p95_ms",
      operator: "lte",
      value: 2000,
      source: "agent_proposed",
      rationale: null,
    },
  ],
  proposed_candidates: [
    {
      id: "candidate.classification.managed_b",
      workload_ref: "classification",
      component_kind: "model_runtime",
      model_family: null,
      model_version: null,
      deployment_mode: "managed_api",
      provider: null,
      rationale: "A managed alternative to compare against the local option.",
    },
  ],
  questions: ["Which regions may process redacted tickets?"],
  inferences: [],
  rationale: { summary: "Adds a managed alternative.", generated_by: "test" },
};

interface Captured {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

type Handler = (
  captured: Captured,
  response: ServerResponse,
) => void | Promise<void>;

let server: ReturnType<typeof createServer>;
let port = 0;
let handler: Handler = () => {};
const received: Captured[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const captured: Captured = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      received.push(captured);
      void handler(captured, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  received.length = 0;
  handler = () => {};
});

function reply(content: string, status = 200, model = "served-model") {
  return (_captured: Captured, response: ServerResponse) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-test",
        model,
        choices: [{ index: 0, message: { role: "assistant", content } }],
      }),
    );
  };
}

function registration(
  overrides: Record<string, unknown> = {},
): ValidatedRegistration {
  const result = validateRegistration({
    id: "test-provider",
    mechanism: "openai_compatible",
    base_url: `http://127.0.0.1:${port}/v1`,
    model: "test-model",
    reach: "local",
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(result.problems.join("; "));
  }
  return result.value;
}

function request(task: IntelligenceRequest["task"] = "propose_candidates") {
  return buildIntelligenceRequest(fixtureContract(), {
    task,
    execution: "remote",
  });
}

const NOW = "2026-09-13T10:00:00.000Z";

describe("trusted provider registration", () => {
  it("derives the declared destination and endpoint from a loopback base URL", () => {
    const result = validateRegistration({
      id: "ollama-local",
      mechanism: "openai_compatible",
      base_url: "http://127.0.0.1:11434/v1",
      model: "example",
      reach: "local",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.destination).toBe("127.0.0.1:11434");
    expect(result.value.endpoint).toBe(
      "http://127.0.0.1:11434/v1/chat/completions",
    );
    expect(result.value.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it.each([
    [
      "local reach for a non-loopback host",
      { base_url: "https://api.example.com/v1", reach: "local" },
      "requires a loopback host",
    ],
    [
      "plain http to a remote host",
      { base_url: "http://api.example.com/v1", reach: "remote" },
      "plain http",
    ],
    [
      "credentials in the URL",
      { base_url: "https://user:pass1234@api.example.com/v1", reach: "remote" },
      "secret-shaped",
    ],
    [
      "a query string",
      { base_url: "https://api.example.com/v1?key=abc", reach: "remote" },
      "query string",
    ],
    ["a pasted key as the model", { model: FAKE_KEY }, "secret-shaped"],
    ["PATH as the credential", { credential_env: "PATH" }, "not a credential"],
    ["an unknown field", { headers: { "x-extra": "1" } }, "headers"],
    ["a non-http scheme", { base_url: "file:///etc/passwd" }, "http or https"],
  ])("refuses %s", (_label, overrides, fragment) => {
    const result = validateRegistration({
      id: "p",
      mechanism: "openai_compatible",
      base_url: "http://127.0.0.1:11434/v1",
      model: "example",
      reach: "local",
      ...overrides,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(" ")).toContain(fragment);
    expect(result.problems.join(" ")).not.toContain(FAKE_KEY);
  });

  it("gives every distinct setting a distinct digest", () => {
    const base = registration();
    for (const change of [
      { model: "other-model" },
      { credential_env: "OTHER_KEY" },
      { base_url: `http://127.0.0.1:${port}/v2` },
      { cost: "may_incur_cost" },
      { reach: "remote" },
    ]) {
      expect(registration(change).digest).not.toBe(base.digest);
    }
  });
});

describe("outbound consent", () => {
  const attempt = {
    provider_id: "p",
    destination: "api.example.com",
    registration_digest: `sha256:${"a".repeat(64)}`,
    request_digest: `sha256:${"b".repeat(64)}`,
  };

  it("is consumed by the one exact send it was granted for", () => {
    const store = createOutboundConsentStore({ clock: () => NOW });
    expect(store.verifier.consume(attempt)).toContain("no consent");
    store.grant(attempt);
    expect(store.verifier.consume(attempt)).toBeNull();
    expect(store.verifier.consume(attempt)).toContain("already used");
  });

  it.each([
    ["request", { request_digest: `sha256:${"c".repeat(64)}` }],
    ["registration", { registration_digest: `sha256:${"d".repeat(64)}` }],
    ["destination", { destination: "evil.example.com" }],
  ])("does not carry over to a changed %s", (_label, change) => {
    const store = createOutboundConsentStore({ clock: () => NOW });
    store.grant(attempt);
    expect(store.verifier.consume({ ...attempt, ...change })).toContain(
      "different",
    );
  });

  it("expires, and refuses a grant dated in the future", () => {
    const times = [NOW, "2026-09-13T10:11:00.000Z"];
    let index = 0;
    const store = createOutboundConsentStore({
      clock: () => times[Math.min(index++, 1)] as string,
    });
    store.grant(attempt);
    expect(store.verifier.consume(attempt)).toContain("expired");

    const future = createOutboundConsentStore({
      clock: fixedClock("2026-09-13T11:00:00.000Z", NOW),
    });
    future.grant(attempt);
    expect(future.verifier.consume(attempt)).toContain("expired");
  });
});

describe("the provider-neutral request", () => {
  it("is identical for every mechanism given the same contract and task", () => {
    const one = request();
    const two = request();
    expect(two.request).toEqual(one.request);
    expect(two.digest).toBe(one.digest);
    expect(describeHandoffDisclosure(one).request_digest).toBe(
      describeProviderDisclosure(one, registration({ reach: "remote" }))
        .request_digest,
    );
  });

  it("never includes repository content or evaluation rows by default", () => {
    const disclosure = describeProviderDisclosure(
      request(),
      registration({ reach: "remote", cost: "may_incur_cost" }),
    );
    expect(disclosure.includes_repository_contents).toBe(false);
    expect(disclosure.includes_evaluation_rows).toBe(false);
    expect(disclosure.cost).toBe("may_incur_cost");
    expect(disclosure.consent_required).toBe(true);
    expect(disclosure.destination_category).toBe("remote_provider");
    expect(disclosure.withheld_categories).toContain("file_contents");
  });

  it("gives a local runtime the disclosed local set even when the remote policy allows nothing", () => {
    const contract = fixtureContract((document) => {
      (
        document.remote_intelligence_policy as { default_allow: string[] }
      ).default_allow = [];
    });
    const remote = buildIntelligenceRequest(contract, {
      task: "clarify_intent",
      execution: "remote",
    });
    const local = buildIntelligenceRequest(contract, {
      task: "clarify_intent",
      execution: "local",
    });
    expect(remote.projection.allowed_fields).toEqual([]);
    expect(local.projection.allowed_fields).toContain("intent");
    expect(local.projection.allowed_fields).not.toContain("file_contents");
  });
});

describe("the OpenAI-compatible mechanism over real HTTP", () => {
  it("sends the exact request to a local runtime and returns the validated proposal", async () => {
    handler = reply(JSON.stringify(PROPOSAL));
    const built = request();
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration(),
      consent: null,
    });
    const outcome = await adapter.propose(built.request);

    expect(outcome.standing).toBe("available");
    if (outcome.standing !== "available") return;
    expect(outcome.value.proposed_candidates[0]?.id).toBe(
      "candidate.classification.managed_b",
    );
    expect(outcome.adapter.version).toBe("served-model");
    expect(outcome.provenance.raw_result_hash).toMatch(/^sha256:/);

    expect(received).toHaveLength(1);
    const sent = received[0] as Captured;
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("/v1/chat/completions");
    expect(sent.headers.authorization).toBeUndefined();
    const body = JSON.parse(sent.body) as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("test-model");
    expect(JSON.parse(body.messages[1]?.content ?? "")).toEqual(built.request);
  });

  it("accepts one fenced JSON block, and refuses prose", async () => {
    expect(extractJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    handler = reply("Here are my thoughts: use a local model.");
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration(),
      consent: null,
    });
    const outcome = await adapter.propose(request().request);
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("malformed_output");
  });

  it("sends nothing to a remote provider without consent", async () => {
    handler = reply(JSON.stringify(PROPOSAL));
    const store = createOutboundConsentStore({ clock: () => NOW });
    for (const consent of [null, store.verifier]) {
      const adapter = createOpenAiCompatibleAdapter({
        provider: registration({ reach: "remote" }),
        consent,
        clock: () => NOW,
      });
      const outcome = await adapter.propose(request().request);
      expect(outcome.standing).toBe("failed");
      expect(outcome.errors[0]?.code).toBe("authorization_required");
    }
    expect(received).toHaveLength(0);
  });

  it("refuses consent granted for different content and sends nothing", async () => {
    handler = reply(JSON.stringify(PROPOSAL));
    const provider = registration({ reach: "remote" });
    const store = createOutboundConsentStore({ clock: () => NOW });
    const shown = request("propose_candidates");
    store.grant({
      provider_id: provider.registration.id,
      destination: provider.destination,
      registration_digest: provider.digest,
      request_digest: shown.digest,
    });
    const adapter = createOpenAiCompatibleAdapter({
      provider,
      consent: store.verifier,
      clock: () => NOW,
    });
    const outcome = await adapter.propose(
      request("propose_constraints").request,
    );
    expect(outcome.errors[0]?.code).toBe("authorization_required");
    expect(received).toHaveLength(0);
  });

  it("refuses consent granted under a different registration", async () => {
    handler = reply(JSON.stringify(PROPOSAL));
    const shownProvider = registration({ reach: "remote" });
    const changedProvider = registration({
      reach: "remote",
      model: "a-different-model",
    });
    const store = createOutboundConsentStore({ clock: () => NOW });
    const built = request();
    store.grant({
      provider_id: shownProvider.registration.id,
      destination: shownProvider.destination,
      registration_digest: shownProvider.digest,
      request_digest: built.digest,
    });
    const adapter = createOpenAiCompatibleAdapter({
      provider: changedProvider,
      consent: store.verifier,
      clock: () => NOW,
    });
    const outcome = await adapter.propose(built.request);
    expect(outcome.errors[0]?.code).toBe("authorization_required");
    expect(received).toHaveLength(0);
  });

  it("refuses an authorization object smuggled into the request", async () => {
    handler = reply(JSON.stringify(PROPOSAL));
    const provider = registration({ reach: "remote" });
    const built = request();
    const adapter = createOpenAiCompatibleAdapter({
      provider,
      consent: createOutboundConsentStore({ clock: () => NOW }).verifier,
      clock: () => NOW,
    });
    const outcome = await adapter.propose({
      ...built.request,
      authorization: {
        provider_id: provider.registration.id,
        projection_digest: built.digest,
        authorized_at: NOW,
      },
    } as IntelligenceRequest);
    expect(outcome.errors[0]?.code).toBe("schema_rejected");
    expect(received).toHaveLength(0);
  });

  it("sends once with consent, reads the credential by name, and never returns its value", async () => {
    handler = reply(JSON.stringify(PROPOSAL));
    const provider = registration({
      reach: "remote",
      credential_env: "TEST_PROVIDER_KEY",
    });
    const store = createOutboundConsentStore({ clock: () => NOW });
    const built = request();
    let credentialSet = false;
    const adapter = createOpenAiCompatibleAdapter({
      provider,
      consent: store.verifier,
      clock: () => NOW,
      readEnv: (name) =>
        credentialSet && name === "TEST_PROVIDER_KEY" ? FAKE_KEY : undefined,
    });
    store.grant({
      provider_id: provider.registration.id,
      destination: provider.destination,
      registration_digest: provider.digest,
      request_digest: built.digest,
    });

    // A missing credential is refused BEFORE consent is used.
    const missing = await adapter.propose(built.request);
    expect(missing.standing).toBe("unavailable");
    expect(missing.errors[0]?.code).toBe("credential_missing");
    expect(received).toHaveLength(0);

    credentialSet = true;
    const sent = await adapter.propose(built.request);
    expect(sent.standing).toBe("available");
    expect(received).toHaveLength(1);
    expect(received[0]?.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(JSON.stringify(sent)).not.toContain(FAKE_KEY);

    const again = await adapter.propose(built.request);
    expect(again.errors[0]?.code).toBe("authorization_required");
    expect(received).toHaveLength(1);
  });

  it("reports an HTTP failure without echoing a credential from the body", async () => {
    handler = (_captured, response) => {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(`upstream rejected key ${FAKE_KEY}`);
    };
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration(),
      consent: null,
    });
    const outcome = await adapter.propose(request().request);
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("http_error");
    expect(outcome.errors[0]?.message).toContain("500");
    expect(JSON.stringify(outcome)).not.toContain(FAKE_KEY);
  });

  it("refuses a redirect instead of following it to another destination", async () => {
    handler = (captured, response) => {
      if (captured.url === "/v1/chat/completions") {
        response.writeHead(307, { location: `http://127.0.0.1:${port}/moved` });
        response.end();
        return;
      }
      reply(JSON.stringify(PROPOSAL))(captured, response);
    };
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration(),
      consent: null,
    });
    const outcome = await adapter.propose(request().request);
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("http_error");
    expect(received.map((entry) => entry.url)).toEqual([
      "/v1/chat/completions",
    ]);
  });

  it("reports an unreachable endpoint as unavailable", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, "127.0.0.1", resolve),
    );
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration({ base_url: `http://127.0.0.1:${closedPort}/v1` }),
      consent: null,
    });
    const outcome = await adapter.propose(request().request);
    expect(outcome.standing).toBe("unavailable");
    expect(outcome.errors[0]?.code).toBe("endpoint_unreachable");
  });

  it("times out, and cancels on request", async () => {
    handler = () => {
      // never answers
    };
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration(),
      consent: null,
    });
    const slow = await adapter.propose(request().request, { timeoutMs: 100 });
    expect(slow.standing).toBe("timed_out");

    const controller = new AbortController();
    const pending = adapter.propose(request().request, {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const cancelled = await pending;
    expect(cancelled.errors[0]?.code).toBe("cancelled");
  });

  it.each([
    ["JSON null", "null"],
    ["a JSON array", "[]"],
    ["a JSON string", '"hello"'],
    ["a JSON number", "42"],
    ["an empty object", "{}"],
    ["null choices", '{"choices":null}'],
    ["an empty choices array", '{"choices":[]}'],
    ["a null choice", '{"choices":[null]}'],
    ["a null message", '{"choices":[{"message":null}]}'],
    ["a string message", '{"choices":[{"message":"text"}]}'],
    ["numeric content", '{"choices":[{"message":{"content":5}}]}'],
  ])(
    "returns malformed_output, never a thrown error, for %s",
    async (_label, body) => {
      handler = (_captured, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(body);
      };
      const adapter = createOpenAiCompatibleAdapter({
        provider: registration(),
        consent: null,
      });
      const outcome = await adapter.propose(request().request);
      expect(outcome.standing).toBe("failed");
      expect(outcome.errors[0]?.code).toBe("malformed_output");
      expect(outcome.provenance.raw_result_hash).toMatch(/^sha256:/);
    },
  );

  it("returns malformed_output for JSON null through an injected fetch", async () => {
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration(),
      consent: null,
      fetch: async () =>
        new Response("null", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(adapter.propose(request().request)).resolves.toMatchObject({
      standing: "failed",
      errors: [expect.objectContaining({ code: "malformed_output" })],
    });
  });

  it("refuses an oversized response", async () => {
    handler = reply("x".repeat(4096));
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration({ max_response_bytes: 2048 }),
      consent: null,
    });
    const outcome = await adapter.propose(request().request);
    expect(outcome.errors[0]?.code).toBe("output_too_large");
  });

  it("rejects a proposal that tries to approve, and one carrying a secret", async () => {
    const adapter = createOpenAiCompatibleAdapter({
      provider: registration(),
      consent: null,
    });
    handler = reply(JSON.stringify({ ...PROPOSAL, approvals: [{}] }));
    const approving = await adapter.propose(request().request);
    expect(approving.errors[0]?.code).toBe("forbidden_proposal");

    handler = reply(
      JSON.stringify({ ...PROPOSAL, questions: [`use ${FAKE_KEY}`] }),
    );
    const leaking = await adapter.propose(request().request);
    expect(leaking.errors[0]?.code).toBe("secret_detected");
    expect(JSON.stringify(leaking)).not.toContain(FAKE_KEY);
  });
});

describe("the structured file handoff mechanism", () => {
  let directory = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "anvilmark-handoff-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("describes the request, the response file and the rules in one document", () => {
    const built = request();
    const document = buildHandoffDocument({
      request: built.request,
      requestId: "req-1",
      responseFile: ".anvilmark/intelligence/handoff/req-1.response.json",
      createdAt: NOW,
    });
    expect(document.request).toEqual(built.request);
    expect(document.request_digest).toBe(built.digest);
    expect(document.how_to_respond.join(" ")).toContain("req-1.response.json");
  });

  it("returns the same validated proposal the HTTP mechanism returns", async () => {
    const built = request();
    const responsePath = join(directory, "same.response.json");
    await writeFile(responsePath, JSON.stringify(PROPOSAL), "utf8");
    const viaFile = await createHandoffAdapter({
      responsePath,
      expectedRequestDigest: built.digest,
    }).propose(built.request);

    handler = reply(JSON.stringify(PROPOSAL));
    const viaHttp = await createOpenAiCompatibleAdapter({
      provider: registration(),
      consent: null,
    }).propose(built.request);

    expect(viaFile.standing).toBe("available");
    expect(viaHttp.standing).toBe("available");
    if (viaFile.standing !== "available" || viaHttp.standing !== "available")
      return;
    expect(viaFile.value).toEqual(viaHttp.value);
  });

  it("reports a missing response as unavailable, not as a failure", async () => {
    const built = request();
    const outcome = await createHandoffAdapter({
      responsePath: join(directory, "absent.json"),
      expectedRequestDigest: built.digest,
    }).propose(built.request);
    expect(outcome.standing).toBe("unavailable");
  });

  it("refuses a response bound to a different request", async () => {
    const built = request();
    const responsePath = join(directory, "other.response.json");
    await writeFile(responsePath, JSON.stringify(PROPOSAL), "utf8");
    const outcome = await createHandoffAdapter({
      responsePath,
      expectedRequestDigest: intelligenceRequestDigest(
        request("clarify_intent").request,
      ),
    }).propose(built.request);
    expect(outcome.errors[0]?.code).toBe("identity_mismatch");
  });

  it.each([
    ["malformed JSON", "{not json", "malformed_output"],
    [
      "a status claim",
      JSON.stringify({
        ...PROPOSAL,
        proposed_candidates: [
          { ...PROPOSAL.proposed_candidates[0], status: "viable" },
        ],
      }),
      "forbidden_proposal",
    ],
    [
      "an inference labelled as measured",
      JSON.stringify({
        ...PROPOSAL,
        inferences: [
          {
            subject: "quality",
            claim: "F1 is 0.95",
            kind: "measured_evaluation",
            confidence: "high",
            caveats: [],
          },
        ],
      }),
      "schema_rejected",
    ],
    ["an oversized file", "x".repeat(3000), "output_too_large"],
  ])("rejects %s", async (_label, content, code) => {
    const built = request();
    const responsePath = join(directory, `${code}.response.json`);
    await writeFile(responsePath, content, "utf8");
    const outcome = await createHandoffAdapter({
      responsePath,
      expectedRequestDigest: built.digest,
      maxResponseBytes: 2048,
    }).propose(built.request);
    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe(code);
  });
});
