# @anvilmark/cli

`anvilmark` is the local, user-operated ANVILMARK workflow (Milestones 3–7).
It turns an informal idea, a repository reference or a reviewed contract
file into a valid project contract under `.anvilmark/`, keeps assumptions and
unknowns as structured data, takes optional proposals from **your**
intelligence, compares alternatives without an overall score, records an
interactive approval of one exact decision revision, declares the architecture,
generates Mermaid, CALM 1.2 and agent context from the contract, and scans a
TypeScript/JavaScript repository for source-linked observations and proposed
bindings, and evaluates bounded provider/data-flow conformance.

ANVILMARK supplies no model and calls no ANVILMARK service. Every deterministic
command works with no intelligence configured.

For complete worked examples, see the
[Milestone 3 Atlas walkthrough](../../docs/vnext/milestones/03-atlas-walkthrough.md)
and the
[Milestone 4 architecture and context walkthrough](../../docs/vnext/milestones/04-atlas-walkthrough.md)
and the
[Milestone 5 repository mapping walkthrough](../../docs/vnext/milestones/05-atlas-walkthrough.md).

For a single guided project through review and conformance, use the
[M7 Atlas workshop](../../docs/vnext/milestones/07-guided-workshop.md).

## Run it

The reproduced onboarding path uses Node.js 24 and pnpm 11.16.0. From the repository root:

```bash
node scripts/setup.mjs
node packages/cli/bin/anvilmark.mjs help
```

The examples below write `anvilmark` for `node /path/to/ANVILMARK/packages/cli/bin/anvilmark.mjs`.
Commands find the project by walking up from the current directory to the
nearest `.anvilmark/project.yaml`; `--project-dir DIR` (`-C`) names it
explicitly. `anvilmark <command> --help` prints each command's options.

Exit codes: `0` ok, `1` refused or failed, `2` usage error, `3` cancelled or
declined. A refused, failed or cancelled command writes nothing to the contract.

## Commands

| Area         | Commands                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Start        | `init`, `status`, `validate`, `history`                                                                 |
| Describe     | `elicit`, `intent`, `workload`, `constraint`, `priority`, `hardware`, `budget`, `candidate`, `evidence` |
| Intelligence | `intelligence list\|select`, `propose preview\|send\|export\|import`                                    |
| Decide       | `compare`, `decision draft\|propose\|revise\|reject`, `review`, `approve`, `approval status`            |
| Architecture | `architecture show\|validate\|node\|relationship\|bind\|unbind\|views`, `generate [--check]`            |
| Repository   | `inventory`, `scan [--check]`, `scan show`, `scan draft-config`                                         |
| Conformance  | `rule list\|add\|remove`, `conformance [--check]` (`check` is an alias)                                 |
| Cloud Sync   | `login [--token TOKEN] [--whoami] [--logout]`, `push [--yes] [--dry-run] [--json]`                      |

`status`, `history`, `compare`, `review`, `approval status`, `intelligence list`,
`propose preview`, `architecture show|validate`, `generate`, `scan`, `rule list`,
`inventory`, and `push` accept `--json` for tools and agents. `approve` does not.

### Cloud Console Sync (`login`, `push`)

Synchronize local contract verification hashes and conformance telemetry with your ANVILMARK Cloud Console ([anvilmark.vercel.app](https://anvilmark.vercel.app)).

**Privacy guarantee:** Zero source code egress. Source code never leaves your local machine or private CI environment. Only cryptographic contract hashes, rule counts, and boundary verdicts are transmitted.

```bash
# 1. Authenticate with platform sync token (generated in your dashboard)
# Token can be passed via --token or ANVILMARK_API_TOKEN environment variable
export ANVILMARK_API_TOKEN="am_live_..."
anvilmark login

# Check authenticated status
anvilmark login --whoami

# 2. Transmit local verification hashes to your platform dashboard
# Respects remote_intelligence_policy with an interactive payload preview & consent prompt
anvilmark push

# In CI pipelines, bypass interactive confirmation
anvilmark push --yes

# Preview exact payload and destination URL without sending
anvilmark push --dry-run

# Remove local credentials
anvilmark login --logout
```

Credentials are saved outside repositories in `~/.config/anvilmark/credentials.json` with strict `0o600` permissions.

### Hardware sizing and explicit observation workflow

```sh
anvilmark hardware catalog --json
anvilmark hardware example --json > /tmp/sizing-input.json
anvilmark hardware estimate --file /tmp/sizing-input.json --json
```

These sizing commands require no project, preserve all declarations, and write nothing.
Choose allocation, workload, runtime, and allocator assumptions in the input JSON;
unknown values stay unknown. The estimate command also verifies and recomputes JSON
exported from the web playground. Exit 0 means the calculation completed; inspect
`result.status` and `result.memory.assessment` before using it. Runtime compatibility
remains unknown; optional exact-envelope calibration is advisory. The existing
`hardware add` workflow is unchanged.

```sh
anvilmark hardware probe --json
anvilmark hardware discover --json
anvilmark hardware recommend --file /tmp/sizing-input.json --json
# Explicit persistence; all ids must be new. GiB/GB conversion is never guessed.
anvilmark hardware probe --write --id observed.local --evidence-id inventory.local --capacity-unit gib --as-declared target.local --json
# SSH requires an existing trusted host key and non-interactive authentication.
anvilmark hardware probe --host user@host --known-hosts /absolute/path/known_hosts --json
```

A probe never replaces a declaration. Partial/limited inventory is returned but cannot
be persisted as complete hardware. `--as-declared` creates a distinct T1 target only
when explicitly requested. Discovery uses fixed loopback inventory endpoints and
never starts inference.

`hardware apply --file scenario.json --candidate ID --target ID
--observation-evidence ID --constraint ID --id NEW_EVIDENCE_ID
--scenario-id NEW_SCENARIO_ID --json` previews a bound proposal. Save that JSON,
then use `hardware apply --file proposal.json --write --json` to attach it. A changed
project digest refuses the write. The matching local candidate must use an exact
pinned model/revision/weight format and runtime, and the constraint must be a soft
`candidate.<id>.memory_fit eq true` comparison. Context, KV, concurrency, budgets,
and runtime version are persisted as T1 assumptions. The resulting T2 arithmetic
cannot settle runtime, quality, latency, or performance gates.

See [profiles, units, command exits, and attachment requirements](../hardware-sizing/README.md)
and [the implementation record](../../docs/handoffs/hardware-sizing-implementation.md).

### Initialize

```bash
anvilmark init --idea "Help support agents triage multilingual tickets" --name "Ticket Desk"
anvilmark init --idea "Add AI triage to our service" --repo ../existing-service
anvilmark init --from-contract docs/vnext/fixtures/atlas-project.draft.yaml
```

- An idea records only what you said. Users, outcomes, workloads, constraints,
  hardware and budgets start empty and `status` lists them as not yet provided.
- `--repo` records a relative path. Its contents are not read in this milestone,
  and repository roots are default-denied to remote intelligence.
- `--from-contract` imports a file you have reviewed; it must validate in full
  (schema, references, evidence floors, approval hashes, secret scan).
- `--intelligence none|handoff|PROVIDER_ID` records the selected mechanism by id.
  `--remote-intelligence nothing` records that remote intelligence may receive
  no project data at all (an empty `remote_intelligence_policy.default_allow`).
- No credential is ever stored in the project.

### Describe progressively

`anvilmark elicit` asks one section at a time — purpose, users, outcomes,
non-goals, workloads (with usage, latency and burst), constraints (severity and
soft direction), priority order, hardware, budgets, already-made decisions and
open questions — and saves each completed section as its own state revision.
At any prompt, **Enter** skips and **?** records the question as unresolved.
Ctrl-C keeps the sections already saved. Each answer is validated as it is
entered, so one invalid entry is refused on its own.

The same data can be entered with commands:

```bash
anvilmark intent add-user support_agent
anvilmark intent add-question "Which regions may process redacted tickets?"
anvilmark workload add --id classification --name "Ticket classification" \
  --input redacted_customer_ticket --output json_schema --output-schema ./schemas/c.json \
  --calls-per-month 40000 --input-tokens 900 --latency-percentile p95 --latency-max-ms 1000 \
  --quality-gate macro_f1:0.9:eval.classification.v1
anvilmark workload burst --workload classification --peak-calls-per-minute 120
anvilmark workload add --id escalation_summary --name "Escalation summary" \
  --input redacted_customer_ticket --output plain_text --output-classification escalation_summary_text
anvilmark workload usage escalation_summary --calls-per-month 2000 --usage-basis user_assumption
anvilmark workload output-classification classification --unknown
anvilmark constraint add --id privacy.raw_ticket_remote --domain privacy --severity hard \
  --subject data.raw_customer_ticket --operator must_not_leave --value local_trust_boundary
anvilmark constraint add --id budget.ai_monthly --domain cost --severity soft --direction minimize \
  --subject project.ai_effective_cost_monthly_usd --operator lte --value 750
anvilmark priority set privacy,quality,availability,cost,latency
anvilmark hardware add --id hardware.gpu --cpu-cores 16 --ram-gb 64 --os linux --backend cuda \
  --accelerator "nvidia:RTX 4090:24"
anvilmark budget add --currency USD --period month --amount 750 --scope ai_inference
anvilmark candidate add --id candidate.classification.local --workload classification \
  --component-kind model_runtime --mode local --runtime ollama --hardware hardware.gpu
anvilmark candidate assume candidate.classification.local "The GPU host is dedicated to inference"
anvilmark candidate model candidate.classification.local --model example-model \
  --model-version 2026-05-01 --model-mutability pinned --quantization Q4_K_M
anvilmark evidence import pricing.json
```

A model version always needs `--model-mutability`: `pinned` only when the
version names an immutable artifact (an exact release or digest), `floating` for
an alias such as `latest`. A model without a version is floating. A pin
describes one exact `family@version`, so `candidate model` requires
`--model-mutability` again whenever the family **or** the version changes;
re-stating the same identity or changing only the quantization keeps it.
Changing the family also clears licence evidence recorded for the old family.

Unknowns stay unknown (schema `0.1.0-draft.4`). Without `--calls-per-month`,
`workload add` records the monthly volume as unknown (`calls_per_month: null`,
`basis: unknown`): never zero, reported by `compare` as `missing_usage`, and no
projected cost comparison can pass until `workload usage` supplies it.
`--output-classification` records the data classification of what a workload
produces; omitted, it is `null`, meaning not declared, never "not sensitive".
A workload whose input classification or output format is unknown is still
recorded as an unresolved question, because both remain required.
Removing a hard constraint needs interactive confirmation. `candidate status
... viable` is refused unless every relevant hard constraint passes on
admissible, current evidence, and a `pass` result is refused unless its
evidence meets the ratified floor.

## Intelligence mechanisms

There are two, and both use the one provider-neutral request and response
contract from `@anvilmark/adapters` (protocol `0.1.0-draft.1`). The same
contract and task produce the same request; a response is validated the same
way whichever mechanism delivered it. Different intelligences will of course
suggest different things.

### `handoff` — Claude Code, Codex or any agent you run

```bash
anvilmark intelligence select handoff
anvilmark propose export --task propose_candidates
# give the printed .anvilmark/intelligence/handoff/req-....request.json to your agent
anvilmark propose import req-...
```

The request file contains the exact request, where to write the response and
the rules. For example, in Claude Code or Codex: _"Read
`.anvilmark/intelligence/handoff/req-....request.json` and follow
`how_to_respond` exactly."_ ANVILMARK sends nothing and holds none of the
agent's credentials. The agent may send the request to its own model provider,
so the request is projected under the remote rules. An agent that already has
access to your repository can read `.anvilmark/` directly; the projection
limits what ANVILMARK hands over, not what that agent can read.

### `openai_compatible` — a local runtime or an API you configure

Providers are registered in **host configuration**, never in the project:
`$ANVILMARK_CONFIG_HOME/host.json`, else `$XDG_CONFIG_HOME/anvilmark/host.json`,
else `~/.config/anvilmark/host.json`. A file inside the project is refused.

```json
{
  "format": "anvilmark-host/0.1",
  "intelligence_providers": [
    {
      "id": "ollama-local",
      "mechanism": "openai_compatible",
      "base_url": "http://127.0.0.1:11434/v1",
      "model": "YOUR_LOCAL_MODEL",
      "reach": "local",
      "cost": "no_provider_charge"
    },
    {
      "id": "my-api",
      "mechanism": "openai_compatible",
      "base_url": "https://api.example.com/v1",
      "model": "YOUR_MODEL",
      "reach": "remote",
      "credential_env": "MY_API_KEY",
      "cost": "may_incur_cost",
      "timeout_ms": 120000,
      "json_response_format": true
    }
  ]
}
```

```bash
anvilmark intelligence list
anvilmark intelligence select ollama-local
anvilmark propose preview --task propose_candidates   # shows everything; sends nothing
anvilmark propose send --task propose_candidates
```

The adapter calls `POST {base_url}/chat/completions` with the request as the
user message and expects the proposal JSON as the reply (one fenced JSON block
is accepted; prose is not). It was exercised against a controlled local HTTP
server in the test suite. **No live provider — Ollama, OpenAI or any other —
was called while building or testing it.**

### The outbound boundary

- **Remote is disabled by default.** With no host configuration nothing is
  registered, and nothing remote can run.
- **Only the host catalogue registers providers.** Reach, destination (from
  `base_url`), model and credential variable come from it. A project file, a
  request or a proposal has no field that can register a provider, change a
  destination or grant a credential; a project that names an unregistered
  provider is refused. `reach: local` is only accepted for a loopback host, and
  plain `http` only for loopback.
- **Before sending**, `propose send` and `propose preview` show the adapter, the
  destination category and declared destination, the exact data categories
  sent and withheld, whether repository contents or evaluation rows are
  included (they never are by default), whether the provider may cost money,
  the credential variable name, and the request digest. For a remote provider
  the exact request is printed when the project's policy says so (the default).
- **Remote sends need interactive consent** to that exact request: `[y/N]`,
  default no, in a terminal, with no flag or environment variable that
  replaces it. The consent binds the provider id, the declared destination, a
  digest of the registration and a digest of the exact request. It is single
  use and expires after ten minutes. A changed payload, destination, model,
  credential name or any other registered setting needs new consent. An
  `authorization` object placed in a request is refused by the strict request
  schema; consent exists only in the process that asked you.
- **Consent is not approval.** It records that you agreed to send one request;
  it can neither approve nor imply approval of anything.
- **Credentials** are read from the named environment variable at send time,
  sent as a bearer token, and never written to the project, the history, a
  proposal record or any output.
- **Destination is declared policy.** ANVILMARK refuses redirects, so it
  connects to the declared host, but it does not observe or sandbox the
  network, and it does not claim to.
- Secret-shaped values block a send, an export and an import.

Local runtimes (`reach: local`) are sent to without a consent prompt, after the
same disclosure. They receive the ratified public decision-layer set even when
the project allows remote intelligence nothing, under the separately disclosed
local policy of doc 06 section 9; ratified default-deny fields are never sent.

### What a proposal may do

A response can only **add**: constraints (recorded `source: agent_proposed`),
candidates (recorded `discovered`, with any model reference recorded
`version_mutability: floating`), unresolved questions, and inferences
(recorded as `agent_inference` evidence, tier T0, attributed to nothing). It is
applied all or nothing, as a new state revision with provenance: proposal id,
request id and digest, mechanism, adapter, declared destination, raw response
hash, consent record and the generated rationale.

It is rejected as a whole when it is malformed or has unknown fields; names a
workload or other subject that does not exist; redefines a hard constraint or
reuses any existing constraint or candidate id; carries exceptions, statuses,
measurements, estimates, constraint results, approvals or decisions; labels an
inference as anything but `agent_inference`; claims a constraint is a user
declaration; contains a secret; or would produce an invalid contract or make a
current approval non-current.

**Proposal records.** An accepted proposal's record is written inside the state
revision that applies it (the history metadata, `outcome: applied`), before
`project.yaml` is replaced. It is accepted exactly when that revision is on the
committed history chain, so a record and the project cannot disagree. A proposal
that is refused, fails, or cannot be committed is recorded under
`.anvilmark/intelligence/proposals/` with `outcome` `not_accepted`, `rejected`
or `not_committed`; if that record itself cannot be written, the command says
so, and the project is still unchanged. An adapter that throws instead of
returning an outcome is recorded as `adapter_internal_error`.

**Model references.** The protocol has no mutability field and a version string
such as `latest` or `8b` does not by itself name an immutable artifact, so every
generated model reference is recorded as floating. After checking, confirm an
exact artifact with `anvilmark candidate model ID --model-mutability pinned`.

**Protocol gaps.** Milestone 3's wording allows a response to propose
architecture elements and evidence requests. Adapter protocol `0.1.0-draft.1`
has no fields for either, so a response carrying them is rejected as unknown
fields rather than silently extended. Evidence still required is instead
derived deterministically by `compare`. Adding them is a protocol decision
(see the milestone record).

## Compare, decide, approve

```bash
anvilmark compare [--workload ID] [--as-of TIMESTAMP] [--probe-tools]
anvilmark decision draft --id decision.classification --workload classification \
  --select candidate.classification.local --alternative candidate.classification.managed \
  --unresolved quality.classification_f1 --rationale "Local first; revisit after evaluation"
anvilmark decision propose decision.classification
anvilmark review decision.classification
anvilmark approve decision.classification
anvilmark approval status
```

`compare` shows, for each candidate: satisfied, failed and unknown constraints
(after evidence floors, attribution and freshness), every evidence record about
the candidate with its tier and freshness, operating assumptions,
incompatibility reasons, and the evidence still required. It never computes an
overall score. `--probe-tools` checks whether llmfit and promptfoo are installed
(by running `<tool> --version`); a missing tool is reported as a gap.

Decisions move `draft → proposed → approved`, `proposed → draft` (revise, new
revision), `proposed → rejected`, `approved → superseded` (another decision for
the same scope is approved), and `approved → proposed` (its resolved content
changes). A decision cannot be proposed while it claims a constraint is
satisfied without a real pass, or while a hard constraint relevant to the
selected candidate is unknown and not listed with `--unresolved`.

`review` shows the resolved decision, alternatives, claimed constraints,
unknowns, rationale provenance and approval history, then a **covered content**
section containing everything the approval hash covers:

- every field of the selected candidate — deployment, model family, version,
  `version_mutability`, quantization, licence evidence, measurement references
  and expected evaluation, estimates, basis and assumptions — with a warning
  when the model reference is floating, and the proposal and generated
  rationale that added it, if any;
- every approved constraint result;
- every cited evidence record in full: kind, tier, subject, producer, source,
  refresh, attribution, caveats and value;
- the exact JSON the **approval hash** is computed from (SHA-256 over its
  canonical compact form, by `@anvilmark/project-contract`).

Two decisions that differ in any covered field, such as a quantization, differ
in the readable text, not only in the hash.

`approve`:

- runs only when stdin and stdout are both terminals;
- shows the full review, including all covered content and its exact JSON,
  before asking anything, then asks you to type the first 12 characters of the
  approval hash; anything else, an empty answer or ended input approves nothing;
- has no `--yes` flag, no environment bypass, no JSON mode, and no MCP or web
  equivalent;
- re-reads the project after you answer and refuses if anything changed;
- appends one approval record and never edits an earlier one.

If the selected candidate, its cited evidence or the constraint results change
afterwards, the decision returns to `proposed` under a new revision, the
project's contract revision advances, and the earlier approval stays in the
history, reported as not current.

**Approval requires an interactive local terminal. This reduces accidental
approval; it does not prove a human is present, and an agent with unrestricted
shell access can drive a terminal. Rely on your agent's permission settings for
that boundary.**

## Architecture and generated context

The architecture in `project.yaml` — nodes with declared interfaces,
relationships, trust boundaries and decision bindings (schema `0.1.0-draft.5`) —
is authoritative. Views are generated from it and never read back.

```bash
anvilmark architecture node add response-drafter --kind service --name "Response Drafter" --trust-boundary local
anvilmark architecture interface add response-drafter drafter-api --protocol gRPC
anvilmark architecture relationship add classifier-to-drafter --kind connects \
  --from ticket-classifier --to response-drafter --workload response_drafting \
  --data-classification redacted_customer_ticket_with_internal_context \
  --destination-interface drafter-api
anvilmark architecture bind decision.classification --node ticket-classifier
anvilmark architecture show            # origin, standing, effective trust, unresolved support
anvilmark architecture validate --strict
anvilmark architecture confirm node response-drafter    # interactive; agent-proposed elements only
anvilmark generate                     # view.mmd, calm.json, agent-context.md, manifest.json
anvilmark generate --check             # current | missing | incomplete | tampered | stale_*
```

- Every edit is an ordinary validated commit: a broken reference, an
  undeclared data classification, a duplicate id, an interface on the wrong
  node or on a non-`connects` relationship, or removing something still
  referenced is refused and writes nothing.
- Architecture is **declared** structure. It is not approval content, so
  editing it never makes an approval stale, and binding a draft or stale
  decision says plainly that it is not an instruction. Workloads are
  **associated** with nodes through relationships; no field declares where a
  workload actually runs.
- Nothing is invented: a missing description, classification, protocol or
  decision is shown as unknown or UNRESOLVED. Only declared interface ids are
  exported to CALM; protocols stay in ANVILMARK metadata.

### Proposed architecture and confirmation

- `anvilmark propose export --task propose_architecture` asks your intelligence
  for architecture (protocol `0.1.0-draft.2`). On import, new nodes,
  relationships and bindings are recorded as **agent-proposed and
  unconfirmed**, naming the proposal, in the same state revision as the
  proposal record. Existing ids and bindings are never overwritten or extended;
  duplicates and dangling references refuse the whole proposal.
- Unconfirmed elements are shown as `inferred`. Their declared values stay
  visible, but their trust boundary and any crossing that depends on them are
  **unknown**, and links through them are not authoritative support. A possible
  crossing is shown as a possible crossing, never as absent.
- `anvilmark architecture confirm node ID | relationship ID | binding
DECISION_REF` needs an interactive terminal. It first checks that the
  element's proposal was applied in a **committed** revision whose record lists
  it (missing, ambiguous, abandoned or mismatched provenance refuses), shows the
  exact content and its hash, and asks you to type the hash prefix. It keeps
  the element attributed to its proposal, records a history entry, approves no
  decision and authorizes nothing remote.
- A CLI edit that changes confirmed content clears the confirmation with a
  notice. A hand edit leaves the stored hash, which no longer matches: the
  element is `confirmation_stale` until you confirm it again.

### Generation

- `generate` holds the project lock, checks every output destination below the
  physical `.anvilmark/` directory before reading or writing it — symbolic
  links, aliases of `project.yaml`, the lock or `history/`, `intelligence/` and
  `evaluations/` (also case-insensitively and by file identity), and colliding
  outputs are refused, and nothing is changed — writes temporaries, re-reads
  `project.yaml` and the destinations before replacing anything, replaces the
  views and then the manifest, and restores the previous set if a replacement
  fails. It never writes `project.yaml`, history or approvals.
- Every artifact records the project id, contract revision, state revision,
  canonical contract hash, schema version, generator, projection and `as_of`.
  `as_of` is `--as-of`, the manifest's `as_of` for an unchanged source (so
  regeneration is byte-stable), or the clock once, recorded; `--refresh` takes
  a new one. It is never `project.updated_at`.
- Byte stability is not freshness. Every `generate` also evaluates the
  snapshot's time-dependent standings now. If a reused `as_of` is no longer
  current (evidence expired, an exception lapsed), it prints `STALE`
  (`stale_time`, with what changed), keeps the bytes and exits 1; run
  `generate --refresh`. An explicit `--as-of` is a **historical snapshot**: it
  succeeds and says so.
- `generate --check` compares each file byte for byte with what the recorded
  source renders, so an edited view is `tampered` even if its manifest digest
  was edited too; a changed contract is `stale_source`; another generator or
  projection is `stale_generator` (output from generator `0.1.0-draft.1` is
  stale after the draft.5 migration); standings that changed after `as_of` are
  `stale_time`, with `--refresh` as the remedy.
- Output uses the `remote-default` projection unless `--projection
local-disclosed` is given; see [`@anvilmark/context`](../context/README.md).
- `architecture views --mermaid PATH --calm PATH` sets
  `architecture.generated` paths, relative to `.anvilmark/`; paths outside it
  or over project state are refused.

Agents read the same facts through the read-only
[project MCP server](../mcp/README.md).

## Inventory: what a repository uses, with no project

`anvilmark inventory` answers "what AI does this repository use?" before any
project exists. It needs no contract and no declarations, writes nothing, and
states no conformance result.

```bash
anvilmark inventory ../app             # text; PATH defaults to the current directory
anvilmark inventory ../app --all       # every uncertain location, not only counts
anvilmark inventory ../app --markdown  # a report for a pull request or a document
anvilmark inventory ../app --json      # anvilmark-ai-inventory/0.1.0-draft.1
```

It lists where requests go (provider, hosts, operation kinds, call counts), the
models named, every recognized call site, the AI SDKs without a recognizer
whose calls it **cannot** inventory, AI dependencies, the environment-variable
**names** read in files that use those SDKs (never a value), and what stayed
uncertain — separating uncertainty about a listed call from usage that may be
missing from the list altogether. Exit `0` whatever it found, `1` if the path is
not a readable directory, `2` for a usage error.

The same boundaries as `scan` apply: the repository is analysed with the
TypeScript compiler and never run, and nothing is sent anywhere.

## Repository scan

`anvilmark scan` runs the local TypeScript/JavaScript scanner in
[`@anvilmark/scanner`](../scanner/README.md) and writes one file,
`.anvilmark/scans/repository-scan.json`: source-linked observations, bounded
data flows, explicit unknowns and **proposed** bindings. It is not a
conformance check: it emits no pass/fail result, and an empty result never
means the repository is safe.

```bash
cp docs/vnext/fixtures/atlas-scanner.yaml .anvilmark/scanner.yaml   # your declarations
anvilmark scan                          # --repository PATH, --config FILE, --observed-at TIMESTAMP, --json
anvilmark scan show --section flows     # summary|inventory|declarations|observations|flows|bindings|unknowns|errors|limits|all; --json
anvilmark scan --check                  # current | missing | invalid | tampered | stale; changes nothing
anvilmark scan draft-config             # print a draft .anvilmark/scanner.yaml from what a scan observes
```

`scan draft-config` scans without declarations and prints a draft declaration
file: the observed provider calls and unsupported SDK calls as comments, one
sink per recognizer scoped to the directory holding its calls, and commented
suggestions for request-handler sources, sanitizers and per-file components. A
node or candidate is filled in only where the contract leaves exactly one
choice. It writes nothing — review it and save it yourself.

`scan show --section unknowns` lists, once per location, the unknowns that
concern AI calls, declared data or unresolved imports; `--all` lists every
one.

- **Inputs.** The repository is `--repository`, else `repository_root` in the
  declaration file, else the contract's single `project.repository_roots`
  entry. Declarations are `--config`, else `.anvilmark/scanner.yaml` when it
  exists, else none (every mapping is then unbound or heuristic). An invalid
  declaration file is refused and nothing is scanned.
- **Local only.** Nothing is sent anywhere, no model is involved, and nothing
  from the scanned repository is run: no package scripts, builds, executables
  or tsconfig plugins. Links and imports that leave the repository, `.env`
  files, `dist/`, `vendor/`, `node_modules` sources and `.anvilmark/` are not
  read. The artifact holds repository-relative spans and hashes, never
  absolute paths, source excerpts or environment-variable values.
- **Contract untouched.** Scanning never writes `project.yaml`, history,
  decisions, approvals or `repository_bindings`; proposed bindings stay in the
  artifact with their hash-aware decision and architecture standing.
- **Persistence.** `scan` holds the project lock, checks
  `.anvilmark/scans/repository-scan.json` below the physical `.anvilmark/`
  (symbolic links, aliases of `project.yaml`, the lock, `scanner.yaml`, the
  declaration file actually used and protected directories are refused and
  nothing is written), rechecks `project.yaml`, the declarations and every
  repository input the scan read before publishing (a change during the scan
  publishes nothing), writes a temporary file exclusively and renames it.
  `generate` refuses outputs inside `scans/` or over `scanner.yaml`.
- **Identity and time.** The artifact's content hash covers the sources,
  manifests and resolution inputs actually read, the declarations, the
  contract and the scanner, TypeScript, recognizer and stage versions — not the
  Git HEAD. `observation.observed_at` is `--observed-at`, else the stored value
  when the content is unchanged (so an unchanged rescan is byte-identical),
  else the clock once. It is never `project.updated_at`.
- **Exit codes.** `scan`: `0` the scan completed and the artifact was written
  or is unchanged, whatever it observed, unknowns included; `1` the scanner
  failed or refused; `2` usage. `scan --check`: `0` current, `1` otherwise.
  `scan show`: `0` shown, `1` missing, invalid or tampered.

## State under `.anvilmark/`

```text
.anvilmark/
  project.yaml                    the current contract (canonical YAML)
  history/r000001.yaml            every state a commit wrote, never rewritten
  history/r000001.committed.json  written after project.yaml was replaced
  history/r000001.abandoned.json  written when a commit failed, or on --abandon
  history/r000001.json            command, summary, notices, provenance
                                  (including an applied proposal's record), digest
  intelligence/requests/          exact requests exported or sent
  intelligence/handoff/           request and response files for your agent
  intelligence/proposals/         proposals refused, failed or not committed
  architecture/view.mmd           generated Mermaid view (never read back)
  architecture/calm.json          generated CALM 1.2 export (never read back)
  generated/agent-context.md      generated agent context (never read back)
  generated/manifest.json         source, generator, projection, as_of, digests
  scanner.yaml                    your scan declarations (read, never written)
  scans/repository-scan.json      the repository scan artifact (never read by
                                  generate or the MCP tools)
```

A **state revision** (`r1`, `r2`, …) is one save; it is distinct from
`project.contract_revision` and from a decision's `revision`. A commit validates
the exact bytes, creates the snapshot and its metadata exclusively, replaces
`project.yaml` by atomic rename under a lock, and then writes a
`.committed.json` marker. If the rename fails it writes `.abandoned.json`
instead. A failed write, an invalid change, a cancelled prompt or a failed
provider leaves the previous `project.yaml` in place. A command also refuses to
commit if `project.yaml` changed after it was read.

**Which revisions are committed** is decided from those markers and from
`project.yaml`'s bytes — never from which snapshot is newest. A snapshot whose
commit failed is `abandoned` or `uncommitted`: it is not part of the history,
any proposal it applied is not accepted, and no later commit uses it as a
parent. If a commit replaced `project.yaml` but could not write its marker, the
next command recognizes it from the matching bytes. Hand edits are allowed:
`status` reports them, and the next commit builds on the newest committed
revision and includes the edits with a notice.

The one case that cannot be decided is an unmarked revision followed by a hand
edit, so that `project.yaml` matches nothing. That revision is **ambiguous**:
it is never treated as committed, proposal lookups naming it are refused, and
no commit proceeds until you compare its snapshot with `project.yaml` and run
`anvilmark history resolve rN --adopt` (its change is in `project.yaml`) or
`--abandon` (it is not). `anvilmark history` lists every revision's standing
and why. History written before commit markers existed (format 0.1) is anchored
at the snapshot `project.yaml` matches; after a hand edit, its newest entry is
treated as ambiguous and its ancestors as committed.

`project.yaml` is rewritten in canonical form, so comments in it are not
preserved.

## Scope

As decided on September 14, 2026 in
[document 08](../../docs/vnext/08-milestone-3-scope-proposal.md):

- Unknown monthly usage and undeclared output classification are recorded as
  explicit unknowns (amendments 6 and 7, schema `0.1.0-draft.4` and later).
- Structured evidence requests remain deferred to a later adapter-protocol
  revision; evidence still required comes from the deterministic gap report.
  Architecture-element proposals, deferred to Milestone 4, are implemented as
  attributable, confirmable proposals under amendments 8 and 9 in
  [document 09](../../docs/vnext/09-milestone-4-architecture-amendment-proposal.md)
  (schema `0.1.0-draft.5`, protocol `0.1.0-draft.2`).
- The Milestone 3 "network policy" is the remote-intelligence posture:
  `remote_intelligence_policy.default_allow`, host provider registration and
  per-request consent. Nothing enforces a project-wide or evaluation network
  policy, and nothing observes the network.
- Burst assumptions are recorded as informational `throughput` constraints
  (`condition: burst`), with no new field.
- Generated candidate rationale is kept in state-revision provenance and shown
  by `review` and `approve`, with no new candidate field.

## Tests

```bash
pnpm --filter @anvilmark/cli test
```

`tsc -b` then 157 tests in 14 files. They run the built binary in isolated
temporary projects, simulate interactive input where a terminal is required,
serve OpenAI-compatible responses from a local HTTP server, and need no
credentials, no network and no model.

## Conformance (Milestone 6)

After recording the intended repository root in the contract and supplying
scanner declarations, run from the project directory:

```sh
anvilmark conformance --repository ../app --config .anvilmark/scanner.yaml
anvilmark conformance --check --repository ../app --config .anvilmark/scanner.yaml
```

### Rules

```bash
anvilmark rule list                     # --json
anvilmark rule add approved-candidate --id rule.x --workload classification
anvilmark rule add provider-allowlist --id rule.y --workload classification --allow candidate.a,candidate.b
anvilmark rule add forbid-dataflow --id rule.z --constraint privacy.x \
  --data raw_customer_ticket --to remote_provider --unless-through pii-redactor
anvilmark rule remove rule.x            # an error-severity rule needs interactive confirmation
```

Rules say what `conformance` checks. Every reference must already exist in the
contract: an invalid rule is refused and nothing is written. Rules are not
approval content, so adding or removing one never changes an approval.

`check` is an alias for `conformance`. A normal run re-reads the source and
writes one local report, `.anvilmark/conformance/conformance.json`, without
changing the contract or saved scan. `--json` emits the full local report,
including source evidence; treat it as local data. `--evaluated-at TIMESTAMP`
sets provenance, not the input identity or approval authority.

| Normal run exit | Meaning                                                                      |
| --------------- | ---------------------------------------------------------------------------- |
| 0               | Every configured rule passes or is not applicable within the declared scope. |
| 1               | At least one proven violation, even if other paths remain unknown.           |
| 2               | Unknown coverage, an analysis error, invalid arguments or unreadable inputs. |

`--check` also rescans current inputs but writes nothing. Exit 0 means the saved
report is current; that report may contain violations or unknowns. Exit 1 means
missing, stale, invalid or tampered output; exit 2 means the check could not run.
Use a normal conformance run as the compliance gate.

Explicit repository/configuration options establish the selection. Otherwise a
configuration root takes precedence over an unambiguous saved selection, with
the sole contract root as the final fallback. Conflicting saved scan/report
selections require explicit inputs. External custom configurations must be
supplied explicitly. Unknown repository roots, unresolved declarations and
inventory limits prevent a clean pass. File additions and contract, source,
configuration or detector changes invalidate earlier results. Unchanged input
preserves report bytes even as the clock advances. Detected concurrent edits
refuse publication and preserve the previous report; rerun after edits settle.

Report format `anvilmark-conformance-report/0.1.0-draft.2` requires regeneration
of draft.1 output. This changes local analysis output, not the authoritative
project-contract schema. See the [engine scope and MCP semantics](../conformance/README.md)
for the exact supported provider/model and sanitizer checks, declaration
assumptions, and limits. It does not provide whole-program privacy or runtime
network enforcement.

## Review bundles for Studio

`anvilmark export` writes `.anvilmark/review-bundle.json` for
[ANVILMARK Studio](https://anvilmark.vercel.app/studio), which verifies and
displays it entirely in the browser:

```sh
anvilmark check
anvilmark export --include-source
anvilmark export --shareable --require-report --out review-bundle.json
```

Export first rechecks the stored report and scan the same way `check --check`
and `scan --check` do:

- A tampered or unreadable report, or a stale one, is refused. `--allow-stale`
  exports a stale report marked `stale` with its reasons; Studio shows them.
- A stale or unreadable scan is left out with the reason, since the report does
  not depend on it.
- `--require-report` fails unless a current report is included. Use it in CI.

`--include-source` adds only the files that findings, traces and observations
name. A file is left out, and listed under `manifest.sources_omitted`, when it
resolves outside the repository, changed since the scan, exceeds 256 KiB (4 MiB
in total) or contains a recognisable credential.

`--shareable` removes owners, repository roots and bindings, approver and
exception identities, evidence locators, and integration credential references
and data directories from the contract, and lists each removed path. Code
locations are kept. The contract hash is taken before removal, so Studio cannot
recheck it for a shareable bundle. Bundle hashes show the content is unchanged
since export; they do not show who exported it.

`scripts/export-review-bundle-fixtures.mjs` regenerates the synthetic bundles
used by the web tests; CI runs it with `--check`.
