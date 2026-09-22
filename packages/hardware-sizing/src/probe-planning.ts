import { createPlanningInput } from "./catalog.js";
import { ProbeSnapshotSchema } from "./probe.js";
import type { SizingInput } from "./schema.js";
import { SizingInputSchema } from "./schema.js";

export function planningInputFromProbe(
  value: unknown,
  selectedDeviceId: string | null = null,
  previous?: SizingInput,
): SizingInput {
  const snapshot = ProbeSnapshotSchema.parse(value);
  const input = structuredClone(previous ?? createPlanningInput());
  const device =
    selectedDeviceId === null
      ? null
      : snapshot.devices.find((d) => d.id === selectedDeviceId);
  if (selectedDeviceId !== null && !device)
    throw new Error("Selected device is not in this snapshot.");
  if (device && device.backend === "unknown")
    throw new Error(
      "This device's inference backend is unknown; choose an explicitly declared planning target.",
    );
  const memory =
    device?.memory_kind === "dedicated"
      ? device.installed_memory
      : snapshot.physical_memory;
  if (!memory)
    throw new Error("No observed capacity exists for the selected pool.");
  const kind =
    device?.memory_kind === "shared"
      ? "unified_memory"
      : device
        ? "discrete_gpu"
        : "cpu";
  if (kind === "unified_memory" && device?.backend !== "metal")
    throw new Error("The shared pool lacks a supported Metal profile.");
  input.hardware = {
    label: device?.model ?? "Imported CPU memory",
    kind,
    backend: (device?.backend ?? "cpu") as "cuda" | "rocm" | "metal" | "cpu",
    evidence_kind: "user_declared",
    capacity_bytes: memory.bytes,
    allocation_limit_bytes: null,
    reserve_bytes: 0,
    device_count: 1,
  };
  input.placement =
    kind === "unified_memory"
      ? "unified_pool"
      : kind === "cpu"
        ? "cpu_only"
        : "single_device";
  input.extensions = {
    format: "anvilmark-sizing-extensions/1",
    observation: {
      snapshot,
      selected_device_id: selectedDeviceId,
      trust: "unverified_import",
    },
  };
  return SizingInputSchema.parse(input);
}
