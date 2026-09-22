# Real-repository benchmark

A fixed set of public TypeScript/JavaScript AI applications, pinned to exact
commits, with hand-labelled ground truth. It measures how the scanner and the
conformance engine behave on code nobody wrote for ANVILMARK.

It is **not** part of `pnpm test`: it needs the repositories and their
dependencies on disk, and fetching them uses the network.

## What is measured

| Measure           | Meaning                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detected          | A labelled AI call site appears as a `provider_call` observation (same file, start line within one line).                                                                              |
| Flagged           | Not observed, but an AI-related unknown sits at that site (unsupported SDK, unmodelled network hop, possible provider operation, or an unmodelled call into an AI package).            |
| Missed            | Neither.                                                                                                                                                                               |
| Provider identity | For detected calls whose label names a literal provider (for example Groq through the OpenAI SDK), whether the scan reports that provider.                                             |
| Unknowns          | Total unknowns in a zero-configuration scan, and how many relate to AI calls or declared data.                                                                                         |
| Scenario verdicts | Each scenario builds a small contract and scanner declarations, runs `anvilmark conformance`, and compares the verdict with the labelled expectation. A fail must cite the right file. |

Labels live in [`repos/`](repos/). Each repository file lists every call that
sends a request to an AI provider (`ai_calls`) and one or more `scenarios`
with the expected verdict and why.

A repository file may carry a `labels_note` when its labels were not written
blind (for example when the repository was added after a recognizer already
covered it); read it before treating that repository's recall as independent.

Scenario contracts carry a **synthetic approval** by the actor
`benchmark-synthetic-approver`. They are benchmark inputs, not project
decisions, and model versions are pinned to the exact strings the code uses.

## Corpus

| Repository                                                                                                      | Commit     | Why it is included                                                            |
| --------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| [openai/openai-responses-starter-app](https://github.com/openai/openai-responses-starter-app)                   | `0fae283f` | Responses API, file uploads, vector stores, a raw `fetch` to the OpenAI API   |
| [openai/openai-assistants-quickstart](https://github.com/openai/openai-assistants-quickstart)                   | `06fc2d44` | Assistants, threads and files APIs                                            |
| [openai/openai-realtime-agents](https://github.com/openai/openai-realtime-agents)                               | `94c9e911` | Responses proxy, realtime session over HTTPS, OpenAI Agents SDK               |
| [mckaywrigley/chatbot-ui](https://github.com/mckaywrigley/chatbot-ui)                                           | `81328b61` | Many providers, several through the OpenAI SDK with other base URLs           |
| [Azure-Samples/azure-search-openai-javascript](https://github.com/Azure-Samples/azure-search-openai-javascript) | `dc16d190` | Monorepo, Azure OpenAI through configuration, class-based services, LangChain |
| [tldraw/make-real](https://github.com/tldraw/make-real)                                                         | `928c4c41` | Vercel AI SDK with OpenAI, Anthropic and Google providers                     |
| [jakobhoeg/nextjs-ollama-llm-ui](https://github.com/jakobhoeg/nextjs-ollama-llm-ui)                             | `79c53f4a` | Vercel AI SDK with an Ollama provider and an environment-selected endpoint    |
| [Nutlope/llamacoder](https://github.com/Nutlope/llamacoder)                                                     | `75a3a78e` | Together SDK and raw `fetch` to the same provider, generated files, scripts   |

Full commit SHAs and install commands are in each `repos/*.json`. Nothing from
these repositories is copied into ANVILMARK; labels reference paths and lines
only.

## Run it

```bash
pnpm build
node scripts/real-repo-benchmark.mjs --corpus ../anvilmark-real-repos --fetch \
  --markdown benchmark.md --json benchmark.json
```

- `--corpus DIR` holds one clone per repository, named as in `repos/`
  (`ANVILMARK_REAL_REPO_CORPUS` also works).
- `--fetch` clones missing repositories at their pinned commit and installs
  dependencies with `--ignore-scripts`. Without it, the benchmark uses what is
  already there and skips anything absent, at another commit, or not installed.
- No repository code is ever run: dependency install scripts are disabled and
  ANVILMARK only reads files.
- `--repo NAME` limits the run; `--keep` keeps the temporary projects.
- `--baseline FILE` compares the run with a recorded JSON result and **exits 1
  on a regression**: fewer calls detected, fewer providers identified, fewer
  scenarios correct, any false pass or false fail, fewer labelled calls or
  scenarios, or a repository the baseline measured being skipped. That last one
  matters most: a corpus that failed to clone measures nothing, and nothing
  must never look like a clean run. It compares whole runs, so it refuses
  `--repo`.

## Results

Recorded runs are in [`results/`](results/), named by date and ANVILMARK
commit. A change to the scanner or conformance engine should be judged against
the latest recorded run: detection and verdict accuracy should not regress, and
false pass/compliant results are never acceptable.

Record **both** files for a run you keep — `--markdown` for people and `--json`
for `--baseline`. The newest `results/*.json` by filename is what CI compares
against, so a run recorded only as Markdown silently leaves the gate on an
older baseline.

## In CI

[`.github/workflows/real-repo-benchmark.yml`](../../.github/workflows/real-repo-benchmark.yml)
runs this on demand (Actions → Real-repository benchmark → Run workflow). It is
**manual only**: it clones eight repositories and installs their dependencies,
which is too slow and too network-dependent for every pull request, and the
corpus is too large to cache without crowding out the cache the ordinary CI run
uses. A run takes tens of minutes.

It compares against the newest recorded JSON result unless you name another one,
fails the job on any regression, writes the summary to the job summary and
uploads `benchmark.md` and `benchmark.json` as artifacts. Nothing from the
scanned repositories is uploaded, and no repository's code is ever run.
