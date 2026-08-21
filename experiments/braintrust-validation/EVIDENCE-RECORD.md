# Evidence Record — Braintrust Validation

Executed: **August 13, 2026**
Method: **Source-code and primary-documentation analysis.** No account created, no live API calls, **$0 spent**.

## Why this method, and why it is stronger than the planned UI test

The planned test would have observed _one_ PR comment from _one_ eval run and inferred the general case from it. That is exactly the reasoning error that produced the earlier wrong conclusion (see §2).

Reading the action's **rendering code** answers the question generally: it shows which fields are rendered for _any_ eval, not which fields happened to appear in one example. For T1 and T2 this is dispositive and no screenshot would improve it.

**Constraint that forced this route:** creating accounts and entering API keys into fields are actions the assistant does not perform under any authorization. That blocked the live-run path. It did not block reaching a conclusive answer.

---

## 1. The decisive chain — T1 and T2

### Link 1 — the action renders `metrics`, not just `scores`

`eval/src/main.ts`, function `formatSummary()`:

> `const rowData = Object.entries(summary.scores ?? {}).map(...).concat(Object.entries(summary.metrics ?? {})`

Source: [`eval/src/main.ts`](https://raw.githubusercontent.com/braintrustdata/eval-action/main/eval/src/main.ts)

The rendered table headers are `Score | Average | Improvements | Regressions`. **Both scores and metrics populate that table.** The field list is dynamic, not fixed.

### Link 2 — `metrics` includes estimated cost

Braintrust documentation, on interpreting experiment results:

> "Prompt tokens, Completion tokens, Total tokens, LLM duration, and **Estimated LLM cost** are averaged over every span that is not marked with `span_attributes.purpose = "scorer"`"

And:

> "when you switch models, it's useful to look at duration, token metrics, and estimated cost together to understand the tradeoffs"

Sources: [interpret-results](https://braintrust.dev/docs/evaluate/interpret-results.md), [Braintrust docs — interpret evals](https://www.braintrust.dev/docs/core/experiments/interpret)

Metric field names confirmed as `metrics.prompt_tokens`, `metrics.completion_tokens`, and `estimated_cost()` ([SQL KB page](https://braintrust.dev/docs/kb/query-scorer-span-token-costs-with-sql.md)).

### Link 3 — the README example confirms the mechanism

The published example PR comment:

```text
| Score       | Average    | Improvements | Regressions |
| ----------- | ---------- | -----------: | ----------: |
| Levenshtein | 83% (+3pp) |         8 🟢 |        4 🔴 |
| Duration    | 1s (0s)    |        16 🟢 |        1 🔴 |
```

Source: [eval-action README](https://raw.githubusercontent.com/braintrustdata/eval-action/main/README.md)

**`Duration` is a metric, not a score.** Its presence in this table proves the metrics path renders. Estimated cost travels the same path. This example shows only Duration because "Say Hi Bot" is a trivial demo; an eval making real LLM calls emits token and cost metrics as well.

### Conclusion

**A Braintrust PR comment on an eval that makes real LLM calls contains estimated cost and token counts, each with a delta versus the baseline experiment and improvement/regression counts.**

T1 **occupied**. T2 **occupied**.

---

## 2. Correction to the earlier finding

The August 13 documentation investigation recorded as **documented fact**:

> "the documented PR-comment fields are: a link to the experiment, Score, Average, Improvements, Regressions, and Duration. No cost field, no token delta, no monthly projection, no traffic-volume weighting appears in the documented output."

**That was wrong.** The error was treating the README's _example table_ — produced by a trivial eval — as an exhaustive field schema. The schema is dynamic. `Duration` appearing in that example was itself the clue that the metrics object renders, and it was misread as a fixed column.

This is recorded rather than quietly fixed because it caused a material misjudgement about the wedge, and because the same reasoning error (example mistaken for schema) is easy to repeat.

---

## 3. Remaining tests

|  Test  | Question                                                    |        Verdict         | Evidence                                                                                                                                                                                                                                                                                                                                      |
| :----: | ----------------------------------------------------------- | :--------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | Cost as a first-class experiment-comparison metric?         |      **OCCUPIED**      | §1. Cost is an experiment summary metric with diff and improvement/regression counts                                                                                                                                                                                                                                                          |
| **T2** | Cost or token deltas in the PR comment?                     |      **OCCUPIED**      | §1. `formatSummary()` renders `summary.metrics`                                                                                                                                                                                                                                                                                               |
| **T3** | Monthly cost projected at measured production volume?       | **Survives, narrowly** | Braintrust projects **its own** invoice ("projected upcoming invoice broken down by Logs and Scores"); usage is measured as processed data, scores, Topics tokens, retention — platform activity, **not** provider spend scaled by traffic ([monitor-usage](https://braintrust.dev/docs/admin/billing/monitor-usage.md))                      |
| **T4** | Can production frequency weight the comparison?             |  **Survives, weakly**  | Aggregation is "a simple mean (average of averages), not weighted by the number of examples". Weighting is available only by dataset **size** via SQL/BTQL (`sum(avg_score * count) / sum(count)`); no metadata-frequency weighting documented ([KB](https://braintrust.dev/docs/kb/understanding-experiment-score-aggregation-simple-vs.md)) |
| **T5** | Pre-merge prediction compared with post-deployment actuals? |      **Survives**      | No such feature found. Nearest is alerting on cost anomalies — detection, not prediction scoring                                                                                                                                                                                                                                              |
| **T6** | Cost reconciled against a provider invoice?                 |      **Survives**      | Cost is estimated from logged `estimated_cost` or "the model registry to estimate cost from token metrics and registered pricing" ([KB](https://braintrust.dev/docs/kb/configure-custom-model-costs-for-estimation.md)). The only invoice projected is Braintrust's own                                                                       |
| **T7** | Real change distinguished from old-vs-old variance?         |      **Survives**      | Aggregation covers "avg, max, and min"; no confidence intervals, significance testing, or uncertainty quantification found. Improvements/regressions are reported as counts with no statistical treatment ([compare-experiments](https://braintrust.dev/docs/evaluate/compare-experiments.md))                                                |

**Confidence note.** T1/T2 are settled at source level — the strongest evidence available. T3–T7 rest on targeted search of official documentation plus source reading, not live observation. They are **not** at the same standard, and would need the live run to be called conclusively. That gap is now moot: the stop rule fired on T2.

### One further finding, relevant to T7

Comparison "aligns test cases across experiments" using the `input` field, so "test cases with identical inputs are treated as the same example" ([compare-experiments](https://braintrust.dev/docs/evaluate/compare-experiments.md)). Comparison **is row-paired on identical inputs** — the paired design assumed to be an ANVILMARK design choice is also already present.

---

## 4. Decision-rule outcome

The standing rule: _"If T2, T3, or T5 shows Braintrust already provides the capability, stop ANVILMARK validation and write a reassessment."_

**T2 is occupied. Validation stops.** See [`../../docs/research/08-braintrust-reassessment.md`](../../docs/research/08-braintrust-reassessment.md).

## 5. Cost and credentials

|                       |                     |
| --------------------- | ------------------- |
| Money spent           | **$0.00**           |
| Braintrust account    | **Not created**     |
| Provider API key      | **Not created**     |
| GitHub repository     | **Not created**     |
| Repository secrets    | **None configured** |
| Live API calls        | **None**            |
| Credentials to revoke | **None exist**      |

The only artifacts produced are local synthetic datasets from the offline generator, which contain no customer data and required no credentials.
