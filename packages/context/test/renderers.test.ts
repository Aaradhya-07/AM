import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectContract } from "@anvilmark/project-contract";
import { afterAll, describe, expect, it } from "vitest";

import {
  CALM_SCHEMA,
  UNDECLARED_DESCRIPTION,
  buildProjectFacts,
  markdownText,
  mermaidLabel,
  mermaidNodeId,
  renderAgentContext,
  renderCalm,
  renderMermaid,
} from "../src/index.js";
import {
  AS_OF,
  PACKAGE_ROOT,
  allKindsContract,
  approvedAtlas,
  atlas,
  officialCalmValidate,
  resignApproval,
  valid,
} from "./helpers.js";

const LS = String.fromCodePoint(0x2028);
const RLO = String.fromCodePoint(0x202e);

/** Text designed to break out of a label, a comment, Markdown or HTML. */
const HOSTILE = `Evil"] --> pwned["x"]; click pwned call alert(1) %%{init: {"securityLevel": "loose"}}%% <img src=x onerror=alert(1)> #quot; &amp; \`code\` | end [link](https://example.invalid) ![i](x) *em* _u_ ~s~ \\${"\n"}# Heading${LS}- item${RLO}`;

const scratch: string[] = [];
function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "anvilmark-context-"));
  scratch.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function hostileContract(): ProjectContract {
  // Deliberately not validated: renderers must stay inert for any text.
  const contract = structuredClone(allKindsContract());
  contract.architecture.nodes[1]!.name = HOSTILE;
  contract.architecture.nodes[1]!.description = HOSTILE;
  contract.project.name = HOSTILE;
  contract.intent.summary = HOSTILE;
  contract.intent.unresolved_questions = [HOSTILE];
  contract.decisions[0]!.rationale.summary = HOSTILE;
  return contract;
}

describe("Mermaid", () => {
  it("renders Atlas deterministically with a source header, boundaries and crossings", async () => {
    const contract = await atlas();
    const facts = buildProjectFacts(contract, {
      asOf: AS_OF,
      stateRevision: 1,
    });
    const text = renderMermaid(facts);
    expect(
      renderMermaid(
        buildProjectFacts(structuredClone(contract), {
          asOf: AS_OF,
          stateRevision: 1,
        }),
      ),
    ).toBe(text);
    const lines = text.split("\n");
    expect(lines[0]).toMatch(
      /^%% ANVILMARK generated Mermaid architecture view\./,
    );
    expect(text).toContain(
      `%% source.contract_hash: ${facts.source.contract_hash}`,
    );
    expect(text).toContain("%% source.state_revision: r1");
    expect(text).toContain("%% as_of: 2026-09-14T00:00:00Z");
    expect(text).toContain("%% projection: remote-default");
    expect(lines).toContain("flowchart LR");
    expect(text).toContain('subgraph tb_local["Trust boundary: local"]');
    expect(text).toContain(
      `${mermaidNodeId("ticket-classifier")} ==>|"ticket-classifier-to-remote-model-provider · connects · data: redacted_customer_ticket · workload: classification · crosses local to remote_provider · UNRESOLVED"| ${mermaidNodeId("remote-model-provider")}`,
    );
    expect(text).toContain("decision: UNRESOLVED");
    expect(text).toContain(
      "%% node pii-redactor as n_pii_redactor_7df3dabf · declared by user · effective trust boundary local · support unresolved · decisions none · interfaces none · constraints availability.classification_provider",
    );
    expect(text.endsWith("\n")).toBe(true);
  });

  it("marks approved support and lists linked evidence", () => {
    const text = renderMermaid(
      buildProjectFacts(allKindsContract(), { asOf: AS_OF }),
    );
    expect(text).toContain(
      "decision: decision.classification approved_current",
    );
    expect(text).toMatch(
      new RegExp(`class [^\\n]*${mermaidNodeId("api")}[^\\n]* approved`),
    );
    expect(text).toContain("evidence evidence.pricing.remote");
    expect(text).toMatch(/-\.->\|"api-deployed-in-runtime/);
  });

  it("derives collision-free ids that are never Mermaid keywords", () => {
    expect(mermaidNodeId("a.b")).not.toBe(mermaidNodeId("a_b"));
    expect(mermaidNodeId("end")).toMatch(/^n_end_[0-9a-f]{8}$/);
    expect(mermaidNodeId("x-y")).toMatch(/^n_[A-Za-z0-9_]+$/);
  });

  it("encodes every character that could leave a label", () => {
    const label = mermaidLabel(HOSTILE);
    // Only numeric entities carry ";"; nothing else can close or open syntax.
    expect(label.replace(/#\d+;/g, "")).not.toMatch(/["<>`|%;&#\n\r]/);
    expect(label).not.toContain(LS);
    expect(label).not.toContain(RLO);
    expect(label).toContain("#34;");
    expect(label).toContain("#8232;");
    const text = renderMermaid(
      buildProjectFacts(hostileContract(), { asOf: AS_OF }),
    );
    // One line per statement: hostile text never adds a line or a directive.
    expect(text).not.toMatch(/%%\{/);
    expect(text).not.toContain("<img");
    expect(text.split("\n").filter((line) => line.includes("click"))).toEqual(
      text
        .split("\n")
        .filter(
          (line) => line.includes("click") && line.trimStart().startsWith("n_"),
        ),
    );
  });

  const mermaidModules = process.env.ANVILMARK_MERMAID_NODE_MODULES;
  it.skipIf(mermaidModules === undefined)(
    "parses with the real Mermaid parser and decodes hostile labels to inert text",
    async () => {
      const hostile = tempFile(
        "hostile.mmd",
        renderMermaid(buildProjectFacts(hostileContract(), { asOf: AS_OF })),
      );
      const atlasView = tempFile(
        "atlas.mmd",
        renderMermaid(buildProjectFacts(await atlas(), { asOf: AS_OF })),
      );
      const allKinds = tempFile(
        "all-kinds.mmd",
        renderMermaid(buildProjectFacts(allKindsContract(), { asOf: AS_OF })),
      );
      const emptyContract = structuredClone(await atlas());
      emptyContract.architecture.nodes = [];
      emptyContract.architecture.relationships = [];
      emptyContract.conformance_rules = [];
      const empty = tempFile(
        "empty.mmd",
        renderMermaid(buildProjectFacts(emptyContract, { asOf: AS_OF })),
      );
      const run = spawnSync(
        process.execPath,
        [
          join(PACKAGE_ROOT, "scripts/verify-mermaid.mjs"),
          hostile,
          atlasView,
          allKinds,
          empty,
        ],
        { encoding: "utf8", env: process.env, timeout: 120_000 },
      );
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const reports = run.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(reports.map((report) => report.ok)).toEqual([
        true,
        true,
        true,
        true,
      ]);
      const [hostileReport, atlasReport, allKindsReport, emptyReport] = reports;

      // The hostile node is exactly one vertex whose text starts with the
      // hostile name as plain text; no injected vertex "pwned" exists.
      // eslint-disable-next-line no-control-regex
      const expectedName = HOSTILE.replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/ {2,}/g, " ")
        .trim();
      expect(
        hostileReport.vertices.map((vertex: { id: string }) => vertex.id),
      ).toEqual(
        allKindsReport.vertices.map((vertex: { id: string }) => vertex.id),
      );
      const api = hostileReport.vertices.find(
        (vertex: { id: string }) => vertex.id === mermaidNodeId("api"),
      );
      expect(api.text.startsWith(expectedName)).toBe(true);
      expect(hostileReport.edges).toHaveLength(allKindsReport.edges.length);

      expect(
        atlasReport.subgraphs.map((subgraph: { id: string }) => subgraph.id),
      ).toEqual(["tb_local", "tb_remote_provider"]);
      expect(
        atlasReport.edges.filter(
          (edge: { stroke: string }) => edge.stroke === "thick",
        ),
      ).toHaveLength(1);
      expect(
        allKindsReport.edges.filter(
          (edge: { stroke: string }) => edge.stroke === "dotted",
        ),
      ).toHaveLength(2);
      expect(emptyReport.vertices).toEqual([
        {
          id: "empty",
          text: "No architecture nodes are declared in the ANVILMARK contract · UNRESOLVED",
        },
      ]);
    },
  );
});

describe("CALM 1.2 export", () => {
  it("maps kinds without inventing interfaces, protocols, controls or flows", () => {
    const facts = buildProjectFacts(allKindsContract(), {
      asOf: AS_OF,
      stateRevision: 7,
    });
    const text = renderCalm(facts);
    expect(renderCalm(facts)).toBe(text);
    const document = JSON.parse(text);
    expect(document.$schema).toBe(CALM_SCHEMA);
    expect(document["unique-id"]).toBe("all-kinds");
    expect(document.metadata.anvilmark).toMatchObject({
      authority: "generated-export",
      source: {
        "contract-hash": facts.source.contract_hash,
        "state-revision": 7,
      },
      "as-of": AS_OF,
      projection: "remote-default",
    });
    const types = Object.fromEntries(
      document.nodes.map((node: Record<string, string>) => [
        node["unique-id"],
        node["node-type"],
      ]),
    );
    expect(types).toEqual({
      agent: "actor",
      api: "service",
      provider: "system",
      queue: "queue",
      runtime: "runtime",
      store: "database",
      vendor: "system",
    });
    const api = document.nodes.find(
      (node: Record<string, unknown>) => node["unique-id"] === "api",
    );
    expect(api.description).toBe(UNDECLARED_DESCRIPTION);
    expect(api.metadata.anvilmark["description-declared"]).toBe(false);
    const agent = document.nodes.find(
      (node: Record<string, unknown>) => node["unique-id"] === "agent",
    );
    expect(agent.description).toBe("A person using the desk");

    const relationship = (id: string) =>
      document.relationships.find(
        (entry: Record<string, unknown>) => entry["unique-id"] === id,
      )["relationship-type"];
    expect(relationship("agent-uses-api")).toEqual({
      interacts: { actor: "agent", nodes: ["api"] },
    });
    expect(relationship("api-to-vendor")).toEqual({
      connects: { source: { node: "api" }, destination: { node: "vendor" } },
    });
    expect(relationship("api-deployed-in-runtime")).toEqual({
      "deployed-in": { container: "runtime", nodes: ["api"] },
    });
    expect(relationship("runtime-composed-of-store")).toEqual({
      "composed-of": { container: "runtime", nodes: ["store"] },
    });

    // No interface is declared here, so no node carries CALM interfaces, and
    // no relationship protocol, control or flow is ever generated.
    for (const node of document.nodes) {
      expect(node).not.toHaveProperty("interfaces");
      expect(node.metadata.anvilmark.interfaces).toEqual({});
    }
    for (const key of ["protocol", "controls", "flows", "adrs"]) {
      expect(text).not.toContain(`"${key}"`);
    }
    const unknown = document.relationships.find(
      (entry: Record<string, unknown>) =>
        entry["unique-id"] === "api-connects-queue",
    );
    expect(unknown.metadata.anvilmark).toMatchObject({
      "data-classification": null,
      "data-classification-declared": false,
      unresolved: [
        "data classification not declared",
        "no workload is declared for this relationship",
      ],
    });
    // Every non-CALM fact is under the anvilmark namespace.
    for (const entry of [...document.nodes, ...document.relationships]) {
      expect(Object.keys(entry.metadata)).toEqual(["anvilmark"]);
    }
  });

  const calmBin = process.env.ANVILMARK_CALM_BIN;
  it.skipIf(calmBin === undefined)(
    "validates generated exports with the official CALM CLI, and rejects invalid ones",
    async () => {
      const emptyContract = structuredClone(await atlas());
      emptyContract.architecture.nodes = [];
      emptyContract.architecture.relationships = [];
      emptyContract.conformance_rules = [];
      const incomplete = structuredClone(allKindsContract());
      incomplete.architecture.relationships = [];
      incomplete.architecture.decision_bindings = [];

      const cases: [string, ProjectContract][] = [
        ["atlas", await atlas()],
        ["approved-atlas", approvedAtlas()],
        ["all-kinds", allKindsContract()],
        ["empty", emptyContract],
        ["nodes-without-relationships", incomplete],
        ["hostile-text", hostileContract()],
      ];
      for (const [name, contract] of cases) {
        const file = tempFile(
          `${name}.calm.json`,
          renderCalm(buildProjectFacts(contract, { asOf: AS_OF })),
        );
        const result = officialCalmValidate(calmBin!, file);
        expect(result.hasErrors, name).toBe(false);
        expect(result.jsonSchemaValidationOutputs, name).toEqual([]);
        if (name === "nodes-without-relationships") {
          // Honest incompleteness is a validator warning, not something the
          // export papers over by inventing relationships.
          expect(result.hasWarnings).toBe(true);
          expect(
            new Set(
              result.spectralSchemaValidationOutputs.map(
                (entry) => (entry as { code: string }).code,
              ),
            ),
          ).toEqual(new Set(["architecture-nodes-must-be-referenced"]));
        } else {
          expect(result, name).toMatchObject({ hasWarnings: false });
        }
      }

      // The validator is not a rubber stamp: breaking the actual export fails.
      const base = JSON.parse(
        renderCalm(buildProjectFacts(allKindsContract(), { asOf: AS_OF })),
      );
      const missingDescription = structuredClone(base);
      delete missingDescription.nodes[0].description;
      const danglingRelationship = structuredClone(base);
      danglingRelationship.relationships[1][
        "relationship-type"
      ].connects.destination.node = "not-a-node";
      for (const [name, document] of [
        ["missing-description", missingDescription],
        ["dangling-relationship", danglingRelationship],
      ] as const) {
        const file = tempFile(
          `${name}.calm.json`,
          `${JSON.stringify(document, null, 2)}\n`,
        );
        expect(officialCalmValidate(calmBin!, file).hasErrors, name).toBe(true);
      }
    },
    300_000,
  );
});

describe("agent context", () => {
  it("renders Atlas deterministically with source, legend and unresolved items", async () => {
    const facts = buildProjectFacts(await atlas(), {
      asOf: AS_OF,
      stateRevision: 2,
    });
    const text = renderAgentContext(facts);
    expect(renderAgentContext(facts)).toBe(text);
    expect(text).toContain(
      `| Contract hash | \`${facts.source.contract_hash}\` |`,
    );
    expect(text).toContain("| State revision | r2 |");
    expect(text).toContain("| As of | `2026-09-14T00:00:00Z`");
    expect(text).toContain("| Approval standing | no decisions recorded |");
    for (const heading of [
      "## Intent `declared`",
      "## Hard constraints and exceptions",
      "## Workload decisions and deployments",
      "## Architecture",
      "## Implementation requirements",
      "## Evidence gaps",
      "## Unresolved questions",
      "## Retrieving these facts over MCP",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain(
      "- Workload `classification`: no approved, current decision. Do not choose or implement a candidate on your own; ask for a decision `unknown`.",
    );
    expect(text).toContain(
      "CROSSES trust boundary `local` to `remote_provider`",
    );
    expect(text).toContain(
      "- Exact permitted regions and providers for redacted remote processing. `declared`",
    );
  });

  it("presents only an approved, current decision as an instruction", () => {
    const text = renderAgentContext(
      buildProjectFacts(approvedAtlas(), { asOf: AS_OF }),
    );
    expect(text).toContain(
      "standing `approved_current` `approved` · instruction: YES",
    );
    expect(text).toContain(
      "implement with candidate `candidate.classification.remote_unselected` as approved in `decision.classification` `approved`.",
    );
    expect(text).toContain(
      "The content hash shows the approved content is unchanged. It is not evidence freshness.",
    );
    expect(text).toContain(
      "  - Evidence (through linked decisions): `evidence.pricing.remote` `declared` `current`",
    );

    for (const [status, standing] of [
      ["draft", "draft"],
      ["proposed", "proposed_unapproved"],
    ] as const) {
      const contract = structuredClone(approvedAtlas());
      contract.decisions[0]!.status = status;
      contract.approvals = [];
      const draft = renderAgentContext(
        buildProjectFacts(contract, { asOf: AS_OF }),
      );
      expect(draft).toContain(
        `standing \`${standing}\` \`declared\` · instruction: NO`,
      );
      expect(draft).not.toContain("· instruction: YES");
      expect(draft).not.toContain("implement with candidate");
      expect(draft).toContain("Decision `decision.classification` is");
    }

    const stale = structuredClone(approvedAtlas());
    stale.candidates
      .find(
        (entry) => entry.id === "candidate.classification.remote_unselected",
      )!
      .estimates.assumptions.push("edited");
    const staleText = renderAgentContext(
      buildProjectFacts(stale, { asOf: AS_OF }),
    );
    expect(staleText).toContain("standing `approved_stale`");
    expect(staleText).toContain(
      "Not an implementation instruction: it was approved, but its resolved content has changed since approval",
    );
    expect(staleText).not.toContain("implement with candidate");
  });

  it("reports expired evidence under a current approval", () => {
    const contract = structuredClone(approvedAtlas());
    contract.evidence_refs[0]!.refresh.expires_at = "2026-09-10T00:00:00Z";
    const text = renderAgentContext(
      buildProjectFacts(
        valid(resignApproval(contract, "decision.classification")),
        { asOf: AS_OF },
      ),
    );
    expect(text).toContain("instruction: YES");
    expect(text).toContain("freshness `expired`");
    expect(text).toContain(
      "EVIDENCE NOT CURRENT at as_of: `evidence.pricing.remote`",
    );
    expect(text).toContain(
      "Its evidence is not current at as_of (`evidence.pricing.remote`).",
    );
  });

  it("escapes contract text so it cannot become Markdown structure or HTML", () => {
    const text = renderAgentContext(
      buildProjectFacts(hostileContract(), { asOf: AS_OF }),
    );
    expect(text).not.toContain("<img");
    expect(text).not.toContain("[link](");
    expect(text).not.toContain("![i](");
    expect(text).not.toContain(LS);
    expect(text).not.toContain(RLO);
    const lines = text.split("\n");
    // The hostile "# Heading" and "- item" never start a line of their own.
    expect(lines.some((line) => /^#+ Heading/.test(line))).toBe(false);
    expect(lines.some((line) => /^\s*- item/.test(line))).toBe(false);
    expect(lines.filter((line) => line.startsWith("# "))).toHaveLength(1);
    expect(
      lines
        .filter((line) => line.includes("Evil"))
        .every((line) => !line.includes('"] --> pwned')),
    ).toBe(true);
    expect(markdownText("a|b")).toBe("a\\|b");
    expect(markdownText("<x>&")).toBe("&lt;x&gt;&amp;");
  });

  it("gives Claude Code and Codex the same server, arguments and placeholders", () => {
    const text = renderAgentContext(
      buildProjectFacts(allKindsContract(), { asOf: AS_OF }),
    );
    const claude =
      /claude mcp add --transport stdio anvilmark-project -- (.+)$/m.exec(
        text,
      )?.[1];
    const codexArgs = /^args = \[(.+)\]$/m.exec(text)?.[1];
    expect(claude).toBe(
      "node <ANVILMARK_REPO>/packages/mcp/dist/project-server.js --project-dir <PROJECT_DIR>",
    );
    expect(text).toContain("[mcp_servers.anvilmark-project]");
    expect(text).toContain('command = "node"');
    expect(JSON.parse(`[${codexArgs}]`)).toEqual(claude!.split(" ").slice(1));
    expect(text).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\/);
  });
});
