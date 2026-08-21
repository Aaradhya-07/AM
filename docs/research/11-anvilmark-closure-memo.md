# ANVILMARK Closure Memo

Date: **August 13, 2026**
Status: **The ANVILMARK product-search line is closed.**

This memo is the final standing document. Every earlier document is preserved unchanged as dated evidence; this one supersedes their conclusions.

---

## 1. W2 is closed by Braintrust

The runtime-calibrated AI pull-request review wedge — the only hypothesis that reached provisional approval — is closed on source-level evidence.

Braintrust's GitHub Action renders `Object.entries(summary.metrics ?? {})` into its pull-request comment, and Braintrust's experiment summary metrics are _"Prompt tokens, Completion tokens, Total tokens, LLM duration, and Estimated LLM cost."_ Any eval making real LLM calls therefore posts estimated cost and token deltas at merge time, with a baseline diff and improvement/regression counts.

Evidence: [`../../experiments/braintrust-validation/EVIDENCE-RECORD.md`](../../experiments/braintrust-validation/EVIDENCE-RECORD.md) · Reassessment: [`08-braintrust-reassessment.md`](08-braintrust-reassessment.md)

## 2. No current track is validation-ready

|                Track                 | Final                                  | Basis                                                                                                                                                                                                           |
| :----------------------------------: | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Statistical eval correctness** | **RESEARCHABLE (topic only)**          | Real gap: platforms run repeated trials and perform no statistical inference on them. No buyer, budget, or decision point. Nine of thirteen platforms remain NOT DOCUMENTED                                     |
|    **B — Invoice reconciliation**    | **KILLED**                             | [FinOps LLM](https://finopsllm.com/) sells the exact job across 12+ providers, reconciled hourly and monthly against raw invoices, at 15–25% of verified savings with a $20k/month floor                        |
|    **C — Architecture planning**     | **KILLED**                             | [Cybewave Studio](https://www.cybewave.io/) ships idea-first discovery, four diagram types, conversational refinement, shareable plan, and scaffolded codebase, from $0. Residual differences are feature-sized |
|  **D — Repository decision audit**   | **RESEARCHABLE, not validation-ready** | No buyer, trigger, or measurable promise established. The job as specified requires runtime data that is competed                                                                                               |

**None is validation-ready.** Two are killed on direct competitive evidence; two lack any buyer.

## 3. No product implementation should begin

Nothing in any phase justifies writing product code. Contract `0.1.0` remains frozen. No package, schema, fixture, MCP tool, or web application has been modified at any point, and none should be.

## 4. No prospect outreach is justified

Zero companies and zero individuals have been contacted across every phase, and none should be from the current hypotheses. The recruiting pipeline, cohorts, interview guide, outreach drafts, and design-partner offer in [`../validation/`](../validation/README.md) were built and never used. They are preserved as reusable method, not as a pending action.

**Stated precisely, because it was previously stated wrongly:** the absence of customer interviews is **missing validation**. It is not evidence of demand and it is not evidence of its absence. It settles nothing. What closes B and C is competitive evidence; what leaves A and D unvalidated is that no buyer was ever identified.

## 5. Repository, contract, and brand are historical assets

The scaffold, the frozen contract `0.1.0`, the fixtures, the MCP boundary, the web surface, and the brand identity are **historical assets, not constraints on any future venture.**

**[INFERENCE]** treating them as assets to be preserved is what kept the search inside one region for three phases. The contract encodes a discarded thesis; the brand encodes a discarded positioning. A future venture should be free to use none of it. Their existence is not a reason to build something they fit.

## 6. The ANVILMARK product-search line is closed

Three phases. Five wedges. Four tracks. Two adversarial correction passes. Nothing reached validation-ready.

The founding vision had three components, and each is now independently closed:

| Component                                                        | Closure                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Guide someone with an idea toward an optimal architecture        | Cybewave Studio ships it from $0. Also unprovable on a timescale a founder can act on                                 |
| Analyze a repository for inefficient or replaceable choices      | Requires runtime data to quantify consequence; that data is held by observability and FinOps vendors                  |
| Supply structured knowledge and evidence to Claude Code or Codex | Commoditized — GovForge is Apache-2.0 free, Archcore ships typed decision context over MCP, `AGENTS.md` costs nothing |

## 7. A future search must start in a different problem region

Any future business search must begin from **observed user pain in a different problem region**, not from recombining residual features from these tracks.

Specifically prohibited as a starting point:

- any composite of Track A statistics, Track B reconciliation, Track D repository audit, or the Track C residue (cross-provider comparison, owned-compute awareness, agent export);
- anything chosen because the existing scaffold, contract, or brand would fit it;
- anything chosen by looking for gaps between existing products.

**[INFERENCE]** the last of these is the deepest lesson. Every phase of this work started by asking _"what do existing products not do?"_ and every phase found gaps that turned out to be gaps for a reason — either nobody wanted them, or the incumbent holding the inputs would close them. Gap-finding locates unoccupied ground; it does not establish that the ground is worth occupying. A search that begins from an observed person with an observed problem cannot make that error.

---

## What this work produced

Not a product. It produced a decision, cheaply and honestly:

|                      |           |
| -------------------- | --------- |
| Money spent          | **$0.00** |
| Customers contacted  | **0**     |
| Accounts created     | **0**     |
| Product code written | **None**  |
| Contract changes     | **None**  |
| Reputation spent     | **None**  |

Three wrong conclusions were caught before they cost anything: the W2 wedge (caught before fifteen interviews and a paid design partnership), three over-claimed kills in the reset phase (caught by adversarial verification), and two missed competitors (caught by a targeted closure pass). Each correction is recorded in the document that made the error and in the document that corrected it.

**[INFERENCE]** the most transferable output is the method, not the finding: a single research pass is not sufficient to kill or approve an option; adjacent capability is not equivalent to the exact job; an example is not a schema; a star count is not demand; and a secondary source cannot carry a fatal conclusion.

## Document standing

| Document                                                                                                       | Standing                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `01`–`05`                                                                                                      | Historical. The original thesis and its competitive research                                 |
| [`06`](06-runtime-calibrated-pr-review-recommendation.md)                                                      | Historical. Wedge selection, since superseded                                                |
| [`07`](07-decision-note-braintrust-supersession.md)                                                            | Historical. Contains a factual error corrected by `08`                                       |
| [`08`](08-braintrust-reassessment.md)                                                                          | **Standing** for W2's closure                                                                |
| [`reset-2026/01`–`07`](reset-2026/07-final-reset-verdict.md)                                                   | Historical. Three of four kills withdrawn by `reset-2026/08`                                 |
| [`reset-2026/08`](reset-2026/08-adversarial-verification.md), [`09`](reset-2026/09-corrected-final-verdict.md) | Historical. Corrected the reset phase; `09`'s "only remaining issue" claim corrected by `10` |
| [`reset-2026/10`](reset-2026/10-competitor-closure-addendum.md)                                                | **Standing** for Tracks B and C                                                              |
| **This memo**                                                                                                  | **Final standing**                                                                           |

Nothing further is scheduled. There is no open action.
