# Braintrust Hands-On Test Plan

Prepared: **August 13, 2026**
Status: **Not executed. No account created, no terms accepted, no payment details entered, no trial started.**

## Why this test exists

The documentation investigation in [`competitor-validation-matrix.md`](competitor-validation-matrix.md) established that Braintrust **does** replay production inputs through changed configurations (via logs → datasets → experiments) and **does** gate pull requests on quality. It found **no documented evidence** of monthly cost projection at production volume, invoice reconciliation, or predicted-versus-actual scoring.

Absence from documentation is evidence, not proof. Three questions remain genuinely unverified and can only be answered by using the product:

1. Does **cost** appear anywhere in experiment comparison, or only score?
2. Are datasets **weighted by production frequency**, or is an unweighted sample all that is possible?
3. Is comparison **row-paired on identical inputs**, and is there any noise-floor control?

**[INFERENCE]** These three determine how much of the wedge is genuinely unoccupied. If cost deltas already appear in experiment diffs and datasets can be frequency-weighted, the remaining differentiator collapses to the calibration loop (C8) alone — which is a thinner wedge than document 06 assumed, and the recommendation would need revisiting.

## What this test is not

This is **not** a general Braintrust evaluation, a feature inventory, or a competitive teardown for marketing. It answers exactly the questions above and stops. Time-boxed deliberately — see §8.

---

## 1. The two shared scenarios

Identical scenarios are used for every product in the trial plan so results are comparable ([`competitor-validation-matrix.md`](competitor-validation-matrix.md)).

### Scenario 1 — Model swap on a classification call site

|                       |                                                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Call site**         | Support-ticket classifier: ticket text in, one of eight category labels out.                                                                                                                                          |
| **Old configuration** | A flagship model, temperature 0.                                                                                                                                                                                      |
| **New configuration** | A materially cheaper small model, temperature 0.                                                                                                                                                                      |
| **Why chosen**        | Deterministic quality signal (label matches ground truth) — tier 1 in the evaluation hierarchy. Short outputs, low variance, converges on a small sample. Represents the single most common real cost-cutting change. |
| **What it tests**     | Whether Braintrust reports **cost** alongside accuracy, and whether the comparison is row-paired.                                                                                                                     |

### Scenario 2 — Prompt expansion on a summarization call site

|                       |                                                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Call site**         | Document summarizer: long document in, prose summary out.                                                                                                                                                                                                                                                  |
| **Old configuration** | Short system prompt, no few-shot examples.                                                                                                                                                                                                                                                                 |
| **New configuration** | Long system prompt with four few-shot examples — a large, stable prefix that interacts with prompt caching.                                                                                                                                                                                                |
| **Why chosen**        | No deterministic quality signal, forcing the evaluation hierarchy down to judges and human review. Long stable prefix makes **cache economics** decisive: naive token counting gets the cost badly wrong in both directions. Open-ended output has high variance, which stresses the noise-floor question. |
| **What it tests**     | Whether cache read/write tokens are priced correctly, and whether run-to-run variation is distinguishable from the change.                                                                                                                                                                                 |

---

## 2. Account and setup requirements

**All of §2 requires your authorization. I have not created an account, accepted any terms, entered payment details, or started a trial.**

| Requirement            | Detail                                                                                                          | Who must do it                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Braintrust account     | Sign-up, terms acceptance                                                                                       | **You**                           |
| Plan selection         | Free tier if it covers the API and the GitHub Action; **do not start a paid trial** without deciding separately | **You**                           |
| Braintrust API key     | Generated in their console                                                                                      | **You**                           |
| LLM provider API key   | For executing the scenarios. Use a **dedicated key with a low spend cap**, not a production key                 | **You**                           |
| GitHub repository      | Throwaway private repo for the PR test                                                                          | You, or me once it exists locally |
| GitHub Actions enabled | Required for the eval action                                                                                    | **You**                           |
| Repo secrets           | `BRAINTRUST_API_KEY`, provider key                                                                              | **You**                           |

**Constraint:** I will not create accounts, accept terms, enter payment details, or start a paid trial. Everything above stops at your authorization.

**What I can do once you have provided access:** write the scenario code, generate the synthetic data, write the workflow file, run the local commands, read the outputs, and record the findings.

---

## 3. Synthetic data

**No customer data is used. None exists yet, and using any would be inappropriate at this stage.**

| Dataset         | Contents                                                                                                              | Size     | Purpose                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| **S1-tickets**  | Synthetic support tickets with ground-truth category labels across 8 classes                                          | 200 rows | Scenario 1 evaluation set                                       |
| **S1-weighted** | Same tickets, with a `frequency` field encoding a deliberately skewed distribution (one class at ~60%, others sparse) | 200 rows | **Tests whether Braintrust can weight by production frequency** |
| **S2-docs**     | Synthetic documents of varying length (500–8,000 tokens), sharing a common stable prefix                              | 100 rows | Scenario 2, with cache-relevant structure                       |
| **S1-repeat**   | Exact duplicate of S1-tickets                                                                                         | 200 rows | **Noise-floor control** — same config run twice                 |

Generation: scripted, deterministic seed, committed to the throwaway repo so the run is reproducible. Realistic in shape (length distribution, class skew), entirely fabricated in content.

**[INFERENCE]** The skewed distribution in S1-weighted is the point. If Braintrust reports a flat average across all 200 rows with no way to weight by frequency, its number answers a different question from ours: it reports quality on a test set, not the expected effect on real traffic.

---

## 4. Instrumentation

| Component             | Approach                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task function         | Braintrust SDK, standard `Eval()` structure, node or python runtime                                                                                                                                                       |
| Scorers               | S1: exact-label match (deterministic, tier 1). S2: an LLM judge, since no deterministic signal exists — deliberately mirroring the hierarchy's fallback                                                                   |
| Logging               | Braintrust logging enabled so the same code path produces both logs and experiments — the documented dual-purpose instrumentation                                                                                         |
| Production simulation | Run the task in "production" mode against a stream of inputs first, generating logs, **then** attempt to convert those logs into a dataset. This tests Q1/Q7 on the real path rather than by uploading a dataset directly |
| CI                    | `braintrustdata/eval-action` in a workflow triggered on pull request                                                                                                                                                      |

---

## 5. Exact steps

### Phase A — logs to dataset _(tests Q1, Q7)_

1. Instrument the S1 classifier task with Braintrust logging.
2. Run it over S1-weighted in a loop to generate production-shaped logs, with the skewed class distribution.
3. In the Braintrust UI, attempt to convert those logs into a dataset.
4. **Record:** is conversion possible? Does the resulting dataset preserve any frequency or weight information, or is it a flat list of rows?
5. **Record:** does the log view show token counts and cost per span, as documented?

### Phase B — experiment comparison _(tests Q3, Q4 — the decisive phase)_

6. Run an experiment: old configuration (flagship) over the production-derived dataset.
7. Run a second experiment: new configuration (small model), same dataset.
8. Open the comparison view.
9. **Record, with a screenshot:** every column and metric shown. Specifically — **does cost or token usage appear anywhere in the comparison?**
10. **Record:** is the comparison row-paired (per-input old vs new) or aggregate-only?
11. **Record:** is there any way to weight results by a frequency field?
12. **Record:** is there any projection to a time period, or any multiplication by volume?

### Phase C — the PR surface _(tests Q2, Q4)_

13. Create the throwaway repo, commit the S1 task, add the eval action workflow.
14. Open a PR changing the model identifier from flagship to small.
15. Wait for the action to complete.
16. **Record, with a screenshot:** the exact PR comment. Compare against the documented fields (Score, Average, Improvements, Regressions, Duration). **Does any cost field appear?**
17. Repeat with the Scenario 2 prompt-expansion change and record the comment.

### Phase D — noise floor _(tests the paired-design question)_

18. Run the **old configuration twice** over the identical dataset (S1-tickets then S1-repeat).
19. Compare the two runs in the comparison view.
20. **Record:** does Braintrust present run-to-run variation as "improvements and regressions"? Is there any indication that a difference may be noise, or any statistical treatment of it?
21. Repeat for Scenario 2, where variance is much higher.

**[INFERENCE]** Phase D is the most diagnostic and the cheapest. If comparing a configuration against _itself_ produces a confident-looking list of improvements and regressions with no noise treatment, that is a specific, demonstrable methodological gap — and it is directly relevant to the case for calibration.

### Phase E — cost and reconciliation _(tests C2, C5)_

22. Check every cost surface: dashboards, spend breakdown, per-span cost.
23. **Record:** is there any feature for comparing platform-computed cost against an actual provider invoice?
24. **Record:** is there any monthly or forward-looking cost figure anywhere, versus retrospective only?
25. Check for any post-deploy comparison of an experiment result against subsequent production behaviour.

---

## 6. Evidence to retain

Stored in a trial folder outside this repository. **No customer data will exist in any of it.**

| Artifact                                                             | From    |
| -------------------------------------------------------------------- | ------- |
| Screenshot: log view showing per-span cost and tokens                | Phase A |
| Screenshot: logs-to-dataset conversion dialog and result             | Phase A |
| **Screenshot: full experiment comparison view, all columns visible** | Phase B |
| Screenshot: any cost or token display in comparison                  | Phase B |
| **Screenshot: the PR comment, both scenarios**                       | Phase C |
| **Screenshot: old-vs-old comparison result**                         | Phase D |
| Screenshot: every cost dashboard surface                             | Phase E |
| The eval action workflow YAML and run logs                           | Phase C |
| Written notes per numbered step                                      | All     |
| Exported experiment data if available                                | Phase B |

Screenshots are the evidence that converts a `?` or `d` into a confirmed mark. A written assertion without one does not update the matrix.

---

## 7. Pass/fail criteria

**"Pass" means the wedge survives. "Fail" means Braintrust already occupies it.**

| Test                            | Wedge survives if                                                         | Wedge occupied if                                                |
| ------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **T1 — Cost in comparison**     | Experiment comparison shows score metrics only; cost absent or incidental | Comparison shows cost deltas as a first-class metric             |
| **T2 — Cost in PR comment**     | PR comment matches documented fields; **no cost field**                   | PR comment includes a cost or token delta                        |
| **T3 — Volume projection**      | No monthly or volume-scaled projection anywhere                           | Any projection of a change to a time period at production volume |
| **T4 — Frequency weighting**    | Datasets are flat; no production-frequency weighting                      | Datasets can be weighted by measured production frequency        |
| **T5 — Self-scoring**           | No comparison of a pre-merge prediction to post-deploy actuals            | Any predicted-versus-actual feature exists                       |
| **T6 — Invoice reconciliation** | No invoice comparison                                                     | Any reconciliation against a provider bill                       |
| **T7 — Noise floor**            | Old-vs-old shows differences with no statistical treatment                | Run-to-run variation explicitly modelled and separated           |

### Overall verdict

| Outcome                                | Meaning                                                                | Action                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **T2, T3, T5 all pass**                | The cost dimension and calibration loop are unoccupied.                | **Continue the sprint.** Narrow the differentiation claim to cost + calibration, excluding replay and quality. |
| **T2 or T3 fails**                     | Braintrust already projects cost impact at merge.                      | **Stop and reassess.** C5 was the primary commercial hook.                                                     |
| **T5 fails**                           | Braintrust already scores its own predictions.                         | **Stop and reassess.** C8 was the defensibility argument. Wedge is occupied.                                   |
| **T4 and T7 both fail, T2/T3/T5 pass** | Methodology is closer than assumed but the cost/calibration gap holds. | Continue, with defensibility revised downward again.                                                           |
| **T1 fails only**                      | Cost visible in comparison but not projected or in the PR.             | Continue. Materially narrows the claim — state it precisely.                                                   |

**Escalation:** if any stop-condition triggers, halt Day 5 telemetry requests before spending introduction capital, and revisit the wedge table in [`../research/06-runtime-calibrated-pr-review-recommendation.md`](../research/06-runtime-calibrated-pr-review-recommendation.md) §5.

---

## 8. Time and cost

| Phase                            | Estimated time                 |
| -------------------------------- | ------------------------------ |
| A — logs to dataset              | 1.5 h                          |
| B — experiment comparison        | 2 h                            |
| C — PR surface                   | 2 h                            |
| D — noise floor                  | 1 h                            |
| E — cost surfaces                | 1 h                            |
| Setup, data generation, write-up | 2.5 h                          |
| **Total**                        | **~10 hours**, across days 1–5 |

### Monetary cost

| Item                | Estimate                                                                                                                                                                                                                                             | Notes                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Braintrust platform | **$0 intended**                                                                                                                                                                                                                                      | Free tier only. **Do not start a paid trial** without a separate decision.                                                      |
| LLM API calls       | **[INFERENCE] Low, but not zero.** Roughly 200 classification calls × several configurations, plus ~100 summarization calls on long documents × several configurations, plus repeat runs for the noise floor. Long-document summarization dominates. | **Set a hard spend cap on the key before starting.** Scenario 2 is the expensive half; reduce to 50 documents if the cap binds. |
| GitHub Actions      | $0                                                                                                                                                                                                                                                   | Free tier on a private repo is sufficient.                                                                                      |

**[INFERENCE]** The true cost risk is Phase D — noise-floor testing means running the same expensive configuration repeatedly. Cap the key, and treat an unexpectedly large spend as a finding worth recording: it is a small version of exactly the problem ANVILMARK proposes to solve.

---

## 9. What requires your action

Ordered. Everything before the first item is already done; nothing after it can proceed without you.

|   # | Action                                                                                                                                   | Why only you can do it                                                                                                                |
| --: | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | **Create a Braintrust account and accept their terms**                                                                                   | Account creation and terms acceptance require the account holder. I will not do this.                                                 |
|   2 | **Choose the plan.** Free tier if it covers the SDK and the GitHub Action. **Do not start a paid trial** unless you decide to separately | Commercial commitment.                                                                                                                |
|   3 | **Generate a Braintrust API key**                                                                                                        | Requires the authenticated console.                                                                                                   |
|   4 | **Create a dedicated LLM provider API key with a hard spend cap**                                                                        | Requires your provider account. **Do not reuse a production key.**                                                                    |
|   5 | **Create a private throwaway GitHub repository and enable Actions**                                                                      | Requires your GitHub account.                                                                                                         |
|   6 | **Add both keys as repository secrets**                                                                                                  | Requires repository admin.                                                                                                            |
|   7 | **Tell me when 1–6 are done**                                                                                                            | I then write the scenario code, generate synthetic data, write the workflow, run the phases, capture evidence, and update the matrix. |

**I will not:** create the account, accept terms, enter payment details, start a paid trial, or handle your API keys in plaintext. Keys go into GitHub secrets and provider consoles by your hand.

**Note on step 4:** a spend cap is not optional. Phase D deliberately runs repeated executions of the more expensive scenario, and an uncapped key is the wrong way to discover how expensive.
