# Contributing to ANVILMARK

Start with the [canonical brief](ANVILMARK-CANONICAL-BRIEF.md) and
[quickstart](QUICKSTART.md). The historical recommendation engine and web page
are scaffolds; the implemented path is local decision contracts, context,
repository mapping and bounded conformance.

Use Node 24 and the pinned pnpm 11.16.0. In an isolated checkout:

```sh
node scripts/setup.mjs
pnpm run build
pnpm test
pnpm lint
pnpm format:check
pnpm verify:mcp
pnpm verify:mcp-project
```

Run package-specific tests while iterating, then the appropriate integration
checks. CLI onboarding tests exercise built binaries; build before using
`vitest` directly. A clean checkout must reproduce new fixtures and commands.
Generated `dist`, dependency directories and local credentials are not source
artifacts. Commit intentional fixture files even when their names intersect
ignore patterns, and verify the committed tree in a clean checkout.

Add regressions for observable bugs and meaningful boundaries. Tests that
simulate terminal approval must say so and use disposable projects/test actors.
Do not call a synthetic approval a real person’s decision or two protocol clients
an actual Claude/Codex demonstration. Separate analysis errors from verdicts and
retain unknowns where the supported scope cannot decide.

Project-schema changes follow the existing amendment process. UI/script changes
cannot weaken contract constraints or silently grant approval. Keep the default
MCP projection safe for source details, state external data authorization
explicitly, and avoid executing repository application code during analysis.

Document the commands actually exercised, runtime versions, optional skips and
remaining limits. A new feature's completion record is not a team signoff or a
production release. See the [M7 record](docs/vnext/milestones/07-onboarding-record.md)
for the current remaining acceptance work.
