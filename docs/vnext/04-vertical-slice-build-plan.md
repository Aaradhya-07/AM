# ANVILMARK First Vertical-Slice Build Plan

Date: **August 17, 2026**  
Status: **Engineering baseline ratified by all three developers in [`06-contract-ratification-decision.md`](06-contract-ratification-decision.md); implementation authorized**

## Outcome

Build one local-first demonstration of:

```text
Atlas Support Desk idea
        ↓
structured intent, workloads, constraints, and available hardware
        ↓
managed/open/local candidates with evidence gaps
        ↓
user-approved decision contract
        ↓
Claude Code or Codex implementation context
        ↓
TypeScript repository scan and deterministic conformance result
```

The slice succeeds when ANVILMARK detects a deliberately introduced raw-ticket remote-provider call that violates the approved privacy and provider decisions.

Detailed execution guides, diagrams, tests, exclusions, and exit checklists for Milestones 0–7 are indexed in [`milestones/README.md`](milestones/README.md). This document remains the authoritative summary for sequence and scope.

## Scope decisions for this slice

### Include

- local CLI;
- local project files under `.anvilmark/`;
- project contract `0.1.0-draft.1` in `packages/project-contract`;
- TypeScript/JavaScript repository analysis;
- generated Mermaid architecture;
- MCP read/context/check tools;
- Claude Code and Codex through the same MCP/file contract;
- user approval recorded locally;
- optional llmfit adapter for hardware-fit evidence;
- optional promptfoo adapter for evaluation evidence;
- generic OpenAI-compatible and local Ollama candidate descriptions;
- evidence provenance, unknown states, and freshness;
- deterministic provider allowlist and forbidden-data-flow rules.

### Exclude

- hosted ANVILMARK intelligence;
- accounts, teams, authentication, billing, or cloud persistence;
- editable visual canvas;
- production traffic routing;
- observability dashboard;
- automated deployment;
- broad cloud cost estimation;
- Python/Java/Go repository parsing;
- automatic model download;
- production telemetry ingestion;
- claims of finding an objectively optimal architecture.

## Technology recommendation

- retain the TypeScript/pnpm monorepo;
- keep `packages/contract` version `0.1.0` untouched;
- create a separate vNext contract namespace/package rather than replacing exports silently;
- use Zod for runtime validation and inferred TypeScript types;
- use YAML for the human-edited project contract and JSON for evidence/results;
- use Mermaid for the first generated view;
- keep files as persistence for the prototype;
- use MCP as the agent-neutral read/check surface;
- use deterministic TypeScript parsing for the benchmark repository before adding semantic LLM interpretation;
- export authoritative ANVILMARK architecture to FINOS CALM 1.2 and Mermaid.

No new dependency should be adopted until its license, maintenance, data flow, and reason for use are recorded.

---

## Milestone 0: Ratify the contract and standards boundary

Target: **2–3 working days**

Design deliverables are complete:

- answers to the ten ratification questions in [`03-decision-contract-proposal.md`](03-decision-contract-proposal.md);
- separate `packages/project-contract` decision;
- CALM spike representing the Atlas nodes, relationships, trust boundaries, and interfaces;
- explicit user-approval operation;
- agreed first MCP tool list;
- accepted benchmark fixture.

Exit criteria:

- all three developers approve the contract shape;
- no core field is tied to one provider, model, agent, cloud, or external tool;
- CALM is accepted as a generated export with a validated spike and written reason;
- the benchmark violation is representable as a rule.

Milestone 0 closed on August 20, 2026, when Anurag, Navaneeth, and Aaradhya accepted document 06 without amendments.

## Milestone 1: Contract package and fixture

Target: **Week 1**

Deliverables:

- `packages/project-contract` with schemas/types for project, constraints, workloads, evidence, candidates, decisions, approvals, bindings, and rules;
- parser/serializer for YAML and JSON artifacts;
- referential-integrity validation;
- Atlas fixture;
- explicit statement that the project schema is independent and has no migration from the historical audit contract;
- tests for invalid references, unknown evidence, approval hashes, and secret rejection.

Exit criteria:

- the Atlas fixture validates;
- editing an approved decision invalidates its approval;
- unknown evidence cannot satisfy a hard constraint;
- evidence floors distinguish target inventory, compatibility estimates, and measured performance;
- soft-constraint direction and user priority order are preserved;
- secrets are rejected from persistent fields;
- generated output is stable across repeated serialization.

## Milestone 2: Evidence and adapter boundaries

Target: **Weeks 2–3**

Deliverables:

- intelligence-adapter interface without a hosted default;
- evidence-adapter interface;
- llmfit subprocess adapter that records version, command manifest, exact detected/target hardware, raw result hash, and caveats;
- promptfoo subprocess adapter with isolated project data directory and disabled optional sharing/telemetry by default;
- manual evidence importer for pricing/licensing facts;
- evidence freshness and missing-evidence report.

Exit criteria:

- adapters are optional and replaceable;
- no API key or secret is persisted;
- every imported fact records source and time;
- llmfit detected hardware cannot be mistaken for a different target machine;
- promptfoo result maps to the exact workload, candidate, config, and dataset.

## Milestone 3: Idea-to-contract flow

Target: **Weeks 3–4**

Deliverables:

- CLI command to initialize an ANVILMARK project;
- structured elicitation template for intent, workloads, constraints, and hardware;
- interface for the user's Claude Code, Codex, API, or local intelligence to propose structured additions;
- validation that rejects malformed agent output;
- interactive local review and approval command with no noninteractive mode in the first slice;
- at least two architecture/candidate alternatives for the fixture without claiming that unevaluated options are viable.

Exit criteria:

- the same contract is produced regardless of which intelligence adapter proposes content;
- user approval is mandatory;
- approval is absent from MCP, and documentation states that the local CLI is not a security boundary against an agent with unrestricted shell access;
- agent proposals cannot weaken hard constraints;
- unanswered questions remain explicit.

## Milestone 4: Architecture and generated context

Target: **Weeks 4–5**

Deliverables:

- architecture nodes/relationships and decision bindings;
- Mermaid generation;
- CALM 1.2 export generation;
- generated agent-context view;
- MCP tools for project summary, constraints, workload decisions, architecture context, and evidence gaps;
- contract-revision marker on every generated artifact.

Exit criteria:

- Mermaid, CALM, and agent context regenerate deterministically from the same contract;
- generated files never become authoritative inputs;
- both Claude Code and Codex can retrieve the same approved facts;
- no provider-specific assumptions exist in the MCP contract.

## Milestone 5: Repository mapping

Target: **Weeks 5–7**

Deliverables:

- one TypeScript compiler-API detector covering TypeScript and JavaScript through `allowJs`;
- a detector plugin interface for inventory, call sites, source/sink recognition, taint, and bindings;
- candidate/provider/model call-site detection for the fixture;
- source-linked repository bindings;
- trust-boundary and redaction-path annotations;
- confidence and evidence classification for every binding.

Exit criteria:

- every claimed call site links to a file and symbol or line;
- deterministic findings and inferred findings are visibly different;
- dynamic/unresolved calls are reported as unknown;
- no repository content leaves the machine without explicit disclosure.

## Milestone 6: Conformance loop

Target: **Weeks 7–8**

Deliverables:

- provider allowlist rule;
- forbidden raw-data-to-remote-provider rule;
- conformance results with pass/fail/unknown/not-applicable;
- exact repository evidence;
- suggested approved alternative;
- MCP `check_proposed_change` and `run_conformance` tools;
- intentionally compliant, directly violating, and ambiguous fixture revisions.

Exit criteria:

- the deliberate Atlas violation fails both the provider allowlist and direct raw-data-flow rules with the correct constraint, decision, file, and call site;
- a compliant version passes;
- a runtime-selected provider/data path returns unknown for unresolved claims rather than pass;
- repeated checks are deterministic.

## Milestone 7: Local demonstration and usability

Target: **Weeks 8–10**

Deliverables:

- coherent CLI walkthrough;
- minimal local web read view only if it accelerates understanding;
- evidence/constraint/decision/conformance summary;
- onboarding and security documentation;
- packaged local installation path;
- repeatable end-to-end demo script.

Exit criteria:

- a new developer can reproduce the demo from a clean checkout;
- no ANVILMARK model or hosted service is required;
- the demonstration works with both Claude Code and Codex;
- all factual recommendations expose provenance and uncertainty;
- the full loop completes without manual transfer between unrelated files.

---

## Parallel ownership

### Developer A — contract, evidence, and comparison

- Milestones 0–2 lead;
- schema and invariants;
- evidence/freshness model;
- llmfit and promptfoo adapters;
- constraint results and candidate comparison.

### Developer B — repository and conformance

- CALM/conformance spike;
- repository detectors and bindings;
- deterministic rules;
- source-linked results;
- violating/compliant fixture variants.

### Developer C — CLI, MCP, and agent experience

- initialization and review workflow;
- user approval operation;
- MCP surface;
- Claude Code/Codex context delivery;
- Mermaid/read view and demonstration packaging.

### Joint ownership

- product-boundary decisions;
- contract approval;
- security/privacy review;
- end-to-end acceptance;
- build-versus-integrate decisions.

## Weekly integration rule

At least once each week, all three tracks must run the complete fixture through one contract revision. A feature that works only in its package but cannot survive the end-to-end loop is incomplete.

## Stop/reassess triggers

Pause implementation and reassess if:

- the contract becomes a thin copy of Archcore or CALM without additional evidence/decision semantics;
- the first slice requires building a router, observability platform, or hosted model;
- a close competitor demonstrates the complete benchmark loop hands-on;
- hardware, pricing, or quality data cannot be represented with honest provenance and unknown states;
- deterministic conformance for the benchmark requires general program understanding beyond the team's feasible scope;
- the unified workflow is not materially clearer than the substitute stack after the demo.

## Definition of prototype complete

The prototype is complete only when one recorded decision moves through every stage:

1. user constraint;
2. candidate evidence;
3. explicit user approval;
4. agent consumption;
5. repository binding;
6. deterministic conformance check;
7. failure on the deliberate violation;
8. success after correction.

Completing isolated screens, diagrams, model comparisons, or repository scans does not satisfy this definition.
