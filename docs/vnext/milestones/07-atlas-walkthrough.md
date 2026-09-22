# Atlas offline fixture replay

Status: **Offline integration replay; full Milestone 7 acceptance remains open.**

This document supersedes the earlier acceptance claim. The prior script copied
an approved fixture and identified two protocol clients as Claude Code and
Codex. Those actions did not demonstrate real human approval or either agent
application. The corrected replay labels its synthetic state explicitly and
checks actual CLI/MCP responses.

For an operator-facing draft → review → approval → source-check path, use the
[guided workshop](07-guided-workshop.md). The replay below remains unattended
and deliberately uses synthetic approvals.

## Run from a checkout

Use the repository's pinned pnpm version, install dependencies and build:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm demo:atlas
```

The runner creates isolated temporary projects and synthetic source. It does
not call a provider, download a model or launch an agent application. Dependency
installation can require network access. It removes its own temporary workspace
and closes its protocol clients on completion. To retain the fixtures/reports:

```sh
pnpm demo:atlas --keep
```

## What the eight steps verify

1. Check the runtime and built CLI/MCP entry points.
2. Initialize the Atlas draft in a draft project through the real CLI.
3. Compare its classification candidates, leaving evidence gaps explicit.
4. Initialize a separate project from the committed synthetic approved contract
   in `packages/conformance/test/fixtures/approved-remote-atlas.yaml`, declare
   its repository, and generate context. The synthetic actor is not a person.
5. Start two stdio harness clients, discover eight tools, and check identical
   successful responses for four context queries. This tests server consistency
   under the same inputs, not actual agent application compatibility.
6. Under that contract, analyze a literal unapproved model receiving raw ticket
   data. Require **both provider and privacy rules to fail**, exit 1, with
   source locations and no analysis errors.
7. Correct the source in the same repository to use the pinned approved model
   and declared redactor. Without refreshing the old failing scan artifact,
   require a fresh conformance run to pass both rules, exit 0. Verify report
   freshness, unchanged contract bytes and stable output across clock changes.
8. Replace the implementation with the ambiguous runtime-dispatch fixture under
   the same contract. Require both rules to remain unknown, exit 2.

The runner asserts parsed result fields and exit codes; printed success labels
alone cannot make it pass. It finishes with:

```text
OFFLINE ATLAS FIXTURE REPLAY COMPLETE
```

## Interpreting the evidence

The remote candidate uses the literal test identity
`openai / gpt-4o-mini-2024-07-18`. No live model or pricing assertion is made.
The synthetic SDK is present for static symbol resolution; the application code
is analyzed, not executed against a provider.

A privacy pass depends on declared source completeness, mappings and sanitizer
effectiveness. It covers bounded direct flow only. Unknown dynamic dispatch is
not compliant, and a detected violation remains a failure even when other paths
are unknown. Analysis errors are separate from rule verdicts. See the
[conformance scope](../../../packages/conformance/README.md).

This replay does not prove human presence, authenticated approvals, empirical
redaction quality, runtime routing, whole-program privacy, actual agent
consumption, all security properties or every supported operating environment.
Real interactive approval and recorded agent application/version evidence remain
separate requirements in the [Milestone 7 plan](07-local-demonstration-and-usability.md).
The project MCP has no approval tool; that does not prevent an unrestricted
external process from editing local project files.
