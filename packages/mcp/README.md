# Anvilmark MCP servers

This package contains two separate stdio servers. Set up the core packages before
launching either:

```sh
node scripts/setup.mjs
```

Standard output carries MCP messages only; diagnostics go to standard error.

## Project server (Milestones 4–6, read-only)

`bin/anvilmark-project-mcp.mjs` (bin `anvilmark-project-mcp`) answers questions about
one ANVILMARK project from its `.anvilmark/project.yaml`:

| Tool                       | Arguments                                       |
| -------------------------- | ----------------------------------------------- |
| `get_project_summary`      | none                                            |
| `get_constraints`          | optional `workload`, `severity`, `domain`       |
| `get_workload_decision`    | required `workload`                             |
| `get_architecture_context` | optional `component` (a node id), `workload`    |
| `list_evidence_gaps`       | optional `workload`                             |
| `run_conformance`          | optional `workload`                             |
| `check_proposed_change`    | `files`, or both `workload` and `candidate_ref` |
| `get_conformance_result`   | required `result_id`                            |

- Every tool is annotated `readOnlyHint: true`. No tool writes, approves,
  records an exception, imports proposals, runs remote provider evaluations or
  generates files. Each call loads the contract afresh. The five context tools
  answer from shared facts; the three conformance tools can read source and
  scan it locally in memory. Saved scan/report metadata establishes input
  selection, not freshness. No report or scan is written by MCP.
- Conformance responses default to counts, rule IDs, verdicts and hashes,
  withholding source locations, traces, arbitrary explanations and diagnostics.
  `--projection local-disclosed` exposes full local evidence. Establish an
  unambiguous selection locally with `scan` or `conformance`; missing/obsolete
  artifacts cannot yield compliance. Candidate-only comparisons do not inspect
  files. Selected files must exist in the scanned source inventory; their checks
  retain full repository context and do not apply proposed diffs. See
  [conformance semantics](../conformance/README.md).
- Every default project response — including errors about arguments — carries the source
  marker (project, contract revision, state revision, contract hash, schema
  version, generator, projection, `as_of`) and the approval standing of the
  decisions it mentions. Only `approved_current` decisions are marked
  `instruction_eligible`.
- If the project cannot be answered, the response has `source: null` and a
  fixed, path-free error: `project_not_found`, `project_unreadable`,
  `project_invalid`, `projection_refused` or `internal_error`. Validation issue
  paths can contain private property names or dynamic keys, so no validation
  details enter the tool response. The directory, exception text and validation
  diagnostics stay on the server's standard error; run `anvilmark validate`
  locally for details.
- Architecture answers include origin, confirmation standing, effective trust
  boundaries and crossings, and declared interfaces. Unconfirmed agent-proposed
  architecture is `inferred`, with unknown effective conclusions; no tool can
  confirm it.
- An unknown workload, component, severity or domain, a missing required
  workload, an unknown argument or a mistyped value returns `isError: true`
  with a structured error. Context tools list safe valid values; conformance
  errors omit caller values and source-derived details. The advertised input
  schemas are strict (`additionalProperties: false`); enforcement is in the
  shared query layer so those errors carry the source marker too.
- Responses use the `remote-default` projection unless the server is started
  with `--projection local-disclosed`. A local server does not by itself
  authorize a client to send tool results to a remote model.
- `--as-of TIMESTAMP` fixes the evaluation instant; otherwise each call uses
  the current time and reports it as `as_of`.

The facts come from [`@anvilmark/context`](../context/README.md), the same
layer that renders `agent-context.md`.

### Optional hardware capabilities

The default server still advertises exactly eight tools. Startup flags add separate
read-only capabilities:

- `--hardware-sizing`: `get_hardware_model_catalog` and `estimate_hardware_fit`.
  These pure tools return standalone planning artifacts, not project verdicts or
  project source markers. A fixed `--as-of` makes identical requests reproducible.
- `--hardware-probe`: `probe_local_hardware` and `discover_local_model_inventory`.
  These tools run bounded local collectors or fixed loopback GET listings. They
  are annotated as open-world and non-idempotent because live inventory changes.
  They take no command, path, host, or URL arguments. SSH is CLI-only.

These capabilities cannot attach evidence or modify the project. Probe results
omit hostnames, usernames, serial numbers, and raw command output. Remote-default
projection also removes CPU model text, detailed diagnostics, and local model
names from discovery results. Local-disclosed returns the sanitized local listing.
Enabling a local collector is an explicit disclosure choice; merely running an MCP
server does not make every local fact suitable for a remote client.

### Claude Code

Replace `<ANVILMARK_REPO>` with this checkout and `<PROJECT_DIR>` with the
directory containing `.anvilmark/`:

```bash
claude mcp add --transport stdio anvilmark-project -- node <ANVILMARK_REPO>/packages/mcp/bin/anvilmark-project-mcp.mjs --project-dir <PROJECT_DIR>
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.anvilmark-project]
command = "node"
args = ["<ANVILMARK_REPO>/packages/mcp/bin/anvilmark-project-mcp.mjs", "--project-dir", "<PROJECT_DIR>"]
```

Both clients run the same command with the same arguments. These commands
change your client configuration; ANVILMARK does not edit client settings,
`AGENTS.md` or `CLAUDE.md`.

### Verification

```bash
pnpm --filter @anvilmark/mcp verify:project-tools
```

This builds a temporary Atlas project with the built CLI, starts the server,
and checks `initialize`, `tools/list`, a call to every tool, invalid filters,
byte-identical responses for two clients identifying as Claude Code and Codex,
JSON-RPC-only standard output, and an unchanged project tree. It is a
protocol-level check: no Claude Code or Codex application, model or network is
involved.

## Historical audit scaffold

`dist/index.js` (bin `anvilmark-mcp`) is the original scaffold on the
historical `@anvilmark/contract` `0.1.0` package. Its tools — `audit_system`,
`explain_finding`, `estimate_cost` — return **fixture data** from that package;
they do not audit a repository, read an ANVILMARK project contract or calculate
costs, and their types are not vNext project-contract types. It is kept
unchanged, and so are its original setup instructions:

```sh
claude mcp add --transport stdio anvilmark -- pnpm --filter @anvilmark/mcp start
```

Cursor (`.cursor/mcp.json`, replacing the repository path):

```json
{
  "mcpServers": {
    "anvilmark": {
      "command": "node",
      "args": ["/absolute/path/to/anvilmark/packages/mcp/dist/index.js"]
    }
  }
}
```

`pnpm verify:mcp` checks the scaffold's `tools/list`.
