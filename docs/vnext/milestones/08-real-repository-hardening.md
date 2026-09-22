# Real-repository hardening (post-Milestone 7)

Status: **Merged into `main` on September 18, 2026** at `c13bdac5`, on top of
`641f73e5`. This is not a planned milestone in
[`../04-vertical-slice-build-plan.md`](../04-vertical-slice-build-plan.md); it
is the work that followed from evaluating the merged M7 product against public
repositories nobody wrote for ANVILMARK.

## Why

Asked whether the product was complete and useful after M7, the honest answer
was no. Against seven cloned public repositories the merged `main` at
`04a3555`:

- reported one repository **COMPLIANT** when it was not — a `fetch` straight to
  `api.openai.com` that no recognizer saw;
- found **22 of 60** labelled AI call sites;
- got provider identity right **6 of 10** times (an OpenAI client with another
  base URL was reported as OpenAI);
- reached a usable verdict in **3 of 11** scenarios; the rest were `unknown`
  because any uncertainty anywhere blocked the answer.

A product that says COMPLIANT when it cannot see the call is worse than one
that says nothing.

## What changed

| Area               | Change                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity           | A call's provider is its **endpoint**, not its SDK: literal base URLs map to providers by host, Azure deployments are distinguished, and `fetch` to a known provider host is a provider call.                    |
| Coverage           | Recognizers for Anthropic, the Vercel AI SDK and its provider factories, Together, and every resource method of the OpenAI-shaped SDKs. Operation kinds (`inference`, `embedding`, `data_upload`, `management`). |
| Reachable verdicts | A rule's evaluation takes the unknowns in its workload's scope plus repository-wide reasons that could hide a call anywhere; the rest are caveats. Declared `models:`/`providers:` on a sink are T1 evidence.    |
| Adoption           | `anvilmark inventory` (no project needed), `anvilmark scan draft-config`, `anvilmark rule`.                                                                                                                      |
| Performance        | The flow analysis no longer rebuilds values it already has: a 205-file repository went from **229s to about 5s**, with identical results.                                                                        |
| Evidence           | [`benchmarks/real-repos/`](../../../benchmarks/real-repos/README.md): eight repositories at pinned commits, hand-read labels, recorded runs, and a manual CI job that fails on a regression.                     |

## Measured

Against the benchmark corpus (eight repositories, 71 labelled call sites):

| Measure                 | `04a3555` (before) | `c13bdac5` (now) |
| ----------------------- | -----------------: | ---------------: |
| Call sites detected     |              22/60 |            67/71 |
| Provider identity       |               6/10 |            54/54 |
| Scenario verdicts       |               3/11 |            17/18 |
| False pass / false fail |              0 / 2 |            0 / 0 |

The recorded run is
[`results/2026-09-18-66f31d77.md`](../../../benchmarks/real-repos/results/2026-09-18-66f31d77.md),
with its JSON beside it as the CI baseline. Verified in a clean checkout:
frozen install, build, lint, format check, **1,561 tests**, `verify:mcp` and
`verify:mcp-project`.

## What this does not claim

- The corpus is eight TypeScript repositories. It is evidence about them, not
  about repositories in general, and llamacoder's labels were not written blind
  (see its `labels_note`).
- Scenario contracts carry **synthetic approvals** by `benchmark-synthetic-approver`.
  No real decision was approved, and the definition of prototype complete in
  the build plan — one recorded decision through every stage, with a real human
  approval — remains open.
- A `pass` is still bounded by the declarations, the supported operations and
  the stated assumptions.

## What remains

- **Coverage.** `@google/generative-ai` binds its model when the client makes a
  model object and calls it later; carrying that needs a "model bound at client
  construction" concept the recognizer model does not have. The OpenAI Agents
  SDK has the same shape. TypeScript and JavaScript only: a Python service is
  invisible.
- **Signal.** A zero-configuration scan still records thousands of unknowns
  (2,778 in chatbot-ui); only the AI-related ones are surfaced. One unresolved
  import anywhere still blocks `pass` for every workload in that repository.
- **Reach.** Every package is `private: true` and unpublished, so the inventory
  command — the one that shows value with no setup — can only be run from a
  built checkout.
- **The decision half** of the product is still exercised only by synthetic
  fixtures.
- The manual benchmark workflow has not yet been run in GitHub Actions.
