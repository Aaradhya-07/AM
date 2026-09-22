# @anvilmark/adapters

Replaceable boundaries between ANVILMARK and the outside world: optional
command-line tools, user-selected intelligence, and facts a person enters by
hand.

```text
ADAPTER_PROTOCOL_VERSION = 0.1.0-draft.1        evidence-adapter envelope
INTELLIGENCE_PROTOCOL_VERSION = 0.1.0-draft.2   intelligence requests; proposals at draft.1 or draft.2
```

Two rules shape everything here.

**Adapters never write the authoritative contract.** They return validated
envelopes; the caller decides whether to attach the evidence. A failing,
hanging, or hostile tool cannot leave the project half-written.

**Absence is an evidence gap.** ANVILMARK works with no optional adapter
installed. A missing tool produces a structured gap — never a crash, and never
a pass.

## Relationship to `@anvilmark/project-contract`

This package depends only on that package's reviewed public exports. It adds no
fields to the authoritative contract and contains no promptfoo-, llmfit-,
Claude-, Codex-, model-, or provider-specific fields in its core. Everything
tool-specific lives in `src/tools/`, behind the same interface any future
integration would implement.

Evidence tiers, admissibility, `applies_to.constraint_refs`, evidence floors,
secret rejection, approval hashing, and unknown-not-pass all remain exactly as
Milestone 1 defined them. This package composes with them; it never relaxes
them.

## Adapter result envelope

Every invocation ends in one of six standings. They are distinct because "not
installed", "ran and failed", and "ran but cannot speak to this target" are
different facts, and collapsing them would hide the difference between an
evidence gap and a broken environment.

| Standing      | Meaning                                                 |
| ------------- | ------------------------------------------------------- |
| `available`   | Ran and produced a usable, validated result             |
| `unavailable` | Not installed or not reachable — an evidence gap        |
| `unsupported` | Installed but cannot answer this question               |
| `failed`      | Non-zero exit, malformed output, or a rejected result   |
| `timed_out`   | Exceeded its deadline and was terminated                |
| `unknown`     | Ran, but the result cannot be attributed to the subject |

`AdapterOutcome<T>` is a discriminated union, so a caller cannot read a value
without first establishing that the adapter succeeded. Every outcome carries
adapter identity and exact version, local-or-remote execution, start and
completion timestamps, provenance (redacted command manifest, source locator,
raw-result hash), sanitized diagnostics, and structured errors.

## Safe subprocess execution

`runSubprocess` treats external tools as untrusted:

- deadline with `SIGTERM` then `SIGKILL`, and `AbortSignal` cancellation;
- combined stdout/stderr byte cap — an over-limit tool is terminated and
  reported as `output_too_large` rather than truncated, because truncated JSON
  is indistinguishable from malformed JSON;
- the ambient environment is **not** inherited; only an allowlist needed for
  executable resolution (`PATH` and platform equivalents) is forwarded, and
  those values are never recorded in a manifest;
- stdout, stderr, error details, and the command manifest are sanitized;
- the raw-result hash covers the **complete** raw result — stdout, stderr, exit
  code, and signal — so two runs can be compared even though the persisted text
  is redacted. Where an adapter relies on an artifact file instead, the hash is
  of that artifact's exact bytes.

Credential values passed to a child are used and never recorded. Environment
variables appear in the manifest by **name only**.

## Evidence adapters

`EvidenceAdapter<Request>` has two operations: `probe()` establishes presence
and exact version, and `collect()` returns one piece of evidence.

An `EvidenceProposal` carries subject and claim, kind, producer and exact
version, observation time, source locator or redacted manifest, attribution
(candidate, workload, hardware, and a **non-empty** `constraint_refs`), value
and units, assumptions and exclusions, raw-result hash, confidence and caveats,
freshness policy, and standing.

There is deliberately **no tier field**. The tier is derived from the kind by
the contract package, so an adapter cannot promote its own output: an inference
stays T0 however confidently it is reported.

`buildEvidenceRecord` applies three gates before anything approaches the
contract — the proposal shape including constraint attribution, secret
scanning, then the contract's own `EvidenceRecordSchema`. `attachEvidence`
re-validates the whole merged contract and returns the original untouched if
anything is wrong.

## Optional tools

| Adapter     | Produces              | Tier | Can clear                                            |
| ----------- | --------------------- | ---- | ---------------------------------------------------- |
| `llmfit`    | `tool_observation`    | T2   | a hardware **compatibility estimate**                |
| `promptfoo` | `measured_evaluation` | T3   | a workload **quality** gate, bound to exact identity |

**llmfit** reads the machine with `--json system` and the model with
`--json info <model>`. The version comes from the probe. The result is checked
against what was ASKED about: if the tool returns a different model or a
different quantization, the outcome is `unknown` rather than evidence.

The detected machine is returned as its **own hardware subject**, with its own
id and `evidence_kind: deterministic_observation`, separate from the
user-declared target. The caller adds it to the contract before attaching the
evidence that references it. Matching compares capabilities — backend,
accelerator count, model, VRAM — never ids, because the two subjects always
have different ids by design. Model names are compared by containment, since a
user writes `RTX 4090` and a tool reports `NVIDIA GeForce RTX 4090`.

The CLI's `--json system` envelope carries no `node` object and no
operating-system field -- those belong to the HTTP API, not the CLI -- so
ANVILMARK observes the OS itself and no hostname is ever read.

An estimated tokens-per-second figure is a T2 estimate and cannot clear a T3
performance gate or a quality gate — enforced by the contract's admissibility
rules, not by convention.

**promptfoo** does not read a config the caller wrote. Parsing an arbitrary
promptfoo config cannot be made sound: the file format admits file references,
globs, scenarios, executable providers and model-graded assertions, and every
one of those puts the bytes that decide pass or fail somewhere the config does
not name. Rather than approximate that with string checks, control is inverted.

ANVILMARK owns a strict, typed **evaluation specification**
(`PromptfooEvaluationSpec`, `PROMPTFOO_SPEC_VERSION = "0.1.0-draft.1"`) and
**generates** the promptfoo JSON config from it. The generated file is the only
config the tool ever sees. `configPath` is still accepted on the request, but
only so a caller pointing at an existing config gets `unsupported_configuration`
instead of a type error; it is never interpreted.

The spec is closed data. Every field is `strictObject`, so an unknown key is
rejected rather than ignored:

- `dataset.rows[]` — inline `vars` and inline `assert`. No `file://`, no path,
  no glob, no `scenarios`.
- `prompts[]` — inline prompt **content**, never a reference, using template
  syntax only as `{{ variable }}` (see "Templates" below).
- `provider` — one id, a configuration drawn from the allowlist below, and
  `credential_env_names`. See the provider boundary below: the id must be
  well-formed AND registered.
- `assert[]` — an allowlist of twelve deterministic assertions (`contains`,
  `contains-all`, `contains-any`, `contains-json`, `equals`, `icontains`,
  `icontains-all`, `icontains-any`, `is-json`, `levenshtein`, `regex`,
  `starts-with`), each also in its `not-` form: **24 types**, each in the exact
  shape its promptfoo handler evaluates (see "Assertion shapes" below), all
  exercised against the real binary in both directions.

### Who chooses what

Three parties are involved, and none of them may do another's job.

| Chosen by                   | What                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Adapter construction        | the executable, the environment it resolves through, credential lookup, provider policy, authorization timing, resource ceilings |
| The evaluation spec         | workload, candidate, dataset, prompts, assertions, provider id, credential names (within policy)                                 |
| Milestone 3 (not this code) | authorization records                                                                                                            |

```ts
const adapter = createPromptfooAdapter({
  executable: "promptfoo", // resolved ONCE to a canonical path, and hashed
  baseEnv: process.env, // captured once; the executable resolves through it
  readEnv: (name) => process.env[name],
  limits: { timeoutMs: 300_000 }, // ceilings; a request may only go lower
  providers: [
    {
      id: "echo",
      reach: "local",
      destination: "local",
      credentialEnvNames: [],
    },
  ],
});
```

**The request is a closed shape.** Its only fields are `evidenceId`, `spec`,
`configPath`, `dataDirectory`, `outputFileName`, `timeoutMs`, `maxOutputBytes`,
`maxArtifactBytes`, `authorization`, `constraintRefs` and `metricUnits`. A
request carrying anything else — in particular `executable`, `readEnv` or
`baseEnv` — is refused with `unsupported_argument` before anything runs.

Those three used to be request fields, which let the caller that supplies an
evaluation also choose how it was measured: a fake binary could emit a
fabricated artifact that became T3 evidence, credential values could be
injected, and a bare executable name could resolve through the ambient `PATH`
for the version probe and through the request's `PATH` for the run. That last
one was reproduced: the evidence came back `available`, recording the probed
program's version, while a different program produced the result. The probe
and the run now use the same construction-time program and the same
construction-time environment, snapshotted when the adapter is built, and
`probe()` ignores any executable passed to it.

### The pinned launcher and where it runs

The configured executable is **resolved once, when the adapter is constructed**,
to a canonical absolute path — a bare name through the construction-time `PATH`,
symbolic links followed — and that file is hashed. Both the version probe and
the evaluation spawn exactly that path, and the file must still hash to the same
digest before the probe, before the run and after it; otherwise the result is
refused with `executable_changed`. A program placed earlier on `PATH` after
construction is never run, and one that rewrites itself during the run produces
no evidence.

This pins the **launcher file only**. promptfoo is a Node program whose launcher
loads many files from its package; those transitive dependencies are not hashed,
and a change to them is not detected.

The digest is recorded in the evidence record's caveats as
`promptfoo launcher sha256:…`. The absolute path is not: the command manifest
records the executable as `promptfoo` and the working directory as
`<run-directory>`, and the arguments name the config and artifact relative to
that directory.

promptfoo runs with the unique **run directory as its working directory**. Its
`HOME`, `USERPROFILE`, `TMPDIR`/`TMP`/`TEMP`, `XDG_CONFIG_HOME`,
`XDG_CACHE_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `PROMPTFOO_CONFIG_DIR` and
`PROMPTFOO_CACHE_PATH` all point inside it, and the probe gets its own
disposable directory with the same layout. Redirection is by environment
variable: it confines well-behaved lookups, and is not a sandbox against a
program that ignores them.

### Versions

The artifact parser, the per-case semantics, row binding, the prompt-as-path
rule and the exit handling are verified for **promptfoo 0.122.0 only**
(`VERIFIED_PROMPTFOO_VERSIONS`). Any other version is `unsupported`
(`version_unsupported`) after the version probe and **before** an evaluation
runs. When an artifact carries `metadata.promptfooVersion`, it must equal the
probed version, or the result is `identity_mismatch`. Supporting another version
means adding its own verified parser and semantics tests.

The check covers promptfoo's own version only. It does **not** independently
verify the dependencies promptfoo loads — in particular the Nunjucks version the
template rules depend on (see "Templates").

### Resource limits

`timeoutMs`, `maxOutputBytes` and `maxArtifactBytes` are construction-time
**ceilings**. A request may omit a limit or ask for a smaller one; a value that
is not a positive integer, or exceeds the ceiling, is refused with
`invalid_resource_limit` before any subprocess starts. Against the previous
version, a `NaN` request timeout started promptfoo and timed it out at once.

| Limit              | Bounds           | Default |
| ------------------ | ---------------- | ------- |
| `timeoutMs`        | 1 to 3,600,000   | 300,000 |
| `maxOutputBytes`   | 1 to 67,108,864  | 4 MiB   |
| `maxArtifactBytes` | 1 to 268,435,456 | 8 MiB   |
| `probeTimeoutMs`   | 1 to 60,000      | 5,000   |

A ceiling outside its bounds, or an unrecognised limit name, is
`invalid_adapter_policy` in both `probe()` and `collect()`.

### The spec is the single authority

Workload, candidate, dataset, dataset version, provider and credential names are
declared **once**, in the spec, and read from nowhere else. There was briefly a
second declaration on the request, and only some of its fields were compared: a
spec for `candidate.real` on `dataset.real@v1` was recorded as evidence about
`candidate.other` on `dataset.other@v9`, because the uncompared fields were
copied onto the record verbatim. A field that is declared twice is a field that
can disagree, so there is now only one place to declare it.

`deriveExpectedEvaluation(spec)` returns the `measurements.expected_evaluation`
a candidate must carry, derived from the same normalised spec and through the
same function the adapter records with.

### The provider boundary

Two gates, neither of them a denylist.

**A grammar.** A provider id is one to three `:`-separated segments, each
starting alphanumeric and continuing with alphanumerics, `.`, `_` or `-`. That
structurally excludes every id that is really a network endpoint —
`https://host/collect?api_key=...`, `webhook:http://host/collect`,
`ws://host/socket`, `user:secret@host`, any path, query string or fragment —
because each needs a character the grammar does not have. This matters beyond
execution: `provider_id` is **persisted on the evidence record**, so a URL
carrying a token would write that credential into the contract.

**A registry of trusted provider policy.** The grammar cannot tell `browser`
or `promptfoo:manual-input` from a model name; they are ordinary words naming
capabilities this milestone does not cover. So nothing is executable by
default. Each registration is a closed shape declaring:

- `id` — the well-formed provider id;
- `reach` — `local` or `remote`;
- `destination` — a stable identity: exactly `"local"` for a local provider, or
  a lower-case host name with an optional port (`api.example.com`,
  `127.0.0.1:9`) for a remote one. Never a URL, path, query or user-info, since
  those would let two different destinations share one identity;
- `credentialEnvNames` — the exact environment variables this provider may
  read.

An unregistered id is refused with `provider_not_registered` before anything is
spawned. A registration that is malformed, lists a provider twice, or grants a
forbidden name makes the whole adapter refuse with `invalid_adapter_policy`, in
both `probe()` and `collect()`, before any subprocess starts. A previous version used a prefix denylist, and a denylist is only ever
as good as its last update: it named `file://`, `exec:`, `python:` and
`package:`, and let URLs, webhooks, sockets, MCP servers, browsers and
interactive input straight through. Deciding what to register is a policy
question this milestone leaves to its caller.

`python:grader.py` and `golang:main.go` are, honestly, well-formed strings that
no grammar distinguishes from `azure:gpt.4`. They do not run because they are
not registered, which is the same reason `browser` does not run.

### Remote projection needs authorization

Decision 06 denies evaluation rows by default unless the user authorizes the
provider path, and requires the exact outbound projection to be shown first.
That is a two-step boundary:

```ts
const prepared = prepareEvaluation(spec, { providers });
// prepared.projection: provider, destination, data categories, counts,
// credential NAMES, and a digest binding content to destination.
```

Nothing executes. The projection digest binds the provider id, the reach, the
**destination identity**, the sorted **credential-name set**, the
**`model_configuration_hash`** (so `temperature`, `max_tokens` and `stop`), the
exact generated config bytes, and a content digest covering every category the
projection lists as outbound — prompts, variable values, assertion values and
row descriptions. Changing any of them invalidates a previous authorization.
Against the previous version, an approval for `temperature: 0.1` was accepted
for a run at `0.9`, and a changed row description kept its approval. A `remote` provider then needs a `RemoteAuthorization` whose
`provider_id` and `projection_digest` match exactly. Missing, malformed,
mismatched, stale, future-dated or unreadable all return
`authorization_required` **before the version probe**, so no prompt, dataset row
or credential reaches disk or the network. A `local` provider is never asked to
authorize sending data it does not send.

**Time.** `authorizationMaxAgeMs` (default one hour) bounds how old an
authorization may be; `authorizationClockSkewMs` (default **zero**) bounds how
far in the future it may be dated. They are separate. A previous version reused
the max age as the future window, so with the defaults an authorization dated
thirty minutes _ahead_ of the clock was accepted. Nothing in the ANVILMARK
documents justifies tolerating a decision timestamped after it is used, hence
zero. Both must be finite, non-negative numbers; `NaN`, `Infinity`, a negative
value or a non-number is `invalid_adapter_policy`. `NaN` had made every age
comparison false, which accepted every authorization.

**Milestone 2 does not create authorizations.** It has no interactive surface
and no standing to approve anything for a person. Milestone 3's flow shows the
projection and records the decision; this adapter only enforces that a matching
record exists.

### Conditions Milestone 3 must meet

These are hard integration requirements, not suggestions. The Milestone 2
adapter does not satisfy them on its own, and must not be exposed without them.

1. **Remote execution stays disabled by default.** No provider is registered
   unless trusted construction-time configuration registers it.
2. **A request-provided `RemoteAuthorization` is not proof of human approval.**
   It is a plain object anyone can construct. It is checked for a matching
   digest, time and provider — nothing more.
3. **Milestone 3 must introduce a trusted verifier.** A construction-time
   authorization store or verifier, or an opaque capability issued by the
   approval flow, must decide whether a record reflects a real decision. No
   signing or identity scheme exists here.
4. **Agents must not construct adapters, provider registries or authorization
   records.** Those are host-owned objects; an agent proposal that yields one
   has already crossed the boundary this adapter relies on.
5. **Provider reach, destination and allowed credential names come from a vetted,
   host-owned catalogue**, never from an agent proposal, a request or a spec.
6. **Destination is declared policy.** Nothing observes where promptfoo actually
   connects; until network observation exists, a destination is what the
   catalogue says it is.

**Status after Milestone 3.** The Milestone 3 CLI does not run promptfoo
evaluations at all: it constructs the promptfoo adapter only to probe whether
the tool is installed (`anvilmark compare --probe-tools`), with no providers
registered. The remote evaluation path therefore stays unexposed and these six
conditions hold by non-exposure. HTTP and custom-endpoint promptfoo providers
remain deferred. The conditions were instead implemented for the outbound path
Milestone 3 does expose, remote intelligence — see "Intelligence mechanisms"
below.

### A completed evaluation is evidence, including its failures

promptfoo 0.122.0 exits `PROMPTFOO_FAILED_TEST_EXIT_CODE` (default 100) whenever
`passRate < PROMPTFOO_PASS_RATE_THRESHOLD` (default 100), after writing its
output (`src/node/doEval.ts:1007`, `1204-1218`). The adapter previously returned
`non_zero_exit` for that, so a completed evaluation with a single failing case
produced no evidence. The adapter now sets `PROMPTFOO_PASS_RATE_THRESHOLD=0`, an
adapter-owned variable: a pass rate is never below zero, so a completed run exits
normally and its failures and errors are counted in available T3 evidence.

**Available evidence says the evaluation completed, not that the candidate
passed.** The pass rate, failure count and error count are in the metrics, and
the contract's constraints decide what they mean.

Nothing else changed about exits. Fatal errors still exit non-zero through
their own path (`DoEvalError`, lines 143-161) and remain failed runs; if
promptfoo still exits 100 — the setting ignored — the run is still refused; the
shared subprocess runner treats every non-zero exit as a failure; and a zero
exit with a missing or malformed artifact still fails.

### The artifact must describe the requested evaluation

With exactly one provider, promptfoo runs every prompt against every row, so
the case count is fixed by the spec before the tool starts:

```
expected_cases = dataset.rows.length * prompts.length
```

`successes + failures + errors` must equal it and it must be non-zero. The
per-case results are **required**, their count must equal it, every row must
name the attributed provider, and every row's outcome must tally to the summary.
Anything else is `unknown`, never available T3 evidence. The rule is checked
against the tool itself: three rows and two prompts produce six cases in
promptfoo 0.122.0.

Counting is not enough on its own: an artifact whose stats report one success
while its only row says `success: false` has the right total and the wrong
result. Rows are classified exactly as promptfoo classified them when it built
the stats, from the pinned source (commit `0170037`, promptfoo 0.122.0):

| Row                                         | Counted as           | Source                                       |
| ------------------------------------------- | -------------------- | -------------------------------------------- |
| `success: true`, `failureReason: 0`         | success              | `trackRowStats`, `src/evaluator.ts:3387`     |
| `success: false`, `failureReason: 2`        | error                | same                                         |
| `success: false`, `failureReason: 0` or `1` | failure              | same                                         |
| `success: true` with reason `1` or `2`      | refused, contradicts | no pinned code path produces it (see below)  |
| missing or non-boolean `success`, or reason | refused              | both fields are required on `EvaluateResult` |

Rows start as `success: false, failureReason: 0`; a failed grading sets `1`;
grading exceptions, provider errors and timeouts set `2`; and every later merge
of a grading result is `previous && next`, so nothing turns a failed row into a
passing one. The `error` **string is never read**: an ordinary assertion failure
sets it, and an empty response sets `error = "No output"` while leaving reason
`0`, which promptfoo counts as a failure. Real output agreed — a passing
assertion was `(true, 0)`, a failing one `(false, 1)`, an invalid regular
expression `(false, 1)` rather than an error, and an unreachable localhost HTTP
endpoint `(false, 2)`.

**Error rows are not produced by a real run in the test suite.** The only way
found to make promptfoo 0.122.0 record an error row under the local `echo`
provider was an assertion it cannot evaluate, such as `contains` with no value
— invalid configuration, which the spec now refuses, not evidence about a
candidate. `echo` never fails and timeouts need a slower provider. Error-row
reconciliation is therefore tested with faithful artifacts: a genuine error row
captured from a closed localhost endpoint, and synthetic rows in the genuine
shape run through the adapter.

That localhost artifact also shows a limit worth stating: promptfoo attributes
an HTTP provider to its **URL**, not to the id `http`, so under the provider
grammar such a run can never be attributed and never becomes evidence. HTTP and
custom-endpoint providers are **deferred** as a capability; the provider-id
grammar was not weakened to admit them.

**Every row is bound to the plan.** Totals and outcomes that agree prove an
artifact is consistent, not that it describes this evaluation. So, from real
0.122.0 output and the pinned source:

- the artifact's prompt list must have one entry per planned prompt, each with
  `raw` and `label` equal to the prompt text
  (`src/prompts/processors/string.ts:19`);
- every row must name the planned provider, and carry integer `promptIdx` and
  `testIdx` within range;
- the rows must cover every prompt-by-row pair exactly once — a duplicate or
  missing pair is `malformed_output`, naming the pairs;
- each row's `prompt.label` must be its planned prompt, `vars` and
  `testCase.vars` its planned variables, `testCase.assert` the default
  assertions followed by its own (`src/evaluator.ts:2526-2529`), and
  `testCase.description` its planned description or none.

A row whose inputs differ is `identity_mismatch`, which is what an artifact from
another evaluation of the same size produces. A row missing a field these checks
need is refused rather than assumed. The rendered prompt (`prompt.raw` on a row)
is not compared, because the adapter does not re-render templates.

**JSON-valued strings must be compact.** promptfoo's exporter rewrites any string
that parses as a JSON object or array to `JSON.stringify` of its value
(`src/util/sanitizer.ts:750-775`), while the run itself SENDS the original — real
output showed `{"ok": true}` sent with its space and exported as `{"ok":true}`.
An artifact therefore cannot show which form ran, so a spec containing
non-compact JSON in a prompt, variable, assertion value or description is
refused rather than normalised. The same exporter replaces strings it judges to
be secrets; such a value would no longer match its plan, and the evidence would
be refused.

### Template and prompt-file inputs

Found while verifying row binding against the pinned source, each reproduced
against `591171a` before it was closed:

- **Prompts promptfoo reads as files.** A single-line prompt containing a slash,
  a backslash or `*`, ending in a prompt file extension, or with a `.` third or fourth
  from the end is treated as a **file path** by promptfoo 0.122.0
  (`maybeFilePath`, `src/prompts/utils.ts:11-36`). The prompt text
  `../../../secret.txt` was read from outside the data directory and returned as
  available T3 evidence; with a remote provider, the file's contents would have
  been sent under an authorization covering only the text. Such prompts are
  refused by a faithful copy of that pinned rule. A multi-line prompt is never a
  path.
- **Prompts fetched from a prompt service.** `portkey://`, `langfuse://` and
  `helicone://` prompts are fetched over the network at render time
  (`src/evaluatorHelpers.ts:424-485`) and are refused.
- **The environment in templates**, and **Nunjucks statements** — superseded by
  the template grammar below. `{{ env.NAME }}` and
  `{% include 'package.json' %}` were both reproduced against `591171a`; the
  adapter still sets `PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS=1` as defence in
  depth, but both are now refused while the spec is planned.

### Templates

**A previous version of this README said Nunjucks expressions were safe to
allow. They are not.** In Nunjucks 3.2.4, which promptfoo 0.122.0 installs,
`{{ range.constructor("return 6*7")() }}` renders `42`: an expression can run
arbitrary JavaScript. Against `483d1cb`, the prompt
`{{ range.constructor("return 42")() }}` executed inside promptfoo and was
returned as available T3 evidence, and `process.pid` was read the same way.
Hiding the environment did not help either:
`{{ env.constructor.constructor("return 42")() }}` executed at config load, in a
description and in a variable, because promptfoo's check for `env.<name>` is
satisfied by `"constructor" in {}`.

The rule is now **positive**, and names no dangerous functions:

- A **prompt** may contain template syntax only as `{{ variable }}` — a plain
  identifier, optional spaces or tabs. Calls, property or bracket access,
  filters, operators, literals, whitespace control, comments and statements do
  not fit that grammar and are refused.
- Every **variable a prompt references must exist in every dataset row.** A row
  variable also shadows any Nunjucks global of the same name, which was checked
  directly, so `{{ range }}` means the row's `range`.
- **`true`, `false`, `none`, `null` and `not` are never variables.** Nunjucks
  3.2.4's lexer makes the first four literals (`src/lexer.js:211-223`) and its
  parser treats `not` as an operator, so `{{ true }}` renders "true",
  `{{ none }}` and `{{ null }}` render "", and `{{ not }}` throws — even when a
  row defines a variable with that name. They are refused while planning. The
  match is case-sensitive, as the lexer is: `True`, `None`, `and`, `in` and `if`
  substitute and remain valid. These five were found by rendering `{{ name }}`
  with a same-named variable for every parser keyword against the installed
  3.2.4; no other keyword failed to substitute.
- **Every other string is literal**: assertion values and array elements,
  variable values and names, descriptions, the evaluation description and the
  references folded into it, stop sequences and metric names. The check runs
  over the generated config promptfoo actually reads, keys included.

"Template syntax" is the four tokens the Nunjucks 3.2.4 lexer acts on in plain
text: `{{`, `{%` and `{#` open a tag, and a bare `#}` throws. `}}` and `%}` on
their own render literally, so compact JSON such as `{"a":{"b":1}}` remains a
valid literal. A refused template is refused while planning, before the version
probe: the real-binary suite checks that the constructor expression and each of
the five keywords produce no probe, no command and no run directory, and that
`{{ ticket }}|{{ range }}|{{ env }}|{{ True }}|{{ None }}` still substitutes.

**These rules describe Nunjucks 3.2.4, and nothing verifies that is the version
promptfoo loads.** The version boundary reads `promptfoo --version`; it does not
inspect promptfoo's installed dependencies. promptfoo 0.122.0 declares
`nunjucks` as `^3.2.4`, a range, so another installation could resolve a later
3.x release whose lexer or parser differs. The launcher digest pins only
promptfoo's launcher file, not the Nunjucks package. The grammar was checked
against the Nunjucks 3.2.4 installed alongside promptfoo 0.122.0 in the test
environment, and against that alone.

### Assertion shapes

Each assertion type is accepted only in the shape its pinned promptfoo 0.122.0
handler evaluates (commit `0170037`, `src/assertions/`). An assertion promptfoo
cannot evaluate is configuration error, not evidence, and is refused while
planning.

| Type (and `not-` form)                        | Accepted                                             | What the handler would otherwise do                                |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| `contains`, `icontains`                       | `value`: non-empty string                            | missing value is an invariant failure (an error row)               |
| `starts-with`                                 | `value`: non-empty string                            | same                                                               |
| `regex`                                       | `value`: non-empty string that compiles              | a bad pattern becomes an ordinary FAILED case                      |
| `equals`                                      | `value`: string, may be empty                        | a missing value compares against the text "undefined"              |
| `contains-all`/`-any`, `icontains-all`/`-any` | `value`: non-empty list of non-empty strings         | a string is split into needles by comma rules; `""` always matches |
| `levenshtein`                                 | `value`: string; `threshold`: integer 0 to 1,000,000 | the threshold silently defaults to 5                               |
| `is-json`, `contains-json`                    | no `value`                                           | a value is a JSON schema, which this subset does not support       |

`metric` is accepted on every type. `threshold` is refused on every type except
`levenshtein`, the only one whose handler reads it. Unknown fields are refused.
Numbers are refused where promptfoo would coerce them with `String()`.

### Provider configuration

A closed allowlist of ordinary sampling parameters, each a finite number in a
stated range:

| Key                 | Type    | Range        |
| ------------------- | ------- | ------------ |
| `temperature`       | number  | 0 to 2       |
| `top_p`             | number  | 0 to 1       |
| `top_k`             | integer | 1 to 1000    |
| `seed`              | integer | 0 to 2^31-1  |
| `max_tokens`        | integer | 1 to 1000000 |
| `frequency_penalty` | number  | -2 to 2      |
| `presence_penalty`  | number  | -2 to 2      |
| `stop`              | strings | 1 to 4 items |

This milestone does **not** model promptfoo's provider configuration, and does
not claim to. `z.record(z.string(), z.unknown())` was described here as closed
JSON data and was not: it accepted `{ request: "file://…" }`,
`{ transformResponse: "file://…" }`, an executable transform expression, a
literal `apiKey`, a function, `NaN`, and a cyclic object — each of which changes
what runs while contributing nothing an identity could describe. Everything
outside the table above is refused, by absence rather than by a pattern that has
to anticipate the attack.

Credentials are named, never carried, and **trusted policy decides which names
a provider may read**. `credential_env_names` in the spec must be portable
environment-variable names, must not repeat ignoring case, and must not begin
with `PROMPTFOO_`, which the adapter owns; that prefix comparison is also
case-insensitive, because on Windows `promptfoo_disable_sharing` is the same
variable as `PROMPTFOO_DISABLE_SHARING`. The spec's list is hashed into
`model_configuration_hash` **and** is what the subprocess receives, so the hashed
set and the executed set cannot differ.

Beyond that, every name the spec declares must appear, **exactly**, in the
registration's `credentialEnvNames`. Otherwise the run is refused with
`credential_not_permitted` before the version probe, and before any value is
looked up. A syntactically valid name is not thereby a credential: `PATH`,
`HOME`, `NODE_OPTIONS`, `OPENAI_BASE_URL`, `HTTP_PROXY` and `HTTPS_PROXY` are
all valid names, and all were previously accepted.

Provider policy itself cannot grant the names that decide **which program runs
or where its traffic goes**: the resolution variables the subprocess runner
forwards (`PATH`, `HOME` and the rest of `EXECUTION_ENV_ALLOWLIST`),
`NODE_OPTIONS` (promptfoo is a Node program, and `--require` there loads code
into the process whose version was probed), and the proxy variables Node's fetch
honours. That is a short fixed set derived from how this adapter executes, not a
list of vendors. Vendor endpoint variables such as `OPENAI_BASE_URL` are not in
it; they are refused only because policy must name every credential it allows.
A policy that deliberately lists one is declaring it a credential, and this
adapter cannot tell otherwise.

Policy is construction-time configuration. It is never read from a request, a
spec or an agent proposal — the request and the spec are closed shapes with no
field that could carry it.

Model-graded assertions (`llm-rubric`, `factuality`, `answer-relevance`, …) are
refused with a reason that says why: their outcome is decided by another model
whose identity this evidence cannot represent or attribute. `javascript` and
`python` assertions are refused because they execute code whose behaviour is
not determined by the bytes in the spec. A rejection names the offending
assertion type rather than surfacing an enum complaint.

Because the spec is closed, identity is **derived**, not declared:

| Digest                     | Canonical bytes                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `dataset_hash`             | canonical JSON of the dataset id, version, and each row's `vars` and `description` — assertions excluded |
| `prompt_hash`              | canonical JSON of the prompt array                                                                       |
| `evaluator_hash`           | canonical JSON of `default_assertions` and every row's `assert`                                          |
| `model_configuration_hash` | canonical JSON of the provider id, allowlisted config, and sorted credential env names                   |
| `config_digest`            | the exact UTF-8 bytes of the generated config                                                            |

A row's data belongs to `dataset_hash` and its `assert` block to
`evaluator_hash`, so changing an assertion moves one digest, not two.
`config_digest` is the whole file, so any change moves it. Canonical JSON is
lexicographically key-ordered with array order preserved, so the same spec has
one identity everywhere — there are no absolute paths in it to normalise.

All of this is computed **once**, into an immutable `EvaluationPlan`: a
canonical deep-frozen copy of the spec, the exact config bytes, and every
derived identity. Those bytes are what the snapshot receives and what
`config_digest` covers, so there is no second render to disagree with the first,
and mutating the caller's objects after validation changes nothing. Rendering
uses the project's canonical serializer, so reversing every key's insertion
order produces identical bytes.

`configPath` and spec validation run **before** the version probe: a request the
adapter will refuse never spawns a subprocess.

Every digest is compared against the caller's expectation; a mismatch returns
`unknown`. The identities are stored **individually** on the contract record
under `value.identity`, alongside the combined `configuration_hash`, so a
reader can see which input moved.

The generated config is written into an **immutable snapshot** inside the run
directory and that is what executes. After the run the snapshot is re-read and
re-digested: if the bytes that ran are not the bytes generated, the collection
fails rather than reporting evidence about something else. No file outside the
run directory is read at any point.

The adapter constructs its own invocation rather than accepting arbitrary
arguments, writes the artifact beneath the ANVILMARK-controlled data directory,
and parses that **file**. Nothing is assumed about stdout, which promptfoo uses
for human-readable progress. Telemetry and sharing are off. A requested
credential that is not set stops the collection rather than silently evaluating
something else. `result_artifact_hash` is the SHA-256 of the actual artifact
bytes.

Provider attribution is read from the artifact — `results.prompts[]`,
`results.results[]` and `results.providers[]`, reconciled — never from the
spec. None, several, or a disagreement is refused, because an aggregate over
several providers is not a measurement of one candidate.

## Manual importer

`importManualEvidence` covers official pricing, licence, residency, provider
capability, and model documentation, requiring publisher, source locator,
retrieval time, exact subject and version, region/tier/currency/unit where
relevant, exclusions, assumptions, constraint attribution, and freshness.

A copied claim **without** an attributable publisher and locator is recorded as
a `vendor_claim` (T1) with a caveat saying why, rather than as official
documentation (T2). It is downgraded rather than rejected: an unattributed
claim is still worth keeping, it just cannot clear a T2 floor.

## Freshness

| State        | Meaning                                     |
| ------------ | ------------------------------------------- |
| `current`    | Usable now                                  |
| `stale`      | Past its configured staleness window        |
| `expired`    | Past its declared expiry                    |
| `superseded` | A newer observation of the same fact exists |
| `unknown`    | Currency cannot be established              |

Old evidence is never deleted — history is what makes a decision auditable —
but only `current` evidence may settle a constraint.
`evaluateConstraintFresh` filters first, then defers entirely to the Milestone
1 evaluation, so an out-of-date measurement yields `unknown` rather than `pass`.

Supersession is keyed on kind, subject, and attribution, with ties broken by id
so the answer never depends on array order.

## Gap report

A category is only closed by evidence that is the right **kind**, correctly
**attributed**, at the required **tier**, and **current**. Stale, expired,
superseded, irrelevant, or wrong-kind evidence leaves the gap open, reported as
`stale_evidence` when something relevant exists but is not current and as the
ordinary missing category when nothing relevant exists. Licence is checked
against the exact record the candidate references.

`buildGapReport` produces a deterministic report grouped by workload and
candidate. The same contract and the same `as_of` produce byte-identical
output, with every collection sorted by code unit. For Atlas it reports missing
quality measurement, target-hardware benchmark, provider region, pricing, and
licence **independently**, plus any optional tool that is absent.

Gap codes: `missing_evidence`, `insufficient_tier`, `inadmissible_evidence`,
`attribution_missing`, `stale_evidence`, `missing_licence`,
`missing_hardware_benchmark`, `missing_pricing`, `adapter_unavailable`,
`missing_usage`.

`missing_usage` (project-contract `0.1.0-draft.4`, amendment 6) is reported once
per workload whose `expected_usage.calls_per_month` is `null` (basis
`unknown`). Its required floor is T1, the user-declared usage assumption a
projected cost comparison rests on; a declared volume or a runtime measurement
closes it. `data_classification_labels` in the remote projection includes each
workload's declared `output_classification` (amendment 7); an undeclared one
contributes nothing.

## Intelligence adapters

`IntelligenceAdapter` is provider-neutral: Claude Code, Codex, a user-supplied
API endpoint, an OpenAI-compatible endpoint, and a local runtime all implement
the same shape, and nothing downstream branches on which is installed. There is
no ANVILMARK default and no ANVILMARK-funded call.

A response is a **proposal**. `reviewProposal` enforces the boundaries:

- an adapter may not approve anything — `approvals` and `decisions` are not
  fields the schema defines, so they are rejected as unrecognised;
- an adapter may not label its own output as measured — an inference's `kind`
  is the literal `agent_inference`;
- an adapter may not redefine an existing **hard** constraint, because a
  proposal that redefines a gate is indistinguishable from one that weakens it;
- a proposed constraint's `source` is the literal `agent_proposed`, so a
  suggestion cannot be recorded as a user declaration.

`buildProjection` builds the exact outbound payload from the contract's
`remote_intelligence_policy`, allow-list driven. Ratified default-deny fields
are stripped even if a policy tries to allow them.

Hardware **capacity** is shareable; machine **identity** is not, and a contract
hardware id is identity — the user chooses it and it routinely names the
machine. Hardware is therefore projected under a projection-local alias
(`hardware-1`), and every reference to it — a local candidate's
`deployment.hardware_ref`, an evidence record's `applies_to.hardware_ref` — is
rewritten to the same alias, so correlation survives without the id leaving the
machine. `payload_json` is what the user sees
before anything is sent, and `isProjectionSendable` refuses a payload carrying
a credential.

`parseProposalDocument` is the contract-independent half of `reviewProposal`
(schema and forbidden fields), shared so every mechanism reports a malformed or
overreaching response in the same terms.

### Intelligence protocol draft.2 (amendment 8)

Proposals are validated strictly against the version they declare:

- `0.1.0-draft.1` is exactly the Milestone 3 shape; `proposed_architecture_nodes`,
  `proposed_relationships` and `proposed_decision_bindings` are rejected as
  forbidden fields, even when empty.
- `0.1.0-draft.2` adds those three arrays. Each entry is strict: an adapter
  cannot supply `origin`, confirmation fields, interfaces or interface
  references. `proposedArchitecture(proposal)` reads them (empty for draft.1),
  and a parsed proposal parses again to the same value.

Requests are built at draft.2, with a `propose_architecture` task; requests
exported at draft.1 still import. Existing architecture is not a projection
field, so nothing new is sent to an intelligence. Whether a proposal's ids and
references fit the contract is decided when the CLI applies it, all or nothing.

### Intelligence mechanisms (Milestone 3)

`buildIntelligenceRequest(contract, { task, execution })` builds the one
provider-neutral request every mechanism receives, with a `sha256:` digest over
its canonical bytes. The same contract and task give the same request; only
`execution` (`local` or `remote`) changes the projection rules, never the vendor.

Two mechanisms implement `IntelligenceAdapter`:

- **`createHandoffAdapter`** — the structured file handoff for Claude Code,
  Codex or any agent the user runs. `buildHandoffDocument` writes the request,
  the response path and the rules; `propose` reads the response file, refuses
  one exported for a different request digest, caps its size, scans it for
  secrets and parses it with `parseProposalDocument`. ANVILMARK transmits
  nothing, but the agent may, so it projects and identifies as `remote`.
- **`createOpenAiCompatibleAdapter`** — `POST {base_url}/chat/completions` on a
  local runtime or a remote API. Tested against a controlled local HTTP server
  only; no live provider was called.

The outbound boundary Milestone 2 required is implemented for this path:

| Milestone 2 condition                                             | How the intelligence path meets it                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Remote disabled by default                                     | Providers exist only in a validated host registration (`validateRegistration`); the CLI reads them from host configuration outside the project, and with none, nothing can be sent.                                                                                                                                                                   |
| 2. A request authorization is not proof                           | `IntelligenceRequestSchema` is strict: an `authorization` field in a request is refused, and nothing in a request is treated as consent.                                                                                                                                                                                                              |
| 3. A trusted verifier                                             | `createOutboundConsentStore` gives the adapter a construction-time `OutboundConsentVerifier`. The interactive host flow grants consent after showing the disclosure; the adapter can only consume it. A grant matches one provider, declared destination, registration digest and request digest, is single use and expires (ten minutes by default). |
| 4. Agents do not construct adapters or authorizations             | Adapters, registrations and consent grants are constructed by the host process. A proposal has no field that yields any of them.                                                                                                                                                                                                                      |
| 5. Reach, destination and credential name from a vetted catalogue | `OpenAiCompatibleRegistrationSchema`: `reach: local` only for loopback, plain http only for loopback, no credentials, query or fragment in the URL, one named `credential_env`, secret-shaped values refused. The registration digest changes with every setting, so consent does not survive a changed model, credential name or destination.        |
| 6. Destination is declared policy                                 | `destination` is derived from `base_url` and labelled declared in every disclosure. Redirects are refused; the network is not observed or sandboxed.                                                                                                                                                                                                  |

`describeProviderDisclosure` and `describeHandoffDisclosure` produce what is
shown before anything leaves: adapter and destination category, declared
destination, data categories sent and withheld, whether repository contents or
evaluation rows are included, cost posture, credential variable name, request
digest and size, and whether consent is required. Credential values are read
at send time through `readEnv`, sent as a bearer token, and never returned in an
outcome or an error; error bodies are sanitized.

New error codes, all additive: `endpoint_unreachable`, `http_error`,
`credential_missing`.

`evaluateCandidateConstraint` is now exported from the gap report, so a
comparison view and `buildGapReport` evaluate a candidate's constraint standing
through one function.

## Public exports

```text
version         ADAPTER_PROTOCOL_VERSION
clock           Clock, systemClock, fixedClock
envelope        AdapterOutcome, AdapterStanding, AdapterIdentity, AdapterError,
                CommandManifest, Provenance, available, notAvailable,
                adapterError, isAvailable, ADAPTER_STANDINGS, ADAPTER_ERROR_CODES
sanitize        sanitizeText, sanitizeStructured, containsSecret
subprocess      runSubprocess, buildCommandManifest
evidence        EvidenceProposalSchema, buildEvidenceRecord, attachEvidence,
                EvidenceAdapter, AdapterProbe, importManualEvidence,
                MANUAL_IMPORT_SUBJECTS, freshnessOf, partitionByFreshness,
                evaluateConstraintFresh, FRESHNESS_STATES, buildGapReport,
                evaluateCandidateConstraint, GAP_CODES
intelligence    IntelligenceAdapter, IntelligenceProposalSchema,
                IntelligenceRequestSchema, reviewProposal, parseProposalDocument,
                buildProjection, isProjectionSendable,
                buildIntelligenceRequest, intelligenceRequestDigest,
                INTELLIGENCE_TASKS, LOCAL_DISCLOSED_FIELDS,
                OpenAiCompatibleRegistrationSchema, validateRegistration,
                createOutboundConsentStore, describeProviderDisclosure,
                describeHandoffDisclosure, createOpenAiCompatibleAdapter,
                createHandoffAdapter, buildHandoffDocument
tools           createLlmfitAdapter, createPromptfooAdapter,
                promptfooEnvironment, evaluationIdentityHash,
                isEvaluationCurrentFor
```

## Dependencies

| Package                       | Licence | Data flow                           | Reason                                   |
| ----------------------------- | ------- | ----------------------------------- | ---------------------------------------- |
| `@anvilmark/project-contract` | —       | In-process only                     | The authoritative contract and its rules |
| `zod`                         | MIT     | In-process only. No I/O, no network | Validating untrusted adapter output      |

No new third-party dependency was added for this milestone. `js-yaml` was
added when the adapter still parsed a caller's YAML config and removed once
ANVILMARK began generating the config itself; nothing in this package reads
YAML now.

## Tests

```bash
pnpm --filter @anvilmark/adapters test
```

723 tests across 21 files. They use the running Node binary as a stand-in for
external tools and a local HTTP server as a stand-in for an OpenAI-compatible
endpoint, and require no promptfoo, llmfit, Claude, Codex, API credentials, or
network access. No real model call is made.

A twenty-second file, `test/promptfoo-real-binary.test.ts`, runs the **real**
promptfoo binary and is skipped unless `ANVILMARK_PROMPTFOO_BIN` names one:

```bash
ANVILMARK_PROMPTFOO_BIN=/path/to/promptfoo pnpm --filter @anvilmark/adapters test
```

It uses promptfoo's built-in `echo` provider, which returns the rendered prompt
verbatim, so it needs no API key and makes no model request or paid call. It was
last run against promptfoo **0.122.0**, the version at the pinned source commit.

Every case in it runs **through `createPromptfooAdapter`**, including the ones
that fail. All 24 assertion types run twice: arranged to hold, returning 24
successes, and arranged to fail, returning available T3 evidence with 24
failures. The failing arrangement is the half that proves anything — a type
promptfoo silently ignored would pass it. A third run puts a passing and a
failing case through the adapter and checks each count; others check row binding
with default assertions and mixed descriptions across two prompts and three
rows, that the constructor expression, environment access and a prompt promptfoo
would read as a file are all refused before anything is spawned. It runs no error
case, for the reason given under "The artifact must describe the requested
evaluation".

Running the real binary is what caught the version probe recording promptfoo's
update banner as the producer version, and in this pass it caught promptfoo
rewriting JSON-valued strings on export. Every mock had passed both.
