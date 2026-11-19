import { describe, expect, it } from "vitest";
import {
  parseDevelopmentRecord,
  recordedCheckStanding,
  recordedCost,
} from "../lib/development-record";

// Structural test fixture; never served as product evidence.
const rawRun = {
  schema_version: 1,
  id: "run-test",
  plan_hash: "a".repeat(64),
  architecture_id: "web",
  task_id: "bounded-task",
  candidate_id: "candidate-test",
  configured_model: "declared-model",
  model_identity: "configured_only",
  model_events: [],
  approval_at_start: "current",
  approval_actor_at_start: "agent_test_operator",
  started_at: "2026-11-17T00:00:00Z",
  finished_at: "2026-11-17T00:01:00Z",
  agent_exit_code: 0,
  base_commit: "b".repeat(40),
  change_sha256: "c".repeat(64),
  changed_paths: ["src/app.ts"],
  checks: [{ name: "test", argv: ["test"], exit_code: 0, duration_ms: 42 }],
  billing: "api_rate_estimate",
  estimated_usd_from_observed_tokens: 0,
  usage: {
    input_tokens: 10,
    cached_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 0,
  },
};
describe("development run display boundary", () => {
  it("rejects legacy bundles, unsupported versions and invalid field types", () => {
    for (const raw of [
      { format: "anvilmark-review-bundle/1" },
      { ...rawRun, schema_version: 2 },
      {
        ...rawRun,
        checks: [
          { name: "test", argv: ["test"], exit_code: "0", duration_ms: 0 },
        ],
      },
      { ...rawRun, estimated_usd_from_observed_tokens: -1 },
    ])
      expect(() => parseDevelopmentRecord(raw)).toThrow("not a supported");
  });
  it("keeps check results separate from arbitrary imported acceptance claims", () => {
    const run = parseDevelopmentRecord({
      ...rawRun,
      review: { decision: "accepted" },
      outcome: "accepted",
    });
    expect(recordedCheckStanding(run)).toBe("passed");
    expect(run).not.toHaveProperty("review");
    expect(run).not.toHaveProperty("outcome");
    expect(run.model_identity).toBe("configured_only");
  });
  it("preserves failures and unknown rather than inferring success from absent checks", () => {
    expect(
      recordedCheckStanding(parseDevelopmentRecord({ ...rawRun, checks: [] })),
    ).toBe("unknown");
    expect(
      recordedCheckStanding(
        parseDevelopmentRecord({
          ...rawRun,
          checks: [{ ...rawRun.checks[0], exit_code: null }],
        }),
      ),
    ).toBe("unknown");
    expect(
      recordedCheckStanding(
        parseDevelopmentRecord({
          ...rawRun,
          diff_check: { ...rawRun.checks[0], exit_code: 1 },
        }),
      ),
    ).toBe("failed");
    expect(
      recordedCheckStanding(
        parseDevelopmentRecord({
          ...rawRun,
          architecture_check: { violations: ["outside boundary"] },
        }),
      ),
    ).toBe("failed");
  });
  it("does not turn subscriptions into cash measurements or lose zero estimates", () => {
    expect(recordedCost(parseDevelopmentRecord(rawRun))).toBe("$0.00");
    expect(
      recordedCost(
        parseDevelopmentRecord({
          ...rawRun,
          billing: "subscription_allowance",
          estimated_usd_from_observed_tokens: 12,
        }),
      ),
    ).toBe("Unknown");
    expect(
      recordedCost(
        parseDevelopmentRecord({
          ...rawRun,
          estimated_usd_from_observed_tokens: null,
        }),
      ),
    ).toBe("Unknown");
  });
});
