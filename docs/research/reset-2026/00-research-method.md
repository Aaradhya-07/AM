# Research Method — Reset Phase

Phase opened: **August 13, 2026**
Status: **Research only.** No implementation, no accounts, no credentials, no outreach.

## Why this phase exists

W2 (runtime-calibrated AI pull-request review) was stopped after Braintrust was confirmed at source level to emit estimated LLM cost and token deltas in its pull-request comment. See [`../08-braintrust-reassessment.md`](../08-braintrust-reassessment.md).

This phase asks a narrower question than any previous one:

> Does **any** narrow, urgent, independently valuable problem remain that is not already solved, is not merely a feature an incumbent can add, has an identifiable buyer and decision point, can be proved right or wrong, can be validated without building a platform, and still relates to the original ANVILMARK vision?

Selecting **none** is an acceptable and expected outcome.

## The four tracks

| Track | Question                                                        |
| :---: | --------------------------------------------------------------- |
| **A** | Statistical correctness for AI evaluations — the T7 observation |
| **B** | AI inference invoice reconciliation                             |
| **C** | Architecture planning for new applications                      |
| **D** | Existing-repository decision audit                              |

Each is researched independently. **They are not permitted to be recombined.** Bundling weak gaps into a platform is the failure pattern that produced documents 01→05→06 and it is prohibited here.

## Evidence labels

| Label         | Meaning                                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VERIFIED**  | Checked against a primary source — official documentation, source code, changelog, API reference, pricing page, or peer-reviewed publication — on August 13, 2026. Source linked at the claim. |
| **INFERENCE** | Reasoning from verified facts. Could be wrong without any fact being wrong.                                                                                                                    |
| **UNKNOWN**   | Not established. Recorded as unknown rather than guessed.                                                                                                                                      |

**No customer demand is asserted anywhere in this phase.** Zero customers have been contacted. Any statement about what buyers want is INFERENCE or UNKNOWN, never VERIFIED.

## Competitor recording standard

For each competitor, [`05-exhaustive-competitor-matrix.md`](05-exhaustive-competitor-matrix.md) records: exact capability, target customer, workflow entry point, required data access, output, pricing/business model, open-source status, where it fully solves the job, where it partially overlaps, and whether the remaining gap is **product-sized** or **feature-sized**.

### The combination rule

A practical combination of **two or three widely adopted products** counts as competition. Requiring one competitor to cover every component is how a false opportunity gets manufactured — it is the specific error made in document 06 and it is disallowed here.

### The absorption test

A gap is **feature-sized** when an incumbent already holds every input required and shipping it is a small change to an existing surface. The Braintrust finding is the reference case: it already had per-item scores, so cost-in-the-PR-comment was never a product, and treating it as one cost a full sprint of planning.

## Scoring

Weighted, 1–10 per criterion.

|  #  | Criterion                       | Weight | Question                                                                                      |
| :-: | ------------------------------- | :----: | --------------------------------------------------------------------------------------------- |
|  1  | Urgency                         |   ×2   | Does an identifiable buyer feel this now, on a schedule?                                      |
|  2  | Differentiation                 |   ×3   | Against a practical combination of two or three adopted products — not against one competitor |
|  3  | Absorption resistance           |   ×3   | How hard is it for an incumbent that already holds the inputs?                                |
|  4  | Buyer and decision point        |   ×2   | Is there a named role, a budget, and a moment where the decision is made?                     |
|  5  | Provability                     |   ×2   | Can the output be shown right or wrong, on a timescale a founder can act on?                  |
|  6  | Validatable without a platform  |   ×1   | Can it be tested concierge-style?                                                             |
|  7  | Relation to the original vision |   ×1   | Guiding architecture, auditing repositories, or supplying evidence to coding agents           |

**Maximum 140.**

### Scoring does not override a fatal fact

**A track that is adequately solved, or whose gap is feature-sized, is KILLED regardless of its score.** The score describes attractiveness; the fatal-fact rule describes existence. A high score on a solved problem is a measurement of enthusiasm, not of opportunity.

## Final categories

| Category             | Definition                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **KILLED**           | Adequately solved by existing products or by a practical combination of them, **or** the remaining gap is feature-sized.             |
| **RESEARCHABLE**     | A genuine unresolved gap exists, but there is no business evidence — no identified buyer, budget, or decision point. Not actionable. |
| **VALIDATION-READY** | Sufficiently differentiated, with an identifiable buyer and decision point, to justify contacting customers.                         |

**At most one track may be VALIDATION-READY. Zero is permitted and is preferable to manufacturing an opportunity.**

## Standing guardrails

- No product implementation. No account creation. No credentials. No outreach.
- No fabricated customer demand.
- No combining weak gaps into a platform.
- All historical research preserved unchanged; this directory is additive.
- Contract `0.1.0` remains frozen. No packages, schemas, fixtures, MCP tools, or web application modified.

## A standing instruction on the original vision

The brief requires that a surviving problem still relate to the original ANVILMARK vision. That requirement is a **filter, not a goal**. Where the evidence contradicts the vision, this phase records the contradiction rather than reshaping the evidence to preserve it. The vision has now been narrowed twice by evidence; it may not survive a third time, and that is a legitimate outcome.
