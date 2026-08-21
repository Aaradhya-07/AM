# Experiment Protocol

The method for producing a Calibrated Merge Report and scoring it afterward.

**Governing rule, which outranks every other instruction in this document:**

> **Never invent numerical certainty.** Where evidence does not support a number, the report states _insufficient evidence_ and names precisely what is missing. A report that declines to answer is a success. A report that answers confidently on inadequate evidence is a failure, even if it happens to be right.

---

## 1. Baseline reconstruction

Build a **traffic profile** per call site from 30 days of telemetry ([`telemetry-requirements.md`](telemetry-requirements.md)).

### Steps

1. **Ingest and normalize** to the minimum event schema. Record every field that had to be inferred or was absent.
2. **Filter to production.** Exclude staging, CI, development, and load-test traffic. **Verify the filter worked** — compare filtered volume against an independent count if one exists.
3. **Reconstruct retry chains.** Group attempts by `request_id` / trace ID into logical requests. Maintain both counts: _billed attempts_ (drives cost) and _logical requests_ (drives volume forecasting). Conflating them is a common and serious error.
4. **Partition by call site** using the highest-reliability method available. Record which method was used and its confidence.
5. **Characterize distributions, not averages.** For each call site: input tokens, output tokens, reasoning tokens, cache read and write tokens, latency. Retain full empirical distributions — record p1, p5, p25, p50, p75, p95, p99, max, mean, variance, and skew. **Means alone are insufficient**; token distributions are typically right-skewed, and the tail drives cost.
6. **Compute the price basis.** Apply per-model, per-token-class prices for the exact model version, including separate rates for cached reads, cache writes, reasoning tokens, and batch calls where applicable. Record the price source and its retrieval date.
7. **Aggregate to a monthly reconstructed cost** per call site and in total.
8. **Characterize volume as a distribution over time**, not a single number. Daily volume with weekday/weekend structure, and a trend estimate. Monthly cost projection inherits this uncertainty — see §7.

### Output

A traffic profile per call site with every distribution retained, plus a written list of every field that was absent, inferred, or suspect.

---

## 2. Invoice reconciliation

**This is the trust-establishing step and it happens before any prediction.** If the baseline cannot be reconciled, the engagement stops here and is refunded ([`design-partner-offer.md`](design-partner-offer.md)).

### Method

1. Obtain the provider invoice total for a complete billing period, per provider.
2. Align the telemetry window to that **exact** billing period — same start, same end, same timezone as the provider uses. Do not compare a rolling 30 days against a calendar month.
3. Compute reconstructed cost for that aligned window.
4. Compute variance: `(reconstructed − invoiced) / invoiced`.
5. **Decompose the difference.** This is the part that matters. Attribute as much of the gap as possible to named causes from §3. Report the residual separately from the explained portion.
6. Publish variance, the itemized explanations, and the unexplained residual.

### Interpretation

**[INFERENCE]** No universal acceptance threshold is asserted here. The threshold that matters is whether the residual is _explained_, not whether it is small.

| Situation                                                                                     | Reading                                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Small variance, residual fully attributed to named causes                                     | Baseline is credible. Proceed.                                                                  |
| Large variance, **fully attributed** to named causes (e.g. an identified commitment discount) | Baseline may still be credible once corrected. Proceed with the correction stated.              |
| Small variance, residual **unexplained**                                                      | **Suspicious.** Offsetting errors are more likely than accuracy. Investigate before proceeding. |
| Large variance, unexplained                                                                   | **Stop.** Refund. Deliver the reconciliation attempt as the finding.                            |

A variance we cannot explain is not made acceptable by being small.

---

## 3. Known reconciliation problems

Every one of these must be checked explicitly and its status recorded — found, ruled out, or unknown. "Unknown" is a legitimate answer and must appear in the report.

| #   | Problem                         | Effect on reconstructed vs invoiced                                                                                                                               |
| --- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Credits and free tiers**      | Invoice lower. Promotional credits, startup credits, and trial allowances may zero out real usage entirely.                                                       |
| 2   | **Committed-use discounts**     | Invoice lower. Enterprise commitments, reserved throughput, and negotiated rates diverge from public price lists — often by a large and undisclosed margin.       |
| 3   | **Batch API discounts**         | Invoice lower. Typically ~50% off, on a separate line, with delayed completion crossing billing periods.                                                          |
| 4   | **Prompt caching**              | Invoice lower than a naive reconstruction. Cache reads are priced far below standard input; **cache writes are often priced above it.** Both directions matter.   |
| 5   | **Gateway/router markup**       | Invoice higher, or split across two vendors. Gateway-reported cost may already include margin; the underlying provider bill may be separate.                      |
| 6   | **Retries**                     | Either direction, depending on whether retries were counted once or per attempt.                                                                                  |
| 7   | **Failed and cancelled calls**  | Either direction. Some providers bill partial generations, content-filter refusals, and timeouts; some do not. Policy varies **by provider and by failure mode**. |
| 8   | **Multiple providers**          | Invoice fragmented. One call site with fallbacks spans several bills with different periods and currencies.                                                       |
| 9   | **Billing-period misalignment** | Either direction, and large. Calendar month vs 30-day rolling vs anniversary billing. Timezone of the cutoff matters.                                             |
| 10  | **Non-LLM charges on the bill** | Invoice higher. Embeddings, fine-tuning, storage, image and audio endpoints, seats, and support plans share the invoice. **Separate these before comparing.**     |
| 11  | **Proxy bypass**                | Reconstructed lower. Direct SDK calls invisible to the observability layer.                                                                                       |
| 12  | **Undeclared sampling**         | Reconstructed lower by exactly the sampling factor.                                                                                                               |
| 13  | **Price-list drift**            | Either direction. Public prices changed mid-period, or the model alias resolved to a differently-priced snapshot.                                                 |
| 14  | **Currency and tax**            | Invoice higher. VAT/GST and FX conversion applied at the provider's rate on their date.                                                                           |
| 15  | **Cross-period straddling**     | Long-running or batch requests initiated in one period and billed in the next.                                                                                    |
| 16  | **Self-hosted components**      | Not on any token invoice at all. Compute cost sits in a cloud bill with entirely different structure.                                                             |
| 17  | **Multiple accounts/orgs**      | Invoice fragmented across accounts, projects, or subsidiaries.                                                                                                    |

**Required artifact:** a completed table of all 17, each marked found / ruled out / unknown, with the estimated magnitude where found. This table appears in the report.

---

## 4. PR-to-call-site mapping

1. Obtain the diff.
2. Identify every changed line that affects an LLM call: model identifier, prompt text or template, sampling parameters, `max_tokens`, reasoning effort, routing logic, caching configuration, retry policy, tool definitions, or context assembly.
3. Map each to a `call_site_id` in the traffic profile using the §2 method from [`telemetry-requirements.md`](telemetry-requirements.md).
4. **Assess indirect impact.** A change to shared context assembly, a system prompt fragment, or a retrieval step affects call sites the diff does not name. Trace these deliberately; missing them is a silent, large error.
5. Record coverage: what fraction of measured spend at affected call sites is actually represented by the mapped population.

### Mapping failure conditions

| Condition                                                  | Action                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A changed call site has no telemetry                       | Report **insufficient evidence** for that call site. Do not estimate.                                                                      |
| Mapping is inferred rather than explicit                   | Proceed, state the inference and its confidence prominently.                                                                               |
| The change affects context assembly with untraceable reach | State the bound of what was analyzed, and that reach beyond it is unknown.                                                                 |
| The PR introduces an entirely new call site                | **No baseline exists.** Cost can be modelled from projected volume with a clearly labelled assumption; quality cannot be compared. Say so. |

---

## 5. Sampling strategy

**No fixed sample size is used.** The required sample is derived per call site, per metric, from measured properties. **[INFERENCE]** A number chosen in advance would be a guess dressed as a method.

### What determines the requirement

| Driver                                       | Effect                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Variance of the per-call cost difference** | The dominant driver for cost. High variance requires more samples, quadratically in the target precision.                                                                                 |
| **Skew and tail weight**                     | Right-skewed token distributions mean rare long outputs dominate the mean. Tails must be sampled deliberately.                                                                            |
| **Task type**                                | Deterministic short-output tasks (classification) converge quickly. Open-ended generation converges slowly.                                                                               |
| **Failure rarity**                           | To observe a failure mode occurring at rate _p_, expect to need on the order of several multiples of 1/_p_ samples to see it at all — before any question of estimating a _change_ in it. |
| **Minimum meaningful difference**            | Set by the customer, not by us. "Would a 2% quality drop matter, or only a 10% drop?" Smaller MDE, larger sample, quadratically.                                                          |
| **Paired design**                            | Replaying identical inputs through both configurations removes between-input variance, typically reducing the requirement substantially versus independent sampling. Always pair.         |

### Procedure

1. **Establish the minimum meaningful difference with the customer**, separately for cost and quality, before sampling. This is a business input, not a statistical one.
2. **Pilot.** Draw a small pilot sample (order 30–50) and measure the variance of the paired per-call difference, and the discordance rate for binary quality metrics.
3. **Compute the required sample** from the pilot variance and the agreed MDE, using the appropriate paired formulation — paired difference for continuous cost metrics, discordant-pair based methods (e.g. McNemar) for paired binary quality outcomes.
4. **Stratify.** Sample within strata (input length bands, input type, tenant class, cached vs uncached, success vs error) proportionally or with deliberate tail oversampling, then reweight to the population. Simple random sampling under-represents exactly the tail that drives cost.
5. **Check feasibility.** If the required sample exceeds what is available, affordable, or permitted, **do not proceed and report a number anyway.** Report the achievable precision instead, or declare insufficient evidence.
6. **Record everything**: pilot variance, MDE, computed requirement, achieved sample, strata, weights, and the reason for any shortfall.

### Feasibility limits

Replay costs real money and takes real time. Where the statistically required sample is unaffordable:

- report the **achievable** precision honestly and let the customer decide whether it is decision-useful;
- never silently substitute a smaller sample and report an interval as though it met the requirement.

---

## 6. Replay method

### Design

**Paired, on identical inputs.** The same recorded input goes through both the old and the new configuration. This is the single most important design choice: it removes between-input variance, which typically dominates.

### Required control: the non-determinism floor

**LLM outputs are stochastic.** At any temperature above zero, replaying the _same_ configuration twice produces different outputs, different token counts, and different quality scores. Without measuring this, a change cannot be distinguished from noise.

**Therefore, every replay includes an old-versus-old control arm.** Replay the old configuration against itself on the same inputs. This establishes the noise floor.

> **If the old-versus-new difference is not distinguishable from the old-versus-old difference, the report states that the change is indistinguishable from run-to-run variation.** It does not report the point estimate as though it were an effect.

### Execution

1. **Location: the customer's environment by default** (Mode A, [`telemetry-requirements.md`](telemetry-requirements.md) §8).
2. Draw the stratified sample of recorded inputs.
3. Execute three arms: old configuration, new configuration, and old-again control.
4. Use the customer's own API keys, region, and gateway so that pricing, routing, and caching behave as in production.
5. **Reproduce cache state honestly.** A cold replay of a call site that runs warm in production will misprice it badly in both directions. Model the measured production cache-hit rate explicitly, and state how it was handled.
6. Capture full token accounting per response: input, output, reasoning, cache read, cache write, plus latency, finish reason, and errors.
7. Retain outputs for quality evaluation, inside the customer's environment.

### Replay validity checks

Run these before trusting any result. Each failure is reported, not silently corrected.

| Check                                                                                   | Failure means                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Replayed-old token distribution matches the production distribution for the same inputs | Replay does not reproduce production. Investigate before proceeding. |
| Cache behaviour matches production rates                                                | Cost estimates will be systematically wrong.                         |
| Error rate is comparable to production                                                  | Rate limiting or a configuration difference is distorting the run.   |
| Latency is in a plausible range                                                         | Different region, tier, or capacity conditions.                      |

---

## 7. Cost-delta calculation

### Per call

For each sampled input _i_, compute cost under each configuration by summing across token classes at the current per-token prices, then take the paired difference `d_i = cost_new(i) − cost_old(i)`.

Token classes are priced separately and must not be collapsed: standard input, cached-read input, cache-write input, output, and reasoning.

### To a monthly figure

```text
monthly_delta = mean_paired_difference × projected_monthly_billed_calls
```

**The projection carries its own uncertainty, and it is frequently larger than the sampling uncertainty.** Both must be composed. Reporting only the bootstrap interval on the per-call difference, as though monthly volume were known exactly, overstates precision.

Sources of uncertainty to compose:

1. **Sampling** — from the replay sample, via paired bootstrap.
2. **Volume projection** — from measured daily volume variance and trend. State the projection basis explicitly (e.g. "assumes volume continues at the trailing 30-day rate").
3. **Price** — if prices are volatile or the customer has undisclosed negotiated rates, this term is not zero.
4. **Mapping coverage** — if only part of the affected spend was mapped, the figure is a lower bound on reach and must be labelled as such.

Where these cannot be composed rigorously, present the **dominant** term and explicitly name the others as unquantified. Do not fold unquantified uncertainty into a number that looks precise.

---

## 8. Confidence interval methodology

### Method

- **Paired bootstrap** over the sampled per-call differences (resample pairs with replacement, ≥10,000 iterations), producing a percentile interval on the mean paired difference. Bootstrap is preferred over normal-theory intervals because token-cost distributions are skewed and heavy-tailed.
- **Reweight for stratification** during resampling; ignoring strata weights biases the interval.
- **Compose the volume-projection term** rather than treating monthly volume as a constant.
- Report the interval at a stated level, and state the level.

### Presentation rules

1. **Always report the interval, never the point estimate alone.**
2. **If the interval spans zero, say so in words**, in the verdict: the direction of the change is not established.
3. **If the interval is wider than the customer's decision threshold, say the analysis is not decision-useful** at the achieved sample, and state what sample would be.
4. **Never report more significant figures than the interval supports.** `$2,400 ± $1,900` is honest; `$2,437.18` is not.
5. Distinguish **statistical** uncertainty (sampling) from **structural** uncertainty (assumptions that could be wrong in ways no interval captures — volume, cache behaviour, traffic-mix drift). Structural uncertainty is listed in prose, not folded into the interval.

---

## 9. Quality evaluation hierarchy

**[Instruction, binding]** Prefer deterministic and customer-defined measures. An LLM judge is the **last** resort, used only where the task genuinely has no checkable structure, and never as the sole basis for a merge recommendation.

Apply in this order. Use the highest available tier, and use multiple tiers where possible.

| Tier  | Method                            | Use when                                                                                                                                                                                                       | Weight in the verdict                                                                                                                         |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **Deterministic checks**          | The output has checkable structure: schema validation, JSON parse success, classification against known labels, tool-call validity, required-field presence, numeric exactness, regex/constraint satisfaction. | **Highest. Always run these if any exist.**                                                                                                   |
| **2** | **Customer's existing evals**     | The team already has an eval suite or golden dataset.                                                                                                                                                          | High — but **record the dataset's provenance**. A golden set unrepresentative of production traffic is a known limitation and must be stated. |
| **3** | **Customer-defined task metrics** | Defined with the customer during the 30–60 minute session: exact match, F1 against a labelled set, retrieval hit rate, tool-selection accuracy.                                                                | High.                                                                                                                                         |
| **4** | **Human review**                  | Always, on a subsample — see §10. Mandatory whenever a merge recommendation is made.                                                                                                                           | **High. Non-optional.**                                                                                                                       |
| **5** | **LLM-as-judge**                  | Only for genuinely open-ended output (summarization, free-form generation) where tiers 1–3 do not apply.                                                                                                       | **Lowest. Never alone.** See constraints below.                                                                                               |

### Constraints when an LLM judge is used

If a judge is used at all:

- **Never as the sole basis for a merge recommendation.** Tier 4 human review of a subsample is required alongside it.
- **Pairwise preference on paired outputs**, not absolute scoring — absolute scores are poorly calibrated and drift.
- **Randomize presentation order** and test for position bias.
- **Never use a judge from the same model family as either configuration** where avoidable; self-preference is a documented effect.
- **Validate the judge against human labels** on a subsample and report the agreement rate. **If agreement is poor, the judge's output is not reported as a quality delta at all.**
- Publish the judge prompt in the report.
- Report judge-derived deltas with their own explicit uncertainty, distinguished from tier 1–3 results.

### Composite verdicts

Where tiers disagree, **report the disagreement**. Do not average them into a single reassuring score. A change that improves the judge score while degrading schema validity is a specific, important finding — and averaging destroys it.

---

## 10. Human review requirements

**Mandatory for every report that makes a merge recommendation.** Not optional, not conditional on the automated tiers agreeing.

| Requirement    | Detail                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Who**        | Someone from the customer's team who knows what correct output looks like. Not us alone — we do not know their domain.  |
| **What**       | A minimum of: the 10 largest regressions by any metric, 10 random pairs, and every case where automated tiers disagree. |
| **How**        | Blinded and order-randomized. The reviewer must not know which output came from which configuration.                    |
| **Recorded**   | Reviewer's verdict per pair, agreement rate with each automated tier, and verbatim comments.                            |
| **Escalation** | If human review contradicts the automated verdict, **human review wins** and the report says so explicitly.             |

**[INFERENCE]** This step is also where most methodological errors surface. A customer looking at ten blinded pairs finds problems that no metric catches, and their reaction is itself validation evidence for the sprint.

---

## 11. Post-deployment measurement

After the PR merges and deploys:

1. **Wait for sufficient post-deploy volume**, determined by the same variance-driven logic as §5 — not a fixed number of days.
2. Partition telemetry into before and after using `release_id` or `commit_sha`. Where only a deployment timestamp exists, say so and note the confounding.
3. Recompute actual cost per call and actual monthly rate for the affected call sites.
4. Recompute quality signals where they exist in production.
5. **Check for confounders** before attributing anything: other changes in the same deploy, traffic-mix shift, volume change, provider-side model updates, price changes, seasonality. List every confounder found.
6. Compute the actual delta with its own uncertainty. The measured actual is an estimate too, not a truth value.

---

## 12. Predicted-versus-actual scoring

The scorecard is the product. It must be computed and published whether or not it is flattering.

| Metric                   | Definition                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Direction accuracy**   | Did the actual move in the predicted direction? Binary. Only scored when the prediction's interval excluded zero.                                          |
| **Magnitude error**      | `(actual − predicted) /                                                                                                                                    | predicted | `, with the actual's own uncertainty carried through. |
| **Interval coverage**    | Did the actual fall inside the predicted interval? **This is the calibration test.**                                                                       |
| **Attribution of error** | Decomposed where possible into: sampling error, volume-projection error, traffic-mix drift, cache-behaviour difference, confounding changes, price change. |

### Calibration over time

Across engagements, the number that matters is **whether the stated intervals achieve their stated coverage**. Intervals that are wrong 40% of the time at a nominal 90% level are not conservative — they are miscalibrated, and the method is not yet trustworthy.

**[INFERENCE]** With three to five retrospective predictions in this sprint, coverage cannot be established statistically. The sprint tests whether the method is _plausible_ — direction correct, magnitude in the right order, intervals not absurd. Claiming calibration from five data points would violate the governing rule of this document.

---

## 13. Failure modes

| #   | Failure mode                         | Detection                                 | Response                                                                                    |
| --- | ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Baseline will not reconcile          | §2                                        | Stop. Refund. Deliver the reconciliation attempt.                                           |
| 2   | Call site unmappable                 | §4                                        | Insufficient evidence for that call site.                                                   |
| 3   | Sample requirement infeasible        | §5                                        | Report achievable precision, or declare insufficient evidence.                              |
| 4   | Change indistinguishable from noise  | §6 control arm                            | Report exactly that. Do not present the point estimate as an effect.                        |
| 5   | Replay does not reproduce production | §6 validity checks                        | Investigate. If unresolved, report as unvalidated.                                          |
| 6   | Quality has no measurable signal     | §9 — no tier applies                      | Report cost only. State explicitly that quality was not measured.                           |
| 7   | Judge disagrees with human review    | §9, §10                                   | Human wins. Report the disagreement. Discount the judge result.                             |
| 8   | Traffic mix drifted mid-window       | Distribution comparison across the window | Reweight to recent traffic, or narrow the window and say so.                                |
| 9   | Post-deploy confounded               | §11                                       | Report the confounders. Scorecard confidence downgraded, not suppressed.                    |
| 10  | Volume changed after deploy          | §11                                       | Separate per-call effect from volume effect. Report both.                                   |
| 11  | Prediction wrong                     | §12                                       | **Publish it.** Attribute the error. This is the most valuable single output of the sprint. |
| 12  | Customer disputes the number         | Debrief                                   | Show the working. If they are right, correct it and record the cause.                       |

---

## 14. When the report must say "insufficient evidence"

**Binding.** In any of these cases, the corresponding section states _insufficient evidence_, names what is missing, and states what would be required to resolve it. No number, no range, no directional hint dressed as a hedge.

1. The affected call site has no telemetry, or too little to characterize its distribution.
2. The required sample size cannot be achieved, and the achievable precision is wider than the customer's decision threshold.
3. The old-versus-old control shows the change is indistinguishable from run-to-run variation.
4. No quality signal exists at any tier for a change that could plausibly affect quality.
5. Replay validity checks fail and the cause is not identified.
6. The baseline reconciled only through an unexplained residual large enough to affect the conclusion.
7. The PR introduces a new call site with no historical volume — cost may be modelled from an explicit assumption, but the assumption is labelled as the customer's input, not our measurement.
8. The change affects context assembly with reach we could not trace.
9. Provider or model behaviour changed mid-window, invalidating the pre-change baseline.
10. Only metadata is available (Mode C) and the question asked requires content.

**A report may consist entirely of "insufficient evidence" sections plus a reconciliation table.** That is a legitimate and useful outcome. It tells the customer something true about their own observability, and it tells the sprint something true about feasibility.

---

## 15. Protocol integrity rules

1. **Write the prediction down before measuring the actual.** No retro-fitting. Retrospective PRs are analyzed with the outcome deliberately unexamined until the prediction is recorded.
2. **Pre-register the method per engagement.** Sample size, MDE, quality tiers, and strata are fixed before replay runs.
3. **Publish failures.** A wrong prediction, published and attributed, is worth more to the sprint than three right ones.
4. **Never adjust a prediction after seeing the actual.** Adjust the _method_, document why, and note that subsequent predictions used a revised method.
5. **One analyst does not check their own reconciliation.** Where only one person is available, re-derive the baseline by an independent route (e.g. aggregate provider usage) and compare.
