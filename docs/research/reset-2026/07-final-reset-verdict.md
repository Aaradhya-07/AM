# Final Reset Verdict

Date: **August 13, 2026**
Phase: research only. **No implementation, no accounts, no credentials, no outreach, no customer contacted.**

> **SUPERSEDED — August 13, 2026.** An adversarial verification pass found that **three of the four kills below were not supported to the required standard.** Tracks B, C, and D are corrected to RESEARCHABLE. Final standing: [`../11-anvilmark-closure-memo.md`](../11-anvilmark-closure-memo.md). Correction chain: [`08-adversarial-verification.md`](08-adversarial-verification.md) → [`09-corrected-final-verdict.md`](09-corrected-final-verdict.md) → [`10-competitor-closure-addendum.md`](10-competitor-closure-addendum.md). Preserved unchanged as a dated record.

## Verdict

| Track                                              | Category         |
| -------------------------------------------------- | ---------------- |
| **A — Statistical correctness for AI evaluations** | **RESEARCHABLE** |
| **B — AI inference invoice reconciliation**        | **KILLED**       |
| **C — Architecture planning for new applications** | **KILLED**       |
| **D — Existing-repository decision audit**         | **KILLED**       |

> ## VALIDATION-READY: **none**
>
> No problem found in this phase justifies contacting customers.

Selecting none is permitted by the brief and required by the evidence. The alternative — promoting Track A on a score of 57/140 with no identified buyer — would be manufacturing an opportunity.

## The fatal facts

Each stated once, with its primary source. Any one of these is sufficient to kill its track independently of scoring.

**B.** **VERIFIED:** Finout ingests OpenAI, Anthropic, SageMaker, Vertex AI, and Azure OpenAI invoices into a unified MegaBill with retroactive tag-based allocation; Vantage ships native first-party OpenAI and Anthropic connectors with token-level breakdowns; CloudZero ingests both via AnyCost. Reconciling an _estimate_ against the bill is unnecessary when the platform reads the bill.

**C.** **VERIFIED:** AWS open-sourced `deploy-on-aws` for Claude Code and Cursor in March 2026 — scan codebase → recommend services with rationale → projected monthly cost → CDK/CloudFormation → deploy, backed by an `awspricing` MCP server with real-time pricing. Free, inside the exact agent ANVILMARK proposed to supply.

**D.** **VERIFIED:** the static half ships in that same plugin plus a 34-skill AWS architecture-review ecosystem. The valuable half requires runtime data that source code cannot yield, returning to ground held by Braintrust, Langfuse, Helicone, and the FinOps platforms. PromptScan — free, MIT, functional, with a PR cost-delta action — has **0 stars**.

**A.** **VERIFIED:** the methodology is published (Miller, [arXiv 2411.00640](https://arxiv.org/abs/2411.00640)) and implemented free in `evalci` (CIs, paired tests, power analysis, clustered SEs, multiple-comparison correction, with lm-eval-harness and HELM adapters), `evalstats`, lm-evaluation-harness (stderr by default), and Inspect AI. Braintrust already performs row-paired comparison on identical inputs, so it holds every input a significance test needs.

## The structural finding

**INFERENCE, and it is the substantive output of this phase:**

> In every one of the four tracks, an incumbent already holds every input required to close the gap. There is no track where ANVILMARK would possess data, a surface, or a relationship that a competitor lacks.

And a second, sharper observation:

> **The closer a track sits to the original ANVILMARK vision, the worse it scores.** Track C — the founding scenario almost verbatim — scores 10/10 on fidelity to the vision and **37/140 overall, the lowest**. Track A, scoring highest at 57, is barely related to the vision at all.

That inverse relationship is not bad luck. The original vision describes territory adjacent to what cloud vendors and agent platforms already sell, so they have moved into it directly and given it away. During 2026 the region was enclosed: AWS put architecture recommendation and live pricing inside Claude Code for free; Braintrust extended evals into cost at merge time; FinOps platforms ingested the provider invoices.

Proximity to the vision now predicts proximity to a free incumbent feature.

## What this means for the original vision

Stated plainly, because the brief asked for the vision to be challenged rather than justified.

| Vision component                                                 | Status after three phases                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Guide someone with an idea toward an optimal architecture        | **Occupied**, free, inside Claude Code (`deploy-on-aws`). Also unprovable on a useful timescale.                                      |
| Analyze a repository for inefficient or replaceable choices      | **Structurally blocked.** Source code cannot establish economic consequence; runtime data is competed.                                |
| Supply structured knowledge and evidence to Claude Code or Codex | **Commoditized.** GovForge is Apache-2.0 free; Archcore ships 19 typed doc types over MCP to eight agents; `AGENTS.md` costs nothing. |

**INFERENCE:** all three components of the founding vision are now independently closed. Not narrowed — closed. This is the third consecutive phase in which evidence has contradicted the vision, and the first in which no component survives.

## What was not done, deliberately

**The four gaps were not combined.** A composite would score better on differentiation than any component, because no single competitor covers all of it — and that is exactly the reasoning that produced documents 01→05→06 and consumed two planning phases. Four feature-sized gaps sum to a larger feature-sized gap, not to a product.

## Track A: what "RESEARCHABLE" does and does not authorize

Track A is not dead as a _topic_. It is dead as a _business_ on current evidence.

**Genuinely open:** judge variance in the small-sample regime (20–100 items, where asymptotic methods fail), and the fact that commercial platforms report improvement/regression counts with no statistical treatment while free libraries implement the full methodology.

**INFERENCE:** the appropriate response is a publication or an open-source contribution — for example, running `evalci` against real public eval comparisons and documenting how often reported "improvements" are indistinguishable from noise. That is cheap, genuinely useful to the field, and would establish credibility.

**It is not a company, and it must not be treated as a soft VALIDATION-READY.** No buyer, no budget, no decision point. Doing it would be a reputational investment with no revenue thesis, and it should be undertaken only if that is the explicit intent.

## Recommendation

**Stop searching this region.**

Three phases have now been spent inside architecture guidance, repository economics, and evidence-for-coding-agents. Each phase narrowed the claim in response to evidence; each ended with the claim narrower than a defensible business. The pattern is consistent and the cause is now identifiable: the region is adjacent to what large, well-funded platforms already sell, which means anything valuable found in it becomes their free feature.

**The honest options are three, and the choice is not a research question:**

1. **Stop the ANVILMARK line of work.** The evidence supports this. Three phases, four tracks, five wedges — nothing survived. That is a real result, obtained cheaply, with zero money spent and zero customers burned.
2. **Search a different region entirely** — one chosen from observed problems rather than from the existing repository or brand. This means abandoning the founding vision rather than narrowing it again, and beginning from an observed, urgent problem in a domain where no platform vendor has adjacency.
3. **Publish the Track A finding** as a contribution to the eval community, with no revenue expectation, and treat ANVILMARK as a research effort rather than a product.

**INFERENCE:** option 2 is the only one that preserves a business ambition, and it requires accepting that nothing in this repository or in the founding vision constrains where to look next. The scaffold, the brand, and the contract are sunk; treating them as assets is what kept the search inside this region for three phases.

## What is preserved

All historical research is intact and unmodified. Documents `01`–`08` and the entire `docs/validation/` package remain as the record of how these conclusions were reached. Contract `0.1.0` is frozen and untouched. No packages, schemas, fixtures, MCP tools, or web application were modified in any phase.

**Total spent across all phases: $0. Total customers contacted: 0.**
