import { resolve } from "node:path";
import { z } from "zod/v4";
import {
  discoverLocalModels,
  probeLocalHardware,
  probeRemoteHardware,
  snapshotHardware,
  snapshotEvidence,
} from "@anvilmark/adapters";
import {
  EvidenceRecordSchema,
  HardwareObservationValueSchema,
  HardwareSizingBasisSchema,
  HARDWARE_SIZING_PRODUCER,
  IdSchema,
  hardwareSizingEvidenceProblem,
  hardwareObservationProblem,
  sizingDependencies,
} from "@anvilmark/project-contract";
import type { ProjectContract } from "@anvilmark/project-contract";
import {
  SizingArtifactSchema,
  SizingInputSchema,
  createSizingArtifact,
  listModelProfiles,
  verifySizingArtifact,
} from "@anvilmark/hardware-sizing";
import type { SizingInput } from "@anvilmark/hardware-sizing";
import { EXIT } from "../io.js";
import type { ExitCode } from "../io.js";
import {
  Cancelled,
  UsageError,
  commit,
  flag,
  openProject,
  parse,
  requiredOption,
  stringOption,
} from "./common.js";
import type { CommandContext } from "./common.js";
import { readBoundedJson, hashText } from "./hardware.js";

export const HARDWARE_ACTION_USAGE = `Hardware observation and contract workflow:
  anvilmark hardware probe [--host user@host --port 22 --known-hosts PATH] [--timeout-ms 15000] [--json]
  anvilmark hardware probe --write --id OBSERVED_ID --evidence-id EVIDENCE_ID --capacity-unit gib|gb [--as-declared NEW_TARGET_ID] [-C DIR] [--json]
  anvilmark hardware discover [--json]
  anvilmark hardware recommend --file SCENARIO.json [--json]
  anvilmark hardware apply --file SCENARIO_OR_ARTIFACT.json --candidate ID --target ID --observation-evidence ID --constraint ID --id NEW_EVIDENCE_ID --scenario-id NEW_SCENARIO_ID [-C DIR]
  anvilmark hardware apply --file PROPOSAL.json --write [-C DIR]

probe is read-only by default; --write only appends a complete observed entry.
--as-declared explicitly creates a separate T1 declaration and never replaces an id.
SSH is Linux-only, non-interactive and requires a trusted host key and Python 3.
apply first returns a bound proposal; --write checks its base revision and all dependencies.
Only a soft candidate.<id>.memory_fit eq true comparison can use sizing evidence.
recommend compares the pinned catalog under your assumptions; it does not rank quality.`;
const ProposalSchema = z.strictObject({
  format: z.literal("anvilmark-hardware-proposal/1"),
  base_contract_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  artifact: SizingArtifactSchema,
  observation_evidence_ref: IdSchema,
  constraint_ref: IdSchema,
  evidence_id: IdSchema,
  scenario_id: IdSchema,
});
type Proposal = z.infer<typeof ProposalSchema>;
function requireFreshIds(contract: ProjectContract, ids: string[]): void {
  if (new Set(ids).size !== ids.length)
    throw new Error("New record ids must be distinct.");
  for (const id of ids) {
    IdSchema.parse(id);
    if (
      contract.evidence_refs.some((e) => e.id === id) ||
      contract.resources.hardware.some((h) => h.id === id)
    )
      throw new Error(
        `Id ${id} already exists; hardware commands never replace records.`,
      );
  }
}
function quietCommitContext(context: CommandContext): CommandContext {
  return { ...context, io: { ...context.io, stdout: context.io.stderr } };
}
function assertActive(context: CommandContext): void {
  if (context.io.signal.aborted)
    throw new Cancelled("Hardware operation cancelled; nothing was written.");
}
function proposalContract(
  contract: ProjectContract,
  proposal: Proposal,
): ProjectContract {
  const next = structuredClone(contract);
  const a = proposal.artifact;
  const b = a.input.project_binding;
  if (!b) throw new Error("Proposal is not project-bound.");
  requireFreshIds(next, [proposal.evidence_id, proposal.scenario_id]);
  const observation = next.evidence_refs.find(
    (e) => e.id === proposal.observation_evidence_ref,
  );
  if (!observation || observation.kind !== "deterministic_observation")
    throw new Error("Select a persisted CLI inventory evidence id.");
  HardwareObservationValueSchema.parse(observation.value);
  const candidate = next.candidates.find((c) => c.id === b.candidate_ref);
  if (!candidate) throw new Error("Candidate does not exist.");
  const base = {
    producer: {
      name: HARDWARE_SIZING_PRODUCER,
      version: a.result.estimator_version,
    },
    observed_at: a.evaluated_at,
    confidence: "medium",
    refresh: { policy: "on_hardware_or_model_change", expires_at: null },
    applies_to: {
      candidate_ref: b.candidate_ref,
      workload_ref: b.workload_ref,
      hardware_ref: b.hardware_ref,
      constraint_refs: [proposal.constraint_ref],
    },
  };
  const scenario = EvidenceRecordSchema.parse({
    ...base,
    id: proposal.scenario_id,
    subject: `candidate.${candidate.id}.serving_assumptions`,
    kind: "user_declared",
    source: { type: "manual", locator: null },
    caveats: ["Explicit serving and allocation assumptions, not measurements."],
    value: { format: "anvilmark-sizing-scenario/1", input: a.input },
  });
  next.evidence_refs.push(scenario);
  const basis = HardwareSizingBasisSchema.parse({
    format: "anvilmark-hardware-fit-evidence/1",
    artifact: a,
    scenario_evidence_ref: scenario.id,
    observation_evidence_ref: observation.id,
    dependencies: sizingDependencies(next, a.input, {
      scenario: scenario.id,
      observation: observation.id,
      detected: observation.applies_to.hardware_ref!,
      constraint: proposal.constraint_ref,
    }),
  });
  const within = a.result.memory.assessment === "estimated_within_budget";
  const record = EvidenceRecordSchema.parse({
    ...base,
    id: proposal.evidence_id,
    subject: `candidate.${candidate.id}.memory_fit`,
    kind: "tool_observation",
    source: { type: "local_command", locator: "anvilmark hardware apply" },
    caveats: [
      "Reproducible memory arithmetic under T1 assumptions. Runtime compatibility, latency, throughput and actual target execution remain unverified.",
    ],
    value: {
      estimate_basis: basis,
      target_hardware_ref: b.hardware_ref,
      detected_hardware_ref: observation.applies_to.hardware_ref,
      findings: {
        memory_fit: within,
        runtime_compatibility: "unknown",
        performance: "unverified",
      },
    },
  });
  next.evidence_refs.push(record);
  candidate.measurements.hardware_fit_evidence_ref = record.id;
  const problem =
    hardwareSizingEvidenceProblem(record, next) ??
    hardwareObservationProblem(record, (id) =>
      next.resources.hardware.find((h) => h.id === id),
    );
  if (problem) throw new Error(problem);
  const result = {
    constraint_ref: proposal.constraint_ref,
    status: within ? ("pass" as const) : ("fail" as const),
    evidence_refs: [record.id],
    determinism: "deterministic" as const,
    explanation:
      "Memory accounting under the recorded scenario; no runtime or performance claim.",
    evaluated_at: a.evaluated_at,
  };
  candidate.constraint_results = candidate.constraint_results.filter(
    (r) => r.constraint_ref !== proposal.constraint_ref,
  );
  candidate.constraint_results.push(result);
  return next;
}
async function scenarioFrom(value: unknown): Promise<SizingInput> {
  if (typeof value === "object" && value !== null && "format" in value) {
    const checked = await verifySizingArtifact(value, hashText);
    if (!checked.ok)
      throw new Error(
        `Sizing artifact failed verification: ${checked.issues.join("; ")}`,
      );
    return checked.artifact.input;
  }
  return SizingInputSchema.parse(value);
}
export async function hardwareActionCommand(
  context: CommandContext,
  sub: string,
): Promise<ExitCode> {
  const allowed: Record<
    string,
    Record<string, { type: "string" | "boolean" }>
  > = {
    probe: {
      host: { type: "string" },
      port: { type: "string" },
      "known-hosts": { type: "string" },
      "timeout-ms": { type: "string" },
      write: { type: "boolean" },
      id: { type: "string" },
      "evidence-id": { type: "string" },
      "capacity-unit": { type: "string" },
      "as-declared": { type: "string" },
    },
    discover: {},
    recommend: { file: { type: "string" } },
    apply: {
      file: { type: "string" },
      candidate: { type: "string" },
      target: { type: "string" },
      "observation-evidence": { type: "string" },
      constraint: { type: "string" },
      id: { type: "string" },
      "scenario-id": { type: "string" },
      write: { type: "boolean" },
    },
  };
  const parsed = parse(context.args, allowed[sub] ?? {}, HARDWARE_ACTION_USAGE);
  if (flag(parsed, "help")) {
    context.io.stdout(`${HARDWARE_ACTION_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length)
    throw new UsageError(
      "Unexpected positional arguments.",
      HARDWARE_ACTION_USAGE,
    );
  const option = (name: string) => stringOption(parsed, name);
  const required = (name: string) =>
    requiredOption(parsed, name, HARDWARE_ACTION_USAGE);
  assertActive(context);
  if (sub === "probe") {
    const write = flag(parsed, "write");
    const declared = option("as-declared");
    const id = option("id");
    const evidenceId = option("evidence-id");
    const unit = option("capacity-unit");
    if (!write && (declared || id || evidenceId || unit))
      throw new UsageError(
        "Record ids and capacity units require --write.",
        HARDWARE_ACTION_USAGE,
      );
    if (write && (!id || !evidenceId || !(unit === "gib" || unit === "gb")))
      throw new UsageError(
        "--write requires --id, --evidence-id and --capacity-unit gib|gb.",
        HARDWARE_ACTION_USAGE,
      );
    if (!option("host") && (option("port") || option("known-hosts")))
      throw new UsageError(
        "SSH options require --host.",
        HARDWARE_ACTION_USAGE,
      );
    const loaded = write ? await openProject(context.io, parsed) : null;
    if (loaded)
      requireFreshIds(loaded.contract, [
        id!,
        evidenceId!,
        ...(declared ? [declared, `${declared}.declaration`] : []),
      ]);
    const common = {
      signal: context.io.signal,
      timeoutMs: Number(option("timeout-ms") ?? 15000),
      dependencies: {
        clock: context.io.clock,
        env: context.io.env,
        ...context.hardwareProbeDependencies,
      },
    };
    const snapshot = option("host")
      ? await probeRemoteHardware({
          ...common,
          host: required("host"),
          ...(option("port") ? { port: Number(option("port")) } : {}),
          ...(option("known-hosts")
            ? { knownHosts: option("known-hosts")! }
            : {}),
        })
      : await probeLocalHardware(common);
    assertActive(context);
    if (loaded) {
      const next = structuredClone(loaded.contract);
      const hardware = snapshotHardware(snapshot, id!, unit as "gib" | "gb");
      const evidence = snapshotEvidence(
        snapshot,
        hardware,
        unit as "gib" | "gb",
        evidenceId!,
      );
      hardware.evidence_refs = [evidence.id];
      next.resources.hardware.push(hardware);
      next.evidence_refs.push(evidence);
      if (declared) {
        const declaration = EvidenceRecordSchema.parse({
          ...evidence,
          id: `${declared}.declaration`,
          kind: "user_declared",
          subject: `hardware.${declared}.inventory`,
          source: { type: "manual", locator: null },
          applies_to: {
            candidate_ref: null,
            workload_ref: null,
            hardware_ref: declared,
            constraint_refs: [],
          },
          value: {
            format: "anvilmark-hardware-declaration/1",
            from_observation_ref: evidence.id,
            contract_capacity_unit: unit,
          },
          caveats: [
            "Explicit --as-declared target selection; a separate T1 declaration.",
          ],
        });
        next.resources.hardware.push({
          ...hardware,
          id: declared,
          evidence_kind: "user_declared",
          evidence_refs: [declaration.id],
        });
        next.evidence_refs.push(declaration);
      }
      assertActive(context);
      await commit(quietCommitContext(context), loaded, next, {
        command: "hardware probe",
        summary: `Recorded observed hardware ${id}${declared ? ` and separate declared target ${declared}` : ""}`,
      });
    }
    context.io.stdout(`${JSON.stringify(snapshot, null, 2)}\n`);
    return snapshot.status === "complete" ? EXIT.ok : EXIT.failed;
  }
  if (sub === "discover") {
    const inventory = await discoverLocalModels({ signal: context.io.signal });
    context.io.stdout(
      `${JSON.stringify({ format: "anvilmark-local-model-inventory/1", inventory }, null, 2)}\n`,
    );
    return context.io.signal.aborted ? EXIT.cancelled : EXIT.ok;
  }
  const raw = await readBoundedJson(
    resolve(context.io.cwd, required("file")),
    context.io.signal,
  );
  if (sub === "recommend") {
    const input = await scenarioFrom(raw);
    const scenarios = await Promise.all(
      listModelProfiles().map((model) =>
        createSizingArtifact(
          {
            ...input,
            model: { id: model.id, revision: model.revision },
            project_binding: null,
          },
          { evaluatedAt: context.io.clock(), hashText },
        ),
      ),
    );
    context.io.stdout(
      `${JSON.stringify({ format: "anvilmark-hardware-comparison/1", basis: "Catalog memory comparison under identical caller assumptions; no quality, runtime or performance ranking.", scenarios }, null, 2)}\n`,
    );
    return EXIT.ok;
  }
  const loaded = await openProject(context.io, parsed);
  let proposal: Proposal;
  if (
    typeof raw === "object" &&
    raw !== null &&
    "format" in raw &&
    raw.format === "anvilmark-hardware-proposal/1"
  ) {
    if (
      [
        "candidate",
        "target",
        "observation-evidence",
        "constraint",
        "id",
        "scenario-id",
      ].some((name) => option(name) !== undefined)
    )
      throw new Error(
        "A bound proposal cannot be overridden with binding flags.",
      );
    proposal = ProposalSchema.parse(raw);
    if (
      proposal.base_contract_digest !== loaded.digest ||
      proposal.artifact.input.project_binding?.base_contract_digest !==
        loaded.digest
    )
      throw new Error(
        "The project changed after preview. Generate a new proposal before writing.",
      );
    const check = await verifySizingArtifact(proposal.artifact, hashText);
    if (!check.ok)
      throw new Error(
        `Sizing artifact failed verification: ${check.issues.join("; ")}`,
      );
  } else {
    if (flag(parsed, "write"))
      throw new UsageError(
        "First export a bound proposal with hardware apply; --write accepts only that proposal.",
        HARDWARE_ACTION_USAGE,
      );
    const input = await scenarioFrom(raw);
    const candidate = loaded.contract.candidates.find(
      (c) => c.id === required("candidate"),
    );
    if (!candidate) throw new Error("Candidate does not exist.");
    input.project_binding = {
      project_id: loaded.contract.project.id,
      base_contract_digest: loaded.digest,
      candidate_ref: candidate.id,
      workload_ref: candidate.workload_ref,
      hardware_ref: required("target"),
    };
    const artifact = await createSizingArtifact(input, {
      evaluatedAt: context.io.clock(),
      hashText,
    });
    proposal = ProposalSchema.parse({
      format: "anvilmark-hardware-proposal/1",
      base_contract_digest: loaded.digest,
      artifact,
      observation_evidence_ref: required("observation-evidence"),
      constraint_ref: required("constraint"),
      evidence_id: required("id"),
      scenario_id: required("scenario-id"),
    });
  }
  const next = proposalContract(loaded.contract, proposal);
  assertActive(context);
  if (
    Date.parse(proposal.artifact.evaluated_at) > Date.parse(context.io.clock())
  )
    throw new Error("Proposal evaluation time is in the future.");
  if (flag(parsed, "write"))
    await commit(quietCommitContext(context), loaded, next, {
      command: "hardware apply",
      summary: `Attached memory estimate ${proposal.evidence_id}`,
      provenance: { input_digest: proposal.artifact.input_digest },
    });
  context.io.stdout(`${JSON.stringify(proposal, null, 2)}\n`);
  return EXIT.ok;
}
