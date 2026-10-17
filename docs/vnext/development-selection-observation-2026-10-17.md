# Development selection implementation observation — 2026-10-17

## What changed

- The canonical brief and project tracker now make coding-agent model choice and the connected AI-assisted development record the primary direction. The application-model contract remains separate.
- A local SQLite development-evidence index is rebuilt from archived plans and run/review records. The matching key includes repository-local architecture part, task kind, language set, risk, agent, and configured model. Old plans without a profile are excluded rather than guessed into a task category.
- `development recommend` applies the existing model and projected-cash restrictions, shows exact-profile accepted, rejected, failed, and awaiting-review counts, and can report a descriptive sample cost per accepted task for comparable API-rate runs. It keeps subscription cash cost unknown and identifies configured-only model evidence.
- Optional explicit mappings link a plan candidate to one source-scoped public catalog model ID. With `--catalog-db`, recommendations display the dated source snapshot and matching observations. The public data is not promoted to coding-task quality evidence.
- Interactive review can reject a run with a reason. A changed review hash or invalid archived plan is not accepted outcome evidence.
- A run with multiple reported models or a reported model different from the configured one is excluded from single-setup comparisons. The configured candidate's API rate is not applied when the reported model differs.
- Cached input tokens need an explicit cached-input rate before an API-rate run receives a cash estimate. Without that rate, cash remains unknown.

## Verification

- TypeScript build and focused lint passed.
- The focused development and model-catalog suites passed: 11 tests in two files. A workflow case ran two candidate setups against the same clean Git baseline using a fake local agent, accepted one run for each, rejected a further run, and checked the resulting cost-per-accepted comparison. Altering a review hash removed its accepted outcome from the rebuilt index.
- Formatting and diff checks passed.

These checks establish storage, mapping, and decision-loop mechanics. They do not establish that Anvilmark improves coding quality or reduces cash spending. The test agent and outcomes are synthetic; the API rates in that test are declarations.

## First real pilot prepared

The proposed first task is [provider and data-region restriction evidence](../../examples/development-pilot/anvilmark-provider-restrictions.plan.json) in Anvilmark itself, with an [agent prompt](../../examples/development-pilot/anvilmark-provider-restrictions.prompt.txt). It has two Codex CLI model options, a bounded TypeScript feature scope, and named checks. Both options use subscription billing, so the pilot can assess completion and allowance use but cannot establish cash savings. The exact plan must be reviewed by the project owner before running; the current checkout contains pre-existing uncommitted work and needs an isolated clean baseline. The owner must also review each resulting change. No real pilot run or human acceptance is claimed here.

## Next evidence gate

Run the prepared task from the same clean baseline in separate checkouts if both options are available. Record the tool-reported or configured-only identity, checks, human acceptance/rejection, retries, and usage. Then test an API-billed or invoice-backed comparison if a cash-saving claim is desired. Source-backed provider policies, client-mode compatibility, model-switch coverage, calibrated success probability, and a unified website view remain open.
