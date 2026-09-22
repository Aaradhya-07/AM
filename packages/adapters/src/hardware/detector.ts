import { withAbort } from "./bounded.js";
import { randomUUID } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import * as os from "node:os";
import {
  DETECTOR_VERSION,
  PROBE_FORMAT,
  ProbeSnapshotSchema,
} from "@anvilmark/hardware-sizing";
import type {
  ObservedMemory,
  ProbeDevice,
  ProbeSnapshot,
} from "@anvilmark/hardware-sizing";
import { runSubprocess } from "../subprocess/runner.js";
import type {
  SubprocessRequest,
  SubprocessResult,
} from "../subprocess/runner.js";
import type { AdapterOutcome } from "../envelope.js";
import { ADAPTER_PROTOCOL_VERSION } from "../version.js";
import { sanitizeText } from "../sanitize.js";

export interface ProbeDependencies {
  platform: NodeJS.Platform;
  clock: () => string;
  id: () => string;
  cpu: () => { cores: number; model: string | null };
  totalMemory: () => number;
  env: Readonly<Record<string, string | undefined>>;
  read: (path: string, signal: AbortSignal) => Promise<string>;
  list: (path: string, signal: AbortSignal) => Promise<string[]>;
  run: (
    request: SubprocessRequest,
  ) => Promise<AdapterOutcome<SubprocessResult>>;
}
export async function readSmallFile(
  path: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(1_048_577);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    signal.throwIfAborted();
    if (bytesRead > 1_048_576) throw new Error("Inventory file exceeds 1 MiB");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}
export function defaultProbeDependencies(): ProbeDependencies {
  return {
    platform: process.platform,
    clock: () => new Date().toISOString(),
    id: () => `probe.${randomUUID()}`,
    cpu: () => ({
      cores: os.cpus().length,
      model: os.cpus()[0]?.model ?? null,
    }),
    totalMemory: () => os.totalmem(),
    env: process.env,
    read: readSmallFile,
    list: async (path, signal) => {
      signal.throwIfAborted();
      const values = await readdir(path);
      signal.throwIfAborted();
      if (values.length > 4096)
        throw new Error("Inventory enumeration exceeds 4096 entries");
      return values;
    },
    run: (request) =>
      runSubprocess(request, {
        identity: {
          id: "anvilmark.hardware-probe",
          kind: "hardware_fit",
          version: DETECTOR_VERSION,
          execution: "local",
          protocol_version: ADAPTER_PROTOCOL_VERSION,
        },
      }),
  };
}
export const observed = (
  bytes: number,
  source: ObservedMemory["source"],
): ObservedMemory => ({
  bytes,
  evidence_kind: "deterministic_observation",
  source,
});
export function newProbeSnapshot(
  deps: Pick<ProbeDependencies, "clock" | "id" | "platform">,
  scope: ProbeSnapshot["scope"] = "host",
): ProbeSnapshot {
  const time = deps.clock();
  return {
    format: PROBE_FORMAT,
    id: deps.id(),
    observed_at: time,
    detector_version: DETECTOR_VERSION,
    platform:
      deps.platform === "darwin"
        ? "macos"
        : deps.platform === "win32"
          ? "windows"
          : deps.platform === "linux"
            ? "linux"
            : "other",
    scope,
    status: "partial",
    cpu: null,
    physical_memory: null,
    available_memory: null,
    allocation_limit: null,
    availability_expires_at: new Date(Date.parse(time) + 30_000).toISOString(),
    gpu_inventory: "unavailable",
    visibility_limited: false,
    devices: [],
    diagnostics: [],
  };
}
const safeName = (value: string): string =>
  sanitizeText(
    Array.from(value, (ch) =>
      ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch,
    )
      .join("")
      .trim(),
  ).text.slice(0, 256) || "Unknown device";
export function csvRows(text: string): string[][] {
  if (text.length > 1_048_576) throw new Error("CSV exceeds output cap");
  const rows: string[][] = [];
  for (const line of text.trim().split(/\r?\n/).filter(Boolean)) {
    let quoted = false;
    let cell = "";
    const row: string[] = [];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else cell += ch;
    }
    if (quoted) throw new Error("Unterminated CSV quote");
    row.push(cell.trim());
    rows.push(row);
    if (rows.length > 64) throw new Error("Too many GPU rows");
  }
  return rows;
}
function mib(value: string): number {
  if (!/^\d+(?:\.\d+)?$/.test(value))
    throw new Error("Missing or invalid NVIDIA memory value");
  const bytes = Number(value) * 2 ** 20;
  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    throw new Error("Invalid memory capacity");
  return bytes;
}
export function parseNvidiaInventory(text: string): {
  devices: ProbeDevice[];
  partitioned: boolean;
} {
  let partitioned = false;
  const devices = csvRows(text).map((row, index) => {
    if (row.length !== 4)
      throw new Error(
        "NVIDIA inventory requires name, total MiB, free MiB, and MIG state",
      );
    const installed = mib(row[1]!);
    const free = row[2] === "0" ? 0 : mib(row[2]!);
    if (free > installed)
      throw new Error("Free GPU memory exceeds installed memory");
    if (!/^(Disabled|N\/A|\[N\/A\])$/i.test(row[3]!)) partitioned = true;
    return {
      id: `device-${index}`,
      vendor: "nvidia" as const,
      model: safeName(row[0]!),
      backend: "cuda" as const,
      memory_kind: "dedicated" as const,
      installed_memory: observed(installed, "nvidia-smi"),
      available_memory: observed(free, "nvidia-smi"),
      recommended_working_set: null,
    };
  });
  return { devices, partitioned };
}
export function parseMeminfo(text: string): {
  total: number;
  available: number | null;
} {
  const field = (name: string) => {
    const value = text.match(new RegExp(`^${name}:\\s+(\\d+) kB$`, "m"));
    if (!value) return null;
    const n = Number(value[1]) * 1024;
    if (!Number.isSafeInteger(n))
      throw new Error("Memory exceeds safe byte range");
    return n;
  };
  const total = field("MemTotal");
  const available = field("MemAvailable");
  if (total === null || total <= 0 || (available !== null && available > total))
    throw new Error("Invalid proc memory inventory");
  return { total, available };
}
export function parseAppleDisplays(
  text: string,
  appleSilicon: boolean,
): ProbeDevice[] {
  const parsed = JSON.parse(text) as {
    SPDisplaysDataType?: Record<string, unknown>[];
  };
  if (
    !Array.isArray(parsed.SPDisplaysDataType) ||
    parsed.SPDisplaysDataType.length > 64
  )
    throw new Error("Missing display inventory");
  return parsed.SPDisplaysDataType.map((entry, index) => {
    const model =
      typeof entry.sppci_model === "string" ? entry.sppci_model : null;
    if (!model) throw new Error("Missing GPU model");
    const metal =
      entry.spdisplays_metal ?? entry.spdisplays_mtlgpufamilysupport;
    const supports =
      typeof metal === "string" &&
      (/^(spdisplays_metal\d+|Metal(?: Family)? \d+)$/i.test(metal) ||
        metal === "spdisplays_supported");
    return {
      id: `device-${index}`,
      vendor: appleSilicon ? "apple" : "other",
      model: safeName(model),
      backend: supports && appleSilicon ? "metal" : "unknown",
      memory_kind: appleSilicon ? "shared" : "unknown",
      installed_memory: null,
      available_memory: null,
      recommended_working_set: null,
    };
  });
}

export async function probeLocalHardware(
  options: {
    signal?: AbortSignal;
    id?: string;
    timeoutMs?: number;
    dependencies?: Partial<ProbeDependencies>;
  } = {},
): Promise<ProbeSnapshot> {
  const deps = { ...defaultProbeDependencies(), ...options.dependencies };
  if (options.id) deps.id = () => options.id!;
  const timeout = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000)
    throw new Error("Inventory deadline must be 1–30000 ms");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  const rawRead = deps.read;
  const rawList = deps.list;
  const rawRun = deps.run;
  deps.read = (path, requestSignal) => {
    requestSignal.throwIfAborted();
    return withAbort(rawRead(path, requestSignal), requestSignal);
  };
  deps.list = (path, requestSignal) => {
    requestSignal.throwIfAborted();
    return withAbort(rawList(path, requestSignal), requestSignal);
  };
  deps.run = (request) => {
    signal.throwIfAborted();
    return withAbort(rawRun(request), signal);
  };
  const snapshot = newProbeSnapshot(deps);
  const diagnostic = (code: string, message: string) =>
    snapshot.diagnostics.push({ code, message: message.slice(0, 1024) });
  const run = (executable: string, args: string[]) =>
    deps.run({
      executable,
      args,
      timeoutMs: Math.min(5000, timeout),
      maxOutputBytes: 1_048_576,
      signal,
      stdin: null,
      baseEnv: deps.env,
      env: { LC_ALL: "C" },
      terminateProcessGroup: true,
    });
  try {
    signal.throwIfAborted();
    const cpu = deps.cpu();
    if (Number.isSafeInteger(cpu.cores) && cpu.cores > 0)
      snapshot.cpu = {
        logical_cores: cpu.cores,
        model: cpu.model ? safeName(cpu.model) : null,
      };
    const memory = deps.totalMemory();
    if (Number.isSafeInteger(memory) && memory > 0)
      snapshot.physical_memory = observed(memory, "node:os");
    if (deps.platform === "linux") {
      try {
        const m = parseMeminfo(await deps.read("/proc/meminfo", signal));
        snapshot.physical_memory = observed(m.total, "proc:meminfo");
        if (m.available !== null)
          snapshot.available_memory = observed(m.available, "proc:meminfo");
      } catch {
        diagnostic(
          "meminfo_unavailable",
          "Kernel memory inventory was unavailable or invalid.",
        );
      }
      try {
        const limit = (
          await deps.read("/sys/fs/cgroup/memory.max", signal)
        ).trim();
        if (limit !== "max") {
          const value = Number(limit);
          if (
            !/^\d+$/.test(limit) ||
            !Number.isSafeInteger(value) ||
            value <= 0
          )
            throw new Error();
          snapshot.allocation_limit = observed(value, "cgroup:v2");
          snapshot.scope = "container";
          snapshot.visibility_limited = true;
          diagnostic(
            "cgroup_limit",
            "Container memory limit is distinct from host memory; process CPU limits and v1 cgroups are not inferred.",
          );
        }
      } catch {
        snapshot.visibility_limited = true;
        diagnostic(
          "cgroup_limit_unknown",
          "No supported cgroup v2 memory limit was established.",
        );
      }
      let pciComplete = true;
      let nvidiaCount = 0;
      try {
        const entries = (await deps.list("/sys/bus/pci/devices", signal))
          .filter((e) =>
            /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/i.test(e),
          )
          .sort();
        for (const entry of entries) {
          signal.throwIfAborted();
          const base = `/sys/bus/pci/devices/${entry}`;
          let klass: string;
          try {
            klass = (await deps.read(`${base}/class`, signal)).trim();
          } catch {
            pciComplete = false;
            continue;
          }
          if (!/^0x03/.test(klass)) continue;
          const vendor = (await deps.read(`${base}/vendor`, signal)).trim();
          if (vendor === "0x10de") {
            nvidiaCount++;
            continue;
          }
          if (snapshot.devices.length >= 64) throw new Error("Device limit");
          const device: ProbeDevice = {
            id: `device-${snapshot.devices.length}`,
            vendor: vendor === "0x1002" ? "amd" : "other",
            model:
              vendor === "0x1002"
                ? "AMD device (SKU unknown)"
                : "Display device (SKU unknown)",
            backend: "unknown",
            memory_kind: "unknown",
            installed_memory: null,
            available_memory: null,
            recommended_working_set: null,
          };
          if (vendor === "0x1002") {
            try {
              const total = Number(
                (await deps.read(`${base}/mem_info_vram_total`, signal)).trim(),
              );
              const used = Number(
                (await deps.read(`${base}/mem_info_vram_used`, signal)).trim(),
              );
              if (
                !Number.isSafeInteger(total) ||
                total <= 0 ||
                !Number.isSafeInteger(used) ||
                used < 0 ||
                used > total
              )
                throw new Error();
              device.installed_memory = observed(total, "sysfs:amdgpu");
              device.available_memory = observed(total - used, "sysfs:amdgpu");
              device.memory_kind = "unknown";
              diagnostic(
                "amd_topology_unknown",
                "AMDGPU VRAM was observed; discrete/APU topology and ROCm support are not inferred from sysfs.",
              );
            } catch {
              diagnostic(
                "amd_memory_unavailable",
                "AMDGPU memory counters could not be established.",
              );
            }
          }
          snapshot.devices.push(device);
          pciComplete = false;
        }
      } catch {
        pciComplete = false;
        diagnostic(
          "pci_inventory_unavailable",
          "Display-device enumeration was incomplete.",
        );
      }
      const gpu = await run("nvidia-smi", [
        "--query-gpu=name,memory.total,memory.free,mig.mode.current",
        "--format=csv,noheader,nounits",
      ]);
      if (gpu.standing === "available") {
        try {
          const parsed = parseNvidiaInventory(gpu.value.stdout);
          if (nvidiaCount !== parsed.devices.length) pciComplete = false;
          snapshot.devices.push(...parsed.devices);
          if (parsed.partitioned) {
            snapshot.visibility_limited = true;
            diagnostic(
              "partitioned_gpu",
              "MIG/vGPU or an unknown partition mode requires a partition-aware allocation profile.",
            );
          }
        } catch {
          pciComplete = false;
          diagnostic(
            "gpu_output_invalid",
            "GPU tool output was malformed or contained unsupported memory/partition values.",
          );
        }
      } else if (nvidiaCount > 0 || gpu.standing !== "unavailable") {
        pciComplete = false;
        diagnostic(
          `nvidia_${gpu.standing}`,
          gpu.errors.map((e) => e.message).join("; "),
        );
      }
      if (
        deps.env.CUDA_VISIBLE_DEVICES !== undefined ||
        deps.env.NVIDIA_VISIBLE_DEVICES !== undefined ||
        deps.env.ROCR_VISIBLE_DEVICES !== undefined ||
        deps.env.HIP_VISIBLE_DEVICES !== undefined
      ) {
        snapshot.visibility_limited = true;
        diagnostic(
          "visibility_restricted",
          "Device visibility variables are set. Inventory tools may ignore them; no allocatable device mapping is inferred.",
        );
      }
      snapshot.gpu_inventory = pciComplete
        ? "complete"
        : snapshot.devices.length
          ? "partial"
          : "unavailable";
    } else if (deps.platform === "darwin") {
      const arm = await run("sysctl", ["-n", "hw.optional.arm64"]);
      if (arm.standing !== "available")
        diagnostic(
          "apple_architecture_unknown",
          "The Apple Silicon architecture query failed or was denied. The GPU backend stays unknown.",
        );
      const appleSilicon =
        arm.standing === "available" && arm.value.stdout.trim() === "1";
      const display = await run("system_profiler", [
        "SPDisplaysDataType",
        "-json",
      ]);
      if (display.standing === "available") {
        try {
          snapshot.devices = parseAppleDisplays(
            display.value.stdout,
            appleSilicon,
          );
          snapshot.gpu_inventory =
            appleSilicon &&
            snapshot.devices.length > 0 &&
            snapshot.devices.every((d) => d.backend === "metal")
              ? "complete"
              : "partial";
          if (arm.standing === "available" && !appleSilicon)
            diagnostic(
              "mac_gpu_unsupported",
              "Intel/discrete Mac inventory does not have a supported memory topology profile.",
            );
        } catch {
          diagnostic(
            "apple_inventory_invalid",
            "Apple display inventory could not be parsed.",
          );
        }
      } else
        diagnostic(
          `apple_${display.standing}`,
          display.errors.map((e) => e.message).join("; "),
        );
      diagnostic(
        "metal_allocation_unknown",
        "Physical unified memory is one pool; recommended working set and available allocation were not measured.",
      );
    } else {
      snapshot.gpu_inventory = "unsupported";
      diagnostic(
        "gpu_platform_unsupported",
        "CPU/RAM facts are available; GPU inventory is not implemented for this platform.",
      );
    }
    if (snapshot.devices.length > 64)
      throw new Error("Device inventory exceeds 64 devices");
    snapshot.devices = snapshot.devices.map((d, index) => ({
      ...d,
      id: `device-${index}`,
    }));
    signal.throwIfAborted();
    snapshot.status =
      snapshot.cpu &&
      snapshot.physical_memory &&
      snapshot.gpu_inventory === "complete" &&
      !snapshot.visibility_limited
        ? "complete"
        : snapshot.cpu || snapshot.physical_memory || snapshot.devices.length
          ? "partial"
          : "unavailable";
  } catch (error) {
    snapshot.status = "failed";
    diagnostic(
      signal.aborted
        ? options.signal?.aborted
          ? "cancelled"
          : "deadline_exceeded"
        : "collection_failed",
      signal.aborted
        ? "Inventory collection stopped before completion."
        : sanitizeText(
            error instanceof Error ? error.message : "Inventory failed",
          ).text,
    );
  } finally {
    clearTimeout(timer);
  }
  return ProbeSnapshotSchema.parse(snapshot);
}
