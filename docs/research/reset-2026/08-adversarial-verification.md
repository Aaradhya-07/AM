# Adversarial Verification of the Reset Research

Date: **August 13, 2026**
Scope: correction pass over [`01`](01-statistical-eval-correctness.md)–[`07`](07-final-reset-verdict.md), which are preserved unchanged as dated records.

**Four methodological defects were raised. All four are confirmed real, and all four materially weakened the fatal facts they supported.**

## Evidence standard applied here

| Label                 | Meaning                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| **CONFIRMED PRESENT** | Capability found in official documentation, SDK reference, or source code       |
| **CONFIRMED ABSENT**  | Primary source affirmatively establishes the capability does not exist          |
| **NOT DOCUMENTED**    | Targeted search of official sources found nothing. **Not** equivalent to absent |
| **UNKNOWN**           | Not investigated to a usable standard                                           |

**Source classes:** PRIMARY (vendor's own docs, SDK reference, source code, API schema) · SECONDARY (comparison blogs, third-party guides, vendor blogs about _other_ vendors). **No fatal conclusion in this document rests on a secondary source.**

---

# Defect 1 — Track A grouped twelve competitors as UNKNOWN

## Individual resolution

Nine questions per platform. Answers below are from targeted primary-source search on August 13, 2026.

| Platform                    | Repeated trials                                                                                                                                                                                                                                                                                    | CIs                  | Paired significance  | Old-vs-old variance                                                                                                            | Power/sample size | Judge variance                                                                                       | Multiple comparisons | Stochastic regression handling                                                                                                                       | CI/merge integration       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **LangSmith**               | **CONFIRMED PRESENT** — `num_repetitions` on `evaluate`/`aevaluate`, with a dedicated how-to guide ([docs](https://docs.smith.langchain.com/evaluation/how_to_guides/repetition), [SDK ref](https://langsmith-sdk.readthedocs.io/en/latest/evaluation/langsmith.evaluation._runner.evaluate.html)) | NOT DOCUMENTED       | NOT DOCUMENTED       | Partially — repetitions enable it; no analysis documented                                                                      | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | **CONFIRMED PRESENT** as data generation: "LLM outputs are not deterministic… by running multiple repetitions, you can get a more accurate estimate" | CONFIRMED PRESENT          |
| **W&B Weave**               | **CONFIRMED PRESENT** — `trials` parameter on `Evaluation` ([docs](https://docs.wandb.ai/weave/guides/core-types/evaluations), [source](https://github.com/wandb/weave/blob/master/docs/docs/guides/core-types/evaluations.md))                                                                    | NOT DOCUMENTED       | NOT DOCUMENTED       | Partially — "measure the repeatability and consistency… analyzing the variance"; each run "scored and displayed independently" | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | **CONFIRMED PRESENT** as data generation                                                                                                             | NOT DOCUMENTED             |
| **DeepEval / Confident AI** | **CONFIRMED PRESENT** — `-r` flag, "Repeat each test case… how many times to rerun each test case" (Python only) ([docs](https://deepeval.com/docs/evaluation-flags-and-configs))                                                                                                                  | NOT DOCUMENTED       | NOT DOCUMENTED       | Partially                                                                                                                      | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | **CONFIRMED PRESENT** as data generation                                                                                                             | CONFIRMED PRESENT (pytest) |
| **promptfoo**               | **CONFIRMED PRESENT** — `--repeat N`, explicitly "to measure variance"; per-test override; separate cache entries per repeat index; `--no-cache` guidance ([docs](https://www.promptfoo.dev/docs/usage/command-line/))                                                                             | NOT DOCUMENTED       | NOT DOCUMENTED       | Partially — repeats are framed as catching "inconsistencies from non-deterministic outputs"                                    | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | **CONFIRMED PRESENT** as data generation                                                                                                             | CONFIRMED PRESENT          |
| **Arize Phoenix**           | NOT DOCUMENTED as a product feature. Arize's _guidance_ states release decisions "should consider confidence intervals, repeated runs where appropriate" ([Arize guide](https://arize.com/llm-evaluation/)) — **editorial advice, not a documented feature**                                       | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | CONFIRMED PRESENT          |
| **Langfuse**                | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | CONFIRMED PRESENT          |
| **Galileo**                 | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | UNKNOWN — ChainPoll is a proprietary judging method; whether it quantifies judge variance is UNKNOWN | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | UNKNOWN                    |
| **Humanloop**               | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | UNKNOWN                    |
| **Giskard**                 | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | UNKNOWN                    |
| **Maxim**                   | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | UNKNOWN                    |
| **HoneyHive**               | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | UNKNOWN                    |
| **Datadog LLM Obs**         | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | NOT DOCUMENTED                                                                                       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | UNKNOWN                    |
| **Patronus**                | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | NOT DOCUMENTED       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                 | NOT DOCUMENTED    | UNKNOWN — research-grade judges (Lynx, GLIDER)                                                       | NOT DOCUMENTED       | NOT DOCUMENTED                                                                                                                                       | UNKNOWN                    |
| **Braintrust** (reference)  | NOT DOCUMENTED                                                                                                                                                                                                                                                                                     | **CONFIRMED ABSENT** | **CONFIRMED ABSENT** | **CONFIRMED ABSENT**                                                                                                           | CONFIRMED ABSENT  | NOT DOCUMENTED                                                                                       | CONFIRMED ABSENT     | **CONFIRMED ABSENT**                                                                                                                                 | CONFIRMED PRESENT          |

### The correction this forces

**Document 01 was wrong in one direction and right in another.**

**Wrong:** it implied commercial platforms do not handle stochastic variation. **Four platforms — LangSmith, Weave, DeepEval, promptfoo — ship repeated-trial execution, and at least three explicitly motivate it by non-determinism.** LangSmith has a dedicated documentation page for it. That is a materially better state of the art than document 01 described, and the T7 "old-vs-old" observation is less novel than claimed: the tooling to _generate_ the data exists and is documented.

**Right, and now more precisely:** **no commercial platform was found to compute a confidence interval, a significance test, a power analysis, or a multiple-comparison correction from those repeats.** The repeats produce N numbers; the user is left to interpret them. Weave states each run is "scored and displayed independently" — display, not inference.

**The gap is therefore narrower and sharper than document 01 stated:** it is not "platforms ignore stochasticity"; it is "platforms generate repeated measurements and then perform no statistical inference on them."

**Nine of thirteen platforms remain NOT DOCUMENTED across nearly every question.** This is honest but weak. Only Braintrust is verified at source level. **No claim that "nobody does this" is supportable**, and document 01's confidence exceeded its evidence.

## `evalci` verification — a significant downgrade

Document 01 and 07 cited `evalci` as a primary fatal fact: a free library implementing the entire track.

**Findings:**

| Question                          | Answer                                                                                                                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paper exists?                     | **CONFIRMED** — [arXiv 2607.04429](https://arxiv.org/pdf/2607.04429), submitted **July 5, 2026**                                                                                                                                                                      |
| Claimed capability                | CIs, paired significance tests, power analysis, clustered SEs, multiple-comparison correction; validated against statsmodels                                                                                                                                          |
| Claimed distribution              | Paper states PyPI availability, a GitHub repository, and a Zenodo DOI                                                                                                                                                                                                 |
| **Package locatable on PyPI?**    | **NO.** Targeted searches for `evalci` on PyPI and GitHub did not locate it. Results returned `evalplus`, `evalica`, `evalops`, `evalml`, `evalai` — different packages                                                                                               |
| **Actual code license**           | **UNKNOWN.** The _paper_ is CC-BY 4.0. **A paper licence is not a code licence**, and document 01 conflated them                                                                                                                                                      |
| **Adoption**                      | **UNKNOWN, presumed negligible** — the paper is five weeks old                                                                                                                                                                                                        |
| **Maintenance / release history** | **UNKNOWN**                                                                                                                                                                                                                                                           |
| **Adapters**                      | **CONFIRMED: lm-evaluation-harness and HELM output** — i.e. **benchmark harness formats only**. **INFERENCE:** product teams do not use lm-eval-harness or HELM; they use Braintrust, LangSmith, or promptfoo. The adapters do not reach product-team evaluation data |

**Downgrade:** document 07's fatal fact "implemented free in `evalci`" is **not supported**. What is supported is that a five-week-old paper describes such a library, whose package could not be located, whose code licence is unknown, and whose adapters target benchmark harnesses rather than the product-team data this track concerns.

`lm-evaluation-harness` (stderr by default) and `Inspect AI` (mean/stderr) **remain CONFIRMED** — but both are benchmark harnesses, not product-team eval platforms. The "free substitute already exists" argument therefore applies to _researchers_, not to the users of the thirteen platforms above.

---

# Defect 2 — Track B conflated ingestion with reconciliation

The defect is real. Document 02's fatal fact — "reconciling an estimate against the bill is unnecessary when the platform reads the bill" — **assumed the conclusion**. Ingesting an invoice tells you the total. It does not tell you why your telemetry-derived estimate differs from it, which is the actual job.

## The six jobs, separated

|  #  | Job                                                                                                            | Status                                                               |
| :-: | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|  1  | Provider bill ingestion                                                                                        | **CONFIRMED PRESENT** in FinOps platforms                            |
|  2  | Cost allocation by team/project                                                                                | **CONFIRMED PRESENT**                                                |
|  3  | Token-level usage attribution                                                                                  | **CONFIRMED PRESENT** (Vantage, FinOps LLM)                          |
|  4  | **Reconciliation of telemetry estimate vs billed total**                                                       | **CONFIRMED PRESENT in at least one specialist product — see below** |
|  5  | **Explanation of the residual**                                                                                | **CONFIRMED as a described practice; product coverage UNKNOWN**      |
|  6  | Contract-rate, discount, batch, cache, gateway-markup, retry, tax, currency, period, self-hosted GPU treatment | **Partially present; per-item coverage UNKNOWN**                     |

## The competitor document 02 missed entirely

**FinOps LLM** ([finopsllm.com](https://finopsllm.com/)) — PRIMARY source, vendor's own site:

- "token-level cost data ingested from every provider. **Reconciled hourly**"
- "**Invoice-first audits**"; savings "**reconciled to invoice**"
- Providers: "OpenAI, Anthropic, Gemini & Vertex AI, AWS Bedrock, Azure OpenAI, Groq, Together, Mistral, Cohere, Fireworks, Replicate, and most OSS endpoints"
- Business model: performance-based at "**15–25% of verified savings**" with a "**$20K/month LLM spend**" minimum, or self-serve "**from $1,500/mo**"
- Evidence of a shipping product: implementation phases, monthly "Statement of Savings", weekly engineering reviews

**This is Track B's exact job, with a working business model and a stated spend floor.** Document 02 listed FinOps LLM in the Tier 3 register inherited from doc 02 of the main archive and **never checked it** — a straightforward research failure.

## The job is real and partly organizational

PRIMARY-adjacent practitioner source ([invoicedataextraction.com](https://invoicedataextraction.com/blog/finops-for-ai)) describes reconciliation as an **open manual problem**:

> "Provider exports and gateways can identify a project, key, application, or team, but they do not always equal the amount finance pays."

> "The operating model crosses **FinOps, engineering, procurement, AP, and controllership**."

And the residual practice is explicit — matched / explained variance / unresolved, with an exception queue and evidence links.

**INFERENCE:** the job exists and is not trivially solved by ingestion. But it spans five organisational functions including accounts payable and controllership, which is a procurement-heavy enterprise sale, and one specialist vendor already occupies the software slice with performance-based pricing.

## Citation downgrade

Document 02's claims about **Finout, Vantage, and CloudZero** rested on **Finout's own blog and Amnic comparison articles** — SECONDARY sources, and in Finout's case a vendor writing about competitors. An attempt to verify against Finout's own documentation hub returned only a landing page with no data-source detail.

**Therefore:** the specific claims that Finout ingests final invoiced amounts, that Vantage has token-level first-party connectors, and that CloudZero uses AnyCost for this are **downgraded from VERIFIED to SECONDARY-SOURCED**. They are plausible and probably correct, but they are not primary-verified and cannot carry a fatal conclusion.

---

# Defect 3 — Track C treated an AWS deployment tool as the complete scenario

The defect is real and it is the largest error in the reset phase.

## `deploy-on-aws` — what is actually confirmed

PRIMARY source: [claude.com/plugins/deploy-on-aws](https://claude.com/plugins/deploy-on-aws), [AWS blog](https://aws.amazon.com/blogs/developer/introducing-agent-plugins-for-aws/).

| Distinction                                | Finding                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idea-only vs existing codebase             | **REQUIRES AN EXISTING CODEBASE.** It "operates on an existing application codebase"; step 1 is "Scan your codebase". Also "Requires AWS CLI with configured credentials" |
| AWS-only vs vendor-neutral                 | **AWS-ONLY. CONFIRMED.** "makes no mention of comparing Azure, GCP, or other cloud platforms"                                                                             |
| Infrastructure vs AI model selection       | **INFRASTRUCTURE ONLY.** "No indication" of AI model selection functionality                                                                                              |
| Architecture text vs interactive visual    | **NO INTERACTIVE DIAGRAM.** "no mention of generating interactive diagrams"                                                                                               |
| Price estimate vs comparative total cost   | Projected monthly cost **for the AWS option only**. No comparative TCO across providers                                                                                   |
| Recommendation vs evidence and uncertainty | Recommendations "with concise rationale". No uncertainty quantification documented                                                                                        |
| Claude Code vs Codex                       | Claude Code and Cursor confirmed. **Codex support NOT DOCUMENTED**                                                                                                        |

## The scenario, sub-step by sub-step

|     | Sub-step                                                      | `deploy-on-aws`                                    |
| :-: | ------------------------------------------------------------- | -------------------------------------------------- |
| C1  | Idea, no repository                                           | **FAILS — requires a codebase**                    |
| C2  | Elicit functional and non-functional constraints              | NOT DOCUMENTED                                     |
| C3  | Compare AWS / Azure / GCP / edge / SaaS / self-host           | **FAILS — AWS only**                               |
| C4  | Managed AI APIs vs open-source/self-hosted models             | **FAILS — no model selection**                     |
| C5  | Incorporate compute the user already owns                     | **FAILS**                                          |
| C6  | Evidence-backed architecture                                  | Partial — rationale, not evidence with uncertainty |
| C7  | Interactive visual diagram                                    | **FAILS**                                          |
| C8  | Challenge and revise decisions                                | **PASSES** — conversational in the agent           |
| C9  | Cost, complexity, operational burden, migration risk, lock-in | Partial — cost only                                |
| C10 | Export structured context for Claude Code / Codex             | Partial — Claude Code yes, Codex NOT DOCUMENTED    |
| C11 | Continue into implementation without losing decisions         | **PASSES** — IaC generation and deployment         |

**`deploy-on-aws` covers roughly 2 of 11 sub-steps cleanly.** Document 03's claim that it "ships the workflow free inside Claude Code" is **wrong** and is withdrawn.

## What the combination actually requires

Per the stated test, a combination counts as competition only if handoffs are feasible, outputs compatible, context is not manually reconstructed, the decision loop is covered, and it does not require expertise the target user lacks.

A combination covering C1–C11 would be roughly: Archie or BackArch or ArchGenie (idea→architecture, multi-cloud cost) + a diagram tool + a model/hardware calculator + Claude Code + `deploy-on-aws` for the AWS branch.

**This is labelled HYPOTHETICAL, not SOLVED.** Reasons: handoff compatibility between these tools is UNVERIFIED; whether context survives the handoffs is UNVERIFIED; and **the target user in the scenario explicitly lacks architectural direction**, so requiring them to orchestrate four tools and judge the outputs violates the final condition of the test.

**Downgrade:** Track C has **no confirmed fatal fact from competition.** Archie, BackArch, and ArchGenie were verified at marketing-page level in the main archive's doc 06 and were **not re-verified here** against C1–C11. Their coverage is **UNKNOWN**.

---

# Defect 4 — Track D used GitHub stars as demand evidence

The defect is real, and the underlying data destroys the inference.

## PromptScan forensics

PRIMARY source: [GitHub API](https://api.github.com/repos/joandino/promptscan), retrieved August 13, 2026.

| Metric          | Value             |
| --------------- | ----------------- |
| Stars           | 0                 |
| Forks           | 0                 |
| Watchers        | 0                 |
| Open issues     | 0                 |
| **Created**     | **July 21, 2026** |
| **Last push**   | **July 28, 2026** |
| Size            | 1,542 KB          |
| Licence         | MIT               |
| Archived        | No                |
| **Description** | **None**          |
| **Homepage**    | **None**          |

**The repository is three weeks old, has no description, and has no homepage.**

**Correction:** zero stars on a three-week-old repository with no description and no homepage is evidence of **zero discoverability**, not zero demand. Nobody could have found it. There was no announcement, no package listing, and nothing on the repository page telling a visitor what it does.

Document 04's characterisation of PromptScan as "the only available natural experiment on whether a static-only repository cost audit is not a product anyone wants" is **withdrawn**. It is not a natural experiment. It is an unlaunched project.

Package downloads, marketplace installs, maintainer status, and documented users: **UNKNOWN** — no package registry entry was located.

## Does `deploy-on-aws` detect inefficient existing choices?

**NOT DOCUMENTED, and the balance of evidence says no.** Its five steps are scan → recommend AWS services → cost → generate IaC → deploy. That is **mapping an application onto AWS deployment services**, not detecting that an existing choice is inefficient and proposing a migration.

**Downgrade:** document 04's claim that "the static half ships in that same plugin" is **not supported**. The plugin does deployment mapping; Track D's job is inefficiency detection. These are different.

## What survives in Track D

The structural argument **survives and is independent of competition**: source code alone cannot establish traffic volume, cache-hit rate, retry rate, or output length, and therefore cannot quantify whether a choice is _unnecessarily_ expensive. Track D's job as specified requires quantification.

**But:** that blocks the _quantified_ form of the job, not the job entirely, and it makes the job dependent on runtime data that is competed rather than impossible. Under the stated rules, "several tools collectively hold the data" is a risk factor, not a fatal fact.

---

# Summary of corrections

## Claims downgraded from VERIFIED

|  #  | Claim                                                                        | Was                 | Now                                                                                                  |
| :-: | ---------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
|  1  | "`evalci` implements the track, free"                                        | VERIFIED fatal fact | **Paper exists; package not locatable; code licence UNKNOWN; adapters are benchmark-only**           |
|  2  | "Commercial platforms do not handle stochastic variance"                     | Implied             | **False — four ship repeated trials**                                                                |
|  3  | "Finout/Vantage/CloudZero ingest invoices, so reconciliation is unnecessary" | VERIFIED fatal fact | **SECONDARY-sourced, and the inference was invalid — ingestion ≠ reconciliation**                    |
|  4  | "`deploy-on-aws` ships the Track C workflow"                                 | VERIFIED fatal fact | **False — covers ~2 of 11 sub-steps; requires a codebase; AWS-only; no model selection; no diagram** |
|  5  | "The static half of Track D ships in `deploy-on-aws`"                        | VERIFIED            | **NOT DOCUMENTED — deployment mapping is not inefficiency detection**                                |
|  6  | "PromptScan's 0 stars show no demand"                                        | VERIFIED fatal fact | **Withdrawn — 3-week-old repo, no description, no homepage**                                         |
|  7  | "Track C/D competitors Archie, BackArch, ArchGenie cover the scenario"       | Inherited VERIFIED  | **UNKNOWN against C1–C11 — not re-verified**                                                         |

## New facts established

| Fact                                                                                                                                              | Source class                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| LangSmith `num_repetitions`, W&B Weave `trials`, DeepEval `-r`, promptfoo `--repeat` — all CONFIRMED PRESENT                                      | PRIMARY                                         |
| No commercial platform found computing CIs, significance tests, power analysis, or multiple-comparison correction from repeats                    | PRIMARY where checked; NOT DOCUMENTED elsewhere |
| **FinOps LLM** ships invoice-first reconciliation across 12+ providers at 15–25% of verified savings or $1,500/mo                                 | PRIMARY (vendor site)                           |
| Reconciliation crosses FinOps, engineering, procurement, AP, and controllership                                                                   | Practitioner source                             |
| `deploy-on-aws` requires an existing codebase and AWS CLI credentials; AWS-only; no model selection; no interactive diagram; Codex NOT DOCUMENTED | PRIMARY                                         |
| PromptScan created 2026-07-21, last push 2026-07-28, no description, no homepage                                                                  | PRIMARY (GitHub API)                            |

## Remaining UNKNOWN

1. CI/significance capability for **nine of thirteen** eval platforms — Langfuse, Galileo, Humanloop, Giskard, Maxim, HoneyHive, Datadog, Patronus, and Phoenix beyond editorial guidance.
2. Judge-variance quantification anywhere, including Galileo's ChainPoll and Patronus's Lynx/GLIDER.
3. Whether `evalci` exists as an installable package, and under what code licence.
4. Finout / Vantage / CloudZero reconciliation behaviour from **primary** sources.
5. Whether any FinOps platform joins individual traces to invoice line items and explains residuals.
6. FinOps LLM's actual customer count, retention, and whether "reconciled hourly" means true estimate-vs-invoice reconciliation.
7. Archie, BackArch, ArchGenie coverage against C1–C11.
8. Whether any product detects inefficient existing architectural choices and proposes migrations.
9. PromptScan's package downloads and maintainer intent.
