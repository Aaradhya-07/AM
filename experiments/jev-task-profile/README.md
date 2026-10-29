# Jev task-profile experiment

This local experiment asks TypeSafe Jev to suggest the `kind` and `risk` fields
used by `anvilmark development plan`. It does not alter a plan or choose a coding
model. The two Choice questions run in one API request per task.

## Preview and run

Node.js 20 or later is enough; no package install is needed.

```sh
node experiments/jev-task-profile/run.mjs --preview
TYPESAFE_API_KEY=... node experiments/jev-task-profile/run.mjs --live
```

`--preview` prints the exact descriptions and questions that would be sent. A
live run sends each case's `summary` and optional `architecture_summary` to
TypeSafe. Set the key in your local environment; never add it to a file in this
repository. The resulting JSON report is written under ignored `results/`,
without task descriptions or raw API responses. `--report FILE` chooses another
location. A failed case is recorded and makes the command exit nonzero.

Use `--cases FILE` to evaluate your own JSON array. Every item needs a unique
`id`, `summary`, `expected: {kind, risk}`, and `label_source`. The supported
labels match the current development-plan schema:

- `kind`: `architecture`, `bug`, `feature`, `refactor`, `test`, `review`
- `risk`: `low`, `medium`, `high`

Use `label_source: "human_reviewed"` with `reviewed_by` and ISO `reviewed_at`
after a person has reviewed the label. Use `"illustrative"` for demonstrations.
The bundled six cases are illustrative; their agreement is **not a measured
accuracy claim**. The report separates human-reviewed accuracy from
illustrative agreement. Add reviewed tasks before using accuracy to justify
product integration.

The report includes each prediction, confidence, model returned by TypeSafe,
response time, token usage, and estimated provider cost. The default estimate
uses TypeSafe's [published list price](https://typesafe.ai/) observed on
2026-10-17: $0.042 per million input tokens and $0 per million output tokens.
Use `--input-usd-per-million` and `--output-usd-per-million` if your price differs.
The estimate is not a bill or a savings claim. Compare the same reviewed tasks
against a baseline classifier or human labeling before claiming an improvement.

The requests use TypeSafe's documented [System One endpoint](https://docs.typesafe.ai/api)
and [Choice primitive](https://docs.typesafe.ai/primitives/choice). The model is
`jev-latest` by default; use `--model` to pin a version for repeatable evaluation.
The caller should review the outbound descriptions because the API is remote.

Run the local checks without an API key:

```sh
node --test experiments/jev-task-profile/test.mjs
```
