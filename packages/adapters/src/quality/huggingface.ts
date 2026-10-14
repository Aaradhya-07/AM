import { createHash } from "node:crypto";

import { z } from "zod/v4";

const ENTRY = z.object({
  rank: z.int().positive(),
  modelId: z.string().min(1),
  value: z.number().finite(),
  verified: z.boolean().optional(),
  lower_is_better: z.boolean().optional(),
  filename: z.string().optional(),
  notes: z.string().nullish(),
  source: z
    .object({
      url: z.url().optional(),
      name: z.string().optional(),
      isExternal: z.boolean().optional(),
    })
    .optional(),
});

const RESPONSE = z.array(ENTRY).max(10_000);
const BENCHMARK = z.object({
  id: z.string().min(1),
  lastModified: z.string().optional(),
  downloads: z.int().nonnegative().optional(),
});
const BENCHMARK_RESPONSE = z.array(BENCHMARK).max(100);
const MODEL_EVAL = z.object({
  filename: z.string().optional(),
  verified: z.boolean().optional(),
  data: z.object({
    dataset: z.object({
      id: z.string().min(1),
      task_id: z.string().optional(),
    }),
    value: z.number().finite(),
    date: z.string().optional(),
    source: z
      .object({ url: z.url().optional(), name: z.string().optional() })
      .optional(),
  }),
});
const MODEL_RESPONSE = z.object({
  id: z.string().min(1),
  evalResults: z.array(MODEL_EVAL).max(10_000).optional(),
});
const MAX_BYTES = 8 * 1024 * 1024;
const BENCHMARK_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export interface PublicBenchmarkResult {
  readonly rank: number;
  readonly model_id: string;
  readonly score: number;
  readonly verified: boolean | null;
  readonly lower_is_better: boolean | null;
  readonly source_url: string | null;
  readonly source_name: string | null;
  readonly result_file: string | null;
  readonly notes: string | null;
}

export interface PublicBenchmarkSnapshot {
  readonly format: "anvilmark-public-benchmark/1";
  readonly source: "huggingface-benchmark-leaderboard";
  readonly benchmark_id: string;
  readonly source_url: string;
  readonly fetched_at: string;
  readonly response_sha256: string;
  readonly etag: string | null;
  readonly results: readonly PublicBenchmarkResult[];
}

export interface PublicBenchmarkCatalog {
  readonly format: "anvilmark-benchmark-catalog/1";
  readonly source: "huggingface-official-benchmarks";
  readonly source_url: string;
  readonly fetched_at: string;
  readonly response_sha256: string;
  readonly benchmarks: readonly {
    readonly id: string;
    readonly last_modified: string | null;
  }[];
}

export interface PublicModelEvals {
  readonly format: "anvilmark-public-model-evals/1";
  readonly source: "huggingface-model-eval-results";
  readonly model_id: string;
  readonly source_url: string;
  readonly fetched_at: string;
  readonly response_sha256: string;
  readonly results: readonly {
    readonly benchmark_id: string;
    readonly task_id: string | null;
    readonly score: number;
    readonly evaluation_date: string | null;
    readonly verified: boolean | null;
    readonly source_url: string | null;
    readonly source_name: string | null;
    readonly result_file: string | null;
  }[];
}

export function huggingFaceLeaderboardUrl(benchmarkId: string): string {
  const parts = benchmarkId.split("/");
  if (
    !BENCHMARK_ID.test(benchmarkId) ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(
      "benchmark id must be a Hugging Face namespace/name such as SWE-bench/SWE-bench_Verified",
    );
  }
  const [namespace, name] = benchmarkId.split("/") as [string, string];
  return `https://huggingface.co/api/datasets/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/leaderboard`;
}

export function huggingFaceModelEvalsUrl(modelId: string): string {
  huggingFaceLeaderboardUrl(modelId);
  const [namespace, name] = modelId.split("/") as [string, string];
  return `https://huggingface.co/api/models/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}?expand=evalResults`;
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("benchmark API returned an empty response body");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("benchmark API response exceeded 8 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

type FetchOptions = {
  readonly fetcher?: typeof fetch;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
};

async function getBytes(
  url: string,
  options: FetchOptions,
): Promise<{
  readonly bytes: Uint8Array;
  readonly etag: string | null;
}> {
  const signal =
    options.signal === undefined
      ? AbortSignal.timeout(15_000)
      : AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]);
  const response = await (options.fetcher ?? fetch)(url, {
    method: "GET",
    redirect: "error",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`benchmark API returned HTTP ${response.status}`);
  }
  return {
    bytes: await readBounded(response),
    etag: response.headers.get("etag"),
  };
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("benchmark API returned invalid JSON");
  }
}

/** Fetch public submitted benchmark scores; never equate them with a project's measured quality gate. */
export async function fetchHuggingFaceLeaderboard(
  benchmarkId: string,
  options: FetchOptions = {},
): Promise<PublicBenchmarkSnapshot> {
  const sourceUrl = huggingFaceLeaderboardUrl(benchmarkId);
  const { bytes, etag } = await getBytes(sourceUrl, options);
  const rows = RESPONSE.safeParse(parseJson(bytes));
  if (!rows.success) {
    throw new Error(
      "benchmark API response did not match the expected score format",
    );
  }
  return {
    format: "anvilmark-public-benchmark/1",
    source: "huggingface-benchmark-leaderboard",
    benchmark_id: benchmarkId,
    source_url: sourceUrl,
    fetched_at: (options.now ?? (() => new Date().toISOString()))(),
    response_sha256: createHash("sha256").update(bytes).digest("hex"),
    etag,
    results: rows.data.map((row) => ({
      rank: row.rank,
      model_id: row.modelId,
      score: row.value,
      verified: row.verified ?? null,
      lower_is_better: row.lower_is_better ?? null,
      source_url: row.source?.url ?? null,
      source_name: row.source?.name ?? null,
      result_file: row.filename ?? null,
      notes: row.notes ?? null,
    })),
  };
}

/** Discover benchmark datasets that Hugging Face labels official. */
export async function fetchHuggingFaceBenchmarks(
  options: FetchOptions = {},
): Promise<PublicBenchmarkCatalog> {
  const sourceUrl =
    "https://huggingface.co/api/datasets?filter=benchmark:official";
  const hash = createHash("sha256");
  const benchmarks: { id: string; last_modified: string | null }[] = [];
  for (let skip = 0; skip < 1_000; skip += 100) {
    const { bytes } = await getBytes(
      `${sourceUrl}&limit=100&skip=${skip}`,
      options,
    );
    hash.update(bytes).update("\0");
    const page = BENCHMARK_RESPONSE.safeParse(parseJson(bytes));
    if (!page.success) {
      throw new Error("benchmark catalog did not match the expected format");
    }
    benchmarks.push(
      ...page.data.map((entry) => ({
        id: entry.id,
        last_modified: entry.lastModified ?? null,
      })),
    );
    if (page.data.length < 100) {
      return {
        format: "anvilmark-benchmark-catalog/1",
        source: "huggingface-official-benchmarks",
        source_url: sourceUrl,
        fetched_at: (options.now ?? (() => new Date().toISOString()))(),
        response_sha256: hash.digest("hex"),
        benchmarks,
      };
    }
  }
  throw new Error("benchmark catalog exceeded the 1,000-dataset safety limit");
}

/** Get scores published on a model's Hub page, across benchmark datasets. */
export async function fetchHuggingFaceModelEvals(
  modelId: string,
  options: FetchOptions = {},
): Promise<PublicModelEvals> {
  const sourceUrl = huggingFaceModelEvalsUrl(modelId);
  const { bytes } = await getBytes(sourceUrl, options);
  const model = MODEL_RESPONSE.safeParse(parseJson(bytes));
  if (!model.success || model.data.id !== modelId) {
    throw new Error(
      "model evaluation response did not match the requested model",
    );
  }
  return {
    format: "anvilmark-public-model-evals/1",
    source: "huggingface-model-eval-results",
    model_id: modelId,
    source_url: sourceUrl,
    fetched_at: (options.now ?? (() => new Date().toISOString()))(),
    response_sha256: createHash("sha256").update(bytes).digest("hex"),
    results: (model.data.evalResults ?? []).map((entry) => ({
      benchmark_id: entry.data.dataset.id,
      task_id: entry.data.dataset.task_id ?? null,
      score: entry.data.value,
      evaluation_date: entry.data.date ?? null,
      verified: entry.verified ?? null,
      source_url: entry.data.source?.url ?? null,
      source_name: entry.data.source?.name ?? null,
      result_file: entry.filename ?? null,
    })),
  };
}
