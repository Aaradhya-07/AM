/**
 * Scenario 2 — prompt expansion on a summarization call site.
 *
 * Braintrust eval scaffolding for the competitor-validation experiment.
 * NOT ANVILMARK product code. Imports nothing from @anvilmark/*.
 *
 * NOT RUNNABLE AS COMMITTED. Same prerequisites as eval-scenario-1.ts.
 *
 * What this tests: whether cache read/write tokens are priced correctly in any
 * reported cost, and whether run-to-run variation on an open-ended task is
 * distinguishable from the effect of the change. See T1, T2, T7.
 *
 * Note on the quality tier: this task has NO ground truth, so evaluation falls
 * to tier 5 (LLM judge) under docs/validation/experiment-protocol.md §9. That
 * is deliberate — it is the hard case, and the protocol requires the judge be
 * paired, order-randomized, and never the sole basis for a recommendation.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

interface DocRow {
  readonly id: string;
  readonly input: string;
  readonly expected: null;
  readonly metadata: {
    readonly sentence_count: number;
    readonly approx_chars: number;
    readonly shared_prefix_chars: number;
    readonly synthetic: boolean;
  };
}

export function loadDocuments(file = "data/s2-docs.jsonl"): DocRow[] {
  return readFileSync(join(HERE, file), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DocRow);
}

export const OLD_SYSTEM_PROMPT =
  "Summarize the incident report in three sentences.";

/**
 * The new prompt is long and stable across every request — which is exactly
 * what makes prompt caching decisive here. Cache reads are priced well below
 * standard input; cache writes are often priced above it. A tool that reports
 * a confident cost delta for this change without modelling both separately is
 * getting it wrong, and that is what the experiment is looking for.
 */
export const NEW_SYSTEM_PROMPT = [
  "You are summarizing internal incident reports for an operations review.",
  "Produce exactly three sentences. State impact, duration, and remediation.",
  "Do not speculate about cause beyond what the report states.",
  "",
  "Example 1:",
  "Report: A cache eviction bug caused elevated error rates for 40 minutes across two regions before a rollback.",
  "Summary: A cache eviction defect raised error rates across two regions. The elevated rates persisted for roughly forty minutes. A rollback restored normal behaviour.",
  "",
  "Example 2:",
  "Report: An expired credential blocked a partner sync overnight; no customer data was affected and the credential was rotated.",
  "Summary: An expired credential blocked partner synchronization overnight. No customer data was affected during the outage. The credential was rotated to restore the integration.",
  "",
  "Example 3:",
  "Report: A queue backlog delayed notifications by up to three hours for a subset of users; capacity was increased and the backlog cleared.",
  "Summary: A queue backlog delayed notifications for some users. Delays reached approximately three hours at peak. Added capacity cleared the backlog.",
  "",
  "Example 4:",
  "Report: A feature flag misconfiguration exposed a beta surface to a small percentage of traffic for 12 minutes before being disabled.",
  "Summary: A feature flag misconfiguration exposed a beta surface unintentionally. A small share of traffic was affected for twelve minutes. Disabling the flag resolved the exposure.",
].join("\n");

/**
 * Records what a paired comparison needs, so that a cost delta can be computed
 * per row rather than only in aggregate. Whether Braintrust surfaces any of
 * this in its comparison view is test T1.
 */
export interface PairedTokenRecord {
  readonly rowId: string;
  readonly arm: "old" | "new" | "control";
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cachedReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly finishReason: string | null;
}

/*
 * ---------------------------------------------------------------------------
 * BRAINTRUST WIRING — commented out deliberately. Past the credential
 * boundary; see FOUNDER-ACTIONS.md.
 *
 * import { Eval } from "braintrust";
 * import OpenAI from "openai";
 *
 * const useNewPrompt = process.env.SCENARIO_ARM === "new";
 * const systemPrompt = useNewPrompt ? NEW_SYSTEM_PROMPT : OLD_SYSTEM_PROMPT;
 * const client = new OpenAI();
 *
 * Eval("anvilmark-validation-s2", {
 *   data: () =>
 *     loadDocuments().map((row) => ({
 *       input: row.input,
 *       expected: null,
 *       metadata: row.metadata,
 *     })),
 *   task: async (input: string) => {
 *     const response = await client.chat.completions.create({
 *       model: process.env.S2_MODEL ?? "",
 *       temperature: 0.3,
 *       max_tokens: 300,
 *       messages: [
 *         { role: "system", content: systemPrompt },
 *         { role: "user", content: input },
 *       ],
 *     });
 *     // Capture the full usage object. Cache and reasoning fields are the
 *     // ones most often missing, and their absence is what silently breaks a
 *     // cost estimate in both directions.
 *     return response.choices[0]?.message?.content ?? "";
 *   },
 *   scores: [
 *     // Tier 5 only, because no ground truth exists. Must be pairwise and
 *     // order-randomized, and must never stand alone in a verdict.
 *   ],
 *   experimentName: `s2-${useNewPrompt ? "long" : "short"}-${process.env.RUN_TAG ?? "local"}`,
 * });
 * ---------------------------------------------------------------------------
 */
