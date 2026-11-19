# Version Alpha — Three creative directions

Implementation update: the user authorized implementation after selecting Direction A. See [Alpha implementation record](ALPHA_IMPLEMENTATION.md) for delivered scope, checks and remaining integration limits.

Status: Direction A — The Decision Ledger was APPROVED by the user on 2026-11-17 (selection “1”). Directions B and C are retained only as alternatives considered. Detailed typography, palette, layout, interaction and integration specifications remain PROVISIONAL until validated against the approved direction. Updated for the user's instruction to abandon Atlas and obsolete features. These are three alternative systems, not themes to blend indiscriminately.

## Research: evidence and interpretation

Research date: 2026-11-17. Direct `https://moisez.com/` access returned HTTP 403/browser verification. Its live scrolling, menu transitions, exact easing and mobile behavior could not be verified. We inspected the published [Osmo showcase](https://www.osmo.supply/showcase/moisez-portfolio) and its [1440×900 image](https://osmo.b-cdn.net/showcase-img/moisez-portfolio-1440x900.avif). The following deliberately separates observed composition from documented techniques and proposed adaptation.

| Reference / evidence | Analysis | Appropriate adaptation | Avoid |
| --- | --- | --- | --- |
| Moisez showcase image, visually inspected | Huge black sans typography, pale textured field, exposed column grid, small mono utility labels, staggered image cut-ins, bright image accents, orange drawn underline. Composition has scale contrast and personality. Exact font unidentified. | A product-specific typographic hierarchy and one authored object that explains a task or decision. Use scale and whitespace to create pacing. | Copying its words, layout, scribbles, imagery or exact branding. |
| Osmo's Moisez resource list | Lists film grain, falling 2D objects (MatterJS), footer parallax, scaling system and underline interaction. This documents 2D physics, not verified WebGL. | Link feedback and optional decorative footer depth; deterministic settling motion can express ordered decisions without a physics engine. | Falling form controls, draggable-only navigation or decorative physics on evidence tables. |
| Moisez live motion | Not accessible; timing, page transitions and scroll choreography unverified. | Alpha timings below are authored recommendations, not reverse-engineered values. | Attributing invented timings, shaders, transition mechanics or scroll locking to Moisez. |
| [Arnaud Rocca's authored Codrops account](https://tympanus.net/codrops/2026/03/31/arnaud-roccas-portfolio-from-a-gsap-powered-motion-system-to-fluid-webgl/) | Available indexed introduction describes reusable GSAP motion, text transitions, fluid WebGL and accessible content. Full article fetch was blocked. | Reusable motion primitives with a static readable baseline. | Treating fluid distortion as necessary for a technical record or claiming a full live teardown. |
| [Bruno Simon, own portfolio/stack description](https://bruno-simon.com/) | Navigable 3D world; creator identifies Three.js and Rapier, with explicit quality and control options. Interaction is the portfolio's content. | A coherent interaction metaphor and explicit fallback if optional graphics ever ship. | Making developers drive through a scene to reach task evidence. |
| [Linear, authored UI refresh account](https://linear.app/now/behind-the-latest-design-refresh) | Consistent action placement, dimmer navigation and fewer competing separators preserve attention in dense agent-era workflows. | Stable task context, quiet tools and predictable evidence placement. | Importing its surface aesthetic as a ready-made SaaS template. |

Synthesis: the useful lesson is an authored relationship between form, content and motion. Alpha's content is a development decision and its evidence. Typography can be expressive on entry; inspection should be stable. Scroll can explain relationships; it must not gate actions. WebGL and simulation are optional production costs, not quality requirements.

## A — The Decision Ledger (recommended)

### Concept and visual identity

Every choice leaves a reviewable mark. Anvilmark becomes a contemporary engineering ledger: oversized editorial statements, disciplined numbered records, revision margins, source notes and precise comparison rows. It has a recognizably human editorial voice without dressing the product as a retro terminal. The logo mark stays available; circuit-board decoration and smith videos leave the primary experience.

Provisional headline: “Know why you chose it. See what it delivered.” Supporting sentence states the local-first agent/model decision record and current availability. No invented savings, customers or live integrations.

Typography: existing Space Grotesk at 500–600 for large display and 400–500 for UI; IBM Plex Mono for identifiers, evidence dates and numeric units. Restrict Oxanium to existing brand assets rather than every heading. A third font is unnecessary. Oversized chapter numerals and tight headlines contrast with comfortable evidence text.

Palette: paper `#F3F0E7`, ink `#20221F`, muted ink `#5B6158`, deep forest `#214C3A`, dark forest section `#152A22`, warm ochre `#D2AE65`. Paper is the working surface; forest anchors the brand story. Ochre is a highlight, not a substitute for status semantics. This is a deliberate departure from full-page black/gold circuitry.

### Architecture

Home: direct proposition and one “Start locally” action → concrete task record → “Restrict / Choose / Run / Review” lifecycle → evidence and cost limitations → local setup. The visual centerpiece is a structured development record, not an application-model contract. It must use an approved real redacted record when available; any design placeholder is explicitly illustrative and never recreates Atlas.

`/start`: one local path, prerequisites, supported agent mode and availability. Workspace: repository landscape → task definition → eligible setups → run detail → review/outcome history. Model research is contextual and remains directly reachable at `/models`. Navigation candidate: Product, Start locally, Model research; local workspace has its own project context. Final labels await approval.

Task page desktop: 3-column landscape/navigation margin, 6-column main record, 3-column evidence margin. At mobile, one column with source notes directly below their claim. Review uses exact baseline, checks, attempts, human decision and separate cost basis; no global “verified” trophy.

### Signature interactions and motion

“Decision resolves into record”: four typographic fragments align to a single ledger baseline, source connectors draw, and a revision marker settles once. It demonstrates relationship, never implies approval. A chosen configuration expands into an inline evidence margin, preserving the comparison table. Run timeline entries reveal checks and review by stable IDs. Links get a precise underline; status changes get one restrained confirmation.

Entrance 420ms with 45ms stagger, cap 650ms; inspection 160–220ms; record assembly 600–900ms once. Native scroll, no mandatory pinning. Reduced-motion shows the final arrangement with no travel. Marketing animation never carries live execution meaning.

### Technical strategy and implications

Native CSS transforms/opacity, SVG connector paths and IntersectionObserver; optional WAAPI for interruptible decorative sequences. Keep Next server content and client interaction islands. Use existing model data and local development commands through a separately tested read adapter; no parallel rules engine. No new dependency anticipated. Very low GPU demand; one static record visual can replace multi-megabyte films. Moderate design effort in typography and record states, low ongoing animation maintenance.

Fit: provenance and human review are the product's subject. The ledger makes uncertainty and chronology legible and remains distinctive in operational screens. Risk: becoming a dry document site. Counter it with strong scale, a forest chapter and one memorable record sequence—not gratuitous particle effects.

## B — The Assembly Floor

### Concept and visual identity

A working development system built from bounded parts. Bold typesetting, cropped vertical labels, hard joins, numbered plates and visible interface seams make the task-to-reviewed-result process physical. This reinterprets Anvilmark's industrial name without repeating the old anvil movie.

Typography: Space Grotesk 600 in large, tightly composed two-line statements; IBM Plex Mono for plate coordinates and task metadata. No mechanically compressed body text. Color blocks are structural, not gradients: chalk `#EEECE4`, carbon `#1C1D1A`, oxide `#B64229`, yellow `#EBCB58`, muted metal `#686B63`. Oxide is brand emphasis, with failure separately labeled and styled to avoid confusion.

### Architecture

Home is four distinct horizontal bands: repository intake → bounded task → configuration selection → reviewed result. Each band contains one functional fact, not a repeated feature card. Start locally follows a numbered installation sheet. Workspace is a vertical assembly sequence: task/specification, setup, execution record, review station. Research is a sliding comparison tray; run history is a sequence of dated work orders. All existing Atlas/demo destinations retire as in the audit.

Desktop composition uses a 12-column grid, asymmetric 5/7 layouts and one oversized stage number; mobile converts the bands to ordinary stacked sections. No horizontal-scroll journey.

### Signature interactions and motion

A “phase interlock” aligns task, constraints and checks into an ordered work packet. On deliberate selection, a plate advances 12px and meets a fixed seam with a short damped settle. Phase progress is shown only when the underlying state supports it. Route identity changes through a 180–240ms local panel wipe after navigation, never a full-screen gate. One marketing chapter can scrub connector alignment over 60vh; actual records never scrub.

Timing: actions 120ms; panels 240ms; assembly up to 900ms; a single decorative 2px overshoot allowed. Controls and hit targets never bounce or move magnetically. Reduced motion uses immediate alignment.

### Technical strategy and implications

CSS grids, SVG diagrams and WAAPI sequences are sufficient. If the approved storyboard genuinely needs coordinated scroll timelines, evaluate GSAP/ScrollTrigger in a later isolated spike, with bundle and cleanup evidence before installing. No physics engine needed for authored settling. Mobile uses static diagrams. More breakpoint and transition work than A; clipping and type scale need careful QA. Low-to-medium performance risk if kept native, medium maintenance due to bespoke section composition.

Fit: bounded phase contracts and reviewed closure map naturally to assembly. Strongest immediate visual impact. Risks: industrial metaphor can dominate content and resemble the old identity if the circuitry, gold and forge imagery creep back in. The proposal intentionally removes those motifs.

## C — The Evidence Observatory

### Concept and visual identity

Anvilmark reveals relationships between a task, eligible configurations and observed outcomes. A large plotting field, measured coordinates, meaningful connecting lines and quiet side notes create an analytical instrument with an expressive spatial front door. This is an evidence instrument, not a decorative universe of glowing nodes.

Typography: large Space Grotesk 300–400 titles with generous negative space, Space Grotesk 500 UI, IBM Plex Mono coordinates and measurements. Palette: midnight `#101C2B`, frost `#EDF3F5`, cool gray `#A8B8C5`, glacier `#72CBB7`, restrained coral `#F09D88`. Light tables sit in frost inspection panels; midnight is for overview composition. No neon glow or glass cards.

### Architecture

Home starts with a task at the center and three explicit relationships: restrictions, candidate evidence and reviewed outcome. Below: comparison lens → one run's evidence → local setup. Workspace is overview map plus a full list alternative, with a persistent task inspector. Compare uses aligned evidence axes; run detail returns to a conventional timeline and source table. Model research belongs to the same instrument. Atlas and obsolete runtime-contract journeys disappear.

### Signature interactions and motion

Selecting an item illuminates only its evidenced relationships and opens a stable inspector. A “lens” switches between eligibility, quality evidence and cost basis without pretending they are one scalar score. Hover/focus highlights paths; keyboard/list selection achieves the same result. No drag requirement. Overview can gently reframe its decorative field over 350ms; tables do not pan. Entering comparison aligns axes in 400ms. No free-running particles.

### Technical strategy and implications

Start with DOM plus semantic list and SVG connections, fixed illustrative layouts and deterministic geometry. Existing catalog data can feed lists, but there is no current development evidence-graph API to assume. Live graph mapping is a separate functional deliverable. A later optional shader could animate the overview background only; Three.js/WebGL is not approved or required. If adopted, lazy load, cap pixel ratio, suspend offscreen and supply a static fallback. Highest implementation and accessibility burden; long labels, dense graphs and mobile layouts are significant risks. Real-time graphics would add GPU and maintenance costs without improving the primary record.

Fit: strong for users discovering model/evidence relationships and comparing alternatives. Weaker for first-use comprehension and everyday task review; graph semantics must remain truthful when evidence is sparse.

## Evaluation

Provisional design judgment, 1 = weak and 5 = strong. Higher feasibility/maintainability/performance means easier/cheaper. Weights prioritize the real product, not an award-site score. Weighted score = sum(weight × rating) / 100.

| Criterion | Weight | A Ledger | B Assembly | C Observatory |
| --- | ---: | ---: | ---: | ---: |
| Originality tailored to Anvilmark | 15 | 4 | 5 | 4 |
| Product usability | 25 | 5 | 4 | 3 |
| Visual impact | 15 | 4 | 5 | 5 |
| Motion quality potential | 15 | 4 | 5 | 5 |
| Technical feasibility | 10 | 5 | 4 | 3 |
| Maintainability | 10 | 5 | 4 | 2 |
| Performance | 10 | 5 | 4 | 3 |
| Weighted result / 5 | 100 | 4.55 | 4.45 | 3.65 |

Recommend **A — The Decision Ledger**. It gives development evidence a durable visual grammar, creates a strong departure from the old UI, and can reach high craft through typography, precise composition and one signature sequence. B is a credible alternative if maximal graphic impact is the priority. C suits a future relationship-exploration product after enough real evidence exists.

Decision recorded: the user selected A — The Decision Ledger on 2026-11-17. Selection approves an art direction, not every proposed backend capability, dependency or retirement detail. The scope table is the basis for the first implementation contract. Do not mix all three hero systems into a generic compromise.
