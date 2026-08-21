# Competitor Validation Matrix

Purpose: separate what is **confirmed** about competitors from what is **inferred**, and identify what must be tested hands-on before ANVILMARK claims any differentiation publicly.

**Binding rule:** ANVILMARK does not make a public differentiation claim against any product until that product's behaviour has been tested hands-on and recorded here. Marketing copy describes intended positioning. It is not product behaviour, and citing it as though it were is how a differentiation claim becomes embarrassing.

**Verification status of everything below: desk research only, August 13, 2026. No hands-on trial has been performed.**

---

> **SUPERSEDED FOR BRAINTRUST — August 13, 2026.** Source-code analysis established that Braintrust's PR comment renders `summary.metrics`, which includes **Estimated LLM cost** and token counts, with deltas and improvement/regression counts. **C5 and C1 are occupied.** The earlier finding that the PR comment contains no cost field was wrong. See [`../research/08-braintrust-reassessment.md`](../research/08-braintrust-reassessment.md) and [`../../experiments/braintrust-validation/EVIDENCE-RECORD.md`](../../experiments/braintrust-validation/EVIDENCE-RECORD.md).

## The capability being claimed

To claim differentiation, ANVILMARK must show that no existing product performs this specific chain:

| #      | Capability                                                                                                  | Why it matters                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **C1** | Build a **traffic profile** from the customer's measured production telemetry — distributions, not averages | Without it, every downstream number is a guess.                                   |
| **C2** | Reconcile a reconstructed cost baseline **against the provider invoice**, with named residuals              | The trust-establishing step. Nobody sells a prediction on an unverified baseline. |
| **C3** | Map a **PR diff** to specific measured call sites                                                           | Connects code change to measured population.                                      |
| **C4** | **Replay real recorded production inputs** through old and new configurations, paired                       | The measurement itself.                                                           |
| **C5** | Predict **monthly cost delta at the customer's actual volume**, with a composed interval                    | The number the customer needs at merge time.                                      |
| **C6** | Measure **quality delta** on the same paired sample, via a deterministic-first hierarchy                    | Cost without quality is half the decision.                                        |
| **C7** | Deliver the verdict **at merge time**, in the PR                                                            | Decision point, not dashboard.                                                    |
| **C8** | Measure **actual outcome post-deploy and score its own prediction**                                         | **The falsifiability step. This is the differentiator, if any is.**               |

**[INFERENCE]** C1, C4, C6, and C7 individually exist in the market. C2, C3, C5, and especially **C8** are where the claim rests. If a competitor is found doing C8, the wedge's defensibility score of 7 was wrong and the recommendation must be revisited immediately.

---

## Matrix

Legend: **✅ confirmed present** · **❌ confirmed absent** · **◐ partial** · **? inferred, untested** · **— not applicable**

| Product             | C1 profile | C2 invoice recon | C3 PR→call site | C4 replay | C5 cost delta | C6 quality delta | C7 at merge | C8 self-scoring |
| ------------------- | :--------: | :--------------: | :-------------: | :-------: | :-----------: | :--------------: | :---------: | :-------------: |
| **Braintrust**      |    ✅ S    |       ❌ d       |        ?        |   ✅ D    |     ✅ S      |       ✅ D       |    ✅ D     |      ❌ d       |
| **Langfuse**        |    ◐ ?     |        ?         |        ?        |     ?     |     ❌ ?      |       ◐ ?        |      ?      |        ?        |
| **Helicone**        |    ◐ ?     |        ?         |      ❌ ?       |   ❌ ?    |     ❌ ?      |       ❌ ?       |    ❌ ?     |      ❌ ?       |
| **Datadog LLM Obs** |    ◐ ?     |       ◐ ?        |      ❌ ?       |   ❌ ?    |     ❌ ?      |       ◐ ?        |    ❌ ?     |      ❌ ?       |
| **promptfoo**       |    ❌ ?    |        ❌        |        ?        |    ◐ ?    |      ◐ ?      |        ✅        |     ✅      |      ❌ ?       |
| **PromptScan**      |     ❌     |        ❌        |       ✅        |    ❌     |       ◐       |        ❌        |     ✅      |       ❌        |

Evidence markers: **S** = confirmed at source-code level (strongest) · **D** = documented in official docs · **d** = absent from official docs after targeted search · **?** = inferred, untested.

Every `?` in this table is an obligation. None may be converted to a claim without a hands-on trial. **`d` marks are also not yet claims** — absence from documentation is evidence, not proof; the hands-on trial converts them.

---

## Per-product assessment

### Braintrust — **the primary absorption risk**

**Documentation investigation completed August 13, 2026.** Detailed answers to the eight decision questions are below. Hands-on trial still required — see [`braintrust-hands-on-test-plan.md`](braintrust-hands-on-test-plan.md).

#### The eight questions, answered from primary sources

**Q1. Can it connect production traces to evaluation datasets? — YES, documented.**
Braintrust's logs documentation states that "Production data seamlessly becomes evaluation datasets," that "Instrumentation code works for both logging and evaluation," and that "Traces capture identical data in production and testing" ([docs](https://www.braintrust.dev/docs/guides/logs)). Online scoring evaluates production traces asynchronously as they are logged, and scored traces can "become new test cases" ([docs](https://www.braintrust.dev/docs/guides/logs/score)).

**Q2. Can it run evaluations and quality gates on pull requests? — YES, documented.**
The `braintrustdata/eval-action` GitHub Action "runs Braintrust evals in GitHub Actions and posts a live summary comment on the associated pull request" ([repo](https://github.com/braintrustdata/eval-action)). Docs describe running "in CI/CD, to catch regressions automatically on every pull request" ([docs](https://www.braintrust.dev/docs/guides/evals/run)). Merges can be blocked below a score threshold ([source](https://www.braintrust.dev/articles/best-tools-tracking-llm-costs-2026)).

**Q3. Can it measure cost and token usage per production span? — YES, documented.**
"Token and cost data is available on every span, including LLM calls, retrieval steps, and individual tool invocations" ([source](https://www.braintrust.dev/articles/best-tools-tracking-llm-costs-2026)). The Observe product page describes "cost attached to every step" and the ability to "break down LLM spend by model, feature, or team" ([product](https://www.braintrust.dev/product/observe)).

**Q4. Can it project a PR's monthly cost consequence using measured production traffic? — NO EVIDENCE FOUND.**
This is the decisive answer. The documented PR-comment fields are: a link to the experiment, **Score** (with percentage-point change), **Average**, **Improvements** count, **Regressions** count, and **Duration** ([repo](https://github.com/braintrustdata/eval-action)). **No cost field, no token delta, no monthly projection, no traffic-volume weighting appears in the documented output.** The Observe page describes cost capabilities as tracking and breakdown "in real time" — retrospective, not predictive ([product](https://www.braintrust.dev/product/observe)).

**Q5. Can it compare a pre-merge projection with post-deployment actuals? — NO EVIDENCE FOUND.**
No documented feature performs this comparison. The closest documented capability is _alerting_: alerts can fire on "error rate spikes, latency increases, cost anomalies, or evaluation score regressions," using statistical methods to distinguish real regressions from normal variation ([source](https://www.braintrust.dev/articles/best-ai-observability-tools-2026)). **[INFERENCE]** That is anomaly detection after the fact, not the scoring of a prediction made before the fact. The two are structurally different: one asks "did something change?", the other asks "was I right?"

**Q6. Does it expose prediction error or calibration history? — NO EVIDENCE FOUND.**
Nothing in the reviewed documentation describes prediction error, calibration, or an accuracy track record. **[INFERENCE]** This follows from Q4 and Q5 — a platform that makes no forward prediction has nothing to calibrate.

**Q7. Can it replay production inputs through old and proposed configurations? — YES, effectively, documented.**
**This is closer than the pre-research estimate assumed.** Production logs convert to datasets (Q1); experiments run a task over a dataset; experiments are compared to measure "improvements and regressions between runs" ([docs](https://www.braintrust.dev/docs/guides/evals/run)). Running an experiment with a changed configuration over a production-derived dataset **is** replay of production inputs through old and new configurations.

What remains undocumented, and matters:

- whether the dataset is **weighted by production frequency**, or is an unweighted sample;
- whether comparison is **paired on identical inputs** at the row level, or aggregate-to-aggregate;
- whether any **noise-floor control** exists (running the same configuration twice to separate signal from stochastic variation);
- whether cost, as opposed to score, appears in experiment comparison at all.

**Q8. Documented fact vs inference vs unverified.**

| Finding                                                        | Status                                                   |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| Production logs → eval datasets; online scoring                | **Documented fact**                                      |
| PR eval action with merge blocking                             | **Documented fact**                                      |
| Token and cost on every span                                   | **Documented fact**                                      |
| PR comment fields contain no cost or token metrics             | **Documented fact** (the field list is explicit)         |
| Experiment comparison = replay of production inputs old vs new | **Documented fact** (composition of documented features) |
| No monthly cost projection at production volume                | **Absence from documentation** — strong but not proof    |
| No pre-merge vs post-deploy prediction scoring                 | **Absence from documentation** — strong but not proof    |
| No invoice reconciliation                                      | **Absence from documentation** — strong but not proof    |
| No calibration history                                         | **Inference** from Q4/Q5                                 |
| Whether datasets are traffic-weighted                          | **Genuinely unverified** — must test hands-on            |
| Whether comparison is row-paired                               | **Genuinely unverified** — must test hands-on            |
| Whether cost appears in experiment diffs                       | **Genuinely unverified** — must test hands-on            |

#### Assessment

**The wedge survives, and it narrowed.**

C4 (replay) must be **upgraded to ✅ confirmed present** for Braintrust. The original scoring treated replay as part of the differentiator; it is not. Braintrust customers can already replay production inputs through a changed configuration and see score deltas at merge time.

What remains unoccupied, on documentation evidence: **C2** (invoice reconciliation), **C5** (monthly cost delta at measured volume, in the PR), and **C8** (predicted-versus-actual self-scoring). The honest differentiator is therefore narrower than document 06 implied — it is **the cost dimension and the calibration loop**, not replay and not quality evaluation.

**Two facts that raise absorption risk. [VERIFIED]** Braintrust raised an **$80M Series B led by Sequoia, $121M total** ([source](https://www.tamradar.com/funding-rounds/braintrust-series-b-80m)), with customers including Notion, Stripe, Zapier, Vercel, Ramp, Coursera, Dropbox, and Replit ([braintrust.dev](https://www.braintrust.dev/)). **[INFERENCE]** They already hold every input required for C5 — per-span cost, production volume, and a PR surface. Adding a monthly cost projection to the existing PR comment is a small feature, not a platform change. Defensibility scored at 7 in document 06 looks optimistic; on this evidence **5 is more defensible**, and the moat is the accumulated calibration record rather than the capability itself.

**Must still test hands-on** (see [`braintrust-hands-on-test-plan.md`](braintrust-hands-on-test-plan.md)):

**Must test hands-on:**

1. Can production logs be turned into a PR-time dataset, weighted by real traffic frequency? Or is the PR dataset always curated?
2. Does any surface state a **projected monthly cost delta** for a diff, at measured volume?
3. Does anything compare a pre-merge prediction to post-deploy reality?
4. Is there any invoice reconciliation, or is cost purely platform-computed from a price table?
5. Do PR evals report **paired** results on identical inputs, and is any noise floor established?

**Decision trigger:** if 2 and 3 are both yes, **stop the sprint and reassess**. The wedge is occupied.

---

### Langfuse

**Confirmed [RESEARCH + VERIFIED context]:** span-tracing platform with first-class OpenTelemetry GenAI support and an Apache-2.0 self-host option; per-key tagging flowing into spend reports; scores attachable to traces and observations.

**Inferred [INFERENCE]:** primarily an observability and eval-storage layer. Cost reporting is retrospective. No PR-time verdict, no replay, no invoice reconciliation.

**Strategic note:** Langfuse is more likely a **data source than a competitor** — self-hosted Langfuse is among the best possible inputs for C1 and removes the largest privacy objection. Test its export path as an integration, not only as a rival.

**Must test hands-on:**

1. Export completeness: are cache-read, cache-write, and reasoning tokens broken out in `usage`?
2. Is call-site identity recoverable from generation names, tags, or metadata with real-world naming discipline?
3. Can full token distributions be exported, or only aggregates?
4. Do scores carry enough provenance to be usable as a tier-2 quality signal?

---

### Helicone

**Confirmed [RESEARCH]:** proxy that logs requests at the wire, fast integration, OpenAI-compatible; per-key tagging into spend reports.

**Inferred [INFERENCE]:** proxy-position gives good cost visibility and poor code visibility — it cannot know which line of code made a call except via custom properties. No PR integration, no replay, no prediction.

**Must test hands-on:**

1. Are `Helicone-Property-*` custom properties reliable enough in practice to serve as call-site identity?
2. Is Helicone's own proxy cache distinguishable from provider-side prompt caching in the export? (These have different economics and conflating them corrupts C2.)
3. What fraction of a typical customer's calls bypass the proxy?

---

### Datadog LLM Observability

**Confirmed [RESEARCH]:** LLM and agent observability with cost monitoring.

**Inferred [INFERENCE]:** enterprise APM lineage. Strong on aggregation and alerting, weak on the code-change decision point. Likely has better invoice-adjacent cost tooling than the LLM-native tools, given Datadog's cloud-cost heritage — **this is worth checking specifically**, because it is the one product that might partially do C2.

**Must test hands-on:**

1. Does its cost tooling reconcile against actual provider invoices, or only compute from a price table?
2. Any PR-time surface at all?
3. Is per-call-site attribution available at code granularity?

---

### promptfoo

**Confirmed [RESEARCH]:** open-source eval framework, CI-integrated, config-driven.

**Inferred [INFERENCE]:** the closest thing to C4 that exists as a commodity — it runs prompts through multiple configurations and compares. But test cases are **authored**, not sampled from measured production traffic; there is no traffic profile, no volume weighting, no cost projection, and no post-deploy scoring.

**Strategic note:** **[INFERENCE]** promptfoo is a plausible _component_. If replay can be implemented on top of it, the throwaway harness gets cheaper. Evaluate it as a build-versus-adopt decision for Day 8–9, not only as a competitor.

**Must test hands-on:**

1. Can it be driven from a dataset of recorded production inputs with per-row weights?
2. Does it report paired per-case deltas, or only aggregate pass rates?
3. Can custom deterministic assertions cover a realistic tier-1 quality check?
4. Does it report token counts and cost per case?

---

### PromptScan

**Confirmed [VERIFIED, Aug 13 2026]** ([source](https://github.com/joandino/promptscan)):

- Static source analysis only — explicitly does not use runtime or production data.
- Includes a GitHub Action that diffs between git refs, posts cost-change summaries to PRs, and fails checks above a threshold.
- **0 stars, 0 watchers, 78 commits, MIT licensed.**

**Assessment [INFERENCE]:** the capability of "post a cost delta on a PR" is already built and already free, and nobody uses it. Two readings, and the sprint must distinguish them:

- **Reading A:** the problem is not urgent, and ANVILMARK's premise is wrong.
- **Reading B:** static-only estimates are not trustworthy enough to act on, which is precisely why calibration is the wedge.

**[INFERENCE]** Reading B is more likely, because a static estimate cannot know volume, cache-hit rate, or real output length — the estimate is directionally suggestive and numerically meaningless. But Reading A cannot be dismissed from a star count. **Ask about this in interviews**: show participants the concept of a static cost estimate on a PR and ask whether they would act on it. Their answer discriminates between the readings.

**Must test hands-on:**

1. Run it on a real repository. How accurate is its static estimate against measured actuals?
2. How does it handle dynamic prompt assembly?
3. Is the PR comment format actionable?

---

## Adjacent products — verified, not in the matrix

These occupy the wedges the recommendation rejected. Confirmed here so the rejection stays justified, and re-checked if the wedge is ever reconsidered.

| Product                                                                                                                        | Confirmed capability [VERIFIED Aug 13 2026]                                                                                                                                                 | Bearing on this wedge                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [ArchRails](https://www.archrails.io/)                                                                                         | MCP gate before code generation **and** merge-blocking PR gate; rules in FINOS CALM JSON; deterministic engine, no ML decides pass/fail; BYOC                                               | Owns W1/W5. Confirms those wedges are occupied. No runtime economics.                                                    |
| [GovForge](https://govforge.dev/en/)                                                                                           | Apache-2.0 free; MCP server, CLI, local decision timeline; five governance lenses including architecture and performance; **explicitly analyzes diffs and commits, not production metrics** | Free floor under W1/W5. Its explicit absence of runtime data is the strongest single support for the calibration thesis. |
| [Archcore](https://archcore.ai/)                                                                                               | Git-native `.archcore/`; nineteen typed document categories with named relations; MCP to eight agents; session hooks                                                                        | Owns W4.                                                                                                                 |
| [ModelFit](https://modelfit.io/calculator/), [apxml](https://apxml.com/tools/vram-calculator), [llmfit.io](https://llmfit.io/) | Free VRAM/hardware planners; apxml v3.0 (2026-08-03) added a setup planner with throughput and cost trade-offs                                                                              | Owns W3 at zero price.                                                                                                   |

---

## Hands-on trial plan

Runs in parallel with interviews, Days 1–13. No extra headcount.

| Priority | Product         | Days  | Question that must be answered                                                      | Consequence if unfavourable                                   |
| :------: | --------------- | ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
|  **1**   | **Braintrust**  | 2–5   | Does it project cost at real volume on a PR, and does it score its own predictions? | **Stop the sprint and reassess.**                             |
|  **2**   | promptfoo       | 5–7   | Can it be driven from weighted production inputs with paired per-case deltas?       | Adopt as a harness component, or build.                       |
|  **3**   | Langfuse        | 6–8   | Export completeness for cache/reasoning tokens, and call-site identity in practice  | Determines feasibility of C1 for a large slice of the market. |
|  **4**   | Helicone        | 8–9   | Custom-property reliability; proxy vs provider cache distinction                    | Same.                                                         |
|  **5**   | PromptScan      | 9–10  | Static estimate accuracy against measured actuals                                   | Directly quantifies the value of calibration.                 |
|  **6**   | Datadog LLM Obs | 10–11 | Any invoice reconciliation?                                                         | The one plausible C2 competitor.                              |

### Two shared scenarios

Every trial runs the same two, so results are comparable:

- **Scenario 1 — model swap.** A classification call site moves from a flagship to a smaller model. Deterministic quality signal available. Tests cost delta and tier-1 quality.
- **Scenario 2 — prompt expansion.** A summarization call site gains a longer system prompt with few-shot examples, interacting with prompt caching. No deterministic signal. Tests cache economics and the quality-measurement hierarchy under difficulty.

### Recording

For each product and scenario: what it did, what it did not do, screenshots, the exact number it produced (if any), and how that compares with the measurement. **Update the matrix, converting every `?` to a confirmed mark.**

---

## Differentiation claim — release gate

Before any public claim, all of the following must be true:

- [ ] Every `?` and `d` for Braintrust is resolved by hands-on trial.
- [ ] C8 (self-scoring) is confirmed absent in all six products.
- [ ] C5 (cost delta at real volume, at merge time) is confirmed absent or materially weaker in all six.
- [ ] C2 (invoice reconciliation) is confirmed absent in all six.
- [ ] The claim is written as a **specific capability difference**, not a category claim.
- [ ] The claim names what competitors do well. A comparison that flatters us on every axis will not be believed and should not be.
- [ ] **The claim does not include replay or quality evaluation as differentiators.** As of the August 13, 2026 documentation investigation, Braintrust demonstrably does both.

**[INFERENCE]** The honest claim, narrowed by the Braintrust findings, is:

> _"We predict what a code change does to your monthly bill at your measured traffic volume, and we publish how wrong we were."_

Two things must **not** appear in it: replay of production inputs (Braintrust does this via logs→datasets→experiments) and quality evaluation on a PR (Braintrust does this, with merge blocking). Claiming either would be false and checkable in minutes by anyone who has used Braintrust.

Anything broader still — "the architecture decision system," "vendor-neutral optimization" — is supported by nothing in this sprint and reintroduces exactly the over-broad positioning that document 06 rejected.
