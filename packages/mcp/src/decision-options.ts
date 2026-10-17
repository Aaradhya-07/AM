import { randomUUID } from "node:crypto";

import { ProposedCandidateSchema } from "@anvilmark/adapters";
import {
  applyProposal,
  commitRevision,
  compareAlternatives,
  loadProject,
  pathsFor,
} from "@anvilmark/cli";
import {
  assertProjectionSafe,
  decisionStanding,
  sourceMarker,
} from "@anvilmark/context";
import type { ProjectionName } from "@anvilmark/context";
import {
  ComponentKindSchema,
  IdSchema,
  findSecrets,
} from "@anvilmark/project-contract";
import { z } from "zod/v4";

import { cachedCandidateResearch } from "./model-research.js";

export const ProposeDecisionOptionsInputSchema = z.strictObject({
  candidates: z
    .array(
      ProposedCandidateSchema.extend({
        id: IdSchema,
        workload_ref: IdSchema.nullable().default(null),
        component_kind: ComponentKindSchema,
        model_family: z.string().min(1).max(256).nullable().default(null),
        model_version: z.string().min(1).max(256).nullable().default(null),
        provider: z.string().min(1).max(256).nullable().default(null),
        rationale: z.string().min(1).max(1000).nullable().default(null),
      }),
    )
    .min(1)
    .max(20),
  questions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
});

export const CompareDecisionOptionsInputSchema = z.strictObject({
  workload: z.string().min(1).optional(),
});

interface OptionContext {
  readonly clock: () => string;
  readonly projection: ProjectionName;
}

export async function proposeDecisionOptions(
  root: string,
  raw: unknown,
  options: OptionContext,
) {
  const input = ProposeDecisionOptionsInputSchema.parse(raw);
  if (findSecrets(input).length > 0)
    throw new Error("The submitted options contain a secret-shaped value.");
  const loaded = await loadProject(root);
  const now = options.clock();
  const proposalId = `mcp-${randomUUID()}`;
  const applied = applyProposal(
    loaded.contract,
    {
      protocol_version: "0.1.0-draft.1",
      proposed_constraints: [],
      proposed_candidates: input.candidates,
      questions: input.questions,
      inferences: [],
      rationale: {
        summary: "Agent suggested options for comparison",
        generated_by: "mcp-agent",
      },
    },
    {
      proposalId,
      adapterId: "mcp-agent",
      receivedAt: now,
      sourceType: "api",
    },
  );
  if (!applied.ok)
    throw new Error(
      applied.problems.map((problem) => problem.message).join("; "),
    );
  if (
    loaded.contract.decisions.some(
      (decision) =>
        decisionStanding(loaded.contract, decision) !==
        decisionStanding(applied.value.contract, decision),
    )
  )
    throw new Error("The proposal would change a signed decision standing.");
  assertProjectionSafe(
    applied.value.contract,
    {
      source: sourceMarker(applied.value.contract, {
        asOf: now,
        projection: options.projection,
      }),
      candidates_added: applied.value.added.candidates,
      questions_added: applied.value.added.questions,
    },
    options.projection,
  );
  const committed = await commitRevision({
    paths: pathsFor(root),
    expectedDigest: loaded.digest,
    contract: applied.value.contract,
    command: "mcp propose decision options",
    summary: `recorded ${applied.value.added.candidates.length} agent-suggested options`,
    provenance: {
      kind: "agent_candidate_proposal",
      proposal_id: proposalId,
      candidate_refs: applied.value.added.candidates,
      generated_rationale: applied.value.generated_rationale,
    },
    clock: options.clock,
  });
  const result = {
    ok: true as const,
    tool: "propose_decision_options" as const,
    source: sourceMarker(committed.contract, {
      asOf: now,
      projection: options.projection,
      stateRevision: committed.entry.revision,
    }),
    data: {
      candidates_added: applied.value.added.candidates,
      questions_added: applied.value.added.questions,
      note: "Options are agent suggestions only. They have no measured quality, cost, latency, or evidence and are not selected decisions.",
    },
  };
  return result;
}

export async function compareDecisionOptions(
  root: string,
  raw: unknown,
  options: OptionContext & { readonly asOf?: string },
) {
  const input = CompareDecisionOptionsInputSchema.parse(raw);
  const loaded = await loadProject(root);
  if (
    input.workload !== undefined &&
    !loaded.contract.workloads.some((entry) => entry.id === input.workload)
  )
    throw new Error("The requested workload does not exist.");
  const asOf = options.asOf ?? options.clock();
  const comparison = compareAlternatives(loaded.contract, { asOf });
  const candidateResearch = await cachedCandidateResearch(
    root,
    loaded.contract,
    loaded.contract.candidates.filter(
      (entry) =>
        input.workload === undefined || entry.workload_ref === input.workload,
    ),
    asOf,
    options.projection,
  );
  const project = (
    candidate: (typeof comparison.project_candidates)[number],
  ) => ({
    candidate_ref: candidate.candidate_ref,
    status: candidate.status,
    satisfied: candidate.satisfied.map((entry) => entry.constraint_ref),
    failed: candidate.failed.map((entry) => entry.constraint_ref),
    unknown: candidate.unknown.map((entry) => entry.constraint_ref),
    not_scored: candidate.not_scored.map((entry) => entry.constraint_ref),
    evidence_required: candidate.evidence_required.map((entry) => ({
      code: entry.code,
      constraint_ref: entry.constraint_ref,
      required_floor: entry.required_floor,
      resolved_outcome: entry.resolved_outcome,
    })),
  });
  const result = {
    ok: true as const,
    tool: "compare_decision_options" as const,
    source: sourceMarker(loaded.contract, {
      asOf,
      projection: options.projection,
      stateRevision: loaded.head?.revision ?? null,
    }),
    data: {
      workloads: comparison.workloads
        .filter(
          (entry) =>
            input.workload === undefined ||
            entry.workload_ref === input.workload,
        )
        .map((entry) => ({
          workload_ref: entry.workload_ref,
          candidates: entry.candidates.map(project),
          workload_gaps: entry.workload_gaps.map((gap) => gap.code),
        })),
      project_candidates:
        input.workload === undefined
          ? comparison.project_candidates.map(project)
          : [],
      open_question_count: comparison.unresolved_questions.length,
      catalog_research: candidateResearch,
      note: "Pass and fail require admissible evidence. Unknown means no supported conclusion; these rows are a comparison, not a selection.",
    },
  };
  assertProjectionSafe(loaded.contract, result, options.projection);
  return result;
}
