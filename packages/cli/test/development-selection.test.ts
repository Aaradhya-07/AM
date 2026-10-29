import { describe, expect, it } from "vitest";
import type { DevelopmentEvidenceRow } from "@anvilmark/model-catalog";

import {
  matchedDevelopmentEvidence,
  type SelectionEvidenceRecord,
} from "../src/commands/development-selection.js";

const candidates = [
  {
    id: "fast",
    agent: "codex_cli",
    model: "fast-model",
    configuration_key: "fast@pinned",
  },
  {
    id: "baseline",
    agent: "codex_cli",
    model: "baseline-model",
    configuration_key: "baseline@pinned",
  },
];

function evidence(
  task: number,
  candidate: (typeof candidates)[number],
  outcome: DevelopmentEvidenceRow["outcome"],
  cost: number,
  overrides: Partial<SelectionEvidenceRecord> = {},
): SelectionEvidenceRecord {
  return {
    task_id: `task-${task}`,
    base_commit: "a".repeat(40),
    prompt_sha256: "b".repeat(64),
    cached_input_tokens: 400,
    elapsed_ms: 1000,
    reviewed_by_human: true,
    row: {
      run_id: `${task}-${candidate.id}`,
      run_hash: `hash-${task}-${candidate.id}`,
      plan_hash: `plan-${task}`,
      profile_key: "matching-profile",
      agent: candidate.agent,
      model: candidate.model,
      configuration_key: candidate.configuration_key,
      model_identity: "tool_reported",
      outcome,
      observed_at: "2026-10-24T00:00:00.000Z",
      billing: "api_rate_estimate",
      estimated_usd: cost,
      input_tokens: 1000,
      output_tokens: 100,
    },
    ...overrides,
  };
}

describe("matched development evidence", () => {
  it("offers an advisory trial only when a cheaper setup passes paired quality and cost gates", () => {
    const records = Array.from({ length: 40 }, (_, task) => [
      evidence(task, candidates[0]!, "accepted", 0.2),
      evidence(task, candidates[1]!, "accepted", 1),
    ]).flat();
    const result = matchedDevelopmentEvidence(
      candidates,
      records,
      "matching-profile",
      "baseline",
    );
    expect(result.standing).toBe("shadow_trial_candidate");
    expect(result.trial_candidate_id).toBe("fast");
    expect(result.matched_tasks).toBe(40);
    expect(result.comparisons[0]?.acceptance_delta_95).toEqual([0, 0]);
    expect(
      result.comparisons[0]?.estimated_cost_per_accepted_delta_95?.[1],
    ).toBeLessThan(0);
  });

  it("blocks a cheaper setup when its accepted patches are worse", () => {
    const records = Array.from({ length: 40 }, (_, task) => [
      evidence(task, candidates[0]!, task < 12 ? "failed" : "accepted", 0.2),
      evidence(task, candidates[1]!, "accepted", 1),
    ]).flat();
    const result = matchedDevelopmentEvidence(
      candidates,
      records,
      "matching-profile",
      "baseline",
    );
    expect(result.standing).toBe("baseline_retained");
    expect(result.trial_candidate_id).toBeNull();
    expect(result.comparisons[0]?.acceptance_delta_95[0]).toBeLessThan(0);
  });

  it("excludes changed prompts, repeated task ids, and configured-only identity from a trial", () => {
    const records = Array.from({ length: 34 }, (_, task) => [
      evidence(task, candidates[0]!, "accepted", 0.2),
      evidence(task, candidates[1]!, "accepted", 1),
    ]).flat();
    records[0] = evidence(0, candidates[0]!, "accepted", 0.2, {
      prompt_sha256: "c".repeat(64),
    });
    records[2] = evidence(1, candidates[0]!, "accepted", 0.2, {
      task_id: "task-2",
    });
    records[3] = evidence(1, candidates[1]!, "accepted", 1, {
      task_id: "task-2",
    });
    const result = matchedDevelopmentEvidence(
      candidates,
      records,
      "matching-profile",
      "baseline",
    );
    expect(result.matched_tasks).toBe(31);
    expect(result.excluded_repeated_task_ids).toBe(2);
    expect(result.standing).toBe("shadow_trial_candidate");

    records[6] = evidence(3, candidates[0]!, "accepted", 0.2, {
      row: {
        ...records[6]!.row,
        model_identity: "configured_only",
      },
    });
    const unverified = matchedDevelopmentEvidence(
      candidates,
      records,
      "matching-profile",
      "baseline",
    );
    expect(unverified.standing).toBe("model_identity_unverified");
    expect(unverified.trial_candidate_id).toBeNull();
  });
});
