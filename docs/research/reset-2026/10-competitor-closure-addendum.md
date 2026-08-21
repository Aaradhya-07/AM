# Competitor Closure Addendum — Cybewave Studio and FinOps LLM

Date: **August 13, 2026**
Scope: **narrow correction only.** Two competitors missed by earlier passes, verified from their own current pages. Supersedes the Track B and Track C rows in [`05-exhaustive-competitor-matrix.md`](05-exhaustive-competitor-matrix.md) and the classifications in [`09-corrected-final-verdict.md`](09-corrected-final-verdict.md).

**No new research phase. No new opportunity search. No composite proposed.**

## The claim being corrected first

Document 09 concluded that _"the only thing still standing between ANVILMARK and a decision is the complete absence of demand evidence."_

**That was wrong.** Two products were selling the exact jobs of Tracks B and C, and neither had been checked. Absence of buyer evidence was never the only remaining concern — a competitive concern was also outstanding and had simply not been looked for.

**And the framing was itself an error:** the absence of customer interviews is **missing validation**. It is not evidence of demand, and it is not evidence of no demand. Document 09 treated it as though it settled something. It settles nothing.

---

# 1. Cybewave Studio — verified

Source: [cybewave.io](https://www.cybewave.io/) and [cybewave.io/pricing](https://www.cybewave.io/pricing), retrieved August 13, 2026.

## Claim-by-claim verification

| Claim                                          |        Status        | Evidence                                                                                                             |
| ---------------------------------------------- | :------------------: | -------------------------------------------------------------------------------------------------------------------- |
| Idea-first, no repository required             | **VERIFIED SHIPPED** | Headline: _"Turn Your Startup Idea into a Technical Plan."_ _"Describe your startup idea in plain English."_         |
| Guided AI discovery                            | **VERIFIED CLAIMED** | _"3–5 phase guided brainstorm across 15 categories"_; _"the AI asks the right questions so you never miss a detail"_ |
| Non-technical and technical founders           | **VERIFIED CLAIMED** | Targeted at _"founders, indie hackers, and builders"_                                                                |
| Requirements / business-rule collection        | **VERIFIED CLAIMED** | Implied by the 15-category guided brainstorm; not separately documented                                              |
| Architecture, sequence, ER, component diagrams | **VERIFIED SHIPPED** | All four named explicitly; _"generates 4 architecture diagrams from one conversation"_                               |
| Conversational refinement                      | **VERIFIED SHIPPED** | _"edit, refine, and export with a built-in AI assistant"_                                                            |
| Shareable technical plan                       | **VERIFIED SHIPPED** | _"a shareable pitch deck"_; Pro adds _"Advanced exports (PPTX, PDF)"_                                                |
| Scaffolded codebase export                     | **VERIFIED SHIPPED** | _"Download a scaffolded project with Docker Compose, frontend, backend, database schemas, and API gateway"_          |
| Free and low-cost paid plans                   | **VERIFIED SHIPPED** | See pricing below                                                                                                    |

## Marketing language versus shipped capability

**Shipped and concrete:** the four diagram types, the scaffold contents (Docker Compose, frontend, backend, DB schemas, API gateway), the export formats, and the credit metering. These are specific enough to be falsifiable.

**Marketing language, not verified as behaviour:** _"never miss a detail"_, _"the AI asks the right questions"_. The 15-category structure is asserted but its content is not published.

## Pricing — VERIFIED

| Tier         | Price              | Included                                                                  |
| ------------ | ------------------ | ------------------------------------------------------------------------- |
| Free         | **$0/month**       | 50 AI credits/month · save up to 5 diagrams · unlimited diagram rendering |
| Starter      | **$9.89/month**    | 500 credits · up to 50 diagrams · priority rendering                      |
| Pro          | **$19.89/month**   | 2,000 credits · up to 100 diagrams · custom branding · PPTX/PDF export    |
| Team         | **$39/seat/month** | 5,000 credits · shared workspaces · real-time co-editing                  |
| Project Pass | **$29 one-time**   | 1,000 credits, independent of subscription                                |

**INFERENCE:** credit metering with four tiers and a one-off pass is a productized commercial model, not a placeholder. Someone has thought about monetisation.

## Accessibility, identity, adoption

|                                                 |                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product accessible?                             | **YES** — multiple `/login?mode=signup` entry points                                                                                                                                                                                                                  |
| Company identity                                | "Cybewave Studio". Terms, Privacy Policy, Support contact present                                                                                                                                                                                                     |
| Founder named                                   | **NO** on the site. A [DEV Community post](https://dev.to/le_cybewave/built-a-small-tool-to-turn-startup-ideas-into-system-designs-cybewaveio-1bb0) is authored by someone self-describing as having _"9 years… as a software engineer"_, calling it _"a small tool"_ |
| Documentation / changelog                       | **NOT FOUND**                                                                                                                                                                                                                                                         |
| Customers / case studies / testimonials / logos | **NONE**                                                                                                                                                                                                                                                              |
| Public repositories                             | **NOT FOUND**                                                                                                                                                                                                                                                         |
| Independent evidence of use                     | **NONE FOUND** beyond the author's own DEV post                                                                                                                                                                                                                       |
| **Adoption**                                    | **UNKNOWN**                                                                                                                                                                                                                                                           |

**Stated explicitly, per instruction:** a polished landing page with real pricing does **not** prove traction. Adoption is UNKNOWN and is recorded as UNKNOWN. Equally, Cybewave is **not** dismissed because its traction is unknown — the shipped capability is what matters for the competitive question, and it is verified.

## Complete matrix row — Track C

| Field                                     | Value                                                                                                                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exact job solved**                      | Plain-English startup idea → guided multi-phase AI discovery → four diagram types (architecture, sequence, ER, component) → conversational refinement → shareable pitch deck → downloadable scaffolded codebase |
| **Primary source**                        | [cybewave.io](https://www.cybewave.io/), [/pricing](https://www.cybewave.io/pricing)                                                                                                                            |
| **Evidence date**                         | 2026-08-13                                                                                                                                                                                                      |
| **Target buyer**                          | Founders, indie hackers, builders — including non-technical                                                                                                                                                     |
| **Workflow entry point**                  | Web app, sign-up; **idea only, no repository**                                                                                                                                                                  |
| **Required access**                       | None. No repo, no cloud credentials, no telemetry                                                                                                                                                               |
| **Actual output**                         | 4 diagrams, pitch deck, PPTX/PDF export, scaffolded project (Docker Compose, frontend, backend, DB schemas, API gateway)                                                                                        |
| **Pricing / model**                       | Free · $9.89 · $19.89 · $39/seat · $29 project pass. AI-credit metering                                                                                                                                         |
| **Open source / licence**                 | Closed. No public repository found                                                                                                                                                                              |
| **Confirmed overlap**                     | **C1** idea-first · **C2** constraint elicitation (claimed) · **C6** architecture output · **C7** visual diagrams · **C8** conversational revision · **C11** continue into implementation via scaffold          |
| **Confirmed absence**                     | **C3** cross-provider comparison — no evidence · **C4** managed vs open-source model selection — no evidence · **C5** owned-compute awareness — no evidence                                                     |
| **Unknowns**                              | Adoption · diagram quality · whether the scaffold is usable · retention · whether C2 elicitation is substantive                                                                                                 |
| **Practical combination closing the gap** | Cybewave + a free VRAM calculator (ModelFit/apxml/llmfit) + a cloud pricing calculator covers C3–C5 with modest friction                                                                                        |
| **Absorption risk**                       | **HIGH.** C3/C4/C5 are additions to an existing conversational flow, not new products                                                                                                                           |

---

# 2. FinOps LLM — verified

Source: [finopsllm.com](https://finopsllm.com/) and [/pricing](https://finopsllm.com/pricing), retrieved August 13, 2026.

## Claim-by-claim verification

| Claim                                           |        Status        | Evidence                                                                                                                                                                                             |
| ----------------------------------------------- | :------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice-first audits                            | **VERIFIED CLAIMED** | _"Invoice-first audits"_; savings _"reconciled to invoice"_                                                                                                                                          |
| Token-level multi-provider ingestion            | **VERIFIED CLAIMED** | _"token-level cost data ingested from every provider"_ — OpenAI, Anthropic, Gemini & Vertex AI, Bedrock, Azure OpenAI, Groq, Together, Mistral, Cohere, Fireworks, Replicate, _"most OSS endpoints"_ |
| Hourly reconciliation                           | **VERIFIED CLAIMED** | _"Reconciled hourly"_                                                                                                                                                                                |
| Monthly reconciliation vs raw provider invoices | **VERIFIED CLAIMED** | _"monthly reconciliation against raw provider invoices"_                                                                                                                                             |
| Gateway logs and usage telemetry                | **VERIFIED CLAIMED** | Stated as ingested sources                                                                                                                                                                           |
| Attribution and chargeback                      | **VERIFIED CLAIMED** | Offered as fixed-fee scoped work: _"building out attribution and chargeback"_                                                                                                                        |
| Optimization and A/B testing                    | **VERIFIED CLAIMED** | Optimization is the core motion; savings measured against a locked baseline                                                                                                                          |
| Performance pricing on verified savings         | **VERIFIED SHIPPED** | _"15-25% of verified monthly savings, measured against a baseline locked before anything changes. No savings, no fee."_                                                                              |
| $20k/month spend floor                          | **VERIFIED SHIPPED** | _"Minimum engagement is $20k/month of LLM spend."_                                                                                                                                                   |

## Marketing language versus shipped capability

**Shipped and concrete:** the commercial terms. A locked baseline, 15–25% of verified savings, a $20k/month floor, thirty days' notice, a free ~one-week audit with a written deliverable, re-measurement after provider price changes, and handover of configurations. These are contract terms, not slogans.

**Claimed but not independently verifiable:** the reconciliation mechanics. _"Reconciled hourly"_ and _"monthly reconciliation against raw provider invoices"_ are asserted; no documentation, schema, or API reference was found describing how residuals are computed or explained.

## Critical distinction — service, not primarily software

|                          |                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Self-serve app or login? | **NONE FOUND**                                                                                     |
| Call to action           | _"Book the audit"_ or email `hello@finopsllm.com` **with spending details**                        |
| Fee basis                | Percentage of verified savings — a **contingency-fee engagement**                                  |
| Implementation           | _"Nearer 15%"_ if the client implements; _"nearer 25%"_ if FinOps LLM implements and takes on-call |
| Dashboard                | **A separate product with separate pricing** — explicitly not included                             |

**INFERENCE:** the primary motion is a **managed optimisation service** with a dashboard sold separately, not a self-serve software product. This matters, and it cuts both ways. It confirms the reconciliation job is real enough that someone will do it under a no-savings-no-fee guarantee. It also means the job as sold is delivered substantially by people, which is consistent with the practitioner finding that reconciliation crosses FinOps, engineering, procurement, AP, and controllership.

## Identity, adoption

|                                          |                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Product accessible?                      | **NO self-serve access.** Gated behind a booked audit                  |
| Company identity                         | Domain and email only. No registered entity, address, or founder named |
| Founders                                 | **NOT FOUND**                                                          |
| Legal pages                              | **NOT FOUND** on the pages retrieved                                   |
| Documentation / changelog / repositories | **NOT FOUND**                                                          |
| Customers / case studies / logos         | **NONE**                                                               |
| Independent evidence of use              | **NONE FOUND**                                                         |
| **Adoption**                             | **UNKNOWN**                                                            |

Again per instruction: a detailed pricing page does not prove customers, and the absence of proof does not justify dismissal. Adoption is UNKNOWN.

## Complete matrix row — Track B

| Field                                     | Value                                                                                                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Exact job solved**                      | Ingest token-level cost across 12+ providers plus gateway logs and telemetry; reconcile hourly and monthly against raw provider invoices; attribute and charge back; identify and implement savings measured against a locked baseline |
| **Primary source**                        | [finopsllm.com](https://finopsllm.com/), [/pricing](https://finopsllm.com/pricing)                                                                                                                                                     |
| **Evidence date**                         | 2026-08-13                                                                                                                                                                                                                             |
| **Target buyer**                          | Teams spending **≥ $20k/month** on LLMs — engineering-cost owner or FinOps lead                                                                                                                                                        |
| **Workflow entry point**                  | Booked audit (~1 week, free, written deliverable). **No self-serve**                                                                                                                                                                   |
| **Required access**                       | Provider invoices, gateway logs, usage telemetry, spend disclosure at first contact                                                                                                                                                    |
| **Actual output**                         | Written audit, monthly Statement of Savings, implemented configuration changes, handover of measurement setup                                                                                                                          |
| **Pricing / model**                       | **15–25% of verified monthly savings**, no savings no fee, $20k/month floor, 30 days' notice. Fixed fee for one-off migrations, architecture review, attribution build-out. Dashboard priced separately                                |
| **Open source / licence**                 | Closed. No repositories found                                                                                                                                                                                                          |
| **Confirmed overlap**                     | **Jobs 1–6 of Track B**, including the reconciliation and residual jobs document 02 claimed nobody performed                                                                                                                           |
| **Confirmed absence**                     | None identified within Track B's scope                                                                                                                                                                                                 |
| **Unknowns**                              | Adoption · customer count · whether "reconciled hourly" is true estimate-vs-invoice reconciliation or continuous cost recomputation · residual-explanation mechanics · self-hosted GPU coverage depth                                  |
| **Practical combination closing the gap** | Not required — one product covers the job                                                                                                                                                                                              |
| **Absorption risk**                       | **N/A — the job is already occupied by a direct specialist**                                                                                                                                                                           |

---

# 3. Corrected classifications

Applying the stated final classification rule.

| Track | Rule                                                                                                              | Outcome                                                                                                                  |
| :---: | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **A** | RESEARCHABLE as an open-source or publication topic unless commercial evidence changes                            | **RESEARCHABLE (topic only)** — no commercial evidence emerged                                                           |
| **B** | KILLED if FinOps LLM's shipped product substantially performs invoice reconciliation                              | **KILLED** — it does, across 12+ providers, hourly and monthly against raw invoices, under a no-savings-no-fee guarantee |
| **C** | KILLED if Cybewave substantially performs the idea-first workflow and the remaining differences are feature-sized | **KILLED** — it does, and they are (see below)                                                                           |
| **D** | RESEARCHABLE but not validation-ready unless a buyer, trigger, and measurable promise are established             | **RESEARCHABLE, not validation-ready** — none established                                                                |

## Why the remaining Track C differences are feature-sized

Evaluated as features rather than as a new company, per instruction:

| Difference                                          | Assessment                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C3 — cross-provider cost comparison**             | A comparison table over public pricing. Free cloud calculators already exist; adding one to an existing conversational flow is a feature               |
| **C4 — managed API vs open-source model selection** | A decision table over public model pricing and capability data. **[VERIFIED earlier]** the hardware-fit half is owned by at least six free calculators |
| **C5 — owned-compute awareness**                    | An input field plus a VRAM lookup. ModelFit, apxml, and llmfit.io do this free today                                                                   |
| **C10 — export into Claude Code / Codex**           | Cybewave already exports a scaffolded codebase. Adding an `AGENTS.md` or `CLAUDE.md` context export is a small addition to an existing export path     |

**INFERENCE:** each is an addition to a product that already owns the hard part — the conversational elicitation, the diagrams, and the scaffold. None is a company. Combining all four into one would be a composite, which is prohibited and would repeat the failure pattern of documents 01→05→06.

## What does not change

**None of these classifications makes any track VALIDATION-READY.** B and C are killed on direct competitive evidence. A and D remain researchable without a buyer, trigger, or measurable promise. A track does not become validation-ready because earlier research was wrong about it.

## Corrections to document 09, stated plainly

| Document 09 said                                                                         | Correct position                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| "Absence of demand evidence is the only thing standing between ANVILMARK and a decision" | **False.** Two direct competitors were unexamined. Competitive risk was also outstanding                                 |
| "Track B: RESEARCHABLE — fatal fact failed"                                              | **KILLED.** FinOps LLM sells the exact job with a spend floor and a savings guarantee                                    |
| "Track C: RESEARCHABLE — fatal fact failed"                                              | **KILLED.** Cybewave ships the idea-first workflow; the residue is feature-sized                                         |
| Missing interviews treated as the decisive gap                                           | **Missing validation is neither evidence of demand nor evidence of its absence.** It settles nothing in either direction |

The document 09 corrections to `deploy-on-aws`, PromptScan, and `evalci` **still stand**. Those fatal facts were genuinely unsupported. Tracks B and C are now killed on _different and better_ evidence than the reasoning that was withdrawn.
