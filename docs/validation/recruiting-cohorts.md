# Recruiting Cohorts — Corrected Design

Date: **August 13, 2026**
Status: **No company or individual has been contacted.** Supersedes the single ranked list in [`recruiting-pipeline.md`](recruiting-pipeline.md) §1, which remains as the underlying research.

## Why the earlier design was wrong

The previous top five contained **three regulated-data companies** (Blossom and Amigo in healthcare, plus Rulebase — which the earlier pipeline misclassified, see §5). Rank 6 was legal, rank 13 compliance, ranks 14–15 healthcare and legal.

**[INFERENCE] The failure mode this creates:** healthcare, legal, and compliance companies are the most likely to refuse production-data access on regulatory grounds. If the sprint's first cohort is dominated by them and telemetry access fails, **assumption A1 records a false negative** — the sprint would conclude "teams will not grant access" when the true finding is "regulated teams will not grant access, and we only asked regulated teams." Kill criterion 2 would fire on a sampling artifact, killing the wedge for the wrong reason.

The inverse error is equally possible: regulated teams have the sharpest quality-regression pain, so excluding them would understate urgency.

**The correction is to separate them and measure them separately**, so the access rate and the pain rate can be read per cohort rather than as one confounded number.

---

## 1. The three cohorts

| Cohort              | Definition                                                                                                                                      | Target interviews | What it primarily tests                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | :---------------: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **P — Primary**     | Unregulated AI SaaS, customer support, workflow, and operations products. No PHI, no privileged legal data, no financial-regulatory constraint. |    **8 of 15**    | **A1/A2 cleanly.** If access fails here, it fails for real.                                                                               |
| **S — Secondary**   | Regulated healthcare, legal, and compliance products.                                                                                           |    **4 of 15**    | **A5 (pain intensity) and A10 (deterministic signals).** Access failure here is expected and is not evidence against the wedge generally. |
| **X — Adversarial** | Braintrust customers and developer-tool companies.                                                                                              |    **3 of 15**    | **A11 (absorption).** The only cohort that can answer "does an existing tool already cover this?"                                         |

**Reading rule, agreed in advance:** kill criterion 2 (telemetry access) is evaluated **on cohort P only**. Cohorts S and X inform it but cannot trigger it. Recording this before the data arrives prevents a post-hoc reinterpretation of a bad result.

---

## 2. Ranking dimensions

Each prospect scored 1–5 on five independent dimensions. **They are not summed** — a single number would hide exactly the trade-off that matters, which is that the highest-pain prospects are often the least accessible.

| Dimension                               | 1                                         | 5                                                                 |
| --------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| **PF — Problem fit**                    | LLM peripheral; changes rare              | LLM is the product; model/prompt changes are routine              |
| **RE — Reachability**                   | No public route, no network overlap       | Public founder identity plus a plausible warm path                |
| **IV — Probable inference volume**      | Likely below the $2k/month floor          | High-volume workload (voice, per-interaction review, agent loops) |
| **TA — Likelihood of telemetry access** | Regulated data, categorical policy likely | Unregulated, engineering-led, plausibly self-hosted telemetry     |
| **DQ — Deterministic quality signal**   | Open-ended generation only                | Classification, extraction, schema-validated, or tool-call output |

**[ASSUMPTION]** Every score below is a judgment from public product descriptions. None is verified with the company. Scores are a call-ordering heuristic, not a prediction.

---

## 3. Cohort P — Primary (unregulated)

**Recruit these first.** Target 8 completed interviews.

|   # | Company         | Tier | PF  | RE  | IV  | TA  | DQ  | Why                                                                                                                                       |
| --: | --------------- | :--: | :-: | :-: | :-: | :-: | :-: | ----------------------------------------------------------------------------------------------------------------------------------------- |
|  P1 | **Avoca**       |  A   |  5  |  5  |  5  |  4  |  3  | Voice + text agents; multi-turn voice = highest token volume per interaction in the pipeline. Founders public and reachable.              |
|  P2 | **Yuma AI**     |  A   |  5  |  5  |  4  |  4  |  5  | E-commerce support automation. Ticket classification gives a genuine deterministic signal. Serial founder.                                |
|  P3 | **Tasklet**     |  B   |  5  |  3  |  4  |  4  |  3  | Multi-step agent loops across integrations — non-linear token cost, the classic surprise.                                                 |
|  P4 | **Primer**      |  B   |  5  |  3  |  4  |  4  |  2  | Live interactive walkthroughs; latency and cost both bind.                                                                                |
|  P5 | **IncidentFox** |  B   |  5  |  3  |  3  |  5  |  3  | Engineering buyer who will grasp the method immediately; likely the easiest data conversation in the pipeline. May be too early on spend. |
|  P6 | **Ploy**        |  B   |  4  |  3  |  4  |  4  |  2  | Continuous agent operation on marketing workflows; weak quality signal.                                                                   |
|  P7 | **Prox**        |  B   |  4  |  3  |  4  |  4  |  2  | Multimodal = high cost per call; likely early stage.                                                                                      |
|  P8 | **1mind**       |  B   |  4  |  2  |  4  |  4  |  3  | AI sales agent; lead-qualification outcomes are partially checkable.                                                                      |
|  P9 | **TrustAI**     |  B   |  4  |  3  |  3  |  4  |  3  | Browser automations across work tools.                                                                                                    |
| P10 | **Wordware**    |  B   |  4  |  3  |  4  |  3  |  2  | Agent-building platform; **caveat — a platform's own spend may be dwarfed by customers', complicating attribution.**                      |
| P11 | **Superset**    |  B   |  4  |  3  |  4  |  4  |  3  | IDE coordinating parallel coding agents; heavy token use by construction.                                                                 |
| P12 | **Julius AI**   |  C   |  4  |  2  |  4  |  4  |  4  | **Tier C — verify.** Data-analysis output is partially checkable (code runs or does not).                                                 |
| P13 | **Cleric**      |  C   |  4  |  2  |  3  |  5  |  3  | **Tier C — verify.** AI SRE; engineering-native.                                                                                          |
| P14 | **Granola**     |  C   |  4  |  2  |  4  |  3  |  2  | **Tier C — verify.** Meeting notes; consumer-ish data may complicate access.                                                              |
| P15 | **Salus**       |  B   |  3  |  3  |  3  |  4  |  4  | Policy validation of agent actions — pass/fail is inherently deterministic.                                                               |

## 4. Cohort S — Secondary (regulated)

**Recruit second.** Target 4 interviews. Expect access refusals; **record them separately** and never fold them into the cohort P access rate.

|   # | Company      | Tier | PF  | RE  | IV  | TA  | DQ  | Why                                                                                                                                                                                      |
| --: | ------------ | :--: | :-: | :-: | :-: | :-: | :-: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  S1 | **Rulebase** |  A   |  5  |  4  |  5  |  2  |  4  | **Reclassified from primary — see §5.** Reviews every customer interaction for compliance = very high volume, and compliance verdicts are checkable. Fintech data policy is the barrier. |
|  S2 | **Blossom**  |  A   |  5  |  3  |  3  |  1  |  2  | Psychiatry copilots. Highest quality stakes in the pipeline; PHI likely blocks replay even in-CI.                                                                                        |
|  S3 | **Paxton**   |  B   |  5  |  3  |  4  |  2  |  3  | Legal assistant; long contexts, expensive models.                                                                                                                                        |
|  S4 | **Amigo**    |  A   |  4  |  3  |  4  |  1  |  3  | Clinical workflows across multiple call sites. PHI barrier.                                                                                                                              |
|  S5 | **Complir**  |  B   |  4  |  3  |  3  |  2  |  4  | Regulatory compliance documentation; checkable outputs.                                                                                                                                  |
|  S6 | **Eve**      |  C   |  4  |  2  |  4  |  2  |  2  | **Tier C — verify.** Plaintiff-side legal.                                                                                                                                               |
|  S7 | **Freed**    |  C   |  4  |  2  |  4  |  1  |  2  | **Tier C — verify.** Medical scribe; PHI.                                                                                                                                                |

**[INFERENCE]** S1 and S5 are the most valuable in this cohort, because compliance work produces deterministic quality signals (A10) that most primary-cohort prospects lack. If regulated teams will grant in-CI access, they may be the _best_ design partners, not the worst — that is precisely what separating the cohorts lets us find out.

## 5. Correction: Rulebase was misclassified

The earlier pipeline placed Rulebase at rank 3 of the primary list. Its YC page describes it as **"AI customer operations for regulated industries,"** with its Beam product aimed at reducing "compliance violations" in sectors "like fintech" ([source](https://www.ycombinator.com/companies/rulebase)).

That is a regulated-data company. It belongs in cohort S. Its earlier placement is part of the over-weighting this document corrects. Batch also corrected: **Fall 2024**, not a 2026 batch.

## 6. Cohort X — Adversarial

**Recruit throughout.** Target 3 interviews. These exist to attack the hypothesis, not to confirm it.

|   # | Company                                    | Tier | PF  | RE  | IV  | TA  | DQ  | Why                                                                                                                                |
| --: | ------------------------------------------ | :--: | :-: | :-: | :-: | :-: | :-: | ---------------------------------------------------------------------------------------------------------------------------------- |
|  X1 | **Graphite**                               |  B   |  4  |  3  |  4  |  4  |  4  | **Named Braintrust customer.** Dev-tools, code review. The single most informative interview available: they already run PR evals. |
|  X2 | Any Braintrust customer under 30 engineers |  —   |  —  |  —  |  —  |  —  |  —  | Source from [braintrust.dev](https://www.braintrust.dev/). Most named customers are far too large; find the small ones.            |
|  X3 | **Mintlify**                               |  C   |  3  |  2  |  3  |  4  |  3  | **Tier C — verify.** Dev-tools with AI; AI may be peripheral.                                                                      |
|  X4 | **Respan**                                 |  B   |  3  |  3  |  2  |  3  |  3  | Agent tracing/eval company — **a competitor**. Interview to learn the landscape, never pitch. Disclose who you are.                |
|  X5 | **Conifer**                                |  B   |  3  |  3  |  3  |  3  |  3  | Routes requests by cost and privacy — **adjacent competitor**. Same rule.                                                          |

**Rule for X4/X5:** these are competitors. Be explicit about what you are doing, ask only about their view of the market, and make no offer. Recording a competitor conversation as a prospect interview would corrupt the sample.

### The question cohort X exists to answer

For X1 and X2 specifically, drive to: _"You already run evals on PRs. When you change a model, do you know what it does to your monthly bill before merging — and has anything ever told you afterward whether the estimate was right?"_

**[INFERENCE]** A "yes, Braintrust shows us that" from a real customer is worth more than any amount of documentation reading, and would trigger kill criterion 5 immediately.

---

## 7. Named contacts — top 20

**Discipline:** only individuals whose name and role are published on a public company page are named. **No email addresses are constructed or guessed. No warm introduction is claimed that does not exist.** Where a person is not verified, the _route to find them_ is given instead of a name.

**No individual below has been contacted.**

|   # | Company     | Person (public source)                                                                                        | Role                                                          | Public contact route                                                                                                                 | Warm path                                            |
| --: | ----------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
|  P1 | Avoca       | **Apurva Shrivastava** · **Tyson Chen** — [YC page](https://www.ycombinator.com/companies/avoca)              | Founders (W23)                                                | Public LinkedIn and X profiles linked from the YC page                                                                               | **None held.** Requires a YC-network introducer      |
|  P2 | Yuma AI     | **Guillaume Luccisano** — [YC page](https://www.ycombinator.com/companies/yuma-ai)                            | Founder (W23); previously co-founded Triplebyte and Socialcam | Public LinkedIn and X linked from YC page; company site [yuma.ai](https://yuma.ai)                                                   | **None held.** Serial YC founder — plausible YC path |
|  S1 | Rulebase    | **Gideon Ebose** (CEO) · **Chidi Williams** (CTO) — [YC page](https://www.ycombinator.com/companies/rulebase) | Co-founders (F24)                                             | Company [rulebase.co](https://rulebase.co); LinkedIn and X linked from YC page                                                       | **None held**                                        |
|  P3 | Tasklet     | **Unknown**                                                                                                   | Founder/CTO                                                   | YC directory page — slug unverified; search [YC companies](https://www.ycombinator.com/companies/industry/Artificial%20Intelligence) | **None held**                                        |
|  P4 | Primer      | **Unknown**                                                                                                   | Founder                                                       | YC directory; name collides with an older company — **verify identity carefully**                                                    | **None held**                                        |
|  P5 | IncidentFox | **Unknown**                                                                                                   | Founder                                                       | YC directory (Winter 26)                                                                                                             | **None held**                                        |
|  P6 | Ploy        | **Unknown**                                                                                                   | Founder                                                       | YC directory (Spring 26)                                                                                                             | **None held**                                        |
|  P7 | Prox        | **Unknown**                                                                                                   | Founder                                                       | YC directory                                                                                                                         | **None held**                                        |
|  P8 | 1mind       | **Unknown**                                                                                                   | Founder                                                       | Company site /about                                                                                                                  | **None held**                                        |
|  P9 | TrustAI     | **Unknown**                                                                                                   | Founder                                                       | YC directory (Summer 26)                                                                                                             | **None held**                                        |
| P10 | Wordware    | **Unknown**                                                                                                   | CTO                                                           | Company site [wordware.ai](https://wordware.ai) /about                                                                               | **None held**                                        |
| P11 | Superset    | **Unknown**                                                                                                   | Founder                                                       | YC directory (Spring 26)                                                                                                             | **None held**                                        |
| P12 | Julius AI   | **Unknown**                                                                                                   | Founder                                                       | Company site — **Tier C, verify company first**                                                                                      | **None held**                                        |
| P13 | Cleric      | **Unknown**                                                                                                   | Founder                                                       | Company site — **Tier C, verify company first**                                                                                      | **None held**                                        |
| P14 | Granola     | **Unknown**                                                                                                   | CTO                                                           | Company site — **Tier C, verify company first**                                                                                      | **None held**                                        |
| P15 | Salus       | **Unknown**                                                                                                   | Founder                                                       | YC directory (Winter 26)                                                                                                             | **None held**                                        |
|  S2 | Blossom     | **Unknown**                                                                                                   | CTO                                                           | Company site /team                                                                                                                   | **None held**                                        |
|  S3 | Paxton      | **Unknown**                                                                                                   | Head of Eng                                                   | Company site /team                                                                                                                   | **None held**                                        |
|  S4 | Amigo       | **Unknown**                                                                                                   | VP Eng                                                        | Company site /team                                                                                                                   | **None held**                                        |
|  S5 | Complir     | **Unknown**                                                                                                   | Founder                                                       | YC directory (Spring 26)                                                                                                             | **None held**                                        |
|  X1 | Graphite    | **Unknown**                                                                                                   | Head of Eng                                                   | Company site [graphite.dev](https://graphite.dev) /about; engineering blog author bylines                                            | **None held**                                        |

**Verified: 5 individuals across 3 companies. Unknown: 17 of 20.** That is the honest state after public research.

### The systematic route for the unknowns

**[INFERENCE]** For YC companies — roughly half this pipeline — the YC company page publishes founder names, roles, batch, and links to their public LinkedIn and X profiles. That is a reliable, public, non-invasive source, demonstrated by the three verified above. Working the YC directory is the fastest way to close most of the 17 gaps.

For non-YC companies: the company's own `/about` or `/team` page, or engineering-blog author bylines. Both are public and self-published.

**Not to be used:** email-guessing patterns, contact-enrichment tools, scraped databases, or any personal data the person did not publish themselves.

---

## 8. Funnel arithmetic — is the pipeline big enough?

**No. 40 names is not a funnel for 15 interviews.** The earlier pipeline was a research artifact, not a recruiting plan.

**[ASSUMPTION]** Conversion rates below are planning estimates from general practice, not measured. Replace them with actuals after week 1 — the first real correction this plan will need.

| Channel             |    Targets needed     | Assumed reply rate | Assumed book rate | Expected interviews |
| ------------------- | :-------------------: | :----------------: | :---------------: | :-----------------: |
| Warm introduction   | 14 introduction paths |        ~70%        |       ~70%        |       **~7**        |
| Cold, well-screened |      90 contacts      |        ~15%        |       ~55%        |       **~7**        |
| Community / inbound |     opportunistic     |         —          |         —         |       **~1**        |
| **Total**           |                       |                    |                   |       **~15**       |

### What this implies

1. **~14 introduction paths must exist.** We hold **zero** today. Securing introducers is the true Day 1 bottleneck — not writing messages.
2. **~90 screened cold targets are needed.** We have ~24 plausible named prospects. **The pipeline must roughly quadruple** before cold outreach can carry its share.
3. **Extend via the sourcing channels** in [`recruiting-pipeline.md`](recruiting-pipeline.md) §6. Highest yield: the YC AI, Customer Support, and Generative AI directories, which supply company, batch, founder names, and public links in one place.

### Weekly targets

|                              | Cohort P | Cohort S | Cohort X |  Total  |
| ---------------------------- | :------: | :------: | :------: | :-----: |
| Screened targets in pipeline |    60    |    25    |    15    | **100** |
| Contacted, week 1            |    45    |    20    |    12    |   77    |
| Interviews booked            |    8     |    4     |    3     | **15**  |

**If cohort P cannot reach 8 interviews, do not backfill from cohort S to hit 15.** A cohort-P shortfall is itself a finding about reachability, and disguising it with regulated companies would recreate the exact confound this document corrects.

---

## 9. Recording requirements

Per interview, in addition to the fields in [`recruiting-pipeline.md`](recruiting-pipeline.md) §4:

- **cohort (P / S / X)** — mandatory, recorded before the call;
- the five dimension scores as estimated pre-call, so the estimate can be compared against reality;
- for cohort S, whether refusal was regulatory or something else;
- for cohort X, whether they named an existing tool that already does this.

Report telemetry-access rate **per cohort**, never pooled. A pooled number is the confound.
