import { describe, expect, it } from "vitest";

import {
  attachEvidence,
  buildEvidenceRecord,
  createLlmfitAdapter,
  createPromptfooAdapter,
  fixedClock,
  isAvailable,
  runSubprocess,
} from "../src/index.js";
import { evaluateConstraint } from "@anvilmark/project-contract";
import {
  FIXED_TIMES,
  NODE,
  fixtureContract,
  identity,
  nodeScript,
} from "./helpers.js";

const clock = () => fixedClock(...FIXED_TIMES);

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    id: "evidence.one",
    kind: "measured_evaluation",
    subject: "candidate.local.quality",
    claim: "measured macro_f1",
    producer: { name: "runner", version: "1.0.0" },
    observed_at: "2026-08-10T00:00:00Z",
    source: { type: "local_command", locator: "redacted-command-manifest" },
    applies_to: {
      candidate_ref: "candidate.local",
      workload_ref: "classification",
      constraint_refs: ["quality.classification_f1"],
    },
    value: {
      dataset_ref: "dataset.classification",
      dataset_version: "v1",
      candidate_ref: "candidate.local",
      configuration_hash: "cfg",
      identity: {
        workload_ref: "classification",
        dataset_hash: `sha256:${"a".repeat(64)}`,
        prompt_hash: `sha256:${"b".repeat(64)}`,
        evaluator_hash: `sha256:${"c".repeat(64)}`,
        model_configuration_hash: `sha256:${"d".repeat(64)}`,
        config_digest: `sha256:${"e".repeat(64)}`,
        provider_id: "example:model-a",
      },
      metrics: { macro_f1: 0.93 },
      result_artifact_hash: "artifact",
    },
    confidence: "high",
    refresh: { policy: "never" },
    standing: "available",
    ...overrides,
  };
}

const policy = { tiers: {}, floors: {} } as never;
const EXPECTED = {
  provider_id: "example:model-a",
  configuration_hash: "cfg",
} as const;
const hardQuality = {
  id: "quality.classification_f1",
  domain: "quality",
  severity: "hard",
  subject: "workload.classification.metric.macro_f1",
  operator: "gte",
  value: 0.9,
  source: "user",
  rationale: null,
  condition: null,
  exceptions: [],
} as never;

describe("evidence must be attributed to the right thing", () => {
  it("cannot settle a constraint for a different candidate", () => {
    const built = buildEvidenceRecord(evidence());
    if (!built.ok) throw new Error("expected a valid proposal");

    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [built.value.record],
      policy,
      {
        candidateRef: "candidate.remote",
        workloadRef: "classification",
        expectedEvaluation: EXPECTED,
      },
    );

    expect(result.outcome).toBe("unknown");
    expect(result.assessment.excluded[0]?.reason).toContain("candidate.local");
  });

  it("cannot settle a constraint for a different workload", () => {
    const built = buildEvidenceRecord(evidence());
    if (!built.ok) throw new Error("expected a valid proposal");

    const result = evaluateConstraint(
      hardQuality,
      "pass",
      [built.value.record],
      policy,
      {
        candidateRef: "candidate.local",
        workloadRef: "extraction",
        expectedEvaluation: EXPECTED,
      },
    );

    expect(result.outcome).toBe("unknown");
  });

  it("cannot settle a constraint it does not name", () => {
    const built = buildEvidenceRecord(evidence());
    if (!built.ok) throw new Error("expected a valid proposal");

    const otherConstraint = {
      ...(hardQuality as object),
      id: "latency.p95",
    } as never;
    const result = evaluateConstraint(
      otherConstraint,
      "pass",
      [built.value.record],
      policy,
      {
        candidateRef: "candidate.local",
        workloadRef: "classification",
        expectedEvaluation: EXPECTED,
      },
    );

    expect(result.outcome).toBe("unknown");
  });

  it("is refused by the contract when its hardware reference does not resolve", () => {
    const contract = fixtureContract();
    const built = buildEvidenceRecord(
      evidence({
        kind: "tool_observation",
        applies_to: {
          candidate_ref: "candidate.local",
          workload_ref: "classification",
          hardware_ref: "hardware.does_not_exist",
          constraint_refs: ["quality.classification_f1"],
        },
        value: {
          estimate_basis: {},
          target_hardware_ref: null,
          detected_hardware_ref: null,
          findings: {},
        },
      }),
    );
    if (!built.ok) throw new Error("expected a schema-valid proposal");

    const result = attachEvidence(contract, [built.value.record]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((entry) => entry.code === "reference_not_found"),
    ).toBe(true);
  });
});

describe("credentials never survive into a structured error", () => {
  it("sanitizes a secret printed to stderr before a non-zero exit", async () => {
    const outcome = await runSubprocess(
      {
        executable: NODE,
        args: nodeScript(
          'process.stderr.write("auth failed for sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD");' +
            "process.exit(1)",
        ),
        timeoutMs: 5000,
        maxOutputBytes: 64 * 1024,
      },
      { identity: identity(), clock: clock() },
    );

    expect(outcome.standing).toBe("failed");
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("sk-abcdefghij");
    expect(serialized).toContain("[redacted:");
  });

  it("sanitizes a secret embedded in structured tool output", async () => {
    const adapter = createLlmfitAdapter({
      clock: clock(),
      executable: NODE,
      versionArgs: nodeScript('process.stdout.write("0.4.2")'),
      platform: () => "linux",
      infoArgs: () => {
        const payload = JSON.stringify({
          system: {
            total_ram_gb: 64,
            available_ram_gb: 48,
            cpu_cores: 16,
            cpu_name: "AMD Ryzen 9 7950X",
            has_gpu: true,
            gpu_vram_gb: 24,
            gpu_available_gb: null,
            gpu_name: "NVIDIA GeForce RTX 4090",
            gpu_count: 1,
            unified_memory: false,
            backend: "CUDA",
            gpus: [
              {
                name: "NVIDIA GeForce RTX 4090",
                vram_gb: 24,
                backend: "CUDA",
                count: 1,
                unified_memory: false,
              },
            ],
          },
          models: [
            {
              name: "example-model",
              provider: "example",
              best_quant: null,
              fit_level: "Good",
              memory_required_gb: 1,
              estimated_tps: 1,
              // A tool that prints a credential into its own output.
              note: "ghp_a1B2c3D4e5a1B2c3D4e5a1B2c3D4e5a1B2c3",
            },
          ],
        });
        return nodeScript(`process.stdout.write(${JSON.stringify(payload)})`);
      },
    });

    const outcome = await adapter.collect({
      evidenceId: "evidence.fit",
      detectedHardwareId: "hardware.detected",
      declaredTarget: {
        id: "hardware.declared_target",
        evidence_kind: "user_declared",
        cpu: { cores: 16, model: null },
        ram_gb: 64,
        accelerators: [
          { vendor: "nvidia", model: "RTX 4090", vram_gb: 24, count: 1 },
        ],
        backend: "cuda",
        operating_system: "linux",
        evidence_refs: [],
      },
      modelIdentity: { name: "example-model", quantization: null },
      candidateRef: "candidate.local",
      workloadRef: "classification",
      constraintRefs: ["hardware.fit"],
    });

    expect(JSON.stringify(outcome)).not.toContain("ghp_a1B2");
  });
});

describe("optional tools are genuinely optional", () => {
  it("probes as unavailable when the tool is not installed", async () => {
    const outcome = await createLlmfitAdapter({
      clock: clock(),
      executable: "llmfit-definitely-not-installed",
    }).probe();

    expect(outcome.standing).toBe("unavailable");
    expect(outcome.errors[0]?.code).toBe("executable_not_found");
  });

  it("probes as unsupported when the tool reports no version", async () => {
    const outcome = await createPromptfooAdapter({
      clock: clock(),
      executable: NODE,
      versionArgs: nodeScript('process.stdout.write("")'),
    }).probe();

    // A build that will not identify itself cannot have its results attributed.
    expect(outcome.standing).toBe("unsupported");
    expect(outcome.errors[0]?.code).toBe("version_unavailable");
  });

  it("probes as available and reports the exact version", async () => {
    const outcome = await createPromptfooAdapter({
      clock: clock(),
      executable: NODE,
      versionArgs: nodeScript('process.stdout.write("0.122.0")'),
    }).probe();

    expect(outcome.standing).toBe("available");
    if (!isAvailable(outcome)) return;
    expect(outcome.value.version).toBe("0.122.0");
    expect(outcome.value.capabilities).toContain("evaluation");
  });

  it("probes as timed out without leaving the process running", async () => {
    const outcome = await createLlmfitAdapter({
      clock: clock(),
      executable: NODE,
      versionArgs: nodeScript("setInterval(() => {}, 1000)"),
      probeTimeoutMs: 200,
    }).probe();

    expect(outcome.standing).toBe("timed_out");
    expect(outcome.errors[0]?.code).toBe("timed_out");
  });

  it("leaves the contract usable when every optional adapter is absent", async () => {
    const contract = fixtureContract();

    const llmfit = await createLlmfitAdapter({
      clock: clock(),
      executable: "llmfit-absent",
    }).probe();
    const promptfoo = await createPromptfooAdapter({
      clock: clock(),
      executable: "promptfoo-absent",
    }).probe();

    expect(llmfit.standing).toBe("unavailable");
    expect(promptfoo.standing).toBe("unavailable");
    // Nothing was written, nothing threw, and the contract is unchanged.
    expect(contract.evidence_refs).toEqual([]);
    expect(attachEvidence(contract, []).ok).toBe(true);
  });
});
