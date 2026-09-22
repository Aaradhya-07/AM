import { afterEach, describe, expect, it } from "vitest";

import type { ProjectContract } from "@anvilmark/project-contract";
import {
  RepositoryBindingSchema,
  approvalState,
} from "@anvilmark/project-contract";

import type { ScanArtifact } from "../src/index.js";
import {
  assessArtifactStanding,
  serializeArtifact,
  toContractRepositoryBinding,
} from "../src/index.js";
import {
  approvedLocal,
  approvedRemote,
  artifactOf,
  callIn,
  cleanup,
  declarations,
  materialize,
  scan,
} from "./helpers.js";

/**
 * The three Milestone 6 handoff fixtures. These tests assert Milestone 5
 * observations, traces and unknown reasons only. Whether a rule passes or
 * fails is Milestone 6's job; no verdict appears in the artifact.
 */

afterEach(cleanup);

const COMPONENTS = {
  components: [
    {
      id: "component.classifier",
      path: "src/classify.ts",
      export: "classifyTicket",
      architecture_node_ref: "ticket-classifier",
      workload_ref: "classification",
    },
    {
      id: "component.remote_provider_module",
      path: "src/providers/remote.ts",
      export: null,
      architecture_node_ref: "ticket-classifier",
      workload_ref: "classification",
    },
  ],
};

const VERDICT_WORDS =
  /"(?:pass|fail|passed|failed|violation|compliant|non_compliant|verdict)"/;

async function handoff(name: string, contract: ProjectContract) {
  const root = await materialize(name);
  const artifact = artifactOf(scan(root, contract, declarations(COMPONENTS)));
  const text = serializeArtifact(artifact);
  expect(text).not.toMatch(VERDICT_WORDS);
  expect(artifact.statement).toContain("not a conformance result");
  return artifact;
}

describe("M6 handoff: approved provider receiving declared sanitizer output", () => {
  it("observes the approved candidate's provider call with only sanitized data reaching it", async () => {
    const contract = await approvedRemote();
    expect(approvalState(contract, "decision.classification").state).toBe(
      "current",
    );
    const artifact = await handoff("handoff-approved-sanitized", contract);
    const { call, flow } = callIn(artifact, "classifyTicket");
    expect(call).toMatchObject({
      provider: "openai",
      operation: "chat.completions.create",
      default_deployment: "managed_api",
    });
    expect(flow).toMatchObject({
      status: "sanitized_only",
      classifications: ["redacted_customer_ticket:sanitized"],
      evidence_tier: "T3",
      trace_tier: "T3",
    });
    const trace = flow.contexts[0]?.facts[0]?.trace ?? [];
    expect(trace.map((step) => [step.kind, step.declaration_ref])).toEqual([
      ["source", "source.raw_ticket"],
      ["assignment", null],
      ["sanitizer", "sanitizer.pii"],
      ["assignment", null],
      ["sink", null],
    ]);
    expect(
      flow.assumptions.map((entry) => [entry.kind, entry.declaration_ref]),
    ).toEqual([
      ["declared_sanitizer", "sanitizer.pii"],
      ["declared_source", "source.raw_ticket"],
      ["declared_sources_complete", null],
    ]);

    const binding = artifact.proposed_bindings.find(
      (entry) => entry.observation_ref === call.id,
    );
    expect(binding).toMatchObject({
      discovery: "declared_mapping",
      confidence: "high",
      evidence_tier: "T1",
      component: {
        ref: "ticket-classifier",
        association: "declared_mapping",
        standing: "user_declared",
        trusted: true,
        trust_boundary: "local",
      },
      provider_node: {
        ref: "remote-model-provider",
        trust_boundary: "remote_provider",
      },
      workload: { ref: "classification", association: "declared_mapping" },
      candidate: {
        ref: "candidate.classification.remote_unselected",
        association: "declared_mapping",
      },
      decision: {
        ref: "decision.classification",
        status: "approved",
        approval_state: "current",
        selected_candidate_ref: "candidate.classification.remote_unselected",
      },
      unbound_reasons: [],
      contract_projection: {
        eligible: true,
        discovery_kind: "deterministic",
        reasons: [],
      },
    });

    const projected = toContractRepositoryBinding(artifact, binding!);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(RepositoryBindingSchema.safeParse(projected.binding).success).toBe(
      true,
    );
    expect(projected.binding).toEqual({
      id: binding!.id,
      decision_ref: "decision.classification",
      architecture_node_ref: "ticket-classifier",
      repository_root: ".",
      locations: [
        {
          path: "src/classify.ts",
          symbol: "classifyTicket",
          line: call.location.start.line,
        },
      ],
      discovery: {
        kind: "deterministic",
        detector: `anvilmark-scanner@${artifact.scanner.version}`,
        observed_at: artifact.observation.observed_at,
      },
      confidence: "high",
    });
    // The contract itself is never given the binding.
    expect(contract.repository_bindings).toEqual([]);
  });
});

describe("M6 handoff: disallowed provider receiving raw data directly", () => {
  it("observes a remote call, raw data reaching it, and a decision that selected another candidate", async () => {
    const contract = await approvedLocal();
    const artifact = await handoff("handoff-disallowed-raw", contract);
    const { call, flow } = callIn(artifact, "classifyTicket");
    expect(call.provider).toBe("openai");
    expect(flow).toMatchObject({
      status: "raw_reaches",
      classifications: ["raw_customer_ticket:raw"],
      unknown_reasons: [],
    });
    expect(flow.contexts[0]?.facts[0]).toMatchObject({
      conditional: false,
      declaration_ref: "source.raw_ticket",
    });
    expect(flow.contexts[0]?.facts[0]?.trace.map((step) => step.kind)).toEqual([
      "source",
      "assignment",
      "sink",
    ]);
    const binding = artifact.proposed_bindings.find(
      (entry) => entry.observation_ref === call.id,
    );
    // Both facts are recorded side by side; comparing them is Milestone 6.
    expect(binding?.candidate.ref).toBe(
      "candidate.classification.remote_unselected",
    );
    expect(binding?.decision).toMatchObject({
      ref: "decision.classification",
      approval_state: "current",
      selected_candidate_ref: "candidate.classification.local_unselected",
    });
    expect(binding?.provider_node).toMatchObject({
      ref: "remote-model-provider",
      trust_boundary: "remote_provider",
    });
  });
});

describe("M6 handoff: ambiguous runtime path", () => {
  it("records the runtime-selected path as unknowns with the partial trace, and no invented call", async () => {
    const artifact = await handoff(
      "handoff-ambiguous-runtime",
      await approvedRemote(),
    );
    const inClassifier = artifact.observations.filter(
      (entry) =>
        entry.kind === "provider_call" &&
        entry.location.path === "src/classify.ts",
    );
    expect(inClassifier).toEqual([]);
    const unknowns = artifact.unknowns
      .filter((entry) => entry.location.path === "src/classify.ts")
      .map((entry) => [entry.reason, entry.stage, entry.classifications]);
    expect(unknowns).toEqual([
      ["runtime_selected_import", "resolution", []],
      ["unresolved_any", "flow", ["raw_customer_ticket:raw"]],
    ]);
    const partial = artifact.unknowns.find(
      (entry) => entry.reason === "unresolved_any",
    );
    expect(partial?.trace.map((step) => step.kind)).toEqual([
      "source",
      "assignment",
    ]);

    // The provider module that might be loaded is observed on its own, with
    // unresolved data: no caller in the repository was followed.
    const { flow } = callIn(artifact, "classify");
    expect(flow).toMatchObject({
      status: "unresolved",
      unknown_reasons: ["parameter_value_from_caller"],
      evidence_tier: "T0",
    });
    expect(artifact.completeness.status).toBe("incomplete");
  });
});

describe("artifact standing against the current contract", () => {
  async function approvedArtifact(): Promise<{
    artifact: ScanArtifact;
    contract: ProjectContract;
  }> {
    const contract = await approvedRemote();
    const root = await materialize("handoff-approved-sanitized");
    return {
      artifact: artifactOf(scan(root, contract, declarations(COMPONENTS))),
      contract,
    };
  }

  it("is current for the contract it was scanned against", async () => {
    const { artifact, contract } = await approvedArtifact();
    const standing = assessArtifactStanding(artifact, contract);
    expect(standing.current).toBe(true);
    expect(standing.decisions).toEqual([
      expect.objectContaining({
        ref: "decision.classification",
        recorded_approval_state: "current",
        current_approval_state: "current",
        changed: false,
      }),
    ]);
  });

  it("reports a stale approval and changed architecture through the hash-aware APIs", async () => {
    const { artifact, contract } = await approvedArtifact();
    const changed: ProjectContract = {
      ...contract,
      decisions: contract.decisions.map((decision) => ({
        ...decision,
        selected_candidate_ref: "candidate.classification.local_unselected",
        alternatives: ["candidate.classification.remote_unselected"],
      })),
      architecture: {
        ...contract.architecture,
        nodes: contract.architecture.nodes.map((node) =>
          node.id === "remote-model-provider"
            ? { ...node, name: "Renamed Provider" }
            : node,
        ),
      },
    };
    const standing = assessArtifactStanding(artifact, changed);
    expect(standing.current).toBe(false);
    expect(standing.contract_hash_matches).toBe(false);
    expect(standing.decisions[0]).toMatchObject({
      current_approval_state: "stale",
      changed: true,
    });
    expect(
      standing.architecture_nodes.find(
        (entry) => entry.ref === "remote-model-provider",
      ),
    ).toMatchObject({ changed: true });
    expect(
      standing.architecture_nodes.find(
        (entry) => entry.ref === "ticket-classifier",
      ),
    ).toMatchObject({ changed: false });
  });

  it("refuses to project bindings that are heuristic, unbound or not currently approved", async () => {
    const contract = await approvedRemote();
    const root = await materialize("handoff-approved-sanitized");
    const heuristic = artifactOf(
      scan(root, contract, declarations({ sinks: [] })),
    );
    const binding = heuristic.proposed_bindings[0]!;
    expect(toContractRepositoryBinding(heuristic, binding)).toEqual({
      ok: false,
      reasons: [
        "discovery_heuristic_association_not_projectable",
        "heuristic_part",
        "no_decision",
      ],
    });
  });
});
