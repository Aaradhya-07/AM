# ANVILMARK Web & Cloud Platform: Complete Brief & Handover for Claude

> **Repository Root:** `/Users/na61/Desktop/ANVILMARK`  
> **Production Deployment:** [https://anvilmark.vercel.app](https://anvilmark.vercel.app)  
> **Supabase Project:** `https://jiodrwlpfqjotcazynlp.supabase.co`  
> **Current Branch:** `main` (clean, fully synced with `origin/main`)  
> **Date:** September 20, 2026

---

## 1. Executive Summary & Product Thesis

**ANVILMARK** is the independent architectural decision, memory sizing, and implementation review layer for AI-engineered software.

### Core Value Proposition

- **Not a prompt playground or chat agent**: Coding agents (Claude Code, Cursor, OpenAI Codex) generate features quickly, but they frequently drift from architectural constraints, exceed GPU memory budgets, or violate data privacy boundaries.
- **Local-first verification with zero source code egress**: Source code never leaves the developer's machine or private CI environment. Only cryptographic contract hashes, rule counts, and boundary verdicts are transmitted to the cloud platform console.
- **FINOS CALM 1.2 & Decision Contracts**: Formal decision contracts (`.anvilmark/project.yaml`) pin model families, context windows, data sanitizer gates, and hardware profiles.

---

## 2. Complete Architecture Overview

```
                        [ Developer Machine / Local CI ]
                         │
                         ├─ 1. anvilmark scan / check (Local AST analysis)
                         ├─ 2. anvilmark export (Produces standalone review-bundle.json)
                         └─ 3. anvilmark push (Transmits hashes & telemetry to Cloud)
                                         │  (Bearer Token Auth)
                                         ▼
                     ┌──────────────────────────────────────┐
                     │    ANVILMARK Web Platform (Next.js)  │
                     │    https://anvilmark.vercel.app      │
                     └──────────────────┬───────────────────┘
                                        │
                 ┌──────────────────────┼──────────────────────┐
                 ▼                      ▼                      ▼
        [ Supabase Auth & DB ]     [ Studio Cockpit ]     [ Public Playground ]
        - GitHub / Google OAuth    - 100% In-Browser      - Real Scanner Engine
        - Profiles & Projects      - Memory curves        - Atlas reference model
        - Conformance telemetry    - Zero egress          - Quality gap demo
```

---

## 3. What Has Been Built & Shipped

### A. Authentication & Identity Layer (`@supabase/ssr`)

- **Dual OAuth Support**: Integrated GitHub and Google OAuth providers with PKCE flow.
- **Session Architecture**:
  - `packages/web/lib/supabase/client.ts`: Browser client factory.
  - `packages/web/lib/supabase/server.ts`: Next.js Server Components / Route Handler client with cookie management.
  - `packages/web/lib/supabase/middleware.ts`: Automated session refresh across all application routes.
  - `packages/web/app/auth/callback/route.ts`: Secure server-side code exchange with error parameter propagation.
- **PKCE Fallback & URL Sanitization**:
  - `AuthProvider` detects incoming `?code=` on any URL path.
  - Automatically executes `supabase.auth.exchangeCodeForSession(code)` client-side if server routing was bypassed.
  - Sanitizes the browser address bar with `window.history.replaceState` (no hanging code tokens) and routes the user directly to `/dashboard`.
- **Demo / Preview Fallback**:
  - Built-in `Developer Role` and `Lead Architect` identities for instant sandbox evaluation without required environment credentials.

### B. Platform Dashboard (`/dashboard`)

- **Differentiated User Experience**:
  - **Guest Mode**: Prominent **Guest Sandbox Mode Active** banner with preloaded Atlas Banking reference contracts. Invites users to explore or 1-click sign in with GitHub/Google. "Connect Repository" opens the auth modal (`Sign In to Connect Repo`).
  - **Authenticated Mode**: Personalized greeting (`Welcome back, <Name>`), live account projects, connected repository management, and personal CLI sync token generation.
- **Repository Management**:
  - Filterable by conformance status: `All`, `Conforming`, `Pending Ratification`.
  - Project creation modal (`NewProjectModal`) with pre-configured templates (`Payment Engine`, `Fraud Worker`, `Local RAG`). Automatically persists to Supabase `projects` table when authenticated, with local cache fallback.
- **Live Conformance Telemetry Stream (`ConformanceFeed`)**:
  - Real-time audit stream polling `/api/runs`. Displays commit hashes, triggering agents (`Claude Code`, `Cursor`, `Local CLI`), pass/warn/fail status, and boundary counts.
- **Interactive Project Inspection Modal**:
  - **CALM Topology Viewer**: 4-node dataflow graph depicting Input Boundary -> Sanitizer Gate -> Local Boundary -> Inference Engine.
  - **Hardware Sizing Cockpit**: Memory curves, KV cache sizing, and operating headroom across Llama 3.1 70B (8xH100), DeepSeek V3 (FP8 MoE), and Claude 3.7 Sonnet (Hybrid Cloud).
  - **CI Workflow Generator**: Ready-to-copy `.github/workflows/anvilmark.yml` snippet.
  - **Simulation Engine**: "Run CI Telemetry Simulation" button that writes verified runs to `/api/runs` and live updates the audit stream.

### C. Homepage Hero (`packages/web/app/components/hero.tsx`)

- Converted to reactive client component (`useAuth`).
- **Dynamic View Adaptation**:
  - **Guest**: `Browser-local · Agent-ready · Verifiable contract` eyebrow, `Try in Playground →`, `Architecture Studio`, `Sign In` modal trigger, `Quickstart`, and `100% Local-First` badge.
  - **Authenticated**: `WORKSPACE ACTIVE // <Name> · <PROVIDER> SESSION` eyebrow, `Open Platform Dashboard →`, `Architecture Studio`, `Connect CLI` modal trigger, and `Authenticated as <email>` badge.

### D. Navigation & User Menu (`site-header.tsx` & `user-menu.tsx`)

- **Guest**: Direct `Sign In` button in header.
- **Authenticated**: Avatar / initials menu with dropdown options:
  - Platform Dashboard (`/dashboard`)
  - Architecture Studio (`/studio`)
  - Connect CLI (`anvilmark login`)
  - Sign Out (with automated session clearance and redirect to `/`)
  - Navigation bar dynamically prepends `Dashboard` link on desktop and mobile menus.

### E. CLI Cloud Sync & Telemetry (`@anvilmark/cli`)

- **Commands Added**:
  - `anvilmark login --token <TOKEN> [--endpoint URL]`: Saves credentials in `~/.config/anvilmark/credentials.json`. Refuses to store credentials inside repository roots.
  - `anvilmark login --whoami`: Displays active authenticated session and endpoint.
  - `anvilmark login --logout`: Clears local credentials.
  - `anvilmark push`: Transmits local contract verification hashes, commit SHA, and conformance results to `/api/runs`. Zero source code egress.
- **Localhost Adaptation**:
  - `CliConnectModal` detects `window.location.hostname === "localhost"` and automatically generates `npx @anvilmark/cli login --token <TOKEN> --endpoint http://localhost:3000`.

### F. Browser-Local Architecture Studio (`/studio`)

- **Zero-Egress Cockpit**: Evaluates exported `anvilmark-review-bundle/1` bundles completely inside browser memory using WebAssembly / local JS.
- **5 Evaluation Tabs**:
  1. _Review Overview_: Overall verdict, non-conformance findings, missing evidence gaps.
  2. _Decision & Evidence_: Workload alternatives, recorded rationale, unresolved constraints, hardware sizing curves.
  3. _Code Checks & Trace_: File paths, line numbers, and step-by-step dataflow propagation traces.
  4. _Snapshot Changes_: Side-by-side comparison between two review snapshots to detect regressions.
  5. _Agent Action Brief_: Copyable precision repair prompts for Claude Code or Codex.

---

## 4. Invariants, Technical Constraints & Verification

### Strict Architectural Invariants

1. **The Invariant Rule (Zero `/approv/i` in `packages/web/app/**`)**:
   - Strictly enforced by `packages/cli/test/decisions.test.ts` (test: `stays out of MCP and the web package`).
   - Domain vocabulary in the web package must use terms like `ratification`, `conformance`, `authorization`, `verification`, and `sign-off`.
2. **Local-First Privacy**:
   - Source code is never transmitted to the cloud console. Only cryptographic hashes, rule counts, and verdicts are synced.
3. **Serverless Safety**:
   - Synthetic fixtures and engine bundles are inlined in `packages/web/lib/atlas-fixtures.ts` to ensure 100% determinism on Vercel AWS Lambda.

### Test & Build Verification

- **Monorepo Tests (`pnpm test`)**: **100% Passed** across all 11 packages (238 CLI tests, 48 Web tests, 189 Scanner tests, 88 Context tests, 26 MCP tests, 37 Conformance tests).
- **Format & Lint**: `pnpm lint` -> **0 problems**, `pnpm format:check` -> **All files match code style**.
- **CLI Decision Invariants**: `pnpm --filter @anvilmark/cli test test/decisions.test.ts` -> **16/16 Passed** (strictly asserting zero `/approv/i` in web app).
- **CLI Cloud Sync Suite**: `pnpm --filter @anvilmark/cli test test/cloud-sync.test.ts` -> **7/7 Passed** (including permission mode `0o600`, consent enforcement, and strict payload pinning).
- **Next.js Production Build**: `pnpm --filter @anvilmark/web build` -> **Compiled successfully in 2.4s (12/12 static/dynamic routes)**.
- **Live Production Endpoint**: Verified live on [https://anvilmark.vercel.app](https://anvilmark.vercel.app).

---

## 5. Resolution of Claude's Security & Architecture Review

In response to Claude's rigorous code review, the following critical remediations were implemented:

1. **Authenticated Telemetry Endpoint (`/api/runs`)**:
   - Closed the unauthenticated write hole. Every `POST /api/runs` now validates caller identity via `Authorization: Bearer <token>` or Supabase session cookies.
   - Strictly rejects `"anon_cli_session"` with `401 Unauthorized`.
   - Rejects forged payloads containing prohibited source code keys (`source`, `code`, `file_contents`, `files`, `ast`).
   - Strictly asserts commit SHA format (`/^[0-9a-fA-F]{7,40}$/`) and enforces project ownership in the database.

2. **Full Pipeline Green on `main`**:
   - Eliminated all 11 ESLint errors across the monorepo (unused imports, `any` types, empty catch blocks).
   - Formatted all 21 dirty files with Prettier (`pnpm format:check` is 100% clean).
   - Validated complete monorepo test suite (`pnpm test`) with zero failures.

3. **Outbound Consent & Policy Enforcement on `anvilmark push`**:
   - `push` now strictly respects the contract's `remote_intelligence_policy.show_payload_before_remote_send`.
   - Displays an explicit payload preview before transmission showing the destination endpoint, project ID, commit SHA, and conformance verdict.
   - Prompts for interactive consent (`[y/N]`) before transmitting. In automated CI pipelines, `--yes` / `-y` is required; non-interactive execution without `--yes` is safely refused.
   - Eliminated anonymous token fallback: unauthenticated pushes are refused with a clear instruction to run `anvilmark login`.

4. **Strict Payload Pinning Automated Test**:
   - Added `cloud-sync.test.ts` test spinning up a mock HTTP server.
   - Strictly asserts that `anvilmark push` transmits ONLY 5 keys: `["agentTrigger", "commitSha", "details", "projectId", "status"]`.
   - Asserts zero source code, zero file paths, zero ASTs, and zero secrets.

5. **Restricted Credential Permissions (`0o600`)**:
   - `anvilmark login` writes `credentials.json` with `{ encoding: "utf8", mode: 0o600 }` (owner read/write only).
   - Verified via unit test inspecting file mode.

6. **Shell History Hygiene & Documentation**:
   - Added `ANVILMARK_API_TOKEN` environment variable support to `anvilmark login` to prevent tokens from appearing in shell history or `ps` output.
   - Updated `packages/cli/README.md` with complete documentation for `login` and `push`, including privacy guarantees and CI usage.

---

## 6. What Claude Should Review & Critique Next

When continuing work on ANVILMARK, Claude should inspect and advise on:

1. **GitHub App / PR Webhook Integration**:
   - Currently, telemetry can be submitted via CLI (`anvilmark push`) or GitHub Actions curl (`/api/runs`).
   - What would the architecture for a native ANVILMARK GitHub App look like to post sticky PR comments with visual CALM boundary status diffs?

2. **Supabase Realtime vs. Polling for Telemetry**:
   - `ConformanceFeed` currently polls `/api/runs` every 15 seconds.
   - We can enable Supabase Realtime WebSocket subscriptions on the `conformance_runs` table for instant, zero-latency audit streaming.

3. **Multi-Tenant Team Workspaces**:
   - The current Supabase schema supports personal user accounts (`user_id`).
   - How should we model organizations, team members, and role-based access control (Lead Architect vs Feature Developer)?

4. **Agent Action Brief Refinement for Claude 3.7 Sonnet**:
   - Review the generated prompt format in `packages/conformance/src/review.ts` (`buildAgentBrief`).
   - Are there prompt structure enhancements that improve Claude's auto-fix accuracy when resolving data boundary violations or model mismatches?
