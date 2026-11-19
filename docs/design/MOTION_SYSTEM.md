# Version Alpha — Motion system

Implementation update: the user authorized implementation after selecting Direction A. See [Alpha implementation record](ALPHA_IMPLEMENTATION.md) for delivered scope, checks and remaining integration limits.

Status: Direction A — The Decision Ledger was APPROVED on 2026-11-17. The motion specifications below are its implementation baseline; exact values remain PROVISIONAL pending prototype validation. Alternative concepts are not selected. No animation code or dependencies have been added. [Alternative motion concepts](CREATIVE_DIRECTIONS.md).

## Purpose and hierarchy

Motion explains a relationship, confirms an action or preserves orientation. It must not manufacture evidence, execution progress, approval or savings. Marketing gets one expressive signature; the working product gets quiet, fast feedback. Retire the old Atlas/contract films and perpetual circuit signals from the proposed experience.

Three levels: expressive entry (600–900ms, once), structural change (180–300ms), immediate response (80–160ms). Only one expressive sequence should run in the viewport at once. After entry, the page rests. No scroll hijacking, forced loading introduction, replacement cursor, mandatory sound, moving action targets or continuous ambient loops.

## Timing tokens

| Token | Value | Purpose |
| --- | --- | --- |
| feedback | 100ms | Press, icon tone, underline response |
| quick | 160ms | Tab indicator and local selection |
| panel | 220ms | Inspector appearance and disclosure |
| orient | 300ms | Local record-context change |
| reveal | 420ms | Marketing heading or object entrance |
| settle | 600ms | Final decorative alignment |
| expressive cap | 900ms | Entire signature object sequence |
| stagger | 45ms, at most 5 items | Marketing sequence only; cap total at 650ms for headings |

Easing: enter `cubic-bezier(0.22, 1, 0.36, 1)`; exit `cubic-bezier(0.4, 0, 1, 1)`; local changes `cubic-bezier(0.2, 0, 0, 1)`; progress maps linearly to measured progress only. Direction A uses no spring on operational content. Direction B may use a single decorative 2px settle; C may reframe an overview but not its inspector. These are authored Alpha values; the blocked Moisez site was not measured.

## Interaction specifications

| Trigger / surface | Choreography | Interruption / fallback |
| --- | --- | --- |
| First home entry | Headline 12px rise + opacity, 420ms; record follows after 90ms. Primary action is visible and clickable at first paint. | Content server-rendered and readable without animation initialization. Reduced motion uses final state. |
| Ledger signature enters view | 0–180ms reveal fragments; 180–480ms align to shared baseline; 480–720ms draw source connectors; 720–900ms settle revision marker. Labels remain readable throughout. | Decorative layers only; real semantic record remains static. Once per document visit, not every scroll reversal. |
| Scroll between home chapters | One-shot 12px / 420ms entrance at roughly 15% visibility. Native scroll continues freely. | No pinned chapters in A; anchor jumps, restored scroll and fast scrolling cannot leave content hidden. |
| Link hover/focus | Underline scale from start edge, 100–160ms. | Keyboard focus has immediate visible ring; no hover-only information. |
| Button press | Color/border feedback 100ms; optional 1px decorative inner shift. | Hit box does not move. Disable duplicate submits using actual action state. |
| Select candidate | Selection border immediate; inline evidence margin fades in over 220ms with 8px movement. | Keep focus on trigger and selection stable. New selection cancels previous decorative motion. |
| Expand evidence | Content occupies real layout; brief opacity transition after layout update, max 160ms. | Avoid animating large table heights; no repeated row movement while reading. |
| Filter/sort model data | Apply data state promptly. 100–160ms emphasis on result count, no per-row stagger. | Empty/loading/error states are explicit. Keep header and search focus stable. |
| Select run / review tab | Update content first, 120ms fade if useful, maintain task identity and source anchors. | Do not remount forms or erase draft state to animate a tab. |
| Route navigation | Normal Next navigation is baseline. Optional new page heading 8px/180ms entrance after arrival. | No artificial exit wait. Browser back, deep links and modified clicks remain native. No global overlay covering a slow request. |
| Local record refresh | Refresh indicator driven by request state; changed rows get a single 600ms background fade. | Do not reset reading position. Stale stays stale until a new result establishes freshness. |
| Copy/export | Feedback appears only on actual success; label change 100ms and accessible status announcement. | Clipboard rejection or export error gives actionable text, not a success checkmark. |
| Check/run progress | Show known stage and elapsed time; indeterminate treatment only while request is pending. | Never animate a fabricated percentage or convert “received telemetry” into “verified.” |
| Error/review change | Inline text and icon appear immediately; optional 120ms opacity transition. | No shake, confetti or bouncing status; human acceptance and passing checks remain distinct. |

## Implementation approach

Prefer CSS transitions/keyframes for reusable feedback, IntersectionObserver for entry, and SVG for connections. Use WAAPI only when a cancellable authored sequence benefits from a timeline. Motion lives on decorative wrappers, not layout/hit-target elements. Read geometry before writes, batch in requestAnimationFrame when needed, and avoid React state updates on every scroll. One lifecycle owner per surface cleans observers, listeners and animations on unmount.

No global motion library is proposed for A. No smooth-scroll replacement. Native route behavior stays intact; do not assume an experimental shared-element routing API. GSAP is only a potential B spike; WebGL/physics only an optional C experiment after separate approval and measurement. Do not install any of them during planning.

## Accessibility and resilience

- Under `prefers-reduced-motion: reduce`, stop parallax, scrub, translation, spring and path travel; render final states. Functional announcements remain. Recheck changes to the preference while the page is open.
- Coarse pointers get direct taps, no magnetic/tilt behavior. Focus affordances are immediate and not animated away.
- No information is only visible on hover, in a film, on a graph, or behind a drag action. Provide list/table equivalents for C.
- Content defaults visible. A client/hydration/observer failure must not hide the product narrative indefinitely. Existing root reveal bootstrap requires careful migration.
- Pause optional animations when offscreen or document-hidden; preserve reading position and focus when interrupted. No autoplay media in the proposed A baseline.

## Performance and acceptance

Provisional budgets: no animation dependency for A; incremental motion JS <=15 KiB gzip on home; initial home transfer <=500 KiB compressed including fonts/poster but excluding optional deferred assets; no video in the critical path. Actual baseline must be captured before claiming improvement. Operational routes load no decorative hero code.

Target 60fps on a representative midrange mobile; inspect for avoidable long tasks >50ms while interacting. Target LCP <=2.5s, INP <=200ms and CLS <=0.1 at p75 when field data exists. Until then use repeatable lab runs and record hardware, viewport, network and cache state. No benchmark was run during this audit.

Acceptance: full keyboard journey; reduced-motion and mid-session preference changes; rapid repeat selection; back/forward and deep links; slow requests; failure with readable content; touch with no hover; no observer/RAF leaks on navigation; no row reorder animation during review. A static version must remain fully understandable.
