import { z } from "zod/v4";

const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(256);
export const PROBE_FORMAT = "anvilmark-hardware-probe/2" as const;
export const DETECTOR_VERSION = "0.2.0-draft.1" as const;
export const ObservedMemorySchema = z.strictObject({
  bytes,
  evidence_kind: z.literal("deterministic_observation"),
  source: z.enum([
    "node:os",
    "proc:meminfo",
    "cgroup:v2",
    "nvidia-smi",
    "sysfs:amdgpu",
    "system_profiler",
    "sysctl",
    "metal:recommended-working-set",
  ]),
});
export const ProbeDeviceSchema = z.strictObject({
  id: z.string().regex(/^device-[0-9]{1,4}$/),
  vendor: z.enum(["nvidia", "amd", "apple", "other"]),
  model: text,
  backend: z.enum(["cuda", "rocm", "metal", "unknown"]),
  memory_kind: z.enum(["dedicated", "shared", "unknown"]),
  installed_memory: ObservedMemorySchema.nullable(),
  available_memory: ObservedMemorySchema.nullable(),
  recommended_working_set: ObservedMemorySchema.nullable(),
});
export const ProbeSnapshotSchema = z
  .strictObject({
    format: z.literal(PROBE_FORMAT),
    id: z.string().regex(/^probe\.[a-zA-Z0-9_-]{1,120}$/),
    observed_at: z.iso.datetime({ offset: true }),
    detector_version: z.literal(DETECTOR_VERSION),
    platform: z.enum(["linux", "macos", "windows", "other"]),
    scope: z.enum(["host", "container", "process", "remote"]),
    status: z.enum([
      "complete",
      "partial",
      "unavailable",
      "unsupported",
      "failed",
    ]),
    cpu: z
      .strictObject({
        logical_cores: z.number().int().positive().max(1_048_576),
        model: text.nullable(),
      })
      .nullable(),
    physical_memory: ObservedMemorySchema.nullable(),
    available_memory: ObservedMemorySchema.nullable(),
    allocation_limit: ObservedMemorySchema.nullable(),
    availability_expires_at: z.iso.datetime({ offset: true }),
    gpu_inventory: z.enum([
      "complete",
      "partial",
      "unavailable",
      "unsupported",
    ]),
    visibility_limited: z.boolean(),
    devices: z.array(ProbeDeviceSchema).max(64),
    diagnostics: z
      .array(
        z.strictObject({ code: text, message: z.string().min(1).max(1024) }),
      )
      .max(128),
  })
  .superRefine((value, context) => {
    if (value.physical_memory?.bytes === 0)
      context.addIssue({
        code: "custom",
        path: ["physical_memory"],
        message: "Physical memory must be positive when observed",
      });
    if (
      value.status === "complete" &&
      (!value.cpu ||
        !value.physical_memory ||
        value.gpu_inventory !== "complete" ||
        value.visibility_limited)
    )
      context.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Complete inventory needs CPU, physical memory, complete device enumeration and unrestricted visibility",
      });
    if (new Set(value.devices.map((d) => d.id)).size !== value.devices.length)
      context.addIssue({
        code: "custom",
        path: ["devices"],
        message: "Snapshot-local device ids must be unique",
      });
    if (
      Date.parse(value.availability_expires_at) < Date.parse(value.observed_at)
    )
      context.addIssue({
        code: "custom",
        path: ["availability_expires_at"],
        message: "Availability cannot expire before collection",
      });
    for (const [i, device] of value.devices.entries()) {
      if (device.installed_memory?.bytes === 0)
        context.addIssue({
          code: "custom",
          path: ["devices", i, "installed_memory"],
          message: "Unknown capacity is null, not zero",
        });
      if (
        device.memory_kind === "dedicated" &&
        device.available_memory &&
        device.installed_memory &&
        device.available_memory.bytes > device.installed_memory.bytes
      )
        context.addIssue({
          code: "custom",
          path: ["devices", i, "available_memory"],
          message: "Available memory exceeds installed memory",
        });
      if (device.memory_kind === "shared" && device.installed_memory !== null)
        context.addIssue({
          code: "custom",
          path: ["devices", i, "installed_memory"],
          message:
            "Shared memory is represented by the physical pool, never duplicate GPU capacity",
        });
    }
  });
export type ProbeSnapshot = z.infer<typeof ProbeSnapshotSchema>;
export type ProbeDevice = z.infer<typeof ProbeDeviceSchema>;
export type ObservedMemory = z.infer<typeof ObservedMemorySchema>;

/** Content imported in a browser is attributable data, not authenticated local collection. */
export function projectProbeForSharing(value: unknown): ProbeSnapshot {
  const snapshot = ProbeSnapshotSchema.parse(value);
  return ProbeSnapshotSchema.parse({
    ...snapshot,
    id: "probe.shared",
    cpu: snapshot.cpu ? { ...snapshot.cpu, model: null } : null,
    diagnostics: snapshot.diagnostics.map((entry) => ({
      code: entry.code,
      message:
        "Collection limitation; inspect the original snapshot locally for details.",
    })),
  });
}
