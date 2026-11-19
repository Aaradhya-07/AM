# Version Alpha — Implementation plan

Implementation update: the user authorized implementation after selecting Direction A. See [Alpha implementation record](ALPHA_IMPLEMENTATION.md) for delivered scope, checks and remaining integration limits.

Status: Direction A — The Decision Ledger was APPROVED by the user on 2026-11-17 (selection “1”); the creative-direction gate is satisfied. Detailed integration and execution scope remain PROVISIONAL. This document records planning, not completed implementation. The user has explicitly requested abandonment of Atlas and obsolete legacy features; this plan implements that product reset after the direction gate. The original planning deliverable changed no application code. Subsequent authorized implementation is recorded in ALPHA_IMPLEMENTATION.md.

## Intended result and boundaries

A distinctive Anvilmark entry experience and coherent local development-record workspace: repository landscape → bounded task → eligible agent/model choice → run evidence → human review → comparable outcomes. Retire Atlas and the application-model demo/conformance journey from Alpha. Keep useful deterministic engines, source data and tests where appropriate; removing a screen does not require rewriting its underlying package.

Do not silently treat an application contract as a coding-agent plan. No new hosted intelligence, automatic savings promise, mandatory account, arbitrary hosted repository access or fake local connection. No dependency is approved in this planning phase. Browser approval and agent execution are functional integration work, not implied by an attractive control.

## Phase 0 — Direction and scope contract (P0, gate)

Dependency: user selects A, B or C. Record the choice and freeze its typography, palette, hero storyboard, core routes and retirement list. Scope starts from [audit disposition table](PRODUCT_AUDIT.md); confirm model research remains useful while “Atlas” branding and legacy demo concepts leave. Choose local read-only record inspection as the first operational slice; writes remain with supported local tooling.

Acceptance: approved art direction and bounded first slice; no assumption that choosing a look approves every integration. Record current dirty-tree baseline without staging/reverting others' work. Publish a route-retirement mapping before deleting files. This document does not supersede the canonical product brief.

## Phase 1 — Establish truthful product inputs (P0)

Dependency: Phase 0. Inspect the exact development pilot record formats and supported local operations on the selected baseline, including current in-progress CLI work. Define a read-only view model for repository facts, task, eligible setups, run/attempt, checks, review, cost basis, freshness and unknowns. Select a real reviewed record with approved redactions if available. If none exists, display an explicit empty/availability state; a visual placeholder is never product evidence.

Architecture choice: local Next server reads explicitly selected local records through an allowlisted, read-only adapter. Hosted marketing cannot read arbitrary local paths. If this is not feasible in the first slice, ship narrative/setup first and state that the workspace integration is pending; never simulate success.

Acceptance: one source-to-field map, model/agent identity distinctions, immutable read behavior, explicit unsupported/stale states, documented data leaving the machine (ideally none for local record viewing), and parity with CLI outputs on the same record. Do not expose run/approve endpoints as a shortcut.

## Phase 2 — Art direction proof and system foundation (P1)

Dependency: Phases 0–1 for real content. Create one desktop and one mobile home composition, one populated task/review screen and empty/error states. Review the record signature as a timed storyboard before coding it. Establish semantic color/type/spacing/motion tokens using existing fonts and native browser capabilities. Preserve existing logo until identity change is deliberate.

Acceptance: distinct art direction at 1440px and 390px; primary purpose and next action understandable without motion; evidence and limitations visible; contrast checked; responsive type never clips; no generic card-wall substitute for composition. For A, no new animation package. Any B/C package must first demonstrate a concrete missing capability and meet a measured budget.

## Phase 3 — First integrated Alpha slice (P1)

Dependency: Phases 1–2. Implement home → Start locally → one real local read-only development record → source-linked run/review view. This is an end-to-end slice, not separate disconnected “frontend/backend” phases. Keep approval/run actions in the existing supported local path and label that boundary clearly.

Acceptance: user can understand the product, follow supported setup, open an actual record locally and understand checks, review, attempts and cost uncertainty. No Atlas content or runtime-contract calls to action. Deep links work. Read-only visits do not change records. Refresh exposes changed/stale data rather than caching a misleading approval badge. Human review is never inferred from a passing check.

## Phase 4 — Contextual model research and history (P1)

Dependency: Phase 3 and verified catalog interfaces. Retheme useful `/models` capabilities into the chosen system. Preserve search, filters, pagination, comparison, release/offer identity, source rights, dates and numeric unknown handling. Connect task context only when actual restrictions and evidence mappings support it. Keep generic research available without asserting a recommendation.

Acceptance: research remains usable at realistic catalog size; rows do not stagger on filtering; keyboard focus and selections persist; source/date notices survive; public ranking is distinct from project evidence; cost estimates retain billing basis. Development history shows only real recorded runs and labels unsupported provenance.

## Phase 5 — Retire legacy surfaces and choreograph motion (P1)

Dependency: replacement journeys work and inbound links/callers are inventoried. Remove Atlas promotion, examples from onboarding, synthetic product states, old contract-builder navigation and attached hardware cockpit. Proposed retirement behavior: old `/demo`, `/playground` and legacy `/studio` links reach a clear retirement/help page with the supported Alpha entry; do not silently reinterpret uploaded bundles or old query parameters. Decide permanent redirects versus explanatory pages after checking external links. Existing CLI/test fixtures may remain unadvertised when required by non-Alpha packages.

Apply the approved signature once, then feedback primitives. Remove obsolete root reveal behavior only after its replacements pass failure/reduced-motion checks. No full-screen navigation loader. Delay deletion of API handlers and media until caller/import/search checks establish that they are unused. Shared domain-package removal is outside this visual redesign contract.

Acceptance: no old destination is advertised in header, footer, home, setup or metadata; no fake “verified” or simulated success enters Alpha; old links explain what changed; model data and preserved CLI logic remain intact; motion meets [MOTION_SYSTEM.md](MOTION_SYSTEM.md).

## Phase 6 — Validate and finish (P0 release gate)

Dependencies: integrated slice and agreed retirement behavior. Run existing meaningful package tests and add only behavior coverage needed for new data boundaries and changed journeys. Required future checks include `pnpm --filter @anvilmark/web test` and `pnpm --filter @anvilmark/web build`; run impacted shared-package tests when adapters/domain boundaries change. These are future commands, not checks already completed. Preserve the Node >=24 runtime requirement.

Verification matrix:

| Area | Acceptance evidence |
| --- | --- |
| Product truth | No application-model/coding-model conflation, unknowns preserved, no unsupported savings or identity claims |
| Local read model | Same selected record as CLI; no writes; malformed/missing/stale records handled; no arbitrary hosted filesystem access |
| Existing useful behavior | Catalog search/comparison/export and sources intact; no unapproved schema, CLI, auth or telemetry changes |
| Retirement | Header/footer/deep-link audit; Atlas and obsolete demo UI absent; API callers checked before removal |
| Accessibility | Keyboard/focus/errors; contrast; semantic heading order; screen-reader announcements; static and reduced-motion alternatives |
| Responsive | 320/390/768/1024/1440px, 200% zoom, long IDs, localized dates, dense evidence and overflow |
| Motion | Interruption, rapid input, coarse pointer, preference change, back/forward, anchor jumps, no listener/RAF leaks |
| Resilience | Slow/offline/failed requests; no source file upload by default; no endless loader or invisible content after client failure |
| Performance | Repeatable baseline/final lab captures, bundle/asset sizes, no decorative motion on work routes; budgets in motion document |

Provisional release targets: LCP <=2.5s, CLS <=0.1, INP <=200ms when field measurement exists; otherwise report lab limitations honestly. Profile a midrange mobile and real catalog/record sizes before claiming performance success.

Finish with a concise changed-route list, captures of approved screens, functional verification results, remaining limitations and rollback instructions. Deployment is a separate action and is not requested now.

## Dependencies, risks and rollback

| Risk | Mitigation / dependency |
| --- | --- |
| Design assumes a nonexistent browser development API | Prove local read adapter in Phase 1; visibly omit unsupported actions |
| Parallel in-progress CLI work changes record format | Coordinate against the exact baseline; never overwrite dirty files; use versioned adapters |
| Removal breaks deep links or shared workflows | Inventory routes/imports/API callers; use explicit retirement guidance; retain shared packages |
| Retained catalog appears to guarantee coding quality | Show evidence relevance and unknown mappings; rankings are research, not task outcomes |
| Global CSS migration leaks into old screens | Scoped Alpha shell and semantic tokens until old routes are retired |
| Motion hides slow or failed operations | Content-first rendering and request-driven state, no artificial progress |
| Scope expands into hosted sync or agent orchestration | Keep first slice local and read-only; create separate reviewed functional contracts |

Use incremental commits after approval: system foundation, first usable slice, model research, retirement, motion. Keep previous asset sources until validation. Rollback restores route/UI commits without changing schemas or deleting local records. No branch, tag, commit, deployment or implementation was created during this planning task.

## Direction approval recorded

The user selected **A — The Decision Ledger** on 2026-11-17. Atlas and obsolete application-model journeys remain marked for retirement. The selected direction establishes the visual baseline; exact timings, technical integrations and retirement behavior remain provisional until validated. Implementation was authorized by the user’s “so start?” instruction. The public Alpha experience and browser-local run reader are implemented; see ALPHA_IMPLEMENTATION.md for exact scope and verification.
