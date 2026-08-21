# Anvilmark — AI Cost Optimizer Master Brief

> Context recovery note: the referenced attachment was not available at `/mnt/data/ai-cost-optimizer-master-brief.md` in this local task. This document preserves the actionable product context supplied with the scaffold request so the repository remains self-contained. Replace it with the source attachment verbatim if that file becomes available.

## Product thesis

Anvilmark is an explainable AI-system cost auditor. It describes an existing system as components, combines usage information with budget, deployment, privacy, and latency constraints, and returns prioritized opportunities to reduce spend without hiding the trade-offs.

The MVP focuses on three finding categories:

- `model-choice` — a workload may not need its current model tier.
- `self-host` — a workload may suit an on-premises or hybrid alternative.
- `token-efficiency` — implementation choices may be wasting input, output, or reasoning tokens.

Every finding carries source location, current and projected monthly cost, expected savings, confidence, and tokenizer accuracy. The product must distinguish native token counts from approximations.

## Contract-first architecture

The Zod contract is the interface between the recommendation engine, MCP server, and web experience. It is frozen at `0.1.0` so three developers can work independently. Real-shaped fixtures unblock every surface before engine implementation exists.

## Initial detection-rule seams

- Missing prompt caching
- Unbounded reasoning effort
- Synchronous calls in asynchronous contexts
- Missing maximum-token limits
- Flagship models used for simple tasks

The initial codebase defines these rules only as typed stubs. It must not make real recommendations yet.

## Pricing seam

Future pricing data will use LiteLLM's public catalog:

`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`

The scaffold defines the provider shape but performs no network request or cost calculation.

## Product surfaces

- A local stdio MCP server using the stable TypeScript SDK v2 line and the 2026-07-28 protocol generation.
- A Next.js web application that first proves the frozen contract end to end by rendering fixtures.
- A restrained industrial visual system: graphite, steel, gold, sand, canvas, and load-bearing monospace typography.

The landing page, persistence, authentication, deployment, and production recommendation logic are outside this scaffold.
