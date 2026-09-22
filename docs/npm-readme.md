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
anvilmark init           # create .anvilmark/ in your project
anvilmark scan draft-config > .anvilmark/scanner.yaml   # draft the declarations
anvilmark scan           # observations, data flows, unknowns; no verdicts
anvilmark conformance    # deterministic pass / fail / unknown with evidence
```

A verdict is `unknown` whenever the evidence cannot settle it. That is the
point: a scanner that cannot see a call must not report it as compliant.

## Hardware sizing

```bash
anvilmark hardware probe --json      # bounded local inventory, read-only
anvilmark hardware recommend --file scenario.json
```

Exact integer-byte memory arithmetic over pinned model metadata, with every
unbudgeted component left explicitly unknown rather than assumed.

## MCP

Two read-only MCP servers ship with the package: `anvilmark-project-mcp`
(project context and conformance for your agent) and `anvilmark-mcp`. Sizing
and local-probe tools are opt-in startup flags.

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
