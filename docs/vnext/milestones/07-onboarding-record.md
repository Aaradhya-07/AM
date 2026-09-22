# M7 installation and onboarding record

Status: **Installation, onboarding and guided workflow implementation verified and merged into `main`, September 16, 2026. M7's broader acceptance remains open.**
Base: `078fcb58462c1f598f7f30772e65f8ed7d7903f8`, the reviewed M6 correction
head now merged and pushed to main. This work addresses the authorized M7
installation, onboarding, documentation and usable workflow scope. It does not
claim the later real-project or actual agent demonstration is complete.

## Integration

On September 16, the user authorized merging and pushing the verified M7 work.
A fetch confirmed `main` and `origin/main` at the M6 base above. In the clean
main checkout, `main` fast-forwarded to the reviewed M7 branch head
`9510240177a9e14180ee85cbee39cab1db2ecd78` without conflicts. The resulting
tree was identical to that reviewed head. The publication follow-up changes
only setup instructions and milestone status records; no runtime code, tests,
fixtures, package metadata or lockfile changed after verification. This
integration does not approve any project decision or close broader M7 acceptance.

## Delivered behavior

- Committed CLI/project-MCP/audit-MCP launchers exist before build and provide
  actionable startup errors. Package bin metadata points at those launchers.
- `node scripts/setup.mjs` checks the prescribed Node/pnpm versions, installs the frozen
  lockfile, builds core packages and checks entry points. It configures no host
  shell, model runtime or agent application.
- `node scripts/doctor.mjs` reports prerequisite/build health and optional tool presence.
  Corepack network fetching is disabled for its version probe; no optional tool
  is executed. The documented direct Node invocation avoids pnpm built-ins and package-manager
  automatic installation before a diagnostic script runs.
- `pnpm run workshop prepare NEW_DIRECTORY` goes through draft import, a visible
  proposal preview/export, a labeled offline proposal import, candidate setup,
  comparison, decision drafting/proposal and exact review using the real CLI.
  It records no approval. All training inputs/gaps remain labeled.
- The guided source check refuses unapproved/stale decisions, generates context
  only after current approval, and evaluates current source. Known template
  transitions show both-rule fail, corrected pass and dynamic unknown under the
  same contract. Manual edits and symlinked workshop paths are preserved/refused.
- Quickstart, guided walkthrough, troubleshooting, package overview and
  contribution guides use consistent entry points and explain cleanup,
  projections, evidence assumptions, optional adapters and analysis limits.

## Verification

Verified implementation: `aeb2676d34ea0082b2c1320c95a48ac3d4e17f6e`.
Environment: macOS, Node `v24.15.0`, pnpm `11.16.0`.

A fresh detached checkout of `c107fea370362bcc01741169d1c3819c3a2c3cfe`
started without dependencies or build output. The documented direct Node setup
completed the frozen install and core build, with working package-manager bin
links. Full workspace build, lint, format and both MCP verifiers passed there.
The checkout then advanced to `aeb2676d`, whose sole change bounds adapter test
workers; runtime code, dependencies and the lockfile are identical. The full
suite passed at that final commit and the checkout remained clean.

| Check                                                   | Result                                                                                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/setup.mjs`                                | Frozen install, core build and entry-point checks passed; no pre-build missing-bin warning.                                                                                               |
| `node scripts/doctor.mjs --json`                        | Ready; promptfoo and llmfit absent and optional.                                                                                                                                          |
| `pnpm --filter @anvilmark/mcp exec anvilmark --version` | Workspace-linked CLI resolved and reported its version.                                                                                                                                   |
| `pnpm run build`                                        | Passed across the workspace, including the web scaffold.                                                                                                                                  |
| `pnpm test` at `aeb2676d`                               | **1,432 passed, 22 skipped, 0 failed.**                                                                                                                                                   |
| `pnpm lint`, `pnpm format:check`                        | Passed; the subsequent test-config change also passed lint/format checks.                                                                                                                 |
| `pnpm run verify:mcp`                                   | Passed through the public historical launcher.                                                                                                                                            |
| `pnpm run verify:mcp-project`                           | Eight read-only tools, 11/11 identical harness responses, protocol-only stdout and unchanged project tree.                                                                                |
| Documentation/workshop checks                           | Prepare and instructions commands executed; refusal preserved the unapproved project. Integration tests exercised the same commands through built binaries. Relative guide links resolve. |

Two initial full-suite runs at `c107fea3` hit five-second deadlines in different
existing adapter tests. The affected files passed in isolation. Running the
entire adapter suite with two workers passed all 723 tests, so the final commit
applies that bound to this subprocess-heavy suite. Assertions and timeouts were
not relaxed; the final ordinary `pnpm test` passed. The earlier logs are retained
alongside the passing run, rather than being counted as successful checks.

The 22 skips are 19 optional real Promptfoo binary tests, two external CALM CLI
checks and one external Mermaid parser check; those prerequisites were not
supplied. Explicit local tool probes also reported promptfoo and llmfit as
unavailable without blocking comparison. No new live-provider validation is
claimed. The completion update above the verified implementation changes only
documentation.

The new integration tests exercise preparation, zero approvals, unchanged state
on unapproved/stale refusal, path quoting, template transitions, manual edit
preservation, symlink refusal, pre-build launcher errors and diagnostics without
environment secret disclosure. Continuation tests use an explicitly named
synthetic actor and simulated terminal input in disposable projects; these do
not count as real human approval evidence.

## Still requires separate acceptance

- A real user decision on a real project, followed by actual agent consumption
  and its recorded application/tool versions and contract revision.
- Actual Claude application compatibility (deferred by the user's instruction
  to stop using Claude).
- Team/operator usability acknowledgements and other operating-system/runtime
  combinations; no signatures or acknowledgements are inferred from tests.

M7's remaining milestone checklist items stay open for those requirements. The offline
replay and guided training workflow verify implementation behavior; neither
substitutes for that acceptance. No production privacy guarantee, live provider
benchmark, price validation or new schema ratification is claimed.
