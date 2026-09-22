import { estimateExtendedModelFit } from "./advanced.js";
import { findModelProfile } from "./catalog.js";
import { estimateKvBytes, estimateWeightBytes, sumBytes } from "./memory.js";
import { placementProblem, usableBudgetBytes } from "./placement.js";
import type { SizingIssue, SizingResult } from "./schema.js";
import {
  CATALOG_VERSION,
  ESTIMATOR_VERSION,
  SizingInputSchema,
  SizingResultSchema,
} from "./schema.js";
import { unverifiedPerformance } from "./throughput.js";

/** Pure calculation. Input is cloned by validation; no clock, I/O, or contract mutation. */
function estimateBaseModelFit(value: unknown): SizingResult {
  const input = SizingInputSchema.parse(value);
  const issues: SizingIssue[] = [];
  const model =
    input.catalog_version === CATALOG_VERSION
      ? findModelProfile(input.model.id, input.model.revision)
      : null;
  const result: SizingResult = {
    estimator_version: ESTIMATOR_VERSION,
    catalog_version: CATALOG_VERSION,
    status: "incomplete",
    model_profile: model,
    memory: {
      weights_bytes: null,
      weights_lower_bound_bytes: null,
      kv_cache_bytes: null,
      runtime_overhead_bytes: input.runtime.overhead_bytes,
      allocator_allowance_bytes: input.runtime.allocator_allowance_bytes,
      known_lower_bound_bytes: 0,
      required_bytes: null,
      usable_budget_bytes: usableBudgetBytes(input),
      headroom_bytes: null,
      assessment: "unknown",
      pool_count: 1,
      unit: "bytes",
    },
    runtime_compatibility: "unknown",
    contract_evidence: "unattached",
    performance: unverifiedPerformance(),
    assumptions: [
      "This is a planning estimate against user-declared capacity and allocation assumptions, not an observation of usable hardware.",
      "All model weights are resident in one selected pool. Each concurrent sequence has an independent KV cache; retained context includes generated tokens.",
      "Runtime and allocator budgets, if supplied, are user assumptions covering peak loading, prefill, and decode allocations for the selected workload.",
    ],
    exclusions: [
      "No runtime/backend compatibility or performance measurement is established.",
      "No automatic allocation, device reservation, offload, quantization change, context reduction, or contract attachment is performed.",
      "Beam expansion, prefix sharing, speculative decoding, multimodal caches, and quantized KV require separate profiles.",
    ],
    issues,
  };
  const unsupported = placementProblem(input);
  if (model === null)
    issues.push({
      code: "model_profile_unavailable",
      message:
        "The exact catalog version, model id, and immutable revision must match a supported profile.",
    });
  if (unsupported !== null) issues.push(unsupported);
  if (
    model !== null &&
    input.workload.retained_tokens_per_sequence > model.max_context_tokens
  ) {
    issues.push({
      code: "context_unsupported",
      message: `The pinned profile supports at most ${model.max_context_tokens} retained tokens per sequence. No context extension or reduction is inferred.`,
    });
  }
  if (issues.length > 0 || model === null) {
    result.status = "unsupported";
    // Placement is not implemented, so no pool total can describe this request.
    result.memory.runtime_overhead_bytes = null;
    result.memory.allocator_allowance_bytes = null;
    return SizingResultSchema.parse(result);
  }
  try {
    const weights = estimateWeightBytes(model, input.weights);
    result.memory.weights_bytes = weights.bytes;
    result.memory.weights_lower_bound_bytes = weights.lower_bound_bytes;
    result.memory.kv_cache_bytes = estimateKvBytes({
      groups: model.attention_groups,
      retained_tokens: input.workload.retained_tokens_per_sequence,
      concurrent_sequences: input.workload.concurrent_sequences,
      key_format: input.kv_cache.key_format,
      value_format: input.kv_cache.value_format,
    });
    if (weights.lower_bound_bytes === null) {
      issues.push({
        code: "weight_format_unsupported",
        message:
          "This weight format has no validated storage profile. GGUF, AWQ, GPTQ, and FP8 are not inferred from nominal bit width.",
      });
      result.status = "unsupported";
    } else if (weights.bytes === null) {
      issues.push({
        code: "weight_metadata_unknown",
        message:
          "Nominal integer payload excludes quantization metadata, mixed precision, and padding. Supply an explicit planning allowance to estimate the total.",
      });
    }
    if (weights.hypothetical)
      result.assumptions.push(
        "Nominal integer storage is hypothetical packing plus the stated metadata allowance; no corresponding quantized artifact or runtime support is asserted.",
      );
    if (result.memory.kv_cache_bytes === null) {
      issues.push({
        code: "kv_format_unsupported",
        message:
          "Only FP16, BF16, and FP32 key/value caches are supported. Quantized caches need block/scaling metadata and runtime support.",
      });
      result.status = "unsupported";
    }
    if (input.runtime.overhead_bytes === null)
      issues.push({
        code: "runtime_overhead_unknown",
        message: "Runtime/activation/loading overhead has not been budgeted.",
      });
    if (input.runtime.allocator_allowance_bytes === null)
      issues.push({
        code: "allocator_allowance_unknown",
        message: "Allocator/workspace allowance has not been budgeted.",
      });
    if (result.memory.usable_budget_bytes === null)
      issues.push({
        code: "allocation_budget_unknown",
        message:
          "Installed capacity is declared, but no allocation limit has been explicitly selected.",
      });

    const components = [
      weights.bytes,
      result.memory.kv_cache_bytes,
      input.runtime.overhead_bytes,
      input.runtime.allocator_allowance_bytes,
    ];
    result.memory.known_lower_bound_bytes = sumBytes([
      weights.bytes ?? weights.lower_bound_bytes ?? 0,
      result.memory.kv_cache_bytes ?? 0,
      input.runtime.overhead_bytes ?? 0,
      input.runtime.allocator_allowance_bytes ?? 0,
    ]);
    if (components.every((component) => component !== null))
      result.memory.required_bytes = sumBytes(components as number[]);
    const budget = result.memory.usable_budget_bytes;
    const required = result.memory.required_bytes;
    if (result.status !== "unsupported") {
      if (budget !== null && result.memory.known_lower_bound_bytes > budget)
        result.memory.assessment = "estimated_over_budget";
      else if (budget !== null && required !== null)
        result.memory.assessment = "estimated_within_budget";
      if (budget !== null && required !== null)
        result.memory.headroom_bytes = budget - required;
      result.status = issues.length === 0 ? "calculated" : "incomplete";
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    result.status = "unsupported";
    result.memory.required_bytes = null;
    result.memory.headroom_bytes = null;
    result.memory.assessment = "unknown";
    issues.push({
      code: "numeric_range_exceeded",
      message:
        "The requested configuration exceeds safely representable byte totals; no rounded capacity claim is returned.",
    });
  }
  return SizingResultSchema.parse(result);
}

export function estimateModelFit(value: unknown): SizingResult {
  const input = SizingInputSchema.parse(value);
  return input.extensions
    ? estimateExtendedModelFit(input, estimateBaseModelFit)
    : estimateBaseModelFit(input);
}
