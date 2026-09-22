import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CandidateSchema,
  ConstraintSchema,
  admitEvidence,
  hardwareSizingEvidenceProblem,
  validateProjectContract,
} from "@anvilmark/project-contract";
import { createPlanningInput } from "@anvilmark/hardware-sizing";
import { freshnessOf, runSubprocess } from "@anvilmark/adapters";
import type { ProbeDependencies } from "@anvilmark/adapters";
import { hardwareCommand } from "../src/commands/hardware.js";
import { commit } from "../src/commands/common.js";
import { loadProject, nodeStoreFs } from "../src/store.js";
import { atlasProject, cleanup, cli, scriptedIo, tempDir } from "./helpers.js";
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
describe("hardware transactions and evidence honesty", () => {
  it("probes without a project or prompts and emits exactly one JSON object", async () => {
    const root = await tempDir();
    const result = await probe(root, ["--json"]);
    expect(result.code, result.io.err()).toBe(0);
    expect(JSON.parse(result.io.out()).status).toBe("complete");
    expect(result.io.prompts).toEqual([]);
  });
  it("appends distinct T3 observation and explicit T1 declaration; collisions never overwrite", async () => {
    const root = await atlasProject();
    const before = (await loadProject(root)).contract.resources.hardware;
    const result = await probe(root, writeArgs);
    expect(result.code, result.io.err()).toBe(0);
    const after = await loadProject(root);
    expect(after.contract.resources.hardware.slice(0, before.length)).toEqual(
      before,
    );
    expect(
      after.contract.resources.hardware.find((h) => h.id === "observed.test")!
        .evidence_kind,
    ).toBe("deterministic_observation");
    expect(
      after.contract.resources.hardware.find((h) => h.id === "target.test")!
        .evidence_kind,
    ).toBe("user_declared");
    expect(result.io.prompts).toEqual([]);
    const collision = await probe(root, writeArgs);
    expect(collision.code).toBe(1);
    expect((await loadProject(root)).digest).toBe(after.digest);
  });
  it("requires explicit write intent for declaration selection", async () => {
    const root = await tempDir();
    const result = await probe(root, [
      "--as-declared",
      "target.test",
      "--json",
    ]);
    expect(result.code).toBe(2);
  });
  it("rolls back a failed transaction without replacing the project", async () => {
    const root = await atlasProject();
    const before = await loadProject(root);
    const io = scriptedIo({ cwd: root, clock });
    const code = await hardwareCommand(
      {
        io,
        args: writeArgs,
        hardwareProbeDependencies: deps,
        storeFs: {
          ...nodeStoreFs,
          replace: async () => {
            throw new Error("test replace failure");
          },
        },
      },
      "probe",
    );
    expect(code).toBe(1);
    expect((await loadProject(root)).digest).toBe(before.digest);
  });
  it("previews a reproducible bound proposal read-only, then attaches T1 assumptions and a T2 memory comparison", async () => {
    const { root } = await prepared();
    const before = await loadProject(root);
    await preview(root);
    expect((await loadProject(root)).digest).toBe(before.digest);
    const io = await attach(root);
    expect(JSON.parse(io.out()).format).toBe("anvilmark-hardware-proposal/1");
    expect(io.err()).toContain("Saved state revision");
    const after = await loadProject(root);
    const record = after.contract.evidence_refs.find(
      (e) => e.id === "fit.test",
    )!;
    expect(record.kind).toBe("tool_observation");
    expect(hardwareSizingEvidenceProblem(record, after.contract)).toBeNull();
    expect(
      freshnessOf(record, after.contract.evidence_refs, {
        asOf: clock(),
        contract: after.contract,
      }).state,
    ).toBe("current");
    expect(
      after.contract.candidates.find((c) => c.id === "candidate.hardware-test")!
        .constraint_results[0]!.status,
    ).toBe("pass");
    expect(
      after.contract.evidence_refs.find((e) => e.id === "scenario.test")!.kind,
    ).toBe("user_declared");
  });
  it("refuses stale project proposals and raw input writes", async () => {
    const { root } = await prepared();
    await preview(root);
    const before = await loadProject(root);
    const changed = structuredClone(before.contract);
    changed.intent.summary += " Revised.";
    await commit(
      { io: scriptedIo({ cwd: root, clock }), args: [] },
      before,
      changed,
      { command: "test edit", summary: "Revision" },
    );
    const io = scriptedIo({ cwd: root, clock });
    expect(
      await cli(
        ["hardware", "apply", "--file", "proposal.json", "--write", "--json"],
        io,
      ),
    ).toBe(1);
    expect(io.err()).toContain("project changed");
    expect(
      await cli(
        ["hardware", "apply", "--file", "scenario.json", "--write"],
        scriptedIo({ cwd: root, clock }),
      ),
    ).toBe(2);
  });
  it("invalidates every material dependency and refuses a relabelled hard gate", async () => {
    const { root } = await prepared();
    await preview(root);
    await attach(root);
    const contract = (await loadProject(root)).contract;
    const original = contract.evidence_refs.find((e) => e.id === "fit.test")!;
    for (const mutate of [
      (c: typeof contract) => {
        c.resources.hardware.find((h) => h.id === "target.test")!.ram_gb = 128;
      },
      (c: typeof contract) => {
        c.candidates.find(
          (x) => x.id === "candidate.hardware-test",
        )!.model!.version = "changed";
      },
      (c: typeof contract) => {
        c.workloads[0]!.expected_usage.calls_per_month = 12345;
      },
      (c: typeof contract) => {
        c.evidence_refs.find((e) => e.id === "scenario.test")!.value.extra =
          "changed";
      },
      (c: typeof contract) => {
        c.evidence_refs.find((e) => e.id === "inventory.test")!.value.extra =
          "changed";
      },
      (c: typeof contract) => {
        c.constraints.find((x) => x.id === "hardware.test-memory")!.value =
          false;
      },
    ]) {
      const changed = structuredClone(contract);
      mutate(changed);
      expect(hardwareSizingEvidenceProblem(original, changed)).not.toBeNull();
      expect(
        freshnessOf(original, changed.evidence_refs, {
          asOf: clock(),
          contract: changed,
        }).state,
      ).toBe("stale");
      expect(validateProjectContract(changed).ok).toBe(false);
    }
    expect(
      admitEvidence(
        original,
        ConstraintSchema.parse({
          id: "hardware.test-memory",
          domain: "hardware",
          severity: "hard",
          subject: "candidate.candidate.hardware-test.memory_fit",
          operator: "eq",
          value: true,
          source: "user",
        }),
        { projectContract: contract, candidateRef: "candidate.hardware-test" },
      ).admitted,
    ).toBe(false);
    const loaded = await loadProject(root);
    const changed = structuredClone(loaded.contract);
    changed.resources.hardware.find((h) => h.id === "target.test")!.ram_gb =
      128;
    await commit(
      { io: scriptedIo({ cwd: root, clock }), args: [] },
      loaded,
      changed,
      { command: "test edit", summary: "Target changed" },
    );
    const next = await loadProject(root);
    const candidate = next.contract.candidates.find(
      (c) => c.id === "candidate.hardware-test",
    )!;
    expect(candidate.measurements.hardware_fit_evidence_ref).toBeNull();
    expect(candidate.constraint_results[0]!.status).toBe("unknown");
    expect(next.contract.evidence_refs.some((e) => e.id === "fit.test")).toBe(
      true,
    );
  });
  it("detects tampered proposal arithmetic before any write", async () => {
    const { root } = await prepared();
    const proposal = await preview(root);
    proposal.artifact.result.memory.headroom_bytes = 999;
    await writeFile(join(root, "proposal.json"), JSON.stringify(proposal));
    const before = await readFile(
      join(root, ".anvilmark/project.yaml"),
      "utf8",
    );
    const io = scriptedIo({ cwd: root, clock });
    expect(
      await cli(
        ["hardware", "apply", "--file", "proposal.json", "--write", "--json"],
        io,
      ),
    ).toBe(1);
    expect(await readFile(join(root, ".anvilmark/project.yaml"), "utf8")).toBe(
      before,
    );
  });
});

it("does not admit a pass relabelled from a correctly recomputed over-budget result", async () => {
  const { root, input } = await prepared();
  input.hardware.allocation_limit_bytes = 8 * 2 ** 30;
  await writeFile(join(root, "scenario.json"), JSON.stringify(input));
  await preview(root);
  await attach(root);
  const contract = (await loadProject(root)).contract;
  const candidate = contract.candidates.find(
    (c) => c.id === "candidate.hardware-test",
  )!;
  expect(candidate.constraint_results[0]!.status).toBe("fail");
  candidate.constraint_results[0]!.status = "pass";
  const validation = validateProjectContract(contract);
  expect(validation.ok).toBe(false);
  if (!validation.ok)
    expect(JSON.stringify(validation.issues)).toContain(
      "asserted pass contradicts",
    );
});
