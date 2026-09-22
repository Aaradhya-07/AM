"use client";

import { HardwareEvidenceInputs } from "./HardwareEvidenceInputs";
import { useMemo, useRef, useState } from "react";
import {
  SizingInputSchema,
  createPlanningInput,
  createSizingArtifact,
  estimateModelFit,
  listModelProfiles,
} from "@anvilmark/hardware-sizing";
import type { SizingInput } from "@anvilmark/hardware-sizing";

const GiB = 2 ** 30;
const models = listModelProfiles();
const fieldClass =
  "mt-2 w-full rounded-sm border border-line-muted bg-ink px-3 py-2.5 text-sm text-canvas focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:cursor-not-allowed disabled:opacity-40";
const labelClass = "block text-xs font-medium text-sand/80";

function size(value: number | null): string {
  return value === null
    ? "Unknown"
    : `${(value / GiB).toLocaleString("en-US", { maximumFractionDigits: 2 })} GiB`;
}

async function hashText(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function HardwareSizingCockpit() {
  const [input, setInput] = useState<SizingInput>(() => createPlanningInput());
  const [actionMessage, setActionMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportJson, setExportJson] = useState("");
  const current = useRef(input);
  current.current = input;
  const parsed = useMemo(() => SizingInputSchema.safeParse(input), [input]);
  const result = useMemo(
    () => (parsed.success ? estimateModelFit(parsed.data) : null),
    [parsed],
  );
  const memory = result?.memory;
  const multiDevice = Boolean(input.extensions?.devices);
  const selectedModel = models.find((model) => model.id === input.model.id);

  function edit(change: (draft: SizingInput) => void) {
    setInput((previous) => {
      const draft = structuredClone(previous);
      change(draft);
      return draft;
    });
    setActionMessage("");
    setExportJson("");
  }

  function changeTarget(kind: SizingInput["hardware"]["kind"]) {
    edit((draft) => {
      draft.hardware.device_count = 1;
      if (draft.extensions) {
        delete draft.extensions.devices;
        delete draft.extensions.placement_profile;
      }
      draft.hardware.kind = kind;
      draft.hardware.backend =
        kind === "unified_memory" ? "metal" : kind === "cpu" ? "cpu" : "cuda";
      draft.hardware.label =
        kind === "unified_memory"
          ? "Declared unified memory"
          : kind === "cpu"
            ? "Declared CPU memory"
            : "Declared GPU memory";
      draft.placement =
        kind === "unified_memory"
          ? "unified_pool"
          : kind === "cpu"
            ? "cpu_only"
            : "single_device";
    });
  }

  async function exportScenario(copy: boolean) {
    if (!parsed.success || !result || busy) return;
    const snapshot = input;
    setBusy(true);
    setActionMessage("");
    try {
      const artifact = await createSizingArtifact(parsed.data, {
        evaluatedAt: new Date().toISOString(),
        hashText,
      });
      if (current.current !== snapshot) {
        setActionMessage(
          "Inputs changed during export. Export the current scenario again.",
        );
        return;
      }
      if (copy) {
        const brief = [
          "ANVILMARK hardware sizing proposal",
          "",
          `Model: ${artifact.input.model.id} at ${artifact.input.model.revision}`,
          `Context: ${artifact.input.workload.retained_tokens_per_sequence} retained tokens per sequence; concurrency: ${artifact.input.workload.concurrent_sequences}.`,
          `Memory: ${artifact.result.memory.assessment}; estimated total ${size(artifact.result.memory.required_bytes)}; usable budget ${size(artifact.result.memory.usable_budget_bytes)}.`,
          ...(artifact.result.devices ?? []).map(
            (device) =>
              `${device.id}: ${device.layers} layers; ${device.assessment}; required ${size(device.required_bytes)}; budget ${size(device.usable_budget_bytes)}; headroom ${size(device.headroom_bytes)}.`,
          ),
          "This is a standalone planning scenario. Runtime compatibility and performance are unverified; no contract evidence is attached.",
          ...artifact.result.issues.map((issue) => `Gap: ${issue.message}`),
          ...artifact.result.assumptions.map(
            (assumption) => `Assumption: ${assumption}`,
          ),
          `Input digest: ${artifact.input_digest}`,
          "",
          "Recompute the exported JSON with: anvilmark hardware estimate --file hardware-sizing.json --json",
        ].join("\n");
        await navigator.clipboard.writeText(brief);
        setActionMessage(
          current.current === snapshot
            ? "Sizing brief copied."
            : "The copied brief describes the earlier inputs. Copy again for the current scenario.",
        );
      } else {
        const json = `${JSON.stringify(artifact, null, 2)}\n`;
        setExportJson(json);
        const url = URL.createObjectURL(
          new Blob([json], { type: "application/json" }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "hardware-sizing.json";
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setActionMessage(
          "Download requested. The proposal JSON is also available below for local recomputation.",
        );
      }
    } catch {
      setActionMessage(
        copy
          ? "Could not copy the brief. Try exporting the sizing proposal instead."
          : "Could not export this proposal. Try again in a secure browser context.",
      );
    } finally {
      setBusy(false);
    }
  }

  const components = memory
    ? [
        {
          label: "Weights",
          bytes: memory.weights_bytes ?? memory.weights_lower_bound_bytes,
          color: "bg-gold",
          detail:
            memory.weights_bytes === null &&
            memory.weights_lower_bound_bytes !== null
              ? "payload lower bound"
              : "",
        },
        {
          label: "KV cache",
          bytes: memory.kv_cache_bytes,
          color: "bg-[#799baf]",
          detail: "independent sequences",
        },
        {
          label: "Runtime overhead",
          bytes: memory.runtime_overhead_bytes,
          color: "bg-[#81937a]",
          detail: "user allowance",
        },
        {
          label: "Allocator allowance",
          bytes: memory.allocator_allowance_bytes,
          color: "bg-[#ad8a73]",
          detail: "user allowance",
        },
      ]
    : [];
  const knownTotal = components.reduce(
    (sum, component) => sum + (component.bytes ?? 0),
    0,
  );
  const barScale = Math.max(
    multiDevice ? 0 : input.hardware.capacity_bytes,
    knownTotal,
    1,
  );
  const assessmentText =
    memory?.assessment === "estimated_within_budget"
      ? "Estimated within your budget"
      : memory?.assessment === "estimated_over_budget"
        ? "Estimated over your budget"
        : "More information needed";

  return (
    <section
      id="hardware-sizing"
      aria-labelledby="hardware-sizing-title"
      className="mx-auto max-w-[108rem] px-5 py-10 sm:px-8"
    >
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-brand text-gold">
            Hardware sizing · planning workspace
          </p>
          <h2
            id="hardware-sizing-title"
            className="mt-3 font-brand text-3xl font-light text-canvas"
          >
            Size the deployment before you build.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-sand/75">
            Explore weights, context, and concurrency against a declared memory
            budget. Every missing input stays visible in the result and the
            agent handoff.
          </p>
        </div>
        <span className="border border-line-muted px-3 py-1.5 font-mono text-[11px] text-sand/70">
          Declared inputs · explicit inventory import
        </span>
      </div>
      <HardwareEvidenceInputs
        input={input}
        onChange={(next) => {
          setInput(next);
          setActionMessage("");
          setExportJson("");
        }}
      />
      <div className="grid gap-px overflow-hidden rounded-sm border border-line-muted bg-line-muted lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="bg-surface p-5 sm:p-7">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className={`${labelClass} sm:col-span-2`}>
              Model artifact
              <select
                aria-label="Model artifact"
                className={fieldClass}
                value={input.model.id}
                onChange={(event) =>
                  edit((draft) => {
                    const model = models.find(
                      (entry) => entry.id === event.target.value,
                    );
                    if (model)
                      draft.model = { id: model.id, revision: model.revision };
                  })
                }
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block font-mono text-[10px] text-sand/50">
                Pinned revision {input.model.revision.slice(0, 12)} ·{" "}
                {selectedModel?.architecture === "moe_gqa"
                  ? "All experts stay resident"
                  : "Dense GQA"}
              </span>
            </label>
            <label className={labelClass}>
              Weight storage
              <select
                aria-label="Weight storage"
                className={fieldClass}
                value={input.weights.format}
                onChange={(event) =>
                  edit((draft) => {
                    draft.weights = {
                      format: event.target.value,
                      metadata_bytes: null,
                    };
                  })
                }
              >
                <option value="bf16">BF16 · 16 bit</option>
                <option value="fp16">FP16 · 16 bit</option>
                <option value="fp32">FP32 · 32 bit</option>
                <option value="nominal_int8">
                  Nominal 8 bit · hypothetical
                </option>
                <option value="nominal_int4">
                  Nominal 4 bit · hypothetical
                </option>
              </select>
            </label>
            <label className={labelClass}>
              KV cache precision
              <select
                aria-label="KV cache precision"
                className={fieldClass}
                value={input.kv_cache.key_format}
                onChange={(event) =>
                  edit((draft) => {
                    draft.kv_cache = {
                      key_format: event.target.value,
                      value_format: event.target.value,
                    };
                  })
                }
              >
                <option value="fp16">FP16 · 2 bytes per element</option>
                <option value="bf16">BF16 · 2 bytes per element</option>
                <option value="fp32">FP32 · 4 bytes per element</option>
              </select>
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Retained context per sequence
              <div className="mt-2 flex items-center gap-4">
                <input
                  aria-label="Context slider"
                  type="range"
                  min="1"
                  max="32768"
                  step="1"
                  value={input.workload.retained_tokens_per_sequence}
                  className="min-w-0 flex-1 accent-gold"
                  onChange={(event) =>
                    edit((draft) => {
                      draft.workload.retained_tokens_per_sequence = Number(
                        event.target.value,
                      );
                    })
                  }
                />
                <input
                  aria-label="Retained context tokens"
                  type="number"
                  min="1"
                  max="32768"
                  step="1"
                  className={fieldClass.replace(
                    "mt-2 w-full",
                    "mt-0 w-28 shrink-0",
                  )}
                  value={input.workload.retained_tokens_per_sequence}
                  onChange={(event) =>
                    edit((draft) => {
                      draft.workload.retained_tokens_per_sequence = Number(
                        event.target.value,
                      );
                    })
                  }
                />
              </div>
              <span className="mt-1.5 block text-[11px] font-normal text-sand/50">
                Prompt plus generated tokens. No automatic context extension.
              </span>
            </label>
            <label className={labelClass}>
              Concurrent sequences
              <input
                aria-label="Concurrent sequences"
                type="number"
                min="1"
                max="1024"
                step="1"
                className={fieldClass}
                value={input.workload.concurrent_sequences}
                onChange={(event) =>
                  edit((draft) => {
                    draft.workload.concurrent_sequences = Number(
                      event.target.value,
                    );
                  })
                }
              />
            </label>
            <label className={labelClass}>
              Memory pool
              <select
                aria-label="Memory pool"
                className={fieldClass}
                value={input.hardware.kind}
                onChange={(event) =>
                  changeTarget(
                    event.target.value as SizingInput["hardware"]["kind"],
                  )
                }
              >
                <option value="discrete_gpu">
                  {multiDevice
                    ? "Discrete GPUs · layer placement"
                    : "One discrete GPU"}
                </option>
                <option value="unified_memory">Apple unified memory</option>
                <option value="cpu">CPU memory</option>
              </select>
            </label>
            <label className={labelClass}>
              Installed capacity{multiDevice ? " per device" : ""} · GiB
              <input
                aria-label="Installed capacity GiB"
                type="number"
                min="1"
                max="4096"
                className={fieldClass}
                value={input.hardware.capacity_bytes / GiB}
                onChange={(event) =>
                  edit((draft) => {
                    draft.hardware.capacity_bytes = Math.round(
                      Number(event.target.value) * GiB,
                    );
                    for (const device of draft.extensions?.devices ?? []) {
                      device.capacity_bytes = draft.hardware.capacity_bytes;
                    }
                  })
                }
              />
            </label>
            <label className={labelClass}>
              Allocation limit · GiB
              <input
                aria-label="Allocation limit GiB"
                disabled={multiDevice}
                type="number"
                min="0"
                step="0.25"
                placeholder="Unknown"
                className={fieldClass}
                value={
                  input.hardware.allocation_limit_bytes === null
                    ? ""
                    : input.hardware.allocation_limit_bytes / GiB
                }
                onChange={(event) =>
                  edit((draft) => {
                    draft.hardware.allocation_limit_bytes =
                      event.target.value === ""
                        ? null
                        : Math.round(Number(event.target.value) * GiB);
                  })
                }
              />
            </label>
            <label className={labelClass}>
              Reserved memory · GiB
              <input
                aria-label="Reserved memory GiB"
                disabled={multiDevice}
                type="number"
                min="0"
                step="0.25"
                className={fieldClass}
                value={input.hardware.reserve_bytes / GiB}
                onChange={(event) =>
                  edit((draft) => {
                    draft.hardware.reserve_bytes = Math.round(
                      Number(event.target.value) * GiB,
                    );
                  })
                }
              />
            </label>
            <div className="self-end pb-2 text-[11px] leading-5 text-sand/55">
              {multiDevice
                ? "Per-device budgets above control this estimate. Shared budget fields are inactive."
                : "Usable budget = allocation limit minus reserve. Unified memory is counted once."}
            </div>
            <label className={labelClass}>
              Runtime overhead allowance · GiB
              <input
                aria-label="Runtime overhead GiB"
                disabled={multiDevice}
                type="number"
                min="0"
                step="0.25"
                placeholder="Unknown"
                className={fieldClass}
                value={
                  input.runtime.overhead_bytes === null
                    ? ""
                    : input.runtime.overhead_bytes / GiB
                }
                onChange={(event) =>
                  edit((draft) => {
                    draft.runtime.overhead_bytes =
                      event.target.value === ""
                        ? null
                        : Math.round(Number(event.target.value) * GiB);
                  })
                }
              />
            </label>
            <label className={labelClass}>
              Allocator allowance · GiB
              <input
                aria-label="Allocator allowance GiB"
                disabled={multiDevice}
                type="number"
                min="0"
                step="0.25"
                placeholder="Unknown"
                className={fieldClass}
                value={
                  input.runtime.allocator_allowance_bytes === null
                    ? ""
                    : input.runtime.allocator_allowance_bytes / GiB
                }
                onChange={(event) =>
                  edit((draft) => {
                    draft.runtime.allocator_allowance_bytes =
                      event.target.value === ""
                        ? null
                        : Math.round(Number(event.target.value) * GiB);
                  })
                }
              />
            </label>
            {input.weights.format.startsWith("nominal_") ? (
              <label className={`${labelClass} sm:col-span-2`}>
                Quantization metadata / mixed-precision allowance · GiB
                <input
                  aria-label="Quantization allowance GiB"
                  type="number"
                  min="0"
                  step="0.125"
                  placeholder="Unknown"
                  className={fieldClass}
                  value={
                    input.weights.metadata_bytes === null
                      ? ""
                      : input.weights.metadata_bytes / GiB
                  }
                  onChange={(event) =>
                    edit((draft) => {
                      draft.weights.metadata_bytes =
                        event.target.value === ""
                          ? null
                          : Math.round(Number(event.target.value) * GiB);
                    })
                  }
                />
                <span className="mt-1.5 block text-[11px] font-normal text-sand/50">
                  Hypothetical storage. This does not identify a GGUF, AWQ, or
                  GPTQ artifact.
                </span>
              </label>
            ) : null}
          </div>
          <p className="mt-5 text-[11px] leading-5 text-sand/50">
            Overhead and allocator allowances are your assumptions for peak
            loading, prefill, and decode memory. Empty fields stay unknown.
          </p>
        </div>
        <div className="flex flex-col bg-ink p-5 sm:p-7">
          <p className="text-[11px] uppercase tracking-brand text-sand/50">
            Memory estimate
          </p>
          <h3
            aria-live="polite"
            className="mt-3 text-xl font-medium text-canvas"
          >
            {parsed.success ? assessmentText : "Check the inputs"}
          </h3>
          {!parsed.success ? (
            <ul role="alert" className="mt-4 space-y-2 text-sm text-[#dfaa86]">
              {parsed.error.issues.map((issue, index) => (
                <li key={index}>
                  {issue.path.join(".")}: {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <>
              <div
                className="mt-7 flex h-6 w-full overflow-hidden rounded-sm bg-sand/10"
                role="img"
                aria-label={
                  multiDevice
                    ? `Total known components across ${input.hardware.device_count} devices: ${size(knownTotal)}. Check individual budgets below.`
                    : `Known memory components: ${size(knownTotal)}. Declared capacity: ${size(input.hardware.capacity_bytes)}.`
                }
              >
                {components.map((component) => (
                  <div
                    key={component.label}
                    className={`${component.color} transition-[width] duration-150`}
                    style={{
                      width: `${((component.bytes ?? 0) / barScale) * 100}%`,
                    }}
                  />
                ))}
              </div>
              <p className="mt-2 text-[10px] text-sand/45">
                {multiDevice
                  ? "Total component composition across devices; check individual budgets below."
                  : "Known components; blank space is not verified headroom."}
              </p>
              <dl className="mt-5 divide-y divide-line-muted">
                {components.map((component) => (
                  <div
                    key={component.label}
                    className="flex items-center justify-between gap-3 py-3 text-sm"
                  >
                    <dt className="text-sand/70">
                      <span
                        className={`mr-2 inline-block h-2 w-2 ${component.color}`}
                      />
                      {component.label}
                      {component.detail ? (
                        <span className="ml-2 text-[10px] text-sand/40">
                          {component.detail}
                        </span>
                      ) : null}
                    </dt>
                    <dd className="whitespace-nowrap font-mono text-xs text-canvas">
                      {size(component.bytes)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 grid grid-cols-2 gap-5 border-t border-line-muted pt-5">
                <div>
                  <p className="text-xs text-sand/50">Estimated total</p>
                  <p
                    data-testid="sizing-total"
                    className="mt-2 font-mono text-xl text-canvas"
                  >
                    {size(memory?.required_bytes ?? null)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-sand/50">Estimated headroom</p>
                  <p
                    data-testid="sizing-headroom"
                    className="mt-2 font-mono text-xl text-canvas"
                  >
                    {size(memory?.headroom_bytes ?? null)}
                  </p>
                </div>
              </div>
              <div className="mt-6 border border-line-muted bg-surface/50 p-4 text-xs leading-6 text-sand/70">
                <p className="font-medium text-goldsoft">
                  {result?.performance.status === "advisory_calibrated"
                    ? `Advisory decode median: ${result.performance.estimated_decode_tokens_per_second?.toFixed(2)} tokens/s`
                    : "Performance unverified"}
                </p>
                <p>{result?.performance.reason}</p>
                <p>
                  Decode speed and latency need a calibrated profile or target
                  measurements. Runtime compatibility is unknown. This scenario
                  has no attached contract evidence.
                </p>
              </div>
              {result?.devices ? (
                <div className="mt-5 space-y-3">
                  <p className="text-xs text-goldsoft">
                    Per-device memory — no pooled headroom
                  </p>
                  {result.devices.map((device) => (
                    <div
                      key={device.id}
                      className="border border-line-muted p-3 text-xs leading-6 text-sand/75"
                    >
                      <p>
                        {device.id} · {device.layers} layers ·{" "}
                        {device.assessment.replaceAll("_", " ")}
                      </p>
                      <p>
                        Weights {size(device.weights_bytes)} · KV{" "}
                        {size(device.kv_cache_bytes)} · total{" "}
                        {size(device.required_bytes)} · budget{" "}
                        {size(device.usable_budget_bytes)} · headroom{" "}
                        {size(device.headroom_bytes)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
              {result && result.issues.length > 0 ? (
                <div className="mt-5">
                  <p className="text-xs font-medium text-sand/80">
                    Evidence and input gaps
                  </p>
                  <ul className="mt-2 space-y-2 text-xs leading-5 text-sand/60">
                    {result.issues.map((issue) => (
                      <li key={issue.code}>• {issue.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
          <div className="mt-auto pt-7">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={!parsed.success || busy}
                onClick={() => void exportScenario(false)}
                className="rounded-sm bg-gold px-4 py-2.5 text-xs font-semibold text-ink transition hover:bg-goldsoft disabled:opacity-40"
              >
                {busy ? "Preparing…" : "Export sizing proposal"}
              </button>
              <button
                type="button"
                disabled={!parsed.success || busy}
                onClick={() => void exportScenario(true)}
                className="rounded-sm border border-line-muted px-4 py-2.5 text-xs font-medium text-sand transition hover:border-gold hover:text-gold disabled:opacity-40"
              >
                Copy sizing brief
              </button>
              <button
                type="button"
                onClick={() => {
                  setInput(createPlanningInput());
                  setActionMessage("");
                  setExportJson("");
                }}
                className="rounded-sm px-3 py-2.5 text-xs text-sand/60 transition hover:text-gold"
              >
                Reset scenario
              </button>
            </div>
            {exportJson ? (
              <details className="mt-4 text-xs text-sand/70">
                <summary className="cursor-pointer">
                  View sizing proposal JSON
                </summary>
                <textarea
                  aria-label="Sizing proposal JSON"
                  readOnly
                  value={exportJson}
                  rows={10}
                  className="mt-3 w-full resize-y rounded-sm border border-line-muted bg-surface p-3 font-mono text-[11px] text-sand"
                />
              </details>
            ) : null}
            <p className="mt-3 text-[11px] leading-5 text-sand/45">
              Standalone JSON proposal. Recompute with{" "}
              <code className="text-sand/70">
                anvilmark hardware estimate --file hardware-sizing.json --json
              </code>
              .
            </p>
            <p
              role="status"
              className="mt-2 min-h-5 text-xs leading-5 text-goldsoft"
            >
              {actionMessage}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
