# ANVILMARK quickstart

## Fastest path: 1-command local setup (`Claude Code`, `Codex`, `Cursor`, `VS Code`, `Antigravity`)

Connect ANVILMARK's local MCP server, browserless planning workflow, slash commands, skills, and active Git `pre-commit` + Claude `Stop` guardrails in any Git repository:

```sh
npx anvilmark connect --with-hooks -C /path/to/your/repo
```

No hosted account or separate API key is required—your active coding agent supplies the reasoning while ANVILMARK supplies deterministic repository metadata, Empirical Bayes per-slice model routing, enforced `SliceContractSpec` globs, and drift verification:

- **Terminal Mission Control:** run `npx anvilmark` inside your repo to view connected IDEs, active slice waves, drift status, and observed model win-rates.
- **Claude Code:** run `/anvilmark-plan <feature>`, `/anvilmark-next`, or `/anvilmark-cockpit`.
- **Codex / Cursor / Antigravity:** ask your agent to call `prepare_planning_context` → `lock_execution_plan`, or open the interactive **AnvilMark Cockpit** MCP App (`open_anvilmark_cockpit`).
- **Autonomous local slice execution (`am-server` / OSS GPUs):** run `npx anvilmark next --exec --runner am-server` to run a contract-jailed edit + verification loop at \$0 marginal API cost.

---

## Plan visually in `/beta` Studio (+ optional Zero-Copy Local Bridge)

From an installed checkout, run `pnpm dev:web` and open `http://localhost:3000/beta`:

- Conversational 3-mode flow (**Chat** → **Interactive Clarification Cards** → **Architecture, Trust-Boundary Graph & Per-Slice Model Routing**).
- Pair directly with any local repository without manually exporting/importing files:
  ```sh
  npx anvilmark bridge -C /path/to/your/repo --port 4317
  ```
  Click **Repo** in `/beta`, paste the printed pairing token, and get 1-click live context + outcomes sync, 1-click **Apply to repo ⚡**, live **Verify slice**, and bidirectional **Architecture Drift Radar**.

_(Legacy single-shot draft planner remains available at `http://localhost:3000/plan`.)_

Gemini and OpenAI accept a key in the planner. For a private instance, set
`ANVILMARK_GEMINI_API_KEY` in `packages/web/.env.local` to use a server-side
Gemini key and restart the web app. Anyone who can access that instance can
use its Gemini quota. To use Ollama, run it on the same
machine as the web app, pull a model such as `qwen3:8b`, and start the site with:

```sh
ANVILMARK_PLANNER_ENDPOINT=http://127.0.0.1:11434/v1/chat/completions pnpm dev:web
```

Select **Configured endpoint**, enter the installed model ID, and leave the
key blank for Ollama. The environment variable can also point to another
trusted OpenAI-compatible chat completions endpoint. Set it on the web
server, since the server makes the request. On a hosted deployment,
`127.0.0.1` refers to the deployment, so run the site locally for laptop inference.

Task costs use published standard rates for supported API model IDs and
estimated input/output tokens. Subscription costs and unfamiliar model
prices remain unknown. Strict mode includes defensive verification
requirements in the handoff for the local agent to run and report.

Start here to install the local tools and try an Atlas training project. The
workflow prepares a decision for your review, generates architecture/context,
and checks supported provider calls and declared data flows. No hosted
ANVILMARK account, inference key or model download is needed.

## 1. Set up the checkout

The supported onboarding path uses **Node.js 24** and **pnpm 11.16.0**. Install
those with your usual development tools first. The package's broader Node
`>=20` declaration is not a claim that every version/OS combination is tested.

Clone the repository into a new directory:

```sh
git clone https://github.com/N6118/ANVILMARK.git
cd ANVILMARK
```

From the checkout, install and check the local tools:

```sh
node scripts/setup.mjs
node scripts/doctor.mjs
```

`setup` checks versions, installs the frozen workspace dependencies and builds
the core CLI/MCP packages. Dependency installation can use the registry; setup
does not install models, configure agent applications or modify shell profiles.
`doctor` checks the two entry points and reports optional tool presence without
executing those tools. Missing promptfoo/llmfit does not block the core path.

Use these direct Node commands for setup and diagnosis. Some pnpm configurations
install dependencies before running a package script; invoking Node ensures the
version check runs first and the health check stays read-only. The script does
not download or activate a missing package manager.

## 2. Prepare a training project

Choose a new directory; preparation refuses to overwrite an existing one:

```sh
export ANVILMARK_WORKSHOP="$PWD/../atlas-training"
pnpm run workshop prepare "$ANVILMARK_WORKSHOP"
```

This creates a draft project, imports a labeled pre-authored proposal, compares
candidates and proposes a training decision. Evidence gaps remain explicit.
It also writes a synthetic application and scanner declarations. It makes no
provider calls and records **no approval**.

The output and `NEXT-STEPS.txt` contain exact commands for your paths. Review
the decision, its unresolved constraints and its approval hash. If you accept
this training decision, run the printed interactive `approve` command yourself.
You can decline and keep the project for later. No scripted approval is supplied.

## 3. Check, correct and recheck

After approval, from the ANVILMARK checkout:

```sh
pnpm run workshop check "$ANVILMARK_WORKSHOP"
pnpm run workshop variant "$ANVILMARK_WORKSHOP" corrected
pnpm run workshop check "$ANVILMARK_WORKSHOP"
pnpm run workshop variant "$ANVILMARK_WORKSHOP" ambiguous
pnpm run workshop check "$ANVILMARK_WORKSHOP"
```

The initial deliberate violation exits **1** and fails both provider and
privacy rules. Corrected code exits **0** within the declared scope. Ambiguous
runtime dispatch exits **2** and remains unknown. Before a current approval,
`check` refuses to generate context or write a report. Variant switching
preserves manual source edits by refusing to overwrite them.

A pass depends on source declarations and the assumed redactor behavior. It
does not establish empirical redaction quality or runtime privacy. This training
exercise is not a real production decision or actual agent application test.
See the [guided walkthrough](docs/vnext/milestones/07-guided-workshop.md).

## Guided development demo

After setup, start the interactive tour from this checkout:

```sh
bash scripts/development-tour.sh
```

Press Enter for each explained command, or `q` to quit. It shows the repository
landscape, phase plan, model comparison, verified handoff, checks, review, and
the phase closure gate using a disposable example. The stand-in coding agent
and test-only records do not establish model quality or human approval.

## Automated replay and tests

For an unattended synthetic fixture replay, independent of your training project:

```sh
pnpm run demo:atlas
```

For all checks, including the separate web scaffold:

```sh
pnpm run build
pnpm test
pnpm lint
pnpm format:check
pnpm verify:mcp
pnpm verify:mcp-project
```

The replay and protocol harness do not impersonate real human approval or prove
Claude Code/Codex application compatibility. Optional external-tool tests report
skips when their prerequisites are absent.

## Your own project and cleanup

Use the committed launcher from any directory:

```sh
# Set this while in the ANVILMARK checkout (bash/zsh).
export ANVILMARK_CHECKOUT="$PWD"
anvilmark() { node "$ANVILMARK_CHECKOUT/packages/cli/bin/anvilmark.mjs" "$@"; }
anvilmark help
```

From your existing TypeScript/JavaScript application repository, run
`anvilmark start`. It shows a read-only, source-linked inventory, then asks
for one application description before creating a local draft. Rerunning it
shows the current project status. For a noninteractive run, use
`anvilmark start --idea "What this app does"`; without `--idea`, plain `start`
writes nothing. No account or GitHub link is needed for this first result.
For Codex, `anvilmark start --connect-codex` adds the project server to this
repository's `.codex/config.toml`. Trust the project and restart Codex to load
it. Codex will prompt before the agent's draft-writing tools run.

Your contract must declare the intended repository/current decision and your
scanner declarations must describe your own code. The workshop's templates are
only training fixtures; do not run them as an inference application or install
its synthetic SDK as a real dependency. Follow the [CLI guide](packages/cli/README.md)
for real projects and the [MCP guide](packages/mcp/README.md) for client setup.

The automated replay removes its own temporary workspace unless `--keep` is
supplied. The guided workshop keeps its folder; remove only the chosen training
folder when you no longer need it. For real projects, back up `.anvilmark/`
before deleting it: it contains decisions, history and evidence, not just cache.
No background service is installed by setup or the workshop.

For missing dependencies, stale approvals, unknown results and other recovery
steps, see [troubleshooting](docs/vnext/local-development.md).
