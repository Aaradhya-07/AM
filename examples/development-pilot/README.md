# Development-model pilot fixture

This is a deliberately small, synthetic coding task for exercising the local
architecture → model comparison → agent run → checks → review path. Its token
expectations are declarations, not measured forecasts. It does not demonstrate
cash savings or model quality.

Copy these files into a new directory and initialize a Git repository there.
Commit the baseline, then run the built Anvilmark CLI from that directory:

```sh
anvilmark development plan --file plan.json
anvilmark development approve
anvilmark development recommend
anvilmark development run --model gpt-6-luna --prompt-file prompt.txt
anvilmark development report
```

The `approve` command requires an interactive terminal and a typed plan hash.
After the agent run passes the check, use its ID from `report` with
`anvilmark development review --run ID` to accept the exact observed code state.
Use `development review --run ID --decision reject --reason "..."` when a run
should be rejected. Then rerun `development recommend` to see the recorded
outcome in the comparison for this task profile.
The report then shows `accepted_current`; changing the code or plan makes that
standing stale. A run made without prior approval remains unapproved and cannot
be accepted later as though its architecture had been approved in advance.

`development run` currently supports Codex CLI in a clean Git checkout. It
captures structured event metadata, token counts, changed paths, and check exit
codes. It does not store the prompt or agent messages. A configured model is
shown as `configured_only` unless the event stream itself reports the model.
For a subscription, tokens describe allowance use; incremental cash cost is
unknown. The provisional lowest-token option is a starting point, not a
quality-gated recommendation.
