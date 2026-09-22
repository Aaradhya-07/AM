# ANVILMARK playground handoff

Status: prepared for Emergent implementation. This branch supplies a scoped
brief and reproducible example data; it does not yet implement the playground.

Base: `04a35556325f47e627f6c2bfafd8bf7499c6cc2f` (M7 onboarding merged).
Work only on `codex/emergent-playground`; `main` stays at the reviewed baseline
until the UI is reviewed separately.

## Product direction

The intended web experience is an interactive workspace. A visitor should be
able to try Atlas, understand a decision, follow its evidence and examine what
changes between a failing, corrected and unknown implementation.

The [canonical brief](../../../ANVILMARK-CANONICAL-BRIEF.md) includes an optional
local web interface and later editable decisions/architecture. The current
[ratification](../../vnext/06-contract-ratification-decision.md#5-approval-boundary)
keeps the first web slice read-only, with approval in the local CLI. Interactive
navigation and recorded example selection fit that boundary. Authoritative
browser edits and approval need a subsequent design; this handoff does not
change the contract or approval rules.

| Stage                   | User experience                                                                                          | Scope now                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Example playground      | Explore Atlas decisions, evidence, architecture, source and recorded conformance outcomes in the browser | Emergent builds this first                                                          |
| Local project workspace | View outputs from the user's own local contract and checks                                               | Codex integrates after the example UI is reviewed                                   |
| Editable workspace      | Draft ideas/constraints, compare changes, intentionally request checks and review decisions              | Later scope; define persistence, local execution and approval before implementation |

The example playground can run in a preview using only committed synthetic
data. A remote browser cannot directly scan a visitor's local repository; that
requires a separately designed local connection or explicit data transfer.
No connection, real scan, live provider call or approval is simulated by the UI.

## Handoff files

- [BUILD-BRIEF.md](BUILD-BRIEF.md): implementation scope, first checkpoint and acceptance.
- [samples/atlas.json](samples/atlas.json): existing project facts, architecture
  and engine-generated conformance reports, plus the exact synthetic source
  referenced by each finding.
- [Sample exporter](../../../scripts/export-playground-samples.mjs): regenerates
  these examples from committed fixtures using the existing scanner and engine.

After the normal setup, reproduce the samples with:

```sh
node scripts/export-playground-samples.mjs --check
```

To intentionally refresh them, run the same command without `--check`, then
review the diff. It reads only fixed repository fixtures, uses a new temporary
workspace and deletes only that workspace. It neither accepts a project path
nor runs the application under analysis. It validates report/result hashes,
both-rule verdicts, source references, secret-shaped values and temporary-path
exclusion before writing the sample file.

## Data contract for the UI

`anvilmark-playground-samples/1` is a demonstration bundle, not a new authoritative
project schema or API. Its fields are:

- `contracts.draft.facts`: current `ProjectFacts` for the existing unapproved draft.
- `contracts.synthetic_approved.facts`: current `ProjectFacts` for the explicitly
  synthetic approved fixture. Neither object is writable approval authority.
- Each contract's `mermaid`: output from the existing context renderer.
- `scenarios`: violation, corrected and ambiguous. Each references the same
  synthetic approved contract and contains a validated `ConformanceReport`.
- Each scenario's `source_files`: repository-relative paths and exact synthetic
  source text. Finding locations can open these files at their recorded lines.
- `scan_declarations`: the source, sanitizer, sink and workload assumptions used
  for those reports. Redactor effectiveness is declared, not measured.
- `source` and `generated_as_of`: provenance and fixed evaluation time.

Project facts use `remote-default`; detailed reports/source are included only
because these are committed synthetic examples intended for display. Do not
generalize that inclusion into consent to upload a real project's local reports.
Never alter a report to make the UI show a desired verdict. The draft has no
conformance report: show “Not checked,” not a green empty result.

The wrapper's format, timestamp and provenance can be validated before display.
Keep report verdicts separate from freshness: a saved pass was evaluated at its
recorded time and is not a claim about current files. The static bundle cannot
prove a live workspace is fresh.

## Credit and review plan

The 100-credit allocation is a set of checkpoints, not a cost guarantee:
10 for integration/first screen, 40 for the remaining views, 20 for state handling,
10 for accessibility/visual refinement, 20 held for reviewed fixes. Use the
platform's budget control for the first 10-credit run; a prompt is not a billing
control. Save a commit and preview evidence before requesting another allocation.

Keep deployment outside this pass. Emergent's
[credit guide](https://help.emergent.sh/plans-and-credits) documents adjustable
run allocations and deployment charges; confirm charges in the account UI.
Its [GitHub guide](https://help.emergent.sh/github-integration) supports importing
an existing branch and saving changes there.

Codex reviews data semantics, source linkage, branch diff and relevant tests
before integration. This UI work does not close M7's real-project, actual-agent
or team usability acceptance requirements.

## Handoff verification — September 16, 2026

Core setup passed on the isolated branch with Node 24 and pnpm 11.16.0. The
exporter generated two failures, two passes and two unknowns under one unchanged
synthetic approved contract. A second run in a fresh temporary workspace
reproduced the sample file byte-for-byte. Report/result hashes and source
references validated, with no analysis errors. Exporter lint, handoff/sample
formatting and relative document links passed. No core implementation was
changed, no UI has been built yet, and no Emergent credits were consumed by this
preparation.
