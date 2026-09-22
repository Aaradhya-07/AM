import { createHash } from "node:crypto";
import { EvidenceRecordSchema } from "@anvilmark/project-contract";
import type { Hardware, EvidenceRecord } from "@anvilmark/project-contract";
import { canonicalSizingJson } from "@anvilmark/hardware-sizing";
import type { ProbeSnapshot } from "@anvilmark/hardware-sizing";

export const digestHardwareValue = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonicalSizingJson(value)).digest("hex")}`;
export type CapacityUnit = "gib" | "gb";
export { hardwareFromProbe as snapshotHardware } from "@anvilmark/project-contract";
export function snapshotEvidence(
  snapshot: ProbeSnapshot,
  hardware: Hardware,
  unit: CapacityUnit,
  id: string,
): EvidenceRecord {
  return EvidenceRecordSchema.parse({
    id,
    subject: `hardware.${hardware.id}.inventory`,
    kind: "deterministic_observation",
    producer: {
      name: "anvilmark.hardware-probe",
      version: snapshot.detector_version,
    },
    observed_at: snapshot.observed_at,
    source: {
      type: "local_command",
      locator:
        snapshot.scope === "remote"
          ? "fixed authenticated SSH collector"
          : "fixed local inventory collectors",
    },
    confidence: "high",
    caveats: [
      "Installed inventory is distinct from usable allocation; availability expires independently.",
      "This record was collected by the CLI. Imported JSON does not authenticate a probe.",
    ],
    refresh: { policy: "on_hardware_or_model_change", expires_at: null },
    applies_to: {
      candidate_ref: null,
      workload_ref: null,
      hardware_ref: hardware.id,
      constraint_refs: [],
    },
    value: {
      format: "anvilmark-hardware-observation/1",
      snapshot,
      contract_capacity_unit: unit,
      hardware_digest: digestHardwareValue({ ...hardware, evidence_refs: [] }),
      snapshot_digest: digestHardwareValue(snapshot),
    },
  });
}
