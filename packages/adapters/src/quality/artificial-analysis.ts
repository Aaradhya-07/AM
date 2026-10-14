import { createHash } from "node:crypto";

import { z } from "zod/v4";

const SOURCE_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
const ATTRIBUTION_URL = "https://artificialanalysis.ai/";
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_PAGES = 20;
const INDEX_KEYS = [
  "artificial_analysis_intelligence_index",
  "artificial_analysis_coding_index",
  "artificial_analysis_agentic_index",
  "artificial_analysis_finance_and_accounting_index",
  "artificial_analysis_strategy_and_ops_index",
  "artificial_analysis_legal_index",
  "artificial_analysis_healthcare_and_medical_index",
  "artificial_analysis_engineering_index",
  "artificial_analysis_economics_index",
] as const;

const optionalNumber = z.number().finite().nullish();
const MODEL = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  release_date: z.string().nullish(),
  model_creator: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  evaluations: z.object({
    artificial_analysis_intelligence_index: optionalNumber,
    artificial_analysis_coding_index: optionalNumber,
    artificial_analysis_agentic_index: optionalNumber,
    artificial_analysis_finance_and_accounting_index: optionalNumber,
    artificial_analysis_strategy_and_ops_index: optionalNumber,
    artificial_analysis_legal_index: optionalNumber,
    artificial_analysis_healthcare_and_medical_index: optionalNumber,
    artificial_analysis_engineering_index: optionalNumber,
    artificial_analysis_economics_index: optionalNumber,
  }),
  pricing: z.object({
    price_1m_input_tokens: optionalNumber,
    price_1m_output_tokens: optionalNumber,
  }),
  performance: z.object({
    median_output_tokens_per_second: optionalNumber,
    median_time_to_first_token_seconds: optionalNumber,
    median_time_to_first_answer_token_seconds: optionalNumber,
    median_end_to_end_response_time_seconds: optionalNumber,
  }),
});

const PAGE = z.object({
  tier: z.enum(["free", "pro", "commercial"]),
  intelligence_index_version: z.number().finite(),
  pagination: z.object({
    page: z.int().positive(),
    page_size: z.int().positive(),
    total_pages: z.int().nonnegative(),
    has_more: z.boolean(),
  }),
  data: z.array(MODEL).max(10_000),
});

export interface ArtificialAnalysisModel {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly creator_id: string;
  readonly creator_name: string;
  readonly release_date: string | null;
  /** Composite indices, not measurements of the user's workload. Null means unavailable. */
  readonly indices: Readonly<Record<string, number | null>>;
  /** USD per million tokens as returned by the source; null means unavailable. */
  readonly price_1m_input_tokens: number | null;
  readonly price_1m_output_tokens: number | null;
  readonly median_output_tokens_per_second: number | null;
  readonly median_time_to_first_token_seconds: number | null;
  readonly median_time_to_first_answer_token_seconds: number | null;
  readonly median_end_to_end_response_time_seconds: number | null;
}

export interface ArtificialAnalysisCatalog {
  readonly format: "anvilmark-model-catalog/1";
  readonly source: "artificial-analysis-language-models-free";
  readonly source_url: string;
  readonly attribution: "Artificial Analysis";
  readonly attribution_url: string;
  /** Free API data is for internal use with attribution; external redistribution needs a separate license. */
  readonly usage_rights: "internal-use-with-attribution";
  readonly fetched_at: string;
  readonly response_sha256: string;
  readonly intelligence_index_version: number;
  readonly tier: "free" | "pro" | "commercial";
  readonly pages_fetched: number;
  readonly rate_limit_remaining: number | null;
  readonly models: readonly ArtificialAnalysisModel[];
}

type FetchOptions = {
  readonly fetcher?: typeof fetch;
  readonly now?: () => string;
  readonly signal?: AbortSignal;
};

async function readBounded(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined)
    throw new Error("Artificial Analysis returned an empty body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new Error("Artificial Analysis response exceeded 8 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parsedJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Artificial Analysis returned invalid JSON");
  }
}

function toModel(row: z.infer<typeof MODEL>): ArtificialAnalysisModel {
  const indices: Record<string, number | null> = {};
  for (const key of INDEX_KEYS) {
    indices[key] = row.evaluations[key] ?? null;
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    creator_id: row.model_creator.id,
    creator_name: row.model_creator.name,
    release_date: row.release_date ?? null,
    indices,
    price_1m_input_tokens: row.pricing.price_1m_input_tokens ?? null,
    price_1m_output_tokens: row.pricing.price_1m_output_tokens ?? null,
    median_output_tokens_per_second:
      row.performance.median_output_tokens_per_second ?? null,
    median_time_to_first_token_seconds:
      row.performance.median_time_to_first_token_seconds ?? null,
    median_time_to_first_answer_token_seconds:
      row.performance.median_time_to_first_answer_token_seconds ?? null,
    median_end_to_end_response_time_seconds:
      row.performance.median_end_to_end_response_time_seconds ?? null,
  };
}

/** Fetch the complete Free-shape catalog. Requires a server-side Artificial Analysis API key. */
export async function fetchArtificialAnalysisCatalog(
  apiKey: string,
  options: FetchOptions = {},
): Promise<ArtificialAnalysisCatalog> {
  if (apiKey.trim() === "") {
    throw new Error("ARTIFICIAL_ANALYSIS_API_KEY is required for this catalog");
  }
  const hash = createHash("sha256");
  const models: ArtificialAnalysisModel[] = [];
  const slugs = new Set<string>();
  let indexVersion: number | null = null;
  let tier: ArtificialAnalysisCatalog["tier"] | null = null;
  let rateLimitRemaining: number | null = null;
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const signal =
      options.signal === undefined
        ? AbortSignal.timeout(15_000)
        : AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]);
    const response = await (options.fetcher ?? fetch)(
      `${SOURCE_URL}?page=${pageNumber}`,
      {
        method: "GET",
        redirect: "error",
        headers: { Accept: "application/json", "x-api-key": apiKey },
        signal,
      },
    );
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      throw new Error(
        `Artificial Analysis API returned HTTP ${response.status}${response.status === 429 && retryAfter ? `; retry after ${retryAfter} seconds` : ""}`,
      );
    }
    const bytes = await readBounded(response);
    hash.update(bytes).update("\0");
    const parsed = PAGE.safeParse(parsedJson(bytes));
    if (!parsed.success) {
      throw new Error(
        "Artificial Analysis API response did not match the documented Free catalog shape",
      );
    }
    const body = parsed.data;
    if (body.pagination.page !== pageNumber) {
      throw new Error(
        "Artificial Analysis API returned an unexpected page number",
      );
    }
    if (
      indexVersion !== null &&
      indexVersion !== body.intelligence_index_version
    ) {
      throw new Error(
        "Artificial Analysis index version changed during pagination",
      );
    }
    indexVersion = body.intelligence_index_version;
    if (tier !== null && tier !== body.tier) {
      throw new Error("Artificial Analysis tier changed during pagination");
    }
    tier = body.tier;
    const remainingHeader = response.headers.get("x-ratelimit-remaining");
    if (remainingHeader !== null && /^\d+$/.test(remainingHeader)) {
      rateLimitRemaining = Number(remainingHeader);
    }
    for (const row of body.data) {
      if (slugs.has(row.slug)) {
        throw new Error(
          `Artificial Analysis returned duplicate model slug ${row.slug}`,
        );
      }
      slugs.add(row.slug);
      models.push(toModel(row));
    }
    if (!body.pagination.has_more) {
      if (body.pagination.total_pages > pageNumber) {
        throw new Error(
          "Artificial Analysis pagination contradicted total_pages",
        );
      }
      return {
        format: "anvilmark-model-catalog/1",
        source: "artificial-analysis-language-models-free",
        source_url: SOURCE_URL,
        attribution: "Artificial Analysis",
        attribution_url: ATTRIBUTION_URL,
        usage_rights: "internal-use-with-attribution",
        fetched_at: (options.now ?? (() => new Date().toISOString()))(),
        response_sha256: hash.digest("hex"),
        intelligence_index_version: indexVersion,
        tier,
        pages_fetched: pageNumber,
        rate_limit_remaining: rateLimitRemaining,
        models,
      };
    }
    if (body.pagination.total_pages <= pageNumber) {
      throw new Error("Artificial Analysis pagination contradicted has_more");
    }
  }
  throw new Error(
    `Artificial Analysis catalog exceeded the ${MAX_PAGES}-page safety limit`,
  );
}
