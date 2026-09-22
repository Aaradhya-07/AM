import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProjectContract } from "@anvilmark/project-contract";
import {
  architectureContentHash,
  confirmationStanding,
  parseProjectContract,
  toNormalizedYaml,
} from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import type { StoreFs } from "../src/store.js";
import { loadProject, nodeStoreFs } from "../src/store.js";
import {
  REPO_ROOT,
  approvedProject,
  cleanup,
  cli,
  projectText,
  readTree,
  scriptedIo,
  tempDir,
} from "./helpers.js";

/**
 * Amendments 8 and 9 through the CLI: attributable proposal import,
 * interactive confirmation checked against committed history, invalidation,
 * and declared interfaces. Interactive input is simulated; nothing here is a
 * real project decision.
 */

afterEach(cleanup);

const ATLAS_PROPOSAL = join(
  REPO_ROOT,
  "docs/vnext/fixtures/atlas-architecture-proposal.json",
);

async function ok(root: string, argv: readonly string[]) {
  const io = scriptedIo({ cwd: root });
  const code = await cli(argv, io);
  expect({ argv, code, err: io.err() }).toEqual({ argv, code: 0, err: "" });
  return io;
}

async function contractAt(root: string): Promise<ProjectContract> {
  const parsed = parseProjectContract(await projectText(root), "yaml");
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

async function historyNames(root: string): Promise<string[]> {
  return (await readdir(join(root, ".anvilmark", "history"))).sort();
}

/** Atlas with handoff selected. */
async function atlasWithHandoff(): Promise<string> {
  const root = await tempDir();
  await ok(root, [
    "init",
    "--from-contract",
    join(REPO_ROOT, "docs/vnext/fixtures/atlas-project.draft.yaml"),
    "--intelligence",
    "handoff",
  ]);
  return root;
}

/** Export a propose_architecture request and write RESPONSE as its answer. */
async function exportWith(root: string, response: unknown): Promise<string> {
  const out = (
    await ok(root, ["propose", "export", "--task", "propose_architecture"])
  ).out();
  const requestId = /propose import (req-[A-Za-z0-9-]+)/.exec(out)?.[1] ?? "";
  expect(requestId).not.toBe("");
  const request = JSON.parse(
    await readFile(
      join(
        root,
        ".anvilmark",
        "intelligence",
        "handoff",
        `${requestId}.request.json`,
      ),
      "utf8",
    ).catch(async () =>
      readFile(
        join(
          root,
          ".anvilmark",
          "intelligence",
          "requests",
          `${requestId}.json`,
        ),
        "utf8",
      ),
    ),
  );
  expect(JSON.stringify(request)).toContain("0.1.0-draft.2");
  await writeFile(
    join(
      root,
      ".anvilmark",
      "intelligence",
      "handoff",
      `${requestId}.response.json`,
    ),
    typeof response === "string" ? response : JSON.stringify(response),
  );
  return requestId;
}

async function importProposal(
  root: string,
  response: unknown,
  storeFs?: StoreFs,
) {
  const requestId = await exportWith(root, response);
  const io = scriptedIo({ cwd: root });
  const code = await cli(
    ["propose", "import", requestId],
    io,
    storeFs === undefined ? {} : { storeFs },
  );
  return { code, out: io.out(), err: io.err() };
}

async function atlasProposal(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(ATLAS_PROPOSAL, "utf8"));
}

/** Interactive confirmation with a scripted answer; returns output and code. */
async function confirm(
  root: string,
  target: [string, string],
  answer: (hash: string) => string | null = (hash) => hash.slice(0, 12),
  interactive = true,
) {
  let shown = "";
  const io = scriptedIo({
    cwd: root,
    interactive,
    answers: [
      async () => {
        const hash = /content hash \(sha-256\): ([0-9a-f]{64})/.exec(
          shown,
        )?.[1];
        return hash === undefined ? null : answer(hash);
      },
    ],
  });
  const originalStdout = io.stdout;
  const wrapped = {
    ...io,
    stdout: (text: string) => {
      shown += text;
      originalStdout(text);
    },
  };
  const code = await cli(
    ["architecture", "confirm", ...target],
    wrapped as typeof io,
  );
  return { code, out: io.out(), err: io.err() };
}

describe("importing a draft.2 architecture proposal", () => {
  it("adds agent-proposed, unconfirmed elements with the proposal record in one revision", async () => {
    const root = await atlasWithHandoff();
    const result = await importProposal(root, await atlasProposal());
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain(
      "architecture nodes (agent-proposed, unconfirmed): response-drafter, knowledge-index",
    );
    expect(result.out).toContain(
      "anvilmark architecture confirm node|relationship|binding REF",
    );

    const contract = await contractAt(root);
    const drafter = contract.architecture.nodes.find(
      (node) => node.id === "response-drafter",
    )!;
    expect(drafter.origin.kind).toBe("agent_proposed");
    expect(drafter.origin.confirmed_at).toBeNull();
    expect(drafter.interfaces).toEqual([]);
    const proposalId = drafter.origin.proposal_ref!;
    expect(proposalId).toMatch(/^prop-/);
    expect(
      contract.architecture.relationships
        .filter((entry) => entry.origin.kind === "agent_proposed")
        .map((entry) => [entry.id, entry.origin.proposal_ref]),
    ).toEqual([
      ["classifier-to-drafter", proposalId],
      ["drafter-reads-index", proposalId],
      ["drafter-to-remote-model", proposalId],
    ]);
    // Existing Atlas elements are untouched and user-declared.
    expect(
      contract.architecture.nodes
        .filter((node) => node.origin.kind === "user")
        .map((node) => node.id),
    ).toEqual([
      "ticket-intake",
      "pii-redactor",
      "ticket-classifier",
      "remote-model-provider",
    ]);

    const loaded = await loadProject(root);
    const entry = loaded.history.committed.at(-1)!;
    const record = (entry.provenance as { record: Record<string, unknown> })
      .record;
    expect(record).toMatchObject({
      outcome: "applied",
      proposal_id: proposalId,
      added: {
        architecture_nodes: ["response-drafter", "knowledge-index"],
        relationships: [
          "classifier-to-drafter",
          "drafter-reads-index",
          "drafter-to-remote-model",
        ],
        decision_bindings: [],
      },
    });

    const show = await ok(root, ["architecture", "show"]);
    expect(show.out()).toContain(
      `origin:      agent-proposed (proposal ${proposalId}), UNCONFIRMED; inferred`,
    );
    expect(show.out()).toContain(
      "crossing UNKNOWN (declared local -> remote_provider)",
    );
    expect(
      (await ok(root, ["generate", "--as-of", "2026-09-14T00:00:00Z"])).out(),
    ).toContain("Generated 4 file(s)");
    const view = await readFile(
      join(root, ".anvilmark/architecture/view.mmd"),
      "utf8",
    );
    expect(view).toContain(
      "Trust boundary: UNKNOWN (unconfirmed agent proposals)",
    );
    expect(view).toContain(
      "POSSIBLE crossing local to remote_provider: UNKNOWN (depends on unconfirmed architecture)",
    );
  });

  it.each([
    [
      "an existing node id",
      (p: Record<string, unknown>) => {
        (p.proposed_architecture_nodes as Record<string, unknown>[])[0]!.id =
          "ticket-classifier";
      },
      /architecture node "ticket-classifier" already exists/,
    ],
    [
      "a duplicated relationship id",
      (p: Record<string, unknown>) => {
        const relationships = p.proposed_relationships as Record<
          string,
          unknown
        >[];
        relationships.push({ ...relationships[0] });
      },
      /relationship "classifier-to-drafter" is proposed more than once/,
    ],
    [
      "a dangling node reference",
      (p: Record<string, unknown>) => {
        (
          p.proposed_relationships as Record<string, unknown>[]
        )[1]!.destination = "ghost-index";
      },
      /names destination "ghost-index", which is neither an existing node nor a node proposed in this document/,
    ],
    [
      "an undeclared classification",
      (p: Record<string, unknown>) => {
        (
          p.proposed_relationships as Record<string, unknown>[]
        )[1]!.data_classification = "invented_label";
      },
      /invalid at architecture\.relationships\[\d+\]\.data_classification/,
    ],
    [
      "a binding for a decision that does not exist",
      (p: Record<string, unknown>) => {
        p.proposed_decision_bindings = [
          { decision_ref: "decision.ghost", node_refs: ["response-drafter"] },
        ];
      },
      /architecture\.decision_bindings\[0\]\.decision_ref/,
    ],
    [
      "a supplied origin",
      (p: Record<string, unknown>) => {
        (
          p.proposed_architecture_nodes as Record<string, unknown>[]
        )[0]!.origin = {
          kind: "user",
        };
      },
      /may not supply origin/,
    ],
    [
      "a supplied confirmation",
      (p: Record<string, unknown>) => {
        (
          p.proposed_relationships as Record<string, unknown>[]
        )[0]!.confirmed_content_hash = "a".repeat(64);
      },
      /may not supply confirmed_content_hash/,
    ],
    [
      "architecture arrays under protocol draft.1",
      (p: Record<string, unknown>) => {
        p.protocol_version = "0.1.0-draft.1";
      },
      /may not supply proposed_architecture_nodes, proposed_decision_bindings, proposed_relationships/,
    ],
  ])(
    "refuses a proposal with %s as a whole",
    async (_name, mutate, message) => {
      const root = await atlasWithHandoff();
      const before = await projectText(root);
      const revisions = await historyNames(root);
      const proposal = await atlasProposal();
      mutate(proposal);
      const result = await importProposal(root, proposal);
      expect(result.code).toBe(1);
      expect(result.err).toMatch(message);
      expect(await projectText(root)).toBe(before);
      expect(await historyNames(root)).toEqual(revisions);
    },
  );

  it("refuses to extend an existing binding, and adds a new binding unconfirmed", async () => {
    const root = await approvedProject();
    await ok(root, ["intelligence", "select", "handoff"]);
    const binding = {
      protocol_version: "0.1.0-draft.2",
      proposed_decision_bindings: [
        {
          decision_ref: "decision.classification",
          node_refs: ["ticket-classifier"],
        },
      ],
    };
    const added = await importProposal(root, binding);
    expect(added.code, added.err).toBe(0);
    const contract = await contractAt(root);
    expect(contract.architecture.decision_bindings[0]?.origin).toMatchObject({
      kind: "agent_proposed",
      confirmed_at: null,
    });
    const facts = await ok(root, ["architecture", "show"]);
    expect(facts.out()).toContain(
      "decision.classification (binding, approved_current, not authoritative)",
    );

    const before = await projectText(root);
    const extend = await importProposal(root, {
      protocol_version: "0.1.0-draft.2",
      proposed_decision_bindings: [
        {
          decision_ref: "decision.classification",
          node_refs: ["remote-model-provider"],
        },
      ],
    });
    expect(extend.code).toBe(1);
    expect(extend.err).toContain(
      'decision "decision.classification" already has an architecture binding; a proposal cannot extend or replace an existing binding',
    );
    expect(await projectText(root)).toBe(before);
  });
});

describe("interactive confirmation", () => {
  async function imported(): Promise<{ root: string; proposalId: string }> {
    const root = await atlasWithHandoff();
    expect((await importProposal(root, await atlasProposal())).code).toBe(0);
    const contract = await contractAt(root);
    return {
      root,
      proposalId: contract.architecture.nodes.find(
        (node) => node.id === "response-drafter",
      )!.origin.proposal_ref!,
    };
  }

  it("confirms exact content, records history, keeps provenance, and makes views effective", async () => {
    const { root, proposalId } = await imported();
    const revisions = (await historyNames(root)).length;
    const result = await confirm(root, ["node", "response-drafter"]);
    expect(result.code, result.err).toBe(0);
    expect(result.out).toContain(
      `proposal: ${proposalId} from handoff, applied in committed revision r2`,
    );
    expect(result.out).toContain('"trust_boundary": "local"');
    expect(result.out).toContain("It does not approve any decision");

    const contract = await contractAt(root);
    const drafter = contract.architecture.nodes.find(
      (node) => node.id === "response-drafter",
    )!;
    expect(drafter.origin).toMatchObject({
      kind: "agent_proposed",
      proposal_ref: proposalId,
      confirmed_content_hash: architectureContentHash({
        type: "node",
        value: drafter,
      }),
    });
    expect(drafter.origin.confirmed_at).not.toBeNull();
    expect(confirmationStanding({ type: "node", value: drafter })).toBe(
      "confirmed",
    );
    expect((await historyNames(root)).length).toBe(revisions + 3);
    const loaded = await loadProject(root);
    expect(loaded.history.committed.at(-1)?.provenance).toMatchObject({
      kind: "architecture_confirmation",
      element: "node",
      ref: "response-drafter",
      proposal_ref: proposalId,
      proposal_state_revision: 2,
    });

    await confirm(root, ["relationship", "drafter-to-remote-model"]);
    const show = await ok(root, ["architecture", "show"]);
    expect(show.out()).toContain("CROSSES local -> remote_provider");

    const again = await confirm(root, ["node", "response-drafter"]);
    expect(again.code).toBe(1);
    expect(again.err).toContain("is already confirmed for its current content");
  });

  it("refuses without an interactive terminal, for user-declared elements, and on a wrong or empty answer", async () => {
    const { root } = await imported();
    const before = await projectText(root);
    const noTty = await confirm(
      root,
      ["node", "response-drafter"],
      undefined,
      false,
    );
    expect(noTty.code).toBe(1);
    expect(noTty.err).toContain("confirmation needs an interactive terminal");

    const user = await confirm(root, ["node", "ticket-classifier"]);
    expect(user.code).toBe(1);
    expect(user.err).toContain(
      "was declared by the user; only agent-proposed elements are confirmed",
    );

    const wrong = await confirm(
      root,
      ["node", "response-drafter"],
      () => "000000000000",
    );
    expect(wrong.code).toBe(3);
    expect(wrong.err).toContain("does not match the content hash");
    const cancelled = await confirm(
      root,
      ["node", "response-drafter"],
      () => null,
    );
    expect(cancelled.code).toBe(3);

    const json = scriptedIo({ cwd: root, interactive: true });
    expect(
      await cli(
        ["architecture", "confirm", "node", "response-drafter", "--json"],
        json,
      ),
    ).toBe(2);
    const noTarget = scriptedIo({ cwd: root, interactive: true });
    expect(
      await cli(["architecture", "confirm", "response-drafter"], noTarget),
    ).toBe(2);
    expect(await projectText(root)).toBe(before);
  });

  it("refuses when provenance is missing, mismatched, ambiguous or abandoned", async () => {
    // Missing: a hand-written origin naming a proposal no history records.
    const { root, proposalId } = await imported();
    const file = join(root, ".anvilmark", "project.yaml");
    const contract = await contractAt(root);
    const intake = contract.architecture.nodes.find(
      (node) => node.id === "ticket-intake",
    )!;
    intake.origin = {
      kind: "agent_proposed",
      proposal_ref: "prop-20260101T000000Z-deadbeef",
      confirmed_at: null,
      confirmed_content_hash: null,
    };
    await writeFile(file, toNormalizedYaml(contract), "utf8");
    const missing = await confirm(root, ["node", "ticket-intake"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(
      'no committed state revision records proposal "prop-20260101T000000Z-deadbeef"',
    );

    // Mismatched: a real proposal that did not propose this element.
    intake.origin.proposal_ref = proposalId;
    await writeFile(file, toNormalizedYaml(contract), "utf8");
    const mismatched = await confirm(root, ["node", "ticket-intake"]);
    expect(mismatched.code).toBe(1);
    expect(mismatched.err).toContain(
      `proposal "${proposalId}" was applied in committed revision r2, but its record does not list node "ticket-intake"`,
    );
  });

  it("refuses a proposal recorded only in an abandoned or ambiguous revision", async () => {
    const failing = (alsoFail?: (path: string) => boolean): StoreFs => ({
      writeExclusive: async (path, text) => {
        if (alsoFail?.(path) === true)
          throw new Error(`simulated failure writing ${path}`);
        await nodeStoreFs.writeExclusive(path, text);
      },
      replace: async () => {
        throw new Error("simulated rename failure");
      },
    });

    for (const scenario of ["abandoned", "ambiguous"] as const) {
      const root = await atlasWithHandoff();
      const failed = await importProposal(
        root,
        await atlasProposal(),
        scenario === "abandoned"
          ? failing()
          : failing((path) => path.endsWith(".abandoned.json")),
      );
      expect(failed.code).toBe(1);
      const meta = JSON.parse(
        await readFile(
          join(root, ".anvilmark", "history", "r000002.json"),
          "utf8",
        ),
      ) as { provenance: { record: { proposal_id: string } } };
      const proposalId = meta.provenance.record.proposal_id;

      // Hand-write the element as if the failed import had landed.
      const file = join(root, ".anvilmark", "project.yaml");
      const contract = await contractAt(root);
      contract.architecture.nodes.push({
        id: "response-drafter",
        kind: "service",
        name: "Response Drafter",
        trust_boundary: "local",
        description: null,
        interfaces: [],
        origin: {
          kind: "agent_proposed",
          proposal_ref: proposalId,
          confirmed_at: null,
          confirmed_content_hash: null,
        },
      });
      await writeFile(file, toNormalizedYaml(contract), "utf8");
      const before = await projectText(root);
      const result = await confirm(root, ["node", "response-drafter"]);
      expect(result.code, scenario).toBe(1);
      expect(result.err).toContain(
        scenario === "abandoned"
          ? `proposal "${proposalId}" is recorded only in revision r2, which is abandoned; it was never accepted`
          : `proposal "${proposalId}" is recorded only in a revision whose commit standing is ambiguous`,
      );
      expect(await projectText(root)).toBe(before);
    }
  });

  it("refuses when the project changes during review", async () => {
    const { root } = await imported();
    let shown = "";
    const io = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [
        async () => {
          await appendFile(
            join(root, ".anvilmark", "project.yaml"),
            "\n# edited during review\n",
          );
          return (
            /content hash \(sha-256\): ([0-9a-f]{64})/
              .exec(shown)?.[1]
              ?.slice(0, 12) ?? null
          );
        },
      ],
    });
    const original = io.stdout;
    const code = await cli(
      ["architecture", "confirm", "node", "response-drafter"],
      {
        ...io,
        stdout: (text: string) => {
          shown += text;
          original(text);
        },
      } as typeof io,
    );
    expect(code).toBe(1);
    expect(io.err()).toContain(
      "the project changed while you were reviewing; nothing was confirmed",
    );
  });
});

describe("invalidation", () => {
  async function confirmedDrafter(): Promise<string> {
    const root = await atlasWithHandoff();
    expect((await importProposal(root, await atlasProposal())).code).toBe(0);
    expect((await confirm(root, ["node", "response-drafter"])).code).toBe(0);
    expect(
      (await confirm(root, ["relationship", "classifier-to-drafter"])).code,
    ).toBe(0);
    return root;
  }

  const standingOf = async (root: string, id: string) => {
    const contract = await contractAt(root);
    const node = contract.architecture.nodes.find((entry) => entry.id === id);
    if (node !== undefined)
      return confirmationStanding({ type: "node", value: node });
    const relationship = contract.architecture.relationships.find(
      (entry) => entry.id === id,
    )!;
    return confirmationStanding({ type: "relationship", value: relationship });
  };

  it("clears confirmation when a CLI edit changes confirmed content, and not otherwise", async () => {
    const root = await confirmedDrafter();
    // An unrelated edit keeps both confirmations.
    await ok(root, [
      "architecture",
      "node",
      "update",
      "ticket-intake",
      "--description",
      "Receives tickets",
    ]);
    expect(await standingOf(root, "response-drafter")).toBe("confirmed");

    const renamed = await ok(root, [
      "architecture",
      "node",
      "update",
      "response-drafter",
      "--name",
      "Reply Drafter",
    ]);
    expect(renamed.out()).toContain(
      "node response-drafter was confirmed, and this edit changed its confirmed content; it is agent-proposed and unconfirmed again",
    );
    const contract = await contractAt(root);
    expect(
      contract.architecture.nodes.find(
        (node) => node.id === "response-drafter",
      )!.origin,
    ).toMatchObject({
      kind: "agent_proposed",
      confirmed_at: null,
      confirmed_content_hash: null,
    });
    expect(await standingOf(root, "classifier-to-drafter")).toBe("confirmed");

    await ok(root, [
      "architecture",
      "relationship",
      "update",
      "classifier-to-drafter",
      "--unknown-classification",
    ]);
    expect(await standingOf(root, "classifier-to-drafter")).toBe("unconfirmed");

    // Adding an interface changes node content too.
    expect((await confirm(root, ["node", "response-drafter"])).code).toBe(0);
    await ok(root, [
      "architecture",
      "interface",
      "add",
      "response-drafter",
      "drafter-api",
      "--protocol",
      "HTTPS",
    ]);
    expect(await standingOf(root, "response-drafter")).toBe("unconfirmed");
  });

  it("shows a manual edit of confirmed content as stale until confirmed again", async () => {
    const root = await confirmedDrafter();
    const file = join(root, ".anvilmark", "project.yaml");
    const text = await readFile(file, "utf8");
    await writeFile(
      file,
      text.replace(
        "name: Response Drafter\n",
        "name: Response Drafter (edited)\n",
      ),
      "utf8",
    );
    expect(await standingOf(root, "response-drafter")).toBe(
      "confirmation_stale",
    );
    const show = await ok(root, ["architecture", "show"]);
    expect(show.out()).toContain("CONFIRMATION STALE");
    expect(
      (await ok(root, ["generate", "--as-of", "2026-09-14T00:00:00Z"])).out(),
    ).toContain("Generated");
    expect(
      await readFile(
        join(root, ".anvilmark/generated/agent-context.md"),
        "utf8",
      ),
    ).toContain("CONFIRMATION STALE");
    const again = await confirm(root, ["node", "response-drafter"]);
    expect(again.code, again.err).toBe(0);
    expect(again.out).toContain("standing now: confirmation_stale");
    expect(await standingOf(root, "response-drafter")).toBe("confirmed");
  });
});

describe("declared interfaces", () => {
  it("adds, references, updates and removes interfaces with refusals that write nothing", async () => {
    const root = await atlasWithHandoff();
    await ok(root, [
      "architecture",
      "interface",
      "add",
      "ticket-classifier",
      "classifier-grpc",
      "--protocol",
      "gRPC",
    ]);
    await ok(root, [
      "architecture",
      "interface",
      "add",
      "remote-model-provider",
      "provider-endpoint",
    ]);
    await ok(root, [
      "architecture",
      "interface",
      "add",
      "ticket-classifier",
      "classifier-admin",
      "--protocol",
      "HTTPS",
      "--description",
      "Admin API",
    ]);
    await ok(root, [
      "architecture",
      "relationship",
      "update",
      "ticket-classifier-to-remote-model-provider",
      "--source-interface",
      "classifier-grpc",
      "--destination-interface",
      "provider-endpoint",
    ]);

    const refusals: [string[], RegExp][] = [
      [
        ["architecture", "interface", "add", "pii-redactor", "classifier-grpc"],
        /already exists on node "ticket-classifier"/,
      ],
      [
        [
          "architecture",
          "interface",
          "add",
          "pii-redactor",
          "x",
          "--protocol",
          "websocket",
        ],
        /--protocol must be one of HTTP, HTTPS, gRPC, AMQP, TCP, other/,
      ],
      [
        [
          "architecture",
          "relationship",
          "update",
          "pii-redactor-to-ticket-classifier",
          "--source-interface",
          "classifier-grpc",
        ],
        /declared on node "ticket-classifier", not on the source node "pii-redactor"/,
      ],
      [
        [
          "architecture",
          "relationship",
          "update",
          "ticket-classifier-to-remote-model-provider",
          "--kind",
          "uses",
        ],
        /only connects relationships may reference interfaces/,
      ],
      [
        ["architecture", "interface", "remove", "provider-endpoint"],
        /still referenced by relationship ticket-classifier-to-remote-model-provider/,
      ],
      [
        [
          "architecture",
          "relationship",
          "update",
          "ticket-intake-to-pii-redactor",
          "--destination-interface",
          "nope",
        ],
        /interface "nope" does not exist/,
      ],
    ];
    for (const [argv, message] of refusals) {
      const before = await projectText(root);
      const io = scriptedIo({ cwd: root });
      expect(await cli(argv, io), argv.join(" ")).toBe(1);
      expect(io.err()).toMatch(message);
      expect(await projectText(root)).toBe(before);
    }

    await ok(root, [
      "architecture",
      "interface",
      "update",
      "provider-endpoint",
      "--protocol",
      "HTTPS",
    ]);
    await ok(root, [
      "architecture",
      "interface",
      "update",
      "provider-endpoint",
      "--unknown-protocol",
    ]);
    await ok(root, ["architecture", "interface", "remove", "classifier-admin"]);

    const contract = await contractAt(root);
    expect(
      contract.architecture.nodes.find(
        (node) => node.id === "ticket-classifier",
      )!.interfaces,
    ).toEqual([{ id: "classifier-grpc", protocol: "gRPC", description: null }]);
    await ok(root, ["generate", "--as-of", "2026-09-14T00:00:00Z"]);
    const calm = JSON.parse(
      await readFile(join(root, ".anvilmark/architecture/calm.json"), "utf8"),
    );
    const edge = calm.relationships.find(
      (entry: Record<string, unknown>) =>
        entry["unique-id"] === "ticket-classifier-to-remote-model-provider",
    );
    expect(edge["relationship-type"].connects).toEqual({
      source: { node: "ticket-classifier", interfaces: ["classifier-grpc"] },
      destination: {
        node: "remote-model-provider",
        interfaces: ["provider-endpoint"],
      },
    });
    const provider = calm.nodes.find(
      (entry: Record<string, unknown>) =>
        entry["unique-id"] === "remote-model-provider",
    );
    expect(provider.metadata.anvilmark.interfaces).toEqual({
      "provider-endpoint": { protocol: null, description: null },
    });
    const tree = await readTree(join(root, ".anvilmark"));
    expect(Object.keys(tree).some((path) => path.includes(".tmp-"))).toBe(
      false,
    );
  });
});
