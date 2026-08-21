# Track D — Existing-Repository Decision Audit

Research date: **August 13, 2026**
Verdict: **KILLED** — structurally blocked. The static half is occupied; the half that would add value requires runtime data owned by observability incumbents.

> **PARTIALLY SUPERSEDED — August 13, 2026.** Both fatal facts **failed** — PromptScan was a 3-week-old unlaunched repo, and `deploy-on-aws` does deployment mapping rather than inefficiency detection. **Corrected to RESEARCHABLE.** See [`08-adversarial-verification.md`](08-adversarial-verification.md) and [`09-corrected-final-verdict.md`](09-corrected-final-verdict.md). Preserved unchanged as a dated record.

## The scenario, evaluated exactly as written

> "The system scans a repository and identifies infrastructure, model, provider, framework, or architectural choices that are unnecessarily expensive or inefficient; proposes credible replacements; shows migration consequences; and provides evidence consumable by Claude Code or Codex."

## Distinguishing it from adjacent categories

The brief asks for this separation. Doing it honestly is what exposes the structural problem.

| Adjacent category        | How Track D differs                                                       | Who owns the adjacent category                  |
| ------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------- |
| Generic code review      | Judges _choices_, not correctness or style                                | CodeRabbit, Greptile, Qodo, GitHub Code Quality |
| Static analysis          | Judges economics, not defects                                             | SonarQube, Semgrep, CodeQL                      |
| Dependency updates       | Judges whether the component is _right_, not current                      | Dependabot, Renovate, Moderne                   |
| Cloud-cost scanning      | Judges application choices, not provisioned resources                     | Infracost, CloudZero, Vantage                   |
| LLM observability        | Pre-deployment and code-anchored, not runtime dashboards                  | Braintrust, Langfuse, Helicone, Datadog         |
| Architecture conformance | Judges whether a choice is _good_, not whether it matches a declared rule | ArchRails, GovForge, Archcore                   |
| Security scanning        | Economics, not vulnerabilities                                            | Snyk, Dojigiri                                  |
| Model routing            | Advises a change, does not execute per-request selection                  | Portkey, LiteLLM, Not Diamond, Martian          |
| AI coding agents         | Supplies evidence rather than writing the change                          | Claude Code, Codex, Cursor                      |

**INFERENCE:** the separation is clean on paper. The residue — "judge whether an architectural or model choice is economically justified" — is genuinely distinct from all nine. That is the strongest thing that can be said for this track, and it is a definitional observation rather than evidence of an opportunity.

## The static half is occupied

**VERIFIED.** The AWS `deploy-on-aws` plugin's step 1 is "**Scan your codebase** for framework, database, and dependencies", followed by "Select optimal AWS services with concise rationale" and "Show projected monthly cost before committing" ([AWS blog](https://aws.amazon.com/blogs/developer/introducing-agent-plugins-for-aws/)).

**VERIFIED** community skills cover "reviewing architecture for Well-Architected best practices... checking infrastructure costs... and comparing infrastructure options like ECS vs EKS" ([aws-skills](https://github.com/zxkane/aws-skills)) — a 34-skill toolkit with architecture-review sub-agents, free, inside Claude Code.

**VERIFIED** from doc 06: repository architecture reconstruction is served by CodeBoarding, DeepRepo, NodeScope, Graphist, CodeArchy; AI-specific static cost scanning by PromptScan (which has a PR cost-delta GitHub Action, MIT, **0 stars**); modernization by AWS Transform, vFunction, Moderne, CAST.

## The half that would add value is structurally blocked

This is the decisive finding, and it was established before this phase began.

**VERIFIED** from [`../01-product-evolution.md`](../01-product-evolution.md): _"source code alone generally cannot reveal monthly traffic, real output length, retry behavior, cache-hit rate, concurrency, quality requirements, or hardware utilization."_

**INFERENCE:** therefore the interesting half of Track D — "unnecessarily expensive" and "shows migration consequences" — is not derivable from a repository. A repository can show that a flagship model is called at a given call site. It cannot show that the call site runs 40,000 times a month at a 70% cache-hit rate with a 12% retry rate, which is what determines whether the choice is expensive.

Without that, the output is a list of _suggestions_ with no magnitudes. **VERIFIED** that PromptScan already built precisely this — static AI cost estimates with a PR comment — and has **0 stars and 0 watchers** ([GitHub](https://github.com/joandino/promptscan)). That is the only available natural experiment on whether a static-only version has demand, and it is not encouraging.

### And the runtime half is owned

**VERIFIED** from doc 08: Braintrust converts production logs to datasets, replays them through changed configurations, reports estimated cost and token deltas per case with baseline diffs, pairs on identical inputs, and gates merges. Langfuse, Helicone, and Datadog hold the runtime cost data. Finout, Vantage, and CloudZero hold the invoices (Track B).

**INFERENCE:** so Track D is caught in a vice. The static half is free inside Claude Code. The runtime half requires data access that observability vendors already have and that ANVILMARK would have to obtain from scratch — assumption A1, which remains **UNTESTED and unvalidated** after two phases and zero customer contact.

## The one genuinely open sliver

**INFERENCE:** vendor-neutral _model and provider_ choice with migration consequences is not well served. AWS is conflicted (it recommends Bedrock). Braintrust measures but does not recommend. Routing products execute rather than advise.

But: this is a subset of the model-choice job already killed in doc 06 as W4 (3/10 differentiation, Archcore occupying the decision-record half); it still requires runtime data to state consequences; and **INFERENCE** it is achievable as a Claude Code skill by anyone, which is what the 34-skill AWS toolkit demonstrates the ecosystem does routinely.

## Buyer and decision point

|                    |                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Buyer**          | Same as W2's Segment A — small AI product teams. **UNKNOWN** whether they feel this; **zero customers contacted across all phases.**                                     |
| **Decision point** | Diffuse. Unlike merge time, "should we reconsider this choice?" has no scheduled moment. **INFERENCE:** this is worse than W2, which at least had a real decision point. |
| **Provability**    | Weak without runtime data; with runtime data, it is W2, which is stopped.                                                                                                |

## Score

| Criterion                                  | Weight | Score |   Weighted   |
| ------------------------------------------ | :----: | :---: | :----------: |
| Urgency                                    |   ×2   |   4   |      8       |
| Differentiation vs a practical combination |   ×3   |   3   |      9       |
| Absorption resistance                      |   ×3   |   2   |      6       |
| Buyer and decision point                   |   ×2   |   3   |      6       |
| Provability                                |   ×2   |   3   |      6       |
| Validatable without a platform             |   ×1   |   6   |      6       |
| Relation to original vision                |   ×1   |   9   |      9       |
| **Total**                                  |        |       | **50 / 140** |

## Verdict: KILLED

**Fatal facts, two of them:**

1. The static half is delivered free inside Claude Code by AWS's open-source plugin and the surrounding skills ecosystem, with live pricing.
2. The half that would create value **requires runtime and billing data by construction** — which returns to the ground occupied by Braintrust, Langfuse, Helicone, and the FinOps platforms, and which depends on a data-access assumption that has never been tested.

**INFERENCE, answering the brief's question directly:** repository evidence alone is **not sufficient**, and it is not a close call. The one natural experiment available — PromptScan, free, MIT, functional, zero adoption — is the clearest available evidence that a static-only repository cost audit is not a product anyone wants.
