# Track A — Statistical Correctness for AI Evaluations

Research date: **August 13, 2026**
Verdict: **RESEARCHABLE** — a verified unresolved gap in commercial platforms, with no business evidence and a high risk of being feature-sized.

> **PARTIALLY SUPERSEDED — August 13, 2026.** Repeated-trial execution is **CONFIRMED PRESENT** in LangSmith, W&B Weave, DeepEval, and promptfoo; and `evalci` **could not be located** as an installable package. Category unchanged (RESEARCHABLE), reasoning corrected in both directions. See [`08-adversarial-verification.md`](08-adversarial-verification.md) and [`09-corrected-final-verdict.md`](09-corrected-final-verdict.md). Preserved unchanged as a dated record.

## The observed problem

From the W2 phase: Braintrust reports "8 improvements 🟢 / 4 regressions 🔴" with **VERIFIED** aggregation limited to "avg, max, and min" and no confidence intervals, significance testing, or uncertainty quantification ([compare-experiments](https://braintrust.dev/docs/evaluate/compare-experiments.md)).

**INFERENCE:** on a stochastic task, running a configuration against **itself** would produce a confident-looking list of improvements and regressions that are entirely sampling noise. A user reading that table cannot distinguish a real effect from run-to-run variance.

That is a correctness problem, not a missing feature — which is what made it worth a dedicated track.

## What the research literature has established

**VERIFIED.** The methodology is not an open question. It is published, canonical, and public.

| Work                                                                                                                                                             | Contribution                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Miller, "Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations"** (Anthropic, [arXiv 2411.00640](https://arxiv.org/abs/2411.00640)) | Five recommendations: report standard errors and CIs; use **clustered** standard errors for grouped questions; reduce variance by resampling answers per question; use **paired analysis** of question-level differences; run **power analysis** for required sample size. Reports that cluster-adjusted SEs can be **3× larger** than naive calculations. |
| **"How to Correctly Report LLM-as-a-Judge Evaluations"** ([arXiv 2511.21140](https://arxiv.org/pdf/2511.21140))                                                  | Judge-specific reporting standards.                                                                                                                                                                                                                                                                                                                        |
| **"Lessons from the Trenches on Reproducible Evaluation of Language Models"** ([arXiv 2405.14782](https://arxiv.org/pdf/2405.14782))                             | Reproducibility and reporting practice.                                                                                                                                                                                                                                                                                                                    |
| **statsforevals.com** ([resources](https://statsforevals.com/resources.html))                                                                                    | A dedicated reference site cataloguing CI methods, bootstrap, multiple-comparison correction, and the p-value-versus-estimation debate. Notes that most developer evaluations run at **20–100 items**, where "traditional statistical assumptions often fail, requiring specialized robust methods."                                                       |

Anthropic publicised the Miller paper directly ([announcement](https://x.com/AnthropicAI/status/1858976458330505639)). **INFERENCE:** the methodology has been in public circulation for roughly two years and is not obscure.

## What open-source tooling already ships

**VERIFIED.** Free implementations exist and cover the methodology comprehensively.

| Tool                                                              | Capability                                                                                                                                                                                                                                                                                                                                                                                                             | Status                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **lm-evaluation-harness**                                         | Reports **bootstrapped standard error by default**; `acc_stderr` alongside accuracy. Described as having "opted users into better evaluation reporting by default" ([tutorial](https://qaskills.sh/blog/lm-evaluation-harness-tutorial-2026))                                                                                                                                                                          | Open source, dominant benchmark harness    |
| **Inspect AI** (UK AISI)                                          | Native mean/stderr metrics on aggregate and per-task scores ([Inspect Evals](https://ukgovernmentbeis.github.io/inspect_evals/))                                                                                                                                                                                                                                                                                       | Open source, government-backed             |
| **evalci** ([arXiv 2607.04429](https://arxiv.org/pdf/2607.04429)) | **Exactly this track.** CIs, paired significance tests, **power analysis**, **clustered standard errors**, **multiple-comparison correction**. Every routine validated against statsmodels or brute-force exact enumeration. Emits publication-ready claims: "Model A beats Model B, Δ=3.1 pts, 95% CI [1.2, 5.0], paired permutation p=0.002, n=1,319". **Ships adapters for lm-evaluation-harness and HELM output.** | Open source, CC-BY 4.0, on PyPI, July 2026 |
| **evalstats** (statsforevals.com)                                 | Bootstrap CIs, smooth bootstrap with KDE, Wilson score intervals, permutation tests, critical difference diagrams, **Bayesian paired comparisons**                                                                                                                                                                                                                                                                     | Open source, PyPI + GitHub                 |
| **scmamp**                                                        | Friedman test, Wilcoxon signed-rank, Holm-Bonferroni, critical difference diagrams                                                                                                                                                                                                                                                                                                                                     | Open source, R                             |

**VERIFIED: `evalci` implements every item on this track's list except judge variance, is free, and already integrates with the two dominant benchmark harnesses.**

## What commercial platforms ship

| Platform                                                                                                                                        | Statistical treatment of eval comparison                                                                                                                                                                                                                                                              | Status                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Braintrust**                                                                                                                                  | Aggregation "avg, max, and min"; **no** CIs, significance testing, or uncertainty quantification. Default aggregation is "a simple mean (average of averages), not weighted by the number of examples" ([KB](https://braintrust.dev/docs/kb/understanding-experiment-score-aggregation-simple-vs.md)) | **VERIFIED absent**                                                                                                                                    |
| **Evidently**                                                                                                                                   | 100+ evals and "20+ statistical tests and distance metrics" — but these are **distribution-shift/drift tests**, not significance testing of an eval comparison ([GitHub](https://github.com/evidentlyai/evidently))                                                                                   | **VERIFIED present for drift, not for eval comparison**                                                                                                |
| LangSmith, Arize Phoenix, W&B Weave, Galileo, Humanloop, Giskard, DeepEval/Confident AI, promptfoo, Maxim, HoneyHive, Datadog LLM Obs, Patronus | No evidence of CIs or significance testing in eval comparison found in a targeted search                                                                                                                                                                                                              | **UNKNOWN — absence not established.** A search that finds nothing is weaker than a source-code reading. Only Braintrust was verified at source level. |

**This UNKNOWN is recorded honestly and is material.** The previous phase's fatal error was treating an absence of documentation as an established fact. Twelve platforms were not individually verified here, and no claim of "nobody does this" is made on that basis.

## Assessment

### The gap is real, and narrower than it first appears

**VERIFIED:** commercial eval platforms report improvement/regression counts with no statistical treatment, while free open-source libraries implement the full methodology.

**INFERENCE:** the gap is therefore not "the world lacks statistics for evals." It is "commercial eval platforms have not integrated statistics that are freely available." Those are different problems with different value.

### Why this is probably feature-sized

**INFERENCE**, and this is the decisive judgement:

1. **The inputs are already present.** Braintrust holds per-item scores for both experiments, aligned by `input` — it already performs **VERIFIED** row-pairing on identical inputs. A paired bootstrap over data already in hand is a modest amount of code.
2. **The methodology is public and validated.** Miller's paper gives the formulas; `evalci` gives a reference implementation with adapters, on PyPI, free.
3. **The reference case applies.** The Braintrust cost finding was misjudged as product-sized for exactly this reason: the incumbent already held every input. The same test now says feature.

### The counter-argument, and why it is not enough

**INFERENCE:** there is a genuine commercial disincentive. A vendor whose PR comment currently reports "8 improvements 🟢" would, under correct statistics, frequently report "no statistically significant change at n=50." That is a worse-looking product, and it invites the question of what the previous numbers meant.

That may explain a two-year delay. It is **not a moat** — it is a bet on incumbents remaining irrational, and it collapses the moment one of them decides rigour is a differentiator.

### The residual that is genuinely unsolved

**Judge variance** is the one item on this track's list not covered by `evalci`. **VERIFIED** that a 2026 paper addresses reporting standards for LLM-as-a-judge evaluations. **UNKNOWN** whether any tool implements variance decomposition separating judge noise from model effect.

**INFERENCE:** combined with the small-sample regime (20–100 items, where asymptotic methods fail), this is the most technically interesting unsolved question found in the entire reset phase. It is also narrow, academic in character, and has no identified buyer.

## Buyer and decision point

|                        |                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Buyer**              | **UNKNOWN.** No role with a budget line for statistical correctness was identified.                                                                                                                     |
| **Decision point**     | Merge time, in principle. But teams already at that decision point are using a platform that reports something, and the value of correcting it is unmeasured.                                           |
| **Willingness to pay** | **UNKNOWN, and structurally doubtful.** Research users get it free in lm-eval-harness and Inspect. Product users get a number from their platform. Nobody has been observed paying for a better number. |
| **Evidence of demand** | **None. Zero customers contacted.**                                                                                                                                                                     |

## Score

| Criterion                                  | Weight | Score |   Weighted   |
| ------------------------------------------ | :----: | :---: | :----------: |
| Urgency                                    |   ×2   |   3   |      6       |
| Differentiation vs a practical combination |   ×3   |   4   |      12      |
| Absorption resistance                      |   ×3   |   2   |      6       |
| Buyer and decision point                   |   ×2   |   2   |      4       |
| Provability                                |   ×2   |   9   |      18      |
| Validatable without a platform             |   ×1   |   8   |      8       |
| Relation to original vision                |   ×1   |   3   |      3       |
| **Total**                                  |        |       | **57 / 140** |

Provability is high — the claim "your reported improvements are indistinguishable from noise" is demonstrable in an afternoon with `evalci` on any customer's eval history. That is the track's one genuine strength, and it is not enough.

Relation to the vision is weak: this is eval-platform correctness, not architecture guidance, repository auditing, or supplying evidence to coding agents.

## Verdict: RESEARCHABLE

**Not KILLED**, because the commercial-platform gap is verified and unresolved, and the judge-variance residual is genuinely open.

**Not VALIDATION-READY**, because there is no identified buyer, no budget, no decision point with money attached, and the central capability is feature-sized for an incumbent holding all the inputs.

**INFERENCE:** the honest reading is that this is a good paper or an open-source contribution, not a company. If the intention were to establish credibility in the eval community, publishing a rigorous critique of noise in commercial eval comparisons — using `evalci` against real public eval data — would be a cheap and genuinely useful thing to do. That is a reputational move, not a business, and it should not be confused with one.
