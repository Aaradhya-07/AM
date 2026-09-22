import { describe, expect, it } from "vitest";

import type { EvidenceRecord } from "@anvilmark/project-contract";
import {
  evaluateConstraintFresh,
  freshnessOf,
  partitionByFreshness,
} from "../src/index.js";

function record(
  overrides: Partial<EvidenceRecord> & { id: string },
): EvidenceRecord {
  return {
    kind: "measured_evaluation",
    subject: "candidate.local.quality",
    producer: { name: "runner", version: "1.0.0" },
    observed_at: "2026-08-01T00:00:00Z",
    source: { type: "local_command", locator: null },
    confidence: "high",
    caveats: [],
    refresh: { policy: "never", expires_at: null },
    applies_to: {
      candidate_ref: "candidate.local",
      workload_ref: "classification",
      hardware_ref: null,
      constraint_refs: ["quality.f1"],
    },
    value: {
      dataset_ref: "d",
      dataset_version: "v1",
      candidate_ref: "candidate.local",
      configuration_hash: "cfg",
      identity: {
        workload_ref: "classification",
        dataset_hash: `sha256:${"a".repeat(64)}`,
        prompt_hash: `sha256:${"b".repeat(64)}`,
        evaluator_hash: `sha256:${"c".repeat(64)}`,
        model_configuration_hash: `sha256:${"d".repeat(64)}`,
        config_digest: `sha256:${"e".repeat(64)}`,
        provider_id: "example:model-a",
      },
      metrics: { macro_f1: 0.93 },
      result_artifact_hash: "artifact",
    },
    ...overrides,
  } as EvidenceRecord;
}

const AS_OF = "2026-09-01T00:00:00Z";

describe("freshness states", () => {
  it("reports a recent record with no expiry as current", () => {
    const one = record({ id: "e1" });

    expect(freshnessOf(one, [one], { asOf: AS_OF }).state).toBe("current");
  });

  it("reports an expired record as expired", () => {
    const one = record({
      id: "e1",
      refresh: { policy: "never", expires_at: "2026-08-15T00:00:00Z" },
    });

    const verdict = freshnessOf(one, [one], { asOf: AS_OF });
    expect(verdict.state).toBe("expired");
    expect(verdict.reason).toContain("2026-08-15");
  });

  it("reports a periodic record beyond its window as stale", () => {
    const one = record({
      id: "e1",
      refresh: { policy: "periodic", expires_at: null },
    });

    const verdict = freshnessOf(one, [one], {
      asOf: AS_OF,
      defaultStaleAfterMs: 7 * 24 * 60 * 60 * 1000,
    });
    expect(verdict.state).toBe("stale");
  });

  it("reports a periodic record with no configured window as unknown", () => {
    const one = record({
      id: "e1",
      refresh: { policy: "periodic", expires_at: null },
    });

    // Not knowing how long a record stays good is itself an honest answer.
    expect(freshnessOf(one, [one], { asOf: AS_OF }).state).toBe("unknown");
  });

  it("reports an older record for the same fact as superseded", () => {
    const older = record({ id: "e1", observed_at: "2026-08-01T00:00:00Z" });
    const newer = record({ id: "e2", observed_at: "2026-08-20T00:00:00Z" });

    const verdict = freshnessOf(older, [older, newer], { asOf: AS_OF });
    expect(verdict.state).toBe("superseded");
    expect(verdict.superseded_by).toBe("e2");
    // The newer one stands.
    expect(freshnessOf(newer, [older, newer], { asOf: AS_OF }).state).toBe(
      "current",
    );
  });

  it("breaks a supersession tie deterministically rather than by array order", () => {
    const a = record({ id: "e1" });
    const b = record({ id: "e2" });

    expect(freshnessOf(a, [a, b], { asOf: AS_OF }).state).toBe("superseded");
    expect(freshnessOf(a, [b, a], { asOf: AS_OF }).state).toBe("superseded");
    expect(freshnessOf(b, [a, b], { asOf: AS_OF }).state).toBe("current");
  });

  it("does not treat a different subject as superseding", () => {
    const one = record({ id: "e1" });
    const other = record({
      id: "e2",
      subject: "candidate.remote.quality",
      observed_at: "2026-08-20T00:00:00Z",
    });

    expect(freshnessOf(one, [one, other], { asOf: AS_OF }).state).toBe(
      "current",
    );
  });

  it("splits records into usable and history", () => {
    const current = record({ id: "e2", observed_at: "2026-08-20T00:00:00Z" });
    const old = record({ id: "e1" });

    const partition = partitionByFreshness([old, current], [old, current], {
      asOf: AS_OF,
    });

    expect(partition.current.map((entry) => entry.id)).toEqual(["e2"]);
    expect(partition.excluded[0]?.verdict.state).toBe("superseded");
  });
});

const hardQuality = {
  id: "quality.f1",
  domain: "quality",
  severity: "hard",
  subject: "workload.classification.metric.macro_f1",
  operator: "gte",
  value: 0.9,
  source: "user",
  rationale: null,
  condition: null,
  exceptions: [],
} as never;

const policy = { tiers: {}, floors: {} } as never;
const context = {
  candidateRef: "candidate.local",
  workloadRef: "classification",
  expectedEvaluation: {
    provider_id: "example:model-a",
    configuration_hash: "cfg",
  },
};

describe("stale evidence cannot settle a current constraint", () => {
  it("passes when the measurement is current", () => {
    const one = record({ id: "e1" });

    const result = evaluateConstraintFresh(
      hardQuality,
      "pass",
      [one],
      policy,
      context,
      { asOf: AS_OF },
      [one],
    );

    expect(result.outcome).toBe("pass");
  });

  it("yields unknown when the only measurement has expired", () => {
    const one = record({
      id: "e1",
      refresh: { policy: "never", expires_at: "2026-08-15T00:00:00Z" },
    });

    const result = evaluateConstraintFresh(
      hardQuality,
      "pass",
      [one],
      policy,
      context,
      { asOf: AS_OF },
      [one],
    );

    // History is preserved; it simply cannot clear today's gate.
    expect(result.outcome).toBe("unknown");
    expect(result.staleExcluded[0]?.verdict.state).toBe("expired");
    expect(result.explanation).toContain("excluded as not current");
  });

  it("yields unknown when the only measurement is stale", () => {
    const one = record({
      id: "e1",
      refresh: { policy: "periodic", expires_at: null },
    });

    const result = evaluateConstraintFresh(
      hardQuality,
      "pass",
      [one],
      policy,
      context,
      { asOf: AS_OF, defaultStaleAfterMs: 1000 },
      [one],
    );

    expect(result.outcome).toBe("unknown");
  });

  it("uses the newer measurement when one supersedes another", () => {
    const old = record({ id: "e1", value: { ...record({ id: "x" }).value } });
    const newer = record({ id: "e2", observed_at: "2026-08-25T00:00:00Z" });

    const result = evaluateConstraintFresh(
      hardQuality,
      "pass",
      [old, newer],
      policy,
      context,
      { asOf: AS_OF },
      [old, newer],
    );

    expect(result.outcome).toBe("pass");
    expect(result.staleExcluded.map((entry) => entry.record.id)).toEqual([
      "e1",
    ]);
  });
});

describe("future-dated evidence is never current", () => {
  const FUTURE = "2027-01-01T00:00:00Z";

  it("reports an observation dated after the evaluation moment as unknown", () => {
    const one = record({ id: "e1", observed_at: FUTURE });

    const verdict = freshnessOf(one, [one], { asOf: AS_OF });
    expect(verdict.state).toBe("unknown");
    expect(verdict.reason).toContain("after the evaluation moment");
  });

  it("cannot settle a hard constraint", () => {
    const one = record({ id: "e1", observed_at: FUTURE });

    const result = evaluateConstraintFresh(
      hardQuality,
      "pass",
      [one],
      policy,
      context,
      { asOf: AS_OF },
      [one],
    );

    expect(result.outcome).toBe("unknown");
  });

  it("cannot supersede a genuine observation", () => {
    const real = record({ id: "e1", observed_at: "2026-08-20T00:00:00Z" });
    const future = record({ id: "e2", observed_at: FUTURE });

    // A record that does not exist yet cannot replace one that does.
    expect(freshnessOf(real, [real, future], { asOf: AS_OF }).state).toBe(
      "current",
    );
  });

  it("picks the genuinely newest record, not the last id", () => {
    const oldest = record({ id: "e9", observed_at: "2026-08-01T00:00:00Z" });
    const middle = record({ id: "e5", observed_at: "2026-08-10T00:00:00Z" });
    const newest = record({ id: "e1", observed_at: "2026-08-20T00:00:00Z" });
    const all = [oldest, middle, newest];

    expect(freshnessOf(oldest, all, { asOf: AS_OF }).superseded_by).toBe("e1");
    expect(freshnessOf(middle, all, { asOf: AS_OF }).superseded_by).toBe("e1");
    expect(freshnessOf(newest, all, { asOf: AS_OF }).state).toBe("current");
  });
});

describe("the expiry boundary is inclusive", () => {
  it("is current at the exact expiry instant", () => {
    const one = record({
      id: "e1",
      refresh: { policy: "never", expires_at: AS_OF },
    });

    expect(freshnessOf(one, [one], { asOf: AS_OF }).state).toBe("current");
  });

  it("is expired one millisecond later", () => {
    const one = record({
      id: "e1",
      refresh: { policy: "never", expires_at: "2026-08-31T23:59:59.999Z" },
    });

    expect(freshnessOf(one, [one], { asOf: AS_OF }).state).toBe("expired");
  });
});
