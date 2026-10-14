# Model quality sources and decision catalog

Date: 2026-10-14  
Status: Live source commands and manual local SQLite cache available; scheduled polling and requirement mapping proposed

## Purpose

Anvilmark needs current, attributable model data when it compares a project’s
candidates against its workload, restrictions and architecture. A published
benchmark score is one input to that decision. The decision also needs exact
model and deployment identity, pricing, licensing, provider capabilities,
hardware fit, and an evaluation on the actual workload when quality is a hard
gate. Missing or stale facts must remain visible as unknowns.

## Available now

`anvilmark quality` fetches source data on request:

| Command                                 | Result                                                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `quality benchmarks`                    | Discover datasets tagged `benchmark:official`.                                                                                         |
| `quality leaderboard PUBLISHER/DATASET` | Fetch submitted scores for that benchmark, including rank, score, model ID, verification flag, score direction and available source.   |
| `quality model PUBLISHER/MODEL`         | Fetch published evaluation results associated with a Hub model, including benchmark, task, score, date and available source.           |
| `quality catalog`                       | Fetch tracked language models from the Artificial Analysis Free API, including identity, indices, median performance and token prices. |

Text output defaults to 20 rows. `--all` expands text output; `--json` returns
all matching records with retrieval time, source URL, SHA-256 response hash and
the leaderboard ETag where available. `--search` filters benchmark IDs,
leaderboard model IDs, or catalog model names, slugs and creators. These
commands are read-only and need no Anvilmark project. The Hugging Face
commands need no key; `catalog` reads `ARTIFICIAL_ANALYSIS_API_KEY` from the
environment. Each direct command fetches the source again. It does not write
the local cache unless `quality cache refresh` is run separately.

The endpoints and fields follow the [Hugging Face leaderboard data
guide](https://huggingface.co/docs/hub/leaderboard-data-guide). Hugging Face
also publishes [pre-aggregated cross-benchmark data](https://huggingface.co/datasets/OpenEvals/leaderboard-data),
which may be useful for later bulk ingestion. Discovery of an official
benchmark does **not** mean each submitted score is verified.

This feed covers models that appear in the selected benchmark or publish Hub
evaluation results. It is not a complete inventory of commercial, open-weight,
or locally deployed models. It does not establish task-specific quality or
provider, region, license, and price suitability. There is no universal ranking
from these rows. A Hugging Face submission is not the contract's
`measured_evaluation` for a project workload, even if the public submission is
marked verified.

The Artificial Analysis connector uses its documented
[`/api/v2/language/models/free` endpoint](https://artificialanalysis.ai/data-api/docs).
It paginates the Free-shape response and records the source, retrieval time,
response hash, index version, page count and attribution. The CLI prints model
name, creator, slug, headline indices and prices; JSON also contains the six
capability indices and median performance fields. Null means unavailable. The
feed contains models Artificial Analysis tracks; it does not claim to cover
every model. Individual benchmark scores, context window, licensing and
provider detail are outside this Free response. Its aggregated prices are
research context; `official_pricing` contract evidence needs the serving
provider's official pricing for the exact model, endpoint, region and date.

The [Artificial Analysis access terms](https://artificialanalysis.ai/data-api)
describe Free API use as internal only with attribution and no redistribution.
The current CLI displays attribution and marks usage rights in JSON. A public
website or customer-facing catalog needs appropriate redistribution rights
before it can display these data.

### Local cache available now

`@anvilmark/model-catalog` stores fetched source snapshots in a local SQLite
file. `quality cache refresh KIND [ID] --db FILE` fetches one of the four source
kinds above and appends its snapshot and normalized observations. `quality cache
show KIND [ID] --db FILE` reads the latest saved snapshot; `quality cache
history KIND [ID] --db FILE` reads earlier snapshots. For `leaderboard` and
`model`, `ID` is the benchmark or Hub model ID. `show` and `history` can run
offline after a refresh. Opening the store requires Node.js 24 or newer.

The store retains source URL, fetch time, response hash, original normalized
adapter result, observations, and Artificial Analysis attribution and usage
rights. Reads label a snapshot `fresh` or `stale` under a 24-hour default age;
`--max-age-hours N` changes that display threshold. A stale result remains
visible with its age. Snapshot history is append-only, including empty results.
The API key is not stored. Model identities remain scoped to their source: the
store does not merge Hugging Face IDs with Artificial Analysis IDs from name
similarity. The package and command are documented in the [local catalog
README](../../packages/model-catalog/README.md).

## Why extend the local catalog

Direct API calls are the quickest way to inspect one source and preserve its
original meaning. The local catalog now provides snapshots and offline reads.
For repeated contract comparisons, a maintained, **normalized read catalog**
with source polling and identity review would support consistent decisions
across the website, CLI and MCP. The upstream source and exact retrieval remain
the evidence, and the user’s contract remains the authority for requirements
and approval.

| Approach            | Useful for                                                                      | Limit                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Live source queries | A fresh look at one model or benchmark; an auditable first integration.         | Several APIs and naming schemes would otherwise be queried during every comparison; rate limits and outages affect the user. |
| Manual local cache  | Offline reading, source history, and explicit freshness on a developer machine. | Refresh is manual, and identities remain source-scoped. Cached data cannot prove a workload gate.                            |
| Scheduled catalog   | Regular ingestion and faster shared decisions across website, CLI and MCP.      | Requires polling operations, source rights, identity review and stale-data rules.                                            |
| Project evaluation  | Deciding whether a candidate meets a specific quality, latency or runtime gate. | Needs representative cases, exact configuration and execution access.                                                        |

The local cache already retains snapshots, fetch time, hashes and normalized
observations. Scheduled polling remains to be built. Poll at a cadence
appropriate to each source’s update rate and quota, retain source versions or
ETags and errors where available, and refresh on demand for a decision needing
newer information.
An outage should leave the last snapshot clearly marked stale, never silently
make it current. Conditional requests and bulk feeds can reduce unnecessary
fetches where sources support them. A hard quality gate stays unknown until a
matching measured evaluation is recorded under the project contract’s
[evidence rules](../../packages/project-contract/src/evidence-tiers.ts).

### Project boundary for the stored catalog

Catalog ingestion and normalization now sit in the separate
`@anvilmark/model-catalog` package **within this monorepo**. Its local SQLite
store and read API serve the CLI. Source polling, identity mapping and contract
integration can evolve there without changing contract or comparison
semantics. A hosted Postgres store and polling worker can later serve website
and MCP access through the same read interface, subject to source licenses.
The code can remain in this monorepo even if the runtime is a separate service.
A separate repository is useful only if ownership, release cadence or
operations require independent lifecycle management. No hosted store or worker
is implemented yet.

## Proposed richer normalized records

The local store already emits source-scoped benchmark, score, model evaluation,
and model profile observations linked to a saved snapshot. The next model
record should distinguish **base model**, **exact release or
revision**, **serving provider and endpoint**, and **deployment configuration**;
these are not always interchangeable candidates. A benchmark result needs its
benchmark version, task, metric, direction, value, evaluation date,
verification status, submitter or evaluator, and source link. Capability,
license, pricing, context, region, and hardware records need their own source,
scope, observed date and expiry or refresh policy.

Requirement mapping should be explicit and reviewable:

1. Read workload tasks, output format, quality metric and constraints from the
   existing contract.
2. Filter candidate configurations on hard restrictions using evidence of the
   right kind and scope; leave unsupported facts `unknown`.
3. Show relevant benchmark observations as discovery signals, with their
   exact metric and verification state. Do not average unlike scores into a
   universal quality number.
4. Run the project’s evaluation set against viable exact candidates to settle
   workload-specific quality gates; record model revision, prompt, dataset,
   evaluator and run time.
5. Present the evidence and unresolved gaps for human review of the decision.

Identity matching across sources should keep aliases and confidence or manual
review status. Similar names are insufficient proof that two entries share the
same weights, provider behavior or revision. Source disagreements should appear
as separate observations until resolved.

## Delivery sequence

1. Keep the current Hugging Face and Artificial Analysis commands as
   transparent source research paths and verify them on representative data.
2. Add scheduled polling, change detection and refresh policies to the local
   catalog boundary. Any shared hosted deployment needs source rights and an
   operational plan.
3. Review cross-source model identity and link catalog observations to
   contract candidates and constraints, then add
   project-specific evaluation runs. Expose the same decision facts to CLI,
   website and MCP rather than maintaining separate verdict logic.

Coverage should be reported by source, model family and date. “All models” is
an open-ended aspiration: a model without reliable source data must stay
discoverable as a candidate with evidence gaps, not disappear or inherit a
score from a similarly named model.
