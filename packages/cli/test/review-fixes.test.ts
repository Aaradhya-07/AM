import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import type {
  ProjectContract,
  ResolvedApprovalContent,
} from "@anvilmark/project-contract";
import {
  hashApprovalContent,
  parseProjectContract,
} from "@anvilmark/project-contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { renderReview } from "../src/render.js";
import type { StoreFs } from "../src/store.js";
import {
  draftDecision,
  proposeDecision,
  reviewDecision,
} from "../src/workflow/decisions.js";
import { newProjectContract } from "../src/workflow/edit.js";
import { applyProposal } from "../src/workflow/proposal.js";
import { nodeStoreFs } from "../src/store.js";
import {
  cleanup,
  cli,
  projectText,
  readTree,
  scriptedIo,
  tempDir,
  writeHostConfig,
} from "./helpers.js";

/**
 * Regressions for the independent review of 4484049 (R1–R4). Each asserts the
 * corrected behaviour; the reviewer's probes asserted the defects.
 */

afterEach(cleanup);

async function ok(root: string, argv: readonly string[], env = {}) {
  const io = scriptedIo({ cwd: root, env });
  const code = await cli(argv, io);
  expect({ argv, code, err: io.err() }).toEqual({ argv, code: 0, err: "" });
  return io;
}

async function contractAt(root: string): Promise<ProjectContract> {
  const parsed = parseProjectContract(await projectText(root), "yaml");
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

const HASH_LINE = /Approval hash \(sha-256\):\n\s+([0-9a-f]{64})/;

function hashIn(output: string): string {
  const hash = HASH_LINE.exec(output)?.[1];
  if (hash === undefined) throw new Error("no approval hash in output");
  return hash;
}

/** The exact approval JSON printed between the covered-content markers. */
function exactContentIn(output: string): ResolvedApprovalContent {
  const start = output.indexOf("Exact approval content");
  const end = output.indexOf("==== End of covered content ====");
  const block = output.slice(output.indexOf("\n", start) + 1, end);
  return JSON.parse(block) as ResolvedApprovalContent;
}

/** A proposed project-scope decision selecting one local model candidate. */
async function modelProject(model: {
  readonly version: string;
  readonly mutability: "pinned" | "floating";
  readonly quantization: string;
}): Promise<string> {
  const root = await tempDir();
  await ok(root, [
    "init",
    "--idea",
    "Evaluate a local model",
    "--name",
    "Review",
  ]);
  await ok(root, [
    "candidate",
    "add",
    "--id",
    "candidate.local",
    "--component-kind",
    "model_runtime",
    "--mode",
    "local",
    "--runtime",
    "ollama",
    "--model",
    "example-model",
    "--model-version",
    model.version,
    "--model-mutability",
    model.mutability,
    "--quantization",
    model.quantization,
  ]);
  await ok(root, [
    "decision",
    "draft",
    "--id",
    "decision.local",
    "--project",
    "--select",
    "candidate.local",
    "--rationale",
    "Review model quantization.",
  ]);
  await ok(root, ["decision", "propose", "decision.local"]);
  return root;
}

describe("R1: the approval flow shows the content the hash covers", () => {
  it("makes a quantization difference visible, not only a different hash", async () => {
    const q4 = await modelProject({
      version: "v1",
      mutability: "pinned",
      quantization: "Q4_K_M",
    });
    const q8 = await modelProject({
      version: "v1",
      mutability: "pinned",
      quantization: "Q8_0",
    });
    const review4 = (await ok(q4, ["review", "decision.local"])).out();
    const review8 = (await ok(q8, ["review", "decision.local"])).out();

    const hash4 = hashIn(review4);
    const hash8 = hashIn(review8);
    expect(hash4).not.toBe(hash8);
    const text4 = review4.replaceAll(hash4, "<hash>");
    const text8 = review8.replaceAll(hash8, "<hash>");
    expect(text4).not.toBe(text8);
    expect(review4).toContain("quantization Q4_K_M");
    expect(review8).toContain("quantization Q8_0");
    expect(review4).not.toContain("Q8_0");

    const differing = text4
      .split("\n")
      .filter((line, index) => line !== text8.split("\n")[index]);
    // The readable candidate line, the comparison line and the exact JSON all differ.
    expect(differing.length).toBeGreaterThanOrEqual(3);
    expect(differing.join("\n")).toContain('"quantization": "Q4_K_M"');
  });

  it("renders different reviews for decisions that differ only in quantization (workflow API)", () => {
    // Mirrors the reviewer's probe on the same public workflow functions, but
    // asserts the corrected behaviour.
    const now = "2026-09-13T10:00:00.000Z";
    const initial = newProjectContract({
      id: "review",
      name: "Review",
      idea: "Evaluate a local model",
      repositoryRoots: [],
      intelligence: "handoff",
      remoteIntelligence: "public_projection",
      now,
    });
    const applied = applyProposal(
      initial,
      {
        protocol_version: "0.1.0-draft.1",
        proposed_candidates: [
          {
            id: "candidate.local",
            workload_ref: null,
            component_kind: "model_runtime",
            model_family: "example-model",
            model_version: "v1",
            deployment_mode: "local",
            provider: null,
            rationale: null,
          },
        ],
      },
      {
        proposalId: "review",
        adapterId: "handoff",
        receivedAt: now,
        sourceType: "file",
      },
    );
    if (!applied.ok) throw new Error(JSON.stringify(applied.problems));
    const draft = draftDecision(
      applied.value.contract,
      {
        id: "decision.local",
        scope: { kind: "project" },
        selectedCandidate: "candidate.local",
        alternatives: [],
        satisfies: [],
        unresolved: [],
        evidence: [],
        rationale: {
          summary: "Review model quantization.",
          generated_by: null,
        },
      },
      now,
    );
    const first = proposeDecision(draft, "decision.local", now);
    const second = structuredClone(first);
    const firstModel = first.candidates[0]?.model;
    const secondModel = second.candidates[0]?.model;
    if (firstModel == null || secondModel == null) throw new Error("no model");
    firstModel.quantization = "Q4_K_M";
    secondModel.quantization = "Q8_0";
    const review1 = reviewDecision(first, "decision.local", now);
    const review2 = reviewDecision(second, "decision.local", now);
    const display1 = renderReview(review1);
    const display2 = renderReview(review2);
    expect(review1.approval_hash).not.toBe(review2.approval_hash);
    expect(display1.replace(review1.approval_hash ?? "", "<hash>")).not.toBe(
      display2.replace(review2.approval_hash ?? "", "<hash>"),
    );
    expect(display1).toContain("Q4_K_M");
    expect(display2).toContain("Q8_0");
  });

  it("prints the exact hashed payload before asking for confirmation", async () => {
    const root = await modelProject({
      version: "v1",
      mutability: "pinned",
      quantization: "Q8_0",
    });
    let shownBeforeConfirmation = "";
    const io = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [
        "reviewer",
        async () => {
          shownBeforeConfirmation = io.out();
          return "";
        },
      ],
    });
    expect(await cli(["approve", "decision.local"], io)).toBe(3);
    expect(shownBeforeConfirmation).toContain(
      "version_mutability pinned, quantization Q8_0",
    );

    const hash = hashIn(shownBeforeConfirmation);
    const exact = exactContentIn(shownBeforeConfirmation);
    // What was displayed is exactly what the hash covers.
    expect(hashApprovalContent(exact)).toBe(hash);
    expect(exact.selected_candidate.model?.quantization).toBe("Q8_0");
    expect((await contractAt(root)).approvals).toEqual([]);
  });

  it("still refuses when a covered field changes between display and confirmation", async () => {
    const root = await modelProject({
      version: "v1",
      mutability: "pinned",
      quantization: "Q4_K_M",
    });
    const io = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [
        "reviewer",
        async () => {
          const hash = hashIn(io.out());
          await cli(
            ["candidate", "model", "candidate.local", "--quantization", "Q8_0"],
            scriptedIo({ cwd: root }),
          );
          return hash.slice(0, 12);
        },
      ],
    });
    expect(await cli(["approve", "decision.local"], io)).toBe(1);
    expect(io.err()).toContain("changed while you were reviewing");
    expect((await contractAt(root)).approvals).toEqual([]);
  });

  it("shows cited evidence in full, including caveats and value", async () => {
    const root = await tempDir();
    await ok(root, [
      "init",
      "--idea",
      "Evaluate a managed model",
      "--name",
      "Review",
    ]);
    await ok(root, [
      "constraint",
      "add",
      "--id",
      "budget.monthly",
      "--domain",
      "cost",
      "--severity",
      "soft",
      "--direction",
      "minimize",
      "--subject",
      "project.ai_effective_cost_monthly_usd",
      "--operator",
      "lte",
      "--value",
      "750",
    ]);
    await ok(root, [
      "candidate",
      "add",
      "--id",
      "candidate.managed",
      "--component-kind",
      "model_runtime",
      "--mode",
      "managed_api",
      "--provider",
      "example-provider",
      "--region",
      "eu-west",
    ]);
    const pricing = join(root, "pricing.json");
    await writeFile(
      pricing,
      JSON.stringify({
        id: "evidence.pricing.managed",
        subject: "pricing",
        claim: "Published input-token price",
        exact_subject: "example-managed-model",
        source: {
          publisher: "Example Provider",
          locator: "https://provider.example/pricing",
          retrieved_at: "2026-09-01T00:00:00Z",
        },
        applies_to: {
          candidate_ref: "candidate.managed",
          workload_ref: null,
          hardware_ref: null,
          constraint_refs: ["budget.monthly"],
        },
        currency: "USD",
        unit: "1M input tokens",
        amount: 1.5,
        caveats: ["Excludes batch discounts"],
      }),
    );
    await ok(root, ["evidence", "import", pricing]);
    await ok(root, [
      "decision",
      "draft",
      "--id",
      "decision.managed",
      "--project",
      "--select",
      "candidate.managed",
      "--evidence",
      "evidence.pricing.managed",
      "--rationale",
      "Managed first.",
    ]);
    await ok(root, ["decision", "propose", "decision.managed"]);
    const out = (await ok(root, ["review", "decision.managed"])).out();
    const covered = out.slice(
      out.indexOf("==== Content covered by the approval hash ===="),
    );
    expect(covered).toContain(
      "evidence.pricing.managed: official_pricing, tier T2, confidence high",
    );
    expect(covered).toContain("caveats: Excludes batch discounts");
    expect(covered).toContain('"amount":1.5');
    expect(covered).toContain("source url https://provider.example/pricing");
    expect(covered).toContain(
      "deployment: mode managed_api, provider example-provider, region eu-west",
    );
  });
});

describe("R2: proposal records agree with committed history", () => {
  const PROPOSAL = {
    protocol_version: "0.1.0-draft.1",
    proposed_candidates: [
      {
        id: "candidate.suggested",
        workload_ref: null,
        component_kind: "model_runtime",
        model_family: null,
        model_version: null,
        deployment_mode: "local",
        provider: null,
        rationale: "Suggested local option.",
      },
    ],
    questions: ["Which language should tickets use?"],
    rationale: {
      summary: "Adds one option and one question.",
      generated_by: "fixture",
    },
  };

  async function exported(
    response: unknown,
  ): Promise<{ root: string; requestId: string }> {
    const root = await tempDir();
    await ok(root, [
      "init",
      "--idea",
      "Classify support tickets",
      "--intelligence",
      "handoff",
    ]);
    const out = (
      await ok(root, ["propose", "export", "--task", "clarify_intent"])
    ).out();
    const requestId = /propose import (req-[A-Za-z0-9-]+)/.exec(out)?.[1] ?? "";
    await writeFile(
      join(
        root,
        ".anvilmark",
        "intelligence",
        "handoff",
        `${requestId}.response.json`,
      ),
      JSON.stringify(response),
    );
    return { root, requestId };
  }

  const blockRecords = (root: string) =>
    writeFile(
      join(root, ".anvilmark", "intelligence", "proposals"),
      "a regular file where the records directory should be",
    );

  async function headProvenance(root: string) {
    const history = join(root, ".anvilmark", "history");
    const metas = (await readdir(history))
      .filter((name) => name.endsWith(".json"))
      .sort();
    return JSON.parse(
      await readFile(join(history, metas[metas.length - 1] ?? ""), "utf8"),
    ) as {
      revision: number;
      provenance: { record?: { outcome: string; proposal_id: string } } | null;
    };
  }

  it("commits an accepted proposal with its record even when the records directory is unusable", async () => {
    const { root, requestId } = await exported(PROPOSAL);
    await blockRecords(root);
    const io = scriptedIo({ cwd: root });
    expect(await cli(["propose", "import", requestId], io)).toBe(0);
    expect(io.err()).toBe("");
    expect((await contractAt(root)).intent.unresolved_questions).toEqual([
      "Which language should tickets use?",
    ]);
    const head = await headProvenance(root);
    expect(head.revision).toBe(2);
    expect(head.provenance?.record?.outcome).toBe("applied");
    const proposalId = head.provenance?.record?.proposal_id ?? "";

    // The committed record is what later commands rely on.
    await ok(root, [
      "decision",
      "draft",
      "--id",
      "decision.suggested",
      "--project",
      "--select",
      "candidate.suggested",
      "--rationale-from-proposal",
      proposalId,
    ]);
    expect(
      (await contractAt(root)).decisions[0]?.rationale.generated_by,
    ).toContain(proposalId);
  });

  it("keeps the project byte for byte when a refusal cannot be recorded, and says so", async () => {
    const { root, requestId } = await exported({ ...PROPOSAL, approvals: [] });
    await blockRecords(root);
    const before = await projectText(root);
    const io = scriptedIo({ cwd: root });
    expect(await cli(["propose", "import", requestId], io)).toBe(1);
    expect(io.err()).toContain("forbidden_proposal");
    expect(io.err()).toContain("could not be recorded");
    expect(io.err()).toContain("the project is still unchanged");
    expect(await projectText(root)).toBe(before);
  });

  it("creates no accepted record when project.yaml cannot be replaced", async () => {
    const { root, requestId } = await exported(PROPOSAL);
    const before = await projectText(root);
    const failing: StoreFs = {
      writeExclusive: nodeStoreFs.writeExclusive,
      replace: async () => {
        throw new Error("simulated rename failure");
      },
    };
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(["propose", "import", requestId], io, { storeFs: failing }),
    ).toBe(1);
    expect(io.out()).not.toContain("Saved state revision");
    expect(io.err()).toContain(
      "could not be committed. The project is unchanged.",
    );
    expect(await projectText(root)).toBe(before);

    const records = await readdir(
      join(root, ".anvilmark", "intelligence", "proposals"),
    );
    expect(records).toHaveLength(1);
    const record = JSON.parse(
      await readFile(
        join(root, ".anvilmark", "intelligence", "proposals", records[0] ?? ""),
        "utf8",
      ),
    ) as { outcome: string; proposal_id: string };
    expect(record.outcome).toBe("not_committed");
    expect(
      JSON.stringify(await readTree(join(root, ".anvilmark"))),
    ).not.toContain('"accepted"');

    // The interrupted snapshot is not on the chain, so the proposal is not accepted.
    const history = (await ok(root, ["history"])).out();
    expect(history).toContain(
      "1 snapshot(s) are not part of the committed history",
    );
    expect(history).toMatch(/r2 abandoned: /);
    await ok(root, [
      "candidate",
      "add",
      "--id",
      "candidate.user",
      "--component-kind",
      "model_runtime",
      "--mode",
      "local",
    ]);
    const refused = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "decision",
          "draft",
          "--id",
          "d",
          "--project",
          "--select",
          "candidate.user",
          "--rationale-from-proposal",
          record.proposal_id,
        ],
        refused,
      ),
    ).toBe(1);
    expect(refused.err()).toContain(
      "not an accepted proposal in this project's committed history",
    );
  });

  it("creates no history and no accepted record when the snapshot cannot be written", async () => {
    const { root, requestId } = await exported(PROPOSAL);
    const before = await projectText(root);
    const historyBefore = await readdir(join(root, ".anvilmark", "history"));
    const failing: StoreFs = {
      writeExclusive: async (path, text) => {
        if (path.includes(`${sep}history${sep}`)) {
          throw new Error("simulated full disk");
        }
        await nodeStoreFs.writeExclusive(path, text);
      },
      replace: nodeStoreFs.replace,
    };
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(["propose", "import", requestId], io, { storeFs: failing }),
    ).toBe(1);
    expect(await projectText(root)).toBe(before);
    expect(await readdir(join(root, ".anvilmark", "history"))).toEqual(
      historyBefore,
    );
    const records = await readdir(
      join(root, ".anvilmark", "intelligence", "proposals"),
    );
    const record = JSON.parse(
      await readFile(
        join(root, ".anvilmark", "intelligence", "proposals", records[0] ?? ""),
        "utf8",
      ),
    ) as { outcome: string };
    expect(record.outcome).toBe("not_committed");
  });
});

describe("R3: model mutability is stated, never inferred from a version string", () => {
  it("records generated references as floating, however specific their version looks", async () => {
    const root = await tempDir();
    await ok(root, [
      "init",
      "--idea",
      "Evaluate local models",
      "--intelligence",
      "handoff",
    ]);
    const out = (
      await ok(root, ["propose", "export", "--task", "propose_candidates"])
    ).out();
    const requestId = /propose import (req-[A-Za-z0-9-]+)/.exec(out)?.[1] ?? "";
    const candidate = (id: string, version: string, rationale: string) => ({
      id,
      workload_ref: null,
      component_kind: "model_runtime",
      model_family: "example-model",
      model_version: version,
      deployment_mode: "local",
      provider: null,
      rationale,
    });
    await writeFile(
      join(
        root,
        ".anvilmark",
        "intelligence",
        "handoff",
        `${requestId}.response.json`,
      ),
      JSON.stringify({
        protocol_version: "0.1.0-draft.1",
        proposed_candidates: [
          candidate(
            "candidate.alias",
            "latest",
            "Use the floating latest tag for this experiment.",
          ),
          candidate("candidate.dated", "2026-05-01", "A dated release."),
        ],
      }),
    );
    await ok(root, ["propose", "import", requestId]);
    const models = (await contractAt(root)).candidates.map((entry) => [
      entry.id,
      entry.model?.version,
      entry.model?.version_mutability,
    ]);
    expect(models).toEqual([
      ["candidate.alias", "latest", "floating"],
      ["candidate.dated", "2026-05-01", "floating"],
    ]);

    const compare = (await ok(root, ["compare"])).out();
    expect(compare).toContain("model example-model@latest [floating]");

    await ok(root, [
      "decision",
      "draft",
      "--id",
      "decision.alias",
      "--project",
      "--select",
      "candidate.alias",
      "--rationale",
      "Try the alias.",
    ]);
    await ok(root, ["decision", "propose", "decision.alias"]);
    const review = (await ok(root, ["review", "decision.alias"])).out();
    expect(review).toContain("version latest, version_mutability floating");
    expect(review).toContain(
      'WARNING: the model reference is floating ("latest")',
    );
    expect(review).toContain(
      "generated rationale (not evidence): Use the floating latest tag for this experiment.",
    );

    // The user can confirm a pinned identity explicitly after checking it.
    await ok(root, [
      "candidate",
      "model",
      "candidate.dated",
      "--model-mutability",
      "pinned",
    ]);
    expect(
      (await contractAt(root)).candidates.find(
        (entry) => entry.id === "candidate.dated",
      )?.model?.version_mutability,
    ).toBe("pinned");
    // A new version does not inherit "pinned".
    const before = await projectText(root);
    const refused = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "candidate",
          "model",
          "candidate.dated",
          "--model-version",
          "2026-06-01",
        ],
        refused,
      ),
    ).toBe(1);
    expect(refused.err()).toContain(
      "--model-mutability pinned|floating must be stated again",
    );
    expect(await projectText(root)).toBe(before);
  });

  it("requires an explicit choice when a version is typed", async () => {
    const root = await tempDir();
    await ok(root, ["init", "--idea", "Evaluate local models"]);
    const before = await projectText(root);
    const base = [
      "candidate",
      "add",
      "--component-kind",
      "model_runtime",
      "--mode",
      "local",
      "--model",
      "example-model",
    ];

    const missing = scriptedIo({ cwd: root });
    expect(
      await cli([...base, "--id", "a", "--model-version", "8b"], missing),
    ).toBe(2);
    expect(missing.err()).toContain("needs --model-mutability pinned|floating");
    const pinnedWithoutVersion = scriptedIo({ cwd: root });
    expect(
      await cli(
        [...base, "--id", "b", "--model-mutability", "pinned"],
        pinnedWithoutVersion,
      ),
    ).toBe(2);
    expect(await projectText(root)).toBe(before);

    const floating = await ok(root, [
      ...base,
      "--id",
      "c",
      "--model-version",
      "latest",
      "--model-mutability",
      "floating",
    ]);
    expect(floating.out()).toContain(
      'version "latest" is recorded as floating',
    );
    await ok(root, [
      ...base,
      "--id",
      "d",
      "--model-version",
      "sha256-abc123",
      "--model-mutability",
      "pinned",
    ]);
    expect(
      (await contractAt(root)).candidates.map(
        (entry) => entry.model?.version_mutability,
      ),
    ).toEqual(["floating", "pinned"]);
  });
});

describe("R4: a malformed provider envelope follows the failure-record path", () => {
  let server: ReturnType<typeof createServer>;
  let port = 0;
  let respond: (response: ServerResponse) => void = () => {};

  beforeAll(async () => {
    server = createServer((request, response) => {
      request.resume();
      request.on("end", () => respond(response));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("records JSON null as malformed_output and leaves the project unchanged", async () => {
    const root = await tempDir();
    const config = await tempDir("anvilmark-host-");
    await writeHostConfig(config, [
      {
        id: "local-runtime",
        mechanism: "openai_compatible",
        base_url: `http://127.0.0.1:${port}/v1`,
        model: "local-model",
        reach: "local",
      },
    ]);
    const env = { ANVILMARK_CONFIG_HOME: config };
    await ok(
      root,
      ["init", "--idea", "Classify tickets", "--intelligence", "local-runtime"],
      env,
    );
    const before = await projectText(root);
    respond = (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("null");
    };
    const io = scriptedIo({ cwd: root, env });
    expect(await cli(["propose", "send", "--task", "clarify_intent"], io)).toBe(
      1,
    );
    expect(io.err()).toContain("[malformed_output]");
    expect(io.err()).toContain(
      "Recorded in .anvilmark/intelligence/proposals/",
    );
    expect(io.err()).not.toContain("TypeError");
    expect(await projectText(root)).toBe(before);
    const records = await readdir(
      join(root, ".anvilmark", "intelligence", "proposals"),
    );
    const record = JSON.parse(
      await readFile(
        join(root, ".anvilmark", "intelligence", "proposals", records[0] ?? ""),
        "utf8",
      ),
    ) as { outcome: string; problems: { code: string }[] };
    expect(record.outcome).toBe("not_accepted");
    expect(record.problems[0]?.code).toBe("malformed_output");
  });
});
