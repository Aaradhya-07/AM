# Anvilmark project tracker

Updated: 2026-10-17
Status: Active planning and implementation

## Product direction

**Main goal:** help a developer keep architecture, AI-assisted coding tasks, agent/model choices, runs, checks, reviews, and cost in one project record. Recommend an eligible setup for each task under the user's restrictions and learn from comparable accepted work.

The user supplies the intelligence; Anvilmark owns the contract, evidence rules, comparison, and conformance checks. The CLI, website, and MCP are ways to use that workflow. Their final roles and priority are not decided by this tracker.

On 2026-10-17 the development-model direction became the primary product direction in the [canonical brief](ANVILMARK-CANONICAL-BRIEF.md). The local CLI pilot is documented in the [development plan](docs/vnext/10-node-development-provenance-plan.md) and [observation record](docs/vnext/development-pilot-observation-2026-10-16.md). The earlier application-model contract remains supported but is a separate decision subject. No measured cost saving or quality advantage has yet been established.

The primary end-to-end path is:

1. Start from an idea or an existing repository.
2. Capture restrictions and architecture decisions; break the work into bounded tasks with acceptance checks.
3. Compare eligible coding-agent setups using dated public evidence and comparable local outcomes; show unknowns and billing basis.
4. Approve an exact task plan, run the chosen agent, and record the model identity reported by the tool, usage, code change, and checks.
5. Review the result, record acceptance or rejection, and use that outcome in later comparisons.
6. Continue the existing application-model and conformance workflow when the project calls for it.

**Next acceptance gate:** one real, human-reviewed task in an existing repository, followed by comparable runs for two setups. The local evidence index and selector can organize this evidence, but synthetic runs cannot establish quality or savings.

## Current reality

| Area                                 | Current state                                                                                                                                                         | Next gap                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Project contract and approval        | Implemented in the local CLI                                                                                                                                          | Prove the full path with a real user project and actual approval                                             |
| Development evidence and selection   | Experimental local task-profile and outcome index; `development recommend` compares eligible Codex CLI setups with exact-profile local runs                           | Real reviewed tasks, broader restrictions, source-backed public mappings, and calibrated forecasts           |
| Idea and candidate workflow          | CLI input, handoff, compatible-endpoint adapter, and live Hugging Face/Artificial Analysis research commands exist                                                    | Normalized catalog, source-backed restrictions, and workload-specific evaluations                            |
| Architecture and agent context       | Contract-backed views, eight read-only MCP tools, and opt-in source-cited draft, candidate proposal, public model research, and comparison tools exist                | Broader model mapping, agent-led architecture and review; record an implementation using the signed revision |
| Repository discovery and conformance | Bounded TypeScript/JavaScript scanner and provider/data-flow checks exist                                                                                             | Broader coverage and evidence from real implementation changes                                               |
| Hardware planning                    | Inventory and limited pinned-model sizing exist                                                                                                                       | Wider profiles and measured runtime evidence                                                                 |
| Website                              | Guided draft editor with architecture paths, sourced model starters, and candidate comparison at `/demo`; Studio bundle viewer, playground, and early dashboard exist | Connect measured evidence and the approved local project workflow without misrepresenting unknowns           |
| Hosted sync                          | CLI telemetry push and a runs API exist                                                                                                                               | Accurate status semantics, product-scope decision, and end-to-end validation                                 |
| Distribution                         | Setup/workshop and npm packaging scripts exist                                                                                                                        | Clean install and release verification for the chosen delivery path                                          |

The historical `packages/engine` audit remains a fixture-backed scaffold. The project contract and conformance packages are the active core. Recorded benchmark evidence covers eight public TypeScript/JavaScript repositories; it is not a general accuracy guarantee. Milestone 7's real human approval and actual agent-consumption acceptance remain open.

## Work phases

Status key: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED`.

| Phase                           | Status      | Outcome / acceptance gate                                                                                                                        |
| ------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Establish a real baseline    | IN PROGRESS | Review and run one actual architecture-linked coding task with a clean baseline, then compare two agent/model setups and their reviewed outcomes |
| 1. Improve decisions            | IN PROGRESS | Map restrictions and source-scoped coding evidence to setups; estimate effective cost from comparable accepted work with visible unknowns        |
| 2. Strengthen verification      | TODO        | Validate model switches, subagents, human edits, checks, billing, and review standing across supported agent modes                               |
| 3. Shape the product experience | IN PROGRESS | Bring architecture, tasks, recommendations, agent runs, checks, reviews, and cost into one usable project view                                   |
| 4. Release and maintain         | TODO        | Verify clean installation, packaging, supported environments, and repeatable evidence refresh                                                    |

## Active item: development-model evidence and selection

The development pilot now has a separate local SQLite outcome index keyed by architecture part, task kind, language set, risk, configured agent, and model. `anvilmark development recommend` applies the plan's current model and cash-budget restrictions, shows exact-profile accepted/rejected/failed run counts, and can show a descriptive sample cost per accepted task for comparable API-rate runs. A candidate may explicitly map a source-scoped public model ID to a dated model-catalog snapshot; this remains research evidence, not a task-quality gate. The outcome index is rebuilt from archived plans and run/review records; missing prior approval and invalid review hashes do not become accepted evidence. This is an experimental local decision aid, not a calibrated quality model or measured savings. The immediate gap is a real task with prior human plan approval and review, then comparable alternative runs.

## Existing application-model evidence

The AM browser editor now starts empty, offers an optional sample, guides a user through a draft data-flow path, and provides four source-linked model starting points. It validates draft shape locally and exports a CLI-importable JSON contract. A read-only website lookup can show published Hugging Face evaluations for an exact model ID, with source and retrieval time; the broader quality catalog is not yet connected, and no candidate is approved. Deployment and MCP handoff: [AM demo guide](docs/AM-DEMO-DEPLOY.md).

The current slice has live, read-only Hugging Face benchmark research, an optional Artificial Analysis model catalog, and a local SQLite snapshot catalog with manual refresh, history, and freshness labels. They expose source links, retrieval dates, response hashes, score verification where available, and coverage limits. Scheduled polling, reviewed requirement-to-benchmark mappings, and contract integration remain next steps. Details: [model quality source plan](docs/vnext/model-quality-sources.md).

The opt-in agent path now has draft intake, candidate proposal, public model research, and comparison: `anvilmark-project-mcp --agent-assessment` can create or extend a draft from an agent-submitted prompt, workload, and exact citations to local decision documents. It records citation hashes and conflicting submitted claims as questions. An agent can record candidates as unverified suggestions, fetch published Hugging Face evaluations for an exact model ID into a local dated catalog snapshot, and compare candidate constraint standings, public research, and evidence gaps from the same contract. Public scores never clear a workload quality gate. No tool selects a winner or signs a decision. ADR discovery, semantic extraction, broader source-backed model mapping, architecture proposals, and human review through the agent flow remain open. See [agent-first decision flow](docs/vnext/agent-first-decision-flow.md).

- [x] Verify a current benchmark data source and fetch actual published results.
- [x] Add a broader independent model catalog source with clear access and licensing limits (Artificial Analysis Free API; key required, internal use only).
- [x] Store source snapshots and source-scoped model identities locally with freshness, source, and version history.
- [ ] Refresh selected source feeds on a schedule with rate-limit handling and visible failures.
- [ ] Map candidate models, deployment offers, and constraints to source facts with explicit unknowns.
- [ ] Add workload-specific evaluations before any hard quality gate can pass.
- [ ] Demonstrate a sourced comparison for at least two real candidates.

## Existing application-model workflow acceptance

The earlier [contract-to-model-decision demo plan](docs/vnext/demo-model-decision-2026-10-14.md) remains the end-to-end acceptance target. The live evidence source is a first step toward that target.

- [ ] Select one real AI-enabled project and record its starting idea/repository, workloads, constraints, and expected outcome.
- [ ] Run the existing Anvilmark workflow without synthetic approval or fixture evidence.
- [ ] Record which decisions are supported by current evidence and which remain unknown or require manual work.
- [ ] Have the chosen coding agent consume the approved contract and make one implementation change.
- [ ] Run conformance, including one deliberate violation and correction, and record the observed result.
- [ ] Turn the observed gaps into the ordered Phase 1 work list.

## Decision log

| Date       | Decision                                                                                    | Reason / follow-up                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-17 | Make development-model selection and the connected AI-assisted development record primary.  | Project owner clarified the two goals: restriction-aware model choice with lower effective cost, and one place for architecture through reviewed implementation. The application-model contract remains separate.    |
| 2026-10-07 | No interface priority decided. Focus the next work on a real end-to-end product baseline.   | Website/MCP architecture is a later product-experience decision, informed by where the core workflow succeeds or fails.                                                                                              |
| 2026-10-14 | Build the model evidence catalog as a separate package/service boundary in this repository. | Begin with a local read catalog and source adapters; deploy a shared database and refresh worker when website/MCP use requires them. Revisit a separate repository only if operations or release ownership diverges. |
| 2026-10-14 | Make browser draft creation and candidate comparison the first AM site demo.                | Keep draft export local in the browser, send it through the full CLI validator on import, and leave approval and MCP reads in the local workflow. Live evidence integration is still open.                           |

## Evidence and constraints

- Product direction: [canonical brief](ANVILMARK-CANONICAL-BRIEF.md).
- Current implementation and scope: [README](README.md), [CLI](packages/cli/README.md), [MCP](packages/mcp/README.md), [conformance](packages/conformance/README.md), [hardware sizing](packages/hardware-sizing/README.md).
- Acceptance gap: [Milestone 7 onboarding record](docs/vnext/milestones/07-onboarding-record.md).
- Scanner benchmark: [September 20 record](benchmarks/real-repos/results/2026-09-20-2d5001fc.md).
- Interface exploration only: [website and MCP note](docs/vnext/website-mcp-product-path.md). This is not the active phase or an approved architecture.

Update this file as work is completed. A phase is `DONE` only when its acceptance gate has been demonstrated, not merely when code is present.
