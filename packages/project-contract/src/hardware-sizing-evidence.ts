import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  canonicalSizingJson,
  estimateModelFit,
  ProbeSnapshotSchema,
  SizingArtifactSchema,
  SizingInputSchema,
} from "@anvilmark/hardware-sizing";
import type { SizingInput, ProbeSnapshot } from "@anvilmark/hardware-sizing";
import type { ProjectContract } from "./schema/contract.js";
import type { EvidenceRecord } from "./schema/evidence.js";
import { HardwareSchema } from "./schema/resources.js";
import type { Hardware } from "./schema/resources.js";

export const HARDWARE_SIZING_PRODUCER = "anvilmark.hardware-sizing";
export const hardwareValueDigest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalSizingJson(value)).digest("hex")}`;
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const HardwareObservationValueSchema = z.strictObject({
  format: z.literal("anvilmark-hardware-observation/1"),
  snapshot: ProbeSnapshotSchema,
  contract_capacity_unit: z.enum(["gib", "gb"]),
  hardware_digest: digest,
  snapshot_digest: digest,
});
export const SizingScenarioValueSchema = z.strictObject({
  format: z.literal("anvilmark-sizing-scenario/1"),
  input: SizingInputSchema,
});
export const HardwareSizingBasisSchema = z.strictObject({
  format: z.literal("anvilmark-hardware-fit-evidence/1"),
  artifact: SizingArtifactSchema,
  scenario_evidence_ref: z.string().min(1),
  observation_evidence_ref: z.string().min(1),
  dependencies: z.record(z.string(), digest),
});

/** An explicit unit bridge into the historical capacity fields; shared RAM occurs once. */
export function hardwareFromProbe(
  value: unknown,
  id: string,
  unit: "gib" | "gb",
): Hardware {
  const snapshot = ProbeSnapshotSchema.parse(value);
  if (
    snapshot.status !== "complete" ||
    snapshot.visibility_limited ||
    !snapshot.cpu ||
    !snapshot.physical_memory
  )
    throw new Error(
      "Only complete, unrestricted inventory can become a Hardware entry.",
    );
  if (unit !== "gib" && unit !== "gb")
    throw new Error("Choose an explicit contract capacity unit: gib or gb.");
  const scale = unit === "gib" ? 2 ** 30 : 1e9;
  const backends = new Set(snapshot.devices.map((d) => d.backend));
  if (backends.has("unknown") || backends.size > 1)
    throw new Error("The Hardware contract requires one known backend.");
  const shared = snapshot.devices.filter((d) => d.memory_kind === "shared");
  if (
    shared.length &&
    (shared.length !== 1 ||
      snapshot.devices.length !== 1 ||
      shared[0]!.backend !== "metal")
  )
    throw new Error("Unsupported shared-memory inventory.");
  const accelerators = snapshot.devices
    .filter((d) => d.memory_kind !== "shared")
    .map((d) => {
      if (d.memory_kind !== "dedicated" || !d.installed_memory)
        throw new Error("Dedicated capacity is incomplete.");
      return {
        vendor: d.vendor,
        model: d.model,
        vram_gb: d.installed_memory.bytes / scale,
        count: 1,
      };
    });
  return HardwareSchema.parse({
    id,
    evidence_kind: "deterministic_observation",
    cpu: { cores: snapshot.cpu.logical_cores, model: snapshot.cpu.model },
    ram_gb: snapshot.physical_memory.bytes / scale,
    accelerators,
    backend: snapshot.devices[0]?.backend ?? "cpu",
    operating_system: snapshot.platform,
    evidence_refs: [],
  });
}

/** Hash only material dependencies. State revisions and decision pointers are not serving inputs. */
export function sizingDependencies(
  contract: ProjectContract,
  input: SizingInput,
  refs: {
    scenario: string;
    observation: string;
    detected: string;
    constraint: string;
  },
): Record<string, string> {
  const b = input.project_binding;
  if (!b) throw new Error("A project binding is required.");
  const candidate = contract.candidates.find((c) => c.id === b.candidate_ref);
  const workload = contract.workloads.find((w) => w.id === b.workload_ref);
  const values: Record<string, unknown> = {
    project: contract.project.id,
    candidate: candidate
      ? {
          id: candidate.id,
          model: candidate.model,
          deployment: candidate.deployment,
          workload_ref: candidate.workload_ref,
        }
      : null,
    workload: workload ? { ...workload, current_decision_ref: null } : null,
    target:
      contract.resources.hardware.find((h) => h.id === b.hardware_ref) ?? null,
    detected:
      contract.resources.hardware.find((h) => h.id === refs.detected) ?? null,
    constraint:
      contract.constraints.find((c) => c.id === refs.constraint) ?? null,
    scenario:
      contract.evidence_refs.find((e) => e.id === refs.scenario) ?? null,
    observation:
      contract.evidence_refs.find((e) => e.id === refs.observation) ?? null,
  };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      hardwareValueDigest(value),
    ]),
  );
}
function inventoryMatchesInput(
  snapshot: ProbeSnapshot,
  input: SizingInput,
): boolean {
  const h = input.hardware;
  if (h.kind === "cpu")
    return (
      h.backend === "cpu" &&
      h.device_count === 1 &&
      h.capacity_bytes === snapshot.physical_memory?.bytes
    );
  if (h.kind === "unified_memory")
    return (
      h.backend === "metal" &&
      h.device_count === 1 &&
      snapshot.devices.length === 1 &&
      snapshot.devices[0]!.memory_kind === "shared" &&
      h.capacity_bytes === snapshot.physical_memory?.bytes
    );
  const selected = input.extensions?.devices;
  if (selected)
    return (
      h.device_count === selected.length &&
      selected.every((device) =>
        snapshot.devices.some(
          (d) =>
            d.id === device.id &&
            d.model === device.model &&
            d.backend === h.backend &&
            d.memory_kind === "dedicated" &&
            d.installed_memory?.bytes === device.capacity_bytes,
        ),
      )
    );
  return (
    h.device_count === 1 &&
    snapshot.devices.some(
      (d) =>
        d.memory_kind === "dedicated" &&
        d.backend === h.backend &&
        d.installed_memory?.bytes === h.capacity_bytes,
    )
  );
}
/** Fail closed in shared admission as well as freshness; a digest is not measurement authentication. */
export function hardwareSizingEvidenceProblem(
  record: EvidenceRecord,
  contract: ProjectContract | undefined,
): string | null {
  if (
    record.kind === "user_declared" &&
    record.value?.format === "anvilmark-sizing-scenario/1"
  )
    return null;
  const marked =
    record.producer?.name === HARDWARE_SIZING_PRODUCER ||
    (record.kind === "tool_observation" &&
      record.value?.estimate_basis?.format ===
        "anvilmark-hardware-fit-evidence/1");
  if (!marked) return null;
  if (!contract)
    return "Hardware sizing requires the complete current project context.";
  if (record.kind !== "tool_observation")
    return "Sizing arithmetic must remain a T2 tool observation.";
  try {
    const basis = HardwareSizingBasisSchema.parse(record.value.estimate_basis);
    const a = basis.artifact;
    const input = a.input;
    const binding = input.project_binding;
    if (!binding || binding.project_id !== contract.project.id)
      return "Sizing belongs to a different project.";
    const candidate = contract.candidates.find(
      (c) => c.id === binding.candidate_ref,
    );
    if (
      !candidate ||
      candidate.workload_ref !== binding.workload_ref ||
      !contract.workloads.some((w) => w.id === binding.workload_ref)
    )
      return "Sizing workload or candidate is missing or changed.";
    if (candidate.measurements.hardware_fit_evidence_ref !== record.id)
      return "A different sizing scenario is selected for this candidate.";
    if (
      candidate.deployment.mode !== "local" ||
      candidate.deployment.hardware_ref !== binding.hardware_ref ||
      candidate.deployment.runtime !== input.runtime.name
    )
      return "Sizing deployment target or runtime changed; remote deployments need a separately versioned hardware binding.";
    if (
      !candidate.model ||
      candidate.model.family !== input.model.id ||
      candidate.model.version !== input.model.revision ||
      candidate.model.version_mutability !== "pinned" ||
      candidate.model.quantization !== input.weights.format
    )
      return "Sizing requires the exact pinned candidate model and weight format.";
    if (!input.runtime.name || !input.runtime.version)
      return "Sizing needs explicit runtime name and version assumptions.";
    if (
      record.applies_to.candidate_ref !== candidate.id ||
      record.applies_to.workload_ref !== candidate.workload_ref ||
      record.applies_to.hardware_ref !== binding.hardware_ref ||
      record.value.target_hardware_ref !== binding.hardware_ref
    )
      return "Sizing attribution differs from its artifact.";
    if (record.applies_to.constraint_refs.length !== 1)
      return "Sizing can support one explicit memory-fit comparison only.";
    const constraint = contract.constraints.find(
      (c) => c.id === record.applies_to.constraint_refs[0],
    );
    if (
      !constraint ||
      constraint.domain !== "hardware" ||
      constraint.severity !== "soft" ||
      constraint.subject !== `candidate.${candidate.id}.memory_fit` ||
      constraint.operator !== "eq" ||
      constraint.value !== true ||
      constraint.condition !== null
    )
      return "Sizing only supports an unconditional soft candidate.<id>.memory_fit eq true comparison; runtime and performance remain unknown.";
    const scenario = contract.evidence_refs.find(
      (e) => e.id === basis.scenario_evidence_ref,
    );
    const obs = contract.evidence_refs.find(
      (e) => e.id === basis.observation_evidence_ref,
    );
    if (
      scenario?.kind !== "user_declared" ||
      hardwareValueDigest(
        SizingScenarioValueSchema.parse(scenario.value).input,
      ) !== a.input_digest
    )
      return "Serving assumptions are missing or changed.";
    if (
      obs?.kind !== "deterministic_observation" ||
      obs.producer.name !== "anvilmark.hardware-probe"
    )
      return "A separately persisted CLI inventory observation is required.";
    const observation = HardwareObservationValueSchema.parse(obs.value);
    const detected = contract.resources.hardware.find(
      (h) => h.id === record.value.detected_hardware_ref,
    );
    const target = contract.resources.hardware.find(
      (h) => h.id === binding.hardware_ref,
    );
    if (
      !detected ||
      detected.evidence_kind !== "deterministic_observation" ||
      !target ||
      target.evidence_kind !== "user_declared" ||
      detected.id === target.id ||
      obs.applies_to.hardware_ref !== detected.id ||
      !detected.evidence_refs.includes(obs.id)
    )
      return "Declared and observed hardware must be distinct, correctly linked entries.";
    const projected = hardwareFromProbe(
      observation.snapshot,
      detected.id,
      observation.contract_capacity_unit,
    );
    if (
      hardwareValueDigest({ ...detected, evidence_refs: [] }) !==
        observation.hardware_digest ||
      hardwareValueDigest(projected) !== observation.hardware_digest ||
      hardwareValueDigest(observation.snapshot) !== observation.snapshot_digest
    )
      return "Persisted inventory no longer matches its Hardware entry.";
    if (observation.snapshot.scope === "remote")
      return "Remote inventory is exportable; this contract version cannot bind a self-hosted deployment to observed hardware.";
    if (
      Date.parse(obs.observed_at) > Date.parse(record.observed_at) ||
      obs.observed_at !== observation.snapshot.observed_at
    )
      return "Inventory observation time is inconsistent.";
    if (!inventoryMatchesInput(observation.snapshot, input))
      return "Sizing capacities or selected devices differ from the observed target.";
    if (
      input.extensions?.observation &&
      hardwareValueDigest(input.extensions.observation.snapshot) !==
        observation.snapshot_digest
    )
      return "The imported inventory differs from the persisted CLI observation.";
    const expected = estimateModelFit(input);
    if (
      expected.status !== "calculated" ||
      expected.memory.assessment === "unknown"
    )
      return "Incomplete or unsupported sizing cannot settle a memory-fit comparison.";
    if (
      hardwareValueDigest(expected) !== hardwareValueDigest(a.result) ||
      a.input_digest !== hardwareValueDigest(input) ||
      a.dependency_digest !==
        hardwareValueDigest({
          input,
          model_profile: expected.model_profile,
          estimator_version: expected.estimator_version,
          catalog_version: expected.catalog_version,
        })
    )
      return "Sizing artifact fails local recomputation.";
    const { integrity_hash, ...content } = a;
    if (integrity_hash !== hardwareValueDigest(content))
      return "Sizing artifact content was changed.";
    const findings = {
      memory_fit: expected.memory.assessment === "estimated_within_budget",
      runtime_compatibility: "unknown",
      performance: "unverified",
    };
    if (
      hardwareValueDigest(record.value.findings) !==
      hardwareValueDigest(findings)
    )
      return "Sizing findings differ from recomputed memory arithmetic.";
    const actual = sizingDependencies(contract, input, {
      scenario: scenario.id,
      observation: obs.id,
      detected: detected.id,
      constraint: constraint.id,
    });
    if (hardwareValueDigest(actual) !== hardwareValueDigest(basis.dependencies))
      return "Sizing dependencies changed; recompute and attach a new scenario.";
    return null;
  } catch {
    return "Hardware sizing evidence is malformed or uses an unsupported format.";
  }
}
