# Ideal Customer Profile — Segment A

For the runtime-calibrated AI pull-request review wedge. Derived from [`../research/06-runtime-calibrated-pr-review-recommendation.md`](../research/06-runtime-calibrated-pr-review-recommendation.md) section 4.

Everything in this document is **[ASSUMPTION]** until interviews confirm it. It is a recruiting filter, not a finding.

## The one-line profile

> A 5–30 engineer company whose product calls an LLM on the critical path, whose inference bill is large enough that someone has asked about it, and that has changed a model, prompt, or routing rule in the last 90 days and been surprised by the result.

## Company characteristics

| Attribute             | Target                                                 | Why it matters                                                                                           |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Stage                 | Seed to Series B                                       | Late enough to have production traffic and a bill; early enough that one champion can grant data access. |
| Engineering headcount | 5–30                                                   | Below 5, no merge process worth gating. Above 30, procurement and security review dominate the timeline. |
| Product               | LLM calls on the **critical path** of the main product | If AI is a side feature, the bill is noise and the quality risk is tolerable.                            |
| Age of LLM feature    | In production ≥ 3 months                               | Needed for a 30-day telemetry history and for at least one past regression to have occurred.             |
| Inference spend       | **$5,000–$100,000 per month**                          | See range rationale below.                                                                               |
| Deploy cadence        | At least weekly                                        | Post-deployment measurement must complete inside the sprint.                                             |

### Inference-spend range rationale

| Band                 | Assessment                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Below $2k/month      | **Disqualify.** The bill is cheaper than the attention required to manage it. No willingness to pay.                                                          |
| $2k–$5k/month        | **Marginal.** Interview if the trigger is quality regression rather than cost. Do not count toward the paid-commitment criterion.                             |
| **$5k–$30k/month**   | **Primary target.** Large enough that a 30% swing is a real number; small enough that one engineer owns it and can grant access without a security committee. |
| **$30k–$100k/month** | **Strong secondary.** Higher willingness to pay, but expect a security review that may exceed the five-business-day access clock. Log the delay as data.      |
| Above $100k/month    | **Deprioritize for this sprint.** Likely has a platform team, procurement, and vendor security review. That is Segment B's timeline, not this one.            |

## Required technical maturity

All four must be true. These are gating, not preferences.

1. **Telemetry already exists.** Langfuse, Helicone, Braintrust, Datadog LLM Observability, OpenTelemetry GenAI spans, an LLM gateway (Portkey, LiteLLM, OpenRouter, Cloudflare AI Gateway), or structured application logs that record per-call token counts. **We do not instrument anyone during this sprint.**
2. **Call sites are identifiable in source.** LLM invocations can be traced to a file and function. Fully dynamic prompt assembly with no stable call-site identity makes PR-to-call-site mapping impossible.
3. **Pull requests are used.** Changes to prompts, models, or routing pass through a reviewable PR. Teams pushing directly to main have no merge decision point to inform.
4. **Someone can authorize a data export within the sprint window.** A named person, not a committee.

### Strongly preferred, not required

- An existing eval suite, golden dataset, or offline test set — raises quality-evaluation quality substantially (see [`experiment-protocol.md`](experiment-protocol.md)).
- A deterministic correctness signal for at least one call site (classification labels, extraction schema validation, tool-call success, JSON parse rate).
- Self-hosted telemetry, which usually removes the largest privacy objection.

## Trigger events

Recruit against these. Ranked by how sharply they predict urgency. **[INFERENCE]**

| Rank | Trigger                                                                                                                                      | Why it is strong                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1    | **The quality freeze.** They cut cost, quality silently regressed, they rolled back, and now nobody is allowed to touch model configuration. | Converts a cost problem into an organizational blockage. The pain recurs on every subsequent proposal. |
| 2    | **The invoice step change.** A month-over-month jump nobody predicted, traced to a code change after the fact.                               | Concrete, dated, and someone was asked to explain it.                                                  |
| 3    | **The margin question.** A CFO, board member, or investor asked what inference costs per customer or per transaction.                        | Creates a deadline and a budget holder.                                                                |
| 4    | **The blind migration.** A pending model migration (deprecation, new release, provider switch) they are afraid to execute.                   | Forward-looking and time-boxed; produces an immediate use for the report.                              |
| 5    | **The silent quality incident.** A customer-reported quality problem traced to a merged change that looked harmless.                         | Strong pain, but often attributed to prompt engineering rather than to a missing merge gate.           |

## Disqualifiers

Any single one disqualifies for **this sprint**. Some are recoverable later; that is noted.

| Disqualifier                                                                 | Rationale                                                                                           | Recoverable later? |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------ |
| No LLM calls in production                                                   | Nothing to measure.                                                                                 | No                 |
| Inference spend below $2k/month                                              | No willingness to pay; the bill is beneath notice.                                                  | Yes, as they grow  |
| No telemetry of any kind, and unwilling to add any                           | The core input does not exist. **Log this — it is Kill 2 evidence.**                                | Yes                |
| Pre-production or prototype only                                             | No traffic profile, no invoice, no merge risk.                                                      | Yes                |
| Regulated data with a categorical no-third-party-processing policy           | Even in-CI replay may be blocked. **Interview anyway to test whether in-CI changes the answer.**    | Possibly           |
| Single-developer project                                                     | No merge decision to inform.                                                                        | No                 |
| Fully fine-tuned or self-hosted-only stack with no per-call token accounting | Cost model does not apply; token accounting is absent.                                              | Partly             |
| Already a heavy Braintrust user with PR evals wired up                       | **Do not disqualify — prioritize.** This is the absorption test. Interview to learn what it misses. | N/A                |
| Agency or consultancy building for clients                                   | Does not own the bill, the repository, or the merge decision.                                       | No                 |
| Willing to talk but cannot name a change made in the last 90 days            | Fails the recency test that Kill 1 measures.                                                        | No                 |

## Stakeholder map

Four roles. In a 5–30 person company two or three of them are often the same person, which is exactly why this segment was chosen. **[ASSUMPTION]** — confirm the mapping in every interview.

| Role                     | Typical title                                                    | What they care about                                                     | What we need from them                                                                      |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Economic buyer**       | Founder/CEO, CTO, VP Engineering                                 | Gross margin, unit economics, not being surprised.                       | The $1,000 decision, and a named budget for a future subscription.                          |
| **Champion**             | Staff/Lead engineer who owns the AI feature; sometimes CTO       | Not being the person who shipped the regression.                         | The interview, the PR selection, the debrief, and internal advocacy.                        |
| **User**                 | Any engineer opening a PR that touches an AI call site           | Merge speed; not being blocked by a noisy check.                         | Reaction to the report: is it actionable or is it noise?                                    |
| **Security stakeholder** | CTO, Head of Platform, or a fractional/contract security advisor | Where production inputs go; what is retained; whether a DPA is required. | A yes on data handling. **Identify this person during the interview, not after the offer.** |

**[INFERENCE]** The most common failure will be discovering the security stakeholder only after a verbal yes from the champion. The interview guide asks for them explicitly at question 8 for this reason.

## Screening checklist

Use before booking. **Six of six on the required section, or do not book.**

### Required — all six

- [ ] Company has 5–30 engineers.
- [ ] An LLM is called in production on the critical path of the main product.
- [ ] The LLM feature has been live for at least 3 months.
- [ ] Estimated inference spend is at least $2,000/month (target: $5k–$100k).
- [ ] Some form of per-call telemetry already exists.
- [ ] Prompt, model, or routing changes go through pull requests.

### Qualifying signal — at least one

- [ ] Changed a model, prompt, or routing rule in the last 90 days.
- [ ] Experienced a cost or quality surprise from such a change in the last 90 days.
- [ ] Currently has a pending model migration they are hesitant to execute.
- [ ] Has been asked by a CFO, board member, or investor about inference cost.
- [ ] Has an informal or formal freeze on model configuration changes.

### Access signal — at least two, and the first is mandatory

- [ ] A **named individual** can authorize a telemetry export.
- [ ] Telemetry is self-hosted, or exportable without vendor involvement.
- [ ] At least one call site has a deterministic correctness signal.
- [ ] An eval suite or golden dataset already exists.
- [ ] They are willing to run replay inside their own CI.

### Recording

For each screened company record: source of lead, screening result, which trigger applies, which access signals are present, and — if rejected — the specific checklist item that failed. Rejections are data. Carry the counts into [`validation-scorecard.md`](validation-scorecard.md).
