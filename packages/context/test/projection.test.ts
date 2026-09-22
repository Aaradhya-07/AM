import type { ProjectContract } from "@anvilmark/project-contract";
import { describe, expect, it } from "vitest";

import {
  PROJECT_TOOL_NAMES,
  buildProjectFacts,
  renderArtifactSet,
  runProjectQuery,
} from "../src/index.js";
import {
  AS_OF,
  LOCAL_MARKER,
  approvedAtlas,
  resignApproval,
  valid,
} from "./helpers.js";

const M = LOCAL_MARKER;
const CREDENTIAL_MARKER = "keychain_session_for_local_user";

/**
 * The synthetic approved contract with a distinct marker in every field the
 * remote-default projection must exclude, including nested and quoted values.
 */
function markedContract(): ProjectContract {
  const contract = structuredClone(approvedAtlas());
  contract.project.repository_roots = [`repos/${M}-root`];
  contract.project.owners = [{ ref: `owner-${M}`, role: `role-${M}` }];
  contract.resources.hardware[0]!.id = `hardware.${M}-laptop`;
  contract.candidates.forEach((candidate) => {
    if (
      candidate.deployment.mode === "local" &&
      candidate.deployment.hardware_ref !== null
    ) {
      candidate.deployment.hardware_ref = `hardware.${M}-laptop`;
    }
  });
  for (const integration of contract.integrations) {
    if (
      "credential_ref" in integration &&
      integration.credential_ref !== null
    ) {
      // A credential reference must stay low-entropy to pass validation, so it
      // carries its own marker rather than the shared one.
      (integration as { credential_ref: string | null }).credential_ref =
        CREDENTIAL_MARKER;
    }
    if ("data_directory" in integration) {
      (integration as { data_directory: string }).data_directory =
        `.anvilmark/runtime/${M}`;
    }
  }
  contract.approvals[0]!.actor.ref = `approver-${M}`;
  contract.approvals[0]!.note = `note quoting source ${M}`;
  contract.evidence_refs[0]!.source.locator = `https://provider.invalid/${M}/pricing`;
  contract.evidence_refs.push({
    id: "evidence.eval.rows",
    kind: "deterministic_observation",
    subject: "classification evaluation rows",
    producer: { name: "local-runner", version: null },
    observed_at: "2026-09-01T00:00:00Z",
    source: {
      type: "local_command",
      locator: `node run-eval.js --secret-path ${M}`,
    },
    applies_to: {
      candidate_ref: null,
      workload_ref: "classification",
      hardware_ref: null,
      constraint_refs: [],
    },
    value: {
      rows: [
        {
          input: `raw ticket text ${M}`,
          explanation: `quoted source line ${M}`,
        },
      ],
      command_line: `promptfoo eval -c ${M}.yaml`,
    },
    confidence: "medium",
    caveats: [],
    refresh: { policy: "on_hardware_or_model_change", expires_at: null },
  });
  contract.constraints.find(
    (entry) => entry.id === "privacy.raw_ticket_remote",
  )!.exceptions = [
    {
      id: "exception.pilot",
      reason: "Pilot",
      decision_ref: null,
      approved_by: `exception-approver-${M}`,
      expires_at: "2027-01-01T00:00:00Z",
      review_at: null,
    },
  ];
  contract.architecture.decision_bindings = [
    {
      decision_ref: "decision.classification",
      node_refs: ["ticket-classifier"],
    },
  ];
  contract.repository_bindings = [
    {
      id: "binding.classifier",
      decision_ref: "decision.classification",
      architecture_node_ref: "ticket-classifier",
      repository_root: `repos/${M}-root`,
      locations: [
        { path: `src/${M}/classify.ts`, symbol: `classify${M}`, line: 12 },
      ],
      discovery: {
        kind: "user_confirmed",
        detector: null,
        observed_at: "2026-09-01T00:00:00Z",
      },
      confidence: "high",
    },
  ];
  // The cited evidence locator is approved content; re-sign the synthetic
  // fixture approval so the marked contract is still approved and current.
  return valid(resignApproval(contract, "decision.classification"));
}

function occurrences(text: string): number {
  return text.split(M).length - 1;
}

describe("remote-default projection", () => {
  it("contains no local, code, identity, credential, command or row value at any depth", () => {
    const contract = markedContract();
    expect(occurrences(JSON.stringify(contract))).toBeGreaterThan(10);

    expect(JSON.stringify(contract)).toContain(CREDENTIAL_MARKER);
    const facts = buildProjectFacts(contract, { asOf: AS_OF });
    expect(occurrences(JSON.stringify(facts))).toBe(0);
    expect(JSON.stringify(facts)).not.toContain(CREDENTIAL_MARKER);
    expect(facts.hardware_capabilities[0]?.alias).toBe("hardware-1");

    const rendered = renderArtifactSet(contract, { asOf: AS_OF });
    for (const artifact of rendered.artifacts) {
      expect(occurrences(artifact.content), artifact.kind).toBe(0);
      expect(artifact.content).not.toContain(CREDENTIAL_MARKER);
    }
    expect(occurrences(rendered.manifestText)).toBe(0);

    for (const tool of PROJECT_TOOL_NAMES) {
      const args =
        tool === "get_workload_decision" ? { workload: "classification" } : {};
      const result = runProjectQuery(tool, args, {
        contract,
        stateRevision: 1,
        asOf: AS_OF,
        projection: "remote-default",
      });
      expect(result.ok, tool).toBe(true);
      expect(occurrences(JSON.stringify(result)), tool).toBe(0);
      expect(JSON.stringify(result)).not.toContain(CREDENTIAL_MARKER);
    }
  });

  it("keeps decision-layer facts: approved decision, rationale, evidence metadata and capabilities", () => {
    const facts = buildProjectFacts(markedContract(), { asOf: AS_OF });
    const decision = facts.workloads.find(
      (entry) => entry.id === "classification",
    )!.decisions[0]!;
    expect(decision.standing).toBe("approved_current");
    expect(decision.approval).not.toHaveProperty("local_actor");
    expect(decision.evidence[0]).toMatchObject({
      id: "evidence.pricing.remote",
      kind: "official_pricing",
    });
    expect(decision.evidence[0]).not.toHaveProperty("local_locator");
    expect(
      facts.architecture.nodes.find((node) => node.id === "ticket-classifier"),
    ).not.toHaveProperty("local_repository_bindings");
    expect(facts.summary).not.toHaveProperty("local_repository_roots");
  });

  it("refuses remote facts when free text repeats a known local value", () => {
    const contract = structuredClone(markedContract());
    contract.intent.unresolved_questions.push(
      `Should we move repos/${M}-root?`,
    );
    expect(() => buildProjectFacts(contract, { asOf: AS_OF })).toThrow(
      /local-only value/,
    );
    // The local projection, which discloses repository roots, is unaffected.
    expect(
      buildProjectFacts(contract, {
        asOf: AS_OF,
        projection: "local-disclosed",
      }).source.projection,
    ).toBe("local-disclosed");
  });

  it("refuses to produce facts carrying a secret-shaped value", () => {
    const contract = structuredClone(approvedAtlas());
    // Not validated on purpose: validation would already refuse this contract.
    contract.decisions[0]!.rationale.summary =
      "use sk-proj-TESTONLYabcdefghijklmnopqrstuvwxyz0123";
    expect(() => buildProjectFacts(contract, { asOf: AS_OF })).toThrow(
      /secret-shaped/,
    );
  });
});

describe("local-disclosed projection", () => {
  it("adds only the disclosed local fields, labelled local, and still omits credentials, commands and rows", () => {
    const contract = markedContract();
    const facts = buildProjectFacts(contract, {
      asOf: AS_OF,
      projection: "local-disclosed",
    });
    expect(facts.source.projection).toBe("local-disclosed");
    expect(facts.disclosure).toMatch(
      /does not authorize sending it to a remote model/,
    );
    const text = JSON.stringify(facts);
    expect(facts.summary.local_repository_roots).toEqual([`repos/${M}-root`]);
    expect(
      facts.architecture.nodes.find((node) => node.id === "ticket-classifier")
        ?.local_repository_bindings,
    ).toEqual([
      {
        id: "binding.classifier",
        repository_root: `repos/${M}-root`,
        locations: [`src/${M}/classify.ts#classify${M}:12`],
      },
    ]);
    const decision = facts.workloads.find(
      (entry) => entry.id === "classification",
    )!.decisions[0]!;
    expect(decision.approval.local_actor).toBe(`approver-${M}`);
    expect(decision.evidence[0]?.local_locator).toBe(
      `https://provider.invalid/${M}/pricing`,
    );
    expect(
      facts.constraints.find(
        (entry) => entry.id === "privacy.raw_ticket_remote",
      )?.exceptions[0]?.local_approved_by,
    ).toBe(`exception-approver-${M}`);

    for (const excluded of [
      CREDENTIAL_MARKER,
      `.anvilmark/runtime/${M}`,
      `owner-${M}`,
      `note quoting source ${M}`,
      `raw ticket text ${M}`,
      `quoted source line ${M}`,
      `promptfoo eval -c ${M}`,
      `hardware.${M}-laptop`,
    ]) {
      expect(text, excluded).not.toContain(excluded);
    }
    // Every local value sits under a key named local_*, so a consumer can see
    // which parts of a response are local-only.
    const unlabelled: string[] = [];
    const walk = (value: unknown, path: string[]) => {
      if (typeof value === "string") {
        if (
          value.includes(M) &&
          !path.some((key) => key.startsWith("local_"))
        ) {
          unlabelled.push(path.join("."));
        }
      } else if (Array.isArray(value)) {
        value.forEach((entry, index) => walk(entry, [...path, String(index)]));
      } else if (value !== null && typeof value === "object") {
        for (const [key, entry] of Object.entries(value))
          walk(entry, [...path, key]);
      }
    };
    walk(facts, []);
    expect(unlabelled).toEqual([]);
  });

  it("is explicit: generated artifacts and queries default to remote-default", () => {
    const contract = markedContract();
    expect(
      renderArtifactSet(contract, { asOf: AS_OF }).manifest.projection,
    ).toBe("remote-default");
    const local = renderArtifactSet(contract, {
      asOf: AS_OF,
      projection: "local-disclosed",
    });
    expect(local.manifest.projection).toBe("local-disclosed");
    const agentContext = local.artifacts.find(
      (artifact) => artifact.kind === "agent_context",
    )!.content;
    expect(agentContext).toContain("LOCAL-DISCLOSED projection");
    expect(agentContext).toContain("(local-disclosed)");
  });
});
