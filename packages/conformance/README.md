# `@anvilmark/conformance`

The Milestone 6 engine compares a supported TypeScript/JavaScript scan with the
current project contract. It returns independent provider and data-flow results,
source evidence, declared assumptions, and suggested corrections.

## What the rules establish

- `approved_candidate_only` uses the workload's current approved decision.
  `provider_allowlist` uses the candidates explicitly listed in that rule.
  Both compare the observed deployment, provider and literal model reference
  with the candidate. A declared candidate label cannot override a different
  observed model.
- **Identity is the call's endpoint**, not the SDK's vendor: an OpenAI client
  pointed at another host is judged as that host's provider, and an Azure
  deployment must match the candidate's. A host the scanner does not know, an
  endpoint or model chosen at run time, and a client the scanner could not link
  remain unknown rather than assumed.
- **Like is compared with like**: an embedding call is not judged against an
  approved chat model, and an upload or management call is judged on provider
  identity alone — the kinds it did not judge are reported as a caveat.
- **Declared run-time values** (`models:` and `providers:` on a sink) are used
  as T1 evidence where the code alone is unresolved, so a repository that picks
  its model from configuration can still reach a verdict. They are your
  statements, recorded as assumptions, never as observations.
- `forbid_dataflow` follows source classifications and their derivation through
  intraprocedural def-use and one level of resolved direct calls. Its sanitizer
  exception requires every specified architecture node to appear in the active
  trace through a resolved declaration that clears the relevant classification.
  A generic `sanitized` flag, a different sanitizer, or a sanitizer whose output
  is ignored cannot satisfy the exception. A rule without an exception still
  forbids data derived from the protected source.

## What blocks a verdict, and what does not

Uncertainty blocks a verdict only where it could change it. A rule's evaluation
takes the unknowns in its **workload's scope** (the files its components
declare, or the whole files where a component names no export), plus
repository-wide reasons that could hide a provider call anywhere — a run-time
import specifier, an unresolved import, reflection or code generation.
Unknowns in another workload's files, and in test code, do not block it; those
that remain outside the judged scope are reported as caveats instead. This is
what lets one workload reach `pass` in a repository that is uncertain
elsewhere, without hiding that uncertainty.

Declared sources, component mappings and sanitizer effectiveness remain T1
assumptions. Deterministic analysis of those declarations is not empirical proof
that a sanitizer removes PII. The engine does not check runtime environment
endpoint overrides, actual network routing, hidden inputs, deep call chains,
cross-service flows or arbitrary languages/SDKs. A pass is bounded to the
selected inventory, supported operations and stated assumptions.

## Verdicts and errors

`pass` means the rule is satisfied within that scope; `fail` identifies a
supported violation; `unknown` means coverage or evidence is insufficient;
`not_applicable` means no applicable operation was observed in the supported
inventory. Inventory limits and unresolved declarations cannot produce a clean
pass. A proven violation remains a failure alongside unknown paths, with both
its evidence and the uncertainty retained.

Parser/analysis errors appear separately in `analysis_errors`, with no fabricated
per-rule verdicts and `summary.compliant: false`. Missing or obsolete evidence
also cannot be reported as compliant. A report with no rules makes no policy
claim; its empty summary only means no rule failed.

## Current input checks and identity

The pure `evaluateConformance` API requires a complete, self-consistent scan
snapshot. It checks its integrity, contract identity and supported detector
version. Filesystem callers must also establish freshness. CLI and MCP do that
by scanning current inputs in memory and rechecking the contract, configuration
and input inventory before publishing or returning a result.

The CLI writes `.anvilmark/conformance/conformance.json` atomically under the
project lock. It preserves the previous report if a detected concurrent input
change prevents publication. These checks do not lock other applications out of
the source tree; the report describes the checked snapshot, not future edits.

An explicit repository wins over the scan configuration. Otherwise the
configuration's repository root wins, followed by an unambiguous saved
selection, then the contract's sole root. A saved custom configuration is
reused; external configurations require an explicit path. If a stored scan and
report select different repositories/configurations, explicit inputs are
required to resolve the conflict. Directory aliases are compared by physical
identity. A repository absent from the contract's roots is a coverage limit.

The report format is `0.1.0-draft.2`; the engine is `0.1.0-draft.3`, which
reads scans up to `anvilmark-repository-scan/0.1.0-draft.3`. Regenerate reports
written by an older engine. The project-contract schema remains draft.5. Result IDs include the
rule, current contract, complete scan identity and engine version. The report
records actual state revision separately from contract revision. Observation
and evaluation times are provenance, excluded from the canonical report hash;
unchanged inputs preserve the existing report bytes. Nested result hashes and
summary consistency are checked on read. Hashes detect inconsistent content;
they are not signatures or proof of authorship.

## MCP surface

- `run_conformance`: rechecks current source using the locally established
  selection. An optional workload filter retains global privacy rules; the
  returned hash still identifies the full repository report.
- `check_proposed_change`: accepts selected existing repository-relative source
  files, or a workload/candidate pair. File checks analyze the whole selected
  repository to preserve cross-file context. They do not apply a supplied diff
  or infer unwritten code. Candidate-only requests explicitly return
  `candidate_policy_only`, without claiming implementation verification.
- `get_conformance_result`: looks up a current result by ID; an old ID is not
  silently treated as a current result.

All three are read-only. Their default `remote-default` response contains rule
IDs, verdicts, counts and hashes, with local source paths, traces, explanations
and analysis diagnostics withheld. `local-disclosed` explicitly exposes the
full local evidence. Argument validation and source-read errors have path-free
tool responses; detailed diagnostics stay on local standard error. Establish
selection locally with `scan` or `conformance` before source queries through MCP.

## Reproduce

From the repository root, build first, then run `pnpm --filter
@anvilmark/conformance test`. `pnpm demo:atlas` exercises a synthetic offline
contract through built CLI/MCP binaries: both rules fail, the corrected source
passes under the same contract, and dynamic dispatch remains unknown. It is a
fixture replay, not a real project approval or Milestone 7 acceptance.
