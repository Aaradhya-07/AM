# Development-model pilot fixture

This is a deliberately small, synthetic coding task for exercising the local
architecture → model comparison → agent run → checks → review path. Its token
expectations are declarations, not measured forecasts. It does not demonstrate
cash savings or model quality.

To present this example as a guided, offline terminal tour from the Anvilmark
checkout, run `bash scripts/development-tour.sh`. It explains each command,
shows its output, and waits for Enter before continuing. The tour uses a
stand-in agent and test-only approval/review records; see the ending for the
real human approval, Codex run, review, commit, and phase closure commands.

Copy these files into a new directory and initialize a Git repository there.
Commit the baseline, then run the built Anvilmark CLI from that directory:

```sh
anvilmark development plan --file plan.json
anvilmark development approve
anvilmark development recommend
anvilmark development scout --prompt-file prompt.txt
anvilmark development run --model gpt-6-luna --prompt-file prompt.txt --handoff HANDOFF_ID
anvilmark development report
```

The `approve` command requires an interactive terminal and a typed plan hash.
Copy `HANDOFF_ID` from the `scout` output. The scout checks tracked file hashes
and runs the declared check in a separate checkout at the baseline commit.
Its failing check does not, by itself, identify the cause of the bug.
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
unknown. Declared token estimates do not establish a first-run winner; use a
reviewed fixed baseline until comparable accepted work supports a change.

The example plan fixes `strong` as the comparison baseline and allows no
accepted-task-rate drop. One run on this example cannot establish a winner:
`recommend` will say how many matched, human-reviewed tasks are still needed.
To build a comparison, prepare distinct frozen tasks with the same task profile,
run each setup from the same clean Git commit with the same prompt, and review
each result. Keep each task's checks and review criteria fixed before running
either setup. The matched decision remains advisory, and subscription billing
leaves cash savings unknown.
