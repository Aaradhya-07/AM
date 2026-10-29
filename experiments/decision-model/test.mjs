import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLocal } from "./lexical-baseline.mjs";

test("returns only caller-defined choices with a full distribution", () => {
  const result = classifyLocal({
    model: "ignored",
    state: "Fix a failing checkout payment",
    questions: {
      kind: {
        type: "choice",
        instructions: "What work is requested?",
        criteria: { bug: "Fix broken behavior", feature: "Add new behavior" },
      },
    },
  });
  assert.deepEqual(Object.keys(result.answers.kind.probabilities), [
    "bug",
    "feature",
  ]);
  assert.ok(["bug", "feature"].includes(result.answers.kind.choice));
  assert.ok(
    Math.abs(
      Object.values(result.answers.kind.probabilities).reduce((a, b) => a + b) -
        1,
    ) < 1e-12,
  );
});

test("supports ordered score and binary probability shapes", () => {
  const result = classifyLocal({
    model: "ignored",
    state: "A user reports an outage",
    questions: {
      severity: {
        type: "score",
        instructions: "How severe?",
        criteria: ["low", "medium", "high"],
      },
      urgent: { type: "noul", instructions: "Is it urgent?" },
    },
  });
  assert.ok(
    result.answers.severity.score >= 0 && result.answers.severity.score <= 2,
  );
  assert.ok(result.answers.urgent.noul >= 0 && result.answers.urgent.noul <= 1);
});
