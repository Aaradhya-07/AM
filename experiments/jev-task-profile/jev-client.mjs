const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function probability(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function validateQuestion(id, question) {
  if (
    !object(question) ||
    typeof question.instructions !== "string" ||
    !question.instructions.trim()
  ) {
    throw new Error(`question ${id} needs nonempty instructions`);
  }
  if (question.type === "choice") {
    const options = object(question.criteria)
      ? Object.keys(question.criteria)
      : [];
    if (options.length < 2 || options.length > 255)
      throw new Error(`question ${id} needs 2–255 choices`);
  } else if (question.type === "score") {
    if (
      !Array.isArray(question.criteria) ||
      question.criteria.length < 2 ||
      question.criteria.length > 10
    ) {
      throw new Error(`question ${id} needs 2–10 score levels`);
    }
  } else if (question.type !== "noul") {
    throw new Error(`question ${id} has an unsupported type`);
  }
}

export function validateRequest(request) {
  if (
    !object(request) ||
    !["string", "object"].includes(typeof request.state) ||
    request.state === null
  ) {
    throw new Error("state must be text or structured data");
  }
  if (typeof request.model !== "string" || !request.model.trim())
    throw new Error("model is required");
  if (
    !object(request.questions) ||
    Object.keys(request.questions).length === 0
  ) {
    throw new Error("at least one question is required");
  }
  for (const [id, question] of Object.entries(request.questions))
    validateQuestion(id, question);
  return request;
}

function validateDistribution(id, probabilities, expectedKeys) {
  if (!object(probabilities))
    throw new Error(`answer ${id} has no probabilities`);
  const actual = Object.keys(probabilities).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expectedKeys].sort())) {
    throw new Error(`answer ${id} has different options than requested`);
  }
  const values = Object.values(probabilities);
  if (
    !values.every(probability) ||
    Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.02
  ) {
    throw new Error(`answer ${id} has invalid probabilities`);
  }
}

export function validateResponse(request, response) {
  validateRequest(request);
  if (
    !object(response) ||
    typeof response.model !== "string" ||
    !response.model.trim() ||
    !object(response.answers)
  ) {
    throw new Error("Jev returned an invalid response envelope");
  }
  if (
    JSON.stringify(Object.keys(response.answers).sort()) !==
    JSON.stringify(Object.keys(request.questions).sort())
  ) {
    throw new Error("Jev returned a different question set");
  }
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = response.answers[id];
    if (!object(answer) || answer.type !== question.type)
      throw new Error(`answer ${id} has the wrong type`);
    if (question.type === "choice") {
      const options = Object.keys(question.criteria);
      if (!options.includes(answer.choice) || !probability(answer.confidence)) {
        throw new Error(`answer ${id} has an invalid choice or confidence`);
      }
      validateDistribution(id, answer.probabilities, options);
    } else if (question.type === "score") {
      const levels = question.criteria.map((_, index) => String(index));
      if (
        typeof answer.score !== "number" ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > levels.length - 1 ||
        !probability(answer.confidence)
      ) {
        throw new Error(`answer ${id} has an invalid score or confidence`);
      }
      validateDistribution(id, answer.probabilities, levels);
    } else if (!probability(answer.noul)) {
      throw new Error(`answer ${id} has an invalid yes/no probability`);
    }
  }
  const usage = response.usage;
  if (
    !object(usage) ||
    !Number.isSafeInteger(usage.input_tokens) ||
    usage.input_tokens < 0 ||
    !Number.isSafeInteger(usage.output_tokens) ||
    usage.output_tokens < 0
  ) {
    throw new Error("Jev returned invalid token usage");
  }
  return response;
}

export async function callJev(
  request,
  { apiKey, timeoutMs = 15_000, fetchImpl = fetch } = {},
) {
  validateRequest(request);
  if (typeof apiKey !== "string" || !apiKey.trim())
    throw new Error("TYPESAFE_API_KEY is required for live calls");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("timeoutMs must be positive");
  const started = performance.now();
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error(`TypeSafe API returned HTTP ${response.status}`);
  const body = await response.json();
  return {
    response: validateResponse(request, body),
    duration_ms: Math.round(performance.now() - started),
  };
}

export function estimatedUsd(
  usage,
  { inputUsdPerMillion, outputUsdPerMillion },
) {
  return (
    (usage.input_tokens * inputUsdPerMillion +
      usage.output_tokens * outputUsdPerMillion) /
    1_000_000
  );
}
