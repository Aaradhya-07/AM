# Assumption Register

Every load-bearing assumption behind the runtime-calibrated PR review wedge, with its test, thresholds, status, and the consequence if it turns out to be false.

**Status values:** `UNTESTED` · `TESTING` · `CONFIRMED` · `REFUTED` · `PARTIAL`
**A11 is `REFUTED`. All others remain `UNTESTED` and will stay so — validation was stopped before any customer contact.** No company or individual was contacted. See [`../research/08-braintrust-reassessment.md`](../research/08-braintrust-reassessment.md).

**Rule:** an assumption is only moved to `CONFIRMED` by evidence meeting its stated success threshold. Encouraging conversation is not evidence. An assumption that cannot be tested within the sprint stays `UNTESTED` and its consequence is carried into the go/no-go as an open risk.

---

## Tier 1 — Fatal if false

Refutation of any of these ends the wedge.

### A1 — Teams will grant access to production LLM telemetry

|                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | Segment A teams will grant read access to 30 days of per-call LLM telemetry within 5 business days of agreeing in principle.                                                                                                                                                                                                                                                                                                                                                                                               |
| **Why load-bearing**  | Without it there is no traffic profile, no baseline, no calibration. The entire method has no inputs.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Current evidence**  | **None.** Zero teams asked. **[ASSUMPTION]**                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Test**              | Ask 8 qualified teams on Day 5. Measure calendar time from ask to data in hand, and log every blocker verbatim.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Success threshold** | ≥ 3 of 8 grant access within 5 business days.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Failure threshold** | < 2 of 8 grant access at all, including under in-CI execution.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Status**            | `UNTESTED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **If false**          | **This wedge dies.** It does **not** kill ANVILMARK. Return to the wedge table in [`../research/06-runtime-calibrated-pr-review-recommendation.md`](../research/06-runtime-calibrated-pr-review-recommendation.md) §5 and reconsider W5 or W1 — noting that both scored materially lower, and that without runtime data neither is differentiated against ArchRails or the free GovForge. A realistic outcome is that no wedge in the current table survives, and the segment or the whole direction must be reconsidered. |

### A2 — Teams will permit replay against real recorded inputs

|                       |                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | Teams will permit replay of real recorded production inputs, given that execution defaults to their own CI or infrastructure and only aggregates are returned.                                          |
| **Why load-bearing**  | Quality measurement is impossible without real inputs. Cost estimates degrade substantially.                                                                                                            |
| **Current evidence**  | **None. [ASSUMPTION]**                                                                                                                                                                                  |
| **Test**              | Interview question 20 asks the metadata question and the content question separately, then asks whether in-CI execution changes the answer. Then observe what actually happens on Day 6–9.              |
| **Success threshold** | ≥ 3 of 8 accept Mode A (in-CI). Any acceptance of Mode B is a bonus.                                                                                                                                    |
| **Failure threshold** | < 2 accept any mode permitting replay.                                                                                                                                                                  |
| **Status**            | `UNTESTED`                                                                                                                                                                                              |
| **If false**          | Fall back to Mode C (metadata only). Cost intervals widen materially and **quality cannot be measured at all**. Test whether a cost-only report retains value — if it does not, the wedge dies with A1. |

### A3 — A cost baseline can be reconciled credibly

|                       |                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | A cost baseline reconstructed from telemetry can be reconciled against a provider invoice to a variance we are willing to state in writing, with the residual attributed to named causes.                                                       |
| **Why load-bearing**  | Nobody buys a prediction built on a baseline that does not match the bill they actually pay. This is the trust gate.                                                                                                                            |
| **Current evidence**  | **None.** [`experiment-protocol.md`](experiment-protocol.md) §3 lists 17 known reconciliation problems, none yet encountered in practice. **[INFERENCE]** credits, commitment discounts, and cache accounting are the most likely to defeat it. |
| **Test**              | Attempt reconciliation for every team supplying data. Complete the 17-item checklist each time.                                                                                                                                                 |
| **Success threshold** | ≥ 3 of 5 reconcile with the residual **explained**, whatever its size.                                                                                                                                                                          |
| **Failure threshold** | Fewer than 2 reconcile with an explained residual.                                                                                                                                                                                              |
| **Status**            | `UNTESTED`                                                                                                                                                                                                                                      |
| **If false**          | Refund per the offer's exit condition. **The wedge dies**, because a prediction resting on an unverifiable baseline is exactly the false precision document 06 rejected.                                                                        |

### A4 — The method predicts

|                       |                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | A paired replay on an achievable sample predicts the direction and approximate magnitude of a real change's effect, with intervals that behave sensibly.                                                         |
| **Why load-bearing**  | If the method does not predict, there is no product regardless of demand.                                                                                                                                        |
| **Current evidence**  | **None.** Not attempted once. **[ASSUMPTION]**                                                                                                                                                                   |
| **Test**              | ≥ 3 retrospective PRs. Prediction recorded **before** the actual is examined ([`experiment-protocol.md`](experiment-protocol.md) §15).                                                                           |
| **Success threshold** | Direction correct on ≥ 3, and actual falling within the predicted interval at a rate not obviously worse than the stated level.                                                                                  |
| **Failure threshold** | Direction wrong on ≥ 2 of 5, or actuals routinely far outside stated intervals.                                                                                                                                  |
| **Status**            | `UNTESTED`                                                                                                                                                                                                       |
| **If false**          | Diagnose first: sampling, volume projection, cache modelling, replay fidelity, or confounding? A fixable methodological error is not the same as a failed premise. If the errors are structural, the wedge dies. |

---

## Tier 2 — Shapes the product, not fatal

### A5 — The problem is recent and recurring

|                       |                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | Segment A teams experienced a cost-or-quality regression from an AI code change within the last 90 days, and expect it to recur.                                 |
| **Current evidence**  | **[RESEARCH]** `05-market-verdict` speculated the buyer is an engineering team with governance needs. No direct evidence of this specific pain. **[ASSUMPTION]** |
| **Test**              | Interview dimension 1. Requires a dated incident, shown where possible.                                                                                          |
| **Success threshold** | ≥ 5 of 15 score 3 on dimension 1.                                                                                                                                |
| **Failure threshold** | < 5 of 15. **This is kill criterion 1.**                                                                                                                         |
| **Status**            | `UNTESTED`                                                                                                                                                       |
| **If false**          | Wrong segment, or the problem is not yet acute at this stage. Re-examine Segment B, accepting that its wedge is competed by free software.                       |

### A6 — The merge is a real decision point

|                       |                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | Teams currently ship AI changes without knowing the consequence, and would change behaviour given a credible number.                                                 |
| **Current evidence**  | **[VERIFIED]** PromptScan built PR cost-delta comments and has 0 stars — which reads either as no demand, or as static estimates being untrustworthy. Unresolved.    |
| **Test**              | Interview section 2 (expectation vs outcome, detection latency) and question 25 (what would let it block a merge). Then: did any delivered report change a decision? |
| **Success threshold** | ≥ 1 team verifiably changes a merge decision, **or** ≥ 1 says "I would have merged that and been wrong."                                                             |
| **Failure threshold** | All 15 report they already know the consequence before merging.                                                                                                      |
| **Status**            | `UNTESTED`                                                                                                                                                           |
| **If false**          | The decision point is wrong. Cost attribution or migration planning may be the real job. Re-shape rather than kill.                                                  |

### A7 — Willingness to pay anchors to the bill

|                       |                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Statement**         | Pricing anchors to a fraction of inference spend ($1,000–$3,000/month), not to a developer-tool seat price.        |
| **Current evidence**  | **None. [ASSUMPTION]** — the entire revenue score of 8 rests on this.                                              |
| **Test**              | Interview question 16 (current spend anchor), the $1,000 offer, and debrief question 3.                            |
| **Success threshold** | ≥ 2 pay $1,000, and named monthly figures cluster above $500.                                                      |
| **Failure threshold** | Zero paid commitments after 5 delivered reports, or figures cluster at seat prices.                                |
| **Status**            | `UNTESTED`                                                                                                         |
| **If false**          | Revenue potential drops from 8 toward 4, and W2's total falls near W1's. The recommendation would need revisiting. |

### A8 — Traffic concentrates enough to sample affordably

|                       |                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Statement**         | Production traffic concentrates on few enough call sites, with low enough variance, that the statistically required sample is affordable in money and time.                                |
| **Current evidence**  | **None. [ASSUMPTION]** — **[INFERENCE]** heavy-tailed token distributions and rare failure modes could push requirements beyond feasibility, particularly for open-ended generation.       |
| **Test**              | Pilot-sample variance measurement per call site ([`experiment-protocol.md`](experiment-protocol.md) §5). Record required versus achievable for every site.                                 |
| **Success threshold** | Required sample is affordable for ≥ 3 of 5 target call sites at the customer's stated MDE.                                                                                                 |
| **Failure threshold** | Requirements routinely exceed feasibility, forcing "insufficient evidence" on most reports.                                                                                                |
| **Status**            | `UNTESTED`                                                                                                                                                                                 |
| **If false**          | Narrow to task types that converge quickly — classification, extraction, structured output. That is a smaller market but a real one. **Do not respond by quietly using a smaller sample.** |

### A9 — Call sites are identifiable in real telemetry

|                       |                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | A PR diff can be mapped to a measured call-site population in real-world telemetry, not just in principle.                                                                              |
| **Current evidence**  | **[INFERENCE]** Most teams do not tag call sites deliberately. OTel span names plus code attributes are the best realistic default; proxy-based setups may only have custom properties. |
| **Test**              | Attempt mapping for every engagement. Record which of the six methods in [`telemetry-requirements.md`](telemetry-requirements.md) §2 worked.                                            |
| **Success threshold** | Mapping achieved at high or medium confidence for ≥ 3 of 5.                                                                                                                             |
| **Failure threshold** | Mapping is inferred-only or impossible for most teams.                                                                                                                                  |
| **Status**            | `UNTESTED`                                                                                                                                                                              |
| **If false**          | The product may need to ship instrumentation, which lengthens time-to-value and undercuts the "consume what exists" premise. Materially worse, but survivable.                          |

### A10 — A usable quality signal exists without an LLM judge

|                       |                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | Most target call sites have a tier 1–3 quality signal (deterministic check, existing eval, or customer-defined metric).                                         |
| **Current evidence**  | **[ASSUMPTION]** — [`experiment-protocol.md`](experiment-protocol.md) §9 mandates the hierarchy, but says nothing about how often tier 1 is actually available. |
| **Test**              | Interview question 15 and the quality-definition session in each engagement.                                                                                    |
| **Success threshold** | ≥ 3 of 5 engagements have a tier 1–3 signal for the target call site.                                                                                           |
| **Failure threshold** | Most call sites have no signal above tier 5.                                                                                                                    |
| **Status**            | `UNTESTED`                                                                                                                                                      |
| **If false**          | Quality claims rest on judges and human review, weakening the merge recommendation considerably. Consider narrowing to call sites with deterministic outputs.   |

---

## Tier 3 — Strategic

### A11 — Braintrust has not already closed this gap

|                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**               | No existing product predicts cost at real volume at merge time and scores its own prediction post-deploy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Current evidence**        | **Documentation investigation completed August 13, 2026** (see [`competitor-validation-matrix.md`](competitor-validation-matrix.md)). **Documented fact:** Braintrust's PR-comment fields are Score, Average, Improvements, Regressions, Duration — **no cost field** ([repo](https://github.com/braintrustdata/eval-action)); the Observe surface describes cost tracking "in real time", i.e. retrospective ([product](https://www.braintrust.dev/product/observe)). **Absent from documentation:** monthly cost projection, invoice reconciliation, predicted-vs-actual scoring. **Also documented, and adverse:** production logs convert to eval datasets and experiments compare configurations — so **replay (C4) is confirmed present and is not a differentiator**. |
| **Test**                    | Hands-on trial, priority 1, Days 1–5 — [`braintrust-hands-on-test-plan.md`](braintrust-hands-on-test-plan.md), tests T1–T7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Success threshold**       | T2, T3, and T5 all pass: no cost field in the PR comment, no volume projection, no self-scoring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Failure threshold**       | T2, T3, or T5 fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Status**                  | **`REFUTED`** — August 13, 2026. Source-code analysis shows the PR comment renders `summary.metrics`, which includes Estimated LLM cost. Cost at merge time is shipped. See [`../research/08-braintrust-reassessment.md`](../research/08-braintrust-reassessment.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **If false**                | **Stop the sprint and reassess.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Revision already forced** | **[INFERENCE]** Two findings weaken the wedge without refuting it. (a) Replay is occupied, so the differentiator narrows to the cost dimension and the calibration loop only. (b) **[VERIFIED]** Braintrust holds an $80M Series B led by Sequoia, $121M total ([source](https://www.tamradar.com/funding-rounds/braintrust-series-b-80m)), and already possesses every input required for C5 — per-span cost, production volume, and a PR surface. Adding a cost projection to an existing PR comment is a small feature, not a platform change. **Document 06 §5 scored defensibility at 7; on this evidence 5 is better supported**, lowering W2's total from 64 to 62 — which does not change the ranking, since W1 scored 50.                                           |

### A12 — Teams will let a calibrated check gate a merge

|                       |                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | Teams would eventually allow this check to block a merge, rather than treating it as advisory.                                                                                                                              |
| **Current evidence**  | **[INFERENCE]** ArchRails and GovForge both sell merge-blocking, suggesting appetite exists for deterministic gates. Whether it extends to a _probabilistic_ gate is unknown — and that difference may matter a great deal. |
| **Test**              | Interview question 25.                                                                                                                                                                                                      |
| **Success threshold** | ≥ 5 of 15 name a condition under which they would allow blocking.                                                                                                                                                           |
| **Failure threshold** | Universal rejection of blocking on a probabilistic verdict.                                                                                                                                                                 |
| **Status**            | `UNTESTED`                                                                                                                                                                                                                  |
| **If false**          | Advisory-only positioning. Lower urgency and lower willingness to pay, but still viable.                                                                                                                                    |

### A13 — The scorecard builds trust rather than destroying it

|                       |                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | Publishing predicted-versus-actual, including failures, increases customer trust.                                                                                                                                   |
| **Current evidence**  | **[INFERENCE]** — this is the strategic bet of the whole wedge, and it is untested. The opposite is plausible: a visibly wrong prediction may simply be read as an unreliable tool.                                 |
| **Test**              | Deliver at least one scorecard where the prediction was wrong. Observe the reaction.                                                                                                                                |
| **Success threshold** | Customers describe the scorecard as trust-building or as the most valuable part.                                                                                                                                    |
| **Failure threshold** | A wrong prediction causes disengagement.                                                                                                                                                                            |
| **Status**            | `UNTESTED`                                                                                                                                                                                                          |
| **If false**          | **Serious.** Self-scoring is the differentiator and the defensibility argument. If honesty about error repels customers, the strategy needs rethinking — though it should not be abandoned by simply hiding errors. |

### A14 — Reuse of the existing repository is minimal

|                       |                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Statement**         | Roughly 10% of the existing scaffold is reusable; contract `0.1.0`'s shape is unsuitable for this wedge.                                                                                |
| **Current evidence**  | **[REPO]** Confirmed by reading the code. The contract's static-estimate finding shape assumes source-only estimation with no interval, no evidence provenance, and no runtime linkage. |
| **Test**              | Only relevant if the sprint reaches GO and a specification is drafted.                                                                                                                  |
| **Success threshold** | n/a — this is an estimate, not a hypothesis to confirm.                                                                                                                                 |
| **Status**            | `UNTESTED` — **and deliberately not tested during validation.**                                                                                                                         |
| **If false**          | Good news: more reuse than expected. **Contract `0.1.0` remains frozen and preserved regardless of the outcome**, per standing instruction.                                             |

---

## Summary

| ID  | Assumption                            | Tier | Status        | Tested by      |
| --- | ------------------------------------- | :--: | ------------- | -------------- |
| A1  | Telemetry access granted              |  1   | `UNTESTED`    | Day 5–7        |
| A2  | Replay against real inputs permitted  |  1   | `UNTESTED`    | Day 5–9        |
| A3  | Baseline reconciles credibly          |  1   | `UNTESTED`    | Day 6–7        |
| A4  | The method predicts                   |  1   | `UNTESTED`    | Day 10–11      |
| A5  | Problem is recent and recurring       |  2   | `UNTESTED`    | Day 3–4        |
| A6  | Merge is a real decision point        |  2   | `UNTESTED`    | Day 3–4, 12–13 |
| A7  | WTP anchors to the bill               |  2   | `UNTESTED`    | Day 13–14      |
| A8  | Traffic concentrates enough to sample |  2   | `UNTESTED`    | Day 8–9        |
| A9  | Call sites identifiable in practice   |  2   | `UNTESTED`    | Day 6–9        |
| A10 | Quality signal exists above tier 5    |  2   | `UNTESTED`    | Day 3–4, 8     |
| A11 | Braintrust has not closed the gap     |  3   | **`PARTIAL`** | Day 1–5        |
| A12 | Teams would allow merge blocking      |  3   | `UNTESTED`    | Day 3–4        |
| A13 | Scorecard builds trust                |  3   | `UNTESTED`    | Day 12–13      |
| A14 | Repository reuse is ~10%              |  3   | `UNTESTED`    | Post-GO only   |

**Update this register as evidence arrives — during the sprint, not after it.** An assumption whose status is stale is worse than one marked untested, because it invites false confidence at the decision gate.
