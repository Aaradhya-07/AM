# Version Alpha — Implementation record

Date: 2026-11-17. Direction: **The Decision Ledger**, selected by the user, followed by explicit authorization to start. This records the implemented local website; the design proposals remain useful specifications, not claims that every future integration exists.

## Delivered

- New paper/forest home with expressive typography, interactive Restrict → Choose → Run → Review anatomy, an evidence-sheet chapter, product boundaries, model research and local setup entry points. The anatomy is explicitly not a live run.
- Shared responsive navigation/footer and scoped Alpha styles. No new dependencies, animation library, generated images or critical-path videos.
- Rewritten `/start` with source-checkout setup, development landscape and supported local workflow guidance. Copy controls report actual clipboard success or failure.
- New `/workspace` read-only file companion for the actual CLI DevelopmentRun v1 structure. File selection and drop read JSON in browser memory, capped at 2 MiB. No backend upload, persistence, repository connection or agent execution.
- Viewer separates configured/tool-reported models, associated changes, scoped checks, human review and cost basis. An imported run never establishes current approval or human acceptance. Subscription cash cost stays unknown even when a payload carries a numeric estimate. Invalid replacement files leave the existing record intact.
- Preserved model research: same catalog/data engine, filters, comparison, sources, dates, release/ranking views and CSV export, with Alpha styling and updated identity.
- `/demo`, `/playground`, `/studio` and `/dashboard` now explain retirement and link to the supported Alpha workflow. Header, footer and setup no longer advertise Atlas or those journeys. Old bundle types are not silently converted.
- Old optional dashboard implementation is retained in `app/dashboard/legacy-console.tsx` for maintainers, not rendered at its former route. Shared legacy engines, tests, API handlers and media are not deleted blindly.

## Verification

- Web suite: **12 files, 80 tests passed**, using the existing installed Vitest binary. Includes new parser/type/version rejection, pass/fail/unknown distinctions, arbitrary acceptance-claim exclusion and cost-basis tests. Updated old onboarding/catalog-copy assertions to reflect intentional product changes.
- Production build: passed with the installed Next webpack builder, including TypeScript and static page generation. User's pre-existing `next-env.d.ts` edits were saved and restored around builds.
- Browser: desktop home, mobile home, model research, local setup and empty/populated run reader. Home overflow checked at 320, 768, 1024 and 1440px; sampled setup/research/run states at 390px had no document-wide horizontal overflow.
- Mobile menu opens/closes; Escape closes and returns focus. Workflow selector updates the selected stage and explanatory text. Valid file import, invalid replacement, explicit test-approval warning and close action checked with temporary QA-only files. Import focuses the record heading; close restores file-picker focus.
- Reduced motion: zero active animations and no hidden narrative sections in sampled home states. No hero/section video element is rendered by Alpha.
- Core contrast ratios: ink/paper 14.07:1, muted/paper 5.59:1, paper/forest 8.53:1, supporting light text/deep forest 9.05:1. These are core-pair checks, not a complete accessibility certification.
- Formatted changed files and checked patch whitespace. Existing CLI/MCP/example/script changes were not edited, staged or reverted.

The test suite emits existing React act warnings in hardware tests. Next emits the existing middleware-to-proxy deprecation warning. Neither prevented checks. No dependencies were installed: pnpm's wrapper initially attempted an automatic dependency check and aborted; verification then used existing binaries directly.

## Deliberate limits

The browser does not launch agents, inspect arbitrary filesystem paths, independently validate imported run integrity, establish human review or provide automatic task recommendations. The supported operational path remains local CLI tooling. Full local-record adapters, current-state verification, linked review imports and hosted/local pairing require separately bounded functional work. The file reader is an explicit, usable first slice rather than a simulated connection.

No production deployment, commit or tag was created. The existing local server at port 3000 was reused. No Lighthouse, field Web Vitals or complete screen-reader audit was performed; do not claim the provisional performance budgets are measured results.

## Local review

- `/`: new product experience.
- `/start`: local setup.
- `/models`: sourced model research.
- `/workspace`: open your own development-run JSON.

Rollback should restore only the Alpha route/component/style changes, leaving local project records, schemas and unrelated working-tree changes intact.
