import { describe, expect, it } from "vitest";

import {
  ADAPTER_PROTOCOL_VERSION,
  INTELLIGENCE_PROTOCOL_VERSION,
  INTELLIGENCE_TASKS,
  IntelligenceRequestSchema,
  buildIntelligenceRequest,
  parseProposalDocument,
  proposedArchitecture,
  reviewProposal,
} from "../src/index.js";
import { fixtureContract } from "./helpers.js";

/**
 * Intelligence protocol 0.1.0-draft.2 (amendment 8,
 * docs/vnext/09-milestone-4-architecture-amendment-proposal.md).
 */

const ARCHITECTURE = {
  proposed_architecture_nodes: [
    {
      id: "response-drafter",
      kind: "service",
      name: "Response Drafter",
      trust_boundary: "local",
      description: null,
    },
  ],
  proposed_relationships: [
    {
      id: "drafter-to-provider",
      kind: "connects",
      source: "response-drafter",
      destination: "remote-provider",
      workload_ref: null,
      data_classification: null,
    },
  ],
  proposed_decision_bindings: [
    { decision_ref: "decision.classification.v1", node_refs: ["x"] },
  ],
};

describe("protocol versions", () => {
  it("keeps the evidence-adapter envelope at draft.1 and builds requests at draft.2", () => {
    expect(ADAPTER_PROTOCOL_VERSION).toBe("0.1.0-draft.1");
    expect(INTELLIGENCE_PROTOCOL_VERSION).toBe("0.1.0-draft.2");
    const built = buildIntelligenceRequest(fixtureContract(), {
      task: "propose_architecture",
      execution: "remote",
    });
    expect(built.request.protocol_version).toBe("0.1.0-draft.2");
    expect(INTELLIGENCE_TASKS).toContain("propose_architecture");
    expect(built.request.instructions).toContain(
      'protocol_version: "0.1.0-draft.2"',
    );
    expect(built.request.instructions).toContain(
      "proposed_architecture_nodes: array of",
    );
    expect(built.request.instructions).toContain(
      "recorded as agent-proposed and unconfirmed",
    );
    // Architecture is not a projection field; nothing new is sent.
    expect(Object.keys(built.request.projection)).not.toContain("architecture");
  });

  it("still accepts a request exported at draft.1", () => {
    expect(
      IntelligenceRequestSchema.safeParse({
        protocol_version: "0.1.0-draft.1",
        task: "propose_constraints",
        projection: {},
        instructions: "Suggest missing constraints.",
      }).success,
    ).toBe(true);
  });
});

describe("draft.1 proposals", () => {
  it("reject architecture arrays as forbidden fields, even when empty", () => {
    for (const fields of [
      ARCHITECTURE,
      {
        proposed_architecture_nodes: [],
        proposed_relationships: [],
        proposed_decision_bindings: [],
      },
    ]) {
      const parsed = parseProposalDocument({
        protocol_version: "0.1.0-draft.1",
        ...fields,
      });
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.errors[0]?.code).toBe("forbidden_proposal");
      expect(parsed.errors[0]?.detail.fields).toEqual([
        "proposed_architecture_nodes",
        "proposed_decision_bindings",
        "proposed_relationships",
      ]);
    }
  });

  it("parse to no proposed architecture, and parse again identically", () => {
    const parsed = parseProposalDocument({
      protocol_version: "0.1.0-draft.1",
      questions: ["Which regions?"],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(proposedArchitecture(parsed.proposal)).toEqual({
      nodes: [],
      relationships: [],
      bindings: [],
    });
    const again = parseProposalDocument(parsed.proposal);
    expect(again.ok && again.proposal).toEqual(parsed.proposal);
  });
});

describe("draft.2 proposals", () => {
  it("accept architecture arrays and parse again identically", () => {
    const parsed = parseProposalDocument({
      protocol_version: "0.1.0-draft.2",
      ...ARCHITECTURE,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const architecture = proposedArchitecture(parsed.proposal);
    expect(architecture.nodes.map((node) => node.id)).toEqual([
      "response-drafter",
    ]);
    expect(architecture.bindings).toHaveLength(1);
    expect(parseProposalDocument(parsed.proposal).ok).toBe(true);
    expect(reviewProposal(fixtureContract(), parsed.proposal).accepted).toBe(
      true,
    );
  });

  it.each([
    ["origin", { origin: { kind: "user" } }],
    ["confirmed_at", { confirmed_at: "2026-09-14T00:00:00Z" }],
    ["confirmed_content_hash", { confirmed_content_hash: "a".repeat(64) }],
    ["interfaces", { interfaces: [{ id: "x" }] }],
  ])("reject %s supplied on a proposed node", (field, extra) => {
    const parsed = parseProposalDocument({
      protocol_version: "0.1.0-draft.2",
      proposed_architecture_nodes: [
        { ...ARCHITECTURE.proposed_architecture_nodes[0], ...extra },
      ],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0]?.detail.fields).toEqual([field]);
  });

  it("rejects origin on relationships and bindings and invalid enumerations", () => {
    for (const document of [
      {
        proposed_relationships: [
          {
            ...ARCHITECTURE.proposed_relationships[0],
            origin: { kind: "user" },
          },
        ],
      },
      {
        proposed_decision_bindings: [
          { decision_ref: "d", node_refs: ["n"], origin: { kind: "user" } },
        ],
      },
      {
        proposed_relationships: [
          {
            ...ARCHITECTURE.proposed_relationships[0],
            source_interface_ref: "x",
          },
        ],
      },
      {
        proposed_architecture_nodes: [
          {
            ...ARCHITECTURE.proposed_architecture_nodes[0],
            trust_boundary: "internet",
          },
        ],
      },
      { proposed_decision_bindings: [{ decision_ref: "d", node_refs: [] }] },
    ]) {
      expect(
        parseProposalDocument({
          protocol_version: "0.1.0-draft.2",
          ...document,
        }).ok,
      ).toBe(false);
    }
  });

  it("rejects an unknown protocol version", () => {
    const parsed = parseProposalDocument({
      protocol_version: "0.1.0-draft.3",
      ...ARCHITECTURE,
    });
    expect(parsed.ok).toBe(false);
  });
});
