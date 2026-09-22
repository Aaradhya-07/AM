import { describe, expect, it } from "vitest";
import {
  parseNvidiaInventory,
  parseAppleDisplays,
  probeLocalHardware,
  probeRemoteHardware,
  snapshotHardware,
  discoverLocalModels,
  DISCOVERY_ENDPOINTS,
  runSubprocess,
  validateSshDestination,
} from "../src/index.js";
import type { ProbeDependencies, SubprocessRequest } from "../src/index.js";
import { identity } from "./helpers.js";
const now = "2026-09-18T00:00:00.000Z";
const csv = '"NVIDIA RTX Test, GPU", 24576, 20000, Disabled\n';
const success = (stdout: string) =>
  runSubprocess(
    {
      executable: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(stdout)})`],
      timeoutMs: 1000,
      maxOutputBytes: 1_048_576,
    },
    { identity: identity() },
  );
const missing = () =>
  runSubprocess(
    {
      executable: "anvilmark-missing-hardware-test",
      args: [],
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    },
    { identity: identity() },
  );
function linux(
  overrides: Partial<ProbeDependencies> = {},
): Partial<ProbeDependencies> {
  return {
    platform: "linux",
    clock: () => now,
    id: () => "probe.test",
    cpu: () => ({ cores: 8, model: "Test CPU" }),
    totalMemory: () => 16 * 2 ** 30,
    env: {},
    read: async (path) => {
      if (path === "/proc/meminfo")
        return "MemTotal: 16777216 kB\nMemAvailable: 8388608 kB\n";
      if (path.endsWith("memory.max")) return "max";
      if (path.endsWith("/class")) return "0x030000";
      if (path.endsWith("/vendor")) return "0x10de";
      throw new Error("Unavailable fixture file");
    },
    list: async () => ["0000:01:00.0"],
    run: () => success(csv),
    ...overrides,
  };
}
describe("bounded inventory collectors", () => {
  it("parses quoted SKU names, MiB units, zero free bytes, and MIG state", () => {
    const result = parseNvidiaInventory(csv);
    expect(result.devices[0]!.model).toBe("NVIDIA RTX Test, GPU");
    expect(result.devices[0]!.installed_memory!.bytes).toBe(24 * 2 ** 30);
    expect(result.partitioned).toBe(false);
    expect(parseNvidiaInventory("GPU, 1024, 0, Enabled").partitioned).toBe(
      true,
    );
  });
  it.each([
    "GPU,N/A,0,Disabled",
    "GPU,1024,2048,Disabled",
    '"GPU,1024,0,Disabled',
    "GPU,1024,0",
    "GPU,99999999999999999,0,Disabled",
  ])("rejects malformed inventory %s", (value) =>
    expect(() => parseNvidiaInventory(value)).toThrow(),
  );
  it("keeps RAM, dedicated memory, and availability separate", async () => {
    const snapshot = await probeLocalHardware({ dependencies: linux() });
    expect(snapshot.status).toBe("complete");
    expect(snapshot.physical_memory!.bytes).toBe(16 * 2 ** 30);
    expect(snapshot.devices[0]!.installed_memory!.bytes).toBe(24 * 2 ** 30);
    expect(snapshot.availability_expires_at).toBe("2026-09-18T00:00:30.000Z");
    expect(
      snapshotHardware(snapshot, "observed", "gib").accelerators[0]!.vram_gb,
    ).toBe(24);
    expect(
      snapshotHardware(snapshot, "observed", "gb").accelerators[0]!.vram_gb,
    ).toBe((24 * 2 ** 30) / 1e9);
  });
  it("records Apple RAM once and does not infer a Metal allocation limit", async () => {
    const displays = JSON.stringify({
      SPDisplaysDataType: [
        {
          sppci_model: "Apple M2",
          spdisplays_metal: "spdisplays_metal3",
          _spdisplays_serial: "PRIVATE-SERIAL",
        },
      ],
    });
    const snapshot = await probeLocalHardware({
      dependencies: linux({
        platform: "darwin",
        totalMemory: () => 64 * 2 ** 30,
        run: (request) =>
          success(request.executable === "sysctl" ? "1" : displays),
      }),
    });
    expect(snapshot.status).toBe("complete");
    expect(snapshot.devices[0]!.installed_memory).toBeNull();
    expect(snapshot.devices[0]!.recommended_working_set).toBeNull();
    expect(snapshotHardware(snapshot, "observed", "gib")).toMatchObject({
      ram_gb: 64,
      accelerators: [],
      backend: "metal",
    });
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE-SERIAL");
  });
  it("recognizes the newer macOS Metal family field", () => {
    expect(
      parseAppleDisplays(
        '{"SPDisplaysDataType":[{"sppci_model":"Apple M4","spdisplays_mtlgpufamilysupport":"spdisplays_metal4"}]}',
        true,
      )[0]!.backend,
    ).toBe("metal");
  });
  it("does not treat Intel Metal or an empty display list as a supported Apple pool", () => {
    expect(
      parseAppleDisplays(
        '{"SPDisplaysDataType":[{"sppci_model":"Intel", "spdisplays_metal":"spdisplays_metal3"}]}',
        false,
      )[0]!.backend,
    ).toBe("unknown");
  });
  it.each([
    "MIG",
    "visibility",
    "missing-driver",
    "malformed-driver",
    "container",
    "unknown-cgroup",
  ])("retains %s as partial and refuses persistence", async (kind) => {
    const deps = linux();
    if (kind === "MIG") deps.run = () => success("GPU,24576,20000,Enabled");
    if (kind === "visibility") deps.env = { CUDA_VISIBLE_DEVICES: "0" };
    if (kind === "missing-driver") deps.run = missing;
    if (kind === "malformed-driver") deps.run = () => success("{}");
    if (kind === "container" || kind === "unknown-cgroup") {
      const read = deps.read!;
      deps.read = async (p, s) =>
        p.endsWith("memory.max")
          ? kind === "container"
            ? "8589934592"
            : Promise.reject(new Error())
          : read(p, s);
    }
    const snapshot = await probeLocalHardware({ dependencies: deps });
    expect(snapshot.status).toBe("partial");
    expect(() => snapshotHardware(snapshot, "observed", "gib")).toThrow();
  });
  it("can establish a CPU-only Linux inventory without NVIDIA tools", async () => {
    const snapshot = await probeLocalHardware({
      dependencies: linux({ list: async () => [], run: missing }),
    });
    expect(snapshot.status).toBe("complete");
    expect(snapshotHardware(snapshot, "cpu-observed", "gib").backend).toBe(
      "cpu",
    );
  });
  it("bounds noncooperative reads and handles pre-cancellation", async () => {
    const start = Date.now();
    const hung = await probeLocalHardware({
      timeoutMs: 25,
      dependencies: linux({ read: () => new Promise(() => {}) }),
    });
    expect(hung.status).toBe("failed");
    expect(hung.diagnostics.some((d) => d.code === "deadline_exceeded")).toBe(
      true,
    );
    expect(Date.now() - start).toBeLessThan(1000);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await probeLocalHardware({
      signal: controller.signal,
      dependencies: linux(),
    });
    expect(cancelled.diagnostics[0]!.code).toBe("cancelled");
  });
  it("does not turn unsupported platforms into complete observations", async () => {
    expect(
      (await probeLocalHardware({ dependencies: linux({ platform: "win32" }) }))
        .status,
    ).toBe("partial");
  });
});
describe("SSH and local endpoint boundaries", () => {
  it.each([
    "-oProxyCommand=evil",
    "host;touch x",
    "user@host $(id)",
    "host\nfoo",
    "bad:ipv6",
  ])("rejects unsafe SSH destination %s", (host) =>
    expect(() => validateSshDestination(host)).toThrow(),
  );
  it("uses fixed batch-mode SSH with trusted keys and no local fallback", async () => {
    let request: SubprocessRequest | undefined;
    const snapshot = await probeRemoteHardware({
      host: "user@private-host",
      knownHosts: "/tmp/known hosts",
      dependencies: linux({
        cpu: () => {
          throw new Error("local CPU forbidden");
        },
        totalMemory: () => {
          throw new Error("local RAM forbidden");
        },
        run: (r) => {
          request = r;
          return success(
            JSON.stringify({
              platform: "Linux",
              cores: 8,
              meminfo: "MemTotal: 16777216 kB\n",
              pci_vendors: [],
              pci_complete: true,
              cgroup_limit: "max",
              visibility_limited: false,
              nvidia_status: "unavailable",
              nvidia: null,
            }),
          );
        },
      }),
    });
    expect(snapshot.status).toBe("complete");
    expect(snapshot.scope).toBe("remote");
    expect(request!.args).toEqual(
      expect.arrayContaining([
        "-T",
        "-n",
        "BatchMode=yes",
        "StrictHostKeyChecking=yes",
        "ForwardAgent=no",
        "PermitLocalCommand=no",
        "ProxyCommand=none",
      ]),
    );
    expect(request!.args.at(-1)).not.toContain("private-host");
    expect(request!.stdin).toBeNull();
    expect(request!.terminateProcessGroup).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("private-host");
  });
  it("fails closed on SSH errors and rejects a null known-hosts file", async () => {
    const failed = await probeRemoteHardware({
      host: "host",
      dependencies: linux({ run: missing }),
    });
    expect(failed.status).toBe("failed");
    expect(failed.physical_memory).toBeNull();
    await expect(
      probeRemoteHardware({ host: "host", knownHosts: "/dev/null" }),
    ).rejects.toThrow();
  });
  it("never follows redirects or expands loopback destinations", async () => {
    const visited: string[] = [];
    const inventory = await discoverLocalModels({
      fetch: async (url) => {
        visited.push(url);
        return { status: 302, body: '{"location":"http://private-host"}' };
      },
    });
    expect(visited.sort()).toEqual([...DISCOVERY_ENDPOINTS].sort());
    expect(
      inventory.every(
        (i) => i.status === "redirect_refused" && i.models.length === 0,
      ),
    ).toBe(true);
  });
  it.each([
    [401, "authentication_required"],
    [500, "http_error"],
    [200, "malformed"],
  ] as const)(
    "classifies HTTP %i without guessing readiness",
    async (status, expected) => {
      const inventory = await discoverLocalModels({
        fetch: async () => ({ status, body: "bad json" }),
      });
      expect(inventory.every((i) => i.status === expected)).toBe(true);
    },
  );
  it("bounds noncooperative endpoint calls with an aggregate deadline", async () => {
    const start = Date.now();
    const inventory = await discoverLocalModels({
      timeoutMs: 25,
      fetch: () => new Promise(() => {}),
    });
    expect(inventory).toHaveLength(DISCOVERY_ENDPOINTS.length);
    expect(inventory.every((i) => i.status === "timed_out")).toBe(true);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

it("bounds a remote adapter that ignores cancellation", async () => {
  const start = Date.now();
  const snapshot = await probeRemoteHardware({
    host: "host",
    timeoutMs: 25,
    dependencies: linux({ run: () => new Promise(() => {}) }),
  });
  expect(snapshot.status).toBe("failed");
  expect(snapshot.diagnostics[0]!.code).toBe("ssh_deadline_exceeded");
  expect(Date.now() - start).toBeLessThan(1000);
});
it.skipIf(process.platform === "win32")(
  "terminates a collector's detached descendants even when the parent closes first",
  async () => {
    const script = `const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:"ignore"});console.log(child.pid);setInterval(()=>{},1000);`;
    const outcome = await runSubprocess(
      {
        executable: process.execPath,
        args: ["-e", script],
        timeoutMs: 250,
        maxOutputBytes: 1024,
        terminateProcessGroup: true,
      },
      { identity: identity() },
    );
    expect(outcome.standing).toBe("timed_out");
    const pid = Number(
      outcome.standing !== "available" ? outcome.errors[0]?.detail?.stdout : 0,
    );
    expect(pid).toBeGreaterThan(0);
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 1000, interval: 20 },
      )
      .toBe(true);
  },
);
