import { describe, expect, it } from "vitest";

import {
  ATLAS_FIXTURE_PATH,
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  listEvidenceGaps,
  loadAtlasFixture,
  parseProjectContract,
  readAtlasFixtureText,
} from "../src/index.js";

describe("the Atlas Support Desk fixture", () => {
  it("validates as authored, with no fabricated content", async () => {
    const result = parseProjectContract(await readAtlasFixtureText(), "yaml");

    if (!result.ok) {
      throw new Error(
        `${ATLAS_FIXTURE_PATH} should validate but reported:\n${result.issues
          .map((entry) => `  [${entry.code}] ${entry.path}: ${entry.message}`)
          .join("\n")}`,
      );
    }

    expect(result.value.schema).toBe(PROJECT_SCHEMA_ID);
    expect(result.value.schema_version).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("keeps exactly the five application workloads", async () => {
    const contract = await loadAtlasFixture();

    expect(contract.workloads.map((workload) => workload.id)).toEqual([
      "pii_redaction",
      "classification",
      "extraction",
      "retrieval",
      "response_drafting",
    ]);
  });

  it("treats quality evaluation as an evidence-producing process, not a workload", async () => {
    const contract = await loadAtlasFixture();

    expect(
      contract.workloads.some((workload) =>
        workload.id.includes("quality_evaluation"),
      ),
    ).toBe(false);

    // It survives as the evaluation that quality gates cite for evidence.
    const evaluationRefs = contract.workloads.flatMap((workload) =>
      workload.quality_gates.map((gate) => gate.evaluation_ref),
    );
    expect(evaluationRefs).toContain("eval.classification.v1");
  });

  it("preserves the raw-ticket privacy and provider-independence hard constraints", async () => {
    const contract = await loadAtlasFixture();
    const hard = contract.constraints.filter(
      (constraint) => constraint.severity === "hard",
    );

    const privacy = hard.find((c) => c.id === "privacy.raw_ticket_remote");
    expect(privacy?.domain).toBe("privacy");
    expect(privacy?.operator).toBe("must_not_leave");
    expect(privacy?.value).toBe("local_trust_boundary");

    const availability = hard.find(
      (c) => c.id === "availability.classification_provider",
    );
    expect(availability?.operator).toBe("must_remain_available_without");
    expect(availability?.value).toBe("any_single_remote_provider");
  });

  it("keeps cost and latency as directional soft constraints", async () => {
    const contract = await loadAtlasFixture();
    const soft = contract.constraints.filter(
      (constraint) => constraint.severity === "soft",
    );

    expect(
      soft.map((constraint) => [constraint.id, constraint.direction]),
    ).toEqual([
      ["budget.ai_monthly", "minimize"],
      ["latency.classification_p95", "minimize"],
      ["latency.drafting_p95", "minimize"],
    ]);
  });

  it("preserves the user-declared RTX 4090 target as declared, not detected", async () => {
    const contract = await loadAtlasFixture();
    const [hardware] = contract.resources.hardware;

    expect(hardware?.evidence_kind).toBe("user_declared");
    expect(hardware?.accelerators[0]).toMatchObject({
      vendor: "nvidia",
      model: "RTX 4090",
      vram_gb: 24,
    });
  });

  it("keeps ANVILMARK authoritative and CALM/Mermaid as generated views", async () => {
    const contract = await loadAtlasFixture();

    expect(contract.architecture.authority).toBe("anvilmark");
    expect(contract.architecture.generated).toEqual({
      calm_1_2: "./architecture/calm.json",
      mermaid: "./architecture/view.mmd",
    });
  });

  it("keeps the remote-intelligence projection defaults", async () => {
    const contract = await loadAtlasFixture();
    const policy = contract.remote_intelligence_policy;

    expect(policy.show_payload_before_remote_send).toBe(true);
    expect(policy.scan_outbound_payload_for_secrets).toBe(true);
    expect(policy.default_deny).toContain("repository_roots");
    expect(policy.default_allow).not.toContain("file_contents");
  });

  it("leaves decisions and approvals empty rather than inventing them", async () => {
    const contract = await loadAtlasFixture();

    expect(contract.decisions).toEqual([]);
    expect(contract.approvals).toEqual([]);
    expect(contract.evidence_refs).toEqual([]);
    expect(
      contract.candidates.every((candidate) => candidate.model === null),
    ).toBe(true);
    expect(
      contract.candidates.every(
        (candidate) => candidate.status === "unevaluated",
      ),
    ).toBe(true);
  });

  it("reports its missing evidence honestly instead of passing", async () => {
    const contract = await loadAtlasFixture();
    const gaps = listEvidenceGaps(contract);

    // Every quality gate is still unevaluated, and every hard constraint is
    // still unresolved. That is the correct state of a draft contract.
    expect(gaps.length).toBeGreaterThan(0);
    expect(
      gaps.some(
        (gap) => gap.subject === "workload.pii_redaction.metric.recall",
      ),
    ).toBe(true);
    expect(
      gaps.every(
        (gap) => gap.requiredFloor === null || gap.requiredFloor === "T3",
      ),
    ).toBe(true);
  });

  it("declares the ratified evidence floors", async () => {
    const contract = await loadAtlasFixture();

    expect(contract.evidence_policy.floors.workload_quality_hard_gate).toBe(
      "T3",
    );
    expect(contract.evidence_policy.floors.privacy_data_flow_hard_gate).toBe(
      "T3",
    );
    expect(contract.evidence_policy.floors.projected_cost_comparison).toBe(
      "T2",
    );
    expect(contract.evidence_policy.floors.target_hardware_inventory).toBe(
      "T1",
    );
  });
});
