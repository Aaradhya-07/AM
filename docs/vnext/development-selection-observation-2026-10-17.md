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

## First real pilot executed

The project owner authorized an agent test approver. The [provider and data-region restriction task](../../examples/development-pilot/anvilmark-provider-restrictions.plan.json) ran in two isolated checkouts from the same frozen Git baseline with the same [prompt](../../examples/development-pilot/anvilmark-provider-restrictions.prompt.txt). Approval and reviews are recorded as `agent_test_operator`, never as human acceptance, and `development recommend` excludes these runs from local outcome rankings. The [run records, reviews, and patches](../../examples/development-pilot/observations/2026-10-17/) preserve the local pilot evidence.

| Configured model | Result                                                  |                      Input tokens (cached) | Output tokens |                          Elapsed | Named checks                           |
| ---------------- | ------------------------------------------------------- | -----------------------------------------: | ------------: | -------------------------------: | -------------------------------------- |
| `gpt-6-luna`     | One environment startup failure, then a completed patch | 1,464,871 (1,394,432) on the completed run |        17,119 | 178 seconds on the completed run | Development tests and CLI build passed |
| `gpt-6-sol`      | Completed patch                                         |                          931,749 (873,088) |        11,729 |                      146 seconds | Development tests and CLI build passed |

The initial Luna failure had zero model tokens and no code change because this environment denied Codex access to its local state database. After allowing the required local access, it completed. The Sol patch became the workspace implementation because it checks every declared processing region and supports both provider allow and exclusion rules. Both patches have an agent test acceptance. The current workspace has not received a human acceptance decision.

The Codex event stream provided token counts but no served-model event, so both identities remain `configured_only`. The two subscription runs have unknown marginal cash cost. These are single attempts on one task with different generated patches, so their token and time differences do not establish a reliable model ranking or cost reduction. Cached input is included in the reported input total. The new restriction fields carry source labels supplied in the plan; Anvilmark does not independently verify those sources or their completeness.

The [research decision record](development-selection-research-decisions-2026-10-17.md) maps primary papers to the architecture and limits. Their findings motivated repository-level checks and a fixed-model baseline, but none validates Anvilmark's selector on its users' tasks.

## Next evidence gate

Freeze a larger, independently reviewed set of representative architecture and coding tasks. Compare fixed cheap, fixed strong, verified-handoff, and selector policies on matched repository baselines, including retries and preparation costs. Obtain human-reviewed acceptance and an API-billed or invoice-backed comparison before claiming savings. Provider-source verification, client-mode compatibility, model-switch coverage, calibrated success probability, and a unified website view remain open.
