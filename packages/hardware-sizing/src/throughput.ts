import type { SizingResult } from "./schema.js";

/** No calibration profile is shipped yet. Published bandwidth is not a benchmark. */
export function unverifiedPerformance(): SizingResult["performance"] {
  return {
    status: "unverified",
    estimated_decode_tokens_per_second: null,
    reason:
      "No calibrated runtime/device profile is available. Latency and throughput require applicable measurements; memory sizing cannot settle a performance gate.",
  };
}
