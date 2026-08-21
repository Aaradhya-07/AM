# Track C — Architecture Planning for New Applications

Research date: **August 13, 2026**
Verdict: **KILLED** — the workflow ships inside Claude Code, free, from the cloud vendor.

> **PARTIALLY SUPERSEDED — August 13, 2026.** The fatal fact **failed** — `deploy-on-aws` requires an existing codebase and covers ~2 of 11 sub-steps. **Corrected to RESEARCHABLE.** See [`08-adversarial-verification.md`](08-adversarial-verification.md) and [`09-corrected-final-verdict.md`](09-corrected-final-verdict.md). Preserved unchanged as a dated record.

## The scenario, evaluated exactly as written

> "A founder has an application idea but no architectural direction. The system asks for constraints, considers managed APIs versus open-source/self-hosted models, considers available compute, produces an evidence-backed architecture diagram, and lets the founder question and revise decisions through Claude Code or Codex."

## The finding that kills it

**VERIFIED.** AWS open-sourced the `deploy-on-aws` plugin for Claude Code in **March 2026**. It delivers a five-step workflow inside the coding agent:

| Step | Capability (quoted)                                                               |
| :--: | --------------------------------------------------------------------------------- |
|  1   | **Analysis** — "Scan your codebase for framework, database, and dependencies"     |
|  2   | **Recommendations** — "Select optimal AWS services with concise rationale"        |
|  3   | **Cost Estimation** — "Show projected monthly cost before committing"             |
|  4   | **Infrastructure Generation** — "Write CDK or CloudFormation infrastructure code" |
|  5   | **Deployment** — "Execute your confirmation"                                      |

Backed by three MCP servers: `awsknowledge` (architecture guidance and validation), `awspricing` (**real-time service pricing**), `awsiac` (IaC standards).

Sources: [AWS blog](https://aws.amazon.com/blogs/developer/introducing-agent-plugins-for-aws/), [Claude plugin directory](https://claude.com/plugins/deploy-on-aws), [guide](https://claudelab.net/en/articles/claude-code/claude-code-aws-deploy-plugin-guide).

Available through both the Claude Code and Cursor plugin marketplaces. **VERIFIED open source.**

**This is steps 1, 2, 3, 6, and 7 of the proposed scenario — constraints in, recommendation with rationale, costed, revisable conversationally — delivered inside the exact coding agent ANVILMARK proposed to supply.**

### The community ecosystem is deeper still

**VERIFIED:** an AWS skills toolkit ships "34 skills, 11 sub-agents, and 3 MCP servers for building, migrating, and performing **architecture reviews**" ([aws-skills](https://github.com/zxkane/aws-skills)), and AWS publishes a startup-tailored plugin marketplace ([aws-samples](https://github.com/aws-samples/sample-claude-code-plugins-for-startups)). Skills cover "reviewing architecture for Well-Architected best practices... checking infrastructure costs, auditing Terraform for security issues, and **comparing infrastructure options like ECS vs EKS**."

## The practical competitive combination

Per the combination rule, this is what a founder can assemble today at zero or near-zero cost:

```text
Claude Code or Codex                        (conversational revision — the entry point)
  + deploy-on-aws plugin                    (analysis, recommendation, live pricing, IaC, deploy)
  + awspricing MCP                          (real-time cost)
  + any diagram tool (Mermaid, Eraser, D2)  (the picture)
  + ModelFit / apxml / llmfit.io            (open-model hardware fit — free, VERIFIED in doc 06)
```

**INFERENCE:** this covers the scenario end to end. The founder never leaves the agent, the cost numbers are live from the vendor, and the whole stack is free.

## What ANVILMARK's version would add

Exactly two things, and neither survives scrutiny.

### 1. Vendor neutrality

AWS recommends AWS. **INFERENCE:** that is a genuine conflict of interest and the most defensible criticism of the incumbent solution.

But this was already tested and answered in [`../06-runtime-calibrated-pr-review-recommendation.md`](../06-runtime-calibrated-pr-review-recommendation.md) §3.4: neutrality obligates continuous maintenance of a catalogue spanning every provider, model, price, licence, and hardware SKU, all decaying weekly. **That is operating expense, not moat.** The archive concedes it directly: _"pricing, model catalogs, and benchmarks decay quickly."_

**INFERENCE:** Google and Microsoft have every incentive to ship equivalent plugins, at which point a founder can consult three vendor plugins and triangulate — a practical combination that erodes the neutrality argument without anyone building a neutral product.

### 2. Open-model and owned-hardware selection

**VERIFIED** from doc 06: at least six free calculators own this — [ModelFit](https://modelfit.io/calculator/), [apxml](https://apxml.com/tools/vram-calculator) (v3.0 added a setup planner with throughput and cost trade-offs), [llmfit.io](https://llmfit.io/), and others. Scored 2/10 on differentiation and 2/10 on revenue in doc 06 and killed there.

## The buyer problem, restated

**INFERENCE**, and this is independent of the competitive finding: the non-technical founder was eliminated as a customer segment in doc 06 §4 for reasons that still hold — no runtime data, no budget, and, critically, **unable to evaluate the advice and therefore unable to confirm or refute it**. A customer who cannot tell whether the output is right is the worst possible design partner for a system whose entire claim is that its output is right.

Track C's scenario is written for exactly that customer.

## Score

| Criterion                                  | Weight | Score |   Weighted   |
| ------------------------------------------ | :----: | :---: | :----------: |
| Urgency                                    |   ×2   |   4   |      8       |
| Differentiation vs a practical combination |   ×3   |   1   |      3       |
| Absorption resistance                      |   ×3   |   1   |      3       |
| Buyer and decision point                   |   ×2   |   2   |      4       |
| Provability                                |   ×2   |   2   |      4       |
| Validatable without a platform             |   ×1   |   5   |      5       |
| Relation to original vision                |   ×1   |  10   |      10      |
| **Total**                                  |        |       | **37 / 140** |

Provability is 2: "was this architecture optimal?" resolves in 6–18 months, confounded by every other decision — the objection raised in doc 06 §3.5 and never answered.

The highest score on the sheet is **relation to the original vision, at 10/10**. That is precisely the trap this phase was designed to avoid: the track scoring worst overall is the one closest to the founding idea.

## Verdict: KILLED

**Fatal fact:** the workflow ships free, open-source, inside Claude Code and Cursor, from a cloud vendor with live pricing data, as of March 2026. The remaining differentiators — vendor neutrality and open-model selection — were each independently evaluated and killed in earlier phases, and no evidence found here revives either.

**INFERENCE:** the honest answer to the question the brief posed — _does the complete workflow have value beyond combining Claude/Codex with existing architecture-diagram and cloud-calculator tools?_ — is **no**. The combination is not merely adequate; it is better resourced, better integrated, and free.
