# Emergent implementation brief: ANVILMARK example playground

## Objective

Build an interactive browser playground at `/playground` in the existing
`packages/web` Next.js application. Help a new user understand ANVILMARK by
exploring Atlas Support Desk, its decision/evidence and three recorded outcomes.
This is a working example explorer backed by the supplied engine results.

Use branch `codex/emergent-playground` in `N6118/ANVILMARK`. Start by confirming
the branch includes the M7 baseline `04a35556` and this handoff. Save work to this
feature branch. Do not push changes to `main`, merge, deploy or spend the entire
100-credit allowance in one run.

## Read first, narrowly

1. This brief and its sibling README (including the sample field guide).
2. `packages/web/package.json`, its app files and any applicable `AGENTS.md`.
3. `packages/context/src/facts.ts` for `ProjectFacts` and fact/approval semantics.
4. `packages/conformance/src/schemas.ts` for report, result and summary fields.
5. `docs/vnext/milestones/07-local-demonstration-and-usability.md`, especially
   the read view and remaining acceptance boundaries.

Inspect the sample's structure with a small script; do not spend context dumping
the entire JSON or reading the research archive. Before writing Next.js code,
read the relevant documentation bundled with the installed version under
`next/dist/docs` (resolve the package from `packages/web`).

## First run: 10-credit checkpoint

The user will set the platform budget to 10 credits. Complete as much of this
bounded slice as that permits, save a coherent checkpoint, and stop:

1. Run the existing application in preview with its existing framework.
2. Add `/playground` with a clear “Atlas example workspace” identity, persistent
   synthetic/recorded-data notice, overview and scenario selector.
3. Render actual findings from `samples/atlas.json`; selecting a finding opens
   a details panel with the constraint, explanation and linked sample source.
4. Demonstrate violation → corrected → unknown selection with matching supplied
   summaries and findings. Show draft/no-report separately if budget permits.
5. Report changed files, commands/checks run, preview URL, screenshots and any
   integration limitation. Save a commit to the feature branch.

If the monorepo cannot run in Emergent's environment, report the exact obstacle
early. Preserve Next.js/TypeScript/pnpm; do not replace the stack to get a preview.
No automatic budget increase is authorized by this brief.

## Complete experience after the first checkpoint is reviewed

- **Overview:** intent, workloads, constraints, recorded decision standing,
  unresolved questions, evidence gaps and snapshot time. The example's synthetic
  approval must never appear to be the visitor's real approval.
- **Decisions and evidence:** selected candidate and alternatives, rationale,
  evidence tiers/provenance/freshness and unresolved constraints. Display nulls
  as unavailable, never as zero. Keep measured, estimated, inferred and unknown
  distinct. No invented cost savings or “best model” claim.
- **Conformance:** workload/verdict filters, clear pass/fail/unknown/not-applicable
  labels, analysis errors separate from rule verdicts, scope and caveats visible.
  A missing report says “Not checked.” Errors and unknowns cannot become success.
- **Finding details:** exact rule/constraint references, explanation, source
  location with line numbers, trace and existing suggested alternatives. Render
  source as inert text. Use `source_files` for source panels; never read arbitrary
  server paths from a request.
- **Architecture:** readable nodes/relationships derived from existing facts,
  with workload/node selection connected to the details panel. Use existing
  Mermaid text or a simple accessible diagram; advanced canvas editing is later.
- **Guided tour:** a short, dismissible explanation of choosing an example,
  following one failure to its source and inspecting the correction. Controls
  say “Load corrected example” or “View recorded result,” not “Run live scan.”

Preserve state when navigating between views and make the primary task obvious:
understand a finding and the evidence behind it. The user should not need to
understand package names or internal file formats to use the UI.

## Data and implementation boundaries

- Use the committed JSON via a small display adapter inside `packages/web`.
  Keep Node-only context/scanner/crypto code out of browser bundles. The first
  release selects recorded data; it does not run the checker in the browser.
- Preserve the underlying `ProjectFacts` and `ConformanceReport` semantics.
  Never create approval, rewrite hashes, mutate fixtures to force a green view,
  or build a second verdict engine in the UI.
- Validate supported sample shape/version and handle load/validation failures.
  The supplied data can be narrowed into typed view models. Keep draft,
  unapproved, unknown, missing and stale/fixed-snapshot states visibly distinct.
- The report time is fixed; display it as an example snapshot. Evidence freshness
  is evaluated at that snapshot, not the current browser clock. Connecting a
  real local project and checking current freshness is a later integration.
- Work primarily in `packages/web`, its tests and this handoff's implementation
  notes. Preserve the root page and existing visual assets; add a simple link
  to `/playground` if useful. Keep the historical fixture contract separate.
- Do not change core contract/scanner/conformance/CLI/MCP packages. A leaf web
  dependency and necessary lockfile update may be added with a concrete reason;
  prefer existing dependencies. Do not add a database, authentication, billing,
  hosted inference, API keys, telemetry or user repository uploads.
- Do not implement approval buttons or authoritative editing. No project state
  is written by this playground. File upload, arbitrary source editing and live
  provider calls are outside this first allocation.

## Visual direction

Keep ANVILMARK's warm neutral canvas, graphite text and restrained gold accents.
Use a legible sans-serif for prose/navigation and monospace for source/identifiers.
Favor an efficient workspace with a compact header, navigation, main content and
details panel. Establish a hierarchy that makes verdicts and unresolved evidence
easy to scan. Avoid decorative KPI cards when no real metric supports them.

Provide usable desktop and narrow-screen layouts, keyboard navigation, visible
focus, semantic controls and adequate contrast. Color supplements text/icons;
unknown must not look like a passing state. Support reduced motion.

## Validation and acceptance

- Normal setup: Node 24, pnpm 11.16.0, `node scripts/setup.mjs`.
- Start the web workspace using its existing development script and the preview
  platform's required host/port. Record any environment-specific launch command.
- Run web tests, a web production build, lint and formatting for changed files.
  Add a few meaningful UI/data-adapter checks for scenario selection, absent
  reports, unknowns, analysis errors and source linkage; do not mirror markup.
- Verify all three recorded scenarios match their engine summaries and that
  the synthetic approved contract hash stays the same across them.
- Capture browser evidence of the main screen and an open finding on desktop
  and a narrow viewport. Check keyboard access to the details panel.
- No model calls, secrets, real approvals, live-scan claims or source uploads.
- Give the reviewer the final commit, changed-file summary, commands/results,
  preview/screenshots, remaining limitations and actual credits used if visible.

Completion of this brief is example-UI acceptance only. Real-project approval,
actual agent consumption and full M7 acceptance remain separately recorded work.
