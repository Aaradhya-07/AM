import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  approvalState,
  parseProjectContract,
} from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  approvedProject,
  atlasProject,
  cleanup,
  cli,
  projectText,
  readTree,
  scriptedIo,
} from "./helpers.js";

afterEach(cleanup);

const USER_ORIGIN = {
  kind: "user",
  proposal_ref: null,
  confirmed_at: null,
  confirmed_content_hash: null,
};

async function contractOf(root: string) {
  const parsed = parseProjectContract(await projectText(root), "yaml");
  if (!parsed.ok) throw new Error("invalid");
  return parsed.value;
}

async function historyCount(root: string): Promise<number> {
  return (await readdir(join(root, ".anvilmark", "history"))).filter((name) =>
    /^r\d+\.yaml$/.test(name),
  ).length;
}

async function refused(
  root: string,
  argv: string[],
  message: RegExp | string,
  exit = 1,
) {
  const before = await projectText(root);
  const revisions = await historyCount(root);
  const io = scriptedIo({ cwd: root });
  expect(await cli(argv, io)).toBe(exit);
  expect(io.err()).toMatch(message);
  expect(await projectText(root)).toBe(before);
  expect(await historyCount(root)).toBe(revisions);
}

describe("architecture editing", () => {
  it("adds, updates and removes nodes and relationships as validated revisions", async () => {
    const root = await atlasProject();
    const run = async (argv: string[]) => {
      const io = scriptedIo({ cwd: root });
      const code = await cli(argv, io);
      expect(code, io.err()).toBe(0);
      return io.out();
    };
    expect(
      await run([
        "architecture",
        "node",
        "add",
        "response-drafter",
        "--kind",
        "service",
        "--name",
        "Response Drafter",
        "--trust-boundary",
        "local",
      ]),
    ).toMatch(
      /Saved state revision r2: added architecture node response-drafter/,
    );
    expect(
      await run([
        "architecture",
        "relationship",
        "add",
        "drafter-to-provider",
        "--kind",
        "connects",
        "--from",
        "response-drafter",
        "--to",
        "remote-model-provider",
        "--workload",
        "response_drafting",
      ]),
    ).toMatch(
      /crosses the trust boundary from local to remote_provider[\s\S]*no declared data classification/,
    );
    await run([
      "architecture",
      "relationship",
      "update",
      "drafter-to-provider",
      "--data-classification",
      "redacted_customer_ticket_with_internal_context",
    ]);
    await run([
      "architecture",
      "node",
      "update",
      "response-drafter",
      "--description",
      "Drafts cited replies",
    ]);

    let contract = await contractOf(root);
    expect(
      contract.architecture.nodes.find(
        (node) => node.id === "response-drafter",
      ),
    ).toEqual({
      id: "response-drafter",
      kind: "service",
      name: "Response Drafter",
      trust_boundary: "local",
      description: "Drafts cited replies",
      interfaces: [],
      origin: USER_ORIGIN,
    });
    expect(
      contract.architecture.relationships.find(
        (entry) => entry.id === "drafter-to-provider",
      ),
    ).toEqual({
      id: "drafter-to-provider",
      kind: "connects",
      source: "response-drafter",
      destination: "remote-model-provider",
      workload_ref: "response_drafting",
      data_classification: "redacted_customer_ticket_with_internal_context",
      source_interface_ref: null,
      destination_interface_ref: null,
      origin: USER_ORIGIN,
    });

    await run([
      "architecture",
      "relationship",
      "update",
      "drafter-to-provider",
      "--unknown-classification",
      "--no-workload",
    ]);
    contract = await contractOf(root);
    expect(
      contract.architecture.relationships.find(
        (entry) => entry.id === "drafter-to-provider",
      ),
    ).toMatchObject({
      workload_ref: null,
      data_classification: null,
    });
    await run([
      "architecture",
      "node",
      "update",
      "response-drafter",
      "--clear-description",
    ]);
    await run([
      "architecture",
      "relationship",
      "remove",
      "drafter-to-provider",
    ]);
    await run(["architecture", "node", "remove", "response-drafter"]);
    contract = await contractOf(root);
    expect(contract.architecture.nodes.map((node) => node.id)).toEqual([
      "ticket-intake",
      "pii-redactor",
      "ticket-classifier",
      "remote-model-provider",
    ]);
    expect(await historyCount(root)).toBe(9);
  });

  it("refuses broken references, unknown classifications and invalid values without writing", async () => {
    const root = await atlasProject();
    await refused(
      root,
      [
        "architecture",
        "relationship",
        "add",
        "x",
        "--kind",
        "connects",
        "--from",
        "ticket-intake",
        "--to",
        "ghost",
      ],
      /architecture node "ghost" does not exist/,
    );
    await refused(
      root,
      [
        "architecture",
        "relationship",
        "add",
        "x",
        "--kind",
        "connects",
        "--from",
        "ticket-intake",
        "--to",
        "pii-redactor",
        "--data-classification",
        "invented_label",
      ],
      /not declared as the input or output of any workload/,
    );
    await refused(
      root,
      [
        "architecture",
        "relationship",
        "add",
        "x",
        "--kind",
        "connects",
        "--from",
        "ticket-intake",
        "--to",
        "pii-redactor",
        "--workload",
        "ghost",
      ],
      /workload "ghost" does not exist/,
    );
    await refused(
      root,
      [
        "architecture",
        "relationship",
        "add",
        "x",
        "--kind",
        "calls",
        "--from",
        "ticket-intake",
        "--to",
        "pii-redactor",
      ],
      /--kind must be one of connects, uses, deployed_in, composed_of/,
    );
    await refused(
      root,
      [
        "architecture",
        "relationship",
        "add",
        "x",
        "--kind",
        "connects",
        "--from",
        "ticket-intake",
        "--to",
        "ticket-intake",
      ],
      /two different nodes/,
    );
    await refused(
      root,
      [
        "architecture",
        "node",
        "add",
        "ticket-intake",
        "--kind",
        "service",
        "--name",
        "Dup",
        "--trust-boundary",
        "local",
      ],
      /already exists/,
    );
    await refused(
      root,
      [
        "architecture",
        "node",
        "add",
        "new",
        "--kind",
        "service",
        "--name",
        "New",
        "--trust-boundary",
        "internet",
      ],
      /--trust-boundary must be one of local, internal_network, remote_provider, third_party/,
    );
    await refused(
      root,
      [
        "architecture",
        "node",
        "add",
        "bad id!",
        "--kind",
        "service",
        "--name",
        "New",
        "--trust-boundary",
        "local",
      ],
      /not a valid id/,
    );
    await refused(
      root,
      ["architecture", "node", "remove", "pii-redactor"],
      /still referenced by relationship ticket-intake-to-pii-redactor, relationship pii-redactor-to-ticket-classifier, conformance rule rule.raw_ticket_never_remote/,
    );
    await refused(
      root,
      ["architecture", "node", "update", "pii-redactor"],
      /nothing to change/,
    );
    await refused(
      root,
      ["architecture", "node", "add", "n", "--kind", "service", "--name", "N"],
      /--trust-boundary is required/,
      2,
    );
    await refused(
      root,
      ["architecture", "views", "--calm", "../../outside.json"],
      /resolves outside \.anvilmark\/[\s\S]*nothing was saved/,
    );
    await refused(
      root,
      ["architecture", "views", "--mermaid", "project.yaml"],
      /would overwrite the project contract/,
    );
    await refused(
      root,
      ["architecture", "bind", "decision.none", "--node", "pii-redactor"],
      /decision "decision.none" does not exist/,
    );
  });

  it("refuses a project.yaml edited to contain a broken architecture reference", async () => {
    const root = await atlasProject();
    const file = join(root, ".anvilmark", "project.yaml");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "destination: ticket-classifier",
        "destination: ghost-node",
      ),
      "utf8",
    );
    const io = scriptedIo({ cwd: root });
    expect(await cli(["architecture", "validate"], io)).toBe(1);
    expect(io.err()).toMatch(
      /not a valid project contract[\s\S]*architecture\.relationships\[\d\]\.destination/,
    );
    expect(
      await cli(
        ["generate", "--as-of", "2026-09-14T00:00:00Z"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(1);
    expect(
      Object.keys(await readTree(join(root, ".anvilmark"))).some((path) =>
        path.startsWith("generated"),
      ),
    ).toBe(false);
  });

  it("binds and unbinds decisions without changing approvals, and never upgrades standing", async () => {
    const root = await approvedProject();
    const before = await contractOf(root);
    expect(approvalState(before, "decision.classification").state).toBe(
      "current",
    );

    const io = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "architecture",
          "bind",
          "decision.classification",
          "--node",
          "ticket-classifier,remote-model-provider",
        ],
        io,
      ),
    ).toBe(0);
    let contract = await contractOf(root);
    expect(contract.architecture.decision_bindings).toEqual([
      {
        decision_ref: "decision.classification",
        node_refs: ["ticket-classifier", "remote-model-provider"],
        origin: USER_ORIGIN,
      },
    ]);
    expect(approvalState(contract, "decision.classification").state).toBe(
      "current",
    );
    expect(contract.approvals).toEqual(before.approvals);
    expect(contract.decisions).toEqual(before.decisions);

    // Architecture edits are declared structure, not approval content.
    expect(
      await cli(
        [
          "architecture",
          "node",
          "update",
          "ticket-classifier",
          "--trust-boundary",
          "internal_network",
        ],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    contract = await contractOf(root);
    expect(approvalState(contract, "decision.classification").state).toBe(
      "current",
    );

    expect(
      await cli(
        [
          "architecture",
          "unbind",
          "decision.classification",
          "--node",
          "remote-model-provider",
        ],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    expect(
      (await contractOf(root)).architecture.decision_bindings[0]?.node_refs,
    ).toEqual(["ticket-classifier"]);
    expect(
      await cli(
        ["architecture", "unbind", "decision.classification"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    expect((await contractOf(root)).architecture.decision_bindings).toEqual([]);
  });

  it("says a binding to a non-approved decision does not make it an instruction", async () => {
    const root = await approvedProject();
    const file = join(root, ".anvilmark", "project.yaml");
    // A draft decision: no approval record, status draft.
    await writeFile(
      file,
      (await readFile(file, "utf8"))
        .replace(/^approvals:\n(?: {2}.*\n)+/m, "approvals: []\n")
        .replace("    status: approved\n", "    status: draft\n"),
      "utf8",
    );
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "architecture",
          "bind",
          "decision.classification",
          "--node",
          "ticket-classifier",
        ],
        io,
      ),
    ).toBe(0);
    expect(io.err()).toBe("");
    expect(io.out()).toMatch(/decision decision\.classification is draft/);
    expect(io.out()).toContain("does not make it an approved instruction");
  });

  it("shows declared architecture with standing, and validates with --strict", async () => {
    const root = await atlasProject();
    const show = scriptedIo({ cwd: root });
    expect(await cli(["architecture", "show"], show)).toBe(0);
    expect(show.out()).toContain(
      "ticket-classifier-to-remote-model-provider  ticket-classifier -connects-> remote-model-provider",
    );
    expect(show.out()).toContain("CROSSES local -> remote_provider");
    expect(show.out()).toContain(
      "UNRESOLVED:  no decision is linked to this component",
    );
    expect(show.out()).toContain("LOCAL-DISCLOSED projection");

    const json = scriptedIo({ cwd: root });
    expect(await cli(["architecture", "show", "--json"], json)).toBe(0);
    const shown = JSON.parse(json.out());
    expect(shown.source.projection).toBe("local-disclosed");
    expect(shown.architecture.nodes).toHaveLength(4);

    expect(
      await cli(["architecture", "validate"], scriptedIo({ cwd: root })),
    ).toBe(0);
    const strict = scriptedIo({ cwd: root });
    expect(
      await cli(["architecture", "validate", "--strict", "--json"], strict),
    ).toBe(1);
    expect(JSON.parse(strict.out())).toMatchObject({
      ok: false,
      valid: true,
      strict: true,
    });
  });
});
