# Version Alpha — Design system proposal

Implementation update: the user authorized implementation after selecting Direction A. See [Alpha implementation record](ALPHA_IMPLEMENTATION.md) for delivered scope, checks and remaining integration limits.

Status: Direction A — The Decision Ledger was APPROVED on 2026-11-17. This is the selected design-system baseline. Exact token values and component treatments remain PROVISIONAL pending contrast, responsive and prototype validation. No token or application file has been edited.

## Visual principles

1. The development record is the visual subject. Use real task scope, dated evidence and review relationships; remove Atlas, legacy runtime-contract framing and generic AI imagery.
2. Expressive entry, quiet inspection. One large statement and one authored object earn the visual emphasis; source tables stay calm.
3. Structure comes from alignment, typography and spacing before borders. Avoid default bento/card grids, glass panels, neon gradients, repeated glows and decorative dashboards.
4. Known, declared, inferred, stale and unknown remain distinguishable. Never let a decorative seal look like human approval.
5. Retain the Anvilmark name and recognizable mark initially. Wordmark/mark adjustments require review as a separate identity decision.

## Palette and semantics

| Proposed token | Value | Role |
| --- | --- | --- |
| canvas | #F3F0E7 | Primary paper surface |
| surface | #FBFAF6 | Input/inspection surface |
| ink | #20221F | Main text |
| muted | #5B6158 | Supporting text on paper |
| forest | #214C3A | Primary action, links, selected emphasis |
| forest-deep | #152A22 | One marketing chapter / dark field |
| on-dark | #F3F0E7 | Text on forest-deep |
| ochre | #D2AE65 | Decoration or highlighted margin, dark text only |
| border | #CFD1C5 | Decorative separators; not sufficient for control bounds |
| control-border | #797F73 | Interactive boundaries on paper |
| success-text | #24583D | Passing bounded check / accepted, with exact label |
| warning-text | #7A4D16 | Stale or incomplete, with wording |
| error-text | #A22E2E | Failure / rejection with separate labels |
| unknown-text | #5B6158 | Explicit “Unknown”, never treated as success |
| focus | #214C3A | 2px ring with 3px offset on light surface |

These are draft swatches, not a completed contrast certification. Before implementation acceptance, verify actual foreground/background pairs, alpha blends and interaction states: >=4.5:1 ordinary text; >=3:1 large text, essential UI boundaries and focus indicators. Use on-dark for focus on forest-deep. Ochre never carries small text on paper. Add status words and icons so color is redundant.

## Typography

Use existing Space Grotesk and IBM Plex Mono first; no font purchase or dependency. Remove Oxanium from general content headings in this direction, preserving the existing image-based wordmark until identity review.

| Role | Desktop / mobile | Weight, leading |
| --- | --- | --- |
| Hero | clamp(48px, 7vw, 112px) / 44–56px | 500, 0.98–1.04; -0.04em |
| Chapter | 56–72px / 32–40px | 500, 1.08; -0.025em |
| Product page title | 32–40px / 28–32px | 500, 1.15 |
| Section title | 22–28px / 22–24px | 500, 1.25 |
| Body | 17–18px / 16px | 400, 1.55–1.65 |
| Operational UI | 14–16px | 400–500, 1.45 |
| Metadata | 12–13px mono | 400, 1.5 |
| Numeric / identifier | 13–15px mono | Tabular alignment where supported |

Hero wraps are authored at tested breakpoints, never forced with nonbreaking spaces across entire phrases. Body measure 55–70 characters. Uppercase is limited to short labels with <=0.08em tracking; no long widely tracked paragraphs. Identifiers can wrap safely; source code uses contained horizontal scrolling.

## Grid and rhythm

Spacing scale in px: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. Base unit 4px. Marketing section space 96–128px desktop / 56–72px mobile; work areas use 24–32px. Inputs minimum 44px high, buttons minimum 44px target, touch controls 44×44px or larger.

Marketing shell max 1440px, 48px desktop gutters, 24px tablet, 20px mobile. Desktop 12 columns / 24px gap; tablet 8 / 20px; mobile 4 / 16px. Product layout can expand to 1600px for comparisons while body text remains constrained. Breakpoint candidates: 640, 960, 1280px; choose layout based on content fit, not device labels.

Home uses asymmetrical 7/5 and 4/8 sections, then a full-width forest chapter. Product record uses 3/6/3. At <=960px evidence margin becomes inline and navigation collapses into an accessible disclosure. At 390px every stage name is readable; do not reproduce the old truncated progress labels. Test 320px and 200% zoom.

## Components and states

- Header: recognizable brand, a few stable destinations and one contextual action. Do not promote login or deprecated examples. Product workspace keeps repository/task identity separate from local view controls.
- Buttons: primary forest with paper text, secondary outline, tertiary underlined text. No pill everywhere; 2–4px corners, no magnetic hit targets. Include default, hover, focus, pressed, disabled and pending states.
- Task record: baseline, scope, restrictions, checks, selected setup and provenance. Missing fields say unknown/unrecorded; no fabricated default model or commit.
- Candidate comparison: aligned columns; eligibility reasons first, evidence relevance/date next, cost basis last. Preserve selection while opening source notes. Offer a usable narrow-screen row detail without hiding critical differences.
- Evidence note: claim, source, date, type, scope and limitation. Open in place where short; explicit link for external source. No unsupported confidence percentage.
- Run timeline: stable run/attempt IDs, configured and tool-reported identities separately, changes associated with a run rather than asserted authorship.
- Review: acceptance and check results separated; exact reviewed code state visible. Stale review never appears current after a revision.
- Cost: measured bill, rate estimate and subscription unknown are distinct. No savings badge without comparable accepted-task evidence.
- Forms: persistent visible labels, help text, inline validation and focusable error summary for multi-field failures. Preserve inputs across view changes.
- Empty/loading/error: explain next useful action, retain prior readable data during refresh, identify offline/unsupported/unavailable state. Never seed a “verified” project to fill space.
- Dialog/drawer: labeled, focus-managed, Escape dismissible when safe, focus restored to trigger. Use inline disclosures rather than modalizing every source.

## Imagery and assets

Replace forge/contract movies with one authored SVG/DOM development-record composition and actual redacted source excerpts where authorized. No stock team portraits, provider-logo endorsement strips, fake customers or invented metrics. No new illustrative dataset presented as a working feature. Existing brand assets may be retained; defer deletion of unused source media until import/link inventory is complete.

Use numbered margin marks, ruled alignments and selective forest fields as the identity. Avoid copying Moisez's oversized command text or handwritten underline. The character comes from Anvilmark's development evidence, not reference-site decoration.

## System boundaries

Create semantic tokens in one authoritative layer during implementation and map Tailwind utilities to it; do not maintain separate conflicting palettes. Scope migration so legacy screens do not receive accidental global typography changes before retirement. Model research should share brand and controls while preserving its data density and source notices. No dark/light preference toggle is promised by this proposal; dark chapters are authored sections, not a second complete theme.
