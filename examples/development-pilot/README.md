# Development-model pilot fixture

This is a deliberately small, synthetic coding task for exercising the local
architecture → model comparison → agent run → checks → review path. Its token
expectations are declarations, not measured forecasts. It does not demonstrate
cash savings or model quality.

## Three-minute live demo

From the Anvilmark checkout, build the CLI and start the guided tour.

```sh
pnpm install --frozen-lockfile
pnpm --filter @anvilmark/cli... build
bash scripts/development-tour.sh --human-review --keep
```

Use `--auto --keep` for an unattended rehearsal with a labeled test review.
The tour uses a deterministic stand-in to write the actual patch in a
disposable Git repository. It uses test-only plan approval, including when a
person reviews the patch. Node executes the actual tests and esbuild writes
the actual bundle. The tour prints the temporary project directory and the run
ID. With `--keep`, the run records and bundle remain available under
`.anvilmark/` in that project.

1. **Show the plan and baseline.** Only `label.mjs` may change. The isolated
   baseline runs three tests. One passes and two fail. The plan requires the TAP
   failure marker for repeated punctuation, and the scout confirms it.
2. **Run the patch.** The stand-in edits `label.mjs`. The same test command now
   passes all three cases and esbuild writes `.anvilmark/build/label.mjs`.
3. **Review the patch.** Have someone other than the author check that the export
   is preserved and repeated separators collapse. The reviewer types the
   displayed run hash to record their decision. Git independently checks
   the tracked patch for whitespace errors and conflict markers.
4. **Show the timeline.** Point out the baseline failure, the agent exit, both
   successful verification commands, the architecture boundary, and the
   review actor. This run provides evidence of the local workflow.

## Implemented and proposed

| Priority                | Implemented                                                                                                                                                                                                                                                                                                                  | Proposed                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Independent review      | An advisory Git diff check runs separately from the editor. An operator can review the patch, accept or reject the exact run, and record a reason. Plans can require separate spec-compliance and code-quality verdicts with findings.                                                                                       | A second-model reviewer and authenticated reviewer identity.                                   |
| Verification            | Executes approved test and integration commands. Records arguments, exit status, duration, and completion time. A check can require a specific baseline exit status and output marker. Output tails are opt-in.                                                                                                              | Full log artifacts and CI attestation.                                                         |
| Timeline                | `anvilmark development timeline --run ID [--json]` follows the verified handoff, approval when recorded, agent execution, checks, boundary result, and hash-matched review. It reads the existing local records.                                                                                                             | Web timeline and cross-run aggregation.                                                        |
| Architecture compliance | Optional `architecture.allowed_changed_paths` lists exact repository-relative files. The check rejects out-of-scope visible Git changes, deleted or non-regular changed paths, and a different HEAD. It detects changes to the observed code state between verification commands and prevents acceptance of a violating run. | Dependency-direction, API compatibility, and semantic architecture rules for development runs. |

The change boundary observes tracked and non-ignored untracked files outside
`.anvilmark/`. Use source-only paths in the list and put generated output in an
ignored location. Review capture settings before collecting command output
that could contain sensitive data. The fixture makes no model-quality or cost
claim.

## Run with a configured coding agent

Copy these files into a new directory and initialize a Git repository there.
Commit the baseline, then run the built Anvilmark CLI from that directory:

```sh
anvilmark development plan --file plan.json
anvilmark development approve
anvilmark development recommend
anvilmark development scout --prompt-file prompt.txt
anvilmark development run --model gpt-6-luna --prompt-file prompt.txt --handoff HANDOFF_ID
anvilmark development report
anvilmark development timeline --run ID
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
