# Corrected Final Verdict

Date: **August 13, 2026**
Supersedes [`07-final-reset-verdict.md`](07-final-reset-verdict.md), which is preserved unchanged as a dated record.
Basis: [`08-adversarial-verification.md`](08-adversarial-verification.md).

> **PARTIALLY SUPERSEDED — August 13, 2026.** Two direct competitors were still missing. **Track B is KILLED** (FinOps LLM sells the reconciliation job) and **Track C is KILLED** (Cybewave Studio ships the idea-first workflow). The claim below that "absence of demand evidence" was the only remaining issue is **withdrawn**. See [`10-competitor-closure-addendum.md`](10-competitor-closure-addendum.md) and [`../11-anvilmark-closure-memo.md`](../11-anvilmark-closure-memo.md). The corrections to `deploy-on-aws`, PromptScan, and `evalci` below still stand.

## Corrected classifications

| Track                                | Was (doc 07) | **Now**          | What changed                                                                                                                                                       |
| ------------------------------------ | ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — Statistical eval correctness** | RESEARCHABLE | **RESEARCHABLE** | Unchanged category, different reasoning. Four platforms ship repeated trials (the gap is narrower); `evalci` is not a locatable free substitute (the gap is wider) |
| **B — Invoice reconciliation**       | KILLED       | **RESEARCHABLE** | **Fatal fact failed.** Ingestion ≠ reconciliation. But a specialist vendor already ships the job                                                                   |
| **C — Architecture planning**        | KILLED       | **RESEARCHABLE** | **Fatal fact failed.** `deploy-on-aws` covers ~2 of 11 sub-steps and requires a codebase                                                                           |
| **D — Repository decision audit**    | KILLED       | **RESEARCHABLE** | **Both fatal facts failed.** PromptScan was unlaunched; the plugin does deployment mapping, not inefficiency detection                                             |

> ## VALIDATION-READY: **none**
>
> Unchanged. No track has an identified buyer, a budget, or a decision point with money attached.

**Three of four kills were not supported to the required standard.** The adversarial pass was justified.

---

## Which fatal claims failed, and why

### Track B — "reading the bill makes reconciliation unnecessary"

**Failed because it assumed the conclusion.** An invoice total tells you what you paid. It does not tell you why a telemetry-derived estimate differs from it, and the difference is the job. The practitioner literature describes an explicit residual practice — matched / explained variance / unresolved, with an exception queue and evidence links — which would be unnecessary if ingestion solved it.

The supporting claims about Finout, Vantage, and CloudZero came from **vendor comparison blogs, including Finout's own blog describing competitors**. Attempting to verify against Finout's documentation returned a landing page with no data-source detail. Those claims are downgraded to SECONDARY-SOURCED.

**Why it does not become VALIDATION-READY:** [FinOps LLM](https://finopsllm.com/) ships this exact job across twelve-plus providers — "token-level cost data ingested from every provider. Reconciled hourly", "Invoice-first audits", savings "reconciled to invoice" — at 15–25% of verified savings with a $20k/month spend floor, or $1,500/month self-serve. Document 02 listed this vendor in an inherited register and never checked it. Beyond that, the job crosses FinOps, engineering, procurement, AP, and controllership, which is an enterprise procurement sale ANVILMARK has no route into.

### Track C — "`deploy-on-aws` ships the workflow"

**Failed on primary evidence.** The plugin "operates on an existing application codebase" and "Requires AWS CLI with configured credentials." It is AWS-only, performs no AI model selection, produces no interactive diagram, and Codex support is not documented.

Against the eleven sub-steps it passes **C8 (conversational revision) and C11 (continue into implementation)** and fails or does not document the other nine — including **C1, the defining premise that the user has an idea and no repository.**

A tool that requires a codebase cannot serve a scenario that begins without one. Treating it as equivalent was the largest error in the reset phase.

**Why it does not become VALIDATION-READY:** the combination that would cover C1–C11 is **HYPOTHETICAL** — handoff compatibility unverified, and it requires the user to orchestrate four tools and judge their outputs, which the target user explicitly cannot do. But Archie, BackArch, and ArchGenie were never re-verified against C1–C11, so their coverage is **UNKNOWN**, and an unknown is not a clearance. Independently, the buyer problem from the main archive's doc 06 §4 stands untouched: a non-technical founder cannot evaluate architectural advice and therefore cannot confirm or refute it.

### Track D — "PromptScan's zero stars prove no demand"

**Failed on the underlying data.** The repository was created **July 21, 2026** and last pushed **July 28, 2026** — three weeks old at time of research — with **no description and no homepage**. Zero stars measures discoverability, not demand. It was never launched.

The second fatal claim also failed: `deploy-on-aws` performs scan → recommend AWS services → cost → IaC → deploy, which is **mapping an application onto AWS deployment services**, not detecting that an existing choice is inefficient and proposing a migration.

**Why it does not become VALIDATION-READY:** the structural argument survives and is genuinely independent of competition — source code alone cannot establish traffic volume, cache-hit rate, retry rate, or output length, so it cannot quantify whether a choice is _unnecessarily_ expensive. Track D's job as specified requires that quantification. This makes the job dependent on runtime data that observability vendors already hold — a serious risk factor, though under the stated rules not by itself a fatal fact.

### Track A — category unchanged, reasoning corrected in both directions

**Narrower than claimed:** LangSmith (`num_repetitions`, with a dedicated how-to page), W&B Weave (`trials`), DeepEval (`-r`), and promptfoo (`--repeat`, explicitly "to measure variance") all ship repeated-trial execution motivated by non-determinism. The T7 observation is less novel than document 01 implied.

**Wider than claimed:** `evalci` — cited as the free substitute implementing the whole track — **could not be located on PyPI or GitHub**. The paper is five weeks old; the CC-BY 4.0 licence covers the _paper_, not the code, which document 01 conflated. Its adapters target **lm-evaluation-harness and HELM** — benchmark harnesses that product teams do not use. The "already free" argument therefore applies to researchers, not to users of the thirteen platforms examined.

**The sharpened statement:** platforms generate repeated measurements and then perform **no statistical inference on them**. No commercial platform was found computing a confidence interval, significance test, power analysis, or multiple-comparison correction from repeats.

**Why it does not become VALIDATION-READY:** nine of thirteen platforms remain NOT DOCUMENTED, so "nobody does this" is unsupported. And no buyer, budget, or decision point was identified. Provability remains the track's one genuine strength.

---

## What did not change

**The recommendation is unchanged: do not proceed to customer contact, and do not build.**

Three kills were over-claimed. None of the corrections produced a buyer.

Every track now sits in the same position: a gap that may be real, with **no identified buyer, no budget, no decision point, and no evidence of demand.** Zero customers have been contacted across every phase of this work. That absence is the binding constraint, and it is not a research problem — no further desk research can resolve it.

The structural finding from document 07 also survives in weakened form. It was overstated as "an incumbent already holds every input in every track." The corrected version:

> In three of four tracks, a well-resourced incumbent or specialist vendor holds most of the required inputs and has a plausible path to the rest. That is a serious risk factor. It is not, by itself, proof that the job is solved — and doc 07 treated it as if it were.

## What this exercise demonstrated about the method

**INFERENCE, and worth recording:** document 07 reached a confident four-track verdict in a single pass, and three of its four kills did not survive scrutiny. The failure mode was consistent — accepting an adjacent capability as equivalent to the exact job, and accepting a secondary source as primary.

That is the same error made with Braintrust in the previous phase, in the opposite direction: there, an example table was read as an exhaustive schema and produced a false _negative_ on a competitor. Here, adjacent capabilities were read as full coverage and produced false _positives_ on three.

**The common cause is resolution.** Both errors came from judging a capability without examining what it actually does at the level of the specific job. A single research pass is not sufficient to kill an option, and an adversarial pass should be standard before any fatal conclusion — not a correction applied after one.

## Recommendation

**Unchanged in substance, corrected in basis.**

Do not contact customers. Do not build. W2 remains closed.

The three options in document 07 stand, with one correction to how they should be read:

1. **Stop the ANVILMARK line of work.** Still supported — but now on the grounds that **no track has a demonstrated buyer**, not on the grounds that every track is solved. That is a weaker and more honest justification for the same action.
2. **Search a different region**, chosen from an observed problem rather than from this repository or brand.
3. **Publish the Track A finding** — with the correction that the honest finding is narrower than document 07 stated: platforms run repeated trials and then perform no inference on them.

**The decisive question is unchanged and remains unanswered after every phase: who has this problem, and would they pay?** Four tracks, five wedges, three phases, and zero customer conversations. No amount of further competitor research will answer it, and the corrected verdict makes that clearer than the original did — because with three fatal facts withdrawn, the only thing still standing between ANVILMARK and a decision is the complete absence of demand evidence.

---

## Standing

|                                                                    |                                                                                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Documents `01`–`07`                                                | Preserved unchanged as dated records. Their fatal facts are superseded by `08` and this note                            |
| [`08-adversarial-verification.md`](08-adversarial-verification.md) | Current evidence of record                                                                                              |
| **This document**                                                  | **Historical** — superseded by [`10`](10-competitor-closure-addendum.md) and [`../11`](../11-anvilmark-closure-memo.md) |
| Contract `0.1.0`                                                   | Frozen, unmodified                                                                                                      |
| Repository                                                         | No packages, schemas, fixtures, MCP tools, or web application changed                                                   |
| Spend                                                              | **$0.** Customers contacted: **0**                                                                                      |
