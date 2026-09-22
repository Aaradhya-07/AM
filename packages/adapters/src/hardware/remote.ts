import { withAbort } from "./bounded.js";
import type { AdapterOutcome } from "../envelope.js";
import type { SubprocessResult } from "../subprocess/runner.js";
import { isIP } from "node:net";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
import { ProbeSnapshotSchema } from "@anvilmark/hardware-sizing";
import type { ProbeSnapshot } from "@anvilmark/hardware-sizing";
import {
  defaultProbeDependencies,
  newProbeSnapshot,
  observed,
  parseMeminfo,
  parseNvidiaInventory,
} from "./detector.js";
import type { ProbeDependencies } from "./detector.js";

/** Fixed, bounded, read-only remote program. No destination/config/input is interpolated here. */
export const REMOTE_LINUX_SCRIPT = `import json,os,platform,subprocess,signal
def deadline(signum,frame): raise TimeoutError("remote inventory deadline")
signal.signal(signal.SIGALRM,deadline);signal.alarm(12)
from pathlib import Path
def read(p):
 with open(p,'r') as f:
  s=f.read(1048577)
  if len(s)>1048576: raise ValueError('inventory too large')
  return s
r={'platform':platform.system(),'cores':os.cpu_count(),'meminfo':None,'pci_vendors':[],'pci_complete':False,'cgroup_limit':None,'visibility_limited':any(k in os.environ for k in ['CUDA_VISIBLE_DEVICES','NVIDIA_VISIBLE_DEVICES','ROCR_VISIBLE_DEVICES','HIP_VISIBLE_DEVICES']),'nvidia':None,'nvidia_status':'unavailable'}
if r['platform']!='Linux':
 print(json.dumps(r));raise SystemExit(0)
r['meminfo']=read('/proc/meminfo')
try:
 r['cgroup_limit']=read('/sys/fs/cgroup/memory.max').strip()
except OSError: pass
try:
 entries=list(Path('/sys/bus/pci/devices').iterdir())
 if len(entries)>4096: raise ValueError('inventory too large')
 for d in entries:
  if read(d/'class').strip().startswith('0x03'):
   r['pci_vendors'].append(read(d/'vendor').strip())
   if len(r['pci_vendors'])>64: raise ValueError('too many devices')
 r['pci_complete']=True
except (OSError,ValueError): pass
try:
 p=subprocess.Popen(['nvidia-smi','--query-gpu=name,memory.total,memory.free,mig.mode.current','--format=csv,noheader,nounits'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'LC_ALL':'C'})
 try:
  import selectors,time
  sel=selectors.DefaultSelector();sel.register(p.stdout,selectors.EVENT_READ);chunks=[];size=0;end=time.monotonic()+5
  while sel.get_map():
   if time.monotonic()>end: raise TimeoutError()
   for key,_ in sel.select(min(.1,max(0,end-time.monotonic()))):
    b=os.read(key.fileobj.fileno(),65536)
    if not b: sel.unregister(key.fileobj);continue
    size+=len(b)
    if size>1048576: raise ValueError('output too large')
    chunks.append(b)
  p.wait(timeout=max(.01,end-time.monotonic()))
  r['nvidia_status']='available' if p.returncode==0 else 'failed'
  if p.returncode==0:r['nvidia']=b''.join(chunks).decode('utf8')
 finally:
  if p.poll() is None:p.kill();p.wait(timeout=1)
except FileNotFoundError:pass
except (TimeoutError,subprocess.TimeoutExpired):r['nvidia_status']='timed_out'
except (OSError,ValueError,UnicodeError):r['nvidia_status']='failed'
print(json.dumps(r))`;
export const REMOTE_LINUX_COMMAND = `python3 -c '${REMOTE_LINUX_SCRIPT.replaceAll("'", "'\\''")}'`;
export interface RemoteProbeOptions {
  host: string;
  port?: number;
  knownHosts?: string;
  signal?: AbortSignal;
  id?: string;
  timeoutMs?: number;
  dependencies?: Partial<ProbeDependencies>;
}
export function validateSshDestination(host: string, port = 22): void {
  if (
    host.length > 253 ||
    host.startsWith("-") ||
    !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}@)?[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(
      host,
    )
  )
    throw new Error(
      "SSH destination must be a literal host or user@host without shell syntax or options",
    );
  const address = host.split("@").at(-1)!;
  if (address.includes(":") && isIP(address) !== 6)
    throw new Error("Invalid IPv6 destination");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SSH port must be 1–65535");
}
export async function probeRemoteHardware(
  options: RemoteProbeOptions,
): Promise<ProbeSnapshot> {
  const port = options.port ?? 22;
  validateSshDestination(options.host, port);
  const knownHosts =
    options.knownHosts ?? join(homedir(), ".ssh", "known_hosts");
  if (
    !isAbsolute(knownHosts) ||
    Array.from(knownHosts).some((ch) => ch.charCodeAt(0) < 32) ||
    /["%]/.test(knownHosts) ||
    knownHosts === "/dev/null"
  )
    throw new Error(
      "Use an absolute preconfigured known-hosts file; trust bypasses are forbidden",
    );
  const deps = {
    ...defaultProbeDependencies(),
    ...options.dependencies,
    platform: "linux" as const,
  };
  if (options.id) deps.id = () => options.id!;
  const snapshot = newProbeSnapshot(deps, "remote");
  const timeout = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000)
    throw new Error("SSH deadline must be 1–30000 ms");
  // Disable inherited user/system SSH configuration, which could contain ProxyCommand or LocalCommand.
  // Host trust remains enforced with the explicitly selected known-hosts file.
  const args = [
    "-F",
    "/dev/null",
    "-T",
    "-n",
    "-o",
    "BatchMode=yes",
    "-o",
    "NumberOfPasswordPrompts=0",
    "-o",
    "ServerAliveInterval=2",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile="${knownHosts}"`,
    "-o",
    "ForwardAgent=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "ProxyCommand=none",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-p",
    String(port),
    "--",
    options.host,
    REMOTE_LINUX_COMMAND,
  ];
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeout);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline.signal])
    : deadline.signal;
  let result: AdapterOutcome<SubprocessResult>;
  try {
    signal.throwIfAborted();
    result = await withAbort(
      deps.run({
        executable: "ssh",
        args,
        manifestExecutable: "ssh",
        baseEnv: deps.env,
        env: {
          ...(deps.env.SSH_AUTH_SOCK
            ? { SSH_AUTH_SOCK: deps.env.SSH_AUTH_SOCK }
            : {}),
          LC_ALL: "C",
        },
        stdin: null,
        timeoutMs: timeout,
        maxOutputBytes: 1_048_576,
        signal,
        terminateProcessGroup: true,
      }),
      signal,
    );
  } catch {
    snapshot.status = "failed";
    snapshot.diagnostics.push({
      code: options.signal?.aborted
        ? "cancelled"
        : signal.aborted
          ? "ssh_deadline_exceeded"
          : "ssh_collection_failed",
      message: "Remote collection stopped; no local fallback was used.",
    });
    return ProbeSnapshotSchema.parse(snapshot);
  } finally {
    clearTimeout(timer);
  }

  if (result.standing !== "available") {
    snapshot.status = "failed";
    snapshot.diagnostics.push({
      code: options.signal?.aborted ? "cancelled" : `ssh_${result.standing}`,
      message:
        "Remote collection failed. Check host trust, agent authentication, Python 3 availability, and the session deadline locally. No local inventory was substituted.",
    });
    return ProbeSnapshotSchema.parse(snapshot);
  }
  try {
    const raw = JSON.parse(result.value.stdout) as Record<string, unknown>;
    if (raw.platform !== "Linux") {
      snapshot.status = "unsupported";
      snapshot.diagnostics.push({
        code: "remote_platform_unsupported",
        message: "Only the fixed Linux remote collector is supported.",
      });
      return ProbeSnapshotSchema.parse(snapshot);
    }
    if (
      typeof raw.cores !== "number" ||
      !Number.isSafeInteger(raw.cores) ||
      raw.cores < 1 ||
      typeof raw.meminfo !== "string"
    )
      throw new Error();
    snapshot.cpu = { logical_cores: raw.cores, model: null };
    const mem = parseMeminfo(raw.meminfo);
    snapshot.physical_memory = observed(mem.total, "proc:meminfo");
    snapshot.available_memory =
      mem.available === null ? null : observed(mem.available, "proc:meminfo");
    snapshot.visibility_limited = raw.visibility_limited !== false;
    if (raw.cgroup_limit !== "max") {
      snapshot.visibility_limited = true;
      if (
        typeof raw.cgroup_limit === "string" &&
        /^\d+$/.test(raw.cgroup_limit) &&
        Number.isSafeInteger(Number(raw.cgroup_limit)) &&
        Number(raw.cgroup_limit) > 0
      )
        snapshot.allocation_limit = observed(
          Number(raw.cgroup_limit),
          "cgroup:v2",
        );
      snapshot.diagnostics.push({
        code: "remote_scope_limited",
        message:
          "Container/allocation scope is limited or could not be established.",
      });
    }
    const vendors = raw.pci_vendors;
    if (
      !Array.isArray(vendors) ||
      vendors.length > 64 ||
      vendors.some((v) => typeof v !== "string" || !/^0x[0-9a-f]{4}$/i.test(v))
    )
      throw new Error();
    let complete =
      raw.pci_complete === true && vendors.every((v) => v === "0x10de");
    if (raw.nvidia_status === "available" && typeof raw.nvidia === "string") {
      const parsed = parseNvidiaInventory(raw.nvidia);
      snapshot.devices = parsed.devices;
      snapshot.visibility_limited ||= parsed.partitioned;
      if (vendors.length !== parsed.devices.length) complete = false;
    } else if (vendors.length > 0 || raw.nvidia_status !== "unavailable")
      complete = false;
    snapshot.gpu_inventory = complete
      ? "complete"
      : snapshot.devices.length
        ? "partial"
        : "unavailable";
    if (!complete)
      snapshot.diagnostics.push({
        code: "remote_gpu_incomplete",
        message:
          "GPU collection was incomplete or a GPU backend/topology is unsupported.",
      });
    snapshot.status =
      complete && !snapshot.visibility_limited ? "complete" : "partial";
  } catch {
    snapshot.status = "failed";
    snapshot.diagnostics.push({
      code: "remote_output_invalid",
      message:
        "Remote collector output failed validation; no local fallback was used.",
    });
  }
  return ProbeSnapshotSchema.parse(snapshot);
}
