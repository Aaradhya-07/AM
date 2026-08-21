# Validation Scorecard

The live tracker for the two-week sprint, and the final go/no-go.

**Sprint start date:** `{{not started}}`
**Status:** **NOT STARTED.** No outreach sent, no interviews conducted, no data requested.

**Rule:** every cell is filled with a measurement or with `NOT MEASURED`. A criterion that could not be measured because the input never arrived is scored **FAILED**, not `n/a`. Optimistic blanks at the decision gate are how a no-go becomes a maybe.

---

## 1. Recruiting funnel

| Stage                                 | Target | Actual | Notes |
| ------------------------------------- | :----: | :----: | ----- |
| Companies screened against the ICP    |  40+   |  `—`   |       |
| Passed screening (6/6 required items) |  20+   |  `—`   |       |
| Contacted                             |  20+   |  `—`   |       |
| Replied                               |   —    |  `—`   |       |
| Interviews booked                     |   15   |  `—`   |       |
| **Interviews completed**              | **15** |  `—`   |       |

### Screening rejections

Rejections are data. Record which checklist item failed most often — a dominant rejection reason means the ICP is mis-specified.

| Rejection reason              | Count |
| ----------------------------- | :---: |
| Under 5 or over 30 engineers  |  `—`  |
| No LLM on the critical path   |  `—`  |
| Spend below $2k/month         |  `—`  |
| No telemetry of any kind      |  `—`  |
| Pre-production only           |  `—`  |
| No PR process                 |  `—`  |
| No change in the last 90 days |  `—`  |
| Other                         |  `—`  |

---

## 2. Interview results

One row per interview. Scored per [`interview-guide.md`](interview-guide.md).

| #   | Company (code) | Date | Trigger | Spend/mo | D1 recency | D2 concrete | D3 cost | D4 latency | D5 access | D6 anchor | D7 reaction | **Total** | Showed PR? | FP pattern |
| --- | -------------- | ---- | ------- | -------- | :--------: | :---------: | :-----: | :--------: | :-------: | :-------: | :---------: | :-------: | :--------: | ---------- |
| 1   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 2   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 3   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 4   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 5   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 6   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 7   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 8   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 9   |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 10  |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 11  |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 12  |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 13  |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 14  |                |      |         |          |            |             |         |            |           |           |             |           |            |            |
| 15  |                |      |         |          |            |             |         |            |           |           |             |           |            |            |

### Derived

| Measure                                       | Target  | Actual |
| --------------------------------------------- | :-----: | :----: |
| **Scored 3 on D1 (incident within 90 days)**  | **≥ 5** |  `—`   |
| Scored 16–20 (strong)                         |    —    |  `—`   |
| Scored 11–15 (real)                           |    —    |  `—`   |
| Scored ≤ 10 (weak)                            |    —    |  `—`   |
| Showed a real PR or incident on screen        |    —    |  `—`   |
| Flagged as a false-positive pattern           |    —    |  `—`   |
| Named an existing tool that already does this |    —    |  `—`   |
| Named a condition for allowing merge blocking |   ≥ 5   |  `—`   |

---

## 3. Telemetry access — the critical measurement

**This table is the most important artifact in the sprint.** It tests A1 and A2 directly.

| #   | Company | Asked | Granted | Business days | Mode agreed | Blocker (verbatim) | In-CI changed the answer? |
| --- | ------- | ----- | ------- | :-----------: | ----------- | ------------------ | :-----------------------: |
| 1   |         |       |         |               |             |                    |                           |
| 2   |         |       |         |               |             |                    |                           |
| 3   |         |       |         |               |             |                    |                           |
| 4   |         |       |         |               |             |                    |                           |
| 5   |         |       |         |               |             |                    |                           |
| 6   |         |       |         |               |             |                    |                           |
| 7   |         |       |         |               |             |                    |                           |
| 8   |         |       |         |               |             |                    |                           |

### Derived

| Measure                                   | Success |     Failure      | Actual |
| ----------------------------------------- | :-----: | :--------------: | :----: |
| Teams asked                               |    8    |        —         |  `—`   |
| **Granted within 5 business days**        | **≥ 3** |        —         |  `—`   |
| **Granted at all**                        |    —    | **< 2 → KILL 2** |  `—`   |
| Median turnaround (business days)         |    —    |        —         |  `—`   |
| Accepted Mode A (in-CI)                   |   ≥ 3   |        —         |  `—`   |
| Accepted Mode B (shared sample)           |    —    |        —         |  `—`   |
| Mode C only (metadata)                    |    —    |        —         |  `—`   |
| Refused entirely                          |    —    |        —         |  `—`   |
| **In-CI execution flipped a no to a yes** |    —    |        —         |  `—`   |

**[INFERENCE]** The last row is the most strategically informative number in the sprint. If in-CI execution reliably converts refusals into acceptances, it is the single most important design constraint on whatever gets built.

---

## 4. Baseline reconciliation

| #   | Company | Providers | Window aligned to billing period? | Reconstructed | Invoiced | Variance | Explained | **Unexplained residual** | Credible? |
| --- | ------- | --------- | :-------------------------------: | ------------- | -------- | :------: | --------- | :----------------------: | :-------: |
| 1   |         |           |                                   |               |          |          |           |                          |           |
| 2   |         |           |                                   |               |          |          |           |                          |           |
| 3   |         |           |                                   |               |          |          |           |                          |           |
| 4   |         |           |                                   |               |          |          |           |                          |           |
| 5   |         |           |                                   |               |          |          |           |                          |           |

### Reconciliation problems encountered

Across all engagements. Tests whether [`experiment-protocol.md`](experiment-protocol.md) §3 anticipated reality.

| #   | Problem                     | Times found | Typical magnitude                                 |
| --- | --------------------------- | :---------: | ------------------------------------------------- |
| 1   | Credits and free tiers      |     `—`     |                                                   |
| 2   | Committed-use discounts     |     `—`     |                                                   |
| 3   | Batch API discounts         |     `—`     |                                                   |
| 4   | Prompt caching              |     `—`     |                                                   |
| 5   | Gateway/router markup       |     `—`     |                                                   |
| 6   | Retries                     |     `—`     |                                                   |
| 7   | Failed/cancelled calls      |     `—`     |                                                   |
| 8   | Multiple providers          |     `—`     |                                                   |
| 9   | Billing-period misalignment |     `—`     |                                                   |
| 10  | Non-LLM charges on the bill |     `—`     |                                                   |
| 11  | Proxy bypass                |     `—`     |                                                   |
| 12  | Undeclared sampling         |     `—`     |                                                   |
| 13  | Price-list drift            |     `—`     |                                                   |
| 14  | Currency and tax            |     `—`     |                                                   |
| 15  | Cross-period straddling     |     `—`     |                                                   |
| 16  | Self-hosted components      |     `—`     |                                                   |
| 17  | Multiple accounts/orgs      |     `—`     |                                                   |
| —   | **Problem not on the list** |     `—`     | **Record in detail — the protocol is incomplete** |

| Measure                                     |   Success    |     Failure      | Actual |
| ------------------------------------------- | :----------: | :--------------: | :----: |
| **Reconciled with an explained residual**   | **≥ 3 of 5** | **< 2 → KILL 3** |  `—`   |
| Refunds triggered by reconciliation failure |      —       |        —         |  `—`   |

---

## 5. Call-site mapping and sampling

| #   | Company | Mapping method | Confidence | MDE (cost) | MDE (quality) | Pilot variance | Required n | Achieved n | Feasible? |
| --- | ------- | -------------- | :--------: | ---------- | ------------- | -------------- | :--------: | :--------: | :-------: |
| 1   |         |                |            |            |               |                |            |            |           |
| 2   |         |                |            |            |               |                |            |            |           |
| 3   |         |                |            |            |               |                |            |            |           |
| 4   |         |                |            |            |               |                |            |            |           |
| 5   |         |                |            |            |               |                |            |            |           |

| Measure                              | Success  | Actual |
| ------------------------------------ | :------: | :----: |
| Mapping at high/medium confidence    | ≥ 3 of 5 |  `—`   |
| Required sample affordable           | ≥ 3 of 5 |  `—`   |
| Quality signal at tier 1–3 available | ≥ 3 of 5 |  `—`   |

---

## 6. Retrospective predictions

**Predictions must be recorded before the actual is examined.** A row where that did not happen is not usable for calibration and must be marked.

| #   | Company | PR  | Predicted Δcost (interval) | Actual Δcost | Direction ✓ | Inside interval? | Magnitude error | Predicted Δquality | Actual Δquality | Noise floor cleared? | Prediction recorded first? |
| --- | ------- | --- | -------------------------- | ------------ | :---------: | :--------------: | :-------------: | ------------------ | --------------- | :------------------: | :------------------------: |
| 1   |         |     |                            |              |             |                  |                 |                    |                 |                      |                            |
| 2   |         |     |                            |              |             |                  |                 |                    |                 |                      |                            |
| 3   |         |     |                            |              |             |                  |                 |                    |                 |                      |                            |
| 4   |         |     |                            |              |             |                  |                 |                    |                 |                      |                            |
| 5   |         |     |                            |              |             |                  |                 |                    |                 |                      |                            |

### Derived

| Measure                                   | Success |          Failure           | Actual |
| ----------------------------------------- | :-----: | :------------------------: | :----: |
| Predictions completed                     |   ≥ 3   |             —              |  `—`   |
| **Direction correct**                     | **≥ 3** | **wrong on ≥ 2 → KILL 4**  |  `—`   |
| Actual inside predicted interval          |    —    | routinely outside → KILL 4 |  `—`   |
| Median magnitude error                    |    —    |             —              |  `—`   |
| Reports declaring "insufficient evidence" |    —    |             —              |  `—`   |

**Note:** a report declaring insufficient evidence is **not** a failed prediction. It is the protocol working. Count these separately and do not treat them as errors.

### Error attribution

| Source                     | Times dominant |
| -------------------------- | :------------: |
| Replay sampling            |      `—`       |
| Volume projection          |      `—`       |
| Traffic-mix drift          |      `—`       |
| Cache behaviour difference |      `—`       |
| Confounding deploy changes |      `—`       |
| Price change               |      `—`       |

---

## 7. Reports and outcomes

| #   | Company | Report delivered | Human review done | Verdict | Changed a decision? | Reaction to scorecard | Paid? |
| --- | ------- | :--------------: | :---------------: | ------- | :-----------------: | --------------------- | :---: |
| 1   |         |                  |                   |         |                     |                       |       |
| 2   |         |                  |                   |         |                     |                       |       |
| 3   |         |                  |                   |         |                     |                       |       |
| 4   |         |                  |                   |         |                     |                       |       |
| 5   |         |                  |                   |         |                     |                       |       |

| Measure                                                     |    Success     |            Failure             | Actual |
| ----------------------------------------------------------- | :------------: | :----------------------------: | :----: |
| Reports delivered                                           |      ≥ 3       |               —                |  `—`   |
| **Changed a merge decision, or "I would have merged that"** |    **≥ 1**     |               —                |  `—`   |
| **Paid $1,000+**                                            |    **≥ 2**     | **0 after 5 reports → KILL 6** |  `—`   |
| Said an existing tool already covers it                     |       —        |          **→ KILL 5**          |  `—`   |
| Named monthly price (median)                                |     ≥ $500     |       seat-price cluster       |  `—`   |
| Reaction to a _wrong_ prediction                            | trust-building |         disengagement          |  `—`   |

---

## 8. Competitor trials

Per [`competitor-validation-matrix.md`](competitor-validation-matrix.md). Every `?` must become a confirmed mark.

| Product         | Trial done | C5 cost at real volume | C8 self-scoring | C2 invoice recon | Verdict |
| --------------- | :--------: | :--------------------: | :-------------: | :--------------: | ------- |
| **Braintrust**  |            |                        |                 |                  |         |
| promptfoo       |            |                        |                 |                  |         |
| Langfuse        |            |                        |                 |                  |         |
| Helicone        |            |                        |                 |                  |         |
| PromptScan      |            |                        |                 |                  |         |
| Datadog LLM Obs |            |                        |                 |                  |         |

| Measure                                                 |               Actual                |
| ------------------------------------------------------- | :---------------------------------: |
| **C8 confirmed absent in all six**                      |                 `—`                 |
| **C5 confirmed absent or materially weaker in all six** |                 `—`                 |
| C2 confirmed absent in all six                          |                 `—`                 |
| **Braintrust does both C5 and C8**                      | `—` → **if yes: STOP AND REASSESS** |

---

## 9. Success criteria

All six must hold.

| #   | Criterion         | Threshold                                 | Actual | Met? |
| --- | ----------------- | ----------------------------------------- | :----: | :--: |
| 1   | Recent problem    | ≥ 5 of 15 within 90 days                  |  `—`   | `—`  |
| 2   | Telemetry access  | ≥ 3 of 5 within 5 business days           |  `—`   | `—`  |
| 3   | Baseline credible | ≥ 3 of 5 with explained residual          |  `—`   | `—`  |
| 4   | Method predicts   | ≥ 3 correct direction, intervals sensible |  `—`   | `—`  |
| 5   | Commercial signal | ≥ 2 paid $1,000, or changed a decision    |  `—`   | `—`  |
| 6   | The quote         | ≥ 1 "I would have merged that"            |  `—`   | `—`  |

**Met: `—` of 6.**

## 10. Kill criteria

Any one triggers a stop.

| #   | Criterion               | Trigger                                              | Actual | Triggered? | Scope                          |
| --- | ----------------------- | ---------------------------------------------------- | :----: | :--------: | ------------------------------ |
| 1   | Problem not recent      | < 5 of 15                                            |  `—`   |    `—`     | Segment                        |
| 2   | No telemetry access     | < 2 grant, incl. in-CI                               |  `—`   |    `—`     | **Wedge only — not ANVILMARK** |
| 3   | Baseline unreconcilable | < 2 with explained residual                          |  `—`   |    `—`     | Wedge                          |
| 4   | Method fails            | direction wrong ≥ 2 of 5, or intervals miscalibrated |  `—`   |    `—`     | Wedge                          |
| 5   | Absorbed                | teams say an existing tool covers it                 |  `—`   |    `—`     | Wedge                          |
| 6   | Not urgent              | 0 paid after 5 reports                               |  `—`   |    `—`     | Segment                        |

**Triggered: `—` of 6.**

---

## 11. Final decision

**Date:** `—`

|                         |                                                                |
| ----------------------- | -------------------------------------------------------------- |
| Success criteria met    | `—` of 6                                                       |
| Kill criteria triggered | `—` of 6                                                       |
| **Outcome**             | **`GO` / `CONDITIONAL` / `NO-GO (wedge)` / `NO-GO (segment)`** |

### Written rationale

`{{Two or three paragraphs. State what the evidence showed, not what was hoped. If the outcome is NO-GO, state which specific evidence forced it and what the next candidate is. Per the standing scope rule: a wedge-level NO-GO does not terminate ANVILMARK — it returns the decision to the wedge table in document 06.}}`

### What we learned that we did not expect

`{{The most valuable section. Surprises are the point of a validation sprint. Record them even when — especially when — they are inconvenient.}}`

### Next step

`{{If GO: draft a product specification for approval. Nothing is implemented and no contract is touched until that specification is approved separately.}}`
`{{If CONDITIONAL: name the single weak criterion and the targeted two-week extension.}}`
`{{If NO-GO: name the specific next candidate and what would have to be true for it.}}`

---

## Standing reminders

- Contract `0.1.0` remains **frozen and preserved** regardless of outcome.
- No application code, package, fixture, schema, MCP tool, or web surface is modified during validation.
- A GO authorizes a **specification**, not implementation.
