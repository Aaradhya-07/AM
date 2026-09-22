# Anvilmark

Anvilmark is being shaped as a free, local-first, vendor-neutral decision and conformance layer around user-supplied intelligence. It is intended to turn an idea or repository plus explicit constraints into an evidence-backed architecture, model, and deployment contract, provide that contract to Claude Code, Codex, or another user-selected agent, and verify the resulting implementation.

Read [`ANVILMARK-CANONICAL-BRIEF.md`](ANVILMARK-CANONICAL-BRIEF.md) first. It is the current product and engineering direction.

## Packages

- `packages/project-contract` — the project contract (`0.1.0-draft.5`): schema, validation, evidence floors, decision resolution, approval hashing, architecture provenance and declared interfaces.
- `packages/hardware-sizing` — pure, browser-safe memory estimates and reproducible planning artifacts for pinned dense/MoE profiles.
- `packages/adapters` — evidence adapters (promptfoo, llmfit, manual import) and the provider-neutral intelligence interface with its two mechanisms.
- `packages/cli` — the `anvilmark` command: the local idea-to-contract workflow, interactive approval, architecture editing and confirmation, and generated views.
- `packages/scanner` — bounded TypeScript/JavaScript repository observations and declared source/sink/sanitizer mappings.
- `packages/conformance` — independent provider/model and data-flow verdicts with fresh input checks and local source evidence.
- `packages/context` — shared project facts, deterministic Mermaid/CALM/agent context, safe projections and freshness checks.
- `packages/contract` — frozen Zod schemas, inferred TypeScript types, and validated fixture loading.
- `packages/engine` — the recommendation-engine boundary, rule stubs, and pricing-provider stub.
- `packages/mcp` — the read-only project server with five context and three conformance tools, plus the preserved historical audit server with three placeholder tools.
- `packages/web` — hardware sizing playground, real Atlas code-to-contract checks, and Studio review-bundle inspection.
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

The historical cost-audit scaffold and `packages/contract` version `0.1.0` remain separate from the implemented project contract at `0.1.0-draft.5`. The original August 20, 2026 ratification was acknowledged by Anurag, Navaneeth and Aaradhya. Later amendments were accepted by Anurag under separate, decision-specific exceptions: amendments 1–4 in [document 07](docs/vnext/07-schema-amendment-proposal.md), amendments 6–7 and M3 scope in [document 08](docs/vnext/08-milestone-3-scope-proposal.md), and amendments 8–9 and M4 interpretations in [document 09](docs/vnext/09-milestone-4-architecture-amendment-proposal.md). No later approval is attributed to the other two. Amendment 5 and structured evidence requests remain deferred.

Milestones 1–6 are reviewed and merged. The M6 corrections were pushed to `main` at `078fcb58`; see the [verification record](docs/vnext/milestones/06-correction-record.md). M7 installation, onboarding and workflow tooling are implemented, verified and merged into `main`. Real-project approval and actual agent consumption remain separate acceptance work; full M7 acceptance is still open. Start with [`QUICKSTART.md`](QUICKSTART.md), the [guided Atlas workshop](docs/vnext/milestones/07-guided-workshop.md), or the [M7 record](docs/vnext/milestones/07-onboarding-record.md).

## Quickstart

The reproduced onboarding path uses Node.js 24 and pnpm 11.16.0. See [`QUICKSTART.md`](QUICKSTART.md) for full instructions.

```sh
node scripts/setup.mjs
node scripts/doctor.mjs
pnpm run workshop --help
```

### Run the offline Atlas replay

Run the automated eight-stage fixture replay:

```sh
pnpm demo:atlas
```

Use the local workflow (see [`packages/cli/README.md`](packages/cli/README.md) and the [replay walkthrough](docs/vnext/milestones/07-atlas-walkthrough.md)):

```sh
node packages/cli/bin/anvilmark.mjs help
```

Run the playground and open `/playground`:

```sh
pnpm dev:web
```

Verify MCP tool discovery and project server parity:

```sh
pnpm verify:mcp
pnpm verify:mcp-project
```

## The contract

`packages/contract` is frozen at schema version `0.1.0`. It is the interface between the engine and every consumer, allowing three developers to build in parallel without coordinating implementation details. Any schema change must be agreed by the full team and must bump `SCHEMA_VERSION`.

## Scope

The implemented local workflow covers decision contracts, evidence adapters, architecture views, read-only project context, and deterministic TypeScript/JavaScript repository scanning. `anvilmark inventory` reports what AI a repository uses without a project at all, and `anvilmark scan draft-config` drafts the declaration file a project needs. Bounded provider/model and declared data-flow conformance checks are implemented; their scope is described in [`packages/conformance/README.md`](packages/conformance/README.md). Hardware sizing, bounded local/SSH probing, explicit local evidence attachment, and per-device planning are implemented in the CLI, playground, and Studio; see [the supported scope](packages/hardware-sizing/README.md). Caller-supplied calibration remains advisory. Remote self-hosted attachment, multi-node/offload placement, and target benchmarking remain outside the supported profiles. The historical recommendation engine remains a scaffold. The project does not provide hosted intelligence, authentication or deployment; persistence remains in local `.anvilmark/` project files.
