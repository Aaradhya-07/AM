# Website and MCP product path

Date: 2026-10-07  
Status: Interface exploration only; not the active work phase or an approved product decision

## A possible later interface shape

After the core workflow has been validated on a real project, one possible delivery shape is **one product workflow with two interfaces**:

- **Website for people:** create and review the project, compare evidence and alternatives, approve decisions, and inspect conformance.
- **MCP for coding agents:** read the same approved contract and current conformance facts, then help implement or correct the application.
- **Local companion for repository access:** store `.anvilmark/` state and run scans/checks on the user's machine. The CLI remains its scriptable interface and can start the local web experience later.

The contract is the authority. Website views, generated diagrams, MCP responses, and optional cloud telemetry are projections of it. Anvilmark does not provide an intelligence model or require source upload to a hosted service.

## What the repository provides today

1. The CLI owns the complete local idea-to-contract and check workflow, including interactive approval.
2. The project MCP server exposes read-only context and conformance tools for a local project.
3. Studio verifies and displays an exported review bundle in browser memory. The user must export and load it; Studio does not operate on a live local project or edit its contract.
4. The playground demonstrates bounded Atlas code checks and hardware sizing.
5. The dashboard has optional Supabase project records and a telemetry feed. Creating a record does not scan the repository or load its `.anvilmark/` contract. CLI `push` sends a summary supplied from local files; the hosted API does not run conformance.

## First implementation slice

Run the existing Next website **locally** as the initial project interface. Its server can use the same on-disk project state as the CLI and MCP, without a browser file upload or a hosted server reading the repository. This is the shortest route to a working website plus MCP flow. A hosted website can later connect to a separate, explicitly paired local companion; that protocol is not part of the first slice.

The first website page should:

1. Open an explicitly selected local Anvilmark project path.
2. Read and display project identity, revision, approval standing, workloads, decisions, evidence gaps, and architecture view from the current contract.
3. Run or refresh the bounded repository scan and conformance check through the existing local engine, showing `pass`, `fail`, and `unknown` with scope and source links.
4. Indicate when displayed results are stale relative to project or repository inputs.
5. Give the user the MCP launch instructions for that same project root.

This first page is a read/check surface. Contract editing and approval remain in the local CLI until a website action can preserve the same validation, human confirmation, revision hashing, and atomic storage behavior. The page must identify fixture/sample content as such. No cloud account is required.

**Acceptance gate:** start a local website against one project; observe the same revision and rule verdicts in the website, CLI, and project MCP; modify a relevant source file; refresh and see the verdict or freshness change; leave project files unchanged by read-only views. Use a real repository and record exact commands and versions.

## Claims to correct before relying on the dashboard

| Current behavior | Why it matters | Required change |
| --- | --- | --- |
| New dashboard projects initialize as `verified` with six boundaries and `origin/HEAD` even before a scan. | The UI presents placeholder values as verification facts. | Start at `not_checked` or an equivalent explicit state; derive counts and commits from actual local reports. |
| The dashboard describes connected repositories, private contracts, and live CI monitoring, but registration stores project metadata only. | Users may infer their repository was inspected. | Label the current page as metadata/telemetry, or connect it to real local verification. |
| The runs API accepts a caller-provided pass/fail/warn result and returns a simulated success for non-UUID project IDs. | A received event is not evidence that Anvilmark ran a check or persisted it. | Distinguish reported telemetry from verified runs; remove or visibly label simulation in production paths. |
| CLI `push` maps every non-compliant summary to `fail`. | `unknown` or missing evidence can appear as a proven failure. | Preserve separate pass/fail/unknown standing in the transmitted schema. |
| The existing start page instructs users to run the CLI and load an exported Studio bundle. | The website is a viewer after manual transfer, not the main workflow. | Implement the local project page above, then make onboarding point to it. |

## Technical boundaries for the first slice

- Reuse `@anvilmark/project-contract`, scanner, conformance, and existing CLI storage/check functions; do not create a parallel contract or verdict implementation in the website.
- Bind the local website process to loopback and make the selected project path explicit. Do not let a remotely deployed instance read arbitrary server paths.
- Keep approval interactive and human-operated. Do not expose a write or approval MCP tool.
- Use the existing conformance terminology: `unknown` is distinct from `fail`, and a bounded `pass` is not proof of all runtime behavior.
- Keep optional hosted sync separate from the local acceptance gate.

## Later slices

1. Website editing and approval using the existing contract transaction and approval rules.
2. In-website evidence import, candidate comparison, and agent handoff.
3. Hosted website to local companion pairing if an online website is required for the complete workflow.
4. Optional team/cloud views with accurate provenance and telemetry semantics.
