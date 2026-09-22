import { describe, expect, it } from "vitest";

import type {
  AdapterOutcome,
  IntelligenceAdapter,
  IntelligenceProposal,
  IntelligenceRequest,
} from "../src/index.js";
import {
  ADAPTER_PROTOCOL_VERSION,
  IntelligenceProposalSchema,
  available,
  buildProjection,
  isProjectionSendable,
  reviewProposal,
} from "../src/index.js";
import { FIXED_TIMES, fixtureContract } from "./helpers.js";

/**
 * Two adapters standing in for very different intelligences: a locally
 * installed coding agent and a remote OpenAI-compatible endpoint. Neither
 * makes a network call here; the point is that they are interchangeable.
 */
function fakeAdapter(
  id: string,
  execution: "local" | "remote",
  proposal: unknown,
): IntelligenceAdapter {
  return {
    identity: {
      id,
      kind: "intelligence",
      version: "1.0.0",
      execution,
      protocol_version: ADAPTER_PROTOCOL_VERSION,
    },
    capabilities: {
      clarify_intent: true,
      propose_constraints: true,
      propose_candidates: true,
      explain_tradeoffs: true,
    },
    describeProjection: (contract) => buildProjection(contract, { execution }),
    propose: async (): Promise<AdapterOutcome<IntelligenceProposal>> =>
      available(IntelligenceProposalSchema.parse(proposal), {
        adapter: {
          id,
          kind: "intelligence",
          version: "1.0.0",
          execution,
          protocol_version: ADAPTER_PROTOCOL_VERSION,
        },
        started_at: FIXED_TIMES[0],
        completed_at: FIXED_TIMES[1],
        provenance: {
          command_manifest: null,
          locator: null,
          raw_result_hash: null,
        },
        diagnostics: [],
      }),
  };
}

const VALID_PROPOSAL = {
  protocol_version: ADAPTER_PROTOCOL_VERSION,
  proposed_constraints: [
    {
      id: "latency.classification_p95",
      domain: "latency",
      severity: "soft",
      direction: "minimize",
      subject: "workload.classification.latency_p95_ms",
      operator: "lte",
      value: 1000,
      source: "agent_proposed",
    },
  ],
  questions: ["Which regions are acceptable for redacted processing?"],
  rationale: {
    summary: "Routing needs a latency budget.",
    generated_by: "fake",
  },
};

const REQUEST: IntelligenceRequest = {
  protocol_version: ADAPTER_PROTOCOL_VERSION,
  task: "propose_constraints",
  projection: {},
  instructions: "Suggest missing constraints.",
};

describe("the intelligence interface is provider-neutral", () => {
  it("accepts schema-identical proposals from two unrelated adapters", async () => {
    const contract = fixtureContract();
    const local = fakeAdapter("claude-code-like", "local", VALID_PROPOSAL);
    const remote = fakeAdapter(
      "openai-compatible-like",
      "remote",
      VALID_PROPOSAL,
    );

    const fromLocal = await local.propose(REQUEST);
    const fromRemote = await remote.propose(REQUEST);

    expect(fromLocal.standing).toBe("available");
    expect(fromRemote.standing).toBe("available");
    if (
      fromLocal.standing !== "available" ||
      fromRemote.standing !== "available"
    ) {
      return;
    }
    // The same object, from two different intelligences, through one schema.
    expect(fromRemote.value).toEqual(fromLocal.value);
    expect(reviewProposal(contract, fromLocal.value).accepted).toBe(true);
    expect(reviewProposal(contract, fromRemote.value).accepted).toBe(true);
  });

  it("records whether the adapter ran locally or remotely", () => {
    expect(fakeAdapter("a", "local", VALID_PROPOSAL).identity.execution).toBe(
      "local",
    );
    expect(fakeAdapter("b", "remote", VALID_PROPOSAL).identity.execution).toBe(
      "remote",
    );
  });
});

describe("an intelligence adapter proposes and never decides", () => {
  it("refuses a proposal that tries to approve a decision", () => {
    const review = reviewProposal(fixtureContract(), {
      ...VALID_PROPOSAL,
      approvals: [{ decision_ref: "decision.one", actor: "agent" }],
    });

    expect(review.accepted).toBe(false);
    expect(review.errors[0]?.code).toBe("forbidden_proposal");
    expect(review.errors[0]?.message).toContain("approvals");
  });

  it("refuses a proposal that tries to set a decision status", () => {
    const review = reviewProposal(fixtureContract(), {
      ...VALID_PROPOSAL,
      decisions: [{ id: "decision.one", status: "approved" }],
    });

    expect(review.accepted).toBe(false);
    expect(review.errors[0]?.code).toBe("forbidden_proposal");
  });

  it("refuses a proposal that redefines an existing hard constraint", () => {
    const review = reviewProposal(fixtureContract(), {
      ...VALID_PROPOSAL,
      proposed_constraints: [
        {
          id: "quality.classification_f1",
          domain: "quality",
          severity: "soft",
          direction: "minimize",
          subject: "workload.classification.metric.macro_f1",
          operator: "gte",
          value: 0.5,
          source: "agent_proposed",
        },
      ],
    });

    // Lowering 0.9 to 0.5 and hard to soft is exactly the move this blocks.
    expect(review.accepted).toBe(false);
    expect(review.errors[0]?.code).toBe("forbidden_proposal");
    expect(review.errors[0]?.message).toContain("quality.classification_f1");
  });

  it("refuses a constraint claimed as a user declaration", () => {
    const review = reviewProposal(fixtureContract(), {
      ...VALID_PROPOSAL,
      proposed_constraints: [
        { ...VALID_PROPOSAL.proposed_constraints[0], source: "user" },
      ],
    });

    expect(review.accepted).toBe(false);
  });

  it("refuses an inference labelled as a measurement", () => {
    const review = reviewProposal(fixtureContract(), {
      ...VALID_PROPOSAL,
      inferences: [
        {
          subject: "candidate.local.quality",
          claim: "scores well",
          kind: "measured_evaluation",
          confidence: "high",
        },
      ],
    });

    expect(review.accepted).toBe(false);
  });

  it("accepts an inference honestly labelled as one", () => {
    const review = reviewProposal(fixtureContract(), {
      ...VALID_PROPOSAL,
      inferences: [
        {
          subject: "candidate.local.quality",
          claim: "likely adequate, unverified",
          kind: "agent_inference",
          confidence: "low",
        },
      ],
    });

    expect(review.accepted).toBe(true);
  });
});

describe("the outbound projection", () => {
  it("sends only what the contract's policy allows", () => {
    const projection = buildProjection(fixtureContract(), {
      execution: "remote",
    });

    expect(Object.keys(projection.payload).sort()).toEqual([
      "budgets",
      "candidates",
      "conformance_rules",
      "constraints",
      "decisions",
      "evidence_metadata",
      "hardware_capabilities",
      "intent",
      "workloads",
    ]);
  });

  it("withholds repository roots, file contents, and owners", () => {
    const projection = buildProjection(fixtureContract(), {
      execution: "remote",
    });
    const json = projection.payload_json;

    expect(projection.withheld_fields).toContain("repository_roots");
    expect(projection.withheld_fields).toContain("file_contents");
    expect(projection.withheld_fields).toContain("local_machine_identifiers");
    expect(json).not.toContain("repository_roots");
  });

  it("shares hardware capacity but never a local locator", () => {
    const projection = buildProjection(fixtureContract(), {
      execution: "remote",
    });
    const hardware = projection.payload.hardware_capabilities as {
      accelerators: { model: string; vram_gb: number }[];
    }[];

    // "24 GB NVIDIA GPU" is useful and shareable; machine identity is not.
    expect(hardware[0]?.accelerators[0]).toMatchObject({
      model: "RTX 4090",
      vram_gb: 24,
    });
    expect(projection.payload_json).not.toContain("locator");
  });

  it("refuses to send extra fields to a remote adapter", () => {
    const projection = buildProjection(fixtureContract(), {
      execution: "remote",
      additionalFields: ["repository_roots", "file_contents"],
    });

    expect(projection.allowed_fields).not.toContain("repository_roots");
    expect(projection.allowed_fields).not.toContain("file_contents");
  });

  it("still refuses ratified default-deny fields to a local adapter", () => {
    const projection = buildProjection(fixtureContract(), {
      execution: "local",
      additionalFields: ["file_contents", "owners"],
    });

    expect(projection.allowed_fields).not.toContain("file_contents");
    expect(projection.allowed_fields).not.toContain("owners");
  });

  it("renders the exact payload for the user to see before sending", () => {
    const projection = buildProjection(fixtureContract(), {
      execution: "remote",
    });

    expect(projection.payload_json).toBe(
      `${JSON.stringify(JSON.parse(projection.payload_json), null, 2)}\n`,
    );
    expect(isProjectionSendable(projection)).toBe(true);
  });

  it("blocks a payload that would carry a credential", () => {
    // The contract rejects stored secrets, so a payload can only carry one if
    // something slipped past validation. The projection is the second line of
    // defence and refuses to become sendable.
    const contract = fixtureContract();
    const tampered = {
      ...contract,
      intent: {
        ...contract.intent,
        summary: "Classify tickets using AKIAIOSFODNN7EXAMPLE for access.",
      },
    };

    const projection = buildProjection(tampered, { execution: "remote" });

    expect(projection.secret_findings.length).toBeGreaterThan(0);
    expect(isProjectionSendable(projection)).toBe(false);
  });
});

describe("the projection cannot be widened by a tampered policy", () => {
  it("strips ratified default-deny fields even when a policy allow-lists them", () => {
    const contract = fixtureContract();
    // The contract itself rejects this policy; the projection is the second
    // line of defence if a document ever reaches memory another way.
    const tampered = {
      ...contract,
      remote_intelligence_policy: {
        ...contract.remote_intelligence_policy,
        default_allow: [
          ...contract.remote_intelligence_policy.default_allow,
          "repository_roots" as const,
          "file_contents" as const,
          "owners" as const,
        ],
      },
    };

    const projection = buildProjection(tampered, { execution: "remote" });

    expect(projection.allowed_fields).not.toContain("repository_roots");
    expect(projection.allowed_fields).not.toContain("file_contents");
    expect(projection.allowed_fields).not.toContain("owners");
    expect(Object.keys(projection.payload)).not.toContain("repository_roots");
  });
});

/**
 * Decision 06 section 9 default-denies device identifiers. A contract hardware
 * id is one: the user chooses it, and it routinely names the machine.
 */
describe("no machine identity reaches a remote projection", () => {
  const REVEALING = "hardware.alices-macbook-pro-serial-C02XY1234";

  function contractWithRevealingId() {
    const contract = fixtureContract();
    return {
      ...contract,
      resources: {
        ...contract.resources,
        hardware: contract.resources.hardware.map((entry, index) =>
          index === 0 ? { ...entry, id: REVEALING } : entry,
        ),
      },
      candidates: contract.candidates.map((entry) =>
        entry.deployment.mode === "local"
          ? {
              ...entry,
              deployment: { ...entry.deployment, hardware_ref: REVEALING },
            }
          : entry,
      ),
      evidence_refs: [
        {
          id: "evidence.fit",
          kind: "tool_observation" as const,
          subject: "candidate.local.hardware_fit",
          producer: { name: "llmfit", version: "0.4.2" },
          observed_at: "2026-08-20T00:00:00Z",
          source: { type: "local_command" as const, locator: null },
          confidence: "medium" as const,
          caveats: [],
          refresh: { policy: "never" as const, expires_at: null },
          applies_to: {
            candidate_ref: "candidate.local",
            workload_ref: "classification",
            hardware_ref: REVEALING,
            constraint_refs: ["quality.classification_f1"],
          },
          value: {
            estimate_basis: {},
            target_hardware_ref: REVEALING,
            detected_hardware_ref: null,
            findings: {},
          },
        },
      ],
    };
  }

  it("sends no contract hardware id anywhere in the payload", () => {
    const projection = buildProjection(contractWithRevealingId(), {
      execution: "remote",
    });

    // The exact bytes must appear nowhere.
    expect(projection.payload_json).not.toContain(REVEALING);
    expect(projection.payload_json).not.toContain("alices-macbook-pro");
    expect(projection.payload_json).not.toContain("C02XY1234");
  });

  it("still sends the capacity a model choice depends on", () => {
    const projection = buildProjection(contractWithRevealingId(), {
      execution: "remote",
    });
    const hardware = projection.payload.hardware_capabilities as {
      alias: string;
      accelerators: { model: string; vram_gb: number }[];
    }[];

    expect(hardware[0]?.alias).toBe("hardware-1");
    expect(hardware[0]?.accelerators[0]).toMatchObject({
      model: "RTX 4090",
      vram_gb: 24,
    });
  });

  it("replaces hardware references with the same alias so correlation survives", () => {
    const projection = buildProjection(contractWithRevealingId(), {
      execution: "remote",
    });

    const candidates = projection.payload.candidates as {
      deployment: { mode: string; hardware_ref?: string | null };
    }[];
    const local = candidates.find((entry) => entry.deployment.mode === "local");
    expect(local?.deployment.hardware_ref).toBe("hardware-1");

    const evidence = projection.payload.evidence_metadata as {
      applies_to: { hardware_ref: string | null };
    }[];
    expect(evidence[0]?.applies_to.hardware_ref).toBe("hardware-1");
  });

  it("sends no local path, command line, or credential reference", () => {
    const projection = buildProjection(fixtureContract(), {
      execution: "remote",
    });

    expect(projection.payload_json).not.toContain(
      "existing_session_or_environment",
    );
    expect(projection.payload_json).not.toContain("redacted-command-manifest");
    expect(projection.payload_json).not.toContain("integrations");
  });
});
