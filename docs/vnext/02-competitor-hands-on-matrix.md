# ANVILMARK Competitor Hands-on Matrix

Date started: **August 17, 2026**  
Scenario: [`01-shared-benchmark-scenario.md`](01-shared-benchmark-scenario.md)  
Status: **In progress**

## Scope

This matrix tests the closest substitute stack rather than repeating broad market discovery.

Initial targets:

1. Cybewave or Archie — idea discovery;
2. BackArch or ArchGenie — visual architecture and cost;
3. llmfit — local hardware fit;
4. Braintrust or promptfoo — workload evaluation;
5. Archcore or ArchRails — agent decision context and governance;
6. NodeScope or CodeBoarding — repository reconstruction and drift.

No account will be created and no payment or demo request will be submitted without explicit user authorization. Publicly observable and source-code behavior will be recorded first; gated capabilities remain marked **G**, not guessed.

## Capability columns

| ID      | Capability                                      |
| ------- | ----------------------------------------------- |
| **C1**  | Idea clarification                              |
| **C2**  | Structured constraints                          |
| **C3**  | Workload decomposition                          |
| **C4**  | Architecture alternatives                       |
| **C5**  | Managed/open/local comparison                   |
| **C6**  | Owned-hardware fit                              |
| **C7**  | Workload-specific quality proof                 |
| **C8**  | Token/effective-cost/latency evidence           |
| **C9**  | Provenance, freshness, assumptions, uncertainty |
| **C10** | Editable machine-readable architecture          |
| **C11** | Agent-neutral decision export                   |
| **C12** | Repository mapping and conformance              |

## Provisional results

`score/status` uses the rubric from the shared scenario. `?/U` means the available evidence cannot support either presence or absence. Scores based on public surfaces remain provisional.

| Product      |  C1 |  C2 |  C3 |  C4 |  C5 |  C6 |  C7 |  C8 |  C9 | C10 | C11 | C12 | Access/result                                           |
| ------------ | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | ------------------------------------------------------- |
| Cybewave     | 2/O | 1/O | 1/O | 2/O | ?/U | ?/U | ?/U | ?/U | ?/U | 2/O | 1/O | 0/O | Account required for the actual workflow                |
| Archie       | 1/O | 1/O | ?/U | 1/O | ?/U | ?/U | ?/U | ?/U | ?/U | ?/U | ?/U | ?/U | Pre-GA notify surface; unavailable for trial            |
| BackArch     | 1/O | 2/O | 1/O | 2/O | 1/O | ?/U | ?/U | 2/O | 1/O | 2/O | 1/O | ?/U | “Live demo” redirects to sign-in                        |
| ArchGenie    | 1/O | 1/O | 1/O | 2/O | 1/O | 0/O | 0/O | 2/O | 2/O | 2/O | 2/O | 1/O | Builder requires an account                             |
| llmfit       | 0/H | 1/H | 0/H | 0/H | 1/H | 2/H | 1/H | 2/H | 2/H | 0/H | 2/H | 0/H | CLI 1.1.10 tested; structured JSON verified             |
| Braintrust   | 0/D | 0/D | 0/D | 0/D | 2/D | 0/D | 3/D | 3/D | 2/D | 0/D | 2/D | 1/D | Source/docs evidence; authenticated trial still absent  |
| promptfoo    | 0/H | 0/H | 0/H | 0/H | 2/H | 0/H | 3/H | 2/H | 2/H | 0/H | 2/H | 1/H | CLI 0.122.0 evaluation completed locally                |
| Archcore     | 0/O | 1/O | 0/O | 1/O | 0/O | 0/O | 0/O | 0/O | 1/O | 3/O | 3/O | 2/O | Docs verified; CLI/plugin not installed                 |
| ArchRails    | 0/O | 0/O | 0/O | 1/O | 0/O | 0/O | 0/O | 0/O | 2/O | 3/H | 3/O | 2/H | Public CALM validator exercised; commercial gates gated |
| NodeScope    | 0/O | 0/O | 0/O | 0/O | 0/O | 0/O | 0/O | 0/O | 2/O | 2/O | 1/O | 2/O | Public demo redirects to sign-in                        |
| CodeBoarding | 0/O | 1/O | 0/O | 0/O | 0/O | 0/O | 0/O | 0/O | 2/O | 2/O | 2/O | 2/O | Public live repository map inspected                    |

## Per-product evidence records

Each record must include:

- access date and access level;
- exact product/repository version when available;
- input supplied;
- observed output;
- required manual transfer;
- data sent remotely;
- export formats;
- sources and screenshots where permitted;
- capability scores with status;
- known unknowns;
- implication for ANVILMARK's build/integrate boundary.

### Cybewave

**Accessed:** August 17, 2026, public website only. The “Sign up free,” templates, and “turn your idea into a plan” actions all resolve to `/login?mode=signup`; no authenticated trial was performed.

**Observed public workflow:** plain-English idea, three discovery phases for a non-technical founder or five phases for a technical founder, architecture/sequence/ER/component diagrams, editable Mermaid and PlantUML, a presentation, and scaffolded Docker/frontend/backend/database/API-gateway output.

**Relevant output claims:** guided discovery, four diagram types, live sharing, and code scaffold export. Public examples show components generated from a clinic-scheduling idea.

**Not established:** managed-versus-open-versus-local model comparison, owned hardware, workload evals, evidence provenance, token/effective-cost comparison, agent-neutral decision export, repository import, or conformance.

**ANVILMARK implication:** Cybewave is a close substitute for idea discovery and visual planning. ANVILMARK must not compete on “idea to diagrams.” Its first slice must demonstrate the missing model/hardware/evidence/contract/conformance path.

### Archie

**Accessed:** August 17, 2026, public website.

The page describes a platform to architect, build, and run production-grade applications, but the available action is **Notify Me** and the page states “General Availability · August 2026.” No product surface was available for the benchmark.

**ANVILMARK implication:** keep Archie in the close-watch set, but do not award or deny detailed capabilities until GA is available. It cannot currently close the hands-on benchmark.

### BackArch

**Accessed:** August 17, 2026, public website and `/canvas`.

The website claims a constraint-aware visual canvas, real-time multi-cloud pricing, architecture health scoring, AI generation, collaborative decision history, state/sequence/data-model views, and free solo access. The “View live demo” route redirected to a BackArch sign-in page offering Google, GitHub, or email authentication.

**Not established hands-on:** how constraints are stored, whether pricing sources/freshness are exposed, machine-readable export, model/hardware comparison, quality evidence, and repository conformance.

**ANVILMARK implication:** use BackArch as the bar for the eventual visual experience. Do not build an elaborate canvas before ANVILMARK proves the decision contract behind it.

### ArchGenie

**Accessed:** August 17, 2026, public website.

**Observed public claims:** description/sketch/upload to AWS, Azure, or GCP architecture; Terraform/Pulumi/Bicep; per-resource security findings; cost estimates; observability-as-code; documentation; and GitHub/GitLab/Bitbucket pull-request export. The FAQ states that estimates use provider pricing catalogues, account for declared region and resource characteristics, and explicitly mark missing SKUs; it also names excluded cross-region transfer, egress, and third-party SaaS costs.

**Gate:** the actual builder requires an account. No project was created.

**Confirmed boundary:** ArchGenie is cloud-infrastructure focused. No public evidence showed local/open-weight hardware selection or workload-specific model-quality proof.

**ANVILMARK implication:** cloud IaC generation, resource security scans, and cloud-price arithmetic should be integrations or later adapters, not the first core.

### llmfit

**Accessed/tested:** August 17, 2026. `llmfit 1.1.10` was executed locally through its Python package without installing it into the ANVILMARK repository.

**Benchmark command:** a recommendation was requested with 24 GB VRAM, 64 GB RAM, 16 CPU cores, an 8,192-token context cap, chat use case, and minimum “good” fit.

**Observed output:** structured JSON returned candidate name/provider, parameter count, quantization, context, memory required/available, utilization, fit label, estimated tokens per second, runtime, license where known, capabilities, score components, estimation method, assumptions, and notes.

**Important limitation discovered:** overriding VRAM/RAM/cores did not replace the detected hardware backend. On the test Mac, the output continued to identify Apple M4/Metal/unified memory and recommended MLX quantization. It therefore cannot faithfully simulate an RTX 4090 from unrelated hardware using only those flags. Running it on the actual Linux/RTX machine would test actual fit, but the hypothetical planning path needs further investigation.

**Quality limitation:** the `quality` score is catalog-level and not proof on the Atlas ticket dataset. Fit, estimated speed, and generic quality must remain separate from workload acceptance.

**ANVILMARK implication:** integrate llmfit-style structured hardware evidence. Do not copy its hardware catalog, and never treat its composite score as the final architecture decision.

### Braintrust

**Evidence level:** official documentation and previously completed source-level inspection; no account created.

Braintrust already covers production-to-evaluation datasets, per-span token/cost evidence, repeated experiments, baseline comparison, quality metrics, and PR comments through its evaluation action. Source inspection corrected the earlier false claim that its PR output lacked token and estimated-cost metrics.

**Not its role:** idea discovery, application architecture, owned-hardware fit, a vendor-neutral decision graph, or code-to-architecture conformance.

**ANVILMARK implication:** treat Braintrust as an optional evaluation/runtime evidence source. Do not build another hosted evaluation platform.

### promptfoo

**Accessed/tested:** August 17, 2026. Local CLI version `0.122.0`.

A local evaluation was created with:

- a custom deterministic provider;
- one ticket-classification case;
- JSON-validity and JavaScript assertions;
- explicit token usage and cost returned by the provider;
- telemetry disabled and all promptfoo state redirected to a temporary directory.

**Observed result:** one passing test; result JSON preserved provider ID, rendered prompt, output, assertion score, latency, cost, 34 prompt tokens, 8 completion tokens, 42 total tokens, and separate reasoning/cache token fields.

**Important behavior:** the CLI attempted to create a global `~/.promptfoo` directory until `PROMPTFOO_CONFIG_DIR` was explicitly redirected. ANVILMARK integration should set an isolated project-owned data directory and make any network behavior clear.

**Limit:** promptfoo evaluates configurations supplied to it. It does not decide the application architecture, discover hardware, own the approved decision contract, or prove repository conformance.

**ANVILMARK implication:** strong candidate for an evaluation adapter or execution backend. ANVILMARK should define the quality gate and evidence reference, then let promptfoo perform appropriate eval runs.

### Archcore

**Accessed:** August 17, 2026, public documentation.

Archcore describes a git-native context layer using `.archcore/` to manage typed specs, architecture, decisions, rules, plans, relations, and project knowledge. A CLI reads the graph and exposes MCP. Documentation explicitly supports Claude Code, Cursor, Codex CLI, and Copilot CLI.

**Not established:** generation of an optimal architecture from live model/provider/hardware/economic evidence. Its strength is storing and delivering context that has already been defined.

**ANVILMARK implication:** Archcore proves that typed project memory over MCP is already a product category. ANVILMARK's distinct role must be evidence-backed decision computation and conformance; compatibility or export to Archcore may be preferable to recreating every context-management feature.

### ArchRails

**Accessed/tested:** August 17, 2026. Public website and no-login CALM visualizer.

The visualizer's example was loaded and validation was run. It returned a valid result with 0 errors, 0 warnings, 45 passed checks, and an interactive graph with 10 nodes and 10 relationships. The page explicitly says the visualizer is a reading aid, not complete schema certification.

The commercial product claims deterministic code-generation-time and PR-time enforcement from the same FINOS CALM rules, MCP integration, source-linked violations, drift checks, and signed attestations. Those commercial behaviors were not tested because access requires evaluation/demo approval.

The site also says its repository-to-CALM generation calls an already installed coding agent—Claude Code, Codex, Gemini CLI, or Cursor—and uses no model service/API key of its own. This is very close to ANVILMARK's user-supplied-intelligence boundary.

**ANVILMARK implication:** do not invent a proprietary architecture graph without evaluating CALM. ANVILMARK may be a decision-authoring and evidence layer that emits or extends CALM, while ArchRails represents an enforcement substitute/integration.

### NodeScope

**Accessed:** August 17, 2026, public website and advertised demo link.

The public site claims scanner-backed interactive maps, accepted-versus-new drift review, source evidence with file paths/detector notes, focus modes, and maps of APIs, services, stores, and dependencies. The advertised demo redirected to a sign-in page, so none of these behaviors was observed on a live repository.

**ANVILMARK implication:** source-evidenced reconstruction and drift are clearly occupied capabilities. ANVILMARK should map repository facts to its approved decisions rather than compete as a generic architecture-map product.

### CodeBoarding

**Accessed/tested:** August 17, 2026, public live map of the CodeBoarding repository.

The live surface loaded without an account and exposed:

- a hierarchical component map;
- component drill-down and warnings;
- current branch/ref selection;
- comparison against a branch or pull request;
- clone, export, and share actions;
- an architecture summary;
- named component groups derived from the repository.

The public project states support for Python, TypeScript, JavaScript, Java, Go, and PHP, plus OpenAI, Anthropic, Google, Vercel, OpenRouter, and Ollama for agent-assisted parts.

**Not established:** policy conformance against an approved external decision contract, workload model selection, hardware fit, task quality, or effective cost.

**ANVILMARK implication:** generic repository visualization and branch impact are already credible. Prefer consuming source-evidenced maps or adopting their patterns rather than making repository diagrams the product.

## Decision rule

The first ANVILMARK vertical slice should own only the capabilities that remain fragmented or cannot preserve the same decision object across the lifecycle. Mature isolated capabilities should become optional integrations.

The observed gap after this pass is not “generate a diagram,” “evaluate a prompt,” “fit a model in VRAM,” “map a repository,” or “enforce a predefined architecture.” All five are demonstrably occupied.

The remaining integration problem is:

> Preserve one evidence-backed set of user constraints and workload decisions across managed/open/local comparison, quality proof, agent implementation, and repository conformance without requiring ANVILMARK to provide the intelligence.
