# ANVILMARK Research Archive — CLOSED

Last consolidated: **August 13, 2026**
Status: **Closed historical research archive.** The ANVILMARK product-search line is closed. Nothing in this directory authorizes validation, outreach, or implementation.

This directory preserves the product and competitive research carried out after the original AI Cost Optimizer scaffold was created. It is a **dated evidence record of a closed search**, not context for a next phase.

The original [`ai-cost-optimizer-master-brief.md`](../ai-cost-optimizer-master-brief.md) remains unchanged as a historical record.

## Read this first

1. **[`11-anvilmark-closure-memo.md`](11-anvilmark-closure-memo.md) — FINAL STANDING.** The closure verdict. Read before anything else in this directory.

## Authoritative hierarchy

| Document                                                                                       | Standing                                 |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| [`11-anvilmark-closure-memo.md`](11-anvilmark-closure-memo.md)                                 | **Final standing**                       |
| [`reset-2026/10-competitor-closure-addendum.md`](reset-2026/10-competitor-closure-addendum.md) | **Standing evidence for Tracks B and C** |
| [`08-braintrust-reassessment.md`](08-braintrust-reassessment.md)                               | **Standing evidence for W2's closure**   |
| Everything else in this directory                                                              | **Historical or superseded**             |

## Historical documents, in the order they were written

All of the following are **historical**. Each carries a supersession banner where its conclusions were later corrected.

1. [`01-product-evolution.md`](01-product-evolution.md) — how the thesis changed. _Historical._
2. [`02-competitor-register.md`](02-competitor-register.md) — competitor landscape as of August 2026. _Historical._
3. [`03-scenario-coverage.md`](03-scenario-coverage.md) — scenario coverage analysis. _Historical._
4. [`04-build-audit.md`](04-build-audit.md) — what the repository implements. _Historical, still factually accurate._
5. [`05-market-verdict-and-next-decisions.md`](05-market-verdict-and-next-decisions.md) — verdict on the broad hypothesis. _Historical._
6. [`06-runtime-calibrated-pr-review-recommendation.md`](06-runtime-calibrated-pr-review-recommendation.md) — wedge selection. _Historical; differentiation and defensibility claims superseded._
7. [`07-decision-note-braintrust-supersession.md`](07-decision-note-braintrust-supersession.md) — _Historical; contains a factual error corrected by `08`._
8. [`08-braintrust-reassessment.md`](08-braintrust-reassessment.md) — **standing evidence for W2's closure.**
9. [`reset-2026/`](reset-2026/10-competitor-closure-addendum.md) — four-track reset research, an adversarial correction pass, and the competitor closure addendum. _Docs `01`–`09` historical; `10` is standing evidence for Tracks B and C._
10. [`11-anvilmark-closure-memo.md`](11-anvilmark-closure-memo.md) — **final standing.**

## Outcome

The ANVILMARK product-search line is **closed**. W2 was closed by Braintrust, which already emits estimated cost and token deltas at merge time. The subsequent four-track reset ended with **Track A** researchable as a topic only, **Track B KILLED** (FinOps LLM sells the reconciliation job), **Track C KILLED** (Cybewave Studio ships the idea-first workflow), and **Track D** researchable with no buyer. **None is validation-ready.**

No implementation, no outreach, and no further search from these hypotheses is justified. The repository, contract `0.1.0`, and brand are **historical assets, not constraints** on a future venture. Full reasoning: [`11-anvilmark-closure-memo.md`](11-anvilmark-closure-memo.md).

---

# HISTORICAL RECORD — SUPERSEDED

> **Everything below this line is preserved as a dated record of superseded reasoning. None of it describes a current decision, a current hypothesis, or an authorized action.** Where it says "current", "approved", or "continue", read "as of the date written, since superseded."

## Superseded hypothesis (documents 01–05)

Documents 01–05 were written around this candidate definition:

> ANVILMARK could become a vendor-neutral architecture decision system that converts intent and constraints into a living, evidence-backed architecture graph, supplies that graph to coding agents, and continuously verifies the resulting repository and runtime against it.

Document 06 challenges this definition and does **not** adopt it. It concludes that the graph is the weakest part of the idea, that supplying decisions to coding agents is already a commodity with a free open-source floor, and that the only defensible atom is **calibration**.

Documents 01–05 are preserved unchanged as the record of how that conclusion was reached.

## Historical hypothesis — closed

> **SUPERSEDED.** The hypothesis below was closed by [`08-braintrust-reassessment.md`](08-braintrust-reassessment.md) and finally by [`11-anvilmark-closure-memo.md`](11-anvilmark-closure-memo.md). It is recorded for provenance only.

> ANVILMARK tells you what a change to your AI system will actually cost and how much it will move quality — measured against your real production traffic, before you merge — and then keeps score of how accurate it was.

**Initial customer (historical):** small AI product teams (5–30 engineers, Seed–Series B, roughly $5k–$100k per month of inference spend) running a live LLM product.
**Initial wedge (historical):** runtime-calibrated AI pull-request review.

### Superseded status statements

> **All statements in this subsection are HISTORICAL and no longer in force.** They are quoted as written on the date they were made.

- **Superseded, August 13, 2026:** _"The current decision is continue validation, not build. W2 is the best remaining hypothesis; the standalone business and its defensibility remain unproven."_
- **Superseded, August 13, 2026:** _"This is a hypothesis approved for testing, not an approved product direction."_
- **Superseded, August 13, 2026:** _"The hypothesis passes or fails against the criteria in document 06, executed through the sprint in `../validation/README.md`."_ **No sprint is to be executed.**

The constraints attached to those statements — contract `0.1.0` frozen, no application code, package, fixture, schema, MCP tool, or web surface modified — **remain in force permanently**, now as closure conditions rather than as validation conditions.

## Validation package — ARCHIVED

> **ARCHIVED — never executed; no outreach or implementation authorized.**

The material in [`../validation/`](../validation/README.md) — ideal customer profile, recruiting cohorts, interview guide, outreach drafts, design-partner offer, telemetry requirements, experiment protocol, report template, competitor validation matrix, assumption register, and scorecard — was written and **never used**. Zero companies and zero individuals were contacted. It is preserved as reusable method, **not as a pending action**.

## Research boundary

The register covers public products, open-source projects, cloud-provider capabilities, substitutes, and emerging tools discovered by August 13, 2026. It cannot include stealth companies, private internal tools, or every generic diagramming and static-analysis product. “Exhaustive” therefore means exhaustive enough for product strategy and differentiation—not literally every software project in existence.

## Key conclusions (historical, as of August 2026)

- The original broad “AI cost optimizer” is already covered by observability, FinOps, model-routing, evaluation, inference, and source-scanning products.
- PromptScan is closer to the original source-first audit concept than Helicone.
- The reframed idea-to-architecture scenario also has close competitors, especially Archie, BackArch, ArchGenie, AWS Agent Plugins, Spec Kit, and BMAD.
- Repository understanding, modernization, architectural drift, and agent governance are established product categories.
- No public product found clearly combines all of the following: vendor-neutral application architecture; proprietary/open model selection; owned-hardware fit; editable architecture; agent implementation contract; and repository/runtime conformance.
- Combining existing tools can reproduce much of the proposed experience. Integration alone is not a moat.
- The current repository is a healthy contract-first scaffold and fixture-driven demo, not a functioning audit or architecture recommendation engine.

## Evidence policy (historical)

_Historical. Written when a product was still expected. No product will be built; retained as method._

For each recommendation, the intended evidence standard was to preserve:

- the user constraint it satisfies;
- the alternatives evaluated;
- pricing and benchmark source URLs;
- source freshness;
- assumptions and uncertainty;
- quality evidence;
- operational trade-offs;
- the repository files implementing the decision;
- whether the finding comes from static analysis, runtime evidence, or both.
