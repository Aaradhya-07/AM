/**
 * Scenario 1 — model swap on a classification call site.
 *
 * Braintrust eval scaffolding for the competitor-validation experiment.
 * NOT ANVILMARK product code. Imports nothing from @anvilmark/*.
 *
 * NOT RUNNABLE AS COMMITTED. Requires, from the founder:
 *   - `npm i braintrust autoevals openai` inside a throwaway repo
 *   - BRAINTRUST_API_KEY and a provider key in the environment
 *   - the model placeholders in scenarios.json replaced with real identifiers
 *
 * What this tests: whether Braintrust's experiment comparison and PR comment
 * surface COST, whether comparison is row-paired, and whether the dataset's
 * frequency_weight can influence the reported result. See T1, T2, T4, T7 in
 * docs/validation/braintrust-hands-on-test-plan.md.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

interface TicketRow {
  readonly id: string;
  readonly input: string;
  readonly expected: string;
  readonly metadata: {
    readonly category: string;
    readonly frequency_weight: number;
    readonly synthetic: boolean;
  };
}

interface ScenarioConfig {
  readonly label: string;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
}

export function loadTickets(file = "data/s1-tickets.jsonl"): TicketRow[] {
  return readFileSync(join(HERE, file), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TicketRow);
}

export function loadConfig(which: "old" | "new"): ScenarioConfig {
  const raw = readFileSync(join(HERE, "scenarios.json"), "utf8");
  const parsed = JSON.parse(raw) as {
    scenarios: Array<{ id: string; old: ScenarioConfig; new: ScenarioConfig }>;
  };
  const scenario = parsed.scenarios.find((s) => s.id === "s1-model-swap");
  if (!scenario) throw new Error("scenario s1-model-swap not found");
  const config = scenario[which];
  if (config.model.startsWith("REPLACE_WITH")) {
    throw new Error(
      `Model placeholder not filled in for "${which}". Edit scenarios.json before running.`,
    );
  }
  return config;
}

export const CLASSIFIER_SYSTEM_PROMPT = [
  "Classify the support ticket into exactly one category.",
  "Respond with the category name only, no punctuation or explanation.",
  "Categories: billing, shipping, returns, account_access, product_defect, order_status, cancellation, other",
].join("\n");

/**
 * Deterministic scorer — evaluation tier 1.
 * Deliberately not an LLM judge: this task has ground truth, so using a judge
 * here would violate the hierarchy in docs/validation/experiment-protocol.md.
 */
export function exactLabelMatch(args: { output: string; expected: string }): {
  name: string;
  score: number;
} {
  const normalized = args.output
    .trim()
    .toLowerCase()
    .replace(/[^a-z_]/g, "");
  return {
    name: "exact_label_match",
    score: normalized === args.expected ? 1 : 0,
  };
}

/*
 * ---------------------------------------------------------------------------
 * BRAINTRUST WIRING — commented out deliberately.
 *
 * Uncommenting requires the braintrust and openai packages plus live
 * credentials, which is past the credential boundary. The founder installs
 * dependencies and supplies keys (see FOUNDER-ACTIONS.md); this file is then
 * copied into the throwaway repo and the block below is enabled.
 *
 * import { Eval } from "braintrust";
 * import OpenAI from "openai";
 *
 * const config = loadConfig(process.env.SCENARIO_ARM === "new" ? "new" : "old");
 * const client = new OpenAI();
 *
 * Eval("anvilmark-validation-s1", {
 *   data: () =>
 *     loadTickets(process.env.S1_DATASET ?? "data/s1-tickets.jsonl").map(
 *       (row) => ({
 *         input: row.input,
 *         expected: row.expected,
 *         // T4: does Braintrust let this weight influence the aggregate score?
 *         metadata: row.metadata,
 *       }),
 *     ),
 *   task: async (input: string) => {
 *     const response = await client.chat.completions.create({
 *       model: config.model,
 *       temperature: config.temperature,
 *       max_tokens: config.maxTokens,
 *       messages: [
 *         { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
 *         { role: "user", content: input },
 *       ],
 *     });
 *     return response.choices[0]?.message?.content ?? "";
 *   },
 *   scores: [exactLabelMatch],
 *   experimentName: `s1-${config.label}-${process.env.RUN_TAG ?? "local"}`,
 * });
 * ---------------------------------------------------------------------------
 */
