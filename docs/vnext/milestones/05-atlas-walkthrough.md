# Milestone 5 — Atlas repository mapping walkthrough

Status: **Reviewed and merged into `main` on September 15, 2026, including the R1–R4 review corrections and SDK boundary fixes at `b4b4157`; branch head `33d0656`.** The
outputs below were re-run on September 18, 2026 against scanner
`0.1.0-draft.3`, whose flow model follows calls three deep (Milestone 5 shipped
with one), and whose observations name each call's endpoint and operation kind.

This walkthrough scans a small Atlas Support Desk application with
`anvilmark scan`: load the project and its architecture, declare which code
reads raw tickets, redacts them and calls providers, scan, inspect
observations, data flows, proposed bindings and unknowns, repeat an unchanged
scan byte for byte, see a change make the stored scan stale, and see how a
synthetic approved decision appears next to the observed implementation.

Every command below was run exactly as written, in isolated temporary
directories, before this document was committed; `packages/cli/test/scan-walkthrough.test.ts`
runs the same steps through the built binary. Hashes, ids and clock-derived
timestamps will differ on your machine. Output excerpts below are shortened
with `…` where lines were omitted.

What is synthetic, and what nothing here does:

- The application under `packages/scanner/test/fixtures/repositories/atlas-support/`
  and the declarations in [`../fixtures/atlas-scanner.yaml`](../fixtures/atlas-scanner.yaml)
  were written by hand for this walkthrough.
- The `openai` and `ollama` packages copied into `node_modules/` are
  **synthetic type declarations** from `packages/scanner/test/fixtures/synthetic-sdks/`.
  They are not those npm packages, have no implementation, and nothing is
  installed from a registry.
- The approved decision in section 7 is the synthetic fixture from
  `packages/project-contract/test/fixtures/`. It is not a real project decision,
  and nothing here approves, records or changes a decision or binding.
- No model, provider or network is used. The scan output is a set of
  observations, not a conformance result: Milestone 6 evaluates rules.

## 0. Build and set up an isolated project next to an application

Run from the ANVILMARK repository root, in bash or zsh:

```bash
pnpm install
pnpm build
export REPO="$PWD"
anvilmark() { node "$REPO/packages/cli/dist/bin.js" "$@"; }
export ANVILMARK_CONFIG_HOME="$(mktemp -d)"
export WORK="$(mktemp -d)"
cp -R "$REPO/packages/scanner/test/fixtures/repositories/atlas-support" "$WORK/app"
mkdir -p "$WORK/app/node_modules"
cp -R "$REPO/packages/scanner/test/fixtures/synthetic-sdks/openai" "$WORK/app/node_modules/openai"
cp -R "$REPO/packages/scanner/test/fixtures/synthetic-sdks/ollama" "$WORK/app/node_modules/ollama"
mkdir "$WORK/project" && cd "$WORK/project"
anvilmark init --from-contract "$REPO/docs/vnext/fixtures/atlas-project.draft.yaml" --intelligence handoff
```

The application has five files: `intake.ts` returns the raw ticket text,
`redactor.ts` redacts it, `classifier.ts` classifies the redacted text with a
local Ollama runtime and falls back to a remote OpenAI call, `escalation.ts`
deliberately sends the raw ticket to OpenAI (the benchmark violation from
[`../01-shared-benchmark-scenario.md`](../01-shared-benchmark-scenario.md)),
and `server.ts` calls both.

## 1. The approved architecture is loaded from the contract

```bash
anvilmark architecture show
anvilmark generate
```

```text
Nodes:
  pii-redactor  service  [local]  PII Redactor
    origin:      declared by user
…
  remote-model-provider  external_system  [remote_provider]  Remote Model Provider
…
```

The scanner reads the same `project.yaml`: node ids, trust boundaries,
confirmation standing, candidates, workloads, decisions and approvals. It
never reads generated files.

## 2. Declare sources, the sanitizer, sinks and components

```bash
cp "$REPO/docs/vnext/fixtures/atlas-scanner.yaml" .anvilmark/scanner.yaml
```

The declarations name exported functions (`src/intake.ts` → `readTicket` is the
`raw_customer_ticket` source; `src/redactor.ts` → `redactTicket` clears it and
produces `redacted_customer_ticket`), map recognized `openai` calls to
`remote-model-provider` and `ollama` calls to `ticket-classifier`, and map the
two application files to the `ticket-classifier` component of the
`classification` workload. The scanner binds each declaration to the function
the compiler resolves there. A declared sanitizer is an assumption about that
function; its implementation is never analysed or trusted as proof.

## 3. Scan

```bash
anvilmark scan
```

```text
Repository scan written: .anvilmark/scans/repository-scan.json
  repository:   ../app (not in the contract's repository_roots)  snapshot sha256:1330f1e9…
  contract:     atlas-support-desk revision 1 (state r1)  sha256:489dc573…
  declarations: .anvilmark/scanner.yaml
  scanner:      anvilmark-scanner 0.1.0-draft.3, TypeScript 5.9.3, flow bounded-direct-call/3 (call depth 3)
  observed_at:  2026-09-18T07:22:43.278Z (clock)
  inventory:    5 source file(s), 2 AI SDK dependencies, 1 exclusion(s)
  observed:     2 client instantiation(s), 3 provider call(s)
  data reaching provider calls: 1 raw_reaches, 0 unresolved, 2 sanitized_only, 0 no_declared_data
  proposed bindings: 3 (3 declared_mapping, 0 heuristic_association, 0 unresolved)
  unknowns: 0 (0 about AI calls, declared data or imports)   analysis errors: 0   limits: 0
  completeness: complete_within_supported_scope
  These are observations and proposed bindings, not conformance results.
  Inspect with "anvilmark scan show --section observations|flows|bindings|unknowns".
```

Exit code 0 means the scan completed and its artifact was written; it says
nothing about whether the application conforms. The Atlas draft records no
repository root, so the scan notes that `../app` is not among the contract's
`repository_roots` — and does not add it.

## 4. Inspect what was observed

```bash
anvilmark scan show --section observations
anvilmark scan show --section flows
anvilmark scan show --section bindings
anvilmark scan show --section unknowns
anvilmark scan show --section declarations
```

Observations are compiler-resolved facts with exact repository-relative spans:

```text
  client.cc92f12a656752130c0a client_instantiation openai OpenAI endpoint default api.openai.com (openai) at src/classifier.ts:6:16 [deterministic_observation, T3]
  call.7778adf161a8c67bd530 provider_call openai chat.completions.create [inference] to default api.openai.com (openai) model gpt-4o-mini at src/classifier.ts:9:10 in classifyRemotely [deterministic_observation, T3]
  call.668018e1075b747a49fe provider_call ollama chat [inference] to default 127.0.0.1 (ollama) model llama3.2 at src/classifier.ts:17:23 in classifyTicket [deterministic_observation, T3]
…
  call.d03d770a5c0d4ba0c605 provider_call openai responses.create [inference] to default api.openai.com (openai) model gpt-4o-mini at src/escalation.ts:8:10 in escalateTicket [deterministic_observation, T3]
```

Data flows say what declared data reaches each call, with the trace:

```text
  flow.2ee06cb87278f069ca52 for call.d03d770a5c0d4ba0c605: raw_reaches raw_customer_ticket:raw [T3]
    direct_call from handle via src/server.ts:5:21: raw_reaches
      raw_customer_ticket raw on some paths: source@8 -> sink@8
    intraprocedural from escalateTicket: raw_reaches (superseded by direct calls)
      raw_customer_ticket raw: source@8 -> sink@8
    caveats: raw_on_some_paths_only, superseded_contexts_excluded
…
  flow.934df594d76c6271be1d for call.7778adf161a8c67bd530: sanitized_only redacted_customer_ticket:sanitized [T3]
    direct_call from classifyTicket via src/classifier.ts:22:12: sanitized_only
      redacted_customer_ticket sanitized on some paths: source@16 -> sanitizer@16 -> assignment@16 -> argument@22 -> assignment@8 -> sink@9
    direct_call from handle via src/classifier.ts:22:12: sanitized_only
      redacted_customer_ticket sanitized on some paths: source@16 -> sanitizer@16 -> assignment@16 -> argument@22 -> assignment@8 -> sink@9
    intraprocedural from classifyRemotely: unresolved (superseded by direct calls)
    caveats: declared_sanitizer_assumed_effective, superseded_contexts_excluded
```

`classifyRemotely` on its own receives a parameter from unknown callers
(`unresolved`); because every reference to it in the repository is a direct
call that was followed, that context is superseded by the `direct_call`
contexts from `classifyTicket` and from `handle`.

The flow model follows calls three deep, so `handle` → `classifyTicket` →
`classifyRemotely` is followed to the end and this walkthrough has nothing
left unknown:

```text
Unknowns about AI calls, declared data or imports (0 location(s); 0 record(s) in total, --all lists every one)
```

A deeper chain would stop at the limit and say so — `call_depth_exceeded` at
the call site — rather than guess what reaches the provider.

Proposed bindings put the observed implementation next to the approved
architecture. They are proposals in the local artifact only:

```text
Proposed bindings (not recorded in the contract)
  binding.2ee06cb87278f069ca52 at src/escalation.ts:8:10 [declared_mapping, confidence medium, T1]
    component ticket-classifier (user_declared); provider node remote-model-provider (declared_mapping); workload classification; candidate candidate.classification.remote_unselected
    decision unbound
    unbound: no_decision_for_workload
…
```

The Atlas draft has no decision, so every binding's decision is `unbound`.

## 5. An unchanged rescan is byte-identical

```bash
cp .anvilmark/scans/repository-scan.json "$WORK/first-scan.json"
anvilmark scan
cmp .anvilmark/scans/repository-scan.json "$WORK/first-scan.json" && echo "byte-identical"
anvilmark scan --check
```

```text
Repository scan unchanged: .anvilmark/scans/repository-scan.json
…
byte-identical
Repository scan .anvilmark/scans/repository-scan.json: current
```

The content hash covers every source, manifest and resolution input the scan
read, the declarations, the contract, and the scanner, TypeScript, recognizer
and stage versions. With identical content the stored `observed_at` is reused,
so nothing changes on disk.

## 6. A change makes the stored scan stale

```bash
printf '\n// reviewed\n' >> "$WORK/app/src/escalation.ts"
anvilmark scan --check
anvilmark scan --json
```

```text
Repository scan .anvilmark/scans/repository-scan.json: stale
  repository inputs changed
  Rescan with "anvilmark scan".
```

`scan --check` exits 1 and writes nothing. The rescan takes a new
`observed_at` from the clock (`"basis": "clock"`). Throughout, `project.yaml`
still contains `repository_bindings: []`, and `.anvilmark/` gained only
`scanner.yaml` (which you copied) and `scans/`.

## 7. How a synthetic approved decision appears

```bash
mkdir "$WORK/approved" && cd "$WORK/approved"
sed -e "s|^schema: .*|schema: https://anvilmark.dev/schemas/project/0.1.0-draft.5|" \
    -e "s|^schema_version: .*|schema_version: 0.1.0-draft.5|" \
    "$REPO/packages/project-contract/test/fixtures/approved-atlas.draft3.yaml" > "$WORK/approved-atlas.yaml"
anvilmark init --from-contract "$WORK/approved-atlas.yaml"
cp "$REPO/docs/vnext/fixtures/atlas-scanner.yaml" .anvilmark/scanner.yaml
anvilmark scan --observed-at 2026-09-15T00:00:00Z
anvilmark scan show --section bindings
```

```text
Proposed bindings (not recorded in the contract)
  binding.2ee06cb87278f069ca52 at src/escalation.ts:8:10 [declared_mapping, confidence high, T1]
    component ticket-classifier (user_declared); provider node remote-model-provider (declared_mapping); workload classification; candidate candidate.classification.remote_unselected
    decision decision.classification (approved, approval current, selected candidate.classification.remote_unselected)
  binding.46dd1117fab1f0f4ce7d at src/classifier.ts:17:23 [declared_mapping, confidence high, T1]
    component ticket-classifier (user_declared); provider node ticket-classifier (declared_mapping); workload classification; candidate candidate.classification.local_unselected
    decision decision.classification (approved, approval current, selected candidate.classification.remote_unselected)
…
```

The observed Ollama call is declared as the local candidate while the
synthetic approval selected the remote candidate; the escalation call sends
raw tickets to the remote provider node. The artifact records both facts side
by side with their standing — approval hash-current, architecture node
`user_declared` — and draws no conclusion. Whether either is allowed is
Milestone 6's rule evaluation. The `"contract_projection"` of each binding in
`scan show --section bindings --json` says whether it could be represented as a
draft.5 `RepositoryBinding`; nothing writes it into the contract.

## 8. What stayed local and unchanged

- The scan read only files below `$WORK/app` (and the compiler's own default
  library declarations). It ran no package script, build, executable or
  tsconfig plugin, and followed no link or import outside the repository.
- The artifact contains repository-relative paths, spans and hashes — no
  absolute path, no source excerpt and no environment-variable value.
- The read-only MCP tools from Milestone 4 do not read the artifact and
  answer exactly as before. A local artifact is not permission to send
  repository paths, symbols, source or bindings to a remote model.
