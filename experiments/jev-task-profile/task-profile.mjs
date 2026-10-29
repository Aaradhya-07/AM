import { readFileSync } from "node:fs";
import { callJev, estimatedUsd } from "./jev-client.mjs";

const questions = JSON.parse(
  readFileSync(new URL("./questions.json", import.meta.url), "utf8"),
);

export const KINDS = [
  "architecture",
  "bug",
  "feature",
  "refactor",
  "test",
  "review",
];
export const RISKS = ["low", "medium", "high"];

export function taskProfileState(task) {
  if (typeof task.summary !== "string" || !task.summary.trim())
    throw new Error("task summary is required");
  return `Task: ${task.summary}\nArchitecture: ${task.architecture_summary ?? ""}`;
}

export function taskProfileRequest(task, model = "jev-latest") {
  return {
    model,
    state: taskProfileState(task),
    questions: structuredClone(questions),
  };
}

export function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0)
    throw new Error("cases must be a nonempty array");
  const ids = new Set();
  for (const item of cases) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      ids.has(item.id)
    ) {
      throw new Error("each case needs a unique id");
    }
    ids.add(item.id);
    taskProfileRequest(item);
    if (
      !item.expected ||
      !KINDS.includes(item.expected.kind) ||
      !RISKS.includes(item.expected.risk)
    ) {
      throw new Error(`case ${item.id} needs an expected kind and risk`);
    }
    if (!["illustrative", "human_reviewed"].includes(item.label_source)) {
      throw new Error(`case ${item.id} needs a label_source`);
    }
    if (
      item.label_source === "human_reviewed" &&
      (typeof item.reviewed_by !== "string" ||
        !item.reviewed_by.trim() ||
        typeof item.reviewed_at !== "string" ||
        Number.isNaN(Date.parse(item.reviewed_at)))
    ) {
      throw new Error(`case ${item.id} needs reviewer and review date`);
    }
  }
  return cases;
}

export async function evaluateCases(
  cases,
  { apiKey, model = "jev-latest", pricing, call = callJev },
) {
  validateCases(cases);
  const results = [];
  for (const item of cases) {
    const request = taskProfileRequest(item, model);
    try {
      const { response, duration_ms } = await call(request, { apiKey });
      const kind = response.answers.kind;
      const risk = response.answers.risk;
      results.push({
        id: item.id,
        label_source: item.label_source,
        expected: item.expected,
        predicted: { kind: kind.choice, risk: risk.choice },
        confidence: { kind: kind.confidence, risk: risk.confidence },
        probabilities: {
          kind: kind.probabilities,
          risk: risk.probabilities,
        },
        duration_ms,
        model: response.model,
        usage: response.usage ?? null,
        estimated_usd:
          pricing && response.usage
            ? estimatedUsd(response.usage, pricing)
            : null,
      });
    } catch (error) {
      results.push({
        id: item.id,
        label_source: item.label_source,
        error: String(error.message ?? error),
      });
    }
  }
  return results;
}

function agreement(results, source) {
  const rows = results.filter(
    (row) => row.label_source === source && row.predicted,
  );
  const brier = (question) =>
    rows.length
      ? rows.reduce(
          (total, row) =>
            total +
            Object.entries(row.probabilities[question]).reduce(
              (score, [label, probability]) =>
                score +
                (probability - (label === row.expected[question] ? 1 : 0)) ** 2,
              0,
            ),
          0,
        ) / rows.length
      : null;
  return {
    count: rows.length,
    kind: rows.length
      ? rows.filter((row) => row.expected.kind === row.predicted.kind).length /
        rows.length
      : null,
    risk: rows.length
      ? rows.filter((row) => row.expected.risk === row.predicted.risk).length /
        rows.length
      : null,
    both: rows.length
      ? rows.filter(
          (row) =>
            row.expected.kind === row.predicted.kind &&
            row.expected.risk === row.predicted.risk,
        ).length / rows.length
      : null,
    brier_kind: brier("kind"),
    brier_risk: brier("risk"),
  };
}

export function summarize(results) {
  const completed = results.filter((row) => row.predicted);
  const durations = completed
    .map((row) => row.duration_ms)
    .sort((a, b) => a - b);
  const sum = (key) => completed.reduce((total, row) => total + row[key], 0);
  return {
    cases: results.length,
    completed: completed.length,
    failed: results.length - completed.length,
    human_reviewed_accuracy: agreement(results, "human_reviewed"),
    illustrative_agreement: agreement(results, "illustrative"),
    latency_ms: {
      mean: durations.length ? sum("duration_ms") / durations.length : null,
      median: durations.length
        ? durations[Math.floor((durations.length - 1) / 2)]
        : null,
      p95: durations.length
        ? durations[Math.ceil(durations.length * 0.95) - 1]
        : null,
    },
    usage:
      completed.length > 0 && completed.every((row) => row.usage)
        ? {
            input_tokens: completed.reduce(
              (total, row) => total + row.usage.input_tokens,
              0,
            ),
            output_tokens: completed.reduce(
              (total, row) => total + row.usage.output_tokens,
              0,
            ),
          }
        : null,
    estimated_usd:
      completed.length > 0 &&
      completed.every((row) => row.estimated_usd !== null)
        ? sum("estimated_usd")
        : null,
  };
}
