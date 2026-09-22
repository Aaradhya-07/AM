# Milestone 4 — Atlas architecture and context walkthrough

Status: **Reviewed and merged into `main` on September 14, 2026, including amendments 8–9 and the final corrections at `86ae934`; reviewed branch head `4058d6f`.**

This walkthrough takes the ratified Atlas Support Desk draft through the
Milestone 4 flow: inspect and edit the authoritative architecture, declare
interfaces, see invalid edits and unsafe output paths refused, generate
Mermaid, CALM 1.2 and agent context, detect edited and stale output, import a
synthetic architecture proposal, see it as inferred, confirm it interactively,
watch an edit make it unconfirmed again, query the same facts over the
read-only MCP server, and see how an approved decision — and one that stops
being approved — appears to an agent.

Sections 0–8, 10–12 and 14 were run exactly as written, in isolated temporary
directories, before this document was committed. Section 9's confirmations are
interactive: in the recorded run each was typed through a real pseudo-terminal
(`script -q /dev/null …`), with the hash prefix read from the content shown,
and nothing else about the commands was changed. Section 13 was run against
the files the earlier sections generated, with validators installed outside the
repository. Section 15 changes your own client configuration and was **not**
run: no Claude Code or Codex application was connected, and no model or network
was used. Hashes, proposal ids and clock-derived timestamps will differ on your
machine.

The architecture proposal in section 7
([`../fixtures/atlas-architecture-proposal.json`](../fixtures/atlas-architecture-proposal.json))
was written by hand for this walkthrough, not produced by a model. The approved
decision in section 14 is the synthetic fixture from
`packages/project-contract/test/fixtures/`. Neither is a real project decision,
and nothing here approves one.

## 0. Build and set up an isolated project

Run from the ANVILMARK repository root, in bash or zsh:

```bash
pnpm install
pnpm build
export REPO="$PWD"
anvilmark() { node "$REPO/packages/cli/dist/bin.js" "$@"; }
export ANVILMARK_CONFIG_HOME="$(mktemp -d)"
export WORK="$(mktemp -d)/atlas"
mkdir -p "$WORK" && cd "$WORK"
anvilmark init --from-contract "$REPO/docs/vnext/fixtures/atlas-project.draft.yaml" --intelligence handoff
```

`ANVILMARK_CONFIG_HOME` points at an empty host configuration, so no provider
is registered and nothing remote can run. `handoff` means proposals travel as
files you give to your own agent.

## 1. The architecture is declared structure in the contract

```bash
anvilmark architecture show
anvilmark architecture validate
```

```text
Nodes:
  pii-redactor  service  [local]  PII Redactor
    origin:      declared by user
    workloads associated through relationships: classification, pii_redaction
    decisions:   none
    ...
    UNRESOLVED:  no decision is linked to this component
Relationships:
  ticket-classifier-to-remote-model-provider  ticket-classifier -connects-> remote-model-provider
    origin:      declared by user
    workload: classification; data: redacted_customer_ticket; CROSSES local -> remote_provider
```

Atlas has no decisions yet, so every element says so. Workloads are
_associated_ with nodes through relationships; nothing declares where a
workload actually runs.

## 2. Edit it — valid edits commit, invalid ones write nothing

```bash
anvilmark architecture interface add ticket-classifier classifier-grpc --protocol gRPC
anvilmark architecture interface add remote-model-provider provider-endpoint
anvilmark architecture relationship update ticket-classifier-to-remote-model-provider \
  --source-interface classifier-grpc --destination-interface provider-endpoint
anvilmark architecture relationship update pii-redactor-to-ticket-classifier --source-interface classifier-grpc
anvilmark architecture node remove pii-redactor
```

```text
Saved state revision r2: added interface classifier-grpc to architecture node ticket-classifier (gRPC)
Saved state revision r3: added interface provider-endpoint to architecture node remote-model-provider (protocol unknown)
Saved state revision r4: updated architecture relationship ticket-classifier-to-remote-model-provider: source interface, destination interface
  notice: ticket-classifier-to-remote-model-provider crosses the trust boundary from local to remote_provider
error: interface "classifier-grpc" is declared on node "ticket-classifier", not on the source node "pii-redactor"
error: architecture node "pii-redactor" is still referenced by relationship ticket-intake-to-pii-redactor, relationship pii-redactor-to-ticket-classifier, conformance rule rule.raw_ticket_never_remote; remove or change those first
```

The last two exit 1, and `project.yaml` and its history are unchanged. The
provider interface's protocol is unknown and stays unknown: nothing infers it.

## 3. Generate views and context

```bash
anvilmark generate --as-of 2026-09-14T00:00:00Z
anvilmark generate
grep -n '"interfaces"' .anvilmark/architecture/calm.json
```

```text
Generated 4 file(s) from contract revision 1 (sha256:…).
  as_of: 2026-09-14T00:00:00Z (given with --as-of)
  freshness: current at …
...
Generated output already matches this snapshot; nothing was written.
  as_of: 2026-09-14T00:00:00Z (reused from the manifest for this unchanged source)
  freshness: current at …
```

Every run reports present freshness separately from byte equality. The CALM
export carries the declared interface ids as native node interfaces and
`connects` references; the protocols (`gRPC`, and `null` for unknown) are only
in `metadata.anvilmark.interfaces`. No relationship protocol, port or URL is
emitted.

## 4. Edited views are not authoritative

```bash
printf '  n_shadow["Shadow service"]\n' >> .anvilmark/architecture/view.mmd
anvilmark generate --check
anvilmark architecture show --json | grep -c shadow
anvilmark generate
```

```text
Generated output: tampered
  current          .anvilmark/generated/agent-context.md
  current          .anvilmark/architecture/calm.json
  tampered         .anvilmark/architecture/view.mmd
  problem: .anvilmark/architecture/view.mmd does not match what the recorded source renders; it was edited or replaced after generation and is not authoritative
0
Generated 1 file(s) from contract revision 1 (sha256:…).
```

## 5. A contract change makes every view stale

```bash
anvilmark architecture node update ticket-intake --description "Receives customer tickets"
anvilmark generate --check
anvilmark generate
```

```text
Generated output: stale_source
  ...
  problem: generated from state revision r4, contract revision 1 (sha256:…); project.yaml is now state revision r5, contract revision 1 (sha256:…)
  Regenerate with "anvilmark generate".
```

If standings change only because time passed — evidence expiring after the
snapshot's `as_of` — `generate` instead prints `STALE … (stale_time)`, keeps the
snapshot bytes, exits 1 and tells you to run `anvilmark generate --refresh`;
an explicit `--as-of` succeeds as a labelled historical snapshot. That clock
boundary is exercised by `packages/cli/test/m4-review-corrections.test.ts`.

## 6. Output paths cannot reach project state

```bash
anvilmark architecture views --mermaid exports/project.yaml
ln -s . .anvilmark/exports
anvilmark generate
anvilmark validate
rm .anvilmark/exports
anvilmark architecture views --default-mermaid
```

```text
error: generated output ".anvilmark/exports/project.yaml" passes through a symbolic link at .anvilmark/exports; generated files are never written through links; no generated output was read or changed
```

The contract still validates, and the previous views are unchanged.

## 7. Ask an intelligence for architecture

```bash
anvilmark propose export --task propose_architecture
export REQ="$(ls .anvilmark/intelligence/requests | tail -1 | sed 's/\.json$//')"
cp "$REPO/docs/vnext/fixtures/atlas-architecture-proposal.json" ".anvilmark/intelligence/handoff/$REQ.response.json"
anvilmark propose import "$REQ"
```

```text
Saved state revision r8: applied proposal prop-… from handoff: 0 constraint(s), 0 candidate(s), 1 question(s), 0 inference(s), 2 architecture node(s), 3 relationship(s), 0 decision binding(s) (agent-proposed, unconfirmed)
  architecture nodes (agent-proposed, unconfirmed): response-drafter, knowledge-index
  relationships (agent-proposed, unconfirmed): classifier-to-drafter, drafter-reads-index, drafter-to-remote-model
  Proposed architecture is shown as inferred until you confirm each element with: anvilmark architecture confirm node|relationship|binding REF
```

The request uses protocol `0.1.0-draft.2`. In your own use, give the request
file to your agent instead of copying the fixture. A proposal that reused an
existing id, extended an existing binding, referenced a node that neither
exists nor is proposed, or supplied an origin or confirmation would be refused
as a whole.

## 8. Proposed architecture is inferred

```bash
anvilmark architecture show
anvilmark generate
grep -n "UNKNOWN" .anvilmark/architecture/view.mmd
```

```text
  response-drafter  service  [local, effective: UNKNOWN]  Response Drafter
    origin:      agent-proposed (proposal prop-…), UNCONFIRMED; inferred
...
  drafter-to-remote-model  response-drafter -connects-> remote-model-provider
    origin:      agent-proposed (proposal prop-…), UNCONFIRMED; inferred
    workload: response_drafting; data: unknown; crossing UNKNOWN (declared local -> remote_provider)
```

The Mermaid view puts the proposed nodes under `Trust boundary: UNKNOWN
(unconfirmed agent proposals)` and draws `drafter-to-remote-model` as a
`POSSIBLE crossing local to remote_provider: UNKNOWN`: the declared values are
kept for review, the crossing is not hidden, and nothing here counts as
support.

## 9. Confirm interactively (you run this)

```bash
anvilmark architecture confirm node response-drafter
anvilmark architecture confirm relationship drafter-to-remote-model
```

```text
Confirm agent-proposed architecture node response-drafter
  proposal: prop-… from handoff, applied in committed revision r8
  standing now: unconfirmed
  content this confirmation covers:
    {
      "description": "Drafts cited replies for human review",
      "id": "response-drafter",
      "interfaces": [],
      "kind": "service",
      "name": "Response Drafter",
      "trust_boundary": "local"
    }
  content hash (sha-256): …

To confirm, type the first 12 characters of the content hash (….). Press Enter to cancel:
Saved state revision r9: confirmed agent-proposed architecture node response-drafter (content sha-256 …; proposal prop-…)
```

Before asking, the command verified that the proposal was applied in a
committed revision whose record lists this element. Without a terminal it
refuses; a wrong answer changes nothing.

## 10. Confirmed architecture is effective

```bash
anvilmark architecture show
```

```text
  response-drafter  service  [local]  Response Drafter
    origin:      agent-proposed (proposal prop-…), confirmed …
...
  drafter-to-remote-model  response-drafter -connects-> remote-model-provider
    origin:      agent-proposed (proposal prop-…), confirmed …
    workload: response_drafting; data: unknown; CROSSES local -> remote_provider
```

Confirmation made the boundary and the crossing effective. The elements stay
attributed to their proposal, and nothing became approved or measured.

## 11. A material edit makes it unconfirmed again

```bash
anvilmark architecture interface add response-drafter drafter-api --protocol HTTPS
anvilmark architecture show
```

```text
Saved state revision r11: added interface drafter-api to architecture node response-drafter (HTTPS)
  notice: node response-drafter was confirmed, and this edit changed its confirmed content; it is agent-proposed and unconfirmed again (confirm it with anvilmark architecture confirm node response-drafter)
```

A hand edit of `project.yaml` would instead leave the stored hash in place,
where it no longer matches: the element would show `CONFIRMATION STALE` until
confirmed again.

## 12. Ask the MCP server for the same facts

```bash
node "$REPO/packages/mcp/scripts/verify-project-tools.mjs" --project-dir "$WORK" --component response-drafter
```

```text
claude-code: initialize -> anvilmark-project@0.1.0-draft.1, protocol 2025-11-25
codex-mcp-client: initialize -> anvilmark-project@0.1.0-draft.1, protocol 2025-11-25
tools/list: get_project_summary, get_constraints, get_workload_decision, get_architecture_context, list_evidence_gaps (all readOnlyHint)
...
client parity: 8/8 responses byte-identical
component response-drafter: knowledge inferred; origin agent_proposed (unconfirmed); declared boundary local; effective boundary unknown; interfaces drafter-api:HTTPS
  relationship classifier-to-drafter: inferred; effective crossing unknown
  relationship drafter-reads-index: inferred; effective crossing unknown
  relationship drafter-to-remote-model: declared; effective crossing unknown
component view parity: byte-identical
stdout: JSON-RPC only; diagnostics on stderr
project tree: unchanged
verification passed
```

This speaks the MCP wire protocol to the real server over stdio as two clients
named `claude-code` and `codex-mcp-client`. It shows protocol-level parity; it
is not a demonstration with the Claude Code or Codex applications. The server
read only `project.yaml`, and the project tree is unchanged.

## 13. Validate with the official tools (optional; needs npm)

Install the validators outside the repository. They are not ANVILMARK
dependencies.

```bash
export TOOLS="$(mktemp -d)"
npm install --prefix "$TOOLS/calm" @finos/calm-cli@1.59.0
"$TOOLS/calm/node_modules/.bin/calm" validate -a .anvilmark/architecture/calm.json -f json
npm install --prefix "$TOOLS/mermaid" mermaid@12.0.0 jsdom@26.1.0
ANVILMARK_MERMAID_NODE_MODULES="$TOOLS/mermaid/node_modules" \
  node "$REPO/packages/context/scripts/verify-mermaid.mjs" .anvilmark/architecture/view.mmd
```

The CALM CLI exits 0 even when its report has errors, so read `hasErrors`. The
milestone record lists the results for the files generated above.

## 14. An approved decision, and one that stops being approved

```bash
export APPROVED="$(mktemp -d)/approved"
mkdir -p "$APPROVED" && cd "$APPROVED"
sed -e 's#^schema: .*#schema: https://anvilmark.dev/schemas/project/0.1.0-draft.5#' \
    -e 's#^schema_version: .*#schema_version: 0.1.0-draft.5#' \
    "$REPO/packages/project-contract/test/fixtures/approved-atlas.draft3.yaml" > "$APPROVED/../approved-atlas.draft5.yaml"
anvilmark init --from-contract "$APPROVED/../approved-atlas.draft5.yaml"
anvilmark architecture bind decision.classification --node ticket-classifier,remote-model-provider
anvilmark generate --as-of 2026-09-14T00:00:00Z
grep -n "· instruction: YES\|implement with candidate" .anvilmark/generated/agent-context.md
anvilmark candidate assume candidate.classification.remote_unselected "Assumes a 900-token prompt"
anvilmark generate --check
anvilmark generate
grep -n "decision.classification. revision\|Not an implementation instruction" .anvilmark/generated/agent-context.md
```

```text
…:- Decision `decision.classification` revision 1 · status approved · standing `approved_current` `approved` · instruction: YES
…:- Workload `classification`: implement with candidate `candidate.classification.remote_unselected` as approved in `decision.classification` `approved`.
Saved state revision r3: recorded an operating assumption for candidate.classification.remote_unselected
  notice: decision "decision.classification" was approved, but this change alters the content that approval covered; it is now proposed revision 2 and needs a new interactive approval (the earlier approval is kept, not current)
Generated output: stale_source
...
…:- Decision `decision.classification` revision 2 · status proposed · standing `proposed_unapproved` `declared` · instruction: NO
…:  - Not an implementation instruction: it is proposed and awaiting approval.
```

The approval hash of this draft.3-era fixture is unchanged by the draft.5
migration. Approving revision 2 is an interactive `anvilmark approve` and is
yours to do; it was not done here.

## 15. Connect Claude Code or Codex (you run this)

Both use the same server and arguments. Replace `<PROJECT_DIR>` with `$WORK`:

```bash
claude mcp add --transport stdio anvilmark-project -- node "$REPO/packages/mcp/dist/project-server.js" --project-dir <PROJECT_DIR>
```

```toml
# ~/.codex/config.toml
[mcp_servers.anvilmark-project]
command = "node"
args = ["<REPO>/packages/mcp/dist/project-server.js", "--project-dir", "<PROJECT_DIR>"]
```

These change your client settings, and a client may forward tool results to a
remote model. The server's default `remote-default` projection excludes local
paths, bindings, identities, credential references, command lines and
evaluation rows, and its error responses never include local paths;
`--projection local-disclosed` adds local-only fields and should be used only
when that is intended.

## Clean up

```bash
cd "$REPO" && rm -rf "$(dirname "$WORK")" "$(dirname "$APPROVED")" "$ANVILMARK_CONFIG_HOME" "${TOOLS:-/nonexistent}"
```
