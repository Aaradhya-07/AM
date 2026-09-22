# @anvilmark/project-contract

The durable, versioned **decision contract** ANVILMARK owns.

```text
PROJECT_SCHEMA_VERSION = 0.1.0-draft.5
https://anvilmark.dev/schemas/project/0.1.0-draft.5
```

This package parses, validates, resolves, hashes, and deterministically
serializes a project contract. It is the trustworthy object every later
milestone reads.

`draft.5` adds amendments 8 and 9 from
[document 09](../../docs/vnext/09-milestone-4-architecture-amendment-proposal.md),
accepted with modifications on September 14, 2026:

- every `architecture.nodes[]`, `architecture.relationships[]` and
  `architecture.decision_bindings[]` entry has an `origin`:
  `{ kind: user | agent_proposed, proposal_ref, confirmed_at,
confirmed_content_hash }`, defaulting to a user origin with nulls. A user
  origin has no proposal or confirmation fields; an agent-proposed one names
  its proposal; the confirmation timestamp and hash are present together or not
  at all;
- nodes declare `interfaces: [{ id, protocol (HTTP|HTTPS|gRPC|AMQP|TCP|other|null),
description }]`, and `connects` relationships may set
  `source_interface_ref`/`destination_interface_ref` to an interface on their own
  endpoint. Interface ids are unique across the contract;
- after normalization, a decision has at most one binding, and a binding names
  each node once. Repeated user-declared bindings are combined without losing
  associations; groups carrying agent provenance are never combined.

`architectureContentHash` is SHA-256 over the canonical JSON of
`{ format: "anvilmark-architecture-content/1", element, content }`, where the
content is the element without its origin (interfaces sorted by id, binding node
refs sorted and de-duplicated). `confirmationStanding` recomputes it:
`user_declared`, `unconfirmed`, `confirmed` or `confirmation_stale`. This is
portable content-match standing. It does not check `proposal_ref` against the
CLI's history (only local confirmation does), it does not identify a person, and
it does not resist a rewrite of the whole contract including the hash.

A `draft.4` document migrates by rewriting only `schema` and `schema_version`.
Approval hashes are unchanged, because architecture is not approval content;
this is verified against an approved fixture written by the draft.4 build
(`test/fixtures/approved-atlas.draft4.yaml`), whose stored hash was computed by
draft.3 code. Repeated user-declared bindings for one decision and duplicate node
refs are normalized to their union before integrity validation. Duplicate sets
use sorted node refs; the first binding's position and already unique bindings
are preserved. This happens in memory and does not rewrite the source file.
Groups containing agent origin remain subject to strict duplicate rejection,
as do new intelligence proposals. Three legacy cases in
`test/fixtures/draft4-binding-cases.json` were independently accepted by the
unmodified draft.4 validator and retain their approval hash after migration.

`draft.4` added amendments 6 and 7 from
[document 08](../../docs/vnext/08-milestone-3-scope-proposal.md):

- `workloads[].expected_usage.calls_per_month` may be `null`, allowed exactly
  when `basis` is the new value `unknown` (and `unknown` requires `null`). The key
  is still required, so unknown is written explicitly, never implied or read as
  zero. `unknown` is not accepted as a usage input, so a projected cost
  comparison cannot pass.
- `workloads[].output_classification` is a data-classification label or `null`
  (default, meaning not declared). Declared output labels join input labels in
  the vocabulary that constraint subjects, relationships and `forbid_dataflow`
  rules may reference.

A `draft.3` document migrates by rewriting only `schema` and `schema_version`;
normalized serialization then writes `output_classification: null` for each
workload. Approval hashes are unaffected, because workloads are not approval
content; this is verified against an approved contract hashed by the draft.3
code (`test/fixtures/approved-atlas.draft3.yaml`).

## Relationship to `@anvilmark/contract`

This is an **independent schema line**. The historical `@anvilmark/contract`
package and its `SCHEMA_VERSION = "0.1.0"` describe the earlier cost-audit
scaffold and are frozen. Nothing here modifies, migrates, or re-exports them.
The identical numeric prefix in two differently named packages is not a
collision: package and schema identity supply the namespace.

Ratified in [`docs/vnext/06-contract-ratification-decision.md`](../../docs/vnext/06-contract-ratification-decision.md) section 3.

## What the contract holds

| Section                      | Purpose                                                               |
| ---------------------------- | --------------------------------------------------------------------- |
| `project`                    | identity, lifecycle state, revision, repository roots, priority order |
| `intent`                     | summary, users, outcomes, non-goals, unresolved questions             |
| `constraints`                | hard, soft (with direction), and informational constraints            |
| `workloads`                  | the primary unit of model and deployment choice                       |
| `resources`                  | declared/detected hardware and budgets                                |
| `evidence_policy`            | T0–T3 tiers and per-subject floors                                    |
| `candidates`                 | managed, open-weight, and local ways to serve a workload              |
| `evidence_refs`              | the evidence records themselves, with provenance                      |
| `decisions`                  | workload, component, or project scoped choices                        |
| `architecture`               | authoritative nodes, relationships, trust boundaries, generated views |
| `repository_bindings`        | decisions mapped to observed implementation                           |
| `conformance_rules`          | deterministic rule declarations                                       |
| `integrations`               | adapter and credential **references**, never secrets                  |
| `remote_intelligence_policy` | what may and may not leave the machine                                |
| `approvals`                  | append-only history over resolved content hashes                      |

## Usage

```ts
import {
  parseProjectContract,
  toNormalizedYaml,
  computeApprovalHash,
  listEvidenceGaps,
} from "@anvilmark/project-contract";

const result = parseProjectContract(yamlText);
if (!result.ok) {
  for (const issue of result.issues) {
    console.error(`[${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}

const contract = result.value;
console.log(toNormalizedYaml(contract)); // byte-stable
console.log(listEvidenceGaps(contract)); // honest unknowns
```

Every fallible entry point returns a `ContractResult<T>` discriminated union
rather than throwing. `unwrap()` converts one to a `ContractValidationError`
when a throwing style is preferred.

## Validation pipeline

```text
YAML or JSON → syntax → schema → reference integrity → secret rejection
             → evidence-floor invariants → approval currentness → normalized
```

Every stage returns structured issues carrying a stable `code`, a subject
`path`, and a human-readable `message`. Invalid input is never repaired or
partially applied: on failure the caller receives issues and no contract.

## Invariants this package enforces

- Unknown fields are rejected during the draft phase.
- Ids are unique within their collection; every reference resolves to the
  correct subject type.
- A workload-scoped decision cannot select another workload's candidate.
- **Evidence below the applicable floor yields `unknown` and never satisfies a
  hard constraint.** Floors may be raised above the ratified baseline, never
  lowered.
- Declared target hardware and detected local hardware are separate subjects.
  A hardware-fit observation whose detected machine differs from the declared
  target is excluded, not counted.
- Estimates and measurements stay distinguishable: a `measurements.*` field
  citing a vendor claim or an inference is rejected.
- Credential **references** are allowed; credential **values** are rejected.
- Approval covers the decision revision, the full selected candidate, every
  cited evidence record, and the approved constraint results. Editing any of
  them makes the previous approval non-current without deleting history.
- Stable input produces byte-stable normalized output.

### Evidence tiers and admissibility

Tiers are **derived from the evidence kind**, never author-declared, so a
vendor claim cannot be relabelled as a measurement to clear a gate.

| Tier | Meaning                             | Kinds                                                                                    |
| ---- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| T3   | directly observed or measured       | `deterministic_observation`, `measured_evaluation`, `runtime_measurement`, `source_code` |
| T2   | attributable authoritative evidence | `official_documentation`, `official_pricing`, `tool_observation`                         |
| T1   | declared or claimed                 | `user_declared`, `vendor_claim`                                                          |
| T0   | inference or absence                | `agent_inference`, `unknown`                                                             |

Tier is necessary but **not sufficient**. Decision 06 section 6 states a
requirement per subject, not a universal rule that any T3 record satisfies any
T3 floor, so evidence is first filtered for **admissibility**:

| Floor subject                        | Admissible kinds                                                          |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `workload_quality_hard_gate`         | `measured_evaluation`                                                     |
| `privacy_data_flow_hard_gate`        | `deterministic_observation`, `source_code`                                |
| `latency_throughput_hard_gate`       | `measured_evaluation`, `runtime_measurement`                              |
| `token_hard_gate`                    | `deterministic_observation`, `measured_evaluation`, `runtime_measurement` |
| `projected_cost_comparison`          | `official_pricing` **plus** recorded arithmetic and usage assumptions     |
| `realized_cost_hard_gate`            | `runtime_measurement`                                                     |
| `license`                            | `official_documentation`, `source_code`                                   |
| `residency_provider_capability`      | `official_documentation`, `deterministic_observation`                     |
| `target_hardware_inventory`          | `user_declared` only                                                      |
| `hardware_compatibility_estimate`    | `tool_observation`, `measured_evaluation`, `runtime_measurement`          |
| `hardware_performance_gate`          | `measured_evaluation`, `runtime_measurement` on a **declared** target     |
| `budget_amount`                      | `user_declared` only                                                      |
| `availability_portability_structure` | `deterministic_observation`                                               |
| `repository_policy`                  | `deterministic_observation`, `source_code`                                |

Reading source code is a T3 observation, but it is not a measured evaluation of
a workload's quality. A runtime latency trace is T3, but it is not a
deterministic observation of where data flows. Inadmissible evidence is
**excluded entirely** rather than counted at a lower tier, because its tier is
irrelevant: it is not about the thing being gated.

`target_hardware_inventory` and `budget_amount` admit only `user_declared` even
though stronger tiers exist. The user's declaration is authoritative for what
they own, plan, or will spend; a detected machine must never overwrite a
declared target.

### Evidence attribution (`applies_to`)

Admissibility also requires relevance, so every evidence record carries an
optional `applies_to` block:

```yaml
applies_to:
  candidate_ref: candidate.classification.local
  workload_ref: classification
  hardware_ref: hardware.declared_target
```

`subject` is free text for humans; these structured references are what let
validation check relevance deterministically. Evidence that is not attributed
to a candidate cannot satisfy a candidate-scoped gate, and a
`measured_evaluation` whose `value.candidate_ref` disagrees with its
`applies_to.candidate_ref` is rejected outright.

`constraint_refs` names the **claims** the artifact supports, and is required
for evidence to settle a constraint:

```yaml
applies_to:
  candidate_ref: candidate.classification.local
  workload_ref: classification
  constraint_refs:
    - quality.classification_f1
    - latency.classification_p95
```

Kind and subject cannot express which claim an artifact supports. A
source-code observation of logging configuration is a T3 record admissible for
privacy in the abstract; a macro-F1 evaluation is a T3 measurement of the right
candidate and workload. Neither settles the specific constraint it happens to
be cited for. Evidence whose `constraint_refs` does not contain the constraint
being evaluated is excluded and yields `unknown`.

The field is an array because one artifact may legitimately support several
claims — but only those it lists. Duplicate entries are rejected, and every
entry must resolve to a declared constraint. Evidence cited by a
`constraint_results` entry must name that result's `constraint_ref`; direct
`measurements.*` references are exempt, since they describe the candidate
rather than a particular claim.

### Evaluation context is required and fails closed

`assessEvidence` and `evaluateConstraint` take a **mandatory** `EvidenceContext`
describing what the evidence is being asked to speak about:

```ts
evaluateConstraint(constraint, "pass", cited, policy, {
  candidateRef: "candidate.classification.local",
  workloadRef: "classification",
  declaredTargetHardwareRefs: ["hardware.local_gpu_1"],
  deploymentHardwareRef: "hardware.local_gpu_1",
  hasExplicitCostCalculation: true,
  hasDeclaredUsageInputs: true,
});
```

Every field is optional in the type but **required in effect** for the subjects
that need it, and a missing field is treated as insufficient evidence rather
than as permission to skip the check. Omitting `candidateRef` on a
candidate-scoped gate yields `unknown`, not `pass`. Passing `{}` is legal and
safe; it simply cannot clear a gate that needs context. A JavaScript caller who
omits the argument entirely gets the same fail-closed result rather than a
crash.

A projected-cost `pass` requires **all** of: admissible `official_pricing`
evidence, a recorded projected monthly cost, a non-null calculation basis, and
workload usage inputs with their assumptions written down. The validator
derives `hasDeclaredUsageInputs` from the workload's `expected_usage.basis`,
which must be `user_assumption` or `measured` — prose on the candidate is not
usage evidence, `agent_inference` is T0 and settles nothing, and a
`vendor_claim` is not acceptable either, because a model or provider vendor
cannot establish how many calls the user's application will make. Both flags
must be explicitly `true`; `undefined` fails closed.

Hardware gates require the candidate's own `deploymentHardwareRef`, which must
itself be a user-declared target. Being _a_ declared machine somewhere in the
contract is not enough, and a `tool_observation` must name both
`target_hardware_ref` and `detected_hardware_ref`.

### Evaluation identity

A `measured_evaluation` carries `value.identity` naming the workload, dataset,
prompt, evaluator, model configuration, config digest, and — required and
non-null — the `provider_id` the run used. A candidate that cites one must
declare `measurements.expected_evaluation`, and admission refuses the evidence
when that expectation is absent, when the provider differs, or when the
configuration hash differs. The check lives in `admitEvidence`, not in a helper
a caller must remember to call, because that is how a stale result keeps
clearing a gate.

### Approval verification

`parseProjectContract` recomputes every stored approval hash for a decision's
**current** revision. A forged hash, or content edited after approval, fails
validation with `approval_hash_mismatch`. An approval of an **earlier**
revision is valid history: it is reported stale by `approvalState` rather than
rejected, because rewriting history is what the contract forbids.

Resolved approval content closes over the **union** of the decision's own
`evidence_refs` and the evidence cited by every approved constraint result, so
a caller who forgets to duplicate an id cannot leave supporting evidence
editable without invalidating the approval.

## Dependencies

| Package          | Version  | Licence | Maintenance                                     | Data flow                                              | Reason                                                                                          |
| ---------------- | -------- | ------- | ----------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `zod`            | `^4.2.0` | MIT     | Actively maintained; already used repo-wide     | In-process only. No I/O, no network.                   | Runtime schema validation with inferred TypeScript types, matching existing repo convention.    |
| `js-yaml`        | `^4.3.1` | MIT     | Mature, widely deployed YAML 1.2 implementation | In-process only. Parses and emits strings; no network. | The contract is authored in YAML. Writing a YAML parser would be a large correctness liability. |
| `@types/js-yaml` | `^4.0.9` | MIT     | DefinitelyTyped                                 | Types only; no runtime code.                           | `js-yaml` ships no bundled type declarations.                                                   |

`js-yaml` is loaded with `JSON_SCHEMA` rather than its default YAML 1.1 schema.
The default schema converts an unquoted `2026-08-17T00:00:00Z` into a
JavaScript `Date` and applies other YAML 1.1 coercions. A `Date` cannot be
canonically serialized, so restricting scalars to the JSON set is what keeps
timestamps stable and round trips faithful.

## Determinism

Object keys are emitted in lexicographic order and array order is preserved, so
`priority_order`, `constraints`, and every other semantically ordered array
survive a round trip unchanged. Lexicographic ordering is used rather than
schema-declaration order because it cannot be perturbed by refactoring a schema
module.

Approval hashes are SHA-256 over compact canonical JSON of the resolved
content, so they are stable across machines, key orderings, and repeated runs.

## Scope

This package holds the contract and its pure checks. It deliberately does
**not** contain candidate selection, evaluation or hardware adapters, an
approval or confirmation CLI, history verification, Mermaid or CALM generation,
MCP tools, repository parsing, or conformance execution.

## Tests

```bash
pnpm --filter @anvilmark/project-contract test
```
