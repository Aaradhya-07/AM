import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseProjectContract } from "@anvilmark/project-contract";
import type { ProjectContract } from "@anvilmark/project-contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ATLAS,
  ATLAS_PROPOSAL,
  FAKE_KEY,
  cleanup,
  cli,
  projectText,
  readTree,
  scriptedIo,
  tempDir,
  writeHostConfig,
} from "./helpers.js";

interface Received {
  readonly url: string | undefined;
  readonly headers: IncomingMessage["headers"];
  readonly body: string;
}

let server: ReturnType<typeof createServer>;
let port = 0;
const received: Received[] = [];
let respond: (response: ServerResponse) => void = () => {};

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        url: request.url,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      respond(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  received.length = 0;
  respond = () => {};
  await cleanup();
});

function answerWith(content: unknown, status = 200) {
  return (response: ServerResponse) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model: "served-model",
        choices: [
          {
            message: {
              role: "assistant",
              content:
                typeof content === "string" ? content : JSON.stringify(content),
            },
          },
        ],
      }),
    );
  };
}

async function atlasProposal(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(ATLAS_PROPOSAL, "utf8")) as Record<
    string,
    unknown
  >;
}

interface Setup {
  readonly root: string;
  readonly env: Record<string, string>;
}

async function atlasProject(mechanism = "handoff"): Promise<Setup> {
  const root = await tempDir();
  const config = await tempDir("anvilmark-host-");
  await writeHostConfig(config, [
    {
      id: "local-runtime",
      mechanism: "openai_compatible",
      base_url: `http://127.0.0.1:${port}/v1`,
      model: "local-model",
      reach: "local",
      cost: "no_provider_charge",
    },
    {
      id: "remote-api",
      mechanism: "openai_compatible",
      base_url: `http://127.0.0.1:${port}/v1`,
      model: "remote-model",
      reach: "remote",
      credential_env: "REMOTE_API_KEY",
      cost: "may_incur_cost",
    },
  ]);
  const env = { ANVILMARK_CONFIG_HOME: config, REMOTE_API_KEY: FAKE_KEY };
  const io = scriptedIo({ cwd: root, env });
  expect(
    await cli(
      ["init", "--from-contract", ATLAS, "--intelligence", mechanism],
      io,
    ),
  ).toBe(0);
  return { root, env };
}

async function contractAt(root: string): Promise<ProjectContract> {
  const parsed = parseProjectContract(await projectText(root), "yaml");
  if (!parsed.ok) throw new Error("invalid");
  return parsed.value;
}

/** Export a handoff request, write `response`, and import it. */
async function handoff(setup: Setup, response: unknown) {
  const exporting = scriptedIo({ cwd: setup.root, env: setup.env });
  expect(
    await cli(["propose", "export", "--task", "propose_candidates"], exporting),
  ).toBe(0);
  const requestId =
    /propose import (req-[A-Za-z0-9-]+)/.exec(exporting.out())?.[1] ?? "";
  const document = JSON.parse(
    await readFile(
      join(
        setup.root,
        ".anvilmark",
        "intelligence",
        "handoff",
        `${requestId}.request.json`,
      ),
      "utf8",
    ),
  ) as { request: unknown; response_file: string };
  await writeFile(
    join(setup.root, document.response_file),
    typeof response === "string" ? response : JSON.stringify(response),
  );
  const importing = scriptedIo({ cwd: setup.root, env: setup.env });
  const code = await cli(["propose", "import", requestId], importing);
  return { code, io: importing, request: document.request, requestId };
}

function withoutProvenance(contract: ProjectContract): unknown {
  const copy = structuredClone(contract) as unknown as {
    project: { updated_at: string };
    evidence_refs: {
      id: string;
      producer: unknown;
      observed_at: string;
      caveats: string[];
      source: unknown;
    }[];
    integrations: unknown[];
  };
  copy.project.updated_at = "normalized";
  copy.integrations = [];
  copy.evidence_refs = copy.evidence_refs.map((record, index) => ({
    ...record,
    id: `inference-${index}`,
    producer: "normalized",
    observed_at: "normalized",
    caveats: [],
    source: "normalized",
  }));
  return copy;
}

describe("two intelligence mechanisms, one request and response contract", () => {
  it("send the identical request and produce the same contract from the same proposal", async () => {
    const proposal = await atlasProposal();

    const viaFile = await atlasProject("handoff");
    const fileRun = await handoff(viaFile, proposal);
    expect(fileRun.code).toBe(0);

    const viaHttp = await atlasProject("local-runtime");
    respond = answerWith(proposal);
    const httpIo = scriptedIo({ cwd: viaHttp.root, env: viaHttp.env });
    // A handoff request is projected under the remote rules; so is this one,
    // to compare like with like.
    expect(
      await cli(
        [
          "propose",
          "send",
          "--task",
          "propose_candidates",
          "--via",
          "local-runtime",
        ],
        httpIo,
      ),
    ).toBe(0);
    expect(received).toHaveLength(1);
    const body = JSON.parse(received[0]?.body ?? "{}") as {
      messages: { content: string }[];
    };
    const sentRequest = JSON.parse(body.messages[1]?.content ?? "{}") as {
      task: string;
      instructions: string;
      protocol_version: string;
      projection: Record<string, unknown>;
    };
    const fileRequest = fileRun.request as typeof sentRequest;
    expect(sentRequest.task).toBe(fileRequest.task);
    expect(sentRequest.instructions).toBe(fileRequest.instructions);
    expect(sentRequest.protocol_version).toBe(fileRequest.protocol_version);
    // Same projection rules for the same policy; a local runtime additionally
    // receives only the disclosed local set, which this policy already allows.
    for (const key of Object.keys(fileRequest.projection)) {
      expect(sentRequest.projection[key]).toEqual(fileRequest.projection[key]);
    }

    const fromFile = await contractAt(viaFile.root);
    const fromHttp = await contractAt(viaHttp.root);
    expect(withoutProvenance(fromHttp)).toEqual(withoutProvenance(fromFile));
    // Provenance is kept, and differs honestly.
    expect(fromFile.evidence_refs[0]?.producer.name).toBe("handoff");
    expect(fromHttp.evidence_refs[0]?.producer.name).toBe("local-runtime");
    expect(
      fromFile.candidates.filter((entry) => entry.status === "discovered"),
    ).toHaveLength(2);
  });

  it("send a byte-identical request through the handoff file and a remote provider", async () => {
    const proposal = await atlasProposal();
    const viaFile = await atlasProject("handoff");
    const fileRun = await handoff(viaFile, proposal);
    expect(fileRun.code).toBe(0);

    const viaRemote = await atlasProject("remote-api");
    respond = answerWith(proposal);
    const io = scriptedIo({
      cwd: viaRemote.root,
      env: viaRemote.env,
      interactive: true,
      answers: ["y"],
    });
    expect(
      await cli(["propose", "send", "--task", "propose_candidates"], io),
    ).toBe(0);
    const body = JSON.parse(received[0]?.body ?? "{}") as {
      messages: { content: string }[];
    };
    expect(JSON.parse(body.messages[1]?.content ?? "{}")).toEqual(
      fileRun.request,
    );
    expect(withoutProvenance(await contractAt(viaRemote.root))).toEqual(
      withoutProvenance(await contractAt(viaFile.root)),
    );
  });

  it("works with no intelligence at all", async () => {
    const setup = await atlasProject("none");
    const io = scriptedIo({ cwd: setup.root, env: setup.env });
    expect(
      await cli(
        ["propose", "export", "--task", "clarify_intent", "--via", "none"],
        io,
      ),
    ).toBe(2);
    const send = scriptedIo({ cwd: setup.root, env: setup.env });
    expect(
      await cli(["propose", "send", "--task", "clarify_intent"], send),
    ).toBe(1);
    expect(send.err()).toContain("does not need one");
    const compare = scriptedIo({ cwd: setup.root, env: setup.env });
    expect(await cli(["compare"], compare)).toBe(0);
  });
});

describe("remote intelligence needs interactive consent to the exact request", () => {
  it("shows the disclosure and the exact payload, and sends nothing without a terminal", async () => {
    const setup = await atlasProject("remote-api");
    const before = await readTree(join(setup.root, ".anvilmark"));
    respond = answerWith(await atlasProposal());
    const io = scriptedIo({ cwd: setup.root, env: setup.env });
    expect(
      await cli(["propose", "send", "--task", "propose_candidates"], io),
    ).toBe(1);
    expect(io.out()).toContain("REMOTE provider");
    expect(io.out()).toContain("repository contents:   not included");
    expect(io.out()).toContain("evaluation rows:       not included");
    expect(io.out()).toContain("may cost money:        yes");
    expect(io.err()).toContain("needs consent in an interactive terminal");
    expect(received).toHaveLength(0);
    expect(await readTree(join(setup.root, ".anvilmark"))).toEqual(before);
  });

  it("sends nothing when the user declines, which is the default", async () => {
    const setup = await atlasProject("remote-api");
    const before = await readTree(join(setup.root, ".anvilmark"));
    for (const answer of ["", "n", null]) {
      const io = scriptedIo({
        cwd: setup.root,
        env: setup.env,
        interactive: true,
        answers: [answer],
      });
      expect(
        await cli(["propose", "send", "--task", "propose_candidates"], io),
      ).toBe(3);
      expect(io.out()).toContain("Exact request:");
      expect(io.prompts[0]).toContain("[y/N]");
    }
    expect(received).toHaveLength(0);
    expect(await readTree(join(setup.root, ".anvilmark"))).toEqual(before);
  });

  it("sends once after consent, and never stores or prints the credential", async () => {
    const setup = await atlasProject("remote-api");
    respond = answerWith(await atlasProposal());
    const io = scriptedIo({
      cwd: setup.root,
      env: setup.env,
      interactive: true,
      answers: ["y"],
    });
    expect(
      await cli(["propose", "send", "--task", "propose_candidates"], io),
    ).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0]?.headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
    const tree = JSON.stringify(await readTree(join(setup.root, ".anvilmark")));
    expect(tree).not.toContain(FAKE_KEY);
    expect(io.out() + io.err()).not.toContain(FAKE_KEY);
    // Consent is recorded as provenance of what was agreed to, not as approval.
    const history = join(setup.root, ".anvilmark", "history");
    const meta = JSON.parse(
      await readFile(join(history, "r000002.json"), "utf8"),
    ) as {
      provenance: { consent: { request_digest: string; destination: string } };
    };
    expect(meta.provenance.consent.destination).toBe(`127.0.0.1:${port}`);
    expect((await contractAt(setup.root)).approvals).toEqual([]);
  });

  it("leaves the previous valid state intact when the provider fails", async () => {
    const setup = await atlasProject("remote-api");
    const before = await projectText(setup.root);
    respond = (response) => {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("overloaded");
    };
    const io = scriptedIo({
      cwd: setup.root,
      env: setup.env,
      interactive: true,
      answers: ["y"],
    });
    expect(
      await cli(["propose", "send", "--task", "propose_candidates"], io),
    ).toBe(1);
    expect(io.err()).toContain("HTTP 503");
    expect(io.err()).toContain("The project is unchanged");
    expect(await projectText(setup.root)).toBe(before);
    const records = await readdir(
      join(setup.root, ".anvilmark", "intelligence", "proposals"),
    );
    expect(records).toHaveLength(1);
  });

  it("leaves state intact when the provider is unreachable or the credential is missing", async () => {
    const setup = await atlasProject("remote-api");
    const before = await projectText(setup.root);
    const io = scriptedIo({
      cwd: setup.root,
      env: { ANVILMARK_CONFIG_HOME: setup.env.ANVILMARK_CONFIG_HOME ?? "" },
      interactive: true,
      answers: ["y"],
    });
    expect(
      await cli(["propose", "send", "--task", "propose_candidates"], io),
    ).toBe(1);
    expect(io.err()).toContain("REMOTE_API_KEY is not set");
    expect(received).toHaveLength(0);
    expect(await projectText(setup.root)).toBe(before);
  });

  it("leaves state intact when the user cancels while waiting for the provider", async () => {
    const setup = await atlasProject("local-runtime");
    const before = await projectText(setup.root);
    const controller = new AbortController();
    respond = () => {
      // The provider never answers; the user presses Ctrl-C.
      setTimeout(() => controller.abort(), 50);
    };
    const io = scriptedIo({
      cwd: setup.root,
      env: setup.env,
      signal: controller.signal,
    });
    expect(await cli(["propose", "send", "--task", "clarify_intent"], io)).toBe(
      3,
    );
    expect(io.err()).toContain("cancelled");
    expect(await projectText(setup.root)).toBe(before);
  });

  it("previews without sending or writing anything", async () => {
    const setup = await atlasProject("remote-api");
    const before = await readTree(join(setup.root, ".anvilmark"));
    const io = scriptedIo({ cwd: setup.root, env: setup.env });
    expect(
      await cli(
        ["propose", "preview", "--task", "explain_tradeoffs", "--json"],
        io,
      ),
    ).toBe(0);
    const preview = JSON.parse(io.out()) as {
      disclosure: { consent_required: boolean };
    };
    expect(preview.disclosure.consent_required).toBe(true);
    expect(received).toHaveLength(0);
    expect(await readTree(join(setup.root, ".anvilmark"))).toEqual(before);
  });

  it("cannot be pointed at a provider the host did not register", async () => {
    const setup = await atlasProject("handoff");
    const file = join(setup.root, ".anvilmark", "project.yaml");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "adapter: handoff",
        "adapter: https://evil.example.com/v1",
      ),
    );
    const io = scriptedIo({
      cwd: setup.root,
      env: setup.env,
      interactive: true,
      answers: ["y"],
    });
    expect(await cli(["propose", "send", "--task", "clarify_intent"], io)).toBe(
      1,
    );
    expect(io.err()).toContain("is not a registered provider");
    expect(received).toHaveLength(0);
  });
});

describe("proposal protection", () => {
  async function rejected(response: unknown) {
    const setup = await atlasProject("handoff");
    const before = await projectText(setup.root);
    const run = await handoff(setup, response);
    expect(run.code).toBe(1);
    expect(await projectText(setup.root)).toBe(before);
    return { ...run, setup };
  }

  it("rejects a malformed response", async () => {
    const run = await rejected("{ this is not json");
    expect(run.io.err()).toContain("malformed_output");
  });

  it("rejects unknown fields", async () => {
    const proposal = await atlasProposal();
    const run = await rejected({
      ...proposal,
      architecture_elements: [{ id: "x" }],
    });
    expect(run.io.err()).toContain("forbidden_proposal");
    expect(run.io.err()).toContain("architecture_elements");
  });

  it("rejects references to subjects that do not exist", async () => {
    const proposal = await atlasProposal();
    const candidates = proposal.proposed_candidates as Record<
      string,
      unknown
    >[];
    const run = await rejected({
      ...proposal,
      proposed_candidates: [
        { ...candidates[0], workload_ref: "no_such_workload" },
      ],
    });
    expect(run.io.err()).toContain("reference_not_found");
  });

  it("rejects redefining, and so weakening, a hard constraint", async () => {
    const proposal = await atlasProposal();
    const run = await rejected({
      ...proposal,
      proposed_constraints: [
        {
          id: "quality.classification_f1",
          domain: "quality",
          severity: "soft",
          direction: "maximize",
          subject: "workload.classification.metric.macro_f1",
          operator: "gte",
          value: 0.5,
          source: "agent_proposed",
          rationale: "Relax the gate",
        },
      ],
    });
    expect(run.io.err()).toContain("may not redefine the hard constraint");
    expect(
      (await contractAt(run.setup.root)).constraints.find(
        (c) => c.id === "quality.classification_f1",
      ),
    ).toMatchObject({ severity: "hard", value: 0.9 });
  });

  it("rejects replacing an existing soft constraint or candidate", async () => {
    const proposal = await atlasProposal();
    const run = await rejected({
      ...proposal,
      proposed_constraints: [
        {
          id: "budget.ai_monthly",
          domain: "cost",
          severity: "soft",
          direction: "minimize",
          subject: "project.ai_effective_cost_monthly_usd",
          operator: "lte",
          value: 100000,
          source: "agent_proposed",
          rationale: null,
        },
      ],
    });
    expect(run.io.err()).toContain("overwrite_refused");
  });

  it("rejects creating an exception", async () => {
    const proposal = await atlasProposal();
    const constraints = proposal.proposed_constraints as Record<
      string,
      unknown
    >[];
    const run = await rejected({
      ...proposal,
      proposed_constraints: [
        {
          ...constraints[0],
          exceptions: [
            {
              id: "x",
              reason: "agent says so",
              approved_by: "agent",
              review_at: "2027-01-01T00:00:00Z",
            },
          ],
        },
      ],
    });
    expect(run.io.err()).toContain("exceptions");
  });

  it("rejects an inference labelled as a measurement", async () => {
    const proposal = await atlasProposal();
    const run = await rejected({
      ...proposal,
      inferences: [
        {
          subject: "quality",
          claim: "macro F1 is 0.97",
          kind: "measured_evaluation",
          confidence: "high",
          caveats: [],
        },
      ],
    });
    expect(run.io.err()).toContain("schema_rejected");
  });

  it("rejects measurements, results or statuses that would turn missing evidence into a pass", async () => {
    const proposal = await atlasProposal();
    const candidates = proposal.proposed_candidates as Record<
      string,
      unknown
    >[];
    for (const extra of [
      {
        constraint_results: [
          { constraint_ref: "latency.drafting_p95", status: "pass" },
        ],
      },
      { measurements: { latency_measurement_ref: "evidence.fake" } },
      { status: "viable" },
    ]) {
      const run = await rejected({
        ...proposal,
        proposed_candidates: [{ ...candidates[0], ...extra }],
      });
      expect(run.io.err()).toContain("forbidden_proposal");
    }
  });

  it("rejects a constraint claimed as a user declaration", async () => {
    const proposal = await atlasProposal();
    const constraints = proposal.proposed_constraints as Record<
      string,
      unknown
    >[];
    const run = await rejected({
      ...proposal,
      proposed_constraints: [{ ...constraints[0], source: "user" }],
    });
    expect(run.io.err()).toContain("schema_rejected");
  });

  it("rejects approvals and decisions", async () => {
    const proposal = await atlasProposal();
    const run = await rejected({ ...proposal, approvals: [], decisions: [] });
    expect(run.io.err()).toContain("adapters propose, they do not decide");
  });

  it("rejects a secret without storing it anywhere", async () => {
    const proposal = await atlasProposal();
    const run = await rejected({
      ...proposal,
      questions: [`Use key ${FAKE_KEY}?`],
    });
    expect(run.io.err()).toContain("secret_detected");
    expect(run.io.err()).toContain(
      "the response file your agent wrote still contains a secret-shaped value",
    );
    // Only the agent's own response file holds it; nothing ANVILMARK wrote does.
    const tree = await readTree(join(run.setup.root, ".anvilmark"));
    const holding = Object.entries(tree)
      .filter(([, text]) => text.includes(FAKE_KEY))
      .map(([path]) => path);
    expect(holding).toEqual([
      `intelligence/handoff/${run.requestId}.response.json`,
    ]);
    expect(run.io.out() + run.io.err()).not.toContain(FAKE_KEY);
  });

  it("records generated inferences as T0 evidence that cannot satisfy anything", async () => {
    const setup = await atlasProject("handoff");
    const run = await handoff(setup, await atlasProposal());
    expect(run.code).toBe(0);
    const contract = await contractAt(setup.root);
    const inference = contract.evidence_refs.find(
      (record) => record.kind === "agent_inference",
    );
    expect(inference?.applies_to.constraint_refs).toEqual([]);
    expect(inference?.caveats.join(" ")).toContain(
      "never sufficient for any evidence floor",
    );
    expect(
      contract.constraints.find(
        (entry) => entry.id === "privacy.redacted_ticket_via_redactor",
      )?.source,
    ).toBe("agent_proposed");

    // Citing it for a pass is refused by the contract's evidence floors.
    const before = await projectText(setup.root);
    const io = scriptedIo({ cwd: setup.root, env: setup.env });
    expect(
      await cli(
        [
          "candidate",
          "result",
          "candidate.response_drafting.local_first",
          "--constraint",
          "latency.drafting_p95",
          "--status",
          "pass",
          "--evidence",
          inference?.id ?? "",
        ],
        io,
      ),
    ).toBe(1);
    // An inference names no constraint, so it is not admissible for one at all.
    expect(io.err()).toContain("evidence_not_applicable");
    expect(io.err()).toContain(inference?.id ?? "");
    expect(await projectText(setup.root)).toBe(before);
  });

  it("refuses a response exported for another request", async () => {
    const setup = await atlasProject("handoff");
    const first = await handoff(setup, await atlasProposal());
    expect(first.code).toBe(0);
    const record = join(
      setup.root,
      ".anvilmark",
      "intelligence",
      "requests",
      `${first.requestId}.json`,
    );
    const tampered = JSON.parse(await readFile(record, "utf8")) as {
      request: { task: string };
    };
    tampered.request.task = "clarify_intent";
    await writeFile(record, JSON.stringify(tampered));
    const io = scriptedIo({ cwd: setup.root, env: setup.env });
    expect(await cli(["propose", "import", first.requestId], io)).toBe(1);
    expect(io.err()).toContain("identity_mismatch");
  });
});
