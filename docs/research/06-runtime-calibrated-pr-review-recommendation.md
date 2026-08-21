# Recommendation: Runtime-Calibrated AI Pull-Request Review

Prepared: **August 13, 2026**
Status: **Provisional hypothesis, provisionally approved for validation only.**

> **PARTIALLY SUPERSEDED — August 13, 2026.** The wedge selection below stands. Its **differentiation and defensibility claims do not**: Braintrust was subsequently confirmed to provide replay, PR-time evaluation, quality comparison, and merge gating. Braintrust was further confirmed at source level to emit cost and token deltas in its PR comment, which occupies the primary wedge. **Validation was stopped.** Final standing: [`11-anvilmark-closure-memo.md`](11-anvilmark-closure-memo.md); W2 closure evidence: [`08-braintrust-reassessment.md`](08-braintrust-reassessment.md). This document is preserved unchanged as the dated record of how the wedge was selected.

This document records the product-shaping analysis that led to selecting one initial customer and one initial wedge. It is **not** an approved pivot, a product specification, or authorization to build. It authorizes a two-week validation sprint documented in [`../validation/README.md`](../validation/README.md).

## Evidence labelling

Every substantive claim below carries one of four labels. They are not decorative; the strength of the recommendation depends on how much of it rests on each.

| Label            | Meaning                                                                                |
| ---------------- | -------------------------------------------------------------------------------------- |
| **[REPO]**       | Verified by reading files in this workspace on August 13, 2026.                        |
| **[VERIFIED]**   | Checked against a live primary source on August 13, 2026. Source linked at the claim.  |
| **[RESEARCH]**   | Drawn from the saved archive in `docs/research/01`–`05`. Not independently re-checked. |
| **[INFERENCE]**  | Reasoning from the above. Could be wrong without any fact being wrong.                 |
| **[ASSUMPTION]** | Unvalidated. Requires customer contact to confirm or refute.                           |

---

## 1. Repository audit: what exists versus what is claimed

**[REPO]** Every source file in the workspace was read. Total hand-written source across all four packages is approximately **450 lines**, plus roughly 74 lines of tests.

| Artifact                             | Reality                                                                                                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm monorepo, TS config, lint tools | **Real.**                                                                                                                                                                                                            |
| `packages/contract` Zod schemas      | **Real and complete** (79 lines, frozen at `0.1.0`). The only substantive engineering artifact.                                                                                                                      |
| Three audit fixtures                 | **Real files, hand-authored fiction.** Models are named `flagship-general-model` and `compact-classifier-model`; `reasoning` fields state "is represented as a candidate … in this fixture."                         |
| `packages/engine` recommendation     | **Stub.** `runAudit()` ignores its input entirely and returns the `saas-support` fixture (`packages/engine/src/index.ts:7-10`).                                                                                      |
| Five detection rules                 | **Stubs returning `null`.** Each is a six-line call to `createStubRule()`; the shared `detect()` returns `null` unconditionally (`packages/engine/src/rules/types.ts:18-21`).                                        |
| LiteLLM pricing provider             | **Stub.** `loadPricingCatalog()` returns `null` with no network call (`packages/engine/src/pricing/litellm.ts:13-17`).                                                                                               |
| MCP server, three tools              | **Structurally real, semantically fake.** `explain_finding` returns a canned string; `estimate_cost` ignores every numeric input and returns `document-review` fixture totals (`packages/mcp/src/server.ts:86-102`). |
| Next.js web app                      | **Real, 131 lines, renders one fixture.**                                                                                                                                                                            |
| Brand assets (24 files)              | **Real, and the most complete asset in the repository.**                                                                                                                                                             |

### Two corrections to `04-build-audit.md`

**[REPO]** The directory is **still not a Git repository**; `git rev-parse --is-inside-work-tree` fails. The August 9 audit flagged this and it has not been resolved. There is no commit history, provenance, or branch discipline.

**[INFERENCE]** The "15–20% path to sellable product" estimate is **too high for any wedge that makes decisions**. Contract `0.1.0` encodes findings as `currentMonthlyUsd` / `projectedMonthlyUsd` / `savingsMonthlyUsd` derived from static analysis — precisely the false-precision failure mode that `05-market-verdict-and-next-decisions.md` rejects. The contract is not neutral scaffolding; it is a frozen commitment to the discarded thesis. Realistic reuse for this wedge is closer to **10%** (toolchain, brand, and the discipline of a typed contract).

**Per instruction, contract `0.1.0` is preserved unchanged.** It is the historical prototype's contract and stays frozen until this wedge passes or fails validation. Nothing in this document authorizes editing it.

---

## 2. Product evolution and the current hypothesis

**[RESEARCH]** Three stages:

1. **Cost auditor** — source-level, dollar-precise. Abandoned because source alone cannot know traffic volume, retries, cache-hit rate, or concurrency, and because roughly 25 tools already occupy the category.
2. **Two scenarios** — idea-to-architecture, and audit-an-existing-repository. Both found to be 70–80% assemblable from existing products.
3. **Current hypothesis** — the vendor-neutral architecture decision graph that coding agents consult before building and must satisfy after.

**[INFERENCE]** Each reframe moved _up_ in abstraction and _outward_ in scope in response to competitive pressure. This is a recognizable failure pattern: when a narrow claim is contested, scope widens until no single competitor covers the whole thing. But "no one covers all of it" is not "someone wants all of it." The archive states this itself and then does not act on it: _"fragmentation is not automatically a business opportunity"_ (`03-scenario-coverage.md`). Scope grew roughly tenfold while implementation stayed at zero.

---

## 3. Challenge to the hypothesis

> _"ANVILMARK is a vendor-neutral architecture decision system that converts intent and constraints into a living, evidence-backed architecture graph, supplies that graph to coding agents, and continuously verifies the resulting repository and runtime against it."_

Seven objections, strongest first.

### 3.1 The graph has no owner and will rot — **[INFERENCE]**

This is four products (intake, option engine, agent delivery, conformance) whose value is claimed to live in the seam between them. The graph is a _second artifact_ maintained alongside the repository. Every prior generation of this — Structurizr, SAP LeanIX, Ardoq, Sparx, all catalogued in `02-competitor-register.md` — demonstrates that a hand-curated architecture model decays the moment it stops being the thing that ships. Durable architecture models are either _derived_ (CodeBoarding, NodeScope) or _executable_ (ArchUnit, ArchRails' `calm.json`). The proposed graph is neither.

### 3.2 "Supplies the graph to coding agents" is already free — **[VERIFIED]**

[GovForge](https://govforge.dev/en/) ships an MCP server, CLI, local decision timeline, and policy enforcement across security, architecture, patterns, performance, and compliance under **Apache-2.0, described as free forever**. [Archcore](https://archcore.ai/) is git-native, storing specifications and decisions in a versioned `.archcore/` directory across nineteen typed document categories with named relations (`implements`, `extends`, `depends_on`, `related`), delivered to eight coding agents via MCP with session hooks. Beneath both sits `CLAUDE.md` / `AGENTS.md` at zero cost. This layer is a commodity with a free floor, not an opening.

### 3.3 "Repository _and_ runtime" bundles two incompatible problems — **[INFERENCE]**

Repository conformance requires read access to code: trivial to obtain, and heavily competed. Runtime conformance requires production telemetry: hard to obtain, high trust barrier, and defended by every observability vendor. Bundling them means the easy half is undifferentiated while the hard half gates the entire onboarding flow. They must be separated and sequenced.

### 3.4 "Vendor-neutral" is an operating expense described as a moat — **[INFERENCE]**

Neutrality obligates continuous maintenance of a catalog covering every model, price, license, and hardware SKU, all of which decay weekly. LiteLLM, Artificial Analysis, and Hugging Face publish those slices for free. The archive concedes the point: _"pricing, model catalogs, and benchmarks decay quickly"_ (`05-market-verdict-and-next-decisions.md`).

### 3.5 Correctness is unfalsifiable on the relevant timescale — **[INFERENCE]**

"Was this architecture decision right?" resolves in six to eighteen months, if ever, confounded by every other change made in the interim. A product that cannot score itself cannot accumulate advantage from usage. By contrast **[VERIFIED]** [ArchRails](https://www.archrails.io/) sidesteps this entirely by being deterministic — the site states that no ML model decides pass or fail — and by enforcing only what the customer explicitly declared.

### 3.6 It presumes intent exists as a capturable artifact — **[ASSUMPTION, likely false]**

Most architecture decisions are made under deadline, verbally, and documented afterward if at all. A product whose first step is a structured intake interview demands work before delivering value.

### 3.7 The buyer is imagined rather than observed — **[RESEARCH]**

The archive's own risk list ends with: _"the most valuable buyer may be an engineering team with governance needs, not the novice founder originally imagined."_ That instinct is correct, and it contradicts Scenario A, which still drives the hypothesis.

### What survives the challenge

One idea, and it is not the graph. It is **calibration**: _a claim about cost or quality is trustworthy only if measured against the system's actual behavior, and credible only if the predictor keeps score of its own accuracy._

**[INFERENCE]** This is the only element of the hypothesis that simultaneously (a) requires data a competitor cannot trivially obtain, (b) produces a **falsifiable** output, and (c) has no shipped implementation found in the research. The graph, if ever built, should be the residue of accumulated calibrated decisions — never the entry point.

---

## 4. The three strongest initial segments

### Eliminated before scoring — **[INFERENCE]**

- **Non-technical founder.** No runtime data, no budget, and unable to evaluate the advice — therefore unable to confirm or refute the output. Replit, Lovable, Base44, and v0 own the job. The worst possible design partner.
- **Consultancy.** Wants a report generator, captures the margin, and churns when the engagement ends. A plausible year-two channel; a misleading first customer.

### Segment A — Small AI product team with a live LLM product and a noticed bill

Five to thirty engineers, Seed to Series B, roughly $5k–$100k per month of inference spend.

| Dimension                   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Urgent JTBD**             | "Tell me _before I merge_ whether this change to a model, prompt, or routing rule will raise my bill or drop my quality — because right now I find out in production."                                                                                                                                                                                                                                                                                                                                                                                       |
| **Trigger event**           | A step change in the monthly invoice; a CFO or board question about gross margin; **most acutely** — they cut cost, quality silently regressed, they rolled back, and now nobody is permitted to touch the model configuration. **[INFERENCE]** The third trigger is sharpest because it converts a cost problem into an organizational freeze.                                                                                                                                                                                                              |
| **How they solve it today** | Helicone or Langfuse dashboards _after_ deploy; Braintrust or promptfoo evals against a curated golden set; a spreadsheet of token estimates; one senior engineer's intuition; or simply not changing anything.                                                                                                                                                                                                                                                                                                                                              |
| **Closest competitors**     | **Braintrust** (closest). **[VERIFIED]** Its GitHub Action runs evals on every pull request and blocks merges below a threshold; separately, its traces carry per-span input tokens, output tokens, latency, and estimated cost ([source](https://www.braintrust.dev/articles/best-tools-tracking-llm-costs-2026), [source](https://www.braintrust.dev/articles/how-to-reduce-costs-for-llms-using-braintrust)). Also Langfuse, Helicone, Datadog LLM Observability, promptfoo, PromptScan.                                                                  |
| **Why insufficient**        | **[VERIFIED + INFERENCE]** Braintrust proves quality against a _golden dataset_ — curated, small, and not representative of the real traffic mix — and does not state the cost consequence at the customer's measured volume and input distribution. Observability reports cost _after_ deployment. The join (this diff × measured traffic profile → predicted cost and quality delta with an error bar) appears in 2026 practitioner writing as best practice but was not found shipped as a product. No tool found scores its own prediction after deploy. |
| **Data and integrations**   | Thirty days of LLM call telemetry (Langfuse/Helicone export, OpenTelemetry GenAI spans, or gateway logs); a sample of **real production inputs** (the sensitive part); GitHub App for repository read and PR webhook; one provider invoice for baseline reconciliation; a replay execution path, defaulting to the customer's own environment.                                                                                                                                                                                                               |
| **Likely WTP**              | **[ASSUMPTION]** $500–$3,000 per month, anchored as a fraction of the bill being controlled. A team at $20k/month plausibly pays 5–10% for a safe 30% reduction. Critically, priced against **spend**, not against seats.                                                                                                                                                                                                                                                                                                                                    |
| **Adoption barriers**       | (1) Production inputs leaving their boundary — PII. Mitigated by making in-CI or self-hosted replay the default. (2) Trusting a prediction — mitigated only by publishing the error bar and the backtest. (3) "We already pay for Braintrust." (4) Telemetry may be absent or too coarse at the call-site granularity required.                                                                                                                                                                                                                              |

### Segment B — Platform or architecture team governing many coding agents

Two hundred or more engineers, central platform group.

| Dimension                   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Urgent JTBD**             | "Stop forty engineers and their agents from silently violating our architecture, and give me an audit trail."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Trigger event**           | An agent-authored PR shipped a boundary violation (a new datastore, a direct cross-service call, a second LLM provider quietly added); an EU AI Act or SOC 2 audit request; a mandate to adopt coding agents at scale.                                                                                                                                                                                                                                                                                                                                                                                                           |
| **How they solve it today** | `CLAUDE.md` / `AGENTS.md`, ArchUnit, SonarQube, Semgrep, CODEOWNERS, review bottlenecked on one architect, ADRs in an unread wiki.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Closest competitors**     | **[VERIFIED]** [ArchRails](https://www.archrails.io/) — "Architecture governance for the AI-agent era"; gates agents via **MCP before code generation** and enforces identical rules as a **merge-blocking PR gate**; rules expressed in [FINOS CALM](https://calm.finos.org/) JSON; deterministic Python engine; bring-your-own-cloud. [GovForge](https://govforge.dev/en/) — **Apache-2.0, free**, post-generation PR governance across five lenses including architecture and performance. [Archcore](https://archcore.ai/) — git-native decision context via MCP to eight agents. Also Qodo, SonarQube, FINOS CALM directly. |
| **Why insufficient**        | **[INFERENCE]** They enforce _declared_ rules; someone must author the `calm.json` or policy set, and that authoring burden is the real bottleneck nobody solves. But this is a **weak wedge for ANVILMARK**: the segment's problem is solved well enough, one credible competitor is free and open-source, and the residual gap is a services problem rather than a product.                                                                                                                                                                                                                                                    |
| **Data and integrations**   | Repository and PR access, CI, organizational policy documents. Low sensitivity, easy to obtain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Likely WTP**              | **[ASSUMPTION]** High ceiling ($20k–$50k per year) but six-to-twelve-month sales cycles, SOC 2, security review, and procurement — infeasible for a pre-validation team of this size.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Adoption barriers**       | Procurement, security review, competing against free open source, requires an internal champion with budget authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Segment C — Solo or small technical founder shipping with Claude Code or Codex

| Dimension                   | Finding                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Urgent JTBD**             | "Make the agent build it the way I would have, so I don't spend a weekend undoing it."                                                                                                |
| **Trigger event**           | The agent produced working-but-wrong-shaped code; a surprise API bill; writing the same correction into `CLAUDE.md` for the fifth time.                                               |
| **How they solve it today** | Free context files, [GitHub Spec Kit](https://github.github.io/spec-kit/), [BMAD](https://docs.bmad-method.org/), manual review.                                                      |
| **Closest competitors**     | Free context files (the real competitor), Spec Kit, BMAD, Archcore, [Kiro Specs](https://kiro.dev/docs/specs/).                                                                       |
| **Why insufficient**        | **[INFERENCE]** Mostly, they are not insufficient. The free substitute is genuinely adequate, and this is precisely the surface that agent vendors will absorb into the agent itself. |
| **Data and integrations**   | Repository only. Trivial.                                                                                                                                                             |
| **Likely WTP**              | **[ASSUMPTION]** $0–$20 per month. Effectively zero.                                                                                                                                  |
| **Adoption barriers**       | None meaningful — and no revenue either. An excellent **distribution** channel, unusable as a **validation** partner.                                                                 |

---

## 5. Wedge scoring

Scored 1–10, higher is better. **[INFERENCE]** throughout — these are judgments informed by the verified competitive facts, not measurements.

The two columns that should decide the outcome are **Provable correctness** and **Differentiation**, because an unvalidated product built by a small team needs a falsifiable claim more than it needs surface area.

| Wedge                                               | Urgency | Differentiation | Feasibility | Time to first useful | Provable correctness | Data access | Distribution | Defensibility | Revenue | **Total** |
| --------------------------------------------------- | ------: | --------------: | ----------: | -------------------: | -------------------: | ----------: | -----------: | ------------: | ------: | --------: |
| **W1** Architecture contract for coding agents      |       6 |               2 |           8 |                    8 |                    4 |           9 |            7 |             2 |       4 |    **50** |
| **W2** Runtime-calibrated AI PR review              |       8 |               8 |           6 |                    6 |                    9 |           5 |            7 |             7 |       8 |    **64** |
| **W3** Owned-hardware AI architecture planner       |       4 |               2 |           7 |                    8 |                    6 |           6 |            4 |             2 |       2 |    **41** |
| **W4** Vendor-neutral AI component decision records |       4 |               3 |           7 |                    7 |                    3 |           7 |            5 |             3 |       4 |    **43** |
| **W5** Intent-to-implementation conformance         |       6 |               4 |           5 |                    4 |                    5 |           8 |            6 |             4 |       5 |    **47** |

### Scoring rationale

**W1 — Differentiation 2, Defensibility 2.** **[VERIFIED]** ArchRails performs pre-generation MCP gating _and_ PR merge-blocking with a deterministic engine. GovForge does it free under Apache-2.0. Archcore covers the decision-context half. Beneath all three, `AGENTS.md` costs nothing. Provable correctness is 4 because one can prove a rule _fired_, never that the rule was _right_.

**W2 — Provable correctness 9.** The decisive score. Prediction happens at merge, measurement after deploy, and self-grading within one release cycle. No other wedge produces a falsifiable claim on a timescale a founder can act on. Data access is 5 because production telemetry plus input samples is the hardest input on this page to obtain — the single assumption capable of killing the wedge. Defensibility is 7 rather than 9 because **[INFERENCE]** Braintrust is one product decision away from this; it already holds both halves.

**W3 — Differentiation 2, Revenue 2.** **[VERIFIED]** At least six free calculators own these queries: [ModelFit](https://modelfit.io/calculator/) (updated 2026-08-01), [apxml VRAM calculator](https://apxml.com/tools/vram-calculator) (v3.0, 2026-08-03, which added a setup planner comparing hardware configurations with throughput and cost trade-offs — that _is_ this wedge), [llmfit.io](https://llmfit.io/), and others. Nobody pays for a calculator.

**W4 — Provable correctness 3.** **[VERIFIED]** Archcore is this wedge, shipped, git-native, MCP-delivered to eight agents. A decision record's correctness is unfalsifiable in the short run, and catalog freshness is recurring operating expense rather than moat.

**W5 — Feasibility 5, Time to first useful 4.** **[INFERENCE]** Semantic intent-to-code matching is noisy, and false positives destroy trust in a merge gate faster than anything else. It also presupposes a _correct_ specification, which returns to W1 and W4. This is a year-two capability that W2 earns the right to build.

**Verdict: W2, by fourteen points, and on the two criteria that matter most.**

---

## 6. Recommendation

**Segment A × Wedge 2.** Small AI product teams with a live LLM product and a noticed bill; runtime-calibrated AI pull-request review.

**[INFERENCE] The strategic logic in one line:** every other wedge asks the customer to trust a claim they cannot check. This one hands them a number, then hands them the receipt.

### One-sentence positioning

> ANVILMARK tells you what a change to your AI system will actually cost and how much it will move quality — measured against your real production traffic, before you merge — and then keeps score of how accurate it was.

### Exact initial workflow

1. The team connects an existing telemetry source, read-only, covering thirty days.
2. ANVILMARK builds a **traffic profile** per AI call site: volume, input and output token _distributions_ (not means), cache read/write rates, retry rate, error rate, model mix, and concurrency.
3. ANVILMARK **reconciles its reconstructed cost baseline against the provider invoice** and reports the variance together with every unreconciled component. Trust is earned here, before any prediction is made.
4. The team opens a pull request touching an AI call site.
5. ANVILMARK maps changed call sites to the traffic profile and **replays real recorded production inputs** through the old and new configurations — **by default inside the customer's own environment**.
6. One PR comment: cost delta with an interval, quality delta with sample size and the method used, the specific samples that regressed, all assumptions, data completeness, and a merge recommendation.
7. After deployment, ANVILMARK measures the actual outcome and posts a **predicted-versus-actual scorecard**. This step is the product.

### What ANVILMARK owns

The traffic profile; invoice reconciliation and its honest error terms; the sampling and replay methodology; the prediction and its uncertainty; the post-deployment accuracy scorecard and the accumulating public track record.

### What Claude Code or Codex owns

Writing the change; the refactor; tests; migration; everything after the merge verdict. ANVILMARK does not generate the fix in the first version.

### Minimum inputs

Thirty days of LLM telemetry export or gateway tap; a sample of real production inputs per call site (retained in the customer's environment by default); GitHub App with repository read and PR webhook; one month's provider invoice; a replay execution path.

### Minimum outputs

One PR comment (cost delta with range, quality delta with sample size and method, regressed samples, assumptions, data completeness, confidence, execution location, merge recommendation) and one post-deployment scorecard (predicted versus actual).

### What not to build

The architecture graph; the visual canvas; the intake or interview flow; the architecture generator; the owned-hardware planner; the vendor-neutral component catalog; multi-cloud IaC; any dashboard; the MCP server as a first surface; authentication, teams, persistence, or billing beyond one design partner's needs; the Next.js application.

**Contract `0.1.0` is preserved unchanged and remains frozen.** It belongs to the historical prototype. Its shape is unsuitable for this wedge, but it is not to be deleted, rewritten, or unfrozen until the wedge passes validation.

---

## 7. Load-bearing assumptions

Tracked operationally in [`../validation/assumption-register.md`](../validation/assumption-register.md). Summarized here:

1. **[ASSUMPTION — load-bearing]** Teams will grant read access to production LLM telemetry _and_ permit replay against real input samples, given that in-CI or self-hosted execution is the default.
2. **[ASSUMPTION]** Traffic concentrates on few enough call sites, with low enough variance, that an achievable sample size yields a usefully tight interval. **Sample size must be derived per call site from measured variance, task type, failure rarity, and the minimum meaningful quality difference — never assumed.**
3. **[ASSUMPTION]** A reconstructed cost baseline can be reconciled against a provider invoice to a stated, defensible variance, with every unexplained component named rather than absorbed.
4. **[ASSUMPTION]** The merge is a genuine decision point — teams currently ship AI changes without knowing the consequence and _would change behavior_ given the number.
5. **[ASSUMPTION]** Willingness to pay anchors to the inference bill (roughly $1,000–$3,000 per month), not to a developer-tool seat price.

---

## 8. Success and kill criteria

### Success — all six must hold

1. **At least 5 of 15** interviewed teams experienced a cost-or-quality regression caused by an AI code change **within the last 90 days**. Tests recency, not interest.
2. **At least 3 of 5** committed teams grant telemetry access within **five business days** of agreeing. Measures real friction rather than stated willingness.
3. The reconstructed baseline reconciles to the invoice within a **stated, defensible variance** for at least 3 of 5 teams, with all unreconciled components explicitly named.
4. On **at least 3 retrospective pull requests**, the prediction direction is correct and the magnitude falls within the interval the method itself declared in advance.
5. **At least 2 teams** pay **$1,000 or more** for a paid design partnership, **or** verifiably change a merge decision because of a report.
6. **At least 1 team** states some version of _"I would have merged this and been wrong."_

### Kill — any one triggers a stop

1. **Fewer than 5 of 15** experienced the problem recently. Wrong segment, or the problem does not exist at this stage.
2. **Fewer than 2 teams grant telemetry access**, including under in-CI or self-hosted execution. **This kills Wedge 2 specifically.** It does not kill ANVILMARK. The correct response is to return to this document's wedge table and reconsider W5 or W1 with the knowledge that runtime data is unobtainable in this segment — noting that both scored materially lower and that a wedge without runtime data is undifferentiated against ArchRails and GovForge.
3. The baseline cannot be reconciled to a variance the team is willing to state publicly, or the unreconciled residual cannot be explained. Trust cannot be established, therefore no prediction can be sold.
4. Prediction direction is wrong on 2 or more of 5 retrospective PRs, or magnitude falls outside the method's own declared interval more often than the interval's stated coverage allows. The method does not work at achievable sample sizes.
5. After seeing a delivered report, teams state that Braintrust, Langfuse, or an existing tool already covers it. Absorption risk realized; reassess immediately.
6. Zero paid commitments after five delivered reports. Real but not urgent. Narrow or stop.

**Scope note (per instruction):** kill criterion 2 terminates **this wedge**, not the project. Every other kill criterion likewise scopes to the wedge unless it independently invalidates Segment A.

---

## 9. Verified external sources

All checked on **August 13, 2026**.

| Claim used in this document                                                                                           | Source                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ArchRails gates agents via MCP pre-generation and enforces identical rules as a merge gate; FINOS CALM; deterministic | [archrails.io](https://www.archrails.io/)                                                                                                                                                                            |
| GovForge is Apache-2.0 free, MCP + CLI, PR-stage governance across five lenses, no runtime telemetry                  | [govforge.dev](https://govforge.dev/en/)                                                                                                                                                                             |
| Archcore is git-native, nineteen typed document categories, MCP to eight agents, session hooks                        | [archcore.ai](https://archcore.ai/)                                                                                                                                                                                  |
| PromptScan is static-only with a PR cost-delta GitHub Action; 0 stars, 0 watchers, 78 commits, MIT                    | [github.com/joandino/promptscan](https://github.com/joandino/promptscan)                                                                                                                                             |
| Braintrust runs evals on every PR and blocks merges below threshold; traces carry per-span tokens, latency, cost      | [braintrust.dev](https://www.braintrust.dev/articles/best-tools-tracking-llm-costs-2026), [braintrust.dev](https://www.braintrust.dev/articles/how-to-reduce-costs-for-llms-using-braintrust)                        |
| Owned-hardware planning is commoditized by multiple free calculators                                                  | [modelfit.io](https://modelfit.io/calculator/), [apxml.com](https://apxml.com/tools/vram-calculator), [llmfit.io](https://llmfit.io/)                                                                                |
| ADR-for-agents and architectural drift are an active 2026 practitioner topic                                          | [codex.danielvaughan.com](https://codex.danielvaughan.com/2026/04/28/codex-cli-architecture-decision-records-adr-automated-governance/), [agiflow.io](https://agiflow.io/blog/enforce-ai-architectural-patterns-mcp) |

**[INFERENCE]** Competitor capability pages describe intended positioning. Marketing claims are not product behaviour. Every Tier 1 claim relied upon for differentiation must be re-tested hands-on before ANVILMARK asserts a gap publicly. Tracked in [`../validation/competitor-validation-matrix.md`](../validation/competitor-validation-matrix.md).

---

## 10. Status and next step

This recommendation is **provisional**. It authorizes the two-week validation sprint in [`../validation/README.md`](../validation/README.md) and nothing else.

No application code, package, fixture, schema, MCP tool, or web surface is to be modified during validation.
