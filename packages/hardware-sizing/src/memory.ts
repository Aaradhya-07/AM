import { z } from "zod/v4";
import type { AttentionGroup, ModelProfile } from "./schema.js";
import {
  AttentionGroupSchema,
  BytesSchema,
  WeightStorageSchema,
} from "./schema.js";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** All products use integers; no intermediate IEEE-754 rounding or overflow. */
export function safeBytes(value: bigint): number {
  if (value < 0n || value > MAX_SAFE)
    throw new RangeError("Memory calculation exceeds the safe byte range");
  return Number(value);
}

export function sumBytes(values: readonly number[]): number {
  return safeBytes(
    values.reduce((sum, value) => sum + BigInt(BytesSchema.parse(value)), 0n),
  );
}

export function floatBytes(format: string): number | null {
  if (format === "fp16" || format === "bf16") return 2;
  if (format === "fp32") return 4;
  return null;
}

const KvRequestSchema = z.strictObject({
  groups: z.array(AttentionGroupSchema).min(1).max(1024),
  retained_tokens: z.number().int().positive().max(16_777_216),
  concurrent_sequences: z.number().int().positive().max(1024),
  key_format: z.string().min(1).max(256),
  value_format: z.string().min(1).max(256),
});

/** Unquantized, independent sequence caches with an explicit per-layer retention policy. */
export function estimateKvBytes(request: {
  readonly groups: readonly AttentionGroup[];
  readonly retained_tokens: number;
  readonly concurrent_sequences: number;
  readonly key_format: string;
  readonly value_format: string;
}): number | null {
  const input = KvRequestSchema.parse(request);
  const keyBytes = floatBytes(input.key_format);
  const valueBytes = floatBytes(input.value_format);
  if (keyBytes === null || valueBytes === null) return null;
  let total = 0n;
  for (const group of input.groups) {
    const tokens = Math.min(
      input.retained_tokens,
      group.window_tokens ?? input.retained_tokens,
    );
    total +=
      BigInt(group.layers) *
      BigInt(group.kv_heads) *
      BigInt(tokens) *
      BigInt(input.concurrent_sequences) *
      (BigInt(group.key_head_dimension) * BigInt(keyBytes) +
        BigInt(group.value_head_dimension) * BigInt(valueBytes));
  }
  return safeBytes(total);
}

export interface WeightEstimate {
  readonly bytes: number | null;
  readonly lower_bound_bytes: number | null;
  readonly hypothetical: boolean;
}

/** Integer formats describe nominal packing, not a specific GGUF/AWQ/GPTQ artifact. */
export function estimateWeightBytes(
  model: Pick<ModelProfile, "parameter_count">,
  storage: unknown,
): WeightEstimate {
  const parameters = BigInt(
    z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(model.parameter_count),
  );
  const parsed = WeightStorageSchema.parse(storage);
  const scalarBytes = floatBytes(parsed.format);
  if (scalarBytes !== null) {
    const bytes = safeBytes(parameters * BigInt(scalarBytes));
    return { bytes, lower_bound_bytes: bytes, hypothetical: false };
  }
  const bits =
    parsed.format === "nominal_int8"
      ? 8n
      : parsed.format === "nominal_int4"
        ? 4n
        : null;
  if (bits === null)
    return { bytes: null, lower_bound_bytes: null, hypothetical: false };
  const payload = safeBytes((parameters * bits + 7n) / 8n);
  return {
    bytes:
      parsed.metadata_bytes === null
        ? null
        : sumBytes([payload, parsed.metadata_bytes]),
    lower_bound_bytes: payload,
    hypothetical: true,
  };
}
