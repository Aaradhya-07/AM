# Anvilmark

Anvilmark is being shaped as a free, local-first, vendor-neutral decision and conformance layer around user-supplied intelligence. It is intended to turn an idea or repository plus explicit constraints into an evidence-backed architecture, model, and deployment contract, provide that contract to Claude Code, Codex, or another user-selected agent, and verify the resulting implementation.

Read [`ANVILMARK-CANONICAL-BRIEF.md`](ANVILMARK-CANONICAL-BRIEF.md) first. It is the current product and engineering direction.

## Packages

- `packages/contract` — frozen Zod schemas, inferred TypeScript types, and validated fixture loading.
- `packages/engine` — the recommendation-engine boundary, rule stubs, and pricing-provider stub.
- `packages/mcp` — stdio MCP v2 server exposing the engine through three placeholder tools.
- `packages/web` — Next.js App Router placeholder that renders a validated audit fixture.
- `fixtures` — realistic `AuditResult` examples shared by tests, the engine stub, MCP, and web.
- `docs` — product context and briefs.

## Product direction and historical research

The current direction reopens ANVILMARK as a free engineering project that does not host or provide an intelligence model. The earlier commercial-startup thesis remains closed; it no longer prohibits work on the free project. See the [canonical brief](ANVILMARK-CANONICAL-BRIEF.md) for the exact distinction, boundaries, competitor conclusions, and next steps.

Current execution artifacts are the [shared benchmark](docs/vnext/01-shared-benchmark-scenario.md), [competitor hands-on matrix](docs/vnext/02-competitor-hands-on-matrix.md), [accepted decision-contract design](docs/vnext/03-decision-contract-proposal.md), [first vertical-slice build plan](docs/vnext/04-vertical-slice-build-plan.md), [detailed Milestone 0–7 handbook](docs/vnext/milestones/README.md), [ratification reasoning](docs/vnext/05-contract-ratification-answers.md), and [standing ratification decision](docs/vnext/06-contract-ratification-decision.md).

The [research archive](docs/research/README.md) preserves the full dated record of:

- the evolution of the product thesis;
- the competitor register as of August 2026;
- scenario-by-scenario market coverage;
- an audit of what this repository implements;
- the closure verdict and the evidence behind it.

This repository still contains a scaffold for the older AI cost-audit concept. `packages/contract` version `0.1.0` remains unchanged as a historical interface, and no real recommendation logic has yet been implemented. The ratified design places the new project contract in `packages/project-contract` at `0.1.0-draft.1`. Anurag, Navaneeth, and Aaradhya accepted the standing decision on August 20, 2026, so Milestone 1 implementation is authorized.

## Setup

Requires Node.js 20 or newer and pnpm.

```sh
pnpm install
pnpm build
pnpm test
```

Run the placeholder web app:

```sh
pnpm dev:web
```

Verify MCP tool discovery after building:

```sh
pnpm verify:mcp
```

## The contract

`packages/contract` is frozen at schema version `0.1.0`. It is the interface between the engine and every consumer, allowing three developers to build in parallel without coordinating implementation details. Any schema change must be agreed by the full team and must bump `SCHEMA_VERSION`.

## Scope

This repository contains scaffolding, types, fixtures, and explicit stubs only. It does not contain recommendation algorithms, real cost calculations, network pricing fetches, authentication, persistence, deployment configuration, or a marketing landing page.
# AM
