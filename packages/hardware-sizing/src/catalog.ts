import type { ModelProfile, SizingInput } from "./schema.js";
import {
  CATALOG_VERSION,
  ModelProfileSchema,
  SizingInputSchema,
} from "./schema.js";

const qwenRevision = "c03e6d358207e414f1eca0bb1891e29f1db0e242";
const mixtralRevision = "eba92302a2861cdc0098cc54bc9f17cb2c47eb61";

function publisherFile(id: string, revision: string, file: string): string {
  return `https://huggingface.co/${id}/blob/${revision}/${file}`;
}

const profiles: readonly ModelProfile[] = [
  ModelProfileSchema.parse({
    id: "Qwen/Qwen2.5-Coder-7B-Instruct",
    revision: qwenRevision,
    label: "Qwen2.5-Coder 7B Instruct",
    architecture: "dense_gqa",
    parameter_count: 7_615_616_512,
    active_parameter_count: 7_615_616_512,
    max_context_tokens: 32_768,
    attention_groups: [
      {
        layers: 28,
        kv_heads: 4,
        key_head_dimension: 128,
        value_head_dimension: 128,
        window_tokens: null,
      },
    ],
    publisher_config_url: publisherFile(
      "Qwen/Qwen2.5-Coder-7B-Instruct",
      qwenRevision,
      "config.json",
    ),
    publisher_index_url: publisherFile(
      "Qwen/Qwen2.5-Coder-7B-Instruct",
      qwenRevision,
      "model.safetensors.index.json",
    ),
    parameter_count_basis:
      "Publisher BF16 tensor index reports 15,231,233,024 bytes; dividing by two agrees with a parameter count derived from the pinned Qwen2 configuration.",
    license_url: publisherFile(
      "Qwen/Qwen2.5-Coder-7B-Instruct",
      qwenRevision,
      "LICENSE",
    ),
  }),
  ModelProfileSchema.parse({
    id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
    revision: mixtralRevision,
    label: "Mixtral 8x7B Instruct v0.1",
    architecture: "moe_gqa",
    parameter_count: 46_702_792_704,
    active_parameter_count: 12_879_925_248,
    max_context_tokens: 32_768,
    attention_groups: [
      {
        layers: 32,
        kv_heads: 8,
        key_head_dimension: 128,
        value_head_dimension: 128,
        window_tokens: null,
      },
    ],
    publisher_config_url: publisherFile(
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      mixtralRevision,
      "config.json",
    ),
    publisher_index_url: publisherFile(
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      mixtralRevision,
      "model.safetensors.index.json",
    ),
    parameter_count_basis:
      "Publisher BF16 tensor index reports 93,405,585,408 bytes. All eight experts remain resident; the active count includes shared parameters plus two feedforward experts per layer.",
    license_url: publisherFile(
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      mixtralRevision,
      "README.md",
    ),
  }),
];

/** Copies prevent a caller or a UI edit from changing the pinned catalog. */
export function listModelProfiles(): ModelProfile[] {
  return profiles.map((profile) => ModelProfileSchema.parse(profile));
}

export function findModelProfile(
  id: string,
  revision: string,
): ModelProfile | null {
  const profile = profiles.find(
    (entry) => entry.id === id && entry.revision === revision,
  );
  return profile === undefined ? null : ModelProfileSchema.parse(profile);
}

/** A declared planning example. No budget, runtime overhead, or performance is guessed. */
export function createPlanningInput(
  modelId = "Qwen/Qwen2.5-Coder-7B-Instruct",
): SizingInput {
  const model = profiles.find((entry) => entry.id === modelId);
  if (model === undefined) throw new Error(`Unknown catalog model: ${modelId}`);
  return SizingInputSchema.parse({
    catalog_version: CATALOG_VERSION,
    model: { id: model.id, revision: model.revision },
    weights: { format: "bf16", metadata_bytes: null },
    kv_cache: { key_format: "fp16", value_format: "fp16" },
    workload: { retained_tokens_per_sequence: 4096, concurrent_sequences: 1 },
    hardware: {
      label: "Declared 24 GiB GPU",
      kind: "discrete_gpu",
      backend: "cuda",
      evidence_kind: "user_declared",
      capacity_bytes: 24 * 2 ** 30,
      allocation_limit_bytes: null,
      reserve_bytes: 0,
      device_count: 1,
    },
    placement: "single_device",
    runtime: {
      name: null,
      version: null,
      basis: "user_assumption",
      overhead_bytes: null,
      allocator_allowance_bytes: null,
    },
    project_binding: null,
  });
}
