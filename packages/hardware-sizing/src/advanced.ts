import type { SizingInput, SizingResult } from "./schema.js";
import { SizingResultSchema } from "./schema.js";
import { EXTENDED_ESTIMATOR_VERSION } from "./extensions.js";
import type { DeviceEstimateSchema } from "./extensions.js";
import type { z } from "zod/v4";
import { estimateKvBytes, floatBytes, sumBytes } from "./memory.js";

/** Advisory observed range in an exact envelope; never a latency or evidence verdict. */
function calibratedPerformance(
  input: SizingInput,
): SizingResult["performance"] | null {
  const ext = input.extensions;
  const c = ext?.calibration;
  if (!c || !ext) return null;
  const inWindow =
    Date.parse(c.observed_at) <= Date.parse(ext.calibration_as_of!) &&
    Date.parse(ext.calibration_as_of!) <= Date.parse(c.expires_at);
  const matches =
    inWindow &&
    input.hardware.device_count === 1 &&
    c.model_id === input.model.id &&
    c.model_revision === input.model.revision &&
    c.hardware_sku === ext.hardware_sku &&
    c.capacity_bytes === input.hardware.capacity_bytes &&
    c.backend === input.hardware.backend &&
    c.runtime === input.runtime.name &&
    c.runtime_version === input.runtime.version &&
    c.weight_format === input.weights.format &&
    c.key_format === input.kv_cache.key_format &&
    c.value_format === input.kv_cache.value_format &&
    c.retained_tokens === input.workload.retained_tokens_per_sequence &&
    input.workload.concurrent_sequences === 1;
  if (!matches)
    return {
      status: "unverified",
      estimated_decode_tokens_per_second: null,
      reason:
        "The supplied calibration does not match this exact model/runtime/device/precision/context envelope or validity window.",
    };
  const rates = c.samples
    .map((s) => s.output_tokens / (s.decode_duration_ms / 1000))
    .sort((a, b) => a - b);
  const middle = Math.floor(rates.length / 2);
  const median =
    rates.length % 2
      ? rates[middle]!
      : (rates[middle - 1]! + rates[middle]!) / 2;
  if (
    !rates.every((rate) => Number.isFinite(rate) && rate > 0) ||
    !Number.isFinite(median)
  )
    return null;
  return {
    status: "advisory_calibrated",
    estimated_decode_tokens_per_second: median,
    reason: `Median of ${rates.length} caller-supplied decode samples; observed range ${rates[0]!.toFixed(2)}–${rates.at(-1)!.toFixed(2)} tokens/s. Exact envelope only, no scaling or P95 inference. Evaluated at ${ext.calibration_as_of}, valid through ${c.expires_at}. Source ${c.source_url} at ${c.source_revision}. This file does not authenticate measurements on the current target.`,
  };
}

export function estimateExtendedModelFit(
  input: SizingInput,
  base: (value: unknown) => SizingResult,
): SizingResult {
  const ext = input.extensions!;
  const simple = structuredClone(input);
  delete simple.extensions;
  if (ext.devices) {
    simple.hardware.device_count = 1;
    simple.placement = "single_device";
  }
  const result = base(simple);
  result.estimator_version = EXTENDED_ESTIMATOR_VERSION;
  if (ext.observation)
    result.assumptions.push(
      "Imported inventory is unverified in this surface. Edited planning inputs remain declarations; availability is a dated observation, not a reservation.",
    );
  const devices = ext.devices;
  if (devices) {
    const model = result.model_profile;
    const precision = floatBytes(input.weights.format);
    const reject = (message: string) => {
      result.status = "unsupported";
      result.memory.assessment = "unknown";
      result.memory.headroom_bytes = null;
      result.memory.required_bytes = null;
      result.issues.push({ code: "placement_profile_mismatch", message });
      return SizingResultSchema.parse(result);
    };
    if (!model || result.status === "unsupported")
      return reject(
        "The pinned model/cache configuration is outside this placement profile.",
      );
    if (
      input.placement !== "pipeline_parallel" ||
      input.hardware.kind !== "discrete_gpu" ||
      input.hardware.device_count !== devices.length ||
      devices.some(
        (d) =>
          d.model !== devices[0]!.model ||
          d.capacity_bytes !== devices[0]!.capacity_bytes,
      ) ||
      input.hardware.capacity_bytes !== devices[0]!.capacity_bytes
    )
      return reject(
        "This profile requires one-host homogeneous discrete GPUs, pipeline placement, matching device count, and per-device installed capacity.",
      );
    if (precision === null)
      return reject(
        "This placement profile supports floating-point tensor storage only; quantization layout cannot be inferred per device.",
      );
    const layers = model.attention_groups.reduce((n, g) => n + g.layers, 0);
    if (
      devices.reduce((n, d) => n + d.layers, 0) !== layers ||
      model.attention_groups.length !== 1
    )
      return reject(
        "Contiguous device layer assignments must cover every model layer exactly once.",
      );
    const partitions: Record<string, { hidden: number; vocabulary: number }> = {
      "Qwen/Qwen2.5-Coder-7B-Instruct@c03e6d358207e414f1eca0bb1891e29f1db0e242":
        { hidden: 3584, vocabulary: 152064 },
      "mistralai/Mixtral-8x7B-Instruct-v0.1@eba92302a2861cdc0098cc54bc9f17cb2c47eb61":
        { hidden: 4096, vocabulary: 32000 },
    };
    const partition = partitions[`${model.id}@${model.revision}`];
    if (!partition)
      return reject(
        "This model revision has no verified contiguous-layer partition profile.",
      );
    const hidden = partition.hidden;
    const embedding = partition.vocabulary * hidden;
    const output = embedding + hidden;
    const perLayer = (model.parameter_count - embedding - output) / layers;
    if (!Number.isSafeInteger(perLayer))
      return reject(
        "The catalog does not have an exact layer partition for this artifact.",
      );
    try {
      const rows: z.infer<typeof DeviceEstimateSchema>[] = devices.map(
        (device, index) => {
          const weights =
            (perLayer * device.layers +
              (index === 0 ? embedding : 0) +
              (index === devices.length - 1 ? output : 0)) *
            precision;
          const kv = estimateKvBytes({
            groups: [{ ...model.attention_groups[0]!, layers: device.layers }],
            retained_tokens: input.workload.retained_tokens_per_sequence,
            concurrent_sequences: input.workload.concurrent_sequences,
            key_format: input.kv_cache.key_format,
            value_format: input.kv_cache.value_format,
          })!;
          const lower = sumBytes([
            weights,
            kv,
            device.runtime_overhead_bytes ?? 0,
            device.allocator_allowance_bytes ?? 0,
          ]);
          const required =
            device.runtime_overhead_bytes === null ||
            device.allocator_allowance_bytes === null
              ? null
              : lower;
          const budget =
            device.allocation_limit_bytes === null
              ? null
              : device.allocation_limit_bytes - device.reserve_bytes;
          return {
            id: device.id,
            model: device.model,
            layers: device.layers,
            weights_bytes: weights,
            kv_cache_bytes: kv,
            runtime_overhead_bytes: device.runtime_overhead_bytes,
            allocator_allowance_bytes: device.allocator_allowance_bytes,
            known_lower_bound_bytes: lower,
            required_bytes: required,
            usable_budget_bytes: budget,
            headroom_bytes:
              required === null || budget === null ? null : budget - required,
            assessment:
              budget !== null && lower > budget
                ? "estimated_over_budget"
                : budget !== null && required !== null
                  ? "estimated_within_budget"
                  : "unknown",
          };
        },
      );
      result.devices = rows;
      result.memory = {
        ...result.memory,
        weights_bytes: sumBytes(rows.map((d) => d.weights_bytes)),
        weights_lower_bound_bytes: sumBytes(rows.map((d) => d.weights_bytes)),
        kv_cache_bytes: sumBytes(rows.map((d) => d.kv_cache_bytes)),
        runtime_overhead_bytes: rows.every(
          (d) => d.runtime_overhead_bytes !== null,
        )
          ? sumBytes(rows.map((d) => d.runtime_overhead_bytes!))
          : null,
        allocator_allowance_bytes: rows.every(
          (d) => d.allocator_allowance_bytes !== null,
        )
          ? sumBytes(rows.map((d) => d.allocator_allowance_bytes!))
          : null,
        known_lower_bound_bytes: sumBytes(
          rows.map((d) => d.known_lower_bound_bytes),
        ),
        required_bytes: rows.every((d) => d.required_bytes !== null)
          ? sumBytes(rows.map((d) => d.required_bytes!))
          : null,
        usable_budget_bytes: null,
        headroom_bytes: null,
        pool_count: rows.length,
        assessment: rows.some((d) => d.assessment === "estimated_over_budget")
          ? "estimated_over_budget"
          : rows.every((d) => d.assessment === "estimated_within_budget")
            ? "estimated_within_budget"
            : "unknown",
      };
      result.issues = result.issues.filter(
        (i) =>
          ![
            "runtime_overhead_unknown",
            "allocator_allowance_unknown",
            "allocation_budget_unknown",
          ].includes(i.code),
      );
      if (
        rows.some(
          (d) => d.required_bytes === null || d.usable_budget_bytes === null,
        )
      )
        result.issues.push({
          code: "device_budget_incomplete",
          message:
            "Every device requires an explicit allocation limit, reserve, runtime overhead and allocator allowance.",
        });
      result.status = result.issues.length === 0 ? "calculated" : "incomplete";
      result.assumptions = result.assumptions.filter(
        (a) => !a.startsWith("All model weights"),
      );
      result.assumptions.push(
        "Contiguous transformer layers are resident on the listed devices. Input embeddings reside on the first device; the output head and final norm on the last. KV follows layer placement; inter-stage buffers and loading peaks must be covered by per-device allowances. No runtime support or interconnect speed is inferred.",
      );
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return reject(
        "The per-device request exceeds safe integer byte accounting.",
      );
    }
  }
  const performance = calibratedPerformance(input);
  if (performance && result.status !== "unsupported")
    result.performance = performance;
  return SizingResultSchema.parse(result);
}
