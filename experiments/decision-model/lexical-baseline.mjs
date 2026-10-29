import { validateRequest } from "../jev-task-profile/jev-client.mjs";

const stopwords = new Set(
  "a an and are as at be by can for from has in into is it of on or the to with while without".split(
    " ",
  ),
);

function tokens(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .match(/[a-z][a-z0-9_-]*/g)
      ?.filter((token) => token.length > 2 && !stopwords.has(token)) ?? [],
  );
}

function probabilities(state, options) {
  const query = tokens(
    typeof state === "string" ? state : JSON.stringify(state),
  );
  const documents = options.map(([name, description]) =>
    tokens(
      `${name} ${typeof description === "string" ? description : JSON.stringify(description)}`,
    ),
  );
  const frequency = new Map();
  for (const document of documents) {
    for (const word of document)
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }
  const scores = documents.map((document) => {
    let overlap = 0;
    let total = 0;
    for (const word of document) {
      const weight = Math.log(
        1 + (documents.length + 1) / (frequency.get(word) ?? 1),
      );
      total += weight;
      if (query.has(word)) overlap += weight;
    }
    return total ? overlap / Math.sqrt(total) : 0;
  });
  const exp = scores.map((score) => Math.exp(score * 4));
  const denominator = exp.reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(
    options.map(([name], index) => [name, exp[index] / denominator]),
  );
}

function largest(distribution) {
  return Object.entries(distribution).reduce((best, entry) =>
    entry[1] > best[1] ? entry : best,
  );
}

/** A dependency-free reference floor. Its probabilities are not calibrated. */
export function classifyLocal(request) {
  validateRequest(request);
  const answers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === "choice") {
      const distribution = probabilities(
        request.state,
        Object.entries(question.criteria),
      );
      const [choice, confidence] = largest(distribution);
      answers[id] = {
        type: "choice",
        choice,
        probabilities: distribution,
        confidence,
      };
    } else if (question.type === "score") {
      const distribution = probabilities(
        request.state,
        question.criteria.map((description, index) => [
          String(index),
          description,
        ]),
      );
      answers[id] = {
        type: "score",
        score: Object.entries(distribution).reduce(
          (total, [level, value]) => total + Number(level) * value,
          0,
        ),
        probabilities: distribution,
        confidence: largest(distribution)[1],
      };
    } else {
      const distribution = probabilities(request.state, [
        ["true", question.criteria?.true ?? "yes true"],
        ["false", question.criteria?.false ?? "no false"],
      ]);
      answers[id] = { type: "noul", noul: distribution.true };
    }
  }
  return { model: "anvilmark-lexical-baseline/0.1", answers };
}
