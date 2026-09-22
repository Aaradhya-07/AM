# ANVILMARK quickstart

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
