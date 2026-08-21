# ANVILMARK Canonical Product Brief

Date: **August 17, 2026**  
Status: **Current product and engineering direction**  
Audience: **The three ANVILMARK developers and any Claude Code, Codex, or other agent working in this repository**

This is the single starting document for ANVILMARK. It consolidates the product intent, competitive research, corrected interpretation of the earlier closure, technical boundary, implementation strategy, and immediate next steps.

If another document conflicts with this brief, use this brief for current product direction. The documents under [`docs/research/`](docs/research/README.md) remain valuable dated evidence, but their instruction to stop all work was made under a commercial-startup decision framework and is historical for the present project.

Active vNext artifacts:

- [`01-shared-benchmark-scenario.md`](docs/vnext/01-shared-benchmark-scenario.md) — the fixed Atlas Support Desk test;
- [`02-competitor-hands-on-matrix.md`](docs/vnext/02-competitor-hands-on-matrix.md) — observed and gated competitor behavior;
- [`03-decision-contract-proposal.md`](docs/vnext/03-decision-contract-proposal.md) — accepted project-contract design at `0.1.0-draft.1`;
- [`04-vertical-slice-build-plan.md`](docs/vnext/04-vertical-slice-build-plan.md) — the executable three-developer plan;
- [`milestones/README.md`](docs/vnext/milestones/README.md) — detailed Milestone 0–7 execution guides, diagrams, tests, and exit checklists;
- [`05-contract-ratification-answers.md`](docs/vnext/05-contract-ratification-answers.md) — the ratification reasoning record;
- [`06-contract-ratification-decision.md`](docs/vnext/06-contract-ratification-decision.md) — the ratified engineering baseline and closed implementation gate.

---

## 1. Executive summary

ANVILMARK is being pursued as a **free-to-use engineering project**, not currently as a conventional startup.

ANVILMARK will **not provide, train, host, or subsidize an intelligence model**. The user supplies the intelligence through one of the following:

- Claude Code, Codex, or another installed coding agent;
- the user's own API key;
- an OpenAI-compatible endpoint;
- a routing service selected by the user;
- a local model runtime such as Ollama or vLLM.

ANVILMARK provides everything around that intelligence that is needed to make architecture and AI-system decisions more structured, evidence-backed, portable, and verifiable.

The working definition is:

> **ANVILMARK is a free, local-first, vendor-neutral decision and conformance layer that uses the user's chosen intelligence to turn an idea or repository plus explicit constraints into an evidence-backed architecture, model, and deployment contract—and then checks whether the implemented system still satisfies that contract.**

Competitive research found two facts that must be held together:

1. **There is no empty capability category.** Existing products solve nearly every individual component.
2. **No single public product found completes the entire intended lifecycle.** A capable user can assemble approximately 70–80% of the outcome by combining several products, but the result is fragmented and does not provide one durable decision and conformance object.

The opportunity is therefore not to invent another model, coding agent, router, observability platform, diagram generator, or model leaderboard. It is to provide the connective decision layer across them.

---

## 2. Why this project exists

The project is motivated by a shift in how AI systems should be designed.

The useful question is no longer simply:

> Which model appears to be the most intelligent?

The useful engineering question is:

> Which model, provider, deployment, and architecture deliver sufficient quality for this exact workload at the best effective cost, token consumption, latency, privacy posture, hardware fit, and operational risk?

Three trends make that question increasingly important:

- rapid improvement and growth in open-weight models;
- large differences in price and operational characteristics across providers serving similar models;
- political, jurisdictional, data-residency, and service-continuity concerns that make portability and local deployment relevant design constraints.

ANVILMARK should not make political judgments for the user. It should translate the user's requirements into explicit, testable constraints such as:

- data must remain in specified regions;
- specific providers or jurisdictions are allowed or excluded;
- offline or local execution is required;
- existing CPU, RAM, GPU, and VRAM should be considered;
- a model's license must permit the intended use;
- the architecture must remain portable if a provider becomes unavailable;
- a minimum task-quality threshold must be met before cost optimization is considered.

### Quality before price

ANVILMARK must never recommend the cheapest option merely because it is cheap. The decision order should be:

1. eliminate candidates that violate hard constraints;
2. measure or estimate whether remaining candidates satisfy the task-quality threshold;
3. compare effective cost, token consumption, latency, hardware fit, and operational burden;
4. present alternatives, assumptions, evidence freshness, uncertainty, and trade-offs;
5. let the user approve the decision.

Effective cost may include:

- API or inference charges;
- input, output, reasoning, cached, and uncached tokens;
- retries and failed generations;
- tool calls and ancillary services;
- storage and network charges;
- hardware amortization and energy where relevant;
- operational effort;
- human review or correction caused by quality failures.

The early product does not need to calculate every term perfectly. It must distinguish measured values, estimates, assumptions, and unknowns.

---

## 3. The two primary user scenarios

### Scenario A: Start with an idea

A user has an application idea but little direction. ANVILMARK should:

1. use the user's selected intelligence to clarify the idea;
2. capture functional requirements and constraints;
3. identify relevant workloads rather than treating the application as one undifferentiated prompt;
4. compare viable application architectures;
5. consider managed APIs, open-weight models, local inference, cloud inference, and hybrid choices;
6. inspect the user's available compute when authorized;
7. compare task quality, tokens, effective cost, latency, privacy, licensing, and operational burden;
8. produce an editable visual architecture backed by a machine-readable graph;
9. record why each important decision was made and what alternatives were rejected;
10. provide the approved contract to Claude Code, Codex, or another coding agent;
11. verify that the resulting repository conforms to the approved decisions.

ANVILMARK does not implement the application itself. The user's coding agent performs implementation.

### Scenario B: Start with an existing repository

ANVILMARK should:

1. inspect the repository with explicit user permission;
2. deterministically identify languages, dependencies, infrastructure declarations, AI SDKs, model references, prompts, and relevant call sites;
3. reconstruct an evidence-linked current architecture;
4. ask the user's intelligence to interpret intent where static facts are insufficient;
5. combine source findings with any runtime evidence the user elects to provide;
6. find decisions that violate budget, quality, latency, privacy, portability, hardware, or policy constraints;
7. compare replacements across managed, open-weight, and local options;
8. propose a target architecture and migration contract;
9. provide the approved changes to the user's coding agent;
10. verify the resulting code and, when data is available, runtime behavior.

The generic promise “scan a repository and find inefficiencies” is already heavily competed. The distinctive target is narrower:

> Given an approved decision contract, workload-specific quality evidence, available compute, and measured or declared usage, determine whether the repository and runtime still satisfy the application's architectural and economic constraints.

---

## 4. Product boundary: who supplies what

| Responsibility                                                       | ANVILMARK                                         | User's intelligence                                  |
| -------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| Store requirements and constraints                                   | Yes                                               | Can elicit and interpret them                        |
| Inspect hardware and repository facts                                | Yes, deterministically where possible             | Can interpret ambiguous intent                       |
| Maintain model, provider, pricing, benchmark, and licensing evidence | Yes, through adapters and sourced records         | Can reason over the evidence                         |
| Apply hard policy and compatibility filters                          | Yes                                               | Can explain consequences                             |
| Generate and compare architecture alternatives                       | Supplies schemas, evidence, tools, and validation | Performs open-ended reasoning                        |
| Make the final choice                                                | No                                                | No—the user approves it                              |
| Write application code                                               | No                                                | The user's Claude Code, Codex, or other agent        |
| Verify contract conformance                                          | Yes                                               | Can help interpret non-deterministic findings        |
| Host inference                                                       | No                                                | User-selected API, agent, provider, or local runtime |
| Train or fine-tune foundation models                                 | No                                                | Outside initial scope                                |

### Deterministic core

The following should work without asking an LLM to invent facts:

- repository inventory;
- dependency and SDK detection;
- hardware detection;
- model/context/license compatibility checks;
- pricing arithmetic;
- constraint evaluation;
- evidence timestamps and provenance;
- graph validation;
- conformance rules;
- diffing an approved contract against a later contract or repository state.

The user's intelligence is best used for:

- clarifying an ambiguous idea;
- turning natural-language intent into proposed structured requirements;
- explaining trade-offs;
- suggesting architecture alternatives;
- interpreting repository intent;
- proposing migrations;
- generating implementation code.

This separation is essential. ANVILMARK must be more than a folder of prompts.

---

## 5. The durable object ANVILMARK should own

The core is a versioned, machine-readable **decision contract**, not a diagram image.

A project should eventually contain artifacts similar to:

```text
.anvilmark/
  project.yaml             # intent, constraints, workloads, decisions
  evidence.json            # sources, retrieval dates, measurements, uncertainty
  architecture.mmd         # generated Mermaid view
  conformance.json         # last deterministic verification result
  migrations/              # approved change contracts
```

The exact file names and schema are not yet final. Conceptually, the contract needs:

- project intent and success criteria;
- hard and soft constraints;
- workloads and their quality thresholds;
- candidate components, models, providers, and deployment targets;
- available hardware;
- evidence and freshness;
- accepted and rejected alternatives;
- approved decisions and rationale;
- mappings from decisions to repository files and infrastructure;
- exceptions and expiration dates;
- conformance rules and results.

Human-readable outputs such as Mermaid diagrams, reports, `AGENTS.md`, or `CLAUDE.md` context should be generated from this canonical contract. They should not become competing sources of truth.

### Lifecycle

```text
idea or repository
        ↓
intent, workloads, and explicit constraints
        ↓
evidence-backed managed/open/local alternatives
        ↓
user-approved decision contract
        ↓
Claude Code, Codex, or another agent implements
        ↓
repository and optional runtime verification
        ↓
drift, changed evidence, and revised decisions
```

---

## 6. Competitive conclusion

### The important conclusion

As of the August 2026 research, **no single public competitor was found that clearly combines all of the following**:

- idea-stage requirement discovery;
- vendor-neutral application architecture;
- managed versus open-weight versus local model selection;
- owned-hardware fit;
- workload-specific quality evidence;
- token and effective-cost comparison;
- editable visual architecture backed by a machine-readable decision graph;
- export of approved decisions to arbitrary coding agents;
- repository and runtime conformance against those decisions.

This does not mean ANVILMARK has a commercial moat. It means the complete workflow remains fragmented.

### The practical 70–80% substitute

A capable user can approximate most of the intended workflow today:

```text
Spec Kit or BMAD
        ↓
Archie, Cybewave, BackArch, ArchGenie, or Brainboard
        ↓
Hugging Face, Artificial Analysis, llmfit, and an eval platform
        ↓
Claude Code, Codex, Cursor, or another coding agent
        ↓
CodeBoarding, NodeScope, PromptScan, or modernization tools
        ↓
Archcore, ArchRails, Qodo, GovForge, or custom policy checks
```

“70–80% is assembled” means that existing products cover approximately that portion of the capability map. It does **not** mean that 70–80% of ANVILMARK's code already exists or can simply be copied. Integration, normalization, provenance, compatibility, user experience, and conformance are substantial engineering work.

### Capability map

| Capability                             | Strong existing coverage                        | Remaining ANVILMARK role                                           |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| Idea clarification and specification   | Archie, Cybewave, Spec Kit, BMAD                | Normalize into one durable constraint contract                     |
| Visual architecture and cloud planning | BackArch, ArchGenie, Brainboard, Holori         | Connect architecture to model, hardware, evidence, and conformance |
| Model and provider discovery           | Hugging Face, Artificial Analysis, OpenRouter   | Normalize candidate evidence without favoring a provider           |
| Owned-hardware model fit               | llmfit, ModelFit, LocalAIRun, estimators        | Make hardware fit one input to an application-level decision       |
| Routing and provider abstraction       | LiteLLM, OpenRouter, Portkey, Bifrost           | Integrate; do not build another production gateway initially       |
| Quality evaluation                     | Braintrust, promptfoo, DeepEval, Phoenix, Opik  | Reference or invoke evaluations as decision evidence               |
| Observability and cost attribution     | Langfuse, Helicone, MLflow, OpenTelemetry tools | Consume optional runtime evidence; do not replace observability    |
| Repository reconstruction              | CodeBoarding, NodeScope, DeepRepo               | Link source facts to approved decisions                            |
| Agent architecture context             | Archcore, ArchRails, GovForge, CALM             | Generate agent-neutral context from the canonical contract         |
| Modernization and code review          | AWS Transform, Moderne, Qodo, Sourcegraph       | Keep scope to contract-specific migrations and checks              |
| Intent-to-code-to-runtime conformance  | No complete product found                       | Primary long-term integration and ownership opportunity            |

### Competitive activity snapshot

The market is active, not stale.

| Activity class    | Products                                                                                                                          | August 2026 interpretation                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Very active       | Langfuse, LiteLLM, promptfoo, Phoenix, Opik, MLflow, DeepEval, Ollama, vLLM, Spec Kit, BMAD, llmfit, OpenRouter, Baseten, Bifrost | Frequent repository activity, recent releases, or significant current product activity                                |
| Active or early   | Helicone, Braintrust, BackArch, ArchGenie, Archcore, ArchRails, NodeScope, CodeBoarding                                           | Current products or repositories; architecture-first products are generally younger and public adoption is less clear |
| Slower or unclear | Archie, Brainboard, GovForge, PromptScan, Cybewave, FinOps LLM                                                                    | Delayed launch language, quieter changelogs, very early repositories, or insufficient public operating evidence       |

Specific caution signals found during the activity review:

- Archie still showed “Coming July 2026” during an August review, so availability appeared delayed or unclear despite current documentation and content.
- Brainboard's latest visible changelog entry was in March 2026; this suggests a slower public cadence, not proof that the product is dead.
- GovForge's repository showed very low visible adoption and its latest observed push was in May 2026; it may be moving slowly or paused.
- PromptScan was only created in July 2026 and became quiet after its initial work. It is better described as nascent or unlaunched than stale.
- Cybewave and FinOps LLM had current websites but little independently verifiable adoption, changelog, team, or customer evidence.
- Portkey's open-source gateway cadence was slower, while the company itself remained active and funded.
- Helicone's formal release tags were quiet, but its main repository remained active.

No strategy should depend on competitors becoming stale. ANVILMARK's reason to exist must be the usefulness of a neutral integrated workflow.

### Strategy-relevant competitor register

The following is the consolidated strategy set. The dated long-tail register and source links remain in [`docs/research/02-competitor-register.md`](docs/research/02-competitor-register.md).

- **Closest architecture and lifecycle competitors:** Archie, Cybewave, BackArch, ArchGenie, Archcore, ArchRails, GovForge, Brainboard, Holori, CodeBoarding, NodeScope, AWS Agent Plugins, AWS Transform, PromptScan, Replit Agent, Spec Kit, BMAD.
- **Architecture modeling:** LikeC4, IcePanel, Structurizr, Hava, Cloudcraft, Eraser, Mermaid Chart, D2, Cloudockit, Lucidscale, LeanIX, Ardoq, Bizzdesign, Sparx Enterprise Architect, Visual Paradigm, OpenArchFlow.
- **Repository understanding and modernization:** DeepRepo, Graphist, Archaic, CodeArchy, ArchAnalyze, RepoWise, DeepWiki, GitDiagram, CodeCanvas, vFunction, CAST Imaging, CodeScene, Moderne, Sourcegraph, Qodo, Greptile, CodeRabbit, SonarQube, ArchUnit.
- **AI source analysis:** PromptScan, AI Architecture Scanner, CostCanary, LLM Tracer, Neurometric, TokenWise, Calcis, Tokenlint, Token Proctor.
- **Observability and evaluation:** Helicone, Langfuse, Braintrust, LangSmith, Datadog, New Relic, Phoenix, Opik, Weave, MLflow, Traceloop, Parea, Lunary, PromptLayer, Agenta, LangWatch, Maxim, Galileo, Fiddler, OpenLIT, Keywords AI, promptfoo, DeepEval, Evidently.
- **Gateways and routing:** Portkey, OpenRouter, LiteLLM, Requesty, Not Diamond, Martian, Orq, Cloudflare AI Gateway, Microsoft Foundry Model Router, Vertex AI, Bedrock, Bifrost.
- **Model and hardware selection:** Artificial Analysis, WhatLLM, Models Pie, llmfit, ModelFit, LocalAIRun, LLMRunnable, Hugging Face, Google Stax, Aptyx, NVIDIA NIM.
- **Inference infrastructure:** Ollama, LM Studio, vLLM, BentoML, KServe, Seldon, Baseten, Fireworks, Together AI, Anyscale, Modal, Replicate, Runpod, SageMaker Inference Recommender.
- **AI FinOps:** FinOps LLM, Helicone, Preto, ZenLLM, nOps, Harness, Halvr, Varsten, o10, Optimetric, TokOpt, Allovant, Xosphere TokenIQ, Finout, CloudZero, Vantage, CostScope.
- **Coding-agent and idea-to-app substitutes:** Claude Code, Codex, Cursor, Copilot, Windsurf, Kiro, Devin, Gemini CLI, Jules, Replit, Lovable, Bolt, Base44, v0, Firebase Studio, Bubble, FlutterFlow, Retool.

---

## 7. Why the earlier closure no longer controls this project

The August 13 closure memo answered a commercial question:

> Is this a sufficiently differentiated and defensible paid startup hypothesis with a validated buyer?

Under that framework, the research correctly found serious problems:

- every component has competitors;
- some residual differences are feature-sized;
- a clear paying buyer was not established;
- incumbents could absorb pieces of the workflow;
- integration alone is not a commercial moat.

The current project has a different decision framework:

- it is being built by three developers as a free tool;
- it does not currently need venture-scale demand or a commercial moat;
- it does not host or subsidize intelligence;
- combining fragmented capabilities is acceptable if the resulting workflow is genuinely useful;
- the project is motivated by model choice, portability, local compute, evidence, and engineering quality.

Therefore:

- the **paid-startup thesis remains closed** unless future evidence changes it;
- the **free engineering project is reopened**;
- the competitor facts remain valid;
- “no buyer,” “feature-sized,” and “easy for an incumbent to copy” are no longer automatic stop conditions;
- duplication still matters: ANVILMARK should integrate mature tools rather than rebuild them.

The old closure memo remains an important warning against pretending that fragmentation automatically creates a business.

---

## 8. Build, integrate, and avoid

| Area                                            | Direction                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Canonical decision schema and graph             | **Build and own**                                                              |
| Constraint and policy engine                    | **Build and own**                                                              |
| Evidence provenance, freshness, and uncertainty | **Build and own**                                                              |
| Repository-to-decision mapping                  | **Build and own**                                                              |
| Conformance and drift checks                    | **Build and own**                                                              |
| MCP and agent-neutral context interface         | **Build and own**                                                              |
| Provider/model invocation                       | Integrate through replaceable adapters or native user-selected tools           |
| Local inference                                 | Integrate with Ollama, vLLM, and OpenAI-compatible endpoints                   |
| Evaluation execution                            | Integrate promptfoo, Braintrust-compatible data, or a thin evaluation contract |
| Observability                                   | Consume optional Langfuse, Helicone, OpenTelemetry, or exported evidence       |
| Model/hardware catalogs                         | Adapt external sources; preserve source and retrieval date                     |
| Diagrams                                        | Generate Mermaid first; add an editable visual canvas after the contract works |
| Production request routing                      | Do not build initially                                                         |
| General observability dashboard                 | Do not build initially                                                         |
| Model hosting or training                       | Do not build                                                                   |
| Generic autonomous app builder                  | Do not build                                                                   |
| Cloud deployment platform                       | Do not build initially                                                         |

All third-party integration must be reviewed for license terms, API stability, privacy, and whether it can be optional. ANVILMARK must not depend on one commercial provider to remain useful.

---

## 9. Delivery shape for a free product

The most sustainable design is:

- local-first CLI and local service;
- an MCP server for Claude Code, Codex, and other compatible clients;
- optional local web interface;
- user-supplied API keys and endpoints;
- no ANVILMARK inference bill;
- no mandatory central account;
- no repository source upload by default;
- replaceable data and provider adapters;
- timestamped, cited evidence;
- project files that can be version controlled;
- an optional update mechanism for public metadata.

### Secret and privacy rules

- Never write API keys into `.anvilmark/`, generated Markdown, logs, or version-controlled configuration.
- Prefer environment variables, the operating-system keychain, or the selected agent's existing credential mechanism.
- Clearly disclose when repository content or prompts will be sent to a remote model.
- Require explicit permission before reading outside the selected repository, detecting hardware, or accessing runtime telemetry.
- Allow an offline mode with reduced capabilities.

“Free to use” is a settled current direction. Whether ANVILMARK itself will be open source, source-available, or closed-source freeware is **not yet decided** and requires a license decision by the team.

---

## 10. Achievability with three developers

This is achievable if the team builds one vertical workflow before expanding the lifecycle.

What makes it feasible:

- no hosted inference;
- no GPU fleet;
- no model training;
- no need to build a coding agent;
- mature external tools cover routing, evaluation, observability, inference, and diagram rendering;
- Claude Code and Codex can accelerate implementation, tests, adapters, documentation, and repository analysis.

What remains difficult:

- keeping model, provider, price, license, and benchmark evidence current;
- normalizing incompatible external data;
- evaluating task quality honestly;
- reconstructing architecture across languages and frameworks;
- making recommendations explainable rather than confident-looking guesses;
- handling privacy and credentials safely;
- maintaining adapters when upstream products change;
- creating useful conformance rules without excessive false positives.

### Realistic stages

| Stage                     | Indicative duration for three coordinated developers | Outcome                                                                                                                |
| ------------------------- | ---------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------- |
| Working prototype         |                                           6–10 weeks | CLI/MCP, BYO intelligence, constraints, candidate comparison, YAML/JSON contract, Mermaid, elementary repository scan  |
| Credible public alpha     |                                     3–5 months total | Local web UI, editable decisions, provider/model adapters, evidence, deeper repository mapping, basic conformance      |
| Dependable ecosystem tool |                                          9–18 months | Broader provider/language coverage, mature data freshness, plugin SDK, runtime evidence, migration and drift workflows |

These are planning estimates, not promises. They assume regular work, a narrow first vertical, and disciplined use of integrations.

### Suggested ownership

1. **Decision and evidence developer**
   - schemas, constraint engine, model/provider/hardware catalogs, scoring, pricing, provenance;
2. **Repository and agent developer**
   - scanner, MCP, Claude Code/Codex integration, generated context, conformance;
3. **Interface and platform developer**
   - local application, visual graph, project lifecycle, packaging, onboarding, adapter experience.

Anurag, Navaneeth, and Aaradhya jointly approved the canonical contract and security model on August 20, 2026.

---

## 11. First vertical slice

The first version should prove one complete loop:

> **idea or repository → explicit constraints → managed/open/local candidates → evidence-backed decision → coding-agent context → implementation conformance**

### Minimum inputs

- idea text or repository path;
- target workload descriptions;
- budget and expected usage assumptions;
- latency and minimum-quality requirements;
- privacy, residency, license, and provider constraints;
- available CPU, RAM, GPU, and VRAM when relevant;
- the user's selected intelligence mechanism.

### Minimum outputs

- structured requirements and uncertainties;
- at least one managed, open-weight, and local candidate when viable;
- rejected candidates with reasons;
- evidence URLs, retrieval dates, assumptions, and confidence;
- an approved decision contract;
- a Mermaid architecture view;
- context consumable by Claude Code and Codex;
- a basic conformance report linking findings to repository files.

### First demonstration scenario

Use one small AI-enabled web application with:

- multiple workload types, such as extraction, classification, chat, and summarization;
- a declared monthly budget;
- one local GPU option;
- a residency or provider-exclusion constraint;
- an explicit quality test dataset;
- a deliberately nonconforming implementation change that ANVILMARK must detect.

This scenario tests the reason ANVILMARK exists without requiring production-scale infrastructure.

### Prototype success criteria

The prototype succeeds when:

1. it runs without an ANVILMARK-hosted model or ANVILMARK API key;
2. the same project can use Claude Code, Codex, or an API/local adapter without changing the decision contract;
3. every factual recommendation shows provenance and freshness;
4. hard constraints are enforced deterministically;
5. the user's agent can consume the approved contract and implement against it;
6. ANVILMARK detects an intentional contract violation in the repository;
7. users can understand why one candidate was selected over another;
8. no secret is written into project artifacts.

---

## 12. Current repository reality

The repository is a healthy contract-first scaffold for the older AI cost-audit concept. It is not the product described in this brief.

Currently implemented:

- pnpm/TypeScript monorepo structure;
- Zod contract version `0.1.0`;
- engine package boundaries and empty rule seams;
- an MCP server with three fixture-backed tools;
- a placeholder Next.js dashboard;
- realistic authored fixtures;
- tests, linting, formatting, and build configuration.

Not implemented:

- repository discovery or semantic parsing;
- live pricing or model catalogs;
- real token and cost calculations;
- runtime telemetry;
- task-quality evaluation;
- hardware-aware model selection;
- architecture decision graph;
- visual editing;
- agent implementation contract for the new direction;
- repository/runtime conformance;
- persistence, authentication, or production deployment.

The old `packages/contract` contract `0.1.0` remains unchanged as a historical interface. The accepted design creates `packages/project-contract` as an independent schema line beginning at `0.1.0-draft.1`. Existing MCP, web, fixture, and package patterns may be reused where they fit; they must not dictate the new product.

---

## 13. Decisions already made

- ANVILMARK is currently a free-to-use project, not a startup exercise.
- ANVILMARK will not provide or host an intelligence model.
- Users supply intelligence through their agent, API key, endpoint, or local runtime.
- ANVILMARK is vendor-neutral and should support managed, open-weight, and local choices.
- The canonical product is a decision and conformance layer, not another coding agent.
- The system should be local-first and should not require source-code upload.
- Mature runtime infrastructure should be integrated, not recreated.
- The first implementation must be a narrow end-to-end vertical slice.
- Commercial defensibility is not a prerequisite for building the free tool.
- Competitor duplication is still a reason to integrate or narrow scope.
- The new project contract lives in `packages/project-contract` at `0.1.0-draft.1`; the historical contract remains frozen.
- TypeScript and JavaScript share the first repository detector through the TypeScript compiler API; Python follows as a plugin.
- ANVILMARK architecture is authoritative; FINOS CALM 1.2 and Mermaid are generated exports.
- promptfoo and llmfit are optional subprocess adapters, not core libraries or reimplemented capabilities.
- User approval is an interactive local CLI operation, absent from MCP; it reduces accidental approval but is not a security boundary against an agent with unrestricted shell access.

## 14. Decisions still open

- open-source, source-available, or closed-source-free license;
- desktop application versus local web application as the primary interface;
- first model, pricing, benchmark, and hardware data sources;
- whether LiteLLM is an implementation dependency or merely one optional adapter;
- graph visualization library after Mermaid;
- plugin and adapter SDK shape;
- whether optional hosted metadata updates will exist;
- how runtime evidence will be imported without becoming an observability platform.

---

## 15. Principal risks and guardrails

| Risk                                            | Guardrail                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Becoming a wrapper around competitor APIs       | Own the contract, evidence semantics, deterministic constraints, and conformance loop        |
| Claiming an objectively “optimal” architecture  | Present constrained alternatives, assumptions, uncertainty, and user approval                |
| Stale pricing and model facts                   | Store source, retrieval time, version, and confidence; make adapters refreshable             |
| Rebuilding mature infrastructure                | Maintain the build/integrate/avoid boundary in section 8                                     |
| Scope expanding to “everything around AI”       | Accept features only when they serve the decision-contract lifecycle                         |
| LLM hallucinations entering the source of truth | Validate structured proposals; distinguish facts, measurements, assumptions, and suggestions |
| Secrets or repository data leaking              | Local-first operation, explicit network disclosure, safe credential storage, offline mode    |
| Provider bias                                   | Use adapter neutrality and show alternative sources                                          |
| Repository analysis false confidence            | Link every claim to files or runtime evidence and expose unknowns                            |
| Three developers overwhelmed by maintenance     | Start with a small adapter/language set and publish extension contracts                      |

---

## 16. Immediate next steps

1. **Begin Milestone 1.** Create `packages/project-contract` at `0.1.0-draft.1` without modifying or migrating the historical `packages/contract` schema. The ratification gate closed on August 20, 2026.
2. **Make the Atlas contract executable.** Validate the draft fixture, reference integrity, evidence floors, soft directions, priority order, secret rejection, and stable serialization.
3. **Build the evidence and intelligence boundaries.** Keep promptfoo and llmfit optional; accept Claude Code, Codex, APIs, and local models through the same validated proposal interface.
4. **Add the explicit approval flow.** Use an interactive local CLI over the resolved content hash; expose no MCP or noninteractive approval operation in the first slice.
5. **Generate architecture views.** Produce deterministic Mermaid and CALM 1.2 exports from the authoritative ANVILMARK contract.
6. **Implement the TypeScript/JavaScript detector.** Use the TypeScript compiler API with `allowJs`, source-linked findings, provider sinks, sanitizer handling, and explicit unknowns.
7. **Build the three conformance fixtures.** A compliant case passes, a direct violation fails provider and raw-data-flow rules, and a dynamic case returns `unknown` where unresolved.
8. **Run the complete local demonstration.** Feed the approved contract to both Claude Code and Codex and verify the same conformance result without hosted ANVILMARK intelligence.
9. **Reassess after the prototype.** Continue only if the unified loop is materially clearer or faster than manually using the substitute stack.

---

## 17. Instruction for Claude Code, Codex, and other agents

When working on ANVILMARK:

1. read this document first;
2. treat older closure instructions as historical commercial conclusions;
3. do not add hosted intelligence or ANVILMARK-funded model calls;
4. do not hard-code the core to one model provider, coding agent, cloud, or runtime;
5. prefer deterministic discovery and validation for factual claims;
6. attach provenance and freshness to external evidence;
7. preserve user control over final architecture decisions;
8. do not expand into routing, observability, deployment, or model hosting without an explicit team decision;
9. preserve historical `packages/contract` at `0.1.0` and implement the separately named `packages/project-contract` at `0.1.0-draft.1`;
10. verify changes with tests and document assumptions and unresolved decisions.

Before implementing a feature, answer:

- Which part of the decision-contract lifecycle does it serve?
- Is a mature tool already available to integrate?
- What deterministic facts and external evidence does it require?
- What data could leave the user's machine?
- How will conformance be verified?

---

## Final standing

ANVILMARK is **reopened as a free, user-intelligence-powered engineering project**.

It is feasible for three developers, assisted by Claude Code and Codex, if the team owns the decision contract and conformance loop while integrating mature external capabilities. The complete vision is a substantial multi-stage project; the first end-to-end vertical slice is achievable.

The project should proceed without claiming that it has no competitors, without waiting for competitors to become stale, and without pretending that a free integration is automatically a commercial business. Its present test is simpler:

> Can ANVILMARK make the path from intent to evidence-backed architecture to agent implementation to verified conformance meaningfully more coherent than assembling the current fragmented stack by hand?
