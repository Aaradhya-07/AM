# Braintrust Validation Experiment

**Isolated competitor-validation artifacts. Not ANVILMARK product code.**

|         |                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Created | August 13, 2026                                                                                                                    |
| Status  | **Prepared, not executed.** No account, no credentials, no live API calls made.                                                    |
| Purpose | Answer T1–T7 in [`../../docs/validation/braintrust-hands-on-test-plan.md`](../../docs/validation/braintrust-hands-on-test-plan.md) |

## Isolation guarantees

- Lives entirely under `experiments/braintrust-validation/`.
- **Not** a pnpm workspace package — `pnpm-workspace.yaml` includes only `packages/*`, so `pnpm build` and `pnpm test` do not reach it.
- Not referenced by the root `tsconfig.json` project references.
- Imports nothing from `@anvilmark/*`. Touches no schema, fixture, MCP tool, or web file.
- **The frozen contract `0.1.0` is not involved in any way.**

## What is here

| File                    | Purpose                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `generate-datasets.mjs` | Deterministic synthetic data generator. **Offline — no network, no API calls.**                       |
| `scenarios.json`        | The two old/new configuration pairs, with model identifiers left as placeholders                      |
| `eval-scenario-1.ts`    | Braintrust eval scaffolding — ticket classification                                                   |
| `eval-scenario-2.ts`    | Braintrust eval scaffolding — document summarization                                                  |
| `github-workflow.yml`   | Workflow **template** to copy into the throwaway repo. Deliberately not installed in this repository. |
| `.env.example`          | Environment variable names only. **No secrets, no values.**                                           |
| `EVIDENCE-CHECKLIST.md` | What to capture, per phase                                                                            |
| `COMMANDS.md`           | Exact commands, expected outputs, and stop conditions                                                 |

## Execution boundary

**Everything up to the credential boundary is done. Nothing past it can proceed without the founder.**

Prepared and safe to run now:

```bash
node experiments/braintrust-validation/generate-datasets.mjs
```

That command writes JSONL files locally and makes no network calls.

Blocked until credentials exist (see [`../../FOUNDER-ACTIONS.md`](../../FOUNDER-ACTIONS.md)): everything in `COMMANDS.md` phases A–E.

## Cost warning

Phase D deliberately runs the same configuration repeatedly to measure the run-to-run noise floor, and Scenario 2 uses long documents. **Use a dedicated provider key with a hard spend cap.** Reduce `S2_DOC_COUNT` to 25 if the cap binds.
