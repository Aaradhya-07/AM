# @anvilmark/context

One provider-neutral fact layer over an ANVILMARK project contract
(`@anvilmark/project-contract` `0.1.0-draft.5`), and everything Milestone 4
builds from it:

- `buildProjectFacts` — the facts, for one explicit projection and `as_of`;
- `renderMermaid`, `renderCalm`, `renderAgentContext` — the generated views;
- `renderArtifactSet`, `checkArtifactSet` — the artifact set, its manifest and
  freshness checks;
- `runProjectQuery` — the five read-only questions the MCP project server
  answers.

Everything here reads a contract object. Nothing writes, and nothing reads a
generated file back as input. The CLI (`anvilmark generate`) and the MCP
project server are thin shells over these functions, so a generated file and an
MCP response built from the same contract, projection and `as_of` state the same
facts.

## Knowledge labels and decision standing

Every fact carries one knowledge label:

| Label       | Meaning                                                                         |
| ----------- | ------------------------------------------------------------------------------- |
| `approved`  | an approved decision whose approval hash matches its current resolved content   |
| `declared`  | stated in the contract (constraints, workloads, architecture) or by a publisher |
| `measured`  | T3 observation or measurement evidence                                          |
| `estimated` | a candidate's projected figures or a tool estimate                              |
| `inferred`  | agent-proposed or agent-inferred content                                        |
| `unknown`   | not recorded, not evaluated, or recorded as unknown                             |

Decision standing is `approved_current`, `approved_stale`,
`approved_unresolvable`, `proposed_unapproved`, `draft`, `rejected` or
`superseded`. Only `approved_current` sets `instruction_eligible`; every other
standing is context, never an instruction. An approval content hash proves the
approved content is unchanged; evidence freshness is evaluated separately at
`as_of`, so a current approval over expired evidence is reported as exactly
that.

A candidate's constraint standing carries `knowledge` and `knowledge_basis`
derived from what supports it, never from pass or fail alone: unsettled
outcomes are `unknown`; results recorded as inferred are `inferred`; a
projected cost comparison or hardware-compatibility estimate is `estimated`,
even when its arithmetic is deterministic; otherwise the strongest admissible,
current cited evidence decides (`measured` for evaluations, runtime
measurements, deterministic observations and source; `estimated` for tool
observations; `declared` for official documents, pricing, user declarations
and vendor claims; `inferred` for agent inference).

Architecture is **declared** structure: it is not covered by any approval hash.
Each node, relationship and binding carries its `origin` (user or
agent-proposed, with the proposal reference) and a derived confirmation
standing (`user_declared`, `unconfirmed`, `confirmed`, `confirmation_stale`),
recomputed from the content hash. Untrusted elements (unconfirmed or stale) are
`inferred`: a node's `effective_trust_boundary` is `unknown`, a relationship's
`effective_crossing` is `unknown` whenever it or an endpoint is untrusted (the
declared `crossing` stays visible, so a possible crossing is never shown as
absent), and every link through an untrusted element has `authoritative:
false` and counts as no support. Confirmed elements are `declared`, never
`measured`. This standing is portable content matching; it does not claim that
the proposal reference was verified against local history.

Links from architecture to decisions and constraints are derived and labelled:

- node ↔ decision: an `architecture.decision_bindings` entry, a
  component-scoped decision, or a workload **associated** with the node through
  a relationship's `workload_ref` (`associated_workloads`; this is not declared
  execution placement);
- node/relationship ↔ constraint: a constraint subject naming the workload or
  the data classification, a `forbid_dataflow` rule naming the data or the
  sanitizer node, or a linked decision's satisfied/unresolved lists;
- crossing: a `connects` or `uses` relationship whose endpoints sit in
  different trust boundaries.

Missing support is listed in `unresolved` (no linked decision, no approved and
current decision, no relationship, undeclared classification — including on a
crossing). Conformance rules are shown as declarations; nothing is evaluated.

## Source marker

```text
project_id, contract_revision, state_revision, contract_hash,
schema_version, generator, projection, as_of
```

- `contract_hash` is `sha256:` over the canonical JSON of the parsed contract,
  so any field change changes it and YAML formatting does not.
- `state_revision` is the committed CLI revision `project.yaml` matches, or
  null.
- `generator` is `anvilmark-context/0.1.0-draft.2`; it advances whenever output
  for the same contract changes, so output from `0.1.0-draft.1` reports
  `stale_generator`.
- `as_of` is supplied by the caller and must be an RFC 3339 timestamp with an
  offset. Renderers never read a clock and never use `project.updated_at`.

## Projections

Facts are constructed field by field for a named projection; nothing is
produced by serializing the contract and removing keys.

- **`remote-default`** (the default everywhere): intent, constraints and
  exceptions (without approver identity), workloads, decisions and approval
  standing (without approver identity or note), candidates with hardware under
  a projection-local alias, evidence metadata (without locators or values),
  gaps, architecture and conformance declarations, and non-identifying
  hardware capabilities. Repository roots, repository bindings and source
  locations, owners, integration credential references and data directories,
  evidence locators and values (including evaluation rows and command lines),
  approval notes and hardware ids are excluded. Hardware ids quoted inside gap
  and freshness text are replaced by the same aliases.
- **`local-disclosed`** (explicit): additionally repository roots and bindings,
  evidence locators, approval actors and exception approvers, each under a key
  named `local_*`, with a disclosure stating that producing it locally does not
  authorize sending it to a remote model. Credential references, data
  directories, evidence values, owners, approval notes and hardware ids are
  still excluded.

Two independent checks run after construction: the project secret scanner
(refuses any secret-shaped value), and, for `remote-default`, a check that no
known local value — hardware id, repository root, binding path, credential
reference, data directory or evidence locator — appears anywhere in the output.
Either refusal throws rather than returning a partial result.

## Generated artifacts

| Kind            | Default path                            | Contract field                    |
| --------------- | --------------------------------------- | --------------------------------- |
| `mermaid`       | `.anvilmark/architecture/view.mmd`      | `architecture.generated.mermaid`  |
| `calm_1_2`      | `.anvilmark/architecture/calm.json`     | `architecture.generated.calm_1_2` |
| `agent_context` | `.anvilmark/generated/agent-context.md` | fixed                             |
| manifest        | `.anvilmark/generated/manifest.json`    | fixed                             |

Contract paths are relative to `.anvilmark/`; a path outside it, over
`project.yaml`, the lock, `history/`, `intelligence/` or `evaluations/`, or
colliding with another artifact is refused.

- **Mermaid**: `%%` header with the source marker and a legend; nodes grouped
  in one subgraph per trust boundary; thick arrows for crossings, dotted for
  `deployed_in` and `composed_of`; every node and edge shows decision standing
  and `UNRESOLVED` where support is missing; one `%%` line per element lists
  its id and every linked decision, constraint and evidence record. Node ids
  are `n_<readable>_<8 hex of sha256(id)>`. Labels are escaped by allowlist:
  anything but ASCII letters, digits and ordinary punctuation becomes a Mermaid
  numeric entity (`#34;`), and newlines, control characters, line separators
  and bidirectional controls cannot survive. Untrusted nodes are grouped under
  `Trust boundary: UNKNOWN (unconfirmed agent proposals)` with their declared
  boundary in the label; declared or possible crossings are thick arrows whose
  label says whether the crossing is effective or UNKNOWN.
- **CALM 1.2**: export only. `service→service`, `external_system→system`,
  `datastore→database`, `actor→actor`; `queue` and `runtime` are exported as
  CALM's permitted free-string node types. `connects→connects`,
  `uses→interacts` when the source is an actor and `connects` otherwise,
  `deployed_in→deployed-in` (container is the destination),
  `composed_of→composed-of` (container is the source). A missing ANVILMARK
  description is exported as an explicit "Not declared…" text with
  `description-declared: false`, because CALM requires one. Declared interface
  ids are emitted as native node interfaces `{ "unique-id": ID }` and as
  `connects` source/destination `interfaces`; the ANVILMARK protocol and
  description are only in the owning node's `metadata.anvilmark.interfaces`
  (null kept as null). No relationship protocol, port, endpoint, control or
  flow is generated. Origin, confirmation, effective trust and authority are
  under `metadata.anvilmark`.
- **Agent context**: source table, legend, intent, hard constraints and
  exceptions, soft and informational constraints, workload decisions and
  deployments, project and component decisions, architecture, implementation
  requirements, evidence gaps, unresolved questions, hardware capabilities, and
  Claude Code and Codex setup for the same MCP server with `<ANVILMARK_REPO>`
  and `<PROJECT_DIR>` placeholders. Contract text is escaped so it cannot
  become Markdown structure, links or HTML.

`checkArtifactSet` re-renders from the contract at the manifest's `as_of` and
compares bytes. Statuses: `current`, `missing`, `incomplete`, `tampered`,
`stale_source`, `stale_generator`, `stale_time` (time-dependent facts differ
between `as_of` and the given `now`).

`presentFreshness(contract, { asOf, now })` separates byte stability from
current standings: it compares the time-dependent facts at `as_of` with those
at `now` and names each difference (for example evidence that was current and
is now expired). The CLI uses it on every `generate`, so a reused snapshot is
never reported current merely because its bytes are unchanged.

## Tests

```bash
pnpm --filter @anvilmark/context test
```

The default run needs no network and no external tools. Two opt-in checks use
real validators installed outside the workspace:

```bash
# Official FINOS CALM CLI (Apache-2.0), for CALM 1.2 validation.
npm install --prefix /tmp/calm-cli @finos/calm-cli@1.56.0
# Mermaid's own parser in jsdom (both MIT), for parse and label decoding checks.
npm install --prefix /tmp/mermaid-check mermaid@11.12.0 jsdom@26.1.0

ANVILMARK_CALM_BIN=/tmp/calm-cli/node_modules/.bin/calm \
ANVILMARK_MERMAID_NODE_MODULES=/tmp/mermaid-check/node_modules \
  pnpm --filter @anvilmark/context test
```

Neither tool is a dependency of this repository; see the milestone record for
licence, maintenance and data-flow notes.
