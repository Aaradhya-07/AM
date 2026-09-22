import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectContract } from "@anvilmark/project-contract";
import { architectureContentHash } from "@anvilmark/project-contract";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildProjectFacts,
  mermaidNodeId,
  presentFreshness,
  renderAgentContext,
  renderCalm,
  renderMermaid,
  runProjectQuery,
} from "../src/index.js";
import {
  AS_OF,
  allKindsContract,
  approvedAtlas,
  officialCalmValidate,
  resignApproval,
  valid,
} from "./helpers.js";

const PROPOSAL = "prop-20260914T120000Z-0a1b2c3d";

const scratch: string[] = [];
function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "anvilmark-context-amend-"));
  scratch.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content, "utf8");
  return file;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const proposed = {
  kind: "agent_proposed" as const,
  proposal_ref: PROPOSAL,
  confirmed_at: null,
  confirmed_content_hash: null,
};

/**
 * All-kinds architecture where the provider node, the api-to-provider
 * relationship and the decision binding came from an unconfirmed proposal.
 */
function proposedContract(): ProjectContract {
  const contract = structuredClone(allKindsContract());
  const provider = contract.architecture.nodes.find(
    (node) => node.id === "provider",
  )!;
  provider.origin = { ...proposed };
  contract.architecture.relationships.find(
    (entry) => entry.id === "api-to-provider",
  )!.origin = { ...proposed };
  contract.architecture.decision_bindings[0]!.origin = { ...proposed };
  return valid(contract);
}

function confirmAll(contract: ProjectContract): ProjectContract {
  const next = structuredClone(contract);
  for (const node of next.architecture.nodes) {
    if (node.origin.kind === "agent_proposed") {
      node.origin.confirmed_at = "2026-09-14T13:00:00Z";
      node.origin.confirmed_content_hash = architectureContentHash({
        type: "node",
        value: node,
      });
    }
  }
  for (const relationship of next.architecture.relationships) {
    if (relationship.origin.kind === "agent_proposed") {
      relationship.origin.confirmed_at = "2026-09-14T13:00:00Z";
      relationship.origin.confirmed_content_hash = architectureContentHash({
        type: "relationship",
        value: relationship,
      });
    }
  }
  for (const binding of next.architecture.decision_bindings) {
    if (binding.origin.kind === "agent_proposed") {
      binding.origin.confirmed_at = "2026-09-14T13:00:00Z";
      binding.origin.confirmed_content_hash = architectureContentHash({
        type: "decision_binding",
        value: binding,
      });
    }
  }
  return valid(next);
}

describe("unconfirmed agent-proposed architecture", () => {
  it("is inferred, keeps declared values, and makes dependent conclusions unknown", () => {
    const facts = buildProjectFacts(proposedContract(), { asOf: AS_OF });
    const node = (id: string) =>
      facts.architecture.nodes.find((entry) => entry.id === id)!;
    const relationship = (id: string) =>
      facts.architecture.relationships.find((entry) => entry.id === id)!;

    const provider = node("provider");
    expect(provider.knowledge).toBe("inferred");
    expect(provider.origin).toEqual({
      kind: "agent_proposed",
      proposal_ref: PROPOSAL,
      confirmation: "unconfirmed",
      confirmed_at: null,
      trusted: false,
    });
    expect(provider.trust_boundary).toBe("remote_provider");
    expect(provider.effective_trust_boundary).toBe("unknown");
    expect(provider.unresolved[0]).toContain(
      "anvilmark architecture confirm node provider",
    );

    // The declared crossing stays visible; the effective one is unknown.
    const toProvider = relationship("api-to-provider");
    expect(toProvider.crossing).toEqual({
      from: "internal_network",
      to: "remote_provider",
    });
    expect(toProvider.effective_crossing).toBe("unknown");
    expect(toProvider.knowledge).toBe("inferred");
    expect(toProvider.unresolved.join(" ")).toContain(
      "possible crossing from internal_network to remote_provider, which depends on unconfirmed relationship api-to-provider and node provider",
    );
    expect(toProvider.decisions.every((entry) => !entry.authoritative)).toBe(
      true,
    );

    // Relationships between trusted nodes keep effective conclusions.
    expect(relationship("api-connects-queue").effective_crossing).toBe("none");

    // The unconfirmed binding is shown but is no support.
    const api = node("api");
    expect(api.origin.trusted).toBe(true);
    expect(api.decisions).toContainEqual({
      decision_ref: "decision.classification",
      link: "binding",
      standing: "approved_current",
      authoritative: false,
    });
    expect(api.unresolved.join(" ")).toContain(
      "agent-proposed binding decision.classification is unconfirmed",
    );
    expect(facts.architecture.decision_bindings[0]).toMatchObject({
      decision_ref: "decision.classification",
      knowledge: "inferred",
      origin: { confirmation: "unconfirmed", trusted: false },
    });
    expect(facts.architecture.trust_boundaries).toContainEqual({
      boundary: "remote_provider",
      nodes: ["provider"],
      unconfirmed_nodes: ["provider"],
    });
  });

  it("becomes declared and effective once each element's content is confirmed", () => {
    const facts = buildProjectFacts(confirmAll(proposedContract()), {
      asOf: AS_OF,
    });
    const provider = facts.architecture.nodes.find(
      (entry) => entry.id === "provider",
    )!;
    expect(provider.knowledge).toBe("declared");
    expect(provider.origin).toMatchObject({
      kind: "agent_proposed",
      proposal_ref: PROPOSAL,
      confirmation: "confirmed",
      trusted: true,
    });
    expect(provider.effective_trust_boundary).toBe("remote_provider");
    const toProvider = facts.architecture.relationships.find(
      (entry) => entry.id === "api-to-provider",
    )!;
    expect(toProvider.effective_crossing).toBe("crossing");
    expect(toProvider.decisions.every((entry) => entry.authoritative)).toBe(
      true,
    );
    const api = facts.architecture.nodes.find((entry) => entry.id === "api")!;
    expect(api.decisions[0]?.authoritative).toBe(true);
    // Confirmation never makes anything measured.
    expect(
      JSON.stringify(facts.architecture).includes('"knowledge":"measured"'),
    ).toBe(false);
  });

  it("is confirmation_stale after a change to confirmed content", () => {
    const edited = structuredClone(confirmAll(proposedContract()));
    edited.architecture.nodes.find(
      (node) => node.id === "provider",
    )!.trust_boundary = "third_party";
    const facts = buildProjectFacts(valid(edited), { asOf: AS_OF });
    const provider = facts.architecture.nodes.find(
      (entry) => entry.id === "provider",
    )!;
    expect(provider.origin.confirmation).toBe("confirmation_stale");
    expect(provider.origin.confirmed_at).toBe("2026-09-14T13:00:00Z");
    expect(provider.effective_trust_boundary).toBe("unknown");
    expect(provider.unresolved[0]).toContain("its content has changed since");
    expect(
      facts.architecture.relationships.find(
        (entry) => entry.id === "api-to-provider",
      )?.effective_crossing,
    ).toBe("unknown");
  });

  it("renders the same standings in Mermaid, CALM, agent context and MCP", () => {
    const contract = proposedContract();
    const facts = buildProjectFacts(contract, { asOf: AS_OF });
    const mermaid = renderMermaid(facts);
    expect(mermaid).toContain(
      'subgraph tb_unknown["Trust boundary: UNKNOWN (unconfirmed agent proposals)"]',
    );
    expect(mermaid).toContain(
      "INFERRED: unconfirmed proposal · trust boundary UNKNOWN (declared remote_provider)",
    );
    expect(mermaid).toContain(
      "POSSIBLE crossing internal_network to remote_provider: UNKNOWN (depends on unconfirmed architecture)",
    );
    expect(mermaid).toMatch(
      new RegExp(`${mermaidNodeId("api")} ==>\\|"api-to-provider`),
    );
    expect(mermaid).toContain(`class ${mermaidNodeId("provider")} inferred`);

    const calm = JSON.parse(renderCalm(facts));
    const provider = calm.nodes.find(
      (entry: Record<string, unknown>) => entry["unique-id"] === "provider",
    );
    expect(provider.metadata.anvilmark).toMatchObject({
      knowledge: "inferred",
      "effective-trust-boundary": "unknown",
      origin: {
        kind: "agent_proposed",
        "proposal-ref": PROPOSAL,
        confirmation: "unconfirmed",
        trusted: false,
      },
    });
    expect(
      calm.relationships.find(
        (entry: Record<string, unknown>) =>
          entry["unique-id"] === "api-to-provider",
      ).metadata.anvilmark["effective-trust-boundary-crossing"],
    ).toBe("unknown");

    const context = renderAgentContext(facts);
    expect(context).toContain(
      "POSSIBLE CROSSING `internal_network` to `remote_provider`: effective crossing UNKNOWN `unknown`",
    );
    expect(context).toContain(
      `agent-proposed in proposal \`${PROPOSAL}\`; UNCONFIRMED \`inferred\``,
    );
    expect(context).toContain("- Do not rely on inferred architecture:");

    const answer = runProjectQuery(
      "get_architecture_context",
      { component: "provider" },
      { contract, stateRevision: 3, asOf: AS_OF, projection: "remote-default" },
    );
    expect(answer.ok).toBe(true);
    const data = (
      answer as {
        data: {
          nodes: {
            id: string;
            origin: unknown;
            effective_trust_boundary: string;
          }[];
        };
      }
    ).data;
    expect(data.nodes.find((entry) => entry.id === "provider")).toMatchObject({
      effective_trust_boundary: "unknown",
      origin: { confirmation: "unconfirmed" },
    });
  });
});

describe("declared interfaces", () => {
  function withInterfaces(): ProjectContract {
    const contract = structuredClone(allKindsContract());
    const api = contract.architecture.nodes.find((node) => node.id === "api")!;
    api.interfaces = [
      { id: "api-https", protocol: "HTTPS", description: "Desk REST API" },
      { id: "api-grpc", protocol: "gRPC", description: null },
    ];
    const provider = contract.architecture.nodes.find(
      (node) => node.id === "provider",
    )!;
    provider.interfaces = [
      { id: "provider-endpoint", protocol: null, description: null },
    ];
    const edge = contract.architecture.relationships.find(
      (entry) => entry.id === "api-to-provider",
    )!;
    edge.source_interface_ref = "api-grpc";
    edge.destination_interface_ref = "provider-endpoint";
    return valid(contract);
  }

  it("exports declared ids natively and protocols only as ANVILMARK metadata", () => {
    const facts = buildProjectFacts(withInterfaces(), { asOf: AS_OF });
    const text = renderCalm(facts);
    const calm = JSON.parse(text);
    const api = calm.nodes.find(
      (entry: Record<string, unknown>) => entry["unique-id"] === "api",
    );
    expect(api.interfaces).toEqual([
      { "unique-id": "api-grpc" },
      { "unique-id": "api-https" },
    ]);
    expect(api.metadata.anvilmark.interfaces).toEqual({
      "api-grpc": { protocol: "gRPC", description: null },
      "api-https": { protocol: "HTTPS", description: "Desk REST API" },
    });
    const provider = calm.nodes.find(
      (entry: Record<string, unknown>) => entry["unique-id"] === "provider",
    );
    expect(provider.metadata.anvilmark.interfaces).toEqual({
      "provider-endpoint": { protocol: null, description: null },
    });
    const edge = calm.relationships.find(
      (entry: Record<string, unknown>) =>
        entry["unique-id"] === "api-to-provider",
    );
    expect(edge["relationship-type"]).toEqual({
      connects: {
        source: { node: "api", interfaces: ["api-grpc"] },
        destination: { node: "provider", interfaces: ["provider-endpoint"] },
      },
    });
    // No relationship protocol, port, host or URL is invented.
    expect(edge).not.toHaveProperty("protocol");
    for (const key of ['"protocol": "gRPC"', '"port"', '"host"', '"url"']) {
      if (key === '"protocol": "gRPC"') {
        expect(text.split(key).length - 1).toBe(1);
      } else {
        expect(text).not.toContain(key);
      }
    }

    const mermaid = renderMermaid(facts);
    expect(mermaid).toContain("interfaces: api-grpc (gRPC), api-https (HTTPS)");
    expect(mermaid).toContain("interfaces: api-grpc to provider-endpoint");
    const context = renderAgentContext(facts);
    expect(context).toContain("`provider-endpoint` protocol unknown `unknown`");
  });

  const calmBin = process.env.ANVILMARK_CALM_BIN;
  it.skipIf(calmBin === undefined)(
    "validates with the official CALM CLI, and rejects broken interface references",
    () => {
      const base = renderCalm(
        buildProjectFacts(withInterfaces(), { asOf: AS_OF }),
      );
      const proposedText = renderCalm(
        buildProjectFacts(proposedContract(), { asOf: AS_OF }),
      );
      for (const [name, text] of [
        ["interfaces", base],
        ["unconfirmed-proposal", proposedText],
      ] as const) {
        const result = officialCalmValidate(
          calmBin!,
          tempFile(`${name}.calm.json`, text),
        );
        expect(result, name).toMatchObject({
          hasErrors: false,
          hasWarnings: false,
        });
      }
      const undefinedInterface = JSON.parse(base);
      undefinedInterface.relationships.find(
        (entry: Record<string, unknown>) =>
          entry["unique-id"] === "api-to-provider",
      )["relationship-type"].connects.destination.interfaces = ["not-declared"];
      const wrongNode = JSON.parse(base);
      wrongNode.relationships.find(
        (entry: Record<string, unknown>) =>
          entry["unique-id"] === "api-to-provider",
      )["relationship-type"].connects.source.interfaces = ["provider-endpoint"];
      for (const [name, document] of [
        ["undefined-interface", undefinedInterface],
        ["interface-on-wrong-node", wrongNode],
      ] as const) {
        const result = officialCalmValidate(
          calmBin!,
          tempFile(
            `${name}.calm.json`,
            `${JSON.stringify(document, null, 2)}\n`,
          ),
        );
        expect(result.hasErrors, name).toBe(true);
      }
    },
    300_000,
  );
});

describe("constraint standing knowledge (R4)", () => {
  function projectedCost(): ProjectContract {
    const contract = structuredClone(approvedAtlas());
    const candidate = contract.candidates.find(
      (entry) => entry.id === "candidate.classification.remote_unselected",
    )!;
    candidate.estimates.monthly_effective_cost_usd = 100;
    candidate.estimates.basis =
      "Synthetic official pricing multiplied by declared usage";
    candidate.estimates.assumptions = [
      "Synthetic user-declared call volume and token usage",
    ];
    candidate.constraint_results.push({
      constraint_ref: "budget.ai_monthly",
      status: "pass",
      evidence_refs: ["evidence.pricing.remote"],
      explanation: "Synthetic projected calculation, no measurement",
      determinism: "deterministic",
      evaluated_at: "2026-09-14T00:00:00Z",
    } as (typeof candidate.constraint_results)[number]);
    return valid(resignApproval(contract, "decision.classification"));
  }

  const standingOf = (contract: ProjectContract, ref: string) =>
    buildProjectFacts(contract, { asOf: AS_OF })
      .workloads.find((entry) => entry.id === "classification")!
      .decisions[0]!.selected_candidate!.constraint_standings.find(
        (entry) => entry.constraint_ref === ref,
      )!;

  it("labels a projected cost pass estimated, and says why, in facts, context and MCP", () => {
    const contract = projectedCost();
    const standing = standingOf(contract, "budget.ai_monthly");
    expect(standing).toMatchObject({ outcome: "pass", knowledge: "estimated" });
    expect(standing.knowledge_basis).toContain("not a measured cost");

    const context = renderAgentContext(
      buildProjectFacts(contract, { asOf: AS_OF }),
    );
    expect(context).toContain("`budget.ai_monthly`: pass `estimated`");
    expect(context).not.toContain("`budget.ai_monthly`: pass `measured`");

    const answer = runProjectQuery(
      "get_workload_decision",
      { workload: "classification" },
      { contract, stateRevision: 1, asOf: AS_OF, projection: "remote-default" },
    ) as unknown as {
      data: {
        workload: {
          decisions: {
            selected_candidate: {
              constraint_standings: {
                constraint_ref: string;
                knowledge: string;
              }[];
            };
          }[];
        };
      };
    };
    expect(
      answer.data.workload.decisions[0]!.selected_candidate.constraint_standings.find(
        (entry) => entry.constraint_ref === "budget.ai_monthly",
      )?.knowledge,
    ).toBe("estimated");
  });

  it("labels a pass supported by an admissible observation measured", () => {
    const contract = structuredClone(projectedCost());
    contract.evidence_refs.push({
      id: "evidence.availability.observed",
      kind: "deterministic_observation",
      subject: "classification provider failover structure",
      producer: { name: "synthetic-structure-check", version: "1.0.0" },
      observed_at: "2026-09-13T00:00:00Z",
      source: { type: "manual", locator: null },
      applies_to: {
        candidate_ref: "candidate.classification.remote_unselected",
        workload_ref: "classification",
        hardware_ref: null,
        constraint_refs: ["availability.classification_provider"],
      },
      value: { fallback: "local candidate declared" },
      confidence: "high",
      caveats: [],
      refresh: { policy: "on_hardware_or_model_change", expires_at: null },
    } as (typeof contract.evidence_refs)[number]);
    const candidate = contract.candidates.find(
      (entry) => entry.id === "candidate.classification.remote_unselected",
    )!;
    candidate.constraint_results.push({
      constraint_ref: "availability.classification_provider",
      status: "pass",
      evidence_refs: ["evidence.availability.observed"],
      explanation: null,
      determinism: "deterministic",
      evaluated_at: "2026-09-14T00:00:00Z",
    } as (typeof candidate.constraint_results)[number]);
    const standing = standingOf(
      contract,
      "availability.classification_provider",
    );
    expect(standing).toMatchObject({ outcome: "pass", knowledge: "measured" });
    expect(standing.knowledge_basis).toContain(
      "evidence.availability.observed (deterministic_observation)",
    );
  });

  it("labels unsupported or inadequately supported results unknown", () => {
    const contract = structuredClone(projectedCost());
    const candidate = contract.candidates.find(
      (entry) => entry.id === "candidate.classification.remote_unselected",
    )!;
    // Asserted pass on a hard quality gate with only pricing: below the floor.
    candidate.constraint_results.push({
      constraint_ref: "quality.classification_f1",
      status: "pass",
      evidence_refs: ["evidence.pricing.remote"],
      explanation: null,
      determinism: "deterministic",
      evaluated_at: "2026-09-14T00:00:00Z",
    } as (typeof candidate.constraint_results)[number]);
    expect(standingOf(contract, "quality.classification_f1")).toMatchObject({
      outcome: "unknown",
      knowledge: "unknown",
    });
    expect(standingOf(contract, "quality.schema_validity")).toMatchObject({
      outcome: "unknown",
      knowledge: "unknown",
    });
    // Pricing that expires before as_of no longer supports the projection.
    const expired = structuredClone(projectedCost());
    expired.evidence_refs[0]!.refresh.expires_at = "2026-09-10T00:00:00Z";
    expect(
      standingOf(
        valid(resignApproval(expired, "decision.classification")),
        "budget.ai_monthly",
      ),
    ).toMatchObject({ outcome: "unknown", knowledge: "unknown" });
  });
});

describe("present freshness (R3)", () => {
  it("separates byte-stable snapshots from current standings", () => {
    const contract = structuredClone(approvedAtlas());
    contract.evidence_refs[0]!.refresh.expires_at = "2026-09-15T00:00:00Z";
    const signed = valid(resignApproval(contract, "decision.classification"));
    expect(
      presentFreshness(signed, {
        asOf: AS_OF,
        now: "2026-09-14T23:00:00Z",
      }),
    ).toEqual({
      status: "current",
      as_of: AS_OF,
      evaluated_at: "2026-09-14T23:00:00Z",
      differences: [],
    });
    const later = presentFreshness(signed, {
      asOf: AS_OF,
      now: "2026-09-16T00:00:00Z",
    });
    expect(later.status).toBe("stale_time");
    expect(later.differences).toEqual([
      "evidence evidence.pricing.remote was current at 2026-09-14T00:00:00Z and is expired at 2026-09-16T00:00:00Z",
    ]);
  });
});
