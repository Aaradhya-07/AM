# Calibrated Merge Report — Template

The deliverable's exact shape. Produced manually during validation per [`experiment-protocol.md`](experiment-protocol.md).

## Rules for filling this in

1. **Every placeholder in `{{braces}}` is either filled with evidence or replaced with `INSUFFICIENT EVIDENCE` and an explanation.** Nothing is left blank, and nothing is filled with a plausible guess.
2. **No number appears without its uncertainty.**
3. **Significant figures never exceed what the interval supports.**
4. **The verdict is written last**, after every section is complete.
5. **Bad news goes at the top.** If the analysis could not establish something material, that appears in the verdict, not in a footnote.
6. Sections are never deleted. A section that does not apply says so and says why.

---

---

# Calibrated Merge Report

**Repository:** `{{repo}}`
**Pull request:** `{{pr_number}}` — {{pr_title}}
**Prepared:** {{date}} · **Analyst:** {{name}} · **Protocol version:** {{version}}
**Prediction recorded before outcome examined:** {{yes / no — if no, this report cannot be used for calibration scoring}}

---

## 1. Verdict

> **{{MERGE / MERGE WITH CONDITIONS / DO NOT MERGE YET / INSUFFICIENT EVIDENCE}}**
>
> {{Two or three sentences in plain language. State the expected effect and the main uncertainty. If the analysis could not establish something material, say it here.}}

|                                            |                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| **Monthly cost impact**                    | {{+/− $X,XXX (interval: $X,XXX to $X,XXX)}} · {{or INSUFFICIENT EVIDENCE}}    |
| **Quality impact**                         | {{direction and magnitude, with method and n}} · {{or INSUFFICIENT EVIDENCE}} |
| **Distinguishable from run-to-run noise?** | {{yes / no — from the old-vs-old control arm}}                                |
| **Confidence in this verdict**             | {{high / medium / low}} — {{one-line reason}}                                 |
| **Human review performed**                 | {{yes — n pairs, by {{role}} / no — verdict is provisional}}                  |

### Conditions attached to this verdict

{{Numbered, specific, and checkable. Or: none.}}

---

## 2. What changed

| Call site | File            | What changed                                    | Share of measured spend at affected sites |
| --------- | --------------- | ----------------------------------------------- | ----------------------------------------- |
| `{{id}}`  | `{{path:line}}` | {{model / prompt / params / routing / caching}} | {{%}}                                     |

**Mapping method:** {{explicit tag / prompt version / OTel span + code attrs / trace name / inferred from model+prefix hash}}
**Mapping confidence:** {{high / medium / low}}. {{If inferred, state the inference and its risk explicitly.}}

**Indirect reach:** {{Call sites affected but not named in the diff — shared context assembly, system prompt fragments, retrieval changes. Or: none identified, and the bound of what was traced.}}

---

## 3. Cost delta

### Headline

**{{+/− $X,XXX per month}}** · interval **{{$X,XXX to $X,XXX}}** at {{XX}}%

{{If the interval spans zero: state in words that the direction of the change is not established.}}

### Per call

| Metric               | Old   | New   | Paired difference | Interval |
| -------------------- | ----- | ----- | ----------------- | -------- |
| Input tokens (mean)  | {{}}  | {{}}  | {{}}              | {{}}     |
| Cached-read tokens   | {{}}  | {{}}  | {{}}              | {{}}     |
| Cache-write tokens   | {{}}  | {{}}  | {{}}              | {{}}     |
| Output tokens (mean) | {{}}  | {{}}  | {{}}              | {{}}     |
| Reasoning tokens     | {{}}  | {{}}  | {{}}              | {{}}     |
| **Cost per call**    | {{$}} | {{$}} | {{$}}             | {{}}     |

_Distributions, not just means:_ {{p50 / p95 / p99 of the paired cost difference — the tail is where the money is}}

### How the monthly figure was built

```text
mean paired difference    {{$X.XXXX}}  (interval {{...}})
× projected monthly calls {{N}}        (basis: {{trailing 30-day rate / trend / other}})
= monthly delta           {{$X,XXX}}   (composed interval {{...}})
```

**Uncertainty composition:**

| Source            | Included in the interval?     | Magnitude |
| ----------------- | ----------------------------- | --------- |
| Replay sampling   | {{yes}}                       | {{}}      |
| Volume projection | {{yes / no}}                  | {{}}      |
| Price volatility  | {{yes / no / not applicable}} | {{}}      |
| Mapping coverage  | {{}}                          | {{}}      |

**Structural uncertainty not captured by any interval:** {{traffic-mix drift, cache behaviour assumptions, volume assumptions — in prose}}

---

## 4. Quality delta

**Evaluation tiers used** (highest available first — see [`experiment-protocol.md`](experiment-protocol.md) §9):

| Tier                          | Method                                                     | Applied? | Result | n    |
| ----------------------------- | ---------------------------------------------------------- | -------- | ------ | ---- |
| 1 — Deterministic checks      | {{schema / parse / label match / tool validity}}           | {{}}     | {{}}   | {{}} |
| 2 — Customer's existing evals | {{suite name}} · provenance: {{how the dataset was built}} | {{}}     | {{}}   | {{}} |
| 3 — Customer-defined metrics  | {{}}                                                       | {{}}     | {{}}   | {{}} |
| 4 — Human review              | {{blinded, order-randomized}}                              | {{}}     | {{}}   | {{}} |
| 5 — LLM judge                 | {{only if 1–3 unavailable}}                                | {{}}     | {{}}   | {{}} |

### Headline

**{{direction and magnitude}}** measured by {{highest applicable tier}}, n = {{}}, {{significance / interval}}

### Tier agreement

{{Where tiers disagree, state the disagreement plainly. Do not average. A change that improves judge scores while degrading schema validity is a specific finding.}}

### If an LLM judge was used

|                             |                                                                               |
| --------------------------- | ----------------------------------------------------------------------------- |
| Judge model                 | {{ — and confirmation it is not from either configuration's family}}          |
| Method                      | Pairwise preference, order randomized                                         |
| Position-bias check         | {{result}}                                                                    |
| Agreement with human labels | {{XX% on n = {{}} — if poor, this result is not reported as a quality delta}} |
| Judge prompt                | {{included in full below or in appendix}}                                     |

---

## 5. Regressed examples

The specific cases that got worse. **[Required.]** If none were found, state whether that is because none exist or because the sample could not detect them.

| #   | Input summary | Old output | New output | Which metric regressed | Severity |
| --- | ------------- | ---------- | ---------- | ---------------------- | -------- |
| 1   | {{}}          | {{}}       | {{}}       | {{}}                   | {{}}     |

{{Content shown here only if the report was produced under a mode that permits it. Under Mode A, these are described by the customer's own reviewer or shown only inside their environment.}}

**Pattern:** {{Is there structure to the regressions — a particular input type, length band, or edge case? Or are they scattered?}}

---

## 6. Noise floor — old versus old control

|                                                    |                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| Control arm run                                    | {{yes / no — if no, this report cannot separate signal from noise}} |
| Cost difference, old vs old                        | {{$X.XXXX, interval}}                                               |
| Quality difference, old vs old                     | {{}}                                                                |
| **Is old-vs-new distinguishable from old-vs-old?** | **{{yes / no}}**                                                    |

{{If no: the verdict must state that the change is indistinguishable from run-to-run variation, and no point estimate is presented as an effect.}}

---

## 7. Assumptions

Every assumption the numbers depend on. Each with its basis and the consequence if wrong.

| #   | Assumption                            | Basis                           | If wrong                             |
| --- | ------------------------------------- | ------------------------------- | ------------------------------------ |
| 1   | Monthly volume continues at {{}}      | {{trailing 30-day measurement}} | {{cost delta scales proportionally}} |
| 2   | Traffic mix remains as measured       | {{30-day distribution}}         | {{}}                                 |
| 3   | Cache hit rate remains {{}}           | {{measured}}                    | {{}}                                 |
| 4   | Prices as of {{date}} from {{source}} | {{}}                            | {{}}                                 |
| 5   | {{}}                                  | {{}}                            | {{}}                                 |

---

## 8. Data completeness

### Fields

| Field                     | Present | Notes                                                               |
| ------------------------- | ------- | ------------------------------------------------------------------- |
| Call-site identity        | {{}}    | {{method used}}                                                     |
| Cache read / write tokens | {{}}    | {{if absent: direction and rough magnitude of the resulting error}} |
| Reasoning tokens          | {{}}    | {{}}                                                                |
| Retries distinguishable   | {{}}    | {{}}                                                                |
| Failed calls recorded     | {{}}    | {{}}                                                                |
| Environment separable     | {{}}    | {{}}                                                                |
| Release / commit identity | {{}}    | {{required for the scorecard in §11}}                               |
| Sampling rate declared    | {{}}    | {{}}                                                                |

### Baseline reconciliation

|                          |                                                                 |
| ------------------------ | --------------------------------------------------------------- |
| Telemetry window         | {{aligned to billing period? yes/no}}                           |
| Reconstructed cost       | {{$}}                                                           |
| Invoiced cost            | {{$}}                                                           |
| Variance                 | {{%}}                                                           |
| **Explained**            | {{$ — itemized below}}                                          |
| **Unexplained residual** | {{$ — this number determines whether the baseline is credible}} |

**Reconciliation problem checklist** (all 17 from [`experiment-protocol.md`](experiment-protocol.md) §3):

| #   | Problem                                                                                   | Status                          | Magnitude |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------- | --------- |
| 1   | Credits and free tiers                                                                    | {{found / ruled out / unknown}} | {{}}      |
| …   | {{through 17 — every row completed; "unknown" is a valid and required answer where true}} |                                 |           |

### Sampling

|                                                  |                          |
| ------------------------------------------------ | ------------------------ |
| Minimum meaningful difference (customer-defined) | cost {{}} · quality {{}} |
| Pilot variance                                   | {{}}                     |
| Required sample                                  | {{}}                     |
| Achieved sample                                  | {{}}                     |
| Shortfall reason                                 | {{}}                     |
| Strata and weights                               | {{}}                     |

---

## 9. Confidence

| Dimension            | Rating   | Why                         |
| -------------------- | -------- | --------------------------- |
| Baseline credibility | {{}}     | {{}}                        |
| Call-site mapping    | {{}}     | {{}}                        |
| Sample adequacy      | {{}}     | {{}}                        |
| Replay fidelity      | {{}}     | {{validity checks passed?}} |
| Quality measurement  | {{}}     | {{tier used}}               |
| **Overall**          | **{{}}** | {{}}                        |

### Insufficient evidence

{{Every question this report could not answer, why, and what would be needed. If there are none, say so explicitly.}}

---

## 10. Privacy and execution

|                                             |                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Mode                                        | {{A: in-CI/self-hosted · B: de-identified sample · C: metadata only · D: synthetic}} |
| Replay executed at                          | {{customer CI / customer infra / analyst environment}}                               |
| Request content left customer environment?  | {{no / yes — with what controls}}                                                    |
| Data retained by ANVILMARK                  | {{}}                                                                                 |
| Deletion date                               | {{}}                                                                                 |
| Outputs reviewed by customer before sharing | {{}}                                                                                 |

---

## 11. Post-deployment scorecard

{{Completed after merge and deploy. Until then: "Pending — scheduled for {{date}}."}}

|                    | Predicted           | Actual                      | Error |
| ------------------ | ------------------- | --------------------------- | ----- |
| Monthly cost delta | {{$ with interval}} | {{$ with its own interval}} | {{%}} |
| Quality delta      | {{}}                | {{}}                        | {{}}  |

|                                            |                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| **Direction correct?**                     | {{yes / no / prediction interval spanned zero — not scored}}                   |
| **Actual fell inside predicted interval?** | **{{yes / no}}** — the calibration test                                        |
| Post-deploy observation window             | {{}}, chosen by {{variance-driven basis}}                                      |
| Partitioned by                             | {{release_id / commit_sha / deploy timestamp — note confounding if timestamp}} |

**Confounders identified:** {{other changes in the same deploy, traffic-mix shift, volume change, provider-side model update, price change, seasonality — or: none found, with what was checked}}

**Error attribution:** {{sampling / volume projection / traffic-mix drift / cache behaviour / confounding / price change}}

**What we got wrong, and what we changed in the method as a result:**
{{Written plainly. This section is published whether or not it is flattering — see [`experiment-protocol.md`](experiment-protocol.md) §15.}}

---

## 12. Method

{{Link to the pre-registered protocol for this engagement. Sample size, MDE, quality tiers, and strata were fixed before replay ran: {{yes / no}}.}}

**Prices:** {{source}}, retrieved {{date}}.
**Protocol:** [`experiment-protocol.md`](experiment-protocol.md) version {{}}.
