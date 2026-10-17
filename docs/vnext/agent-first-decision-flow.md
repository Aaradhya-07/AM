# Agent-first decision flow (proposal)

Status: product proposal, 2026-10-14. The opt-in MCP path now records one
workload, source-cited proposed constraints, open questions, and unverified
candidate suggestions. It can fetch published evaluations for exact Hugging
Face model IDs into the local catalog and compare candidates against the same
contract with explicit unknowns and evidence gaps. The agent must submit exact
excerpts, structured claims, and candidate identities. ADR discovery,
semantic conflict extraction, broader catalog mapping, architecture proposals,
and local human review remain proposed work.

## Product promise

The person begins in the coding agent they already use. They describe an idea or
ask the agent to inspect a repository. Anvilmark is the agent's decision and
verification service: it turns the conversation and cited project material into
structured options, checks claims against evidence and constraints, presents one
reviewable decision, and later checks the implementation. The local runtime and
contract files are implementation details. The person should not transfer JSON
between a website, CLI, and MCP client.

The agent supplies open-ended interpretation and proposed architecture. Anvilmark
owns source identity, dated evidence, deterministic constraint checks, decision
history, human sign-off, and bounded conformance. Neither a model catalog nor an
agent-generated explanation alone can establish that an option meets a workload's
quality threshold.

## One continuous conversation

1. **Prompt and context.** The person says, for example, “Classify incoming
   support tickets. Customer data must stay local. Inspect this repository and
   its ADRs.” The agent reads the relevant files and calls Anvilmark with the
   prompt, repository root, and cited findings. Anvilmark also identifies an
   existing `.anvilmark/project.yaml` when present. An ADR is treated as a
   sourced prior decision; its scope, date, and current standing are checked.
   A conflict between the prompt, an ADR, and the current contract becomes a
   question for the person. The agent cannot silently turn an ADR into a new
   binding rule.
2. **Decision brief.** The agent proposes the workload, data classifications,
   quality target, usage, budget, latency, deployment limits, and open questions.
   Anvilmark validates this draft and labels every field as user stated, quoted
   from a repository source, measured, inferred, or unknown. The person answers
   only questions that can change the comparison.
3. **Option search.** A maintained catalog supplies exact model and deployment
   identities, capabilities, license and region facts, pricing, hardware needs,
   source URLs, retrieval times, and confidence limits. Hard conflicts eliminate
   options. Missing facts leave an option unknown; they do not count as passes.
   Task quality needs matching evaluation cases or a clearly conditional result.
4. **Architecture choices.** The agent proposes a small set of linked decisions:
   where raw data flows, where preprocessing happens, where inference runs, what
   persists, and what fallback exists. Anvilmark checks the graph, data
   boundaries, candidate compatibility, and declared constraints. It asks for
   evidence where a claim cannot be checked. The architecture view is rendered
   from these decisions rather than invented separately.
5. **Human review.** The agent asks Anvilmark to prepare a review. A local review
   surface shows the exact proposed decision, alternatives, constraints,
   evidence, unresolved risks, and the content hash. The person accepts or
   revises it there. The MCP tool may prepare and open the review, but it cannot
   perform the final sign-off. The signed decision is written to the same
   project contract the agent and checker read.
6. **Build and check.** The agent receives the current decision through MCP and
   implements it. Anvilmark scans the change and reports pass, fail, or unknown
   with supported scope and source evidence. A new requirement, changed ADR,
   expired evidence, or changed implementation reopens only affected decisions.

## Example: support-ticket classifier

The repository contains an ADR saying raw tickets cannot leave the local trust
boundary. The user's prompt repeats that restriction and asks for low operating
cost. The agent identifies two paths: local inference, or local redaction
followed by a managed API. Directly sending raw tickets to that API fails the
data-boundary check. Local inference remains conditional on hardware fit and
task quality. The redaction path remains conditional until a measured redaction
test demonstrates the required protection. A price table can estimate cost; it
cannot settle either quality condition. The review shows these standings and
asks the person to choose or supply the missing evaluation. After sign-off,
the agent implements the chosen path and Anvilmark checks the declared provider
and data flow in source.

## MCP boundary to build

The project MCP has eight default read-only context and conformance tools. The
opt-in assessment path implements draft intake and option comparison. The full
agent workflow needs these capabilities:

| Capability                   | Input                                                 | Output and authority                                                     |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Open assessment              | User prompt, project root, cited repository/ADR paths | Draft brief and source-linked conflicts; no binding decision             |
| Refine brief                 | Structured workload and constraint proposals          | Validated draft and questions that matter to the comparison              |
| Compare options              | Workload, candidates, evidence snapshot               | Constraint standings, quality/cost assumptions, gaps; no invented winner |
| Check architecture proposal  | Nodes, data flows, linked choices                     | Graph and policy findings, including unknowns                            |
| Prepare review               | Exact proposed decision revision                      | Local human review link and hash; no sign-off tool                       |
| Read decision and check code | Current contract and repository state                 | Agent instructions and bounded conformance results                       |

Draft-writing tools must never mutate an accepted decision. Repository text is
untrusted input, including ADR prose and code comments. Tool results must retain
source paths and hashes locally and apply the existing remote projection rules
before content goes to a remote agent. Provider credentials remain outside the
contract and MCP responses.

## First acceptance test

Use one real support-ticket classification project with one existing ADR and two
different model/deployment paths. In a single agent conversation, capture the
prompt and ADR, produce a brief, compare options using dated evidence and
matching task examples, show an explicit unknown where evidence is missing,
complete human review, hand the decision back to the agent, then detect and
correct one source-level violation. Record every manual transfer and setup step;
the target is zero transfers of project data between product interfaces.

Implementation should reuse the current contract, comparison, evidence, and
conformance packages. The next work is source-backed candidate mapping,
architecture checks, and local human review within this agent path.
