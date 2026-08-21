# ANVILMARK Validation Sprint

Created: **August 13, 2026**
Status: **ARCHIVED — never executed; no outreach or implementation authorized.**

> # ARCHIVED — never executed; no outreach or implementation authorized
>
> **The ANVILMARK product-search line is closed.** This sprint was never run. Zero companies and zero individuals were contacted, no telemetry was requested, and no offer was sent.
>
> **Final standing: [`../research/11-anvilmark-closure-memo.md`](../research/11-anvilmark-closure-memo.md).** W2 was closed by Braintrust ([`../research/08-braintrust-reassessment.md`](../research/08-braintrust-reassessment.md)); Tracks B and C were closed by direct competitors ([`../research/reset-2026/10-competitor-closure-addendum.md`](../research/reset-2026/10-competitor-closure-addendum.md)).
>
> Everything below is preserved as **reusable method only**. Nothing in it is a pending action, and none of its instructions are authorized to be executed.

## Purpose

This sprint tests one hypothesis, cheaply, in two weeks, without building the product.

> **Hypothesis.** Small AI product teams (5–30 engineers, Seed–Series B, roughly $5k–$100k per month of inference spend) running a live LLM product will grant access to production telemetry, and will change or pay for a merge decision, when given a cost-and-quality prediction calibrated against their own measured traffic.

The reasoning behind this selection is in [`../research/06-runtime-calibrated-pr-review-recommendation.md`](../research/06-runtime-calibrated-pr-review-recommendation.md). Read that first.

The sprint deliberately does **not** test whether ANVILMARK can be built. It tests whether the necessary inputs are obtainable and whether the output changes behaviour. Those are the two things that cannot be discovered by writing code.

## The single most important thing this sprint measures

**Whether teams will actually grant access to production LLM telemetry and permit replay against real recorded inputs.**

Everything else in the wedge is engineering. This is not. If access does not materialize within five business days of a team agreeing in principle, the wedge fails regardless of how good the method is — because the method has no inputs.

Note the scope carefully: **failure to obtain telemetry kills this wedge, not ANVILMARK.** The correct response is to return to the wedge table in document 06 and reconsider the alternatives with the new knowledge that runtime data is unobtainable in this segment.

## Two-week sequence

### Week 1 — access and baseline

| Day | Activity                                                                                                                                                                                                                             | Tests                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| 1–2 | Work the ranked prospects in [`recruiting-pipeline.md`](recruiting-pipeline.md), screening each against [`ideal-customer-profile.md`](ideal-customer-profile.md). Send outreach from [`outreach-messages.md`](outreach-messages.md). | Recruitability           |
| 3–4 | Conduct 15 interviews using [`interview-guide.md`](interview-guide.md). Score each on the rubric. Ask every participant to **show** a real PR or incident.                                                                           | Assumption 4, Kill 1     |
| 5   | Ask the strongest 8 for a 30-day telemetry export and one invoice total. **Start the five-business-day clock.** Send [`design-partner-offer.md`](design-partner-offer.md) where warranted.                                           | **Assumption 1, Kill 2** |
| 6–7 | Build traffic profiles from whatever arrived. Attempt invoice reconciliation per [`experiment-protocol.md`](experiment-protocol.md). Record every unreconciled component by name.                                                    | Assumptions 2, 3; Kill 3 |

### Week 2 — prediction and proof

| Day   | Activity                                                                                                                                                                           | Tests                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 8–9   | Build the throwaway replay harness. Select one **retrospective** PR per partner where ground truth already exists. Compute required sample size per call site — do not assume one. | Assumption 2         |
| 10–11 | Run replays. Produce predicted-versus-actual for each. **This is the core falsification test.**                                                                                    | **Kill 4**           |
| 12    | Deliver reports using [`calibrated-merge-report-template.md`](calibrated-merge-report-template.md).                                                                                | —                    |
| 13    | Debrief each partner. Two questions: would this have changed your merge decision, and what would you pay per month for this on every PR?                                           | Assumption 5, Kill 5 |
| 14    | Score every criterion in [`validation-scorecard.md`](validation-scorecard.md). Write the go/no-go.                                                                                 | Decision gate        |

**Running in parallel, no extra headcount:** hands-on trials of Braintrust, promptfoo, Langfuse, Helicone, PromptScan, and Datadog LLM Observability against the same two scenarios, recorded in [`competitor-validation-matrix.md`](competitor-validation-matrix.md). Braintrust is priority 1 and starts Day 1 — see [`braintrust-hands-on-test-plan.md`](braintrust-hands-on-test-plan.md). A documentation investigation on August 13, 2026 already narrowed the differentiator: **replay and PR-time quality evaluation are occupied by Braintrust**; the cost dimension and the calibration loop are not.

## Required outputs

By end of Day 14, all of the following must exist:

1. **15 completed interview records**, each scored on the rubric, each noting whether a real PR or incident was shown.
2. **A telemetry-access log** recording, per team: date asked, date granted or refused, turnaround in business days, blocking reason, and whether in-CI execution changed the answer.
3. **Baseline reconciliation records** for every team that supplied data: reconstructed cost, invoice cost, variance, and an itemized list of every component that could not be reconciled.
4. **At least 3 retrospective predictions** with predicted-versus-actual scoring, each stating its own interval _before_ the actual was known.
5. **At least 3 delivered Calibrated Merge Reports.**
6. **A completed competitor validation matrix** separating confirmed capability from inferred gap.
7. **A completed assumption register** with every assumption marked confirmed, refuted, or untested.
8. **A completed scorecard** with a written go/no-go.

An output that does not exist is recorded as missing. It is never estimated, inferred, or filled in from a plausible guess.

## Decision gate

Evaluated on Day 14 against the criteria in [`../research/06-runtime-calibrated-pr-review-recommendation.md`](../research/06-runtime-calibrated-pr-review-recommendation.md) section 8, tracked in [`validation-scorecard.md`](validation-scorecard.md).

| Outcome                                    | Meaning                                                                           | Next step                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **GO** — all six success criteria met      | The problem is recent, data is obtainable, the method predicts, and someone paid. | Propose a product specification for approval. Only then consider contract changes.   |
| **CONDITIONAL** — 4–5 met, none killed     | Something specific is weak.                                                       | Name the weak criterion. Run a targeted two-week extension on that criterion only.   |
| **NO-GO (wedge)** — any kill criterion hit | This wedge fails.                                                                 | Return to the wedge table in document 06. Do not widen scope to rescue it.           |
| **NO-GO (segment)** — Kill 1 or Kill 6 hit | Segment A does not have this problem urgently.                                    | Re-examine Segment B with the knowledge that its wedge is competed by free software. |

A partial result is not a pass. If a criterion cannot be measured because the input never arrived, it is scored as **failed**, not as **not applicable**.

## What we deliberately will not build

Nothing in this sprint is production software. Specifically, none of the following may be built, started, or scaffolded during validation:

- the architecture graph, the visual canvas, or any diagram surface;
- the intake or interview flow as software;
- the architecture generator, owned-hardware planner, or vendor-neutral component catalog;
- any dashboard;
- an MCP server for this wedge;
- authentication, teams, persistence, or billing;
- a hosted service of any kind;
- the Next.js application;
- a general-purpose replay engine — the Day 8–9 harness is throwaway and must be treated as disposable.

Additionally, and by explicit instruction:

- **No application code, package, fixture, schema, MCP tool, or web surface in this repository may be modified during this phase.**
- **Contract `0.1.0` is preserved and remains frozen.** It belongs to the historical prototype. It is not deleted, rewritten, or unfrozen until this wedge passes validation.
- **No implementation code is written as part of this package.** The Day 8–9 harness is built only after interviews confirm the problem, and lives outside this repository.

## Package contents

| Document                                                                     | Purpose                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [`ideal-customer-profile.md`](ideal-customer-profile.md)                     | Who to recruit, who to disqualify, and the screening checklist.                                                                 |
| [`recruiting-pipeline.md`](recruiting-pipeline.md)                           | 40 public-source prospects, the ranked top 15, sourcing channels, and the blank interview tracker. **No company is qualified.** |
| [`recruiting-cohorts.md`](recruiting-cohorts.md)                             | **Corrected recruiting design.** Three cohorts, five ranking dimensions, named contacts, and the funnel arithmetic.             |
| [`braintrust-hands-on-test-plan.md`](braintrust-hands-on-test-plan.md)       | The priority-1 competitor trial: scenarios, exact steps, pass/fail criteria, and what needs your credentials.                   |
| [`interview-guide.md`](interview-guide.md)                                   | The 30-minute script, scoring rubric, and false-positive signals.                                                               |
| [`outreach-messages.md`](outreach-messages.md)                               | Draft messages. **Not yet sent to anyone.**                                                                                     |
| [`design-partner-offer.md`](design-partner-offer.md)                         | The $1,000 paid engagement, scope, and exit condition.                                                                          |
| [`telemetry-requirements.md`](telemetry-requirements.md)                     | Minimum event schema, per-platform mappings, and PII-safe modes.                                                                |
| [`experiment-protocol.md`](experiment-protocol.md)                           | How baselines, sampling, replay, intervals, and scoring actually work.                                                          |
| [`calibrated-merge-report-template.md`](calibrated-merge-report-template.md) | The deliverable's exact shape.                                                                                                  |
| [`competitor-validation-matrix.md`](competitor-validation-matrix.md)         | What is confirmed versus inferred, and what must be tested hands-on.                                                            |
| [`assumption-register.md`](assumption-register.md)                           | Every load-bearing assumption with its test and thresholds.                                                                     |
| [`validation-scorecard.md`](validation-scorecard.md)                         | The live tracker and the final go/no-go.                                                                                        |

## Standing rules for the sprint

1. **Recent behaviour beats stated interest.** "That sounds useful" is not evidence. "Here is the PR that cost us $4k last month" is.
2. **Never invent numerical certainty.** If the evidence does not support an interval, the report says _insufficient evidence_ and explains what is missing. This rule outranks the desire to deliver an impressive report.
3. **The customer's data stays in the customer's environment by default.** In-CI or self-hosted replay is the primary mode, not a fallback offered under objection.
4. **Do not oversell.** ANVILMARK currently consists of a scaffold and this analysis. Outreach and offers must say so.
5. **Record refusals.** A team that declines telemetry access is the most informative data point in the sprint. Log the reason verbatim.
