# Local development, troubleshooting and boundaries

## Entry points and supported setup

The reproduced onboarding path uses Node 24 and pnpm 11.16.0 on macOS. The tools
use Node filesystem/process APIs; Linux/Windows packaging and other Node versions
are not certified by this run. Shell examples use bash/zsh. There is no published
npm package or required global ANVILMARK install in this prototype.

Run `node scripts/setup.mjs` from a checkout. It checks the local versions, performs a
frozen dependency install and builds the core packages. It does not build the
optional historical web scaffold; `pnpm run build` builds everything. The
committed CLI/MCP launchers exist before build, so package-manager linking does
not depend on an ignored `dist` file. Before build they report a recovery command
on stderr and exit 2. Build failures propagate rather than printing success.

`node scripts/doctor.mjs --json` reports versions, dependencies, core entry-point health
and optional binary presence. It does not print environment variable values,
run optional adapters, contact providers or download a package manager. The
package manager itself can access registries during the explicit setup install.
Use the direct Node commands above. A package-manager wrapper may install
dependencies before executing a script; pnpm also has similarly named built-in
commands. The package-script aliases remain conveniences after installation.

## Where to look

| Concern                                          | Guide or package                                              |
| ------------------------------------------------ | ------------------------------------------------------------- |
| First use                                        | [Quickstart](../../QUICKSTART.md)                             |
| Guided review and source correction              | [Atlas workshop](milestones/07-guided-workshop.md)            |
| Automated regression replay                      | [Atlas replay](milestones/07-atlas-walkthrough.md)            |
| Contract validation, tiers, approval hashes      | [Project contract](../../packages/project-contract/README.md) |
| Provider-neutral proposals and optional evidence | [Adapters](../../packages/adapters/README.md)                 |
| CLI edits, review, generation and conformance    | [CLI](../../packages/cli/README.md)                           |
| Architecture views and data projections          | [Context](../../packages/context/README.md)                   |
| Supported TS/JS mapping and declarations         | [Scanner](../../packages/scanner/README.md)                   |
| Verdict semantics and freshness                  | [Conformance](../../packages/conformance/README.md)           |
| Client configuration and MCP projection          | [MCP](../../packages/mcp/README.md)                           |

## Recovery

| Symptom                                      | Next step                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong Node/pnpm or unavailable pnpm          | Install the pinned prerequisites using your usual tools; rerun `node scripts/doctor.mjs`. Setup never activates them globally.                          |
| Missing build/dependencies                   | Run `node scripts/setup.mjs` from the checkout. Inspect its first failing command; dependency access may need your normal registry/proxy setup.         |
| Existing workshop destination                | Choose a new directory. Preparation never overwrites an existing project; an interrupted folder is retained for inspection.                             |
| Decision unapproved or stale                 | Run `review`, inspect the changed content and gaps, and approve interactively only if you accept it. A candidate edit can invalidate an older approval. |
| Conformance exit 1                           | Read the independent rule failures, locations and traces. Correct code or explicitly revise policy through the decision workflow.                       |
| Conformance exit 2                           | Inspect analysis errors/unknown reasons. Supply missing declarations/identities or simplify unsupported dynamic code; do not count unknown as pass.     |
| Conflicting scan/report selection            | Supply `--repository` and `--config` explicitly.                                                                                                        |
| Old report format                            | Run normal conformance to regenerate the local report.                                                                                                  |
| Manual source edit blocks a workshop variant | Keep the edit and inspect it; preserve it elsewhere before deliberately restoring the training template.                                                |
| MCP startup error                            | Use the committed project launcher with `--project-dir`; run `--help` to check the entry point. Diagnostics use stderr; stdout is protocol only.        |

## Optional evidence adapters

promptfoo and llmfit are optional and are never installed by setup. `doctor`
reports presence only. In a project, `compare --probe-tools` explicitly runs
local version probes; a missing tool remains an evidence gap. See the adapter
and CLI guides for compatibility, importing evidence and the pinned optional
integration-test configuration. A model fit estimate is not a benchmark, and a
fixture model reference is not a measured quality or availability claim.

Remote evaluation requires its own explicit provider authorization and scoped
consent. A local MCP server alone does not authorize sending its output to a
remote model. The workshop uses the handoff mechanism with an empty host
configuration, so its proposal import is offline and labeled.

## Security and data handling

The contract and local reports can contain project details. Generated artifacts
are views of the contract, not approval authority. MCP has no mutation or approval
tool. Default context/conformance projections withhold local-only material;
full conformance traces and paths are exposed only through `local-disclosed`.
Keep diagnostics on local stderr and inspect outbound previews before remote use.
An external process with filesystem access can still edit local state; hashes
and a terminal prompt are not signatures or proof of a human identity.

Static analysis does not execute application source or package lifecycle scripts.
Its pass is limited by selected inventory, supported operations and declared
source/sanitizer effectiveness. It is not whole-program privacy or runtime
network enforcement. Scanner/configuration errors and unknowns must remain
visible. Avoid storing credentials in contracts, declarations or generated files;
use existing environment/session references through the documented adapters.

## Cleanup and contributing

Setup installs only checkout dependencies/build output, with package-manager
caches managed normally by pnpm. It starts no persistent service. The workshop
keeps the directory you chose; remove that directory when the training records
are no longer wanted. The replay removes only its own temporary directory unless
`--keep` is used. Real `.anvilmark/` directories contain contract/history/evidence
and should be backed up before deletion. Client settings installed separately
must be removed separately; deleting a training folder does not modify them.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for checks and scope rules.
