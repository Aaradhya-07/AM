# Design Partner Offer

> **Status: draft. Not yet offered to anyone.** No company has been contacted.

## What this is

A **$1,000 paid engagement** in which ANVILMARK manually produces a Calibrated Merge Report for one of the customer's real pull requests, and then scores its own prediction against what actually happened.

The engagement is deliberately small. Its purpose is to discover whether the customer will pay anything at all for a calibrated prediction — not to generate revenue.

## Why it is paid

**[INFERENCE]** A free pilot measures politeness. A $1,000 invoice measures whether the problem has a budget line. The figure is set low enough to clear a founder's discretionary limit without procurement, and high enough that agreeing requires a real decision.

Kill criterion 6 counts paid commitments. A discount, a deferral, or an in-kind trade does **not** count. Either it is paid or it is not.

## Positioning — what we say and do not say

**We say:**

- This is early. The analysis is performed by a human with scripts, not by a product.
- We may conclude that the evidence is insufficient, and if so we will say that plainly.
- The methodology is written down in advance and shared. Nothing is retro-fitted to look good.

**We do not say:**

- That a product exists, is in beta, or has other customers.
- That we will find savings. We do not know that and will not imply it.
- That the analysis is automated.

## Scope

### What we deliver

| #   | Deliverable                     | Detail                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Traffic profile**             | Per call site, over 30 days: request volume, input/output/reasoning token _distributions_ (not just means), cache read and write rates, retry rate, error rate, model mix, concurrency, latency percentiles.                                                                                                     |
| 2   | **Baseline reconciliation**     | Our reconstructed monthly cost against your provider invoice, with the variance stated and **every unreconciled component named individually** rather than absorbed into a residual.                                                                                                                             |
| 3   | **One Calibrated Merge Report** | For one PR touching one or more AI call sites: cost delta with an interval, quality delta with sample size and the evaluation method used, regressed examples, assumptions, data completeness, and a merge recommendation. Format: [`calibrated-merge-report-template.md`](calibrated-merge-report-template.md). |
| 4   | **Post-deployment scorecard**   | If the PR ships within the engagement window: predicted versus measured actual, with the error decomposed by source where possible.                                                                                                                                                                              |
| 5   | **Methodology write-up**        | How every number was produced, including what we could not establish. Yours to keep and to challenge.                                                                                                                                                                                                            |
| 6   | **90-minute debrief**           | Walkthrough, objections, and what we would need to make it trustworthy enough to gate a merge.                                                                                                                                                                                                                   |

### Timeline

Ten business days from data access, not from signature.

| Day | Activity                                                                             |
| --- | ------------------------------------------------------------------------------------ |
| 0   | Agreement. Data-access request sent.                                                 |
| 1–3 | Telemetry export received. Traffic profile built.                                    |
| 4–5 | Baseline reconciliation. **Go/no-go checkpoint — see exit condition below.**         |
| 6–7 | PR selection, sample-size determination, replay execution.                           |
| 8   | Quality evaluation and report drafting.                                              |
| 9   | Report delivered.                                                                    |
| 10  | Debrief. Scorecard delivered if the PR has shipped; otherwise scheduled post-deploy. |

**[ASSUMPTION]** Ten days assumes data arrives promptly. The clock starts at data access precisely because the delay before access is itself the thing being measured.

## Customer responsibilities

The engagement cannot proceed without these. They are stated before payment, not discovered after.

| #   | Responsibility                | Detail                                                                                                                                                       |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Telemetry export**          | ~30 days of per-call records meeting the required fields in [`telemetry-requirements.md`](telemetry-requirements.md).                                        |
| 2   | **Invoice figure**            | One month's provider total, per provider. A screenshot or a number in an email is sufficient. We do not need billing-system access.                          |
| 3   | **Repository read access**    | Read-only, or a diff and the relevant source files for the call sites in question.                                                                           |
| 4   | **PR nomination**             | One PR touching an AI call site. **A recently merged one is preferred**, because ground truth already exists and the prediction can be scored immediately.   |
| 5   | **Replay execution path**     | Either: run our script in your CI or on your infrastructure and return aggregates; or provide a de-identified input sample. Your choice — see privacy below. |
| 6   | **Quality signal definition** | 30–60 minutes with an engineer to define what "correct output" means for the call site. Without this, quality evaluation degrades badly.                     |
| 7   | **A named point of contact**  | One person who can answer questions within a business day.                                                                                                   |

## Data access and privacy boundaries

### Default: nothing sensitive leaves your infrastructure

**In-CI or self-hosted replay is the primary mode, not a concession.** The default engagement works like this:

1. We send a self-contained script and a written traffic profile specification.
2. **You** run it, inside your CI or on your own machine, against your own inputs using your own API keys.
3. It emits **aggregate numbers only** — token distributions, cost deltas, evaluation scores, and counts.
4. You review the output before sending it. Nothing leaves without your inspection.
5. We never hold your request or response content.

### What we need to see versus what we never need

| Data                                                              | Needed?                 | Where it lives                            |
| ----------------------------------------------------------------- | ----------------------- | ----------------------------------------- |
| Per-call metadata: tokens, model, latency, cache, retries, errors | **Required**            | Shared with us; contains no content.      |
| Call-site identifiers and source file paths                       | **Required**            | Shared with us.                           |
| Invoice totals                                                    | **Required**            | Shared with us.                           |
| **Request and response content**                                  | **Required for replay** | **Stays in your environment by default.** |
| Customer PII                                                      | Never needed            | Never requested.                          |
| End-user identifiers                                              | Never needed            | Strip before export.                      |
| API keys or credentials                                           | Never needed            | Never requested, never accepted.          |
| Production system access                                          | Never needed            | Never requested.                          |

### If you prefer us to run the replay

Some teams will find it easier to hand over a sample than to run our script. If so:

- we accept a **de-identified sample** of recorded inputs for the specific call site;
- retention is **30 days maximum**, then deleted, with written confirmation;
- the sample is used only for this engagement, never for training, benchmarking, or any other customer's work;
- it is stored in an isolated location and not commingled;
- deletion on request within 2 business days, at any time and for any reason, including mid-engagement.

We will sign a mutual NDA. We will sign your DPA if you have one. **[ASSUMPTION]** A DPA requirement may exceed the sprint window; if it does, that delay is recorded as a finding rather than worked around.

## Exclusions

Explicitly **not** included:

- any software, license, tool, or continuing access;
- implementation of any recommendation, or a fix for anything found;
- ongoing monitoring, alerting, or repeat reports;
- a general audit of your AI system, your architecture, or your costs beyond the nominated PR;
- infrastructure, security, or compliance review;
- analysis of call sites not touched by the nominated PR;
- any guarantee of savings, of a specific finding, or of a particular conclusion;
- support commitments or an SLA.

## Exit and refund condition

**The engagement is refunded in full, without argument or negotiation, if we cannot reconstruct a credible cost baseline.**

This is assessed at the **Day 4–5 checkpoint**, before any prediction work begins. Concretely, a full refund is issued if any of these hold:

1. The reconstructed baseline cannot be reconciled to the invoice within a variance we are willing to state in writing, **and** the unreconciled remainder cannot be attributed to identified causes.
2. Telemetry lacks required fields to a degree that makes token or cost reconstruction unsound, and the gap cannot be closed within the window.
3. The call sites touched by the PR cannot be mapped to telemetry with confidence.
4. Traffic at the relevant call site is too sparse or too variable for any achievable sample to produce a usable interval.

In each case we deliver the **partial findings, the reconciliation attempt, and a written account of exactly what blocked it**, and return the money. The written account is often the most useful artifact, because it identifies a real gap in the customer's own observability.

**[INFERENCE]** This condition exists to make the offer honest, and because a refund triggered by reconciliation failure is direct evidence for kill criterion 3. We would rather learn that quickly than deliver a confident-looking report resting on a baseline we could not verify.

### Additional exit rights

- Either party may end the engagement at any point before Day 6 for a full refund.
- The customer may withdraw data access at any time, for any reason; the engagement ends and a pro-rata refund is issued.

## What we ask for in return, beyond the fee

Not conditions of the engagement — requests, which may be declined without affecting anything:

1. **A candid debrief.** Including "this is useless," if that is the answer.
2. **Permission to describe the engagement anonymously** in aggregate findings. Company name only with separate explicit approval.
3. **A price answer.** What would you pay per month for this on every PR, and what would have to be true?
4. **A referral**, if the work was useful.

## Follow-on

There is no follow-on offer yet, deliberately. If the sprint reaches a GO, design partners get first refusal on whatever is built and the price they named will inform the pricing. We do not pre-sell a product that does not exist.

## Internal checklist

Before sending this offer to anyone:

- [ ] Interview score ≥ 11 out of 20.
- [ ] Trigger event confirmed and dated.
- [ ] Telemetry system identified and confirmed to hold the required fields.
- [ ] A named person can authorize export.
- [ ] The security stakeholder has been identified.
- [ ] A candidate PR exists — ideally already merged.
- [ ] The customer understands nothing is built yet.
- [ ] The refund condition has been stated verbally, not just written here.
