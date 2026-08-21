# ANVILMARK Decision Contract Proposal

Date: **August 17, 2026**  
Proposed version: **`0.1.0-draft.1` in `packages/project-contract`**  
Status: **Design accepted with amendments and ratified by all three developers in [`06-contract-ratification-decision.md`](06-contract-ratification-decision.md)**

## Decision this document proposes

ANVILMARK should own a versioned **decision contract** that preserves user intent, constraints, workloads, evidence, alternatives, approved choices, repository bindings, and conformance rules.

The contract is the product's durable object. Claude Code, Codex, local models, API-based models, visual interfaces, evaluation tools, hardware-fit tools, and repository scanners are replaceable producers or consumers of it.

The old `packages/contract` contract `0.1.0` remains unchanged. It represents the historical cost-audit scaffold. The project decision contract begins an independent schema line in `packages/project-contract` and must not be implemented by mutating the old schemas silently.

## Why a new contract is justified by the competitor pass

The initial hands-on pass showed that:

- Cybewave, BackArch, and ArchGenie cover idea/diagram/cloud-design portions;
- llmfit returns structured hardware-fit and speed-estimate evidence;
- promptfoo returns structured task-quality, token, latency, and cost results;
- Archcore stores typed project decisions and serves them to agents over MCP;
- FINOS CALM and ArchRails represent machine-readable architecture and deterministic enforcement;
- CodeBoarding and NodeScope cover source-derived repository architecture and drift.

No tested surface preserved the same application workload, constraints, model/deployment alternatives, evidence, approval, agent context, and repository conformance result as one portable project object.

The contract is where ANVILMARK can integrate existing capabilities without pretending to own them.

---

## 1. Governing principles

### 1.1 User approval is authoritative

An intelligence provider may propose requirements, alternatives, or decisions. It cannot mark a decision approved. Only an explicit user action can transition a proposed decision to approved.

### 1.2 Facts and recommendations are different records

The contract must distinguish:

- user-declared facts;
- deterministic observations;
- measured results;
- official vendor claims;
- source-code-established behavior;
- model-generated inference;
- unresolved unknowns.

### 1.3 Every external fact has provenance

External pricing, model, hardware, benchmark, licensing, and provider facts require:

- source locator;
- publisher;
- retrieval time;
- subject/version;
- evidence kind;
- optional expiration or refresh policy;
- confidence and caveats.

### 1.4 Hard constraints are deterministic

If a user forbids a provider, requires local redaction, sets a license boundary, or declares a fixed hardware limit, the system should evaluate the rule deterministically. An LLM explanation may accompany the result but cannot change it.

### 1.5 Quality is workload-specific

A generic leaderboard score cannot satisfy a workload quality gate. The contract may use a generic score during discovery, but approval must identify whether quality is measured, estimated, claimed, or unknown.

### 1.6 The format contains no secrets

The contract may contain credential **references**, such as environment-variable or keychain identifiers. It must never contain secret values.

### 1.7 Views are generated

Mermaid, reports, agent instructions, and UI graphs are views over the contract. They do not become competing sources of truth.

### 1.8 Compatibility is preferable to reinvention

ANVILMARK owns its architecture node and relationship IDs while exporting compatible views. FINOS CALM 1.2 is the first machine-readable export target; Mermaid is the first human-readable diagram target. Neither generated view is authoritative.

---

## 2. Proposed project layout

```text
.anvilmark/
  project.yaml
  evidence.json
  architecture/
    calm.json              # generated CALM 1.2 export; never authoritative
    view.mmd               # generated; never authoritative
  evaluations/
    manifests/
    results/
  conformance/
    rules.yaml
    latest.json
  migrations/
  generated/
    agent-context.md
```

The first prototype may store everything except large evaluation output in `project.yaml`. The split above describes the stable direction and avoids an unreviewable monolithic file.

---

## 3. Top-level contract

```yaml
schema: https://anvilmark.dev/schemas/project/0.1.0-draft.1
schema_version: 0.1.0-draft.1

project: {}
intent: {}
constraints: []
workloads: []
resources: {}
evidence_policy: {}
candidates: []
evidence_refs: []
decisions: []
architecture: {}
repository_bindings: []
conformance_rules: []
integrations: []
remote_intelligence_policy: {}
approvals: []
```

Unknown fields should be rejected during the draft phase to catch spelling and agent-generation errors. A later extension mechanism can introduce namespaced fields deliberately.

---

## 4. Identity and lifecycle

### Project

| Field               | Type                                        | Requirement                               |
| ------------------- | ------------------------------------------- | ----------------------------------------- |
| `id`                | stable string                               | Required                                  |
| `name`              | string                                      | Required                                  |
| `created_at`        | ISO timestamp                               | Required                                  |
| `updated_at`        | ISO timestamp                               | Required                                  |
| `contract_revision` | integer                                     | Required; incremented on approved changes |
| `state`             | `draft`, `active`, `superseded`, `archived` | Required                                  |
| `repository_roots`  | path references                             | Optional                                  |
| `owners`            | local identities/roles                      | Optional; no email required               |
| `priority_order`    | ordered constraint domains                  | Required for transparent tie-breaking     |

### Decision lifecycle

```text
draft → proposed → approved → superseded
                   ↘ rejected
```

An approval record contains the decision ID, local actor reference, timestamp, optional note, and a hash over the resolved decision, selected candidate, cited evidence, and constraint results. Editing any resolved approved content creates a new proposed revision; it does not rewrite approval history.

---

## 5. Intent

The intent captures what the system is for without treating generated prose as a constraint.

```yaml
intent:
  summary: >-
    Help support agents process multilingual tickets with private redaction,
    structured routing, cited drafting, and human approval.
  users:
    - support_agent
    - support_manager
  outcomes:
    - id: faster_resolution
      measure: median_handle_time
      target: "<= 8 minutes"
  non_goals:
    - autonomous response sending
  unresolved_questions: []
```

---

## 6. Constraints

Each constraint is independently addressable and testable.

```yaml
constraints:
  - id: privacy.raw_ticket_remote
    domain: privacy
    severity: hard
    subject: workload.pii_redaction.input
    operator: must_not_leave
    value: local_trust_boundary
    source: user
    rationale: Raw tickets may contain personal and contractual data.

  - id: budget.ai_monthly
    domain: cost
    severity: soft
    direction: minimize
    subject: project.ai_effective_cost_monthly_usd
    operator: lte
    value: 750
    source: user

  - id: quality.classification_f1
    domain: quality
    severity: hard
    subject: workload.classification.metric.macro_f1
    operator: gte
    value: 0.90
    source: user
```

### Initial constraint domains

- functionality;
- quality;
- cost;
- token consumption;
- latency;
- throughput;
- privacy;
- residency;
- provider/jurisdiction policy;
- licensing;
- hardware;
- availability/portability;
- operability;
- repository policy.

### Severity

- **hard:** a violating candidate cannot be approved without an explicit exception;
- **soft:** contributes to comparison through `direction: minimize | maximize | target` and may be traded off;
- **informational:** recorded but not scored.

The project records a user-declared domain `priority_order`. It breaks ties transparently; it does not collapse dimensions into an opaque weighted score.

Exceptions must reference a constraint, decision, approving user, reason, and expiry/review date.

---

## 7. Workloads

The workload is the central unit of model and deployment choice.

```yaml
workloads:
  - id: classification
    name: Ticket classification and routing
    input_classification: redacted_customer_data
    output_contract:
      kind: json_schema
      ref: ./schemas/classification-output.json
    expected_usage:
      basis: user_assumption
      calls_per_month: 40000
      input_tokens_per_call: 900
      output_tokens_per_call: 60
    latency:
      percentile: p95
      maximum_ms: 1000
    quality_gates:
      - metric: macro_f1
        minimum: 0.90
        evaluation_ref: eval.classification.v1
      - metric: schema_validity
        minimum: 0.99
        evaluation_ref: eval.classification.v1
    current_decision_ref: decision.classification.runtime.v1
```

Required distinctions:

- workload purpose;
- input/output data classification;
- estimated or measured usage;
- quality gates;
- latency/throughput requirements;
- fallback behavior;
- model/provider/runtime decision reference.

The application must not have one global “best model” field.

---

## 8. Resources and available compute

```yaml
resources:
  hardware:
    - id: hardware.local_gpu_1
      evidence_kind: user_declared
      cpu:
        cores: 16
      ram_gb: 64
      accelerators:
        - vendor: nvidia
          model: RTX 4090
          vram_gb: 24
      operating_system: linux
      evidence_refs: []
  budgets:
    - currency: USD
      period: month
      amount: 750
      scope: ai_inference_and_ai_specific_infrastructure
```

When ANVILMARK detects hardware, it records a deterministic observation as separate evidence. It must not silently replace a user-declared target machine with the machine running the analysis.

---

## 9. Candidates and comparison

A candidate represents one way to execute one workload or provide one component.

```yaml
candidates:
  - id: candidate.classification.local_a
    workload_ref: classification
    component_kind: model_runtime
    model:
      family: example-open-model
      version: exact-version-required
      quantization: Q4_K_M
      license_evidence_ref: evidence.model_license_1
    deployment:
      mode: local
      runtime: ollama
      hardware_ref: hardware.local_gpu_1
    measurements:
      quality_result_ref: eval.classification.local_a.v1
      hardware_fit_evidence_ref: evidence.llmfit.local_a
    estimates:
      tokens_per_call: 960
      latency_p95_ms: null
      monthly_effective_cost_usd: null
    constraint_results: []
    status: viable
```

### Candidate status

- discovered;
- incompatible;
- unevaluated;
- viable;
- proposed;
- selected;
- rejected;
- unavailable.

### Comparison rule

ANVILMARK should not collapse all dimensions into a single unexplained score. It may provide an optional ranking, but the contract must preserve:

- hard-constraint results;
- quality-gate results;
- cost/token/latency estimates;
- hardware-fit and operability evidence;
- missing evidence;
- trade-offs and user-selected priorities.

---

## 10. Evidence

Evidence lives in `evidence.json` and is referenced by stable ID.

```json
{
  "id": "evidence.llmfit.local_a",
  "kind": "tool_observation",
  "subject": "candidate.classification.local_a.hardware_fit",
  "producer": {
    "name": "llmfit",
    "version": "1.1.10"
  },
  "observed_at": "2026-08-17T00:00:00Z",
  "source": {
    "type": "local_command",
    "locator": "redacted-command-manifest"
  },
  "value": {
    "fit_level": "good",
    "estimated_tps": 0,
    "memory_required_gb": 0,
    "estimate_basis": {}
  },
  "confidence": "medium",
  "caveats": [],
  "refresh": {
    "policy": "on_hardware_or_model_change"
  }
}
```

### Evidence kinds

- `user_declared`;
- `deterministic_observation`;
- `tool_observation`;
- `measured_evaluation`;
- `runtime_measurement`;
- `official_documentation`;
- `official_pricing`;
- `source_code`;
- `vendor_claim`;
- `agent_inference`;
- `unknown`.

### Evidence rules

- Evidence is classified from T3 directly observed/measured through T0 inferred/unknown. Each constraint subject has a minimum tier defined in [`06-contract-ratification-decision.md`](06-contract-ratification-decision.md); evidence below it produces `unknown`.
- An agent inference cannot satisfy a hard factual constraint by itself.
- Generic benchmark evidence cannot be labelled workload measured.
- Target hardware inventory, compatibility estimates, and measured performance are different subjects with different evidence floors. Declared target hardware must never be overwritten by detected local hardware.
- Missing license data is unknown, not permissive.
- Pricing requires currency, unit, region/tier where applicable, retrieval time, and exclusions.
- Evaluation evidence requires dataset version, exact candidate/configuration, metrics, and result artifact hash.
- Runtime data must identify its collection window and coverage.

---

## 11. Decisions

```yaml
decisions:
  - id: decision.classification.runtime.v1
    revision: 1
    status: proposed
    scope:
      workload_ref: classification
    selected_candidate_ref: candidate.classification.local_a
    alternatives:
      - candidate.classification.remote_b
    satisfies_constraints:
      - quality.classification_f1
      - privacy.raw_ticket_remote
    unresolved_constraints: []
    evidence_refs:
      - evidence.llmfit.local_a
      - eval.classification.local_a.v1
    rationale:
      summary: Candidate met the declared quality and privacy gates.
      generated_by: intelligence_adapter.codex
      reviewed_by_user: false
    created_at: 2026-08-17T00:00:00Z
```

The rationale may be generated by the user's intelligence, but the contract records that fact. Approval requires `reviewed_by_user: true` plus a separate approval record over the resolved content hash.

`scope` is a discriminated union: a decision applies to one workload, one component, or the project as a whole. Model/deployment choices normally use workload scope; shared runtimes and infrastructure normally use component or project scope.

---

## 12. Architecture representation

The prototype needs nodes, relationships, trust boundaries, and workload placement. It does not need a proprietary visual-canvas format.

Ratified approach:

1. keep ANVILMARK nodes, relationships, workload/economics/evidence fields, and IDs authoritative;
2. reference ANVILMARK node/relationship IDs from decisions and repository bindings;
3. generate FINOS CALM 1.2 and Mermaid views deterministically;
4. do not import or round-trip CALM in the first slice;
5. add an editable canvas only after round-trip editing can preserve IDs and semantics.

```yaml
architecture:
  authority: anvilmark
  nodes: []
  relationships: []
  generated:
    calm_1_2: ./architecture/calm.json
    mermaid: ./architecture/view.mmd
  decision_bindings:
    - decision_ref: decision.classification.runtime.v1
      node_refs:
        - service.ticket_classifier
        - runtime.local_inference
```

The validated spike is [`spikes/atlas-calm-1.2.export.json`](spikes/atlas-calm-1.2.export.json). CALM 1.2 accepts the architecture, but ANVILMARK-specific workload, data-classification, trust-boundary, and decision references require extension metadata. CALM is therefore an export target rather than the source of truth.

---

## 13. Repository bindings

Repository bindings connect the approved decision object to observed implementation.

```yaml
repository_bindings:
  - id: binding.classification.callsite
    decision_ref: decision.classification.runtime.v1
    architecture_node_ref: service.ticket_classifier
    repository_root: app
    locations:
      - path: src/classification/service.ts
        symbol: classifyTicket
    discovery:
      kind: deterministic
      detector: typescript.call_graph
      observed_at: 2026-08-17T00:00:00Z
    confidence: high
```

Bindings may be deterministic, agent-inferred, user-confirmed, or runtime-confirmed. The source must remain visible.

---

## 14. Conformance rules

The first vertical slice should support a small deterministic rule set.

```yaml
conformance_rules:
  - id: rule.raw_ticket_never_remote
    kind: forbid_dataflow
    severity: error
    constraint_ref: privacy.raw_ticket_remote
    from:
      data_classification: raw_customer_ticket
    to:
      trust_boundary: remote_provider
    unless:
      passes_through:
        - component_ref: pii-redactor

  - id: rule.classification_runtime_allowlist
    kind: provider_allowlist
    severity: error
    workload_ref: classification
    allowed_candidate_refs:
      - candidate.classification.local_a
```

### Initial deterministic rule kinds

- provider/model allowlist or denylist;
- required component/dependency;
- forbidden dependency;
- required call path;
- forbidden data flow;
- required redaction/sanitization step;
- output-schema requirement;
- license allowlist/denylist;
- evidence-freshness requirement;
- approved-candidate binding;
- repository file/symbol ownership;
- architecture relationship/interface rule through CALM where viable.

Cost, quality, latency, and throughput rules may require runtime or evaluation evidence. If that evidence is absent, the result must be **unknown/insufficient evidence**, not pass.

### Conformance result

Every result needs:

- rule and decision/constraint reference;
- pass, fail, unknown, or not-applicable;
- repository locations;
- evidence references;
- deterministic versus inferred classification;
- explanation;
- suggested approved alternative when one exists.

---

## 15. Integrations

An integration declaration contains capability and credential references, not secrets.

```yaml
integrations:
  - id: intelligence.user_agent
    kind: intelligence
    adapter: user_selected
    credential_ref: existing_session_or_environment
    default_data_projection: public_decision_layer
    additional_data_requires_consent:
      - explicitly_selected_repository_files

  - id: evaluation.promptfoo
    kind: evaluation
    adapter: promptfoo_cli
    data_directory: .anvilmark/runtime/promptfoo
    network_policy: explicit_provider_only

  - id: hardware.llmfit
    kind: hardware_fit
    adapter: llmfit_cli
    mode: local
```

The user must be able to see which integration will receive which data before execution.

Remote intelligence uses an explicit projection rather than receiving the entire local contract:

```yaml
remote_intelligence_policy:
  default_allow:
    - intent
    - constraints
    - workloads
    - non_identifying_hardware_capabilities
    - candidates
    - evidence_metadata_without_local_locators
    - decisions
    - conformance_rule_definitions
  default_deny:
    - repository_roots
    - repository_bindings
    - file_contents
    - owners
    - local_machine_identifiers
    - integration_credential_references
    - local_command_lines
    - evaluation_rows
    - source_quoting_conformance_explanations
  show_payload_before_remote_send: true
  scan_outbound_payload_for_secrets: true
```

Selected repository content requires separate consent. Local adapters may receive a broader disclosed projection, but a local label must not silently authorize network transmission.

---

## 16. Agent delivery

The contract should be available to agents through both files and MCP.

### Proposed read-only MCP surface for the first slice

- `get_project_summary`;
- `get_constraints`;
- `get_workload_decision`;
- `get_architecture_context`;
- `get_repository_bindings`;
- `check_proposed_change`;
- `run_conformance`;
- `list_evidence_gaps`.

### Proposed mutation boundary

Agents may:

- propose structured intent/constraints;
- propose candidates and decisions;
- attach generated rationale;
- propose repository bindings;
- request evidence collection.

Agents may not:

- approve a decision;
- weaken or delete a hard constraint;
- add an exception;
- mark unknown evidence as measured;
- write secret values;
- silently change an approved revision.

Approval and exceptions require explicit user actions exposed separately from agent tools.

---

## 17. Validation invariants

The schema and engine should enforce at least these invariants:

1. all IDs are unique and references resolve;
2. approved decisions reference exact candidate and evidence revisions;
3. hard constraints cannot be marked satisfied without a conformance/evaluation result of the appropriate type;
4. selected model identifiers include an exact version or an explicit mutability warning;
5. every factual external value has provenance;
6. every estimate records assumptions;
7. every evaluation references a dataset and candidate configuration;
8. unknown is never coerced to pass;
9. generated views identify the contract revision they represent;
10. no field matching known secret patterns is accepted in persistent artifacts;
11. approvals cover a content hash;
12. editing approved content produces a new revision.

---

## 18. First prototype cut

The complete proposal is larger than the first implementation. The first vertical slice needs only:

- one YAML project contract;
- intent;
- constraints;
- workloads;
- one declared hardware resource;
- evidence tiers and per-domain floors;
- candidates;
- evidence references;
- proposed/approved decisions;
- a small authoritative ANVILMARK node/edge architecture representation;
- TypeScript repository bindings;
- two conformance rules: provider allowlist and forbidden raw-data remote flow;
- generated Mermaid and agent context;
- read-only MCP tools;
- one interactive CLI approval operation absent from MCP. This reduces accidental agent approval but is not a security boundary against an agent with unrestricted shell access.
- a remote-intelligence projection that denies repository and machine identity by default.

It does not initially need:

- a visual canvas;
- accounts or teams;
- hosted persistence;
- runtime routing;
- automatic deployment;
- broad language support;
- full cloud costing;
- automatic model downloads;
- production telemetry ingestion.

---

## 19. Ratification standing

The ten questions have recommended answers in [`05-contract-ratification-answers.md`](05-contract-ratification-answers.md) and accepted/amended resolutions in [`06-contract-ratification-decision.md`](06-contract-ratification-decision.md).

All three developers acknowledged document 06 on August 20, 2026, closing the gate for Milestone 1. The decisions are no longer open design questions; amendments must be recorded as new decisions rather than silently changing this proposal.

## Proposed acceptance condition

Ratify this contract only if it allows the team to represent the Atlas Support Desk benchmark without embedding a specific provider, coding agent, evaluation platform, hardware-fit tool, cloud, or model family into the core schema.
