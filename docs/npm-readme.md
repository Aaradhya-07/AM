# ANVILMARK

Local-first decision and conformance contracts for AI systems.

Nothing here sends your code anywhere. Every command reads your repository
with the TypeScript compiler and writes only where you ask it to.

## What AI does this repository use?

```bash
npx anvilmark inventory ./my-app
```

No project, contract or configuration needed. It reports where requests go
(provider, host, operation kind), the models named, every recognized call
site, the AI SDKs it has no recognizer for — whose calls it therefore cannot
inventory — your AI dependencies, the environment variable **names** read
where those SDKs are used, and what stayed uncertain.

`--markdown` produces a report for a pull request; `--json` gives the whole
inventory. The command writes nothing.

It states what was recognized. It is not proof that nothing else reaches an AI
provider, and it is not a conformance result.

## Checking code against a decision

The inventory is the zero-configuration half. The rest of the workflow records
a decision — the models and providers a workload is approved to use, and the
data that may never leave — and then checks an implementation against it:

```bash
anvilmark start          # inventory this repository, then create a local draft
anvilmark scan draft-config > .anvilmark/scanner.yaml   # draft the declarations
anvilmark scan           # observations, data flows, unknowns; no verdicts
anvilmark conformance    # deterministic pass / fail / unknown with evidence
```

In a terminal, `start` asks for one application description. For unattended
use, pass `--idea "What this app does"`; without it, plain `start` stays read-only.
It does not infer requirements or approve a decision from repository code.
Run `anvilmark start --connect-codex` to add this repository's project MCP
server to Codex's `.codex/config.toml`. Trust the project and restart Codex;
draft-writing tools are configured to prompt for approval. Reconnect after
moving the repository or package installation because the file uses local
absolute paths.

A verdict is `unknown` whenever the evidence cannot settle it. That is the
point: a scanner that cannot see a call must not report it as compliant.

## Hardware sizing

```bash
anvilmark hardware probe --json      # bounded local inventory, read-only
anvilmark hardware recommend --file scenario.json
```

Exact integer-byte memory arithmetic over pinned model metadata, with every
unbudgeted component left explicitly unknown rather than assumed.

## Model research

```bash
anvilmark quality benchmarks --search SWE-bench
anvilmark quality leaderboard SWE-bench/SWE-bench_Verified --limit 10
anvilmark quality model openai/gpt-oss-20b
```

These commands fetch public Hugging Face benchmark results with source links,
verification flags, and retrieval dates. `quality catalog` can fetch the
Artificial Analysis Free language-model catalog with an
`ARTIFICIAL_ANALYSIS_API_KEY`; its data is for internal use with attribution.
Use `quality cache --help` for an optional local SQLite history on Node 24.
Public scores help research candidates; a project's hard quality gate still
needs a matching measured evaluation.

## MCP

The package ships `anvilmark-project-mcp` (project context and conformance)
and `anvilmark-mcp` (historical scaffold). The project server's default tools
are read-only. `--agent-assessment` enables cited draft tools; sizing and
local-probe tools are separate opt-in startup flags.

## Scope and limits

- TypeScript and JavaScript only.
- Recognizers cover the OpenAI, Anthropic, Together and Ollama SDKs, the
  Vercel AI SDK with its provider factories, and `fetch` to known provider
  hosts. Other AI SDKs are reported as unsupported, never silently ignored.
- Measured against eight public repositories with hand-read labels; the
  corpus, the method and the recorded runs are in the repository under
  `benchmarks/real-repos/`.

Source, issues and the full documentation:
<https://github.com/N6118/ANVILMARK>

Apache-2.0.
