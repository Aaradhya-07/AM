# Product Evolution

## Stage 1: Original thesis

The repository began as an explainable AI-system cost auditor. Its intended findings were:

- expensive model tiers used for simple work;
- opportunities to self-host;
- prompt and token inefficiencies;
- missing prompt caching;
- unbounded reasoning effort;
- synchronous calls in asynchronous contexts;
- missing output-token limits.

The proposed output included code locations, estimated current and projected monthly cost, savings, confidence, and tokenizer accuracy.

## What competitive research changed

The original competitive set—Helicone, Langfuse, Braintrust, Baseten, Portkey, and OpenRouter—was directionally useful but incomplete.

Research found that the original thesis sits at the intersection of already-populated categories:

- source-level AI cost scanning;
- LLM observability and cost attribution;
- evaluation-driven model substitution;
- gateways and model routers;
- AI FinOps;
- prompt/token optimization;
- local-model hardware planning;
- inference hosting.

[PromptScan](https://github.com/joandino/promptscan) is the closest public implementation of the pre-deployment source scanner. It statically finds AI calls and prompts, estimates input tokens and cost, detects caching and context issues, and supports editor and CI workflows.

The research also established a measurement boundary: source code alone generally cannot reveal monthly traffic, real output length, retry behavior, cache-hit rate, concurrency, quality requirements, or hardware utilization. Therefore, precise monthly savings and self-host recommendations require measured runtime evidence and explicit user assumptions.

## Stage 2: Reframed user scenarios

The project was then reframed around two larger jobs.

### Scenario A: Start from an idea

A user has an application idea but little technical direction. ANVILMARK would:

1. interview the user;
2. capture functional requirements and constraints;
3. recommend an application architecture;
4. consider managed services, open source, proprietary models, open models, and existing hardware;
5. provide an editable visual architecture;
6. explain decisions and alternatives;
7. supply the approved knowledge to Claude Code, Codex, or another coding agent;
8. let that coding agent perform implementation.

### Scenario B: Audit an existing repository

ANVILMARK would:

1. reconstruct the repository's current architecture;
2. locate inefficiencies and replaceable components;
3. combine source findings with runtime evidence;
4. show an improved target architecture;
5. have the user approve changes;
6. provide a migration contract to a coding agent;
7. verify the resulting repository and runtime.

## Competitive correction after reframing

Scenario A is also heavily competed:

- [Archie](https://docs.archie-ai.com/) expands ideas into specifications, design, architecture, and application artifacts.
- [BackArch](https://www.backarch.com/) offers a constraint-aware visual architecture canvas with cost and architecture health.
- [ArchGenie](https://archgenie.io/) goes from description or sketch to multi-cloud diagrams, infrastructure code, security, cost, observability, and repository export.
- [AWS Agent Plugins](https://aws.amazon.com/blogs/developer/introducing-agent-plugins-for-aws/) give Claude Code and Cursor architecture guidance, live AWS pricing, infrastructure generation, and deployment.
- [GitHub Spec Kit](https://github.github.io/spec-kit/) and [BMAD](https://docs.bmad-method.org/) guide coding agents from intent through specification, planning, implementation, and review.

Scenario B is served by multiple categories:

- [AWS Transform](https://docs.aws.amazon.com/transform/latest/userguide/continuous-modernization.html) analyzes and remediates repositories.
- [CodeBoarding](https://www.codeboarding.org/), [DeepRepo](https://deeprepo.dev/), and [NodeScope](https://www.nodescope.dev/) reconstruct repository architecture.
- [ArchRails](https://www.archrails.io/), [GovForge](https://govforge.dev/en/), and [Qodo](https://www.qodo.ai/) enforce architectural or organizational rules around agent-generated code.
- PromptScan, AI Architecture Scanner, CostCanary, and LLM Tracer cover AI-specific source and runtime economics.

## Current candidate definition

The broadest defensible formulation found so far is:

> ANVILMARK is the authoritative, vendor-neutral architecture and economics graph that coding agents consult before building and must satisfy after building.

Its potential lifecycle is:

```text
intent and constraints
        ↓
evidence-backed option evaluation
        ↓
approved architecture decision graph
        ↓
coding-agent implementation contract
        ↓
actual repository and infrastructure
        ↓
runtime cost, quality, and performance evidence
        ↓
conformance, drift, and revised decisions
```

## What ANVILMARK must not become

- another general-purpose AI app builder;
- another architecture image generator;
- another static Markdown knowledge pack;
- another LLM observability dashboard;
- another generic code-review agent;
- another prompt-token counter;
- another model leaderboard;
- a wrapper that merely combines public APIs without a unique decision model.

## Status

The current definition is not yet validated with customers. The next step is choosing a narrow initial customer and wedge, not implementing the entire lifecycle.
