# Anvilmark project tracker

Updated: 2026-10-14  
Status: Active planning and implementation

## Product direction

**Main goal:** prove that Anvilmark can take an idea or repository, use trustworthy evidence to make a useful architecture/model/deployment decision, and verify the resulting implementation against that decision.

The user supplies the intelligence; Anvilmark owns the contract, evidence rules, comparison, and conformance checks. The CLI, website, and MCP are ways to use that workflow. Their final roles and priority are not decided by this tracker.

The intended end-to-end path is:

1. Start from an idea or an existing repository.
2. Capture workloads, constraints, and unresolved questions.
3. Compare architecture, model, provider, and deployment candidates with cited, dated evidence and visible unknowns.
4. Review and approve one exact decision contract as a human action.
5. Give the approved contract to the chosen coding agent and implement the application.
6. Scan the repository and report bounded conformance results, source evidence, and drift.

## Current reality

| Area                                 | Current state                                                                                                           | Next gap                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Project contract and approval        | Implemented in the local CLI                                                                                            | Prove the full path with a real user project and actual approval                                  |
| Idea and candidate workflow          | CLI input, handoff, compatible-endpoint adapter, and live Hugging Face/Artificial Analysis research commands exist      | Normalized catalog, source-backed restrictions, and workload-specific evaluations                 |
| Architecture and agent context       | Contract-backed views and read-only MCP tools exist                                                                     | Record an agent implementation using the approved revision                                        |
| Repository discovery and conformance | Bounded TypeScript/JavaScript scanner and provider/data-flow checks exist                                               | Broader coverage and evidence from real implementation changes                                    |
| Hardware planning                    | Inventory and limited pinned-model sizing exist                                                                         | Wider profiles and measured runtime evidence                                                      |
| Website                              | Guided draft editor with architecture paths, sourced model starters, and candidate comparison at `/demo`; Studio bundle viewer, playground, and early dashboard exist | Connect measured evidence and the approved local project workflow without misrepresenting unknowns |
| Hosted sync                          | CLI telemetry push and a runs API exist                                                                                 | Accurate status semantics, product-scope decision, and end-to-end validation                      |
| Distribution                         | Setup/workshop and npm packaging scripts exist                                                                          | Clean install and release verification for the chosen delivery path                               |

The historical `packages/engine` audit remains a fixture-backed scaffold. The project contract and conformance packages are the active core. Recorded benchmark evidence covers eight public TypeScript/JavaScript repositories; it is not a general accuracy guarantee. Milestone 7's real human approval and actual agent-consumption acceptance remain open.

## Work phases

Status key: `TODO`, `IN PROGRESS`, `DONE`, `BLOCKED`.

| Phase                           | Status      | Outcome / acceptance gate                                                                                                                           |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Establish a real baseline    | IN PROGRESS | Run the current complete workflow on one real project; record actual evidence, approval, agent use, conformance, manual steps, and failures         |
| 1. Improve decisions            | IN PROGRESS | Maintained evidence sources, workload-specific quality checks, cost calculation, and managed/open/local alternatives meet explicit acceptance tests |
| 2. Strengthen verification      | TODO        | Expand repository/SDK coverage and validate conformance results against real changes without hiding unknowns                                        |
| 3. Shape the product experience | IN PROGRESS | Decide how the website, MCP, and CLI make the proven workflow easy to use; implement and validate the chosen path                                   |
| 4. Release and maintain         | TODO        | Clean installation, packaging, documentation, supported-environment tests, and repeatable evidence refresh pass                                     |

## Active item: model evidence for decisions

The AM browser editor now starts empty, offers an optional sample, guides a user through a draft data-flow path, and provides four source-linked model starting points. It validates draft shape locally and exports a CLI-importable JSON contract. A read-only website lookup can show published Hugging Face evaluations for an exact model ID, with source and retrieval time; the broader quality catalog is not yet connected, and no candidate is approved. Deployment and MCP handoff: [AM demo guide](docs/AM-DEMO-DEPLOY.md).

The current slice has live, read-only Hugging Face benchmark research, an optional Artificial Analysis model catalog, and a local SQLite snapshot catalog with manual refresh, history, and freshness labels. They expose source links, retrieval dates, response hashes, score verification where available, and coverage limits. Scheduled polling, reviewed requirement-to-benchmark mappings, and contract integration remain next steps. Details: [model quality source plan](docs/vnext/model-quality-sources.md).

- [x] Verify a current benchmark data source and fetch actual published results.
- [x] Add a broader independent model catalog source with clear access and licensing limits (Artificial Analysis Free API; key required, internal use only).
- [x] Store source snapshots and source-scoped model identities locally with freshness, source, and version history.
- [ ] Refresh selected source feeds on a schedule with rate-limit handling and visible failures.
- [ ] Map candidate models, deployment offers, and constraints to source facts with explicit unknowns.
- [ ] Add workload-specific evaluations before any hard quality gate can pass.
- [ ] Demonstrate a sourced comparison for at least two real candidates.

## Baseline workflow acceptance

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
