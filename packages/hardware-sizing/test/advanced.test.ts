import { describe, expect, it } from "vitest";
import {
  createPlanningInput,
  estimateModelFit,
  listModelProfiles,
  planningInputFromProbe,
  ProbeSnapshotSchema,
} from "../src/index.js";
import type { SizingInput, DecodeCalibration } from "../src/index.js";
function input(): SizingInput {
  const i = createPlanningInput();
  i.hardware.allocation_limit_bytes = 24 * 2 ** 30;
  i.runtime = {
    name: "test-runtime",
    version: "1",
    basis: "user_assumption",
    overhead_bytes: 2 ** 30,
    allocator_allowance_bytes: 0,
  };
  return i;
}
function devices(): SizingInput {
  const i = input();
  i.hardware.device_count = 2;
  i.placement = "pipeline_parallel";
  i.extensions = {
    format: "anvilmark-sizing-extensions/1",
    placement_profile: "contiguous-layer-residency/1",
    devices: [0, 1].map((n) => ({
      id: `device-${n}`,
      model: "test-gpu",
      capacity_bytes: 24 * 2 ** 30,
      allocation_limit_bytes: 24 * 2 ** 30,
      reserve_bytes: 0,
      layers: 14,
      runtime_overhead_bytes: 2 ** 30,
      allocator_allowance_bytes: 0,
    })),
  };
  return i;
}
describe("placement and exact-envelope calibration", () => {
  it.each(listModelProfiles())(
    "accounts every total parameter once for $architecture",
    (model) => {
      const i = devices();
      i.model = { id: model.id, revision: model.revision };
      i.extensions!.devices!.forEach((d) => {
        d.layers = model.attention_groups[0]!.layers / 2;
      });
      const result = estimateModelFit(i);
      expect(result.status).toBe("calculated");
      expect(result.devices!.reduce((n, d) => n + d.weights_bytes, 0)).toBe(
        model.parameter_count * 2,
      );
      expect(result.memory.kv_cache_bytes).toBe(
        estimateModelFit({
          ...i,
          hardware: { ...i.hardware, device_count: 1 },
          placement: "single_device",
          extensions: undefined,
        }).memory.kv_cache_bytes,
      );
      expect(result.memory.headroom_bytes).toBeNull();
      expect(result.memory.usable_budget_bytes).toBeNull();
      expect(result.performance.estimated_decode_tokens_per_second).toBeNull();
    },
  );
  it("rejects one-device overflow even when total installed memory is ample", () => {
    const i = devices();
    i.extensions!.devices![0]!.allocation_limit_bytes = 2 ** 30;
    const result = estimateModelFit(i);
    expect(result.memory.assessment).toBe("estimated_over_budget");
    expect(result.devices![0]!.headroom_bytes).toBeLessThan(0);
  });
  it.each(["mixed", "layers", "quantized", "tensor"])(
    "does not pool unsupported %s configurations",
    (kind) => {
      const i = devices();
      if (kind === "mixed") i.extensions!.devices![1]!.model = "other";
      if (kind === "layers") i.extensions!.devices![1]!.layers = 13;
      if (kind === "quantized") i.weights.format = "q4_nominal";
      if (kind === "tensor") i.placement = "tensor_parallel";
      expect(estimateModelFit(i).status).toBe("unsupported");
    },
  );
  it("keeps missing per-device allowances unknown", () => {
    const i = devices();
    i.extensions!.devices![1]!.runtime_overhead_bytes = null;
    expect(estimateModelFit(i).memory.assessment).toBe("unknown");
  });
  it("uses supplied measurements only for an exact envelope, never extrapolates MoE or GPU count", () => {
    const i = input();
    const calibration: DecodeCalibration = {
      format: "anvilmark-decode-calibration/1",
      id: "synthetic-test-only",
      source_url: "https://example.invalid/synthetic-test",
      source_revision: "test",
      methodology: "Synthetic fixture; not a real benchmark.",
      observed_at: "2026-09-17T00:00:00Z",
      expires_at: "2026-09-19T00:00:00Z",
      model_id: i.model.id,
      model_revision: i.model.revision,
      weight_format: "bf16",
      key_format: "fp16",
      value_format: "fp16",
      hardware_sku: "test-gpu",
      capacity_bytes: i.hardware.capacity_bytes,
      backend: "cuda",
      runtime: "test-runtime",
      runtime_version: "1",
      retained_tokens: 4096,
      concurrent_sequences: 1,
      samples: [
        { output_tokens: 100, decode_duration_ms: 1000 },
        { output_tokens: 80, decode_duration_ms: 1000 },
        { output_tokens: 90, decode_duration_ms: 1000 },
      ],
    };
    i.extensions = {
      format: "anvilmark-sizing-extensions/1",
      hardware_sku: "test-gpu",
      calibration,
      calibration_as_of: "2026-09-18T00:00:00Z",
    };
    expect(estimateModelFit(i).performance).toMatchObject({
      status: "advisory_calibrated",
      estimated_decode_tokens_per_second: 90,
    });
    for (const change of [
      (d: SizingInput) => {
        d.runtime.version = "2";
      },
      (d: SizingInput) => {
        d.workload.retained_tokens_per_sequence = 8192;
      },
      (d: SizingInput) => {
        d.extensions!.hardware_sku = "other";
      },
      (d: SizingInput) => {
        d.extensions!.calibration_as_of = "2026-09-20T00:00:00Z";
      },
    ]) {
      const d = structuredClone(i);
      change(d);
      expect(
        estimateModelFit(d).performance.estimated_decode_tokens_per_second,
      ).toBeNull();
    }
  });
  it("imports observed physical RAM as a new T1 planning assumption without guessing allocation", () => {
    const snapshot = ProbeSnapshotSchema.parse({
      format: "anvilmark-hardware-probe/2",
      id: "probe.test",
      observed_at: "2026-09-18T00:00:00Z",
      detector_version: "0.2.0-draft.1",
      platform: "macos",
      scope: "host",
      status: "complete",
      cpu: { logical_cores: 8, model: null },
      physical_memory: {
        bytes: 16 * 2 ** 30,
        evidence_kind: "deterministic_observation",
        source: "node:os",
      },
      available_memory: null,
      allocation_limit: null,
      availability_expires_at: "2026-09-18T00:00:30Z",
      gpu_inventory: "complete",
      visibility_limited: false,
      devices: [
        {
          id: "device-0",
          vendor: "apple",
          model: "Apple M2",
          backend: "metal",
          memory_kind: "shared",
          installed_memory: null,
          available_memory: null,
          recommended_working_set: null,
        },
      ],
      diagnostics: [],
    });
    const i = planningInputFromProbe(snapshot, "device-0");
    expect(i.hardware).toMatchObject({
      kind: "unified_memory",
      evidence_kind: "user_declared",
      capacity_bytes: 16 * 2 ** 30,
      allocation_limit_bytes: null,
    });
    expect(i.extensions!.observation!.trust).toBe("unverified_import");
    expect(snapshot.physical_memory!.evidence_kind).toBe(
      "deterministic_observation",
    );
  });
});
