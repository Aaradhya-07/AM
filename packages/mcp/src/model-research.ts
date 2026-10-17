import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import {
  fetchHuggingFaceModelEvals,
  huggingFaceModelEvalsUrl,
} from "@anvilmark/adapters";
import { loadProject } from "@anvilmark/cli";
import { assertProjectionSafe, sourceMarker } from "@anvilmark/context";
import type { ProjectionName } from "@anvilmark/context";
import {
  huggingFaceModelEvalsSourceKey,
  openModelCatalog,
} from "@anvilmark/model-catalog";
import type { StoredSnapshot } from "@anvilmark/model-catalog";
import type { Candidate, ProjectContract } from "@anvilmark/project-contract";
import { z } from "zod/v4";

export const ResearchCandidateModelInputSchema = z.strictObject({
  candidate_ref: z.string().min(1).max(200),
});

type ResearchContext = {
  readonly clock: () => string;
  readonly projection: ProjectionName;
  readonly asOf?: string;
};

const MAX_RESULTS = 20;

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

async function catalogPath(root: string): Promise<string> {
  const actualRoot = await realpath(root);
  const path = join(actualRoot, ".anvilmark", "model-catalog.sqlite");
  const directory = await realpath(dirname(path));
  if (!inside(actualRoot, directory))
    throw new Error(
      "The model catalog directory resolves outside the project.",
    );
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info?.isSymbolicLink())
    throw new Error("The model catalog must not be a symbolic link.");
  if (info !== null && !info.isFile())
    throw new Error("The model catalog path is not a regular file.");
  return path;
}

function exactModelId(candidate: Candidate): string | null {
  const id = candidate.model?.family ?? null;
  if (id === null) return null;
  try {
    huggingFaceModelEvalsUrl(id);
    return id;
  } catch {
    return null;
  }
}

function publishedRows(stored: StoredSnapshot) {
  if (stored.snapshot.source !== "huggingface-model-eval-results")
    throw new Error("The saved model snapshot has the wrong source type.");
  return {
    status: stored.freshness,
    source: "huggingface-model-eval-results" as const,
    model_id: stored.snapshot.model_id,
    source_url: stored.source_url,
    fetched_at: stored.fetched_at,
    response_sha256: stored.response_sha256,
    snapshot_id: stored.id,
    result_count: stored.snapshot.results.length,
    results: stored.snapshot.results.slice(0, MAX_RESULTS).map((row) => ({
      benchmark_id: row.benchmark_id,
      task_id: row.task_id,
      score: row.score,
      score_direction: "unknown" as const,
      verified: row.verified,
      evaluation_date: row.evaluation_date,
      source_url: row.source_url,
    })),
    truncated: stored.snapshot.results.length > MAX_RESULTS,
    workload_quality: "unknown" as const,
  };
}

export async function cachedCandidateResearch(
  root: string,
  contract: ProjectContract,
  candidates: readonly Candidate[],
  asOf: string,
  projection: ProjectionName,
) {
  const path = await catalogPath(root);
  const exists = await lstat(path).then(
    () => true,
    () => false,
  );
  const catalog = exists ? await openModelCatalog(path) : null;
  try {
    const result = candidates.map((candidate) => {
      const modelId = exactModelId(candidate);
      if (modelId === null)
        return {
          candidate_ref: candidate.id,
          status: "unmapped" as const,
          reason:
            "Candidate model family is not an exact Hugging Face namespace/name ID.",
        };
      const stored = catalog?.getLatest(
        huggingFaceModelEvalsSourceKey(modelId),
        { now: new Date(asOf) },
      );
      return stored === null || stored === undefined
        ? {
            candidate_ref: candidate.id,
            model_id: modelId,
            status: "missing" as const,
            reason:
              "No saved public evaluation snapshot for this exact model ID.",
          }
        : { candidate_ref: candidate.id, ...publishedRows(stored) };
    });
    assertProjectionSafe(contract, result, projection);
    return result;
  } finally {
    catalog?.close();
  }
}

export async function researchCandidateModel(
  root: string,
  raw: unknown,
  options: ResearchContext & { readonly fetcher?: typeof fetch },
) {
  const input = ResearchCandidateModelInputSchema.parse(raw);
  const loaded = await loadProject(root);
  const candidate = loaded.contract.candidates.find(
    (entry) => entry.id === input.candidate_ref,
  );
  if (candidate === undefined) throw new Error("The candidate does not exist.");
  const modelId = exactModelId(candidate);
  if (modelId === null)
    throw new Error("The candidate needs an exact Hugging Face model ID.");
  const path = await catalogPath(root);
  const snapshot = await fetchHuggingFaceModelEvals(modelId, {
    now: () => new Date(options.clock()).toISOString(),
    ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
  });
  if (snapshot.model_id !== modelId)
    throw new Error("The source returned a different model identity.");
  const asOf = options.asOf ?? options.clock();
  assertProjectionSafe(
    loaded.contract,
    {
      candidate_ref: candidate.id,
      model_id: snapshot.model_id,
      source_url: snapshot.source_url,
      fetched_at: snapshot.fetched_at,
      response_sha256: snapshot.response_sha256,
      results: snapshot.results.slice(0, MAX_RESULTS).map((row) => ({
        benchmark_id: row.benchmark_id,
        task_id: row.task_id,
        score: row.score,
        score_direction: "unknown" as const,
        verified: row.verified,
        evaluation_date: row.evaluation_date,
        source_url: row.source_url,
      })),
    },
    options.projection,
  );
  const catalog = await openModelCatalog(path);
  try {
    const stored = catalog.storeSnapshot(snapshot);
    const result = {
      ok: true as const,
      tool: "research_candidate_model" as const,
      source: sourceMarker(loaded.contract, {
        asOf,
        projection: options.projection,
        stateRevision: loaded.head?.revision ?? null,
      }),
      data: {
        candidate_ref: candidate.id,
        ...publishedRows(stored),
        note: "These are published evaluations for an exact source-scoped model ID. They do not measure this project's workload or clear its quality gate.",
      },
    };
    assertProjectionSafe(loaded.contract, result, options.projection);
    return result;
  } finally {
    catalog.close();
  }
}
