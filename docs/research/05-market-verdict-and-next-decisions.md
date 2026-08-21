# Market Verdict and Next Decisions

## Final research verdict

### Original product

Do not continue with the original broad positioning:

> Scan any AI application and automatically tell it how to reduce cost, choose cheaper models, and decide whether to self-host.

Its major capabilities already exist independently or in combinations, and source-only monthly-dollar claims would often imply false precision.

### Reframed product

The combined lifecycle is not entirely owned by one public competitor:

> Design an evidence-backed, vendor-neutral architecture from intent; give it to any coding agent; then verify the repository and runtime against the approved architecture and economics.

This is a real remaining opening, but it is broad and surrounded by strong competitors. It is not yet a product definition suitable for implementation.

## What may be defensible

### Deterministic constraint model

ANVILMARK should explicitly model:

- budget;
- workload and concurrency;
- latency and availability;
- privacy, residency, and compliance;
- existing hardware;
- preferred and prohibited providers;
- team size and expertise;
- operational tolerance;
- required model capabilities and quality thresholds.

### Continuously refreshed option catalog

Each component or model option would need:

- capabilities;
- task fit;
- pricing;
- license;
- hardware requirements;
- operational complexity;
- security/privacy properties;
- benchmark and evaluation evidence;
- freshness and confidence.

### Living architecture decision graph

The graph, not a picture, must be authoritative. Each node and relationship should connect:

- intent and requirement;
- chosen component;
- rejected alternatives;
- rationale;
- evidence;
- assumptions;
- expected cost/performance ranges;
- acceptance tests;
- implementation files;
- runtime telemetry.

### Agent implementation contract

Coding agents should receive:

- approved components and boundaries;
- prohibited substitutions;
- decisions and trade-offs;
- required tests;
- infrastructure and deployment constraints;
- commands and verification steps.

### Conformance loop

ANVILMARK should detect when:

- the agent implemented a different architecture;
- a dependency crosses a prohibited boundary;
- a chosen model no longer meets cost or quality constraints;
- runtime behavior invalidates planning assumptions;
- a price, license, model, or provider change makes an earlier decision obsolete.

## Principal risks

- The product may be too broad for a small team.
- Architecture “optimality” is contextual and difficult to prove.
- Coding agents and cloud providers can absorb individual recommendations rapidly.
- Pricing, model catalogs, and benchmarks decay quickly.
- Generic leaderboards are insufficient for customer-specific quality.
- Repository analysis alone cannot establish runtime economics.
- A visual editor can become a large product before the decision engine is validated.
- Users may prefer direct implementation by their coding agent over a separate planning product.
- The most valuable buyer may be an engineering team with governance needs, not the novice founder originally imagined.

## Decisions required before engineering resumes

### 1. Initial customer

Choose exactly one:

- non-technical founder designing a new AI application;
- solo technical founder using Codex/Claude Code;
- small AI product team controlling model cost and architecture drift;
- platform/architecture team governing multiple coding agents;
- consultancy producing repeatable architecture recommendations.

The jobs, budgets, trust requirements, and competitors differ radically.

### 2. Initial wedge

Candidate wedges include:

1. **Architecture contract for coding agents**  
   Turn an approved design into machine-readable constraints and block architectural drift.

2. **Runtime-calibrated AI PR review**  
   Connect production usage and task evaluations to the exact cost and quality consequence of a code change.

3. **Owned-hardware AI architecture planner**  
   Decide whether a planned workload should use existing local compute, a managed open model, or a proprietary API.

4. **Vendor-neutral AI component decision record**  
   Maintain continuously refreshed, evidence-backed decisions for every AI component in an application.

5. **Intent-to-implementation conformance**  
   Compare the approved architecture graph with what a coding agent actually produced.

### 3. Proof standard

Define what “optimal” means. A credible system may optimize only against declared objectives and constraints rather than claim a universally optimal architecture.

### 4. Delivery surface

Decide whether the first product is:

- a Claude Code/Codex plugin;
- an MCP server;
- a CLI and CI check;
- a web architecture workspace;
- or a paired plugin plus web graph.

A web canvas is not automatically required for the first validation.

## Recommended validation sequence

1. Conduct 12–15 interviews within one chosen customer segment.
2. Ask interviewees to show a recent real architecture/model/deployment decision rather than discuss hypothetical interest.
3. Reproduce their decision manually using an evidence-backed ANVILMARK report.
4. Test whether they trust the result enough to change an architecture or merge a PR.
5. Ask for a paid design partnership before building the full engine.
6. Run hands-on comparisons against the Tier 1 competitors using the same two or three application scenarios.
7. Implement only the repeated decision that current tools fail to support.

## Suggested kill criteria

Stop or radically narrow the project if:

- fewer than 5 of 15 target users experienced the chosen problem recently;
- users solve it adequately with their coding agent plus existing tools;
- users will not provide the runtime/evaluation data required for trustworthy decisions;
- no design partner will pay or commit engineering time;
- the first useful output depends on implementing the entire proposed platform;
- recommendations cannot be verified against a measurable outcome.

## Current recommendation

Pause further work on the existing cost-auditor engine until the initial customer and wedge are selected. Preserve the scaffold, because its MCP boundary, contracts, fixtures, and web surface can be reused, but expect the contract to change once the new product is defined.
