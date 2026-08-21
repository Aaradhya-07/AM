# Decision Note — Braintrust Findings and Revised Standing

Date: **August 13, 2026**
Status: **Supersedes the differentiation and defensibility claims in [`06-runtime-calibrated-pr-review-recommendation.md`](06-runtime-calibrated-pr-review-recommendation.md). Document 06 is preserved unchanged as the dated record of how the wedge was selected.**

> **SUPERSEDED — August 13, 2026.** The "continue validation" decision below is reversed, and §3's claim that the PR comment contains no cost field is **factually wrong**. Source-code analysis showed the PR comment renders estimated cost and token deltas. See [`08-braintrust-reassessment.md`](08-braintrust-reassessment.md). Preserved unchanged as the record of the superseded reasoning.

## Purpose

Document 06 selected Segment A × W2 (runtime-calibrated AI pull-request review) and scored it on assumptions about what competitors do. A documentation investigation of Braintrust on August 13, 2026 refuted part of that basis. This note records what changed and what survived, as judged on the date written.

**It does not rewrite document 06.** Reading them in sequence shows the reasoning and its correction, which is the point.

---

## 1. What Braintrust already provides

All **documented facts** from primary sources, checked August 13, 2026.

| Capability                                                     | Evidence                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Production logs → evaluation datasets**                      | "Production data seamlessly becomes evaluation datasets"; "Instrumentation code works for both logging and evaluation"; "Traces capture identical data in production and testing" ([docs](https://www.braintrust.dev/docs/guides/logs))             |
| **Replay of production inputs through changed configurations** | Composition of documented features: logs convert to datasets, experiments run a task over a dataset, and experiments are compared to measure "improvements and regressions between runs" ([docs](https://www.braintrust.dev/docs/guides/evals/run)) |
| **PR-time evaluation**                                         | `braintrustdata/eval-action` "runs Braintrust evals in GitHub Actions and posts a live summary comment on the associated pull request" ([repo](https://github.com/braintrustdata/eval-action))                                                      |
| **Quality comparison**                                         | PR comment reports Score with percentage-point change, Average, Improvements count, Regressions count, Duration ([repo](https://github.com/braintrustdata/eval-action))                                                                             |
| **Merge gating**                                               | Merges blocked when scores fall below a threshold ([source](https://www.braintrust.dev/articles/best-tools-tracking-llm-costs-2026))                                                                                                                |
| **Per-span cost and tokens**                                   | "Token and cost data is available on every span, including LLM calls, retrieval steps, and individual tool invocations" ([source](https://www.braintrust.dev/articles/best-tools-tracking-llm-costs-2026))                                          |
| **Online scoring of production traces**                        | Evaluates production traces asynchronously as logged ([docs](https://www.braintrust.dev/docs/guides/logs/score))                                                                                                                                    |

## 2. These are dependencies or integrations — not ANVILMARK differentiators

**This is the correction.** Document 06 treated replay and PR-time quality evaluation as part of what ANVILMARK would uniquely provide. They are not. They are shipped, documented, and available to any Braintrust customer today.

Consequences, binding on all future work:

1. **ANVILMARK must not claim replay as a differentiator.** Braintrust does it.
2. **ANVILMARK must not claim PR-time quality evaluation as a differentiator.** Braintrust does it, with merge blocking.
3. **[INFERENCE] Braintrust is better understood as a potential integration surface than as a pure rival.** A team already running Braintrust has solved dataset construction, eval execution, and the PR surface. Building those again would be waste. The open question is whether ANVILMARK's remaining capabilities could sit _on top of_ that stack rather than beside it — untested, and worth asking in interviews.
4. Any public comparison must state what Braintrust does well. A comparison that flatters ANVILMARK on every axis is checkable in minutes by anyone who has used the product, and will not be believed.

## 3. The remaining proposed differentiation

Three capabilities, all **absent from Braintrust's documentation** after targeted search. Absence from documentation is evidence, not proof — the hands-on trial converts it.

**a. Invoice-reconciled cost baselines.**
Reconstructing cost from telemetry and reconciling it against the actual provider invoice, with the residual attributed to named causes rather than absorbed. No documented equivalent found in any product reviewed. **[INFERENCE]** This is the trust gate: a prediction built on a baseline that does not match the bill the customer pays is not sellable.

**b. Projected monthly cost delta using measured production traffic.**
Estimating what a diff does to the monthly bill at the customer's actual volume and traffic distribution, with a composed interval. The documented PR-comment fields contain **no cost field**; the Observe surface describes cost tracking "in real time" — retrospective ([product](https://www.braintrust.dev/product/observe)).

**c. Post-deployment predicted-versus-actual scoring.**
Measuring what actually happened after deploy and publishing how accurate the pre-merge prediction was. No documented equivalent. The nearest documented capability is _alerting_ on cost anomalies ([source](https://www.braintrust.dev/articles/best-ai-observability-tools-2026)) — which asks "did something change?", not "was I right?"

## 4. Braintrust could plausibly absorb (b)

**[VERIFIED]** Braintrust holds an **$80M Series B led by Sequoia, $121M total**, with customers including Notion, Stripe, Zapier, Vercel, Ramp, Coursera, Dropbox, and Replit ([funding](https://www.tamradar.com/funding-rounds/braintrust-series-b-80m), [customers](https://www.braintrust.dev/)).

**[INFERENCE]** They already possess every input required for (b): per-span cost, production volume, and a PR comment surface. Adding a projected cost delta to an existing PR comment is a feature, not a platform change. Nothing found suggests they have done it; nothing found suggests they could not do it quickly.

Therefore:

- **Defensibility in document 06 §5 was scored 7. On this evidence, 5 is better supported.** W2's total moves from 64 to 62. The ranking is unchanged — W1 scored 50 — so the wedge remains the best of those considered.
- **The standalone business is unproven.** A capability that a well-funded incumbent can add in a quarter is not by itself a company. If ANVILMARK has a moat, it is the **accumulated calibration record** — a published, per-customer history of predictions and their errors — not any single capability. That is assumption A13, which is untested and arguably counterintuitive.
- (a) and (c) are harder to absorb than (b). **[INFERENCE]** (a) requires ingesting billing data that observability vendors have avoided touching; (c) requires publishing your own error rate, which is a positioning choice a market leader may not want to make. Neither is a moat, but both are more awkward for an incumbent than a cost column.

## 5. Decision (SUPERSEDED — historical)

> **[SUPERSEDED]** _"Continue validation. Do not build."_ — reversed by [`08-braintrust-reassessment.md`](08-braintrust-reassessment.md); the line is now closed entirely per [`11-anvilmark-closure-memo.md`](11-anvilmark-closure-memo.md).

W2 is the **best remaining hypothesis**, not a validated recommendation. Specifically:

|                      |                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Approved**         | Continue the validation sprint: recruiting, interviews, the Braintrust hands-on trial, and preparation up to the credential boundary. |
| **Not approved**     | Building ANVILMARK. Product implementation. Contract changes. A pivot of this repository.                                             |
| **Contract `0.1.0`** | Preserved, frozen, unchanged.                                                                                                         |
| **Repository**       | No packages, schemas, fixtures, MCP tools, or web application modified.                                                               |

### What must be true before "build" is even discussable

1. The three remaining differentiators survive the hands-on trial (T1–T7 in [`../validation/braintrust-hands-on-test-plan.md`](../validation/braintrust-hands-on-test-plan.md)).
2. Teams grant telemetry access (A1) — still zero evidence.
3. A baseline reconciles credibly against a real invoice (A3) — still zero evidence.
4. The method predicts (A4) — never attempted.
5. Someone pays (A7) — still zero evidence.
6. A plausible answer exists to "why does Braintrust not simply add this?" that does not rest on hope.

Item 6 is new, and it is the one this note adds. **[INFERENCE]** It cannot be answered by more desk research. It is answered by evidence that customers value the calibration record itself — which is why A13 matters more than its Tier 3 placement suggested.

## 6. Revised claim language

Any external description of ANVILMARK is now limited to:

> We predict what a code change does to your monthly bill at your measured traffic volume, and we publish how wrong we were.

**Must not appear:** replay of production inputs, PR-time quality evaluation, merge gating on quality, or dataset construction from production logs. Braintrust does all of these.

**Also must not appear:** anything from the superseded graph hypothesis — architecture decision systems, vendor-neutral optimization, conformance. None of it is supported by any evidence gathered.

## 7. Standing of earlier documents

| Document                                                                                         | Standing                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`06-...recommendation.md`](06-runtime-calibrated-pr-review-recommendation.md)                   | **Preserved unchanged.** Its wedge selection stands; its differentiation and defensibility claims are superseded by §2–§4 above. |
| [`05-market-verdict-and-next-decisions.md`](05-market-verdict-and-next-decisions.md) and earlier | Historical record. Unchanged.                                                                                                    |
| [`../validation/competitor-validation-matrix.md`](../validation/competitor-validation-matrix.md) | **Current.** Holds the per-capability evidence and the release gate.                                                             |
| [`../validation/assumption-register.md`](../validation/assumption-register.md)                   | **Current.** A11 is `PARTIAL`.                                                                                                   |
