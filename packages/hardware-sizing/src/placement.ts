import type { SizingInput, SizingIssue } from "./schema.js";

/** Installed capacity is never multiplied into an implicit pooled allocation. */
export function placementProblem(input: SizingInput): SizingIssue | null {
  if (input.hardware.device_count !== 1)
    return {
      code: "multi_device_unsupported",
      message:
        "Multiple devices require a supported per-device placement profile; aggregate capacity cannot establish fit.",
    };
  const expected =
    input.hardware.kind === "unified_memory"
      ? "unified_pool"
      : input.hardware.kind === "cpu"
        ? "cpu_only"
        : "single_device";
  if (input.placement !== expected)
    return {
      code: "placement_unsupported",
      message: `This target supports only ${expected} in this estimator version. Offload and parallel placement need separate profiles.`,
    };
  return null;
}

export function usableBudgetBytes(input: SizingInput): number | null {
  const limit = input.hardware.allocation_limit_bytes;
  return limit === null ? null : limit - input.hardware.reserve_bytes;
}
