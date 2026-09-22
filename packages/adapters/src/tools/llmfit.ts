import { createHash } from "node:crypto";

import type { Hardware } from "@anvilmark/project-contract";
import {
  hardwareCapabilitiesMatch,
  stableStringify,
} from "@anvilmark/project-contract";
import { z } from "zod/v4";

import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import type { AdapterIdentity, AdapterOutcome } from "../envelope.js";
import {
  adapterError,
  available,
  isAvailable,
  notAvailable,
} from "../envelope.js";
import { ADAPTER_PROTOCOL_VERSION } from "../version.js";
import type { AdapterProbe, EvidenceAdapter } from "../evidence/adapter.js";
import type { BuiltEvidence } from "../evidence/builder.js";
import { buildEvidenceRecord } from "../evidence/builder.js";
import { runSubprocess } from "../subprocess/runner.js";

/**
 * The `llmfit --json` system block, read from upstream source rather than prose.
 *
 * Emitted by `serve_shared::system_json` and wrapped by
 * `display::display_json_system` / `display_json_fits`. Pinned to commit
 * 53951c3f89aa0dc7afbc0a6d52ccbe27417421e2; see
 * `test/fixtures/PROVENANCE.md`.
 *
 * There is deliberately no `node` object here — that belongs to the HTTP API,
 * not the CLI — and no operating-system field anywhere in the CLI output, so
 * ANVILMARK observes the OS itself.
 */
const LlmfitGpuSchema = z
  .object({
    name: z.string().min(1),
    vram_gb: z.number().nonnegative().nullable(),
    backend: z.string().min(1),
    count: z.number().int().positive(),
    unified_memory: z.boolean(),
  })
  .loose();

const LlmfitSystemBlockSchema = z
  .object({
    total_ram_gb: z.number().nonnegative(),
    available_ram_gb: z.number().nonnegative(),
    cpu_cores: z.number().int().positive(),
    cpu_name: z.string().nullable(),
    has_gpu: z.boolean(),
    gpu_vram_gb: z.number().nonnegative().nullable(),
    gpu_available_gb: z.number().nonnegative().nullable(),
    gpu_name: z.string().nullable(),
    gpu_count: z.number().int().nonnegative(),
    unified_memory: z.boolean(),
    backend: z.string().min(1),
    gpus: z.array(LlmfitGpuSchema),
  })
  .loose();

/**
 * A model fit entry, from `serve_shared::fit_to_json` with the CLI's overlays.
 *
 * At the pinned commit `fit_to_json` emits BOTH: `fit_level` carries the code
 * (`perfect`, `good`, `marginal`, `too_tight`) and `fit_label` carries the
 * human string (`Perfect`, `Good`, …). The value is recorded as reported and
 * is not interpreted here.
 */
const LlmfitModelSchema = z
  .object({
    name: z.string().min(1),
    provider: z.string().nullable().optional(),
    best_quant: z.string().min(1).nullable(),
    fit_level: z.string().min(1),
    score: z.number().optional(),
    estimated_tps: z.number().nonnegative().nullable().optional(),
    memory_required_gb: z.number().nonnegative(),
    memory_available_gb: z.number().nonnegative().optional(),
    utilization_pct: z.number().optional(),
    license: z.string().nullable().optional(),
    runtime: z.string().optional(),
    estimate_basis: z.unknown().optional(),
    measured_tps: z.number().nonnegative().nullable().optional(),
  })
  .loose();

/** The `llmfit --json info <model>` envelope: system plus the model fits. */
const LlmfitInfoSchema = z
  .object({
    system: LlmfitSystemBlockSchema,
    models: z.array(LlmfitModelSchema),
  })
  .loose();

/**
 * How ANVILMARK learns which operating system it is on.
 *
 * llmfit reports no OS, so this is an ANVILMARK deterministic observation and
 * is recorded as such. Injectable so a test can exercise a platform it is not
 * running on.
 */
export type PlatformObserver = () => NodeJS.Platform;

export const systemPlatformObserver: PlatformObserver = () => process.platform;

export function operatingSystemFrom(
  platform: NodeJS.Platform,
): Hardware["operating_system"] {
  switch (platform) {
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "other";
  }
}

export interface LlmfitRequest {
  readonly evidenceId: string;
  /** Id to give the detected-machine subject. Separate from the target's id. */
  readonly detectedHardwareId: string;
  /** The machine the user declared they will run on. */
  readonly declaredTarget: Hardware;
  readonly modelIdentity: {
    /** The model name as llmfit knows it. */
    readonly name: string;
    readonly quantization: string | null;
  };
  readonly candidateRef: string;
  readonly workloadRef: string | null;
  readonly constraintRefs: readonly string[];
  readonly executable?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
}

/**
 * What a successful collection yields.
 *
 * The detected machine is returned as its OWN hardware subject rather than
 * being folded into the declared target. Decision 06 keeps the two separate,
 * and the caller has to add this entry to the contract before the evidence
 * that references it can be attached — which is exactly the honesty the
 * separation is for.
 */
export interface LlmfitObservation {
  readonly detected_hardware: Hardware;
  readonly evidence: BuiltEvidence;
}

export const LLMFIT_IDENTITY: AdapterIdentity = {
  id: "llmfit",
  kind: "hardware_fit",
  version: null,
  execution: "local",
  protocol_version: ADAPTER_PROTOCOL_VERSION,
};

function hashOf(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value), "utf8")
    .digest("hex");
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Canonical form of a model identifier.
 *
 * Case and separators are normalised and a leading publisher namespace is
 * dropped: `Qwen/Qwen2.5-Coder-7B-Instruct` and `qwen2.5-coder-7b-instruct`
 * name the same model. Nothing longer or shorter does.
 */
export function canonicalModelName(value: string): string {
  const withoutNamespace = value.includes("/")
    ? (value.split("/").pop() ?? value)
    : value;
  return normalise(withoutNamespace);
}

/**
 * Turn the CLI's system block into a detected-machine hardware subject.
 *
 * Returns a reason instead of a machine when the report contradicts itself.
 * `gpu_count` and the per-entry counts in `gpus[]` describe the same fact; if
 * they disagree the adapter cannot say what was inspected, and guessing would
 * attribute a fit estimate to a machine that may not exist.
 *
 * The operating system comes from the injected observer, not from llmfit,
 * which reports none.
 */
export function detectedHardwareFrom(
  id: string,
  system: z.infer<typeof LlmfitSystemBlockSchema>,
  platform: NodeJS.Platform,
): { readonly hardware: Hardware } | { readonly problem: string } {
  const gpus = system.gpus;
  const gpuName = system.gpu_name;
  const gpuVram = system.gpu_vram_gb;
  const hasGpu = system.has_gpu && gpuName !== null && gpuVram !== null;

  let accelerators: Hardware["accelerators"] = [];

  if (hasGpu) {
    if (gpus.length > 0) {
      for (const entry of gpus) {
        if (entry.vram_gb === null) {
          return {
            problem: `the system report lists GPU "${entry.name}" without a VRAM figure, so its capacity cannot be compared`,
          };
        }
      }
      accelerators = gpus.map((entry) => ({
        vendor: entry.name.split(/\s+/)[0] ?? "unknown",
        model: entry.name,
        vram_gb: entry.vram_gb ?? 0,
        count: entry.count,
      }));
      const summed = accelerators.reduce((sum, entry) => sum + entry.count, 0);
      if (summed !== system.gpu_count) {
        return {
          problem: `the system report is self-contradictory: gpu_count is ${system.gpu_count} but the per-GPU counts sum to ${summed}`,
        };
      }
    } else {
      if (system.gpu_count < 1) {
        return {
          problem: `the system report claims a GPU is present but gpu_count is ${system.gpu_count}`,
        };
      }
      accelerators = [
        {
          vendor: (gpuName ?? "").split(/\s+/)[0] ?? "unknown",
          model: gpuName ?? "unknown",
          vram_gb: gpuVram ?? 0,
          count: system.gpu_count,
        },
      ];
    }
  } else if (system.gpu_count > 0 || gpus.length > 0) {
    return {
      problem: `the system report says no GPU is present but lists ${Math.max(system.gpu_count, gpus.length)}`,
    };
  }

  return {
    hardware: {
      id,
      // A deterministic observation of the machine the tool inspected.
      evidence_kind: "deterministic_observation",
      cpu: { cores: system.cpu_cores, model: system.cpu_name },
      ram_gb: system.total_ram_gb,
      accelerators,
      backend: system.backend,
      operating_system: operatingSystemFrom(platform),
      evidence_refs: [],
    },
  };
}

/**
 * Optional hardware-fit adapter.
 *
 * Runs one documented command, `llmfit --json info <model>`, which returns the
 * inspected system and the model fit in a single envelope. Produces a
 * `tool_observation`, which is T2 — the ceiling by design. A compatibility
 * estimate can inform selection, but the contract's admissibility rules will
 * not let it clear a T3 hardware performance gate or a workload quality gate.
 */
export function createLlmfitAdapter(
  options: {
    readonly clock?: Clock;
    readonly executable?: string;
    readonly versionArgs?: readonly string[];
    readonly probeTimeoutMs?: number;
    /** Overrides the documented sub-command, for testing. */
    readonly infoArgs?: (model: string) => readonly string[];
    /** How the adapter learns its own platform. */
    readonly platform?: PlatformObserver;
  } = {},
): EvidenceAdapter<LlmfitRequest, LlmfitObservation> {
  const clock = options.clock ?? systemClock;
  const toolPath = options.executable ?? "llmfit";
  const versionArgs = options.versionArgs ?? ["--version"];
  const probeTimeoutMs = options.probeTimeoutMs ?? 5000;
  const infoArgs =
    options.infoArgs ?? ((model: string) => ["--json", "info", model]);
  const platform = options.platform ?? systemPlatformObserver;

  const probe = async (probeOptions?: {
    readonly signal?: AbortSignal;
    readonly executable?: string;
  }): Promise<AdapterOutcome<AdapterProbe>> => {
    const startedAt = clock();
    const outcome = await runSubprocess(
      {
        executable: probeOptions?.executable ?? toolPath,
        args: [...versionArgs],
        timeoutMs: probeTimeoutMs,
        maxOutputBytes: 8 * 1024,
        ...(probeOptions?.signal === undefined
          ? {}
          : { signal: probeOptions.signal }),
      },
      { identity: LLMFIT_IDENTITY, clock },
    );
    if (!isAvailable(outcome)) {
      return outcome as AdapterOutcome<AdapterProbe>;
    }
    const version = outcome.value.stdout.trim();
    const meta = {
      adapter: {
        ...LLMFIT_IDENTITY,
        version: version.length > 0 ? version : null,
      },
      started_at: startedAt,
      completed_at: clock(),
      provenance: {
        command_manifest: outcome.value.manifest,
        locator: null,
        raw_result_hash: outcome.value.raw_result_hash,
      },
      diagnostics: outcome.diagnostics,
    };
    if (version.length === 0) {
      return notAvailable(
        "unsupported",
        [
          adapterError(
            "version_unavailable",
            "the tool did not report a version; results from an unidentified build cannot be attributed",
          ),
        ],
        meta,
      );
    }
    return available({ version, capabilities: ["hardware_fit"] }, meta);
  };

  return {
    identity: LLMFIT_IDENTITY,
    probe,

    async collect(request, collectOptions) {
      const startedAt = clock();
      const executable = request.executable ?? toolPath;
      const signalPart =
        collectOptions?.signal === undefined
          ? {}
          : { signal: collectOptions.signal };
      const basePart =
        request.baseEnv === undefined ? {} : { baseEnv: request.baseEnv };

      const probed = await probe({ ...signalPart, executable });
      if (!isAvailable(probed)) {
        return probed as AdapterOutcome<LlmfitObservation>;
      }
      const version = probed.value.version;
      const identity: AdapterIdentity = { ...LLMFIT_IDENTITY, version };

      const run = await runSubprocess(
        {
          executable,
          args: [...infoArgs(request.modelIdentity.name)],
          timeoutMs: request.timeoutMs ?? 60_000,
          maxOutputBytes: request.maxOutputBytes ?? 512 * 1024,
          ...basePart,
          ...signalPart,
        },
        { identity, clock },
      );
      if (!isAvailable(run)) {
        return run as AdapterOutcome<LlmfitObservation>;
      }

      const meta = () => ({
        adapter: identity,
        started_at: startedAt,
        completed_at: clock(),
        provenance: {
          command_manifest: run.value.manifest,
          locator: null,
          raw_result_hash: run.value.raw_result_hash,
        },
        diagnostics: run.diagnostics,
      });

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(run.value.stdout) as unknown;
      } catch {
        return notAvailable(
          "failed",
          [
            adapterError(
              "malformed_output",
              "the tool did not produce JSON; its output cannot be trusted as evidence",
            ),
          ],
          meta(),
        );
      }

      const parsed = LlmfitInfoSchema.safeParse(parsedJson);
      if (!parsed.success) {
        return notAvailable(
          "failed",
          [
            adapterError(
              "malformed_output",
              "the tool's output did not match the llmfit --json info envelope",
              { issues: parsed.error.issues.length },
            ),
          ],
          meta(),
        );
      }

      const detection = detectedHardwareFrom(
        request.detectedHardwareId,
        parsed.data.system,
        platform(),
      );
      if ("problem" in detection) {
        return notAvailable(
          "failed",
          [adapterError("malformed_output", detection.problem)],
          meta(),
        );
      }
      const detected = detection.hardware;

      // Capability comparison, never id comparison: the declared target and
      // the detected machine are separate subjects with different ids.
      const comparison = hardwareCapabilitiesMatch(
        request.declaredTarget,
        detected,
      );
      if (!comparison.matches) {
        return notAvailable(
          "unknown",
          [
            adapterError("identity_mismatch", comparison.reason, {
              declared_hardware_ref: request.declaredTarget.id,
              detected_hardware_ref: detected.id,
            }),
          ],
          meta(),
        );
      }

      // Verify what the tool ACTUALLY returned describes what was asked about.
      const requestedName = canonicalModelName(request.modelIdentity.name);
      const entry = parsed.data.models.find(
        (item) => canonicalModelName(item.name) === requestedName,
      );
      if (entry === undefined) {
        const described = parsed.data.models
          .map((item) => `"${item.name}"`)
          .join(", ");
        return notAvailable(
          "unknown",
          [
            adapterError(
              "identity_mismatch",
              `the tool returned no entry for model "${request.modelIdentity.name}"; it described ${described.length > 0 ? described : "nothing"}`,
              { requested_model: request.modelIdentity.name },
            ),
          ],
          meta(),
        );
      }

      const requestedQuant = request.modelIdentity.quantization;
      if (
        requestedQuant !== null &&
        (entry.best_quant === null ||
          normalise(entry.best_quant) !== normalise(requestedQuant))
      ) {
        return notAvailable(
          "unknown",
          [
            adapterError(
              "identity_mismatch",
              `the tool reported quantization "${entry.best_quant ?? "none"}" but "${requestedQuant}" was requested`,
              {
                requested_quantization: requestedQuant,
                reported_quantization: entry.best_quant,
              },
            ),
          ],
          meta(),
        );
      }

      const built = buildEvidenceRecord({
        id: request.evidenceId,
        kind: "tool_observation",
        subject: `${request.candidateRef}.hardware_fit`,
        claim: `estimated fit of ${entry.name} on declared target ${request.declaredTarget.id}`,
        producer: { name: "llmfit", version },
        observed_at: startedAt,
        source: { type: "local_command", locator: "redacted-command-manifest" },
        command_manifest: run.value.manifest,
        applies_to: {
          candidate_ref: request.candidateRef,
          workload_ref: request.workloadRef,
          hardware_ref: request.declaredTarget.id,
          constraint_refs: [...request.constraintRefs],
        },
        value: {
          estimate_basis: {
            tool_version: version,
            backend: detected.backend,
            reported_model: entry.name,
            reported_quantization: entry.best_quant,
            // The OS is ANVILMARK's own observation, not an llmfit field.
            operating_system_source: "anvilmark_platform_observation",
            raw_result_hash: run.value.raw_result_hash,
            request_identity: hashOf(request.modelIdentity),
          },
          // Two separate subjects, honestly named.
          target_hardware_ref: request.declaredTarget.id,
          detected_hardware_ref: detected.id,
          findings: {
            fit_level: entry.fit_level,
            memory_required_gb: entry.memory_required_gb,
            estimated_tps: entry.estimated_tps ?? null,
            measured_tps: entry.measured_tps ?? null,
            ...(entry.score === undefined ? {} : { score: entry.score }),
            ...(entry.utilization_pct === undefined
              ? {}
              : { utilization_pct: entry.utilization_pct }),
          },
        },
        units: {
          memory_required_gb: "GB",
          estimated_tps: "tokens/second",
          measured_tps: "tokens/second",
        },
        assumptions: [
          "the estimate assumes the declared target is otherwise idle",
          "throughput is modelled by the tool, not measured on the target",
          "the operating system is observed by ANVILMARK; llmfit reports none",
        ],
        exclusions: ["does not account for concurrent workloads"],
        raw_result_hash: run.value.raw_result_hash,
        confidence: "medium",
        caveats: [
          "this is a compatibility estimate, not a benchmark on the target",
          "an estimated throughput cannot satisfy a hard performance or quality gate",
        ],
        refresh: { policy: "on_hardware_or_model_change", expires_at: null },
        standing: "available",
      });

      if (!built.ok) {
        return notAvailable("failed", built.errors, meta());
      }

      return available(
        { detected_hardware: detected, evidence: built.value },
        meta(),
      );
    },
  };
}
