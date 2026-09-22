import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CandidateSchema,
  ConstraintSchema,
  hardwareSizingEvidenceProblem,
  validateProjectContract,
} from "@anvilmark/project-contract";
import { createPlanningInput } from "@anvilmark/hardware-sizing";
import { runSubprocess } from "@anvilmark/adapters";
import type { ProbeDependencies } from "@anvilmark/adapters";
import { hardwareCommand } from "../src/commands/hardware.js";
import { commit } from "../src/commands/common.js";
import { loadProject } from "../src/store.js";
import { atlasProject, cleanup, cli, scriptedIo } from "./helpers.js";
afterEach(cleanup);
const clock = () => "2026-09-18T00:00:00.000Z";
const deps: Partial<ProbeDependencies> = {
  platform: "darwin",
  cpu: () => ({ cores: 8, model: "Test CPU" }),
  totalMemory: () => 64 * 2 ** 30,
  id: () => "probe.test",
  run: (request) =>
    runSubprocess(
      {
        executable: process.execPath,
        args: [
          "-e",
          `process.stdout.write(${JSON.stringify(request.executable === "sysctl" ? "1" : JSON.stringify({ SPDisplaysDataType: [{ sppci_model: "Apple M2", spdisplays_metal: "spdisplays_metal3" }] }))})`,
        ],
        timeoutMs: 1000,
        maxOutputBytes: 1024,
      },
      {
        identity: {
          id: "test.probe",
          kind: "hardware_fit",
          execution: "local",
          version: "test",
          protocol_version: "0.1.0",
        },
      },
    ),
};
async function probe(root: string, extra: string[] = []) {
  const io = scriptedIo({ cwd: root, clock });
  const code = await hardwareCommand(
    { io, args: extra, hardwareProbeDependencies: deps },
    "probe",
  );
  return { code, io };
}
const writeArgs = [
  "--write",
  "--id",
  "observed.test",
  "--evidence-id",
  "inventory.test",
  "--capacity-unit",
  "gib",
  "--as-declared",
  "target.test",
  "--json",
];
async function prepared() {
  const root = await atlasProject();
  const collected = await probe(root, writeArgs);
  expect(collected.code, collected.io.err()).toBe(0);
  const loaded = await loadProject(root);
  const next = structuredClone(loaded.contract);
  const input = createPlanningInput();
  input.hardware = {
    label: "Test Metal",
    kind: "unified_memory",
    backend: "metal",
    evidence_kind: "user_declared",
    capacity_bytes: 64 * 2 ** 30,
    allocation_limit_bytes: 48 * 2 ** 30,
    reserve_bytes: 4 * 2 ** 30,
    device_count: 1,
  };
  input.placement = "unified_pool";
  input.runtime = {
    name: "llama.cpp",
    version: "test-pinned",
    basis: "user_assumption",
    overhead_bytes: 2 ** 30,
    allocator_allowance_bytes: 2 ** 30,
  };
  const candidate = CandidateSchema.parse({
    id: "candidate.hardware-test",
    workload_ref: next.workloads[0]!.id,
    component_kind: "model_runtime",
    model: {
      family: input.model.id,
      version: input.model.revision,
      version_mutability: "pinned",
      quantization: "bf16",
    },
    deployment: {
      mode: "local",
      hardware_ref: "target.test",
      runtime: "llama.cpp",
    },
    status: "unevaluated",
  });
  next.candidates.push(candidate);
  next.constraints.push(
    ConstraintSchema.parse({
      id: "hardware.test-memory",
      domain: "hardware",
      severity: "soft",
      direction: "target",
      subject: `candidate.${candidate.id}.memory_fit`,
      operator: "eq",
      value: true,
      source: "user",
    }),
  );
  await commit(
    { io: scriptedIo({ cwd: root, clock }), args: [] },
    loaded,
    next,
    { command: "test setup", summary: "Test setup" },
  );
  await writeFile(join(root, "scenario.json"), JSON.stringify(input));
  return { root, input };
}
async function preview(root: string) {
  const io = scriptedIo({ cwd: root, clock });
  const code = await cli(
    [
      "hardware",
      "apply",
      "--file",
      "scenario.json",
      "--candidate",
      "candidate.hardware-test",
      "--target",
      "target.test",
      "--observation-evidence",
      "inventory.test",
      "--constraint",
      "hardware.test-memory",
      "--id",
      "fit.test",
      "--scenario-id",
      "scenario.test",
      "--json",
    ],
    io,
  );
  expect(code, io.err()).toBe(0);
  await writeFile(join(root, "proposal.json"), io.out());
  return JSON.parse(io.out());
}
async function attach(root: string) {
  const io = scriptedIo({ cwd: root, clock });
  const code = await cli(
    ["hardware", "apply", "--file", "proposal.json", "--write", "--json"],
    io,
  );
  expect(code, io.err()).toBe(0);
  return io;
}

/**
 * INDEPENDENT REVIEW PROBES (Claude): adversarial edits that must never be
 * admitted. These check the attachment boundary itself, not the arithmetic.
 */
describe("review probes: tampering with attached sizing evidence", () => {
  it("refuses findings relabelled to pass while the recomputation is over budget", async () => {
    const { root, input } = await prepared();
    input.hardware.allocation_limit_bytes = 8 * 2 ** 30;
    await writeFile(join(root, "scenario.json"), JSON.stringify(input));
    await preview(root);
    await attach(root);
    const contract = (await loadProject(root)).contract;
    const record = contract.evidence_refs.find((e) => e.id === "fit.test")!;
    expect(record.value.findings.memory_fit).toBe(false);
    record.value.findings.memory_fit = true;
    expect(hardwareSizingEvidenceProblem(record, contract)).not.toBeNull();
    // The dangerous combination: relabel the findings AND assert the pass.
    const candidate = contract.candidates.find(
      (c) => c.id === "candidate.hardware-test",
    )!;
    expect(candidate.constraint_results[0]!.status).toBe("fail");
    candidate.constraint_results[0]!.status = "pass";
    const validation = validateProjectContract(contract);
    expect(validation.ok).toBe(false);
    if (!validation.ok)
      expect(JSON.stringify(validation.issues)).toContain(
        "findings differ from recomputed memory arithmetic",
      );
  });

  it("refuses a sizing record whose persisted inventory was edited", async () => {
    const { root } = await prepared();
    await preview(root);
    await attach(root);
    const contract = (await loadProject(root)).contract;
    const record = contract.evidence_refs.find((e) => e.id === "fit.test")!;
    expect(hardwareSizingEvidenceProblem(record, contract)).toBeNull();
    const observation = contract.evidence_refs.find(
      (e) => e.id === "inventory.test",
    )!;
    observation.value.snapshot.physical_memory.bytes = 128 * 2 ** 30;
    expect(hardwareSizingEvidenceProblem(record, contract)).not.toBeNull();
  });

  it("refuses sizing that cites a declared target as its observed inventory", async () => {
    const { root } = await prepared();
    await preview(root);
    await attach(root);
    const contract = (await loadProject(root)).contract;
    const record = contract.evidence_refs.find((e) => e.id === "fit.test")!;
    record.value.detected_hardware_ref = "target.test";
    expect(hardwareSizingEvidenceProblem(record, contract)).not.toBeNull();
  });

  it("refuses remotely collected inventory as a contract fit basis", async () => {
    const { root } = await prepared();
    await preview(root);
    await attach(root);
    const contract = (await loadProject(root)).contract;
    const record = contract.evidence_refs.find((e) => e.id === "fit.test")!;
    const observation = contract.evidence_refs.find(
      (e) => e.id === "inventory.test",
    )!;
    observation.value.snapshot.scope = "remote";
    const problem = hardwareSizingEvidenceProblem(record, contract);
    expect(problem).not.toBeNull();
  });

  it("refuses a sizing record moved to another candidate's constraint", async () => {
    const { root } = await prepared();
    await preview(root);
    await attach(root);
    const contract = (await loadProject(root)).contract;
    const record = contract.evidence_refs.find((e) => e.id === "fit.test")!;
    record.applies_to.constraint_refs = [];
    expect(hardwareSizingEvidenceProblem(record, contract)).not.toBeNull();
  });
});
