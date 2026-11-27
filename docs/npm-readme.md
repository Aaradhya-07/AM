# ANVILMARK

Local-first architecture planning, per-slice coding-model routing, deterministic slice conformance gates, and empirical cost/outcome provenance across **Claude Code, Codex, Cursor, VS Code, Antigravity, and local OSS GPUs**.

Nothing here sends your source code or secrets anywhere unless you explicitly invoke an external model.

## 1-Command Agent & IDE Setup

```bash
npx anvilmark connect --with-hooks
```

Auto-wires `anvilmark-project-mcp` (`--local-studio --slice-execution --agent-assessment --hardware-sizing`), slash commands, workflow rules, skills, and active Git `pre-commit` + Claude `Stop` guardrails across:

- **Claude Code** (`.mcp.json` + `/anvilmark-plan`, `/anvilmark-next`, `/anvilmark-cockpit` + `Stop` guardrail)
- **Codex** (`.codex/config.toml`)
- **Cursor & VS Code** (`.cursor/mcp.json`, `.vscode/mcp.json`, `.cursor/rules/anvilmark-workflow.mdc`)
- **Google Antigravity** (`.agent/skills/anvilmark/SKILL.md` + inline **AnvilMark Cockpit** MCP App UI)

## Everyday CLI Commands

```bash
npx anvilmark                         # Mission Control: connected tools, slice DAG, drift & win-rates
npx anvilmark next                    # Claim or auto-execute the next unblocked task slice
npx anvilmark verify-slice --slice id # Enforce allowedGlobs, forbiddenGlobs, deps & boundary checks
npx anvilmark drift                   # Compare planned data flows against static repo observations
npx anvilmark outcomes --write        # Aggregate empirical model win-rates & rework ratios
npx anvilmark ci-report               # Emit Markdown conformance & provenance summary for PRs/CI
npx anvilmark bridge --port 4317      # Optional zero-copy loopback sync with AnvilMark Web Studio
```

## Zero-Config AI Inventory & Conformance

```bash
npx anvilmark inventory ./my-app
npx anvilmark start
npx anvilmark scan
npx anvilmark conformance
```

## Hardware Sizing & Model Research

```bash
npx anvilmark hardware probe --json
npx anvilmark quality benchmarks --search SWE-bench
npx anvilmark quality leaderboard SWE-bench/SWE-bench_Verified --limit 10
```

Source, issues, and full documentation:
<https://github.com/N6118/ANVILMARK>

Apache-2.0.
