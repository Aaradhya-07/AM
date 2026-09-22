import {
  PROJECT_SCHEMA_VERSION,
  approvalState,
} from "@anvilmark/project-contract";
import { describe, expect, it } from "vitest";

import {
  GENERATOR_ID,
  GENERATOR_VERSION,
  buildProjectFacts,
  contractHash,
} from "../src/index.js";
import {
  AS_OF,
  allKindsContract,
  approvedAtlas,
  atlas,
  resignApproval,
  valid,
} from "./helpers.js";

describe("source marker", () => {
  it("identifies project, revisions, hash, schema, generator, projection and as_of", async () => {
    const contract = await atlas();
    const facts = buildProjectFacts(contract, {
      asOf: AS_OF,
      stateRevision: 3,
    });
    expect(facts.source).toEqual({
      project_id: "atlas-support-desk",
      contract_revision: 1,
      state_revision: 3,
      contract_hash: contractHash(contract),
      schema_version: PROJECT_SCHEMA_VERSION,
      generator: `${GENERATOR_ID}/${GENERATOR_VERSION}`,
      projection: "remote-default",
      as_of: AS_OF,
    });
  });

  it("uses the given as_of, never project.updated_at or a clock", async () => {
    const contract = await atlas();
    const facts = buildProjectFacts(contract, { asOf: "2030-01-01T00:00:00Z" });
    expect(facts.source.as_of).toBe("2030-01-01T00:00:00Z");
    expect(JSON.stringify(facts)).not.toContain(contract.project.updated_at);
  });

  it.each([
    "yesterday",
    "2026-09-14",
    "2026-09-14T00:00:00",
    "2026-09-14T00:00:00Z\n%% x",
  ])("refuses an as_of that is not an RFC 3339 timestamp: %j", async (asOf) => {
    const contract = await atlas();
    expect(() => buildProjectFacts(contract, { asOf })).toThrow(/RFC 3339/);
  });

  it("changes the hash on any contract change, including architecture", async () => {
    const contract = await atlas();
    const changed = structuredClone(contract);
    changed.architecture.nodes[0]!.name = "Renamed";
    expect(contractHash(changed)).not.toBe(contractHash(contract));
    // Canonical: key order in the source does not matter.
    expect(contractHash(JSON.parse(JSON.stringify(contract)))).toBe(
      contractHash(contract),
    );
  });
});

describe("determinism", () => {
  it("is independent of array order in the contract", () => {
    const contract = allKindsContract();
    const shuffled = structuredClone(contract);
    shuffled.architecture.nodes.reverse();
    shuffled.architecture.relationships.reverse();
    shuffled.constraints.reverse();
    shuffled.workloads.reverse();
    const a = buildProjectFacts(contract, { asOf: AS_OF });
    const b = buildProjectFacts(shuffled, { asOf: AS_OF });
    expect(JSON.stringify(b.architecture)).toBe(JSON.stringify(a.architecture));
    expect(JSON.stringify(b.constraints)).toBe(JSON.stringify(a.constraints));
    expect(JSON.stringify(b.workloads)).toBe(JSON.stringify(a.workloads));
  });
});

describe("Atlas architecture", () => {
  it("derives placement, crossings, constraint links and unresolved support", async () => {
    const facts = buildProjectFacts(await atlas(), { asOf: AS_OF });
    const { nodes, relationships, trust_boundaries } = facts.architecture;
    expect(nodes.map((node) => node.id)).toEqual([
      "pii-redactor",
      "remote-model-provider",
      "ticket-classifier",
      "ticket-intake",
    ]);
    expect(trust_boundaries).toEqual([
      {
        boundary: "local",
        nodes: ["pii-redactor", "ticket-classifier", "ticket-intake"],
        unconfirmed_nodes: [],
      },
      {
        boundary: "remote_provider",
        nodes: ["remote-model-provider"],
        unconfirmed_nodes: [],
      },
    ]);
    const remote = relationships.find(
      (entry) => entry.id === "ticket-classifier-to-remote-model-provider",
    );
    expect(remote?.crossing).toEqual({ from: "local", to: "remote_provider" });
    expect(remote?.data_classification).toBe("redacted_customer_ticket");
    const redactor = nodes.find((node) => node.id === "pii-redactor");
    expect(redactor?.associated_workloads).toEqual([
      "classification",
      "pii_redaction",
    ]);
    expect(redactor?.constraints).toContainEqual({
      constraint_ref: "privacy.raw_ticket_remote",
      link: "sanitizer named by conformance rule rule.raw_ticket_never_remote",
      authoritative: true,
    });
    // No decision exists: every element is visibly unresolved, never implied.
    for (const node of nodes) {
      expect(node.decisions).toEqual([]);
      expect(node.unresolved).toContain(
        "no decision is linked to this component",
      );
      expect(node.knowledge).toBe("declared");
    }
    for (const relationship of relationships) {
      expect(relationship.unresolved.join(" ")).toMatch(
        /no approved, current decision/,
      );
    }
    expect(
      facts.workloads.every((entry) => entry.effective_decision === null),
    ).toBe(true);
  });
});

describe("non-Atlas architecture", () => {
  it("links bindings, component scope, workload placement and unknown classifications", () => {
    const contract = allKindsContract();
    const facts = buildProjectFacts(contract, { asOf: AS_OF });
    const node = (id: string) =>
      facts.architecture.nodes.find((entry) => entry.id === id)!;
    const relationship = (id: string) =>
      facts.architecture.relationships.find((entry) => entry.id === id)!;

    expect(node("api").decisions).toEqual([
      {
        decision_ref: "decision.classification",
        link: "binding",
        standing: "approved_current",
        authoritative: true,
      },
    ]);
    expect(node("api").unresolved).toEqual([]);
    expect(node("queue").unresolved).toEqual([
      "no decision is linked to this component",
    ]);
    expect(node("store").associated_workloads).toEqual([]);

    expect(relationship("agent-uses-api").crossing).toEqual({
      from: "local",
      to: "internal_network",
    });
    expect(relationship("api-deployed-in-runtime").crossing).toBeNull();
    expect(relationship("api-connects-queue").unresolved).toEqual([
      "data classification not declared",
      "no workload is declared for this relationship",
    ]);
    expect(relationship("api-to-vendor").unresolved).toContain(
      "data classification not declared on a flow crossing from internal_network to third_party",
    );
    expect(relationship("api-to-provider").decisions).toEqual([
      {
        decision_ref: "decision.classification",
        standing: "approved_current",
        authoritative: true,
      },
    ]);
    // Structural relationships never claim a data classification.
    expect(relationship("runtime-composed-of-store").unresolved).toEqual([
      "no workload is declared for this relationship",
    ]);
  });

  it("links a component-scoped decision to its node", () => {
    const contract = structuredClone(allKindsContract());
    contract.decisions.push({
      ...structuredClone(contract.decisions[0]!),
      id: "decision.queue",
      status: "draft",
      scope: { kind: "component", component_ref: "queue" },
      alternatives: [],
      unresolved_constraints: [],
    });
    const facts = buildProjectFacts(valid(contract), { asOf: AS_OF });
    const queue = facts.architecture.nodes.find(
      (entry) => entry.id === "queue",
    );
    expect(queue?.decisions).toEqual([
      {
        decision_ref: "decision.queue",
        link: "component_scope",
        standing: "draft",
        authoritative: true,
      },
    ]);
    expect(queue?.unresolved).toContain(
      "no linked decision is approved and current",
    );
    expect(facts.project_decisions.map((entry) => entry.id)).toEqual([
      "decision.queue",
    ]);
    expect(facts.project_decisions[0]?.instruction_eligible).toBe(false);
  });
});

describe("decision standing", () => {
  it("treats only an approved, current decision as an instruction", () => {
    const facts = buildProjectFacts(approvedAtlas(), { asOf: AS_OF });
    const workload = facts.workloads.find(
      (entry) => entry.id === "classification",
    )!;
    const decision = workload.decisions[0]!;
    expect(decision.standing).toBe("approved_current");
    expect(decision.instruction_eligible).toBe(true);
    expect(decision.knowledge).toBe("approved");
    expect(decision.approval.content_hash).toBe(
      "81b8559b4cd6fdddd5addfb4bd065caa574529f8802e4f1bfe85292efe481f1d",
    );
    expect(workload.effective_decision).toBe("decision.classification");
  });

  it("marks a decision whose approved content changed as stale and not an instruction", () => {
    const contract = structuredClone(approvedAtlas());
    const candidate = contract.candidates.find(
      (entry) => entry.id === "candidate.classification.remote_unselected",
    )!;
    candidate.estimates.assumptions = [
      ...candidate.estimates.assumptions,
      "changed after approval",
    ];
    expect(approvalState(contract, "decision.classification").state).toBe(
      "stale",
    );
    const facts = buildProjectFacts(contract, { asOf: AS_OF });
    const workload = facts.workloads.find(
      (entry) => entry.id === "classification",
    )!;
    expect(workload.decisions[0]?.standing).toBe("approved_stale");
    expect(workload.decisions[0]?.instruction_eligible).toBe(false);
    expect(workload.decisions[0]?.knowledge).toBe("declared");
    expect(workload.effective_decision).toBeNull();
  });

  it("marks an approval whose content cannot be resolved", () => {
    const contract = structuredClone(approvedAtlas());
    contract.decisions[0]!.selected_candidate_ref = "candidate.missing";
    const facts = buildProjectFacts(contract, { asOf: AS_OF });
    expect(
      facts.workloads.find((entry) => entry.id === "classification")
        ?.decisions[0]?.standing,
    ).toBe("approved_unresolvable");
  });

  it.each([
    ["draft", "draft"],
    ["proposed", "proposed_unapproved"],
    ["rejected", "rejected"],
    ["superseded", "superseded"],
  ] as const)(
    "reports status %s as standing %s, never an instruction",
    (status, standing) => {
      const contract = structuredClone(approvedAtlas());
      contract.decisions[0]!.status = status;
      contract.approvals = [];
      const facts = buildProjectFacts(contract, { asOf: AS_OF });
      const decision = facts.workloads.find(
        (entry) => entry.id === "classification",
      )!.decisions[0]!;
      expect(decision.standing).toBe(standing);
      expect(decision.instruction_eligible).toBe(false);
      expect(decision.approval.content_hash).toBeNull();
    },
  );

  it("keeps an approval current while reporting its evidence as expired", () => {
    const contract = structuredClone(approvedAtlas());
    contract.evidence_refs[0]!.refresh.expires_at = "2026-09-10T00:00:00Z";
    const signed = valid(resignApproval(contract, "decision.classification"));
    const before = buildProjectFacts(signed, { asOf: "2026-09-05T00:00:00Z" });
    const after = buildProjectFacts(signed, { asOf: AS_OF });
    const decision = (facts: typeof before) =>
      facts.workloads.find((entry) => entry.id === "classification")!
        .decisions[0]!;
    expect(decision(before).evidence_not_current).toEqual([]);
    expect(decision(after).standing).toBe("approved_current");
    expect(decision(after).evidence[0]?.freshness).toBe("expired");
    expect(decision(after).evidence_not_current).toEqual([
      "evidence.pricing.remote",
    ]);
  });
});

describe("constraints and exceptions", () => {
  it("evaluates exception expiry and review at as_of", () => {
    const contract = structuredClone(approvedAtlas());
    contract.constraints.find(
      (entry) => entry.id === "privacy.raw_ticket_remote",
    )!.exceptions = [
      {
        id: "exception.pilot",
        reason: "Pilot with a redacted sample",
        decision_ref: null,
        approved_by: "local-reviewer",
        expires_at: "2026-09-10T00:00:00Z",
        review_at: "2026-09-01T00:00:00Z",
      },
    ];
    const checked = valid(contract);
    const at = (asOf: string) =>
      buildProjectFacts(checked, { asOf }).constraints.find(
        (entry) => entry.id === "privacy.raw_ticket_remote",
      )!.exceptions[0]!;
    expect(at("2026-08-20T00:00:00Z")).toMatchObject({
      active_at_as_of: true,
      review_due_at_as_of: false,
    });
    expect(at(AS_OF)).toMatchObject({
      active_at_as_of: false,
      review_due_at_as_of: true,
    });
    expect(at(AS_OF)).not.toHaveProperty("local_approved_by");
  });

  it("labels knowledge: user constraints declared, unknown usage unknown", async () => {
    const contract = structuredClone(await atlas());
    contract.workloads[0]!.expected_usage.calls_per_month = null;
    contract.workloads[0]!.expected_usage.basis = "unknown";
    const facts = buildProjectFacts(valid(contract), { asOf: AS_OF });
    expect(
      facts.constraints.every((entry) => entry.knowledge === "declared"),
    ).toBe(true);
    expect(
      facts.workloads.find((entry) => entry.id === contract.workloads[0]!.id)
        ?.usage,
    ).toEqual({
      knowledge: "unknown",
      basis: "unknown",
      calls_per_month: null,
    });
  });
});
