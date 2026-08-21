# Recruiting Pipeline

Research date: **August 13, 2026**
Status: **No company has been contacted. No company is qualified.**

> **RANKING SUPERSEDED — August 13, 2026.** The single ranked list in §1 over-weighted regulated healthcare and legal companies, which risks a false negative on telemetry access. Use [`recruiting-cohorts.md`](recruiting-cohorts.md) for cohorts, ranking, and named contacts. The research below stands as the underlying source.

## What this document is, and its verification ceiling

This is a **research-stage prospect list**, built entirely from public sources. Read this section before using it.

**The central limitation:** most of the [ICP](ideal-customer-profile.md) is **not publicly verifiable for any company**. Specifically, none of the following can be established from public sources for any prospect below:

- monthly inference spend;
- engineering headcount touching the AI code path;
- whether telemetry exists, and in what system;
- whether a cost or quality incident occurred in the last 90 days;
- whether prompt/model changes go through pull requests;
- who can authorize a data export.

**[INFERENCE]** Anyone claiming otherwise is guessing. Consequently:

- **No company below is classified "qualified."** That status is reserved for companies that directly confirm the required criteria during screening.
- Every entry's ICP-critical fields read **"unknown — establish during screening."** This is the honest state, not an incomplete draft.
- **Inference spend is never estimated.** Not once, anywhere in this document.
- Classification reflects **plausibility of fit**, based only on what is public.

**The durable asset here is §6 (sourcing channels), not the names.** The names are a starting batch; the channels let you extend and refresh the list indefinitely.

## Evidence tiers

| Tier  | Meaning                                                                                                                                                                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Company name, product, and at least one structural fact (stage, funding, employee band) sourced in this session with a URL.                                                                                                                          |
| **B** | Company name and product sourced in this session with a URL; no structural facts verified.                                                                                                                                                           |
| **C** | **Pre-cutoff knowledge (≤ May 2026).** Existence and product category believed accurate but **not re-verified today**. Everything requires verification before outreach. Included to widen the funnel, flagged so it is never mistaken for research. |

**[INFERENCE]** Tier C entries carry real staleness risk — companies pivot, get acquired, shut down, or outgrow the ICP in months. Verify the website loads and the product still matches before spending an introduction on one.

## Classification scheme

| Class                  | Meaning                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Plausible prospect** | Public evidence of an AI-native product where an LLM is plausibly on the critical path, and no visible disqualifier.           |
| **Weak prospect**      | Fits partially — likely too large, likely too small, LLM likely peripheral, or the AI is probably not LLM-based.               |
| **Disqualified**       | A visible ICP disqualifier. Reason recorded.                                                                                   |
| **Requires screening** | **All of the above.** Every company requires screening; the class only says how worthwhile the screening call is likely to be. |

---

## 1. Ranked top 15 plausible prospects

Ranked by **plausibility of ICP fit**, weighting: LLM demonstrably central to the product (not a bolted-on feature); plausible team size; stage suggesting production traffic but not enterprise procurement; and a plausible access route.

|   # | Company         | Tier | What it does                                                                                                                                                                                        | Why ranked here                                                                                                                                      | Access route              |
| --: | --------------- | :--: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
|   1 | **Avoca**       |  A   | AI workforce (voice + text agents) for home-service businesses — [source](https://topstartups.io/?industries=Artificial+Intelligence)                                                               | 11–50 employees, Seed/YC. LLM is the product. Voice agents = high call volume = a bill someone notices. Strongest structural match found.            | YC network                |
|   2 | **Blossom**     |  A   | AI copilots and agents for psychiatry — $20M Series A — [source](https://topstartups.io/?industries=Artificial+Intelligence)                                                                        | 11–50, Series A. Clinical LLM output → strong quality-regression stakes. **Caveat: PHI may make replay hard even in-CI.**                            | Healthcare AI network     |
|   3 | **Rulebase**    |  B   | AI coworkers reviewing bank/fintech customer interactions for compliance breaches across calls, chats, email — [source](https://www.tldl.io/blog/yc-ai-startups-2026)                               | Reviewing _every_ interaction implies high volume. Compliance domain = deterministic quality signals likely exist (tier‑1 evaluable).                | YC network                |
|   4 | **Amigo**       |  A   | Unified clinical workflow data foundation — $18M Series A — [source](https://topstartups.io/?industries=Artificial+Intelligence)                                                                    | 11–50, Series A, healthcare workflows. Same PHI caveat as Blossom.                                                                                   | Healthcare AI network     |
|   5 | **Yuma AI**     |  B   | AI customer support automation for e-commerce — $5M raised — [source](https://www.retaildive.com/press-release/20241030-yumaai-raises-5-million-to-transform-e-commerce-customer-support-with-adv/) | Ticket classification and drafting = archetypal Segment A workload with deterministic labels. **Funding news is from 2024 — verify current status.** | Cold / e-commerce network |
|   6 | **Paxton**      |  B   | AI legal assistant — $28M raised — [source](https://newmarketpitch.com/blogs/news/legal-ai-funding-analysis)                                                                                        | Legal AI: long contexts, expensive models, hallucination intolerance. Cost and quality both acute.                                                   | Legal-tech network        |
|   7 | **Primer**      |  B   | AI agent that sells, onboards, and supports users via live personalized walkthroughs — [source](https://www.ycombinator.com/companies/industry/Artificial%20Intelligence)                           | Recent YC, LLM-core, real-time interactive = latency and cost both matter.                                                                           | YC network                |
|   8 | **Tasklet**     |  B   | Cloud agent handling business application workflows across integrations — [source](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                    | Multi-step agent loops multiply token cost non-linearly — exactly the workload where cost surprises originate.                                       | YC network                |
|   9 | **IncidentFox** |  B   | AI agent investigating and resolving production incidents — [source](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                  | Engineering-native buyer who will understand the method immediately. Small/new — spend may be below threshold.                                       | YC network                |
|  10 | **Prox**        |  B   | Multimodal technical product expert for complex physical products — [source](https://www.ycombinator.com/companies/industry/Artificial%20Intelligence)                                              | Multimodal = high token cost per call. Likely early.                                                                                                 | YC network                |
|  11 | **Graphite**    |  B   | Code review platform; named Braintrust customer — [source](https://www.braintrust.dev/)                                                                                                             | **Already runs evals in CI.** Pre-qualified on telemetry, and directly tests the Braintrust-absorption question. May exceed 30 engineers.            | Dev-tools network         |
|  12 | **Ploy**        |  B   | Agents managing websites, campaigns, conversion optimization — [source](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                               | Continuous agent operation = steady volume. Marketing domain = weaker deterministic quality signals.                                                 | YC network                |
|  13 | **Complir**     |  B   | Autonomous compliance for product regulations and documentation — [source](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                            | Document-heavy = long contexts = caching economics matter. Regulated data may block replay.                                                          | YC network                |
|  14 | **Freed**       |  C   | AI medical scribe for clinicians                                                                                                                                                                    | **Tier C — verify everything.** Transcription + generation at per-visit volume; strong cost profile. PHI caveat.                                     | Healthcare AI network     |
|  15 | **Eve**         |  C   | AI for plaintiff-side legal work                                                                                                                                                                    | **Tier C — verify everything.** Legal AI cost/quality profile as above.                                                                              | Legal-tech network        |

**[INFERENCE] on the ranking:** ranks 1–5 are the strongest structural matches available from public data. But ranking is built on _plausibility_, and the two variables that actually decide fit — spend and telemetry — are invisible here. Expect the screening call to reorder this list substantially. Treat the ranking as a call-ordering heuristic, not a prediction.

**Systematic risk worth noting:** ranks 2, 4, 13, 14, 15 sit in healthcare, legal, and compliance — domains with the strongest quality-regression pain _and_ the strongest data-access barriers. **[INFERENCE]** These may be simultaneously the best-motivated and the least accessible prospects. If most of the top 15 refuse data access on regulatory grounds, that is a finding about the wedge's reachable market, not just about recruiting — record it against assumption A1.

---

## 2. Full pipeline — 40 companies

ICP-critical fields (spend, headcount, telemetry, incident, PR process, approver) are **unknown for every row** and omitted from this table rather than filled with guesses. §3 records what must be established per company.

|   # | Company           | Tier | Website       | Product                                             | Public evidence of production LLM/genAI                                                                                                                          | Eng team (source)                                                                                       | Stage / funding     | Role to approach   | Class                                                     | Conf. |
| --: | ----------------- | :--: | ------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------- | ------------------ | --------------------------------------------------------- | :---: |
|   1 | Avoca             |  A   | avoca.ai      | AI workforce for service businesses                 | Product is voice/LLM agents — [src](https://topstartups.io/?industries=Artificial+Intelligence)                                                                  | 11–50 co. band ([src](https://topstartups.io/?industries=Artificial+Intelligence)) — eng subset unknown | Seed (YC)           | CTO / founding eng | Plausible                                                 |  Med  |
|   2 | Blossom           |  A   | — verify      | AI copilots/agents for psychiatry                   | Product described as AI copilots & agents — [src](https://topstartups.io/?industries=Artificial+Intelligence)                                                    | 11–50 co. band                                                                                          | Series A $20M       | CTO                | Plausible                                                 |  Med  |
|   3 | Rulebase          |  B   | — verify      | AI coworkers reviewing bank/fintech interactions    | Real-time review of calls/chats/emails — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                     | unknown                                                                                                 | YC                  | CTO / founder      | Plausible                                                 |  Med  |
|   4 | Amigo             |  A   | — verify      | Clinical workflow data foundation                   | Healthcare AI product — [src](https://topstartups.io/?industries=Artificial+Intelligence)                                                                        | 11–50 co. band                                                                                          | Series A $18M       | VP Eng             | Plausible                                                 |  Med  |
|   5 | Yuma AI           |  B   | yuma.ai       | AI support automation for e-commerce                | Support automation product — [src](https://www.retaildive.com/press-release/20241030-yumaai-raises-5-million-to-transform-e-commerce-customer-support-with-adv/) | unknown                                                                                                 | $5M (2024 — verify) | CTO / founder      | Plausible                                                 |  Med  |
|   6 | Paxton            |  B   | — verify      | AI legal assistant                                  | Legal AI assistant — [src](https://newmarketpitch.com/blogs/news/legal-ai-funding-analysis)                                                                      | unknown                                                                                                 | ~$28M               | Head of Eng        | Plausible                                                 |  Med  |
|   7 | Primer            |  B   | — verify      | AI agent for sales/onboarding/support               | Live personalized walkthroughs — [src](https://www.ycombinator.com/companies/industry/Artificial%20Intelligence)                                                 | unknown                                                                                                 | YC                  | Founder            | Plausible                                                 |  Med  |
|   8 | Tasklet           |  B   | — verify      | Cloud agent for business workflows                  | Agent across integrations — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                  | unknown                                                                                                 | YC (Spring 26)      | Founder / CTO      | Plausible                                                 |  Med  |
|   9 | IncidentFox       |  B   | — verify      | AI agent for production incidents                   | Investigates/resolves incidents — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                            | unknown                                                                                                 | YC (Winter 26)      | Founder            | Plausible                                                 |  Med  |
|  10 | Prox              |  B   | — verify      | Multimodal technical product expert                 | Multimodal agent — [src](https://www.ycombinator.com/companies/industry/Artificial%20Intelligence)                                                               | unknown                                                                                                 | YC                  | Founder            | Plausible                                                 |  Low  |
|  11 | Graphite          |  B   | graphite.dev  | Code review platform                                | Named Braintrust customer — [src](https://www.braintrust.dev/)                                                                                                   | unknown — may exceed 30                                                                                 | Series B (verify)   | Head of Eng        | Plausible                                                 |  Med  |
|  12 | Ploy              |  B   | — verify      | Agents for websites/campaigns                       | Agent product — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                              | unknown                                                                                                 | YC (Spring 26)      | Founder            | Plausible                                                 |  Low  |
|  13 | Complir           |  B   | — verify      | Autonomous compliance                               | Compliance automation — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                      | unknown                                                                                                 | YC (Spring 26)      | Founder            | Plausible                                                 |  Low  |
|  14 | Freed             |  C   | — verify      | AI medical scribe                                   | **Tier C — unverified**                                                                                                                                          | unknown                                                                                                 | unknown             | CTO                | Plausible                                                 |  Low  |
|  15 | Eve               |  C   | — verify      | Legal AI, plaintiff-side                            | **Tier C — unverified**                                                                                                                                          | unknown                                                                                                 | unknown             | CTO                | Plausible                                                 |  Low  |
|  16 | Darrow            |  B   | — verify      | AI legal intelligence for plaintiff firms           | ~$60M raised — [src](https://newmarketpitch.com/blogs/news/legal-ai-funding-analysis)                                                                            | unknown — likely >30                                                                                    | ~$60M               | Head of Eng        | Weak (size)                                               |  Low  |
|  17 | Supio             |  B   | — verify      | Personal-injury case analysis                       | $91M raised — [src](https://newmarketpitch.com/blogs/news/legal-ai-funding-analysis)                                                                             | unknown — likely >30                                                                                    | $91M                | Head of Eng        | Weak (size)                                               |  Low  |
|  18 | Manifest          |  B   | — verify      | Legal AI                                            | $60M at $750M val — [src](https://newmarketpitch.com/blogs/news/legal-ai-funding-analysis)                                                                       | unknown — likely >30                                                                                    | $60M                | Head of Eng        | Weak (size)                                               |  Low  |
|  19 | 1mind             |  B   | — verify      | AI sales agent ("Mindy")                            | Autonomous lead qual/outreach — [src](https://oneaway.io/blog/ai-sdr-agents)                                                                                     | unknown                                                                                                 | unknown             | Founder            | Plausible                                                 |  Low  |
|  20 | TrustAI           |  B   | — verify      | Browser automations across work tools               | — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                                            | unknown                                                                                                 | YC (Summer 26)      | Founder            | Plausible                                                 |  Low  |
|  21 | Context.dev       |  B   | context.dev   | Real-time web data API for agents                   | — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                                            | unknown                                                                                                 | YC (Summer 26)      | Founder            | Weak (infra, not app)                                     |  Low  |
|  22 | Salus             |  B   | — verify      | Validates agent actions against policy              | — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                                            | unknown                                                                                                 | YC (Winter 26)      | Founder            | Plausible                                                 |  Low  |
|  23 | Silmaril          |  B   | — verify      | Runtime prompt-injection protection                 | — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                                            | unknown                                                                                                 | YC (Spring 26)      | Founder            | Weak (security infra)                                     |  Low  |
|  24 | Polymath          |  B   | — verify      | Training environments for agent workflows           | — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                                            | unknown                                                                                                 | YC (Winter 26)      | Founder            | Weak (tooling)                                            |  Low  |
|  25 | Superset          |  B   | — verify      | IDE coordinating parallel coding agents             | — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                                            | unknown                                                                                                 | YC (Spring 26)      | Founder            | Plausible                                                 |  Low  |
|  26 | Wordware          |  B   | wordware.ai   | AI agent building platform                          | $30M seed, largest in YC history — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                           | unknown                                                                                                 | $30M seed           | CTO                | Plausible                                                 |  Low  |
|  27 | XBOW              |  A   | xbow.com      | Offensive security AI                               | $75M Series B — [src](https://topstartups.io/?industries=Artificial+Intelligence)                                                                                | 11–50 co. band                                                                                          | Series B $75M       | Head of Eng        | Plausible                                                 |  Low  |
|  28 | Hex               |  C   | hex.tech      | Data workspace with AI features                     | **Tier C — unverified**                                                                                                                                          | unknown — likely >30                                                                                    | Series B+           | Head of Eng        | Weak (AI may be peripheral)                               |  Low  |
|  29 | Julius AI         |  C   | julius.ai     | AI data analyst                                     | **Tier C — unverified**                                                                                                                                          | unknown                                                                                                 | unknown             | Founder            | Plausible                                                 |  Low  |
|  30 | Cleric            |  C   | — verify      | AI SRE agent                                        | **Tier C — unverified**                                                                                                                                          | unknown                                                                                                 | unknown             | Founder            | Plausible                                                 |  Low  |
|  31 | Granola           |  C   | granola.ai    | AI meeting notes                                    | **Tier C — unverified**                                                                                                                                          | unknown                                                                                                 | unknown             | CTO                | Plausible                                                 |  Low  |
|  32 | Mintlify          |  C   | mintlify.com  | Docs platform with AI                               | **Tier C — unverified**                                                                                                                                          | unknown                                                                                                 | unknown             | Head of Eng        | Weak (AI peripheral)                                      |  Low  |
|  33 | Wispr Flow        |  C   | — verify      | Voice-to-text AI                                    | **Tier C — unverified**                                                                                                                                          | unknown                                                                                                 | unknown             | CTO                | Weak (may be ASR not LLM)                                 |  Low  |
|  34 | Nabla             |  C   | nabla.com     | Ambient clinical documentation                      | **Tier C — unverified**                                                                                                                                          | unknown — likely >30                                                                                    | Series B+           | Head of Eng        | Weak (size)                                               |  Low  |
|  35 | Corti             |  C   | corti.ai      | Healthcare AI                                       | **Tier C — unverified**                                                                                                                                          | unknown                                                                                                 | unknown             | Head of Eng        | Weak                                                      |  Low  |
|  36 | The Token Company |  B   | — verify      | Compresses LLM inputs to cut context cost           | — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                                            | unknown                                                                                                 | YC (Winter 26)      | Founder            | **Disqualified — adjacent/competitive**                   |   —   |
|  37 | Conifer           |  B   | — verify      | Routes requests cloud/on-device by cost and privacy | — [src](https://www.tldl.io/blog/yc-ai-startups-2026)                                                                                                            | unknown                                                                                                 | YC (Summer 26)      | Founder            | **Disqualified — adjacent/competitive**                   |   —   |
|  38 | Respan            |  B   | — verify      | Trace and evaluate agent behavior                   | — [src](https://www.ycombinator.com/companies/industry/Artificial%20Intelligence)                                                                                | unknown                                                                                                 | YC                  | Founder            | **Disqualified — direct competitor**                      |   —   |
|  39 | OpenRouter        |  A   | openrouter.ai | LLM routing platform                                | 1–10 employees — [src](https://topstartups.io/?industries=Artificial+Intelligence)                                                                               | 1–10 co. band                                                                                           | Series A $40M       | —                  | **Disqualified — infrastructure; potential data partner** |   —   |
|  40 | Vivodyne          |  A   | vivodyne.com  | Drug discovery via lab robotics + AI                | — [src](https://topstartups.io/?industries=Artificial+Intelligence)                                                                                              | 11–50                                                                                                   | Series A $40M       | —                  | **Disqualified — AI is not LLM-on-critical-path**         |   —   |

### Also reviewed and disqualified

Recorded so they are not re-researched.

| Company                                                         | Reason                                                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Notion, Stripe, Zapier, Vercel, Ramp, Coursera, Dropbox, Replit | Named Braintrust customers ([src](https://www.braintrust.dev/)) — far beyond 30 engineers; enterprise procurement. **Segment B, not A.** |
| Canva, Cresta                                                   | Named Langfuse customers ([src](https://langfuse.com/)) — too large.                                                                     |
| Scribe                                                          | $1.3B valuation, Series C ([src](https://sacra.com/c/scribe/)) — too large.                                                              |
| Traba, Omnea                                                    | 101–200 employee band ([src](https://topstartups.io/?industries=Artificial+Intelligence)) — exceeds ICP.                                 |
| Harmonic                                                        | Research lab pursuing mathematical superintelligence — no production LLM product in the ICP sense.                                       |
| Ataraxis                                                        | Precision-medicine imaging — AI likely not LLM-based.                                                                                    |
| Casetext                                                        | Acquired (pre-cutoff knowledge) — no independent buying authority.                                                                       |

### Class summary

| Class              |             Count |
| ------------------ | ----------------: |
| Plausible prospect |                24 |
| Weak prospect      |                11 |
| Disqualified       |                 5 |
| **Qualified**      | **0 — by design** |

---

## 3. Missing information — establish during screening

**Identical for every company in the pipeline.** No public research can shorten this list; it is what the screening call is for.

|   # | Must establish                                       | Source                              | Maps to                          |
| --: | ---------------------------------------------------- | ----------------------------------- | -------------------------------- |
|   1 | Engineers touching the AI code path (5–30?)          | Screening call                      | ICP required #1                  |
|   2 | LLM on the critical path of the main product?        | Screening call                      | ICP required #2                  |
|   3 | In production ≥ 3 months?                            | Screening call                      | ICP required #3                  |
|   4 | **Monthly inference spend ≥ $2k (target $5k–$100k)** | Screening call — **never estimate** | ICP required #4                  |
|   5 | **Telemetry exists, and in which system**            | Screening call                      | ICP required #5 · A1             |
|   6 | Prompt/model changes go through PRs?                 | Screening call                      | ICP required #6                  |
|   7 | Model/prompt/routing change in last 90 days?         | Interview §2                        | A5 · Kill 1                      |
|   8 | Cost or quality surprise in last 90 days?            | Interview §3                        | A5 · Kill 1                      |
|   9 | Named person who can authorize a telemetry export    | Interview Q18                       | A1                               |
|  10 | Whether in-CI execution changes the data answer      | Interview Q20                       | **A2 — the key design question** |
|  11 | Security stakeholder identity                        | Interview Q21                       | ICP stakeholder map              |
|  12 | Deterministic quality signal at any call site?       | Interview Q15                       | A10                              |
|  13 | Call-site identity resolvable in telemetry?          | Post-access                         | A9                               |
|  14 | Existing spend anchor — what they pay for today      | Interview Q16                       | A7                               |
|  15 | Already using Braintrust with PR evals?              | Interview Q24                       | A11 · Kill 5                     |

---

## 4. Interview tracking table — blank

**No interviews have been conducted. No results exist.** Populate only from completed calls; scoring per [`interview-guide.md`](interview-guide.md). Mirrors §2 of [`validation-scorecard.md`](validation-scorecard.md).

|   # | Company | Date | Route | Role | Trigger (1–5) | D1  | D2  | D3  | D4  | D5  | D6  | D7  | Total /20 | Showed PR? | FP pattern | Telemetry ask sent | Outcome |
| --: | ------- | ---- | ----- | ---- | :-----------: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-------: | :--------: | ---------- | :----------------: | ------- |
|   1 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|   2 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|   3 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|   4 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|   5 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|   6 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|   7 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|   8 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|   9 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|  10 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|  11 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|  12 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|  13 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|  14 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |
|  15 |         |      |       |      |               |     |     |     |     |     |     |     |           |            |            |                    |         |

**Scoring dimensions:** D1 recency · D2 concreteness · D3 incident cost · D4 detection latency · D5 data-access realism · D6 spend anchor · D7 concept reaction.

---

## 5. Access routes

**[INFERENCE]** Routes below are inferred from public affiliation only. No individual's contact details have been collected, and none should be until an interview is booked. Collect the minimum needed to make an introduction.

| Route                      | Applies to                              | Path                                                                                                                                                                                  |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **YC network**             | 1, 3, 7, 8, 9, 10, 12, 13, 19–26, 36–38 | Any YC founder in your network → the YC internal directory and Bookface. **Highest-yield route in this pipeline** — over half the plausible prospects are YC companies.               |
| **Healthcare AI network**  | 2, 4, 14, 34, 35                        | Health-tech investors or clinical-informatics contacts. Expect a longer data conversation.                                                                                            |
| **Legal-tech network**     | 6, 15, 16, 17, 18                       | Legal-tech investors, legal-ops communities.                                                                                                                                          |
| **Dev-tools network**      | 11, 25, 32                              | Developer-tools founders; overlaps YC heavily.                                                                                                                                        |
| **Investor introductions** | Any funded company                      | Warmest route where a shared investor exists. Costs investor goodwill — spend on top-5 only.                                                                                          |
| **Community**              | Broad                                   | LLM-observability and AI-engineering communities. **Read the rules; an unsolicited pitch in a community is worse than no outreach** ([`outreach-messages.md`](outreach-messages.md)). |
| **Cold**                   | 5, and any unreachable warm             | Last resort. Screen hard first.                                                                                                                                                       |

---

## 6. Sourcing channels — the durable asset

Use these to extend and refresh the pipeline. **[INFERENCE]** These are more valuable than the 40 names, because they regenerate.

| Channel                           | URL                                                                                                                                    | Why it yields ICP matches                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| YC company directory, AI filter   | [ycombinator.com/companies/industry/Artificial Intelligence](https://www.ycombinator.com/companies/industry/Artificial%20Intelligence) | Stage-filtered, small teams, LLM-native. Best single channel.                                            |
| YC — Customer Support             | [ycombinator.com/companies/industry/Customer Support](https://www.ycombinator.com/companies/industry/Customer%20Support)               | Ticket classification/drafting: archetypal Segment A workload with deterministic labels.                 |
| YC — Generative AI                | [ycombinator.com/companies/industry/generative-ai](https://www.ycombinator.com/companies/industry/generative-ai)                       | LLM definitionally on the critical path.                                                                 |
| TopStartups AI filter             | [topstartups.io](https://topstartups.io/?industries=Artificial+Intelligence)                                                           | **Publishes employee bands and funding stage** — the only channel found giving a headcount signal.       |
| YC AI tracker (W26/Spring/Summer) | [tldl.io/blog/yc-ai-startups-2026](https://www.tldl.io/blog/yc-ai-startups-2026)                                                       | Recent batches with one-line product descriptions.                                                       |
| Langfuse customers/showcase       | [langfuse.com](https://langfuse.com/)                                                                                                  | **Pre-qualified on telemetry** — the hardest ICP criterion. Skews large, but worth mining.               |
| Braintrust customers              | [braintrust.dev](https://www.braintrust.dev/)                                                                                          | Pre-qualified on telemetry _and_ directly tests the absorption question. Skews enterprise.               |
| Helicone blog/community           | [helicone.ai/blog](https://www.helicone.ai/blog)                                                                                       | Open-source community skews smaller than Braintrust's.                                                   |
| Legal AI funding trackers         | [newmarketpitch.com](https://newmarketpitch.com/blogs/news/legal-ai-funding-analysis)                                                  | Seed/Series A legal AI raised $240.6M YTD 2026 — a dense, well-funded, LLM-core vertical.                |
| AI agent funding tracker          | [aifundingtracker.com](https://aifundingtracker.com/top-ai-agent-startups/)                                                            | Agentic AI raised $2.66B across 44 rounds through April 2026 — multi-step loops = non-linear token cost. |

### Highest-yield search patterns

**[INFERENCE]** The best public proxy for "has telemetry and has felt the pain" is a company that has _written publicly about its LLM stack_. Those teams have instrumentation and have thought about cost.

- Engineering blog posts naming Langfuse, Helicone, Braintrust, LiteLLM, Portkey, or OpenTelemetry GenAI.
- Conference talks on LLM cost or eval practice.
- Job postings mentioning "LLM observability," "evals," or "inference cost" — reveals stack **and** team size.
- OSS repos where a company's LLM instrumentation is publicly visible.

---

## 7. Discipline rules

1. **No company is "qualified" until it directly confirms the ICP criteria.** Public plausibility is not qualification.
2. **Never estimate inference spend.** Not in this document, not in outreach, not in internal notes.
3. **Verify Tier C entries before spending an introduction.** Check the site loads and the product still matches.
4. **Record every rejection reason** in [`validation-scorecard.md`](validation-scorecard.md) §1. A dominant rejection reason means the ICP is mis-specified — that is a finding.
5. **Collect the minimum personal information** needed to request an introduction. No contact scraping, no enrichment tooling.
6. **Do not present anything here as a customer fact.** These are public-source plausibility judgments and nothing more.
