import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildProviderRegistry,
  createPromptfooAdapter,
  describeOutboundProjection,
  fixedClock,
  isReservedEnvironmentName,
  isWellFormedProviderId,
  prepareEvaluation,
  validateEvaluationSpec,
} from "../src/index.js";
import { FIXED_TIMES } from "./helpers.js";
import {
  REMOTE_PROVIDER,
  TEST_PROVIDERS,
  evaluationSpec,
  planFor,
} from "./promptfoo-inputs.js";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "anvilmark-provider-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function adapter(overrides: Record<string, unknown> = {}) {
  return createPromptfooAdapter({
    clock: fixedClock(...FIXED_TIMES),
    // A binary that does not exist. Nothing here should ever reach a probe, so
    // any test that does will fail loudly rather than quietly passing.
    executable: join(workspace, "definitely-not-a-real-binary"),
    providers: TEST_PROVIDERS,
    readEnv: () => undefined,
    ...overrides,
  });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: "evidence.eval",
    spec: evaluationSpec(),
    dataDirectory: workspace,
    constraintRefs: ["quality.classification_f1"],
    ...overrides,
  };
}

describe("the provider id grammar", () => {
  /**
   * Every one of these was ACCEPTED by the previous denylist. The first four
   * are the reported reproductions; the rest are the same shape of hole.
   *
   * A URL is not merely an execution channel: `provider_id` is PERSISTED on
   * the evidence record, so `?api_key=...` would write a credential into the
   * contract.
   */
  const malformed: readonly (readonly [string, string])[] = [
    [
      "a URL carrying a token",
      "https://example.com/collect?api_key=abcdefghijklmnopqrstuv",
    ],
    ["a webhook wrapping a URL", "webhook:http://example.com/collect"],
    ["a websocket address", "ws://example.com/socket"],
    ["a URL with a fragment", "https://example.com/x#frag"],
    ["embedded credentials", "user:secret@host.com"],
    ["a relative path", "./providers/local.js"],
    ["an absolute path", "/usr/local/bin/provider"],
    ["a windows path", "C:\\\\providers\\\\run.exe"],
    ["a file url", "file://provider.py"],
    ["an exec provider", "exec:./run.sh"],
    ["a package provider", "package:@scope/thing"],
    ["a bare query string", "model?key=value"],
    ["whitespace", "example model"],
    ["a newline", "echo\nsecond"],
    ["a tab", "echo\tsecond"],
    ["four segments", "a:b:c:d"],
    ["a leading separator", ":echo"],
    ["a trailing separator", "echo:"],
    ["an empty id", ""],
    ["an over-long id", "a".repeat(129)],
  ];

  it.each(malformed)("refuses %s", (_label, id) => {
    expect(isWellFormedProviderId(id)).toBe(false);

    const result = validateEvaluationSpec(evaluationSpec({ provider: id }));
    expect("reasons" in result).toBe(true);
    if (!("reasons" in result)) return;
    expect(result.reasons.join(" ")).toContain("not a provider id");
  });

  it.each([
    ["a bare name", "echo"],
    ["a vendor and model", "openai:gpt-4o-mini"],
    ["three segments", "azure:chat:deployment"],
    ["dots and dashes", "anthropic:claude-3.5-sonnet"],
  ])("accepts %s as well-formed", (_label, id) => {
    expect(isWellFormedProviderId(id)).toBe(true);
  });

  it("cannot be registered around", () => {
    // The grammar is enforced at registration too, so a caller cannot register
    // a URL and have it accepted later.
    const result = buildProviderRegistry([
      {
        id: "https://example.com/collect",
        reach: "remote",
        destination: "example.com",
        credentialEnvNames: [],
      },
    ]);
    expect("reasons" in result).toBe(true);
  });

  it("refuses a provider registered more than once", () => {
    // One provider has one reach, one destination and one credential policy;
    // a second registration would make the effective policy depend on order.
    const result = buildProviderRegistry([
      {
        id: "echo",
        reach: "local",
        destination: "local",
        credentialEnvNames: [],
      },
      {
        id: "echo",
        reach: "remote",
        destination: "api.example.com",
        credentialEnvNames: [],
      },
    ]);
    expect("reasons" in result).toBe(true);
    if (!("reasons" in result)) return;
    expect(result.reasons.join(" ")).toContain("registered more than once");
  });
});

describe("execution requires registration", () => {
  /**
   * These are all WELL-FORMED ids. No grammar distinguishes them from a model
   * name, which is exactly why the closure is a registry rather than another
   * pattern: each names a promptfoo capability outside this milestone --
   * interactive input, an agent loop, a headless browser, a tool server.
   */
  const wellFormedButUnregistered = [
    "browser",
    "promptfoo:manual-input",
    // These name local code, but `python:grader.py` and `golang:main.go` are
    // well-formed strings: no grammar tells them apart from `azure:gpt.4`. The
    // previous prefix denylist claimed to, and that denylist is what let
    // `browser` and `https://...` through by not mentioning them.
    "python:grader.py",
    "golang:main.go",
    "mcp:server",
    "sequence:a",
    "codex:agent",
    "claude-code:agent",
    "openai:gpt-4o",
    "http:endpoint",
  ];

  it.each(wellFormedButUnregistered)(
    "refuses %s before spawning anything",
    async (id) => {
      expect(isWellFormedProviderId(id)).toBe(true);

      const outcome = await adapter().collect(
        request({ spec: evaluationSpec({ provider: id }) }),
      );

      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.code).toBe("provider_not_registered");
      // No probe ran, so no version was established.
      expect(outcome.adapter.version).toBeNull();
      expect(outcome.provenance.command_manifest).toBeNull();
    },
  );

  it("runs nothing at all when no provider is registered", async () => {
    const outcome = await adapter({ providers: [] }).collect(request());

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("provider_not_registered");
    expect(outcome.errors[0]?.detail).toMatchObject({ registered: [] });
  });

  it("reports an unusable registry rather than running anyway", async () => {
    const outcome = await adapter({
      providers: [
        {
          id: "https://example.com",
          reach: "remote",
          destination: "example.com",
          credentialEnvNames: [],
        },
      ],
    }).collect(request());

    expect(outcome.standing).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("invalid_adapter_policy");
  });
});

describe("a remote provider needs an authorization for this exact projection", () => {
  const REMOTE = [REMOTE_PROVIDER];
  const remoteSpec = () => evaluationSpec({ provider: REMOTE_PROVIDER.id });

  function projectionFor(spec = remoteSpec()) {
    const prepared = prepareEvaluation(spec, { providers: REMOTE });
    if ("reasons" in prepared) {
      throw new Error(prepared.reasons.join("; "));
    }
    return prepared.projection;
  }

  it("shows the outbound projection without executing anything", () => {
    const projection = projectionFor();

    expect(projection.destination).toBe("remote");
    expect(projection.provider_id).toBe(REMOTE_PROVIDER.id);
    expect(projection.data_categories).toContain("prompt_text");
    expect(projection.data_categories).toContain("dataset_variable_values");
    expect(projection.case_count).toBe(1);
    expect(projection.row_count).toBe(1);
    expect(projection.prompt_count).toBe(1);
    expect(projection.projection_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(projection.content_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("refuses a remote run with no authorization, before probing", async () => {
    const outcome = await adapter({ providers: REMOTE }).collect(
      request({ spec: remoteSpec() }),
    );

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("authorization_required");
    expect(outcome.errors[0]?.detail).toMatchObject({ reason: "missing" });
    expect(outcome.adapter.version).toBeNull();
    expect(outcome.provenance.command_manifest).toBeNull();
  });

  it("names the destination and data categories in the refusal", async () => {
    const outcome = await adapter({ providers: REMOTE }).collect(
      request({ spec: remoteSpec() }),
    );

    expect(outcome.errors[0]?.detail).toMatchObject({
      destination: "remote",
      provider_id: REMOTE_PROVIDER.id,
      projection_digest: projectionFor().projection_digest,
    });
  });

  it("refuses an authorization for a different provider", async () => {
    const outcome = await adapter({
      providers: [
        REMOTE_PROVIDER,
        {
          id: "other:model",
          reach: "remote",
          destination: "api.other.example",
          credentialEnvNames: [],
        },
      ],
    }).collect(
      request({
        spec: remoteSpec(),
        authorization: {
          provider_id: "other:model",
          projection_digest: projectionFor().projection_digest,
          authorized_at: FIXED_TIMES[0],
        },
      }),
    );

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.detail).toMatchObject({
      reason: "provider_mismatch",
    });
  });

  it("refuses an authorization for a different projection", async () => {
    // Approving one dataset is not approving another.
    const stale = projectionFor(
      evaluationSpec({
        provider: REMOTE_PROVIDER.id,
        ticket: "something else",
      }),
    );

    const outcome = await adapter({ providers: REMOTE }).collect(
      request({
        spec: remoteSpec(),
        authorization: {
          provider_id: REMOTE_PROVIDER.id,
          projection_digest: stale.projection_digest,
          authorized_at: FIXED_TIMES[0],
        },
      }),
    );

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.detail).toMatchObject({
      reason: "projection_mismatch",
    });
  });

  it("refuses a stale authorization", async () => {
    const outcome = await adapter({
      providers: REMOTE,
      authorizationMaxAgeMs: 1000,
    }).collect(
      request({
        spec: remoteSpec(),
        authorization: {
          provider_id: REMOTE_PROVIDER.id,
          projection_digest: projectionFor().projection_digest,
          authorized_at: "2020-01-01T00:00:00.000Z",
        },
      }),
    );

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.detail).toMatchObject({ reason: "stale" });
  });

  it("refuses an authorization with an unreadable timestamp", async () => {
    const outcome = await adapter({ providers: REMOTE }).collect(
      request({
        spec: remoteSpec(),
        authorization: {
          provider_id: REMOTE_PROVIDER.id,
          projection_digest: projectionFor().projection_digest,
          authorized_at: "whenever",
        },
      }),
    );

    expect(outcome.errors[0]?.detail).toMatchObject({
      reason: "unreadable_timestamp",
    });
  });

  it("does not ask a local provider for a remote authorization", async () => {
    // `echo` is registered local. It must not be refused for lacking an
    // approval to send data somewhere it never sends data.
    const outcome = await adapter().collect(request());

    expect(outcome.errors[0]?.code).not.toBe("authorization_required");
    // It fails for the honest reason: the binary in `request()` does not exist.
    expect(outcome.standing).not.toBe("unknown");
  });

  it("marks a local projection local, with the same content digest", () => {
    const localProjection = describeOutboundProjection(
      planFor(),
      TEST_PROVIDERS[0]!,
    );
    expect(localProjection.destination).toBe("local");

    // The content is the same; only the destination and therefore the
    // projection digest differ, so a local approval cannot be replayed remotely.
    const remoteProjection = describeOutboundProjection(
      planFor(),
      REMOTE_PROVIDER,
    );
    expect(remoteProjection.content_digest).toBe(
      localProjection.content_digest,
    );
    expect(remoteProjection.projection_digest).not.toBe(
      localProjection.projection_digest,
    );
  });

  it("lists credential names, never values, in the projection", () => {
    const prepared = prepareEvaluation(
      evaluationSpec({
        provider: REMOTE_PROVIDER.id,
        credentialEnvNames: ["EXAMPLE_API_KEY"],
      }),
      { providers: REMOTE },
    );
    if ("reasons" in prepared) throw new Error(prepared.reasons.join("; "));

    expect(prepared.projection.credential_env_names).toEqual([
      "EXAMPLE_API_KEY",
    ]);
    expect(prepared.projection.data_categories).toContain(
      "credential_values_read_from_the_environment",
    );
  });
});

describe("reserved environment names are matched case-insensitively", () => {
  it.each([
    "promptfoo_disable_sharing",
    "PromptFoo_Config_Dir",
    "pRoMpTfOo_cache_path",
    "PROMPTFOO_DISABLE_SHARING",
    "promptfoo_",
  ])("refuses %s", (name) => {
    // Windows environment names are case-insensitive, so the lower-case
    // spelling is the SAME variable. There is now one check, and the schema and
    // `isReservedEnvironmentName` share it.
    expect(isReservedEnvironmentName(name)).toBe(true);

    const result = validateEvaluationSpec(
      evaluationSpec({ credentialEnvNames: [name] }),
    );
    expect("reasons" in result).toBe(true);
    if (!("reasons" in result)) return;
    expect(result.reasons.join(" ")).toContain("PROMPTFOO_");
  });

  it("still accepts an ordinary credential name", () => {
    expect(isReservedEnvironmentName("EXAMPLE_API_KEY")).toBe(false);
    expect(
      "spec" in
        validateEvaluationSpec(
          evaluationSpec({ credentialEnvNames: ["EXAMPLE_API_KEY"] }),
        ),
    ).toBe(true);
  });
});
