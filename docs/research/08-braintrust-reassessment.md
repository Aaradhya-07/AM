# Reassessment — Braintrust Occupies the Primary Wedge

Date: **August 13, 2026**
Status: **Validation of W2 is stopped.** Supersedes the "continue validation" decision in [`07-decision-note-braintrust-supersession.md`](07-decision-note-braintrust-supersession.md).

Triggered by the standing decision rule: _if T2, T3, or T5 shows Braintrust already provides the capability, stop ANVILMARK validation and write a reassessment._

**T2 is occupied.** Evidence: [`../../experiments/braintrust-validation/EVIDENCE-RECORD.md`](../../experiments/braintrust-validation/EVIDENCE-RECORD.md).

---

## 1. What was found

Braintrust's GitHub Action renders **both** `scores` and `metrics` into its pull-request comment table:

> `Object.entries(summary.scores ?? {}).map(...).concat(Object.entries(summary.metrics ?? {})`
> — [`eval/src/main.ts`](https://raw.githubusercontent.com/braintrustdata/eval-action/main/eval/src/main.ts)

Braintrust's experiment summary metrics are:

> "Prompt tokens, Completion tokens, Total tokens, LLM duration, and **Estimated LLM cost**"
> — [Braintrust docs, interpreting evals](https://www.braintrust.dev/docs/core/experiments/interpret)

Therefore **a Braintrust PR comment on any eval making real LLM calls already contains estimated cost and token counts, each with a delta against the baseline experiment and improvement/regression counts.**

The published example comment confirms the mechanism: it renders a `Duration` row, and Duration is a _metric_, not a score.

## 2. Correction to the earlier record

Document 07 recorded as **documented fact** that the PR comment contains "no cost field." That was wrong. The error was reading an example table from a trivial demo eval as an exhaustive schema, when the schema is dynamic.

This inverts the central conclusion of documents 06 and 07. It is recorded rather than quietly amended, because the mistake changed a decision.

## 3. What this does to the three proposed differentiators

|         | Claim                                                          | Standing after evidence                                                                                                                                                                      |
| :-----: | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a)** | Invoice-reconciled cost baselines                              | **Survives.** Braintrust estimates cost from logged values or a model registry; the only invoice it projects is its own platform bill.                                                       |
| **(b)** | Projected monthly cost delta using measured production traffic | **Largely occupied.** The per-case cost delta at merge time — the primary commercial hook — is shipped. What remains is multiplying by production volume and weighting by traffic frequency. |
| **(c)** | Post-deployment predicted-versus-actual scoring                | **Survives** on current evidence.                                                                                                                                                            |

Two further capabilities assumed to be ANVILMARK design choices are also already present:

- **Row-paired comparison on identical inputs** — comparison "aligns test cases across experiments" by `input`.
- **Replay of production inputs** — logs convert to datasets and run through experiments (established in document 07).

## 4. The honest assessment

The wedge as defined in document 06 was: _predict a change's cost and quality impact against measured production traffic, before merge, and score the prediction afterward._

Of that sentence, Braintrust already ships: replay, quality impact, cost impact per case, at merge, paired on identical inputs, with merge gating.

What is left is a **feature-sized remainder**: multiply by volume, weight by traffic mix, reconcile against the invoice, and keep a calibration record.

**[INFERENCE]** That is not a company. It is three or four features on top of a platform that a well-funded incumbent already owns end to end — and the two most valuable of them (volume projection, traffic weighting) are the easiest for that incumbent to add, since it already has per-case cost and production volume in the same system. A customer could approximate the volume projection today with a BTQL query and a multiplication.

Assumption A11 — "no existing product predicts cost at merge time" — is **refuted**. It was Tier 3 in the register but was load-bearing for both the differentiation score of 8 and the defensibility score of 5. Neither survives.

**This is stated without reinterpretation.** The result is unfavourable, it was obtained by the test that was designed in advance to be capable of producing exactly this outcome, and the decision rule attached to it was written before the evidence existed.

## 5. Decision

> **Stop validation of W2. Do not contact prospects. Do not build.**

Specifically:

|                       |                                                                                 |
| --------------------- | ------------------------------------------------------------------------------- |
| Prospect outreach     | **Cancelled.** Zero messages were sent. No company or individual was contacted. |
| Design-partner offer  | **Withdrawn before use.** Never sent.                                           |
| Telemetry requests    | **Cancelled.**                                                                  |
| Braintrust live trial | **Not needed.** The question is answered.                                       |
| Contract `0.1.0`      | Preserved, frozen, unmodified.                                                  |
| Repository            | No packages, schemas, fixtures, MCP tools, or web application changed.          |

**[INFERENCE]** Stopping now is the cheap outcome. The alternative was fifteen interviews, an introduction budget, and a paid design partnership spent on a promise a competitor already delivers — discovered at the first customer who says "Braintrust shows us that." Two days of desk research replaced that.

## 6. What is genuinely left, if anything

Three narrow things survive the evidence. None is currently a business, and each is recorded so a future decision starts from facts rather than from the earlier optimism.

**(a) Invoice reconciliation.** No product found reconciles computed LLM cost against the provider's actual bill. **[INFERENCE]** The reason may be that it is unglamorous and structurally awkward — it needs billing data that observability vendors have avoided touching. Whether anyone will pay for it is entirely unknown; it was never tested, because it was scoped as a supporting step for (b) rather than as the product.

**(c) Calibration record.** No product found publishes its own prediction error. **[INFERENCE]** This remains the most interesting idea in the whole line of work, and the least validated. Assumption A13 — that publishing your own errors builds trust rather than destroying it — was never tested and is genuinely counterintuitive.

**(T7) The noise-floor gap.** Braintrust reports "8 improvements, 4 regressions" with no confidence intervals, significance testing, or uncertainty quantification. On a stochastic task, comparing a configuration against **itself** would produce a confident-looking list of improvements and regressions that are pure noise. This is a real methodological gap in a shipped product used by large engineering teams.

**[INFERENCE]** Of the three, T7 is the most interesting and the least explored, because it is a correctness problem rather than a feature gap — and it applies to every eval platform, not only Braintrust. It is **not** a validated opportunity, and it is a narrower and more technical wedge than anything considered so far. It is recorded as an observation, not proposed as the next direction.

## 7. What should not happen next

**[INFERENCE]** The pattern in documents 01 → 05 → 06 was: contest a claim, widen the scope until no competitor covers the whole thing, call the seam an opportunity. That pattern would now suggest bundling (a) + (c) + T7 into a new composite and continuing.

That should be resisted. Each remaining piece is individually small and individually unvalidated, and combining unvalidated pieces does not produce a validated product — it produces a larger unvalidated one. The archive already contains this warning, unheeded once: _"fragmentation is not automatically a business opportunity."_

The next decision is the user's, and it is a genuine choice between restarting from the wedge table in document 06 with runtime data now known to be a competed surface, investigating one of the three survivors on its own merits, or stopping the line of work entirely.

## 8. Standing of documents

| Document                                                  | Standing                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01`–`05`                                                 | Historical. Unchanged.                                                                                                                                 |
| [`06`](06-runtime-calibrated-pr-review-recommendation.md) | Wedge selection **superseded**. Its differentiation and defensibility claims are refuted.                                                              |
| [`07`](07-decision-note-braintrust-supersession.md)       | Its "continue validation" decision is **superseded by this note**. Its factual claim that the PR comment contains no cost field is **wrong** — see §2. |
| **`08` (this note)**                                      | **Standing evidence for W2's closure.** Final standing: [`11-anvilmark-closure-memo.md`](11-anvilmark-closure-memo.md).                                |
| [`../validation/`](../validation/README.md)               | Sprint **halted before any contact**. Package preserved; reusable if a future wedge needs it.                                                          |
