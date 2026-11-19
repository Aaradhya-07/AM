# Version Alpha — Product audit

Implementation update: the user authorized implementation after selecting Direction A. See [Alpha implementation record](ALPHA_IMPLEMENTATION.md) for delivered scope, checks and remaining integration limits.

Date: 2026-11-17. Status: audit complete. Direction A — The Decision Ledger was APPROVED by the user on 2026-11-17. Detailed route changes and integration scope remain PROVISIONAL. No application changes or dependency installations are part of this deliverable.

## Executive finding

Anvilmark is a free, local-first development decision record for developers already using Git and a coding agent. It connects repository understanding, bounded tasks, agent/model selection, runs, checks, human review, and cost evidence. The website is a combination of marketing, onboarding, research tools, and operational inspection—not a portfolio and not merely a dashboard.

The largest problem is a mismatch between the current development-oriented product brief and the application-model/Atlas-oriented website. Alpha must change the organizing idea, information architecture, and visual language together. Another layer of gold circuitry and animation would leave that mismatch intact.

## Scope correction from the user

During this audit the user directed: “abandon the old useless features like atlas example or anything else that still remains.” This supersedes the initial assumption that every existing screen should remain in Alpha. Atlas and legacy application-model journeys are excluded from the proposed product experience. Preserve useful underlying engineering and data integrity; do not preserve obsolete screens simply because they exist. Actual removals await implementation approval.

| Existing surface | Alpha disposition | Reason / reusable part |
| --- | --- | --- |
| Atlas synthetic example, public bundle and scenario checks | Retire from product UI, navigation, onboarding and marketing | Synthetic application-model teaching is outside the new core. Keep test fixtures only where still needed to validate shared packages. |
| `/demo` application-contract builder | Retire from Alpha navigation and product journey | Its model field concerns the finished application's runtime, not the agent building it. Reuse validation patterns, not its workflow or semantics. |
| `/playground` Atlas checks and deployment sizing | Retire as a destination | Do not make a hardware-fit calculator a primary development workflow. Pure sizing code may remain outside Alpha. |
| Legacy Studio application conformance bundle viewer | Replace as a product surface | Source-linked review, freshness, parsing and diff patterns are useful, but the existing bundle is not a development-run record. No silent schema conversion. |
| `/dashboard` optional project/telemetry console | Replace its conceptual model | Retain useful project presentation patterns; exclude seeded verification, simulation, and mandatory accounts from Alpha. |
| Model Atlas `/models` | Retain useful model research, reframe inside development decisions | Sourced offers, dates and comparison are useful. An Arena rank or API price alone cannot select the right coding setup. Remove “Atlas” product branding from Alpha; do not confuse this directory with the Atlas Support Desk fixture. |
| Hardware cockpit attached to Studio | Remove from core workspace | Task restrictions can reference hardware when relevant; the general deployment tool should not dominate review. |
| Login / OAuth / hosted telemetry | Exclude from primary journey | Existing optional services need not be deleted to stop making them part of Alpha. Retention or removal is an implementation scope decision. |
| CLI/MCP, schemas, provenance, validation, evidence and local records | Preserve and reuse where applicable | These provide the working substance of the current product. |

## Repository structure and inspection coverage

The tracked project file inventory and all top-level package boundaries were explored. Primary web routes, components, styling, assets, configuration, domain imports, APIs, and relevant tests were inspected. This is a product/UI audit, not a line-by-line security or correctness review of every experimental script.

```text
/
  ANVILMARK-CANONICAL-BRIEF.md   current product authority
  README.md, QUICKSTART.md, PROJECT-TRACKER.md
  packages/
    web/                       Next application, public assets, SQLite, tests
    cli/                       local workflows, development pilot, storage
    mcp/                       agent-facing project tools and model research
    project-contract/          versioned application decision schema
    contract/                  separate frozen historical audit schema
    scanner/                   bounded TS/JS observations
    conformance/               application rule checks, review semantics
    context/                   deterministic facts and generated views
    adapters/                  evidence, hardware and intelligence boundaries
    hardware-sizing/           pure estimates and planning artifacts
    model-catalog/             sourced model data tooling
    engine/                    historical recommendation scaffold
  docs/                        briefs, research, vNext, validation and handoffs
  examples/                    local projects and development pilot
  fixtures/                    audit examples
  experiments/                 model/decision research; not production UI
  benchmarks/                  real-repository records
  scripts/                     setup, doctor, demos, exports and packaging
  .github/                     automation
```

Root configuration uses pnpm workspaces, TypeScript, ESLint, Prettier and Vitest. The web package uses Next 16, React 19, Tailwind 3, Zod and Supabase. Its package engine requires Node >=24; the inspected runtime is Node 25.7.0. No GSAP, Motion, Three.js, Matter.js or smooth-scroll package is declared in the web manifest. No installation is needed to plan or to achieve the recommended native CSS/SVG approach.

## Audience and workflows

Primary user: a developer or small engineering team already using a coding agent and wanting a reviewable record of why a setup was chosen and what happened. Secondary user: a reviewer comparing evidence and accepted outcomes. Marketing visitors need a concrete explanation and a truthful route into the local product.

Target Alpha sequence:

1. Select a local repository and inspect its source-linked landscape, conventions, known history and unknowns.
2. Define a bounded task, restrictions, baseline and acceptance checks.
3. Compare eligible agent/model configurations with dated public and comparable local evidence.
4. Approve the plan through the supported local mechanism and hand it to the chosen agent.
5. Inspect runs, attempts, associated changes, checks, review and cost basis.
6. Use reviewed comparable outcomes to inform the next decision.

The CLI development command currently exposes landscape, catalog, plan, approve, recommend, scout, run, review, timeline, close and report. This is local pilot capability, including in-progress working-tree changes; it does not establish a complete browser integration or validated savings. The web must not pretend these operations are already connected.

## Existing website inventory

| Route / area | Observed implementation | Audit consequence |
| --- | --- | --- |
| `/` | Hero → SpecPlate → SystemFlow → Principles → Closing; header/footer, reveals and interaction controller | Custom identity exists, but application-model story leads and three competing hero actions dilute the first step. |
| `/start` | Own-project contract path plus prepared example; checkout/local setup | Rewrite around the actual development path and truthful availability. |
| `/demo` | Intent, restrictions, architecture, candidates, evaluation lookup, draft download | Long functional form; retire from Alpha, preserve domain meaning outside it. |
| `/studio` | In-memory import, hash checks, warnings, evidence gaps, source traces, snapshot comparison, handoff, sizing | Good integrity patterns; current payload concerns a different workflow. |
| `/playground` | Synthetic Atlas checks through `/api/playground/check`, scenario tabs and hardware sizing | Retire rather than reskin. |
| `/models` | Light Model Atlas directory with separate shell/CSS, filters, comparison, releases, rankings, Arena and sources | Useful sourced research; visually disconnected and too detached from bounded task selection. |
| `/dashboard` | localStorage projects and optional Supabase sync, project modals, conformance feed | Not a proven local development workspace. Caller-reported telemetry is not verified execution. |
| `/login`, `/auth/*` | Optional Supabase auth/session handling | Do not make sign-in a gate for the local workflow. |
| `/overview` | Redirects to `/` | Preserve meaningful links or give explicit retirement guidance. |
| `/api/*` | Model/Arena/quality queries, Atlas checker, telemetry runs | Keep API/data semantics stable unless separately approved. Atlas handler retirement requires checking callers. |

The older `docs/web-information-architecture-plan.md` proposes four navigation items; the actual header now has five, including Model catalog. Older plans are evidence of history, not Alpha requirements.

## Visual and interaction findings

Current identity: near-black, amber/gold, sand, fine circuit lines, squared panels, smith/anvil film. Oxanium headings, Space Grotesk body and IBM Plex Mono metadata. Tailwind tokens coexist with global CSS variables and local utility strings; Model Atlas has a separate light visual system. The brand asset kit includes horizontal/stacked/mark/wordmark PNG variants and icons; no new mark is necessary to explore direction.

Strengths: authored imagery, readable hierarchy at desktop scale, explicit source and uncertainty explanations, working public tools without forced sign-in, native semantics, shared domain logic, and reduced-motion effort. The four separate Studio dimensions—decision, evidence, implementation and snapshot—are a useful principle, although Alpha will need development-specific dimensions.

Weaknesses: too many ornamental line layers; thin futuristic display typography applied to operational content; long explanatory blocks competing with films; repeated dark bordered panels; no clear bridge between the website's application workflow and the development pilot. At 390px the home workflow step labels truncate (“DEC…”), and the long narrative still occupies substantial vertical space. The desktop hero has visual competition between the anvil trace and the copy boundary. These are observed design issues, not measured conversion failures.

Motion already includes word entrance, one-shot observer reveals, SVG signal paths, parallax, 7px magnetic controls, scroll progress, hero autoplay and scroll-scrubbed section films. There is no observed choreographed cross-route transition system. Reduced-motion, coarse-pointer checks and cleanup exist. A comment claiming reduced motion never downloads video must not be treated as a network measurement: source markup and metadata preload remain present. Hero visibility handling also deserves review before reuse; hidden tabs are not explicitly paused in its handler.

## Assets and technical opportunities

The ten checked MP4 variants occupy about 25 MiB on disk; this is repository storage, NOT initial network transfer. Active hero hit-only film is about 2.8 MiB; conformance and contract-assembly films are about 2.5 and 1.9 MiB. Alpha should stop using those legacy-story films. Preserve source files until an approved asset-cleanup step; native SVG objects and real record excerpts can carry the new narrative more cheaply.

Keep server-rendered headings and data where possible; client islands handle interactive evidence, selection and motion. Reuse the existing model SQLite snapshot and provenance fields. Large client components (ModelExplorer ~1,757 lines, Demo ~829, Playground ~805, Studio ~697) indicate coupling risk; extract presentation at touched boundaries rather than rewrite logic. Node filesystem/scanner operations belong on a local server, never in the browser or an arbitrary hosted path handler.

A hosted browser cannot directly inspect the user's repository or local MCP. A local website/read model or explicit record import is a separate integration deliverable. Avoid a fake “Connect repository” success. Approval remains local and human-operated until an equally strong browser transaction exists.

## Rendered verification and limits

Reused an already running server at `http://127.0.0.1:3000`; no server was started or stopped. Browser inspection covered home at 1440×1000 and 390×844, contract-builder controls, Studio empty and Atlas-loaded states, Model Atlas data, and mobile Playground. The Studio example rendered two failing rules and thirteen evidence gaps independently; this confirms useful status separation, not real project execution. The model snapshot rendered 13,330 offers and a dated source notice; those are local snapshot observations, not current market facts.

At 390px home and Playground had no document-wide horizontal overflow in the sampled states. Reduced-motion home inspection found zero hidden reveal elements and all three videos paused. This is a narrow smoke observation, not complete accessibility, keyboard, responsive or performance certification. Playground was still displaying “Checking engine...” in the sampled state; completed checker execution was not verified. Auth, live account persistence, download contents, model comparisons and full pilot runs were not exercised. No test suite or production build was run for this documentation-only task.

There were pre-existing edits in CLI, MCP, example, script and `packages/web/next-env.d.ts` files plus an untracked development-review command. Do not overwrite, revert, stage or attribute those changes to Alpha. Browser tooling writes temporary `.playwright-mcp` artifacts; these are not product implementation.

## Sources and authority

- [Canonical brief](../../ANVILMARK-CANONICAL-BRIEF.md): current product purpose and boundaries.
- [Development workflow plan](../vnext/10-node-development-provenance-plan.md): lifecycle, provenance and cost truth rules.
- [Website/MCP path](../vnext/website-mcp-product-path.md): local/hosted boundary and known telemetry limitations; older application-model scope is not the new Alpha brief.
- [Web package](../../packages/web/package.json), [home](../../packages/web/app/page.tsx), [styles](../../packages/web/app/globals.css), [model directory](../../packages/web/app/models/ModelExplorer.tsx), [Studio](../../packages/web/app/studio/StudioClient.tsx).

Open implementation decision: local read-only development workspace first, or public narrative/onboarding first. The recommendation is public narrative plus one truthful local read-only record slice, with writes and hosted pairing explicitly outside the first slice.
