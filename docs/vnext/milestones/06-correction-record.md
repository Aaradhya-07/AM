# Milestone 6 correction record

Status: **M6 corrections verified September 15, then merged and pushed to `main` September 16, 2026.**

Baseline: `5dbc5cfcc9c930e145eba65810d2eed7b4570f7e`, which already contains the
previous M6 and M7 merges. This corrective change does not ratify contract
amendments, approve a real project decision, or establish Milestone 7 acceptance.

## Defects corrected

| Finding                                                                | Correction and regression evidence                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1: stale scans treated as current; repository overrides ignored       | CLI/MCP scan current inputs in memory; `--check` compares fresh results. Regressions cover source edits, new files, configuration, explicit repository, selection conflicts and publication races.                       |
| R2: remote conformance replies included local source details           | Explicit response projection for results and lookups; actual stdio checks verify default withholding, local disclosure and path-free failures.                                                                           |
| R3: proposed files echoed without analysis; invalid arguments accepted | Shared strict schemas and semantic validation; selected source paths must exist in the current scan. Full repository analysis preserves cross-file context. Candidate-only comparisons state their narrower scope.       |
| R4: any sanitized tag satisfied privacy                                | Check the protected classification and derivation against every required sanitizer's resolved architecture node and cleared classification. Cover wrong sanitizer, no exception, ignored output and superseded contexts. |
| R5: a candidate label hid a different provider/model                   | Compare supported concrete deployment/provider/model identity to current policy. Missing or dynamic identity is unknown. Require the workload's current approved decision; do not resurrect historical approvals.        |
| R6: errors and incomplete inventory produced compliance                | Analysis errors are separate and noncompliant; unresolved declarations, limits, unknown inputs and unbound dynamic operations cannot produce a clean pass.                                                               |
| R7: unrelated uncertainty hid a violation                              | Keep proven failures and their source evidence while retaining unknown-path caveats.                                                                                                                                     |
| R8: stale contract/state identity and inconsistent hashes              | Use actual contract hash/state revision, complete scan identity in result IDs, validated nested hashes/summary, and canonical hashes independent of observation/evaluation time.                                         |

Additional integration corrections compare physical directory identity for
repository aliases, keep explicit allowlist alternatives distinct from approved
candidate alternatives, reject ambiguous saved input selections, and retain
configuration symlink selection so retargeting invalidates the old result. All checks
remain bounded by the existing scanner rather than expanding language or SDK
coverage.

## Acceptance evidence

Verified implementation commit: `f37b3430de2f7cb6e2ba054f9c3593b767f182b7`.
A fresh detached checkout of that commit was installed with the frozen lockfile
and tested using Node `v24.15.0` and pnpm `11.16.0` on macOS.

| Check                            | Clean-checkout result                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile` | Passed; no lockfile change.                                                                                        |
| `pnpm build`                     | Passed across the workspace, including the web scaffold.                                                           |
| `pnpm test`                      | **1,428 passed, 22 skipped, 0 failed.**                                                                            |
| `pnpm lint`                      | Passed.                                                                                                            |
| `pnpm format:check`              | Passed.                                                                                                            |
| `pnpm verify:mcp`                | Passed; historical three-tool discovery.                                                                           |
| `pnpm verify:mcp-project`        | Passed; eight tools, strict errors, 11/11 identical harness responses, JSON-RPC stdout and unchanged project tree. |
| Working tree after checks        | Clean.                                                                                                             |

The 1,428 tests include 33 conformance-engine tests, 182 CLI tests, 66 scanner
tests and 23 MCP tests. The Atlas replay is executed by the CLI integration
suite through built binaries. The 22 skips are 19 optional real Promptfoo
binary tests, two external CALM CLI checks and one external Mermaid parser
check; their prerequisites were not supplied for this run. No new live adapter
validation is claimed. Adapter, context, scanner and authoritative contract
packages and the lockfile are unchanged by this correction.

During initial clean installation pnpm warns that the workspace CLI binary is
not built yet. Installation exits successfully, the subsequent build creates
the entry points, and the documented direct-node CLI/MCP commands pass. This
is not a claim of a complete global package installation or OS/version matrix.

The final completion update changes documentation only above the verified
implementation commit. At that point the corrections were committed locally and `main` remained at
the baseline. In the subsequent user-authorized integration, `main` was
fast-forwarded from `5dbc5cfc` to `078fcb58462c1f598f7f30772e65f8ed7d7903f8`
and pushed without force. A fresh remote query confirmed GitHub `main` at
that exact commit. The verified implementation tree was unchanged.

The local report/engine format is `0.1.0-draft.2`; draft.1 reports must be
regenerated. The authoritative project schema remains `0.1.0-draft.5`.

New core, CLI and actual stdio regressions exercise the defects above.
`pnpm demo:atlas` now checks both-rule failure, corrected both-rule pass, and
both-rule unknown under the same synthetic approved contract and repository.
The latter two cases deliberately retain the old saved scan to verify fresh
source analysis. It also checks contract byte preservation and report stability.
The integration test runs built binaries and checks the script's exit status.

Synthetic fixture approvals explicitly name a test actor. Copied source models
are pinned to the contract's literal test identity. They do not record an
approval by any team member or establish a real provider's current capabilities.

## Limits and status boundaries

- Source completeness, workload/sink associations and sanitizer effectiveness
  remain declarations. A static pass is not a runtime privacy or redaction
  guarantee. Only bounded TypeScript/JavaScript direct flows and supported
  OpenAI/Ollama identities are checked.
- Endpoint overrides, unresolved dynamic dispatch, missing identities and
  unsupported coverage remain unknown. Observed default endpoints assume no
  runtime environment or routing changes.
- CLI/MCP recheck the snapshot; they do not lock every external writer out of
  the source tree or promise that the repository stays unchanged afterward.
- Hashes establish internal consistency and snapshot identity, not authenticity.
- Local reports and `local-disclosed` MCP replies contain source evidence.
  Default conformance replies withhold that evidence; detailed diagnostics
  remain on local stderr.
- The old demonstration overstated human approval and real agent consumption.
  Its output and documentation now identify an offline fixture replay. Full
  Milestone 7 acceptance is reopened; no external agent was run for this change.
