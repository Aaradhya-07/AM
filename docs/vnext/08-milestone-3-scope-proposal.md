# 08 — Milestone 3 scope proposal: partial workloads, output classification, proposal scope and network policy

Date: **September 14, 2026**
Status: **Accepted by Anurag on September 14, 2026, under the new scoped
exception recorded below; implemented as project-contract `0.1.0-draft.4` and
in the Milestone 3 CLI. Not acknowledged by Navaneeth or Aaradhya.**

The four decisions are recorded under "Recorded decisions" at the end of this
document. The proposal text below is kept as it was written, so the decisions
can be read against it; where a section says "proposed" or "if accepted", the
recorded decision now applies. The alternatives in items 3 and 4 were **not**
adopted. The scoped acknowledgement exception recorded in document 07 covered
amendments 1–4 only and is not extended here. Amendment 5 remains proposed and
deferred and is not affected.

## Why this document exists

The Milestone 3 implementation record listed six places where the milestone's
wording and the ratified schema (`0.1.0-draft.3`) or adapter protocol
(`0.1.0-draft.1`) do not line up, and then called five of them non-blocking.
The independent review of `4484049` correctly pointed out that this was an
implementation assertion, not a scope decision: a schema limitation does not by
itself waive a milestone requirement.

This document makes each item concrete — exact fields, defaults, invariants and
compatibility impact where a change is proposed, and an explicit disposition
where one is not — so the team can decide each one. Until it decides, the items
marked **unmet** below remain unmet, and Milestone 3 is not complete.

## Summary

| #   | Milestone 3 requirement                                                                                                                                             | Behaviour at this commit                                                                                                                                                                          | Proposed disposition                                                                                                                                           | Status now                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Preserve a workload whose usage is unknown ("save incomplete drafts with explicit unknowns"; "a partial but valid contract is preferable to invented completeness") | A workload with unknown monthly calls cannot be stored; its known details are kept only as the text of an unresolved question                                                                     | **Amendment 6**: nullable usage with an explicit `unknown` basis                                                                                               | **Unmet** pending decision                                                 |
| 2   | "Separate workloads and their input/output classifications"                                                                                                         | Input classification and output **format** (`output_contract`) are stored; output **data classification** has no field                                                                            | **Amendment 7**: nullable `output_classification` on a workload                                                                                                | **Unmet** pending decision                                                 |
| 3   | A response "may propose … architecture elements … and evidence requests"                                                                                            | Such fields are rejected as unknown; evidence still required is derived deterministically by `compare`                                                                                            | **Defer by decision** (architecture proposals to Milestone 4; structured evidence requests to a later protocol revision). Alternative field shapes given below | **Unmet** pending decision                                                 |
| 4   | "Initialization records … network policy"                                                                                                                           | Recorded as the remote-intelligence posture: `remote_intelligence_policy.default_allow` plus host registration plus per-request consent. No project-wide or evaluation network enforcement exists | **Narrow by decision** to the remote-intelligence posture, documented as such. Alternative schema field given below                                            | **Unmet as worded**; met only under the narrowed wording, pending decision |
| 5   | Usage and **burst** assumptions                                                                                                                                     | Burst recorded as an informational `throughput` constraint (`condition: burst`)                                                                                                                   | No schema change: existing representation                                                                                                                      | **Implemented**                                                            |
| 6   | Rationale provenance for generated candidates                                                                                                                       | Generated candidate rationale is kept in the state revision's provenance; `review` and `approve` now show a candidate's originating proposal, adapter and generated rationale                     | No schema change                                                                                                                                               | **Implemented**                                                            |

## Amendment 6 — partial workloads with unknown usage (proposed)

### Change

In `packages/project-contract/src/schema/workloads.ts`:

```text
UsageBasisSchema
  before: "user_assumption" | "measured" | "vendor_claim" | "agent_inference"
  after:  "user_assumption" | "measured" | "vendor_claim" | "agent_inference" | "unknown"

ExpectedUsageSchema.calls_per_month
  before: number >= 0                (required)
  after:  number >= 0 | null         (required key; no default)

New invariant on ExpectedUsageSchema:
  calls_per_month === null  <=>  basis === "unknown"
```

Token fields (`input_tokens_per_call`, `output_tokens_per_call`,
`reasoning_tokens_per_call`) are already nullable and are unchanged. The key
stays required, so "unknown" is always written explicitly as `null` with basis
`unknown`, never implied by omission.

`output_contract` stays required. A workload whose output format is also
unknown is still recorded as a question. Making `output_contract` nullable is a
larger change and is deliberately not proposed here.

### Evaluation consequences

- `basis: unknown` already fails closed: both
  `validate/integrity.ts` (`usageIsUserEstablished`) and
  `adapters/src/evidence/gaps.ts` accept only `user_assumption` or `measured`
  as usage inputs, so no projected-cost comparison can pass for a workload with
  unknown usage. No evidence-tier rule changes.
- The gap report gains one additive code, `missing_usage`, emitted once per
  workload whose `calls_per_month` is null.

### CLI behaviour if accepted

- `workload add` without `--calls-per-month` records `calls_per_month: null`,
  `basis: unknown`, instead of refusing.
- Elicitation keeps the workload and records the volume as unknown instead of
  replacing the workload with a question.
- A new `workload usage ID --calls-per-month N --usage-basis BASIS` fills it in
  later.
- `compare` shows "usage unknown" for the workload and lists `missing_usage`.

### Compatibility

- **Schema version** moves from `0.1.0-draft.3` to `0.1.0-draft.4`. Because
  `schema_version` is a strict literal, a draft.3 document must have its
  `schema` and `schema_version` rewritten; **no content change** is needed,
  since every draft.3 usage value remains valid.
- **Atlas fixture:** version fields only.
- **Approval hashes:** unaffected. `ResolvedApprovalContent` covers the
  decision revision, selected candidate, cited evidence and constraint results,
  not workloads.
- **Evaluation identity and configuration hashes:** unaffected.
- **Remote projection:** workloads are projected as stored, so an intelligence
  sees `calls_per_month: null, basis: "unknown"`. The request instructions
  would say that null means unknown.
- **Consumers** that do arithmetic on `calls_per_month` must handle `null`. In
  this repository that is display code in `packages/cli/src/workflow/compare.ts`
  only.

## Amendment 7 — workload output data classification (proposed)

### Change

In `packages/project-contract/src/schema/workloads.ts`, `WorkloadSchema` gains:

```text
output_classification: DataClassification | null     default: null
```

`DataClassification` is the existing lower_snake_case label type. `null`
means "not declared", which is treated as unknown, never as "not sensitive".

In `packages/project-contract/src/validate/integrity.ts`, the data
classification vocabulary becomes the union of workload input **and** output
classifications, so a constraint subject `data.<label>`, a relationship's
`data_classification`, or a `forbid_dataflow` rule may name an output label.
The refusal message changes from "which no workload declares as an input" to
"which no workload declares as an input or output".

In `packages/adapters/src/intelligence/projection.ts`,
`data_classification_labels` includes output labels.

### CLI behaviour if accepted

- `workload add --output-classification LABEL`; omitted means `null`.
- Elicitation asks for it; `?` records `null` and an unresolved question.
- `compare` and `status` show it, or "output classification not declared".

### Compatibility

- **Additive with a default**, so every draft.3 workload content is valid.
  Proposed to ship in the same `0.1.0-draft.4` as Amendment 6.
- **Canonical serialization changes bytes:** a re-serialized workload gains
  `output_classification: null`. No approval hash changes (workloads are not
  approval content).
- **Atlas fixture:** no required content change. The team may choose to
  declare Atlas's actual output classifications as a separate, reviewed edit.

## Item 3 — architecture-element proposals and structured evidence requests

### Proposed disposition: defer by decision

- **Architecture-element proposals → Milestone 4.** Architecture views,
  CALM and Mermaid generation belong to Milestone 4, and the architecture graph
  has no provenance field that could mark a node as agent-proposed. Accepting
  proposed nodes before that milestone would put unattributed generated
  structure into the authoritative graph.
- **Structured evidence requests → a later adapter-protocol revision.** In
  Milestone 3 the evidence still required is derived deterministically by
  `compare` from the gap report, and an intelligence can express a need only as
  a `question`. A generated evidence request is not more authoritative than the
  deterministic gap, so this loses no protection.
- **Behaviour stays as it is:** responses carrying these fields are rejected as
  unknown fields; nothing is silently added.

If deferral is accepted, the Milestone 3 wording should be amended to read that
a response may propose constraints, candidates, questions, inferences and
rationale, with architecture elements deferred to Milestone 4.

### Alternative, if the team wants them in Milestone 3

Adapter protocol `0.1.0-draft.2`, additive to `IntelligenceProposalSchema`:

```text
proposed_architecture_nodes: [{ id, kind, name, trust_boundary, description|null }]   default []
proposed_relationships:      [{ id, kind, source, destination, workload_ref|null,
                                 data_classification|null }]                        default []
evidence_requests:           [{ constraint_ref, candidate_ref|null,
                                 requested_kind: EvidenceKind, reason }]             default []
```

- Nodes and relationships would be added to `architecture` under the existing
  schema, with origin recorded only in state-revision provenance; ids must be
  new, as for constraints and candidates.
- Evidence requests would never become evidence: they would be stored in the
  proposal record and shown next to the deterministic gaps in `compare`.
- `protocol_version` would accept both `0.1.0-draft.1` and `0.1.0-draft.2`
  responses. The request instructions change, so request digests change.
- No project-contract schema change; a trust-boundary review of generated
  `trust_boundary` values would be required before proposed nodes could affect
  conformance rules in Milestone 6.

## Item 4 — network policy

### What exists

- `remote_intelligence_policy.default_allow` decides what may be projected to
  remote intelligence; `init --remote-intelligence nothing` makes it empty.
- Host configuration outside the project decides which providers exist; with
  none, nothing remote can run.
- Each remote send needs interactive consent to the exact request.
- `integrations[kind=evaluation].network_policy` exists in the schema, but the
  Milestone 3 CLI runs no evaluation and does not enforce it.
- Nothing observes or restricts the network. Destinations are declared policy.

### Proposed disposition: narrow the requirement by decision

Amend "Initialization records … network policy" to "Initialization records the
remote-intelligence posture: which contract categories may be projected to
remote intelligence. Provider registration is host configuration; sending
requires per-request consent. Project-wide and evaluation network enforcement
are out of Milestone 3 scope." Documentation already states that no runtime,
evaluation or network enforcement exists.

### Alternative: an explicit field

Additive to `RemoteIntelligencePolicySchema` (would ship in `0.1.0-draft.4`):

```text
remote_sending: "disabled" | "consent_per_request"      default: "consent_per_request"
```

- `init --remote-intelligence nothing` would set `disabled`, and the CLI would
  refuse remote sends and handoff exports when it is `disabled`, whatever
  `default_allow` contains.
- The default preserves the meaning of every draft.3 document.
- This makes the posture explicit instead of inferred from an empty list, but
  it is still a remote-intelligence policy, not network enforcement.

## Decision requested

For each of Amendment 6, Amendment 7, Item 3 and Item 4, each developer —
Anurag, Navaneeth and Aaradhya — records one of: **accept as proposed**,
**accept the alternative**, **reject**, or **modify** (with the modification).
Only decisions actually supplied are recorded. No decision is recorded here.

```text
Developer:
Amendment 6 (partial workloads):          accept | reject | modify: ...
Amendment 7 (output classification):      accept | reject | modify: ...
Item 3 (architecture/evidence requests):  defer | alternative | modify: ...
Item 4 (network policy):                  narrow | alternative field | modify: ...
Date:
```

## If accepted: implementation outline

- `project-contract`: schema changes, invariant, integrity vocabulary, version
  literal `0.1.0-draft.4`, Atlas fixture version bump, schema and integrity
  tests for null usage, the basis invariant in both directions, and output-label
  references.
- `adapters`: `missing_usage` gap code and tests; output labels in the
  projection; request-instruction wording for null usage.
- `cli`: `workload add` without volume, `workload usage`,
  `--output-classification`, elicitation changes, `compare`/`status` display,
  and the corresponding CLI tests; replacing the current "refuses to guess
  unknown usage" test with "keeps a workload whose usage is unknown".
- Documentation: document 07 style amendment record, milestone record update.

## Recorded decisions

### Anurag — September 14, 2026

Supplied in the Claude Code session on September 14, 2026 (received at 09:13
IST). Recorded as supplied, in substance:

1. **Amendment 6: accept as proposed.** Nullable `calls_per_month` with the
   explicit `unknown` basis and the invariant in both directions. Workloads with
   unknown monthly usage are preserved, `missing_usage` is reported, and
   projected-cost conclusions stay blocked while usage is unknown. The proposal's
   limitation stands: an unknown output **format** is still recorded as a
   question.
2. **Amendment 7: accept as proposed.** Nullable `output_classification`,
   default `null` meaning unknown; declared output labels are included in
   reference validation and in remote projection labels.
3. **Item 3: defer.** Architecture-element proposals are deferred to Milestone
   4 and structured evidence requests to a later adapter-protocol revision.
   Deterministic evidence gaps are kept and unsupported proposal fields are
   rejected. The alternative protocol expansion is **not** implemented.
4. **Item 4: narrow.** The Milestone 3 initialization requirement is narrowed
   to the existing remote-intelligence posture, host provider registration and
   per-request consent. The alternative `remote_sending` field is **not** added,
   and no runtime or network enforcement is claimed.

### Scoped acknowledgement exception — September 14, 2026

Anurag authorized proceeding on his acceptance alone, without waiting for
Navaneeth or Aaradhya, **for these four decisions only**. This is a new
exception. It does not extend or reinterpret the September 13, 2026 exception
in document 07, which remains limited to amendments 1–4. No approval or
acknowledgement is attributed to Navaneeth or Aaradhya. Amendment 5 is
unchanged: proposed and deferred.

**Navaneeth** and **Aaradhya**: no decision supplied. Nothing is recorded for
them.

### What was implemented

- `packages/project-contract` `0.1.0-draft.4`: `UsageBasisSchema` gains
  `unknown`; `expected_usage.calls_per_month` is a required key that may be
  `null`, with `null` allowed exactly when `basis` is `unknown`;
  `Workload.output_classification` is `DataClassification | null`, default
  `null`; the data-classification vocabulary used by constraint subjects,
  relationships and `forbid_dataflow` rules is the union of declared input and
  output labels. `basis: unknown` fails closed for projected cost, as before.
- `packages/adapters`: gap code `missing_usage` (required floor T1, admissible
  `user_declared` or `runtime_measurement`); declared output labels in
  `data_classification_labels`; request instructions say what `null` means.
- `packages/cli`: `workload add` records unknown usage when no volume is given
  and accepts `--output-classification`; new `workload usage` and
  `workload output-classification` commands; elicitation keeps a workload with
  unknown usage and asks for its output classification; `status` and `compare`
  show both unknowns.
- Atlas fixture: version fields only; no output labels were inferred.
- Compatibility verified: a draft.3 document migrates by rewriting only
  `schema` and `schema_version`; normalized serialization then writes
  `output_classification: null` for each workload. An approved contract
  generated and hashed by the unmodified `f66bae6` (draft.3) build keeps its
  approval current after migration and after re-serialization
  (`packages/project-contract/test/draft4-amendments.test.ts`).
