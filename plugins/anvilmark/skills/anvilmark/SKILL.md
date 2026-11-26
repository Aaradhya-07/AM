---
name: anvilmark
description: Local-first architecture planning, empirical per-slice model routing, deterministic slice conformance verification, and interactive Drift Radar Cockpit via AnvilMark MCP tools. Use whenever planning software features, splitting work across coding models, executing/verifying plan slices, or inspecting architecture drift.
---

# AnvilMark Control Plane

AnvilMark connects repository facts, architecture decisions, per-slice coding-model routing, deterministic conformance gates, and empirical cost/win-rate provenance—**100% locally inside your coding agent with zero extra API keys**.

## 1. Browserless Feature & Project Planning

When the user asks to plan a feature, design an architecture, or split work across models:

1. **Inspect deterministic repo + model evidence first:**
   Call `prepare_planning_context` (passing `goal`, and optional `subscriptions` / `quota_mode`). Never invent scripts, check commands, or tracked paths before calling this tool.
2. **Clarify before guessing:**
   If architectural requirements are underspecified (persistence, auth/tenancy boundaries, retry/idempotency rules, or v1 scope), call `ask_question` (or ask 2–4 concise questions) **before** locking a plan.
3. **Synthesize and lock the executable contract:**
   Construct a `HandoffPlan` where:
   - Every architecture decision documents its rationale, a credible rejected alternative, and the honest tradeoff.
   - Cross-boundary data crossings are listed in `flows`.
   - Each vertical slice in `tasks` picks its `model` from `ranked_candidates` (reserving scarce `frontier` quota for ambiguous architecture/security slices and routing bounded schema, CRUD, UI, and test slices to proven `balanced` / `fast` / `local_oss` models).
     Call `lock_execution_plan` to validate the DAG, compile deterministic `SliceContractSpec` globs + cross-vendor reviewers, update `.anvilmark/development/active-plan.json` + IDE rule files (`PLAN.md`, `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/anvilmark-plan.mdc`), and render the interactive **AnvilMark Cockpit** inline!

## 2. Executing & Verifying Slices

When implementing work under an active AnvilMark plan:

1. Call `list_plan_slices` to locate the next unblocked slice (`ready: true`), then call `get_slice_contract` for that `slice_id`.
2. Stay strictly within `contract.allowedGlobs`, never modify `contract.forbiddenGlobs` (`.env*`, keys, certs), and do not alter `package.json` dependencies unless `contract.allowDependencyChanges === true`.
3. Run the slice's check commands, call `verify_slice`, and once `passed === true`, call `record_slice_outcome` so Empirical Bayes routing learns from observed repository performance.

## 3. Opening the Interactive Cockpit UI

Call `open_anvilmark_cockpit` (with `{}`) whenever the user wants to view active slices, trigger 1-click verification, inspect trust-boundary drift findings, or check empirical model win-rates inline or in the side pane.
