import assert from "node:assert/strict";
import { test } from "node:test";
import { callJev, validateResponse } from "./jev-client.mjs";
import {
  evaluateCases,
  summarize,
  taskProfileRequest,
} from "./task-profile.mjs";

const task = {
  id: "example",
  summary: "Fix a label normalizer that leaves repeated punctuation.",
  expected: { kind: "bug", risk: "low" },
  label_source: "illustrative",
};

function answer(request, kind = "bug", risk = "low") {
  const distribution = (options, selected) =>
    Object.fromEntries(
      options.map((option) => [option, option === selected ? 1 : 0]),
    );
  return {
    model: "jev-1.13.0",
    answers: {
      kind: {
        type: "choice",
        choice: kind,
        confidence: 1,
        probabilities: distribution(
          Object.keys(request.questions.kind.criteria),
          kind,
        ),
      },
      risk: {
        type: "choice",
        choice: risk,
        confidence: 1,
        probabilities: distribution(
          Object.keys(request.questions.risk.criteria),
          risk,
        ),
      },
    },
    usage: { input_tokens: 100, output_tokens: 12 },
  };
}

test("one request asks the two schema-compatible questions", () => {
  const request = taskProfileRequest(task);
  assert.equal(request.model, "jev-latest");
  assert.deepEqual(Object.keys(request.questions), ["kind", "risk"]);
  assert.equal(request.state, `Task: ${task.summary}\nArchitecture: `);
  assert.equal(
    validateResponse(request, answer(request)).answers.kind.choice,
    "bug",
  );
});

test("rejects an answer outside the requested label set", () => {
  const request = taskProfileRequest(task);
  const invalid = answer(request);
  invalid.answers.kind.choice = "other";
  assert.throws(() => validateResponse(request, invalid), /invalid choice/);
});

test("live client sends the documented request without exposing the key in results", async () => {
  const request = taskProfileRequest(task);
  let captured;
  const result = await callJev(request, {
    apiKey: "private-test-key",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return { ok: true, json: async () => answer(request) };
    },
  });
  assert.equal(captured.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(captured.init.headers.Authorization, "Bearer private-test-key");
  assert.deepEqual(JSON.parse(captured.init.body), request);
  assert.equal(result.response.answers.risk.choice, "low");
  assert.equal(JSON.stringify(result).includes("private-test-key"), false);
});

test("reports illustrative agreement separately from reviewed accuracy", async () => {
  const pricing = { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0 };
  const results = await evaluateCases([task], {
    apiKey: "private-test-key",
    pricing,
    call: async (request) => ({ response: answer(request), duration_ms: 25 }),
  });
  const summary = summarize(results);
  assert.equal(summary.illustrative_agreement.both, 1);
  assert.equal(summary.human_reviewed_accuracy.count, 0);
  assert.equal(summary.human_reviewed_accuracy.both, null);
  assert.equal(summary.usage.input_tokens, 100);
  assert.ok(Math.abs(summary.estimated_usd - 0.0000042) < 1e-12);
});
