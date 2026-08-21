# Current Repository Audit

Audit date: **August 9, 2026**

## Executive assessment

The repository is a clean, contract-first MVP scaffold. It builds and tests successfully, but the product's core discovery, recommendation, pricing, evaluation, and conformance logic is not implemented.

The most accurate description is:

> The chassis and demo contract exist; the decision engine does not.

## Implemented

### Workspace structure

- pnpm monorepo;
- shared TypeScript configuration and quality tooling;
- `packages/contract`;
- `packages/engine`;
- `packages/mcp`;
- `packages/web`;
- three realistic audit fixtures;
- brand assets for web, favicon, and PWA surfaces.

### Frozen contract `0.1.0`

The Zod contract contains:

- budget, deployment, privacy, and latency constraints;
- system component purpose, model, token/call usage, async status, and source location;
- model-choice, self-host, and token-efficiency finding categories;
- current/projected cost, expected savings, confidence, and tokenizer type;
- aggregate audit totals and generation metadata.

### MCP surface

Three tools are registered:

- `audit_system`;
- `explain_finding`;
- `estimate_cost`.

The MCP server is structurally functional, but all results are fixture-backed.

### Web surface

The Next.js application renders fixture totals and findings as a static placeholder dashboard.

### Fixtures

| Fixture         | Findings | Current monthly USD | Projected monthly USD | Example savings USD |
| --------------- | -------: | ------------------: | --------------------: | ------------------: |
| SaaS support    |        3 |              18,450 |                 9,320 |               9,130 |
| Document review |        3 |              15,900 |                10,060 |               5,840 |
| Research agent  |        3 |              18,800 |                10,670 |               8,130 |

These are authored examples, not calculated production recommendations.

## Defined but not implemented

Five rule seams exist, but return no finding:

- missing prompt caching;
- unbounded reasoning effort;
- synchronous call in asynchronous context;
- missing maximum-token limit;
- flagship model used for a simple task.

A LiteLLM pricing-provider shape and source URL exist, but the loader does not fetch or return pricing data.

`runAudit()` ignores the supplied input and returns the SaaS support fixture.

## Not implemented

- repository discovery;
- AST or semantic parsing;
- provider/SDK detection;
- prompt extraction and cross-file resolution;
- actual rule execution;
- real tokenization;
- live pricing and price freshness;
- runtime telemetry ingestion;
- cost calculation and attribution;
- traffic/usage calibration;
- quality evaluation;
- safe model substitution;
- owned-hardware discovery and benchmarking;
- self-host TCO modeling;
- architecture graph generation;
- interactive architecture editing;
- design-to-code conformance;
- automatic patches or PR review;
- persistence, authentication, teams, or audit history;
- hosted production deployment;
- customer validation.

## Verification performed

The following passed on August 9, 2026:

- all four workspace test suites;
- ESLint;
- Prettier format check;
- MCP tool-list verification;
- TypeScript builds;
- production Next.js build.

This verifies scaffold integrity, not recommendation correctness.

## Repository history limitation

At the time of the audit, Git commands did not recognize the directory as a Git repository. Development chronology and commit provenance were therefore not verified. This note should be revisited if repository metadata is restored.

## Rough readiness

| Area                                   | Status                    |
| -------------------------------------- | ------------------------- |
| Product/brand artifacts                | Strong foundation         |
| Contract and package architecture      | Healthy scaffold          |
| Fixture-driven demonstration           | Working                   |
| Core audit/recommendation logic        | Essentially unimplemented |
| Reframed architecture-decision product | Not designed in code      |
| Production readiness                   | Not started               |
| Market validation                      | Not established           |

An approximate overall path-to-sellable-product estimate from the existing repository is **15–20%**, with the caveat that the product definition is changing and some existing contract work may need revision.
