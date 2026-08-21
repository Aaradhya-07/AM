# Opportunity Comparison

Research date: **August 13, 2026**

Scoring per [`00-research-method.md`](00-research-method.md). Maximum 140.

> **PARTIALLY SUPERSEDED — August 13, 2026.** Three of the four fatal facts underlying these scores **failed** adversarial verification. See [`08-adversarial-verification.md`](08-adversarial-verification.md) and [`09-corrected-final-verdict.md`](09-corrected-final-verdict.md). Preserved unchanged as a dated record.

## Scores

| Criterion                                  | Weight | **A** Stats | **B** Invoice | **C** Architecture | **D** Repo audit |
| ------------------------------------------ | :----: | :---------: | :-----------: | :----------------: | :--------------: |
| Urgency                                    |   ×2   |      3      |       5       |         4          |        4         |
| Differentiation vs a practical combination |   ×3   |      4      |       1       |         1          |        3         |
| Absorption resistance                      |   ×3   |      2      |       1       |         1          |        2         |
| Buyer and decision point                   |   ×2   |      2      |       6       |         2          |        3         |
| Provability                                |   ×2   |      9      |       7       |         2          |        3         |
| Validatable without a platform             |   ×1   |      8      |       6       |         5          |        6         |
| Relation to original vision                |   ×1   |      3      |       4       |         10         |        9         |
| **Weighted total**                         |        |   **57**    |    **52**     |       **37**       |      **50**      |

Every track scores below half. **INFERENCE:** in a healthy opportunity set, at least one track would clear 90. None clears 60.

## The column that decides everything

**Absorption resistance: 2, 1, 1, 2.**

This is the criterion the previous phase got wrong, and it is now scored against a verified reference case. Braintrust already held per-item scores, production volume, and a PR surface; cost-in-the-PR-comment was therefore never a product. The same test applied honestly across all four tracks returns the same answer each time:

| Track | Who already holds every required input                                                                    |
| :---: | --------------------------------------------------------------------------------------------------------- |
|   A   | Braintrust holds per-item paired scores. `evalci` publishes the methodology, free, with harness adapters. |
|   B   | Finout, Vantage, and CloudZero already ingest the invoices.                                               |
|   C   | AWS ships live pricing, architecture guidance, and IaC generation inside Claude Code.                     |
|   D   | AWS holds the static half; Braintrust and the FinOps platforms hold the runtime and billing halves.       |

**INFERENCE:** there is no track where ANVILMARK would hold an input that an incumbent lacks. That is the structural finding of this phase, and it is more informative than any individual score.

## Where each track fails, in one line

| Track | Score | Fatal fact                                                                                                                                      |
| :---: | :---: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** |  57   | Methodology published; free libraries (`evalci`, `evalstats`, lm-eval-harness, Inspect) implement nearly all of it; incumbents hold the inputs. |
| **B** |  52   | Finout, Vantage, and CloudZero ingest provider invoices natively — reconciling an estimate is unnecessary when you read the bill.               |
| **C** |  37   | `deploy-on-aws` ships the workflow free inside Claude Code with real-time pricing, since March 2026.                                            |
| **D** |  50   | Static half free inside Claude Code; the valuable half needs runtime data owned by observability incumbents.                                    |

## The inverse correlation worth naming

| Track | Relation to original vision |      Total       |
| :---: | :-------------------------: | :--------------: |
|   C   |           **10**            | **37** — lowest  |
|   D   |              9              |        50        |
|   B   |              4              |        52        |
|   A   |              3              | **57** — highest |

**INFERENCE:** the closer a track sits to the founding ANVILMARK vision, the worse it scores. This is not coincidence. The original vision — guide someone to an optimal architecture, audit a repository for expensive choices, feed evidence to coding agents — describes territory that cloud vendors and agent platforms have since occupied directly, for free, because it is adjacent to what they already sell. Being close to the vision now means being close to a free incumbent feature.

That inverse relationship is the single most important output of this phase.

## What was deliberately not done

**The four gaps were not combined.** A composite — "statistically rigorous, invoice-reconciled, vendor-neutral architecture and repository economics for coding agents" — would score better on differentiation than any component, because no single competitor covers all of it.

That is precisely the reasoning that produced documents 01→05→06 and cost two planning phases. Four feature-sized gaps do not sum to a product; they sum to a larger feature-sized gap with four times the surface area and four times the maintenance. The archive's own warning applies: _"fragmentation is not automatically a business opportunity."_

## Categories

| Track | Category         | Justification                                                                                                                                                                                                                                    |
| :---: | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A** | **RESEARCHABLE** | The commercial-platform gap is verified and unresolved, and judge variance in small samples is genuinely open. But there is no identified buyer, no budget, no decision point with money attached — and the central capability is feature-sized. |
| **B** | **KILLED**       | Adequately solved.                                                                                                                                                                                                                               |
| **C** | **KILLED**       | Adequately solved, free, inside the target agent.                                                                                                                                                                                                |
| **D** | **KILLED**       | Static half solved; valuable half structurally blocked behind competed data.                                                                                                                                                                     |

**VALIDATION-READY: none.**

## Why selecting none is the correct outcome

The brief permits selecting zero and states it is preferable to manufacturing an opportunity. The evidence requires it.

**A VALIDATION-READY selection would need:** an identified buyer with a budget, a decision point with a schedule, a gap that survives a practical two-or-three-product combination, and resistance to absorption by an incumbent that already holds the inputs.

**No track has any of the four.** Track A comes closest on provability and fails on every other count. Selecting it would mean spending fifteen interviews and an introduction budget on a capability that Braintrust could add in a sprint using a free library with published methodology — which is, precisely, what the previous phase did.

**INFERENCE:** the useful result of this phase is not a shortlist. It is the finding that the entire region ANVILMARK has been searching — architecture guidance, repository economics, evidence for coding agents — has been enclosed during 2026 by cloud vendors shipping free plugins into the agents themselves, and by eval and FinOps platforms extending into cost. There is no remaining unenclosed ground in this region that a small team could hold.

Continuing to search inside the region would be searching where the light is.
