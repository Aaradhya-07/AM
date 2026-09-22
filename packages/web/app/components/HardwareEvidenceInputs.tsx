"use client";
import { useRef, useState } from "react";
import {
  CalibrationSchema,
  MAX_ARTIFACT_BYTES,
  PROBE_FORMAT,
  ProbeSnapshotSchema,
  SIZING_FORMAT,
  SizingInputSchema,
  listModelProfiles,
  planningInputFromProbe,
  verifySizingArtifact,
} from "@anvilmark/hardware-sizing";
import type { SizingInput } from "@anvilmark/hardware-sizing";
const GiB = 2 ** 30;
const field =
  "mt-1 w-full rounded-sm border border-line-muted bg-ink px-3 py-2 text-sm text-canvas";
async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export function HardwareEvidenceInputs({
  input,
  onChange,
}: {
  input: SizingInput;
  onChange: (next: SizingInput) => void;
}) {
  const [message, setMessage] = useState("");
  const current = useRef(input);
  current.current = input;
  const snapshot = input.extensions?.observation?.snapshot;
  function edit(fn: (draft: SizingInput) => void) {
    const next = structuredClone(input);
    fn(next);
    onChange(next);
    setMessage("");
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    const base = input;
    try {
      if (file.size > MAX_ARTIFACT_BYTES)
        throw new Error("File exceeds 1 MiB.");
      const text = await file.text();
      if (new TextEncoder().encode(text).length > MAX_ARTIFACT_BYTES)
        throw new Error("File exceeds 1 MiB.");
      const raw = JSON.parse(text);
      let next: SizingInput;
      if (raw.format === PROBE_FORMAT) {
        const parsed = ProbeSnapshotSchema.parse(raw);
        const first = parsed.devices.find((d) => d.backend !== "unknown");
        next = planningInputFromProbe(parsed, first?.id ?? null, base);
      } else if (raw.format === SIZING_FORMAT) {
        const checked = await verifySizingArtifact(raw, hashText);
        if (!checked.ok)
          throw new Error("Artifact failed local recomputation.");
        next = checked.artifact.input;
      } else if (raw.format === "anvilmark-decode-calibration/1") {
        const calibration = CalibrationSchema.parse(raw);
        next = structuredClone(base);
        next.extensions = {
          ...next.extensions,
          format: "anvilmark-sizing-extensions/1",
          calibration,
          calibration_as_of: new Date().toISOString(),
        };
      } else next = SizingInputSchema.parse(raw);
      if (current.current !== base)
        throw new Error("Inputs changed during import. Choose the file again.");
      // A file cannot authenticate observed facts or authorize a project write.
      onChange(next);
      setMessage(
        "Imported for planning. Local contract attachment still requires a persisted CLI observation and a current bound proposal.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not import JSON.",
      );
    }
  }
  function changeCount(count: number) {
    edit((draft) => {
      draft.hardware.device_count = count;
      draft.extensions = {
        ...draft.extensions,
        format: "anvilmark-sizing-extensions/1",
      };
      if (count === 1) {
        delete draft.extensions.devices;
        delete draft.extensions.placement_profile;
        draft.placement =
          draft.hardware.kind === "unified_memory"
            ? "unified_pool"
            : draft.hardware.kind === "cpu"
              ? "cpu_only"
              : "single_device";
        return;
      }
      const layers =
        listModelProfiles()
          .find((m) => m.id === draft.model.id)
          ?.attention_groups.reduce((n, g) => n + g.layers, 0) ?? 0;
      draft.hardware.kind = "discrete_gpu";
      draft.hardware.backend = "cuda";
      draft.placement = "pipeline_parallel";
      draft.extensions.placement_profile = "contiguous-layer-residency/1";
      draft.extensions.devices = Array.from({ length: count }, (_, i) => ({
        id: `device-${i}`,
        model:
          snapshot?.devices[i]?.model ??
          draft.extensions?.hardware_sku ??
          "Declared homogeneous GPU",
        capacity_bytes: draft.hardware.capacity_bytes,
        allocation_limit_bytes: draft.hardware.allocation_limit_bytes,
        reserve_bytes: draft.hardware.reserve_bytes,
        layers: Math.floor(layers / count) + (i < layers % count ? 1 : 0),
        runtime_overhead_bytes: draft.runtime.overhead_bytes,
        allocator_allowance_bytes: draft.runtime.allocator_allowance_bytes,
      }));
    });
  }
  return (
    <div className="mb-6 space-y-5 rounded-sm border border-line-muted bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-sand/80">
          Import inventory, scenario, or calibration JSON
          <input
            aria-label="Import hardware JSON"
            className={field}
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <p className="self-center text-xs leading-6 text-sand/60">
          Collect inventory locally with{" "}
          <code>anvilmark hardware probe --json</code>. Imported files remain
          unverified here. Installed memory, available memory, and your
          allocation budget are separate values.
        </p>
      </div>
      {message ? (
        <p role="status" className="text-xs text-goldsoft">
          {message}
        </p>
      ) : null}
      {snapshot ? (
        <div className="space-y-2 text-xs leading-6 text-sand/75">
          <p>
            Inventory file: {snapshot.status} · {snapshot.platform} ·{" "}
            {snapshot.scope} · observed {snapshot.observed_at}. File
            authenticity unverified.
          </p>
          <label>
            Planning memory pool
            <select
              aria-label="Observed memory pool"
              className={field}
              value={input.extensions?.observation?.selected_device_id ?? "cpu"}
              onChange={(event) => {
                try {
                  onChange(
                    planningInputFromProbe(
                      snapshot,
                      event.target.value === "cpu" ? null : event.target.value,
                      input,
                    ),
                  );
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Unsupported pool.",
                  );
                }
              }}
            >
              <option value="cpu">
                System RAM ·{" "}
                {snapshot.physical_memory
                  ? `${(snapshot.physical_memory.bytes / GiB).toFixed(2)} GiB`
                  : "unknown"}
              </option>
              {snapshot.devices.map((device) => (
                <option
                  key={device.id}
                  value={device.id}
                  disabled={device.backend === "unknown"}
                >
                  {device.model} ·{" "}
                  {device.memory_kind === "shared"
                    ? "shared system RAM"
                    : device.installed_memory
                      ? `${(device.installed_memory.bytes / GiB).toFixed(2)} GiB installed`
                      : "capacity unknown"}
                </option>
              ))}
            </select>
          </label>
          <p>
            Availability expires at{" "}
            {snapshot.availability_expires_at ?? "unknown"}; it is not a
            reservation.{" "}
            {snapshot.devices
              .map(
                (d) =>
                  `${d.id}: ${d.available_memory ? `${(d.available_memory.bytes / GiB).toFixed(2)} GiB free at collection` : "free allocation unknown"}`,
              )
              .join("; ")}
          </p>
          <p>
            Edits below are T1 planning assumptions and never update the
            imported observation.
          </p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-sand/80">
          Runtime name
          <input
            aria-label="Runtime name"
            className={field}
            value={input.runtime.name ?? ""}
            placeholder="Unknown"
            onChange={(e) =>
              edit((d) => {
                d.runtime.name = e.target.value || null;
              })
            }
          />
        </label>
        <label className="text-xs text-sand/80">
          Runtime version
          <input
            aria-label="Runtime version"
            className={field}
            value={input.runtime.version ?? ""}
            placeholder="Unknown"
            onChange={(e) =>
              edit((d) => {
                d.runtime.version = e.target.value || null;
              })
            }
          />
        </label>
        <label className="text-xs text-sand/80">
          Declared hardware SKU
          <input
            aria-label="Hardware SKU"
            className={field}
            value={input.extensions?.hardware_sku ?? ""}
            placeholder="Exact calibration SKU"
            onChange={(e) =>
              edit((d) => {
                d.extensions = {
                  ...d.extensions,
                  format: "anvilmark-sizing-extensions/1",
                };
                if (e.target.value) d.extensions.hardware_sku = e.target.value;
                else delete d.extensions.hardware_sku;
              })
            }
          />
        </label>
        <label className="text-xs text-sand/80">
          Homogeneous devices
          <select
            aria-label="Homogeneous device count"
            className={field}
            value={input.hardware.device_count}
            onChange={(e) => changeCount(Number(e.target.value))}
          >
            {[1, 2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "One memory pool" : `${n} GPUs · contiguous layers`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {input.extensions?.calibration ? (
        <p className="text-xs leading-6 text-sand/65">
          Calibration {input.extensions.calibration.id}: exact model, runtime,
          device SKU, precision and context only; valid through{" "}
          {input.extensions.calibration.expires_at}. Supplied measurements are
          advisory and cannot settle a contract performance gate.
        </p>
      ) : null}
      {input.extensions?.devices ? (
        <div className="space-y-4">
          <p className="text-xs leading-6 text-sand/65">
            One host, homogeneous discrete GPUs, floating-point weights. Every
            device must fit independently. Layer assignments do not establish
            runtime or interconnect support.
          </p>
          {input.extensions.devices.map((device, index) => (
            <fieldset
              key={device.id}
              className="grid gap-3 border border-line-muted p-3 sm:grid-cols-3"
            >
              <legend className="px-2 text-xs text-goldsoft">
                {device.id} · {device.model}
              </legend>
              {(
                [
                  { key: "layers", label: "Layers", scale: 1 },
                  {
                    key: "allocation_limit_bytes",
                    label: "Allocation GiB",
                    scale: GiB,
                  },
                  { key: "reserve_bytes", label: "Reserve GiB", scale: GiB },
                  {
                    key: "runtime_overhead_bytes",
                    label: "Runtime overhead GiB",
                    scale: GiB,
                  },
                  {
                    key: "allocator_allowance_bytes",
                    label: "Allocator GiB",
                    scale: GiB,
                  },
                ] as const
              ).map(({ key, label, scale }) => (
                <label key={key} className="text-xs text-sand/70">
                  {label}
                  <input
                    className={field}
                    aria-label={`${device.id} ${label}`}
                    type="number"
                    min="0"
                    step={scale === 1 ? 1 : 0.25}
                    value={device[key] === null ? "" : device[key]! / scale}
                    onChange={(event) =>
                      edit((d) => {
                        const row = d.extensions!.devices![index]!;
                        const value =
                          event.target.value === ""
                            ? null
                            : Math.round(Number(event.target.value) * scale);
                        if (key === "layers" || key === "reserve_bytes")
                          row[key] = value ?? 0;
                        else row[key] = value;
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      ) : null}
    </div>
  );
}
