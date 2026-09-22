# Milestone 4 — architecture amendments 8 and 9

Date: **September 14, 2026**\
Status: **Amendments 8 and 9 accepted with modifications, and both interpretations accepted as clarified, by Anurag on September 14, 2026, under the new acknowledgement exception recorded below.** The accepted specification is in "Accepted specification"; the original proposal follows it unchanged, so the decision can be read against it.

Authority: document 06 as amended by documents 07 (amendments 1–4), 08
(amendments 6–7 and the Milestone 3 scope decisions) and this document
(amendments 8–9 and the two Milestone 4 interpretations). Amendment 5 remains
proposed and deferred. Structured evidence requests remain deferred.

## Recorded decision

**Decided by:** Anurag, on September 14, 2026, in his instruction to implement
the Milestone 4 corrections. The decision took effect when that instruction was
given. The independent review of `efb5539` recommended acceptance with
clarifications; that review is not the approval.

**Decision:**

- **Amendment 8** (attributable architecture proposals): **accepted with
  modifications** — project contract `0.1.0-draft.5` and intelligence proposal
  protocol `0.1.0-draft.2`, with a content-bound confirmation hash, portable
  content-match standing separated from local history verification, explicit
  interactive confirmation targets, inferred standing for unconfirmed or stale
  elements with unknown effective trust conclusions, and strict
  version-specific proposal validation.
- **Amendment 9** (declared interfaces): **accepted with export
  clarifications** — interface ids through native CALM 1.2 node interfaces and
  connects interface references; ANVILMARK protocol and description only in
  `metadata.anvilmark`; nothing inferred; interface edits participate in
  confirmation invalidation.
- **Interpretation — `as_of`:** accepted as the persisted, reproducible
  evaluation instant, provided present freshness is evaluated and reported
  separately. An old snapshot is never called current because its bytes are
  unchanged, and an explicitly historical snapshot is labelled as such.
- **Interpretation — workload placement:** accepted as derivation of workload
  **associations** through relationships, labelled that way. Actual execution
  placement is undeclared. No placement field is authorized.

**Acknowledgement exception.** Anurag authorized proceeding on his acceptance
without waiting for Navaneeth or Aaradhya. This exception is limited to the
Milestone 4 decisions listed above. It does not extend the exceptions recorded
in documents 07 and 08, it does not apply to any future amendment, and no
decision here is attributed to Navaneeth or Aaradhya.

## Accepted specification

This is the exact specification implemented. Where it differs from the
original proposal below, this section governs.

### Schema `0.1.0-draft.5`

`schema` becomes `https://anvilmark.dev/schemas/project/0.1.0-draft.5` and
`schema_version` becomes `0.1.0-draft.5`.

**Origin** — added to every `architecture.nodes[]`, `architecture.relationships[]`
and `architecture.decision_bindings[]` entry:

```text
origin: {
  kind: "user" | "agent_proposed",              default "user"
  proposal_ref: Ref | null,                     default null
  confirmed_at: Timestamp | null,               default null
  confirmed_content_hash: Sha256Hex | null,     default null   (64 lower-case hex characters)
}                                               default { kind: "user", … all null }
```

**Interfaces** — added to `architecture.nodes[]`:

```text
interfaces: [{
  id: Id,
  protocol: "HTTP" | "HTTPS" | "gRPC" | "AMQP" | "TCP" | "other" | null,   default null
  description: NonEmptyString | null,                                    default null
}]                                                                        default []
```

and to `architecture.relationships[]`:

```text
source_interface_ref: Ref | null                default null
destination_interface_ref: Ref | null           default null
```

**Invariants** (schema):

- O1. `origin.kind: "user"` requires `proposal_ref`, `confirmed_at` and
  `confirmed_content_hash` to be null.
- O2. `origin.kind: "agent_proposed"` requires a non-null `proposal_ref`.
- O3. `confirmed_at` and `confirmed_content_hash` are both null or both
  present.

**Invariants** (integrity):

- I1. Interface ids are unique across the contract.
- I2. `source_interface_ref` names an interface declared on the relationship's
  `source` node; `destination_interface_ref` one declared on its
  `destination` node.
- I3. Only `connects` relationships may name interfaces.
- I4. The normalized contract has at most one decision binding per
  `decision_ref`, so a binding is addressed by its decision.
- I5. A normalized binding's `node_refs` contains no duplicate.

Before integrity validation, repeated user-declared bindings for a decision
are combined into the union of their node refs, without losing associations.
Duplicate sets use sorted node refs and keep the first binding's position;
already unique bindings are unchanged. A group containing any agent-origin
binding is not combined or deduplicated: I4/I5 reject it if duplicated. Proposal
import independently rejects duplicate additions before contract normalization.
These representation invariants do not require manual repair of valid draft.4
documents.

### Architecture content hash (confirmation)

`confirmed_content_hash` is SHA-256, lower-case hex, over the UTF-8 bytes of the
canonical JSON (keys sorted, no whitespace; the same canonicalization as
approval hashes) of:

```text
{ "format": "anvilmark-architecture-content/1", "element": ELEMENT, "content": CONTENT }
```

| `ELEMENT`          | `CONTENT` (origin always excluded)                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `node`             | `id, kind, name, trust_boundary, description, interfaces` — interfaces sorted by `id`, each `{ id, protocol, description }` |
| `relationship`     | `id, kind, source, destination, workload_ref, data_classification, source_interface_ref, destination_interface_ref`         |
| `decision_binding` | `decision_ref, node_refs` — `node_refs` sorted, duplicates removed                                                          |

The element name separates the three domains, so equal content in different
element types never produces the same hash. The format string versions the
payload; a future change to it is a new format and a new amendment.

**Confirmation standing** is derived, never stored:

| Origin                                                   | Standing             | Trusted for effective conclusions |
| -------------------------------------------------------- | -------------------- | --------------------------------- |
| `kind: user`                                             | `user_declared`      | yes                               |
| `agent_proposed`, `confirmed_at: null`                   | `unconfirmed`        | no                                |
| `agent_proposed`, recomputed hash equals the stored hash | `confirmed`          | yes                               |
| `agent_proposed`, recomputed hash differs                | `confirmation_stale` | no                                |

A stale confirmation is kept, not erased, so it can be inspected. Portable
parsing and projections (project-contract, context, MCP) validate origin shape
and derive this content-match standing without filesystem access; they do
**not** claim the `proposal_ref` was verified against local history. The hash
is content integrity: it shows the element is the one a user confirmed, not who
the user was, and it does not protect against someone rewriting the whole
contract, including the hash.

### Protocol `0.1.0-draft.2`

Intelligence requests built by the CLI declare `protocol_version:
"0.1.0-draft.2"` and a new task `propose_architecture`; request schemas accept
both `0.1.0-draft.1` and `0.1.0-draft.2`, so previously exported requests still
import. The evidence-adapter envelope version is unchanged
(`0.1.0-draft.1`).

Proposals are validated strictly by version:

- `0.1.0-draft.1`: exactly the Milestone 3 fields. Architecture arrays are
  rejected as forbidden fields.
- `0.1.0-draft.2`: the Milestone 3 fields plus

```text
proposed_architecture_nodes:  [{ id, kind, name, trust_boundary, description|null }]      default []
proposed_relationships:       [{ id, kind, source, destination, workload_ref|null,
                                  data_classification|null }]                            default []
proposed_decision_bindings:   [{ decision_ref, node_refs (at least one) }]               default []
```

Each entry is strict: `origin`, confirmation fields, interfaces and interface
references cannot be supplied. Import (all or nothing) refuses an existing or
duplicated node or relationship id, a binding for a decision that already has
a binding (a proposal never extends an existing binding), a duplicated
binding, and references to nodes that neither exist nor are proposed in the
same document; workload, classification and decision references must resolve.
Imported elements get `origin: { kind: "agent_proposed", proposal_ref:
PROPOSAL_ID, confirmed_at: null, confirmed_content_hash: null }` and are
committed with the proposal record in one state revision under the existing
history protocol. Approved-content protection, secret scanning and the
request-digest binding of handoff responses are unchanged.

### Local confirmation

```text
anvilmark architecture confirm node ID
anvilmark architecture confirm relationship ID
anvilmark architecture confirm binding DECISION_REF
```

- Requires an interactive terminal; shows the element, its origin and proposal,
  and its content hash; the user types the first 12 characters of the hash.
- Before writing, verifies that `proposal_ref` names a proposal applied in a
  **committed** state revision whose record lists this element. A proposal that
  is missing, only in an ambiguous, abandoned or uncommitted revision, or whose
  record does not list the element refuses confirmation.
- Re-reads `project.yaml` and refuses if it changed since display; commits
  `confirmed_at` and `confirmed_content_hash` with history provenance
  `architecture_confirmation`.
- Keeps `kind: agent_proposed` and `proposal_ref`. Confirmation does not approve
  a decision, make anything measured, or authorize any remote evaluation.
- No adapter, MCP tool, ordinary edit or proposal import sets confirmation. CLI
  edits to confirmed agent-proposed content (node, interface, relationship or
  binding) clear both confirmation fields when the covered content changes. A
  manual edit leaves them in place, where the recomputed hash no longer matches
  and the standing is `confirmation_stale` until confirmed again.

### Effective conclusions

- Unconfirmed and stale elements are labelled `inferred`; their declared
  values stay visible for review.
- A node's effective trust boundary is its declared boundary only when trusted,
  otherwise `unknown`.
- A `connects`/`uses` relationship's effective crossing is `crossing` or `none`
  only when the relationship and both endpoint nodes are trusted; otherwise
  `unknown`, with the declared boundaries shown. A possible crossing is never
  shown as absent.
- Links derived from an untrusted element (an unconfirmed binding, an
  association through an unconfirmed relationship) are marked
  non-authoritative and do not count as decision or constraint support.
- Confirmed agent-proposed elements are `declared` (confirmed), never
  `measured`. Conformance enforcement of these standings is Milestone 6.

### Interfaces in exports

- CALM 1.2: each declared interface is emitted as a node interface
  `{ "unique-id": ID }`; `connects` source and destination carry
  `interfaces: [ID]` when declared. The ANVILMARK protocol and description are
  in the owning node's `metadata.anvilmark.interfaces`, keyed by interface id,
  with null kept as null. No relationship `protocol`, port, host, endpoint or
  URL is emitted.
- Mermaid and agent context show declared interface ids on relationships and
  per node, with unknown protocols shown as unknown.

### Compatibility and hashes

- A draft.4 document migrates by changing `schema` and `schema_version` only;
  every element defaults to `origin.kind: user` and no interfaces. Repeated
  decision bindings and node refs are normalized as user-declared sets before
  I4/I5, preserving every decision-to-node association. No manual merge is
  needed, no agent provenance is converted to user origin, and parsing does
  not write the source file.
- Normalized serialization then writes `origin`, `interfaces` and the interface
  refs explicitly.
- **Approval hashes do not change**: architecture is not approval content.
- The canonical contract hash changes on migration, and the generator identity
  advances to `anvilmark-context/0.1.0-draft.2`, so generated output from
  draft.4 reports `stale_source` and `stale_generator` until regenerated.

### Tests required

Schema defaults and O1–O3/I1–I5 in both directions; draft.4 migration by version
lines of a fixture produced by the unmodified draft.4 build, with its approval
hash recomputed unchanged; hash domain separation, set canonicalization and
edit sensitivity; protocol draft.1 rejection and draft.2 acceptance and every
refusal above; atomic import with provenance; confirmation refusals (not
interactive, user origin, missing/ambiguous/abandoned/mismatched provenance,
changed during review) and success with history; invalidation by CLI edits and
stale standing after manual edits; inferred and unknown effective conclusions
in facts, Mermaid, CALM, agent context and MCP; CALM validation with interfaces,
null protocols, multiple interfaces and negative references; old generated
output reported stale.

## Implementation notes

Implemented as specified on September 14, 2026; the milestone record lists the
commits, tests and validation. Choices made within the specification:

- The follow-up to review `1b944fd` restores the accepted draft.4 migration
  promise. That implementation initially treated I4/I5 as input rejections
  requiring users to merge legacy bindings manually. That extra prerequisite
  was an implementation error, not a condition of Anurag's decision. I4/I5 now
  describe normalized output, with agent-origin duplicates still rejected.

- Proposed nodes cannot declare interfaces and proposed relationships cannot
  reference them; users declare interfaces.
- Existing architecture is not added to the intelligence projection, so the
  projection policy is unchanged; request instructions tell the agent to
  reference only nodes it proposes unless the user supplies existing ids.
- A CLI edit clears confirmation only for elements whose covered content that
  edit changed; a confirmation already stale from a manual edit is kept for
  inspection until the element is edited or confirmed again.
- Links through untrusted elements are reported with `authoritative: false`
  rather than removed.

## Original proposal

The text below is the proposal as written before the decision.

### Summary

| #   | Requirement                                                                                                                                             | Behaviour at this commit                                                                                                                                                                     | Proposal                                                                   | Status now                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------- |
| A   | Architecture-element proposals, deferred to Milestone 4 by the Milestone 3 decision on item 3 (the alternative protocol expansion was **not** accepted) | Users declare nodes, relationships and bindings through `anvilmark architecture`. Intelligence responses carrying architecture fields are still rejected as unknown fields; nothing is added | **Amendment 8**: provenance on architecture elements plus protocol draft.2 | **Unmet** pending decision |
| B   | "Interfaces where required" in the authoritative model, and CALM export of nodes, relationships **and interfaces**                                      | No interface field exists. Nothing is invented: the CALM export omits `interfaces` and `protocol`, and the official CALM CLI validates it without them                                       | **Amendment 9**: optional declared interfaces                              | **Unmet** pending decision |

Two further points are interpretations of existing wording, recorded here so
review can reject them if the team disagrees; they need no schema change:

- **"Generation time".** Each artifact records `as_of` — the explicit instant at
  which evidence freshness and exception expiry were evaluated — and the
  manifest records it too. `as_of` is either given with `--as-of`, reused from
  a manifest for an unchanged source, or taken once from the clock and
  recorded. The wall-clock time of each regeneration is deliberately **not**
  written, because it would make regeneration of an unchanged contract
  byte-unstable. `project.updated_at` is never used as a generation time.
- **"Workload placement".** No field places a workload on a node. Placement is
  derived from the `workload_ref` of relationships touching a node, and every
  output labels it as derived ("workloads placed here (from relationships)").
  If explicit placement is wanted, it belongs in a future amendment.

### Amendment 8 — attributable architecture proposals

#### Problem

The Milestone 3 decision deferred architecture-element proposals to Milestone 4
because the architecture graph has no field that could mark an element as
agent-proposed. That is still true in draft.4. Accepting proposed nodes through
the draft.1 protocol would put unattributed generated structure — including
generated **trust boundaries**, which the privacy rules depend on — into the
authoritative graph. Milestone 4 therefore does not accept them.

#### Proposed schema change (project contract `0.1.0-draft.5`)

Additive to `ArchitectureNodeSchema` and `ArchitectureRelationshipSchema`:

```text
origin: {
  kind: "user" | "agent_proposed",          default "user"
  proposal_ref: Ref | null,                 default null
  confirmed_at: Timestamp | null,           default null
}
```

Additive to `DecisionBindingSchema`: the same `origin` object.

Invariants:

1. `kind: "user"` requires `proposal_ref: null`.
2. `kind: "agent_proposed"` requires `proposal_ref` naming an applied proposal
   record in committed history.
3. An element with `kind: "agent_proposed"` and `confirmed_at: null` is
   **unconfirmed**. Generated views and MCP responses label it `inferred`, and
   its trust boundary is reported as `unknown` in every derived crossing,
   placement or constraint link.
4. Only an interactive local CLI command (`anvilmark architecture confirm ID`)
   sets `confirmed_at`. MCP and intelligence adapters cannot.
5. Confirming does not change `kind`: provenance remains visible after
   confirmation.
6. Milestone 6 conformance must treat an unconfirmed element as `unknown`,
   never as a basis for `pass`.

#### Proposed protocol change (adapter protocol `0.1.0-draft.2`)

Additive to `IntelligenceProposalSchema`:

```text
proposed_architecture_nodes:  [{ id, kind, name, trust_boundary, description|null }]    default []
proposed_relationships:       [{ id, kind, source, destination, workload_ref|null,
                                  data_classification|null }]                          default []
proposed_decision_bindings:   [{ decision_ref, node_refs }]                            default []
```

- Ids must be new, as for proposed constraints and candidates.
- Imported elements are written with `origin.kind: "agent_proposed"`,
  `proposal_ref` set, `confirmed_at: null`.
- `protocol_version` accepts `0.1.0-draft.1` and `0.1.0-draft.2`. Request
  instructions change, so request digests change.
- Structured evidence requests stay deferred, as decided in document 08.

#### Compatibility

- Every draft.4 document is a valid draft.5 document after a version-line
  change: all existing elements default to `origin.kind: "user"`.
- Normalized serialization adds the `origin` object to each element.
- **Approval hashes are unaffected**: architecture is not part of
  `ResolvedApprovalContent`. The contract hash used by generated-output
  freshness changes on migration, so existing generated output reports
  `stale_source` until regenerated.
- The generator version would advance, so existing output also reports
  `stale_generator`.

#### Tests required

- schema: defaults, invariants 1–2 in both directions, draft.4 migration by
  version lines only, normalized round trip;
- approval: an approved draft.4 fixture keeps its hash after migration;
- adapters: draft.1 and draft.2 responses; architecture fields in a draft.1
  response still rejected; duplicate and dangling ids refused as a whole;
- CLI: import writes unconfirmed elements; `architecture confirm` requires an
  interactive terminal; confirmation is recorded in history;
- context: unconfirmed elements labelled `inferred`; their trust boundaries
  never produce a crossing or constraint link; CALM metadata records origin;
- MCP: origin and confirmation visible; no tool can confirm.

### Amendment 9 — declared interfaces

#### Problem

The milestone lists "interfaces where required" in the authoritative model and
asks the CALM exporter to map interfaces. The draft.4 schema has no interface
field. Generating interfaces, ports or protocols to fill CALM's optional
properties would fabricate facts, so the export omits them.

#### Proposed schema change (project contract `0.1.0-draft.5`)

Additive to `ArchitectureNodeSchema`:

```text
interfaces: [{
  id: Id,                                       unique within the contract
  protocol: "HTTP" | "HTTPS" | "gRPC" | "AMQP" | "TCP" | "other" | null,   default null
  description: NonEmptyString | null,           default null
}]                                              default []
```

Additive to `ArchitectureRelationshipSchema`:

```text
source_interface_ref: Ref | null                default null
destination_interface_ref: Ref | null           default null
```

Invariants:

1. An interface ref must name an interface on the relationship's own source or
   destination node respectively.
2. Only `connects` relationships may name interfaces.
3. Nothing in ANVILMARK infers an interface. A null protocol is exported as
   absent, never as a guessed value.

#### CALM mapping

- `nodes[].interfaces[]` → `{ "unique-id": id }` plus `protocol` only when
  declared; the ANVILMARK description goes under `metadata.anvilmark`.
- `connects.source.interfaces` / `connects.destination.interfaces` → the
  declared refs only.
- Validation with the official CALM CLI is repeated for exports with and
  without interfaces.

#### Compatibility

Every draft.4 document is valid after a version-line change (`interfaces: []`,
refs null). Approval hashes are unaffected. Existing generated output reports
`stale_source` and `stale_generator` until regenerated.

#### Tests required

- schema: defaults, both invariants, dangling and cross-node interface refs
  refused;
- CLI: `architecture interface add|remove`, refusal of an interface ref on a
  non-`connects` relationship;
- context: CALM mapping emits only declared interfaces; official CALM
  validation of exports with interfaces; Mermaid shows interface ids on edges.

### Decision requested

Each developer — Anurag, Navaneeth and Aaradhya — records one of **accept as
proposed**, **reject**, **defer** or **modify** (with the modification) for
each amendment, and **agree** or **disagree** with each interpretation. Only
decisions actually supplied are recorded. No decision is recorded here, and no
approval is attributed to anyone.

```text
Developer:
Amendment 8 (attributable architecture proposals):  accept | reject | defer | modify: ...
Amendment 9 (declared interfaces):                  accept | reject | defer | modify: ...
Interpretation: as_of as generation time:           agree | disagree: ...
Interpretation: derived workload placement:         agree | disagree: ...
Date:
```
