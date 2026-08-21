# ANVILMARK Contract Ratification — Recommended Answers

Date: **August 19, 2026**
Status: **Reviewed reasoning record; superseded as standing guidance by [`06-contract-ratification-decision.md`](06-contract-ratification-decision.md)**
Answers: the ten questions in [`03-decision-contract-proposal.md`](03-decision-contract-proposal.md) §19
Blocks: Milestone 0 in [`04-vertical-slice-build-plan.md`](04-vertical-slice-build-plan.md)

> **Reviewed with amendments.** The accepted engineering baseline and four corrections are recorded in [`06-contract-ratification-decision.md`](06-contract-ratification-decision.md). This document remains the reasoning record, not the final standing.

Each answer gives a recommendation, the reasoning, and **what would change it**. The last part matters most: a ratification that cannot be overturned by evidence is a preference, not a decision.

These are proposals for the three developers to accept, amend, or reject. Nothing here is ratified by having been written down.

## Summary

| #   | Question                       | Recommendation                                                                                |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------- |
| 1   | Workload as the decision unit  | **Yes**, but `decision.scope` becomes a union: workload, component, or project                |
| 2   | Three severities sufficient    | **Yes.** Do not add a fourth; add `direction` to soft constraints instead                     |
| 3   | Version `0.2.0` or new name    | **New package, new schema line.** `0.2.0` implies a migration that cannot exist               |
| 4   | FINOS CALM as base or export   | **Export only.** ANVILMARK's contract stays authoritative                                     |
| 5   | What constitutes approval      | CLI-only command over a **resolved content hash**; never an MCP tool; web read-only           |
| 6   | Evidence kinds per constraint  | Four-tier evidence ladder with a per-domain floor; below the floor is `unknown`, not `pass`   |
| 7   | First two repository languages | **One, not two.** TypeScript + JavaScript via the TS compiler API; Python is the first plugin |
| 8   | promptfoo and llmfit           | **Optional subprocess adapters.** Never libraries, never reimplemented                        |
| 9   | Fields safe for remote         | Default-allow the decision layer; default-deny anything naming the machine or the code        |
| 10  | Minimum data-flow analysis     | Provider allowlist carries the slice; taint analysis is the honest partial second signal      |

---

## 1. Is the workload the correct unit of model/deployment choice?

**Recommendation: yes for model and deployment choice, but the workload cannot be the only scope a decision may have.**

The Atlas benchmark settles the core question by itself. Its six workloads differ in input data classification (raw versus redacted), latency budget (1s versus 5s), and quality metric (recall, macro-F1, citation validity). No single `best_model` field can express that, which is what §7 of the proposal already asserts.

The gap is that not every decision is a workload decision. "Ollama is the local runtime" is shared infrastructure. "The vector store is X" is not a model choice at all. The draft only shows `scope: {workload_ref}`, which forces these into a workload that does not own them.

Two observations from [`fixtures/atlas-project.draft.yaml`](fixtures/atlas-project.draft.yaml) support this:

- `quality_evaluation` is a degenerate workload. It has `calls_per_month: null`, `quality_gates: []`, and an output contract of `evaluation_result`. It is a process, not a workload with usage and cost.
- `retrieval` has empty quality gates and no latency, and its real decision is a vector store plus an embedding model — two components, not one model choice.

**Changes to make:**

- `decision.scope` becomes a discriminated union: `{workload_ref}` | `{component_ref}` | `{project_wide: true}`.
- Remove `quality_evaluation` from `workloads`. Evaluations are first-class records under `.anvilmark/evaluations/`, which §2 already anticipates.
- Keep `retrieval` as a workload, but let its two component decisions attach by `component_kind`, which candidates already carry.

**What would change this:** if the CALM spike or the first real elicitation pass shows that component-scoped decisions never need constraint results or evidence of their own, collapse them back into workloads and keep the single scope.

---

## 2. Are hard, soft, and informational constraints sufficient for the first slice?

**Recommendation: yes. Do not add a fourth severity. Add an optimization direction to soft constraints instead.**

Three severities are sufficient because they answer the only question severity should answer: may a violating candidate be approved? Hard means no without a recorded exception; soft means it trades off; informational means it is recorded and not scored.

The pressure the team will feel to add a fourth severity is really a missing field. §6 says a soft constraint "contributes to comparison," and §9 says ANVILMARK "should not collapse all dimensions into a single unexplained score." Together those leave the contribution undefined. If `budget.ai_monthly` is soft at ≤ $750, and candidate A costs $600 while B costs $700, both pass and nothing says A is preferred. Every implementer will then invent a scoring rule privately, which is exactly the unexplained score §9 forbids.

**Changes to make:**

- Soft constraints gain `direction: minimize | maximize | target`, so "under budget, cheaper is better" is expressible without a hidden weight.
- The project gains an explicit ordered `priority_order`, for example `[privacy, quality, availability, cost, latency]`, supplied by the user rather than assumed. Ordering is not weighting; it does not collapse dimensions, it breaks ties and documents whose preference it was.
- Exceptions stay as specified: constraint ref, decision ref, approving user, reason, and expiry. An expired exception makes the constraint result `unknown`, not `pass`.

**What would change this:** if elicitation produces constraints that are genuinely conditional ("hard only in production"), that is an argument for a `condition` field, still not a fourth severity.

---

## 3. Should `0.2.0` be the new version, or a separate package/schema name?

**Recommendation: a separate package with its own schema line. Do not call it `0.2.0`.**

`0.1.0` and the proposed contract are not the same artifact at two versions. `0.1.0` is a cost-audit result contract: `AuditInput`, `AuditResult`, `Finding`, `savingsMonthlyUsd`, and the categories `model-choice`, `self-host`, `token-efficiency`. The new contract is a project decision object. There is no document conforming to `0.1.0` that can be migrated to the new schema, because they describe different things.

Semver's contract is continuity. Publishing `0.2.0` promises a migration path that no one can write, and invites someone to try in six months.

**Changes to make:**

- Add `packages/project-contract` exporting `PROJECT_SCHEMA_VERSION`. Leave `packages/contract` and `SCHEMA_VERSION = "0.1.0"` untouched, as the brief §12 requires.
- Keep the schema URL exactly as drafted: `https://anvilmark.dev/schemas/project/0.2.0-draft.1`. The URL already namespaces under `/project/`, so it does not collide with the audit contract and needs no edit. The version string lives inside the project namespace and is its own line, unrelated to the audit contract's `0.1.0`.
- Record in [`README.md`](../../README.md) which package is live and which is historical. Do not rename `@anvilmark/contract`; renaming would churn three dead-scaffold packages for no gain.

This is deliberately the minimum-churn option: one new package, no edits to `03` or the fixture, and the ambiguity removed at the package level where it actually causes harm.

**What would change this:** nothing short of discovering that a real `0.1.0` document exists somewhere that must be carried forward. None does; the only instances are the three fixtures.

---

## 4. Can FINOS CALM represent the architecture, or should ANVILMARK only export to it?

**Recommendation: export only. The ANVILMARK contract stays authoritative, and CALM is a generated view with the same standing as Mermaid.**

Adopting CALM as the base is tempting for the right reasons — it is neutral, standards-backed, and ArchRails already enforces it, so interop is a real integration path. §1.8 also prefers compatibility to reinvention.

It is still the wrong choice for the first slice:

- **The two models are orthogonal.** CALM describes architecture: nodes, relationships, interfaces, controls, metadata. ANVILMARK's core is per-workload decisions with evidence, economics, and approvals. Making CALM authoritative forces workloads, candidates, quality gates, evidence provenance, and approval hashes into CALM metadata — which is precisely the "without distorting them" risk §12 names.
- **It makes the documented failure mode more likely.** [`04-vertical-slice-build-plan.md`](04-vertical-slice-build-plan.md) lists a stop trigger: pause if "the contract becomes a thin copy of Archcore or CALM without additional evidence/decision semantics." Adopting CALM as the base moves toward that trigger, not away from it.
- **Authority creates version coupling.** If CALM is the source of truth, an upstream spec revision is a breaking change to ANVILMARK's core. As an export target, the same revision is an adapter fix.
- **It would be the only inconsistent case.** §1.7 says views are generated. Mermaid is generated, agent context is generated, reports are generated. CALM should not be the single exception that is also an input.

**Changes to make:**

- In the architecture block, `source: ./architecture/calm.json` becomes `generated: ./architecture/calm.json`. Architecture nodes and relationships live in the contract; CALM is emitted from them.
- ANVILMARK owns the node ID space. `decision_bindings` reference ANVILMARK node IDs, and the exporter maps them into CALM IDs deterministically so round-tripping is stable.
- Keep the CALM export in slice 1 anyway, even though it is not authoritative. It is the cheapest proof of neutrality and the natural handoff to ArchRails-style enforcement.

**What would change this:** the Milestone 0 spike. This recommendation should be overturned if the spike shows CALM can express, without abuse of `metadata`, all four of: per-workload data classification on relationships; trust boundaries as first-class; a candidate that is proposed but not selected; and evidence provenance attached to a relationship. If CALM expresses all four natively, adopting it as the base becomes the better call. My reading is that the first two are plausible via controls and metadata and the last two are out of scope for an architecture language — but that is a prediction, and the spike is the test. Verify against the current CALM v1 spec rather than any summary, including this one.

---

## 5. What exact action constitutes user approval?

**Recommendation: a CLI command that renders a diff and records a hash over the resolved decision. It is never an MCP tool, and the web view stays read-only in slice 1.**

Approval is the one operation where the whole product's honesty lives. §16 says agents may not approve. That must be enforced structurally, not by documentation.

**The operation:**

```text
anvilmark approve <decision-id> --revision <n>
```

1. Renders exactly what is being approved: the decision, the selected candidate, every cited evidence record with its kind and freshness, and every constraint result including `unknown` ones.
2. Requires a human confirmation typed interactively. `--yes` is honored only when `ANVILMARK_NONINTERACTIVE=1` is explicitly set, so CI cannot approve by accident.
3. Refuses outright if any hard constraint is `unknown`, unless a recorded exception covers it. Unknown is not a warning at approval time; it is a block.
4. Writes an approval record: decision id, revision, actor, timestamp, optional note, and the hash below.

**What the hash covers.** Invariant 11 says approvals cover a content hash; this specifies which content. Hash the **resolved** decision — a canonical-JSON serialization of the decision subtree, plus the full content of the selected candidate, plus the full content of every evidence record it cites. Hashing the decision alone is insufficient: an evidence record could later be edited from `vendor_claim` to `measured_evaluation` and the approval would still verify while meaning something entirely different.

**Structural enforcement:**

- The approve code path lives in the CLI package. The MCP server package does not import it. An agent cannot call what is not in the tool list, and the package boundary means it cannot be added by accident.
- `anvilmark verify-approvals` recomputes every hash and reports drift. This runs in CI for the fixture.
- Editing approved content produces a new revision with status `proposed`. The prior approval is retained and marked superseded. Approval history is append-only.

**Web:** read-only in slice 1. Milestone 7 already hedges the web view as optional; adding a mutation surface to an optional component is the wrong order. When it is added, it must render the identical diff and must not be reachable from any page an agent drives.

**What would change this:** if two of three developers find CLI-only approval unusable in practice during Milestone 3, add the web action in Milestone 7 with the same diff and hash requirements. The hash definition should not change either way.

---

## 6. Which evidence kinds can satisfy each constraint kind?

**Recommendation: a four-tier ladder, with a per-domain floor. Evidence below the floor produces `unknown`, never `pass`.**

### The ladder

| Tier   | Meaning                           | Kinds                                                                                    |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------------- |
| **T3** | Observed or measured directly     | `deterministic_observation`, `measured_evaluation`, `runtime_measurement`, `source_code` |
| **T2** | Attributable to a named authority | `official_documentation`, `official_pricing`, `tool_observation`                         |
| **T1** | Declared or claimed               | `user_declared`, `vendor_claim`                                                          |
| **T0** | Neither observed nor attributable | `agent_inference`, `unknown`                                                             |

T0 can never satisfy a hard constraint, which restates §10's first rule as a tier property.

### Floors by domain

| Constraint domain           | Hard floor | Notes                                                                                                      |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| Quality                     | **T3**     | `measured_evaluation` only, on the declared dataset version. A catalog quality score never qualifies       |
| Privacy / data flow         | **T3**     | Static `deterministic_observation` or `source_code`; runtime may confirm but not substitute                |
| Latency / throughput        | **T3**     | Measured on the declared target hardware. An estimated tokens-per-second figure is an estimate, not a gate |
| Token consumption           | **T3**     | Real tokenizer run. Character-count heuristics are estimates                                               |
| Cost                        | **T2**     | `official_pricing` plus arithmetic, always marked derived with assumptions. Hard cost needs T3 runtime     |
| Licensing                   | **T2**     | License text from the publisher. Missing license is `unknown`, never permissive                            |
| Residency / provider policy | **T2**     | Provider region documentation, plus T3 observation of the configured endpoint                              |
| Hardware                    | **T1**     | The user is the authority on a _target_ machine. See the conflation rule below                             |
| Budget                      | **T1**     | The user is the authority on their own budget                                                              |
| Availability / portability  | **T3**     | Deterministically checkable. See below                                                                     |
| Repository policy           | **T3**     | `deterministic_observation` from the scanner                                                               |
| Functionality / operability | **T1**     | Informational in slice 1; do not pretend to verify these yet                                               |

### Three rules that follow

**Hardware must never be conflated.** `user_declared` is authoritative for a _target_ machine; `deterministic_observation` is authoritative for the _local_ machine. They are different subjects and must never merge. This is not hypothetical: [`02-competitor-hands-on-matrix.md`](02-competitor-hands-on-matrix.md) records that llmfit, given RTX 4090 flags on a Mac, kept reporting Apple M4 and Metal and recommended MLX quantization. Atlas declares an RTX 4090 that is probably not the analysis machine. Merging these silently would produce confidently wrong recommendations, which §8 of the proposal already warns against.

**Availability is deterministically checkable, and should be checked.** `availability.classification_provider` — must remain available without any single remote provider — is satisfied by a T3 structural observation: the workload has at least two viable candidates whose deployment modes or providers are independent. No inference required. This is the cheapest real constraint result in the fixture and should be implemented first as proof the machinery works.

**Estimates are never constraint results.** An estimate may inform comparison and must record its assumptions, but it cannot mark a hard constraint satisfied. §17 invariant 8 says unknown is never coerced to pass; the same applies to estimates.

**What would change this:** if a floor makes a constraint permanently unsatisfiable in practice, lower the floor deliberately and record the decision. Do not lower it silently inside an implementation.

---

## 7. Which two repository languages are supported first?

**Recommendation: one, not two. TypeScript and JavaScript through the TypeScript compiler API, and a documented detector interface so the second language is a plugin rather than a rewrite.**

The question presumes two. The honest answer for a ten-week slice is one, and the plan already agrees with itself on this: [`04-vertical-slice-build-plan.md`](04-vertical-slice-build-plan.md) scopes Milestone 5 to "TypeScript/JavaScript" and explicitly excludes Python, Java, and Go.

TS and JS are one detector, not two: a single `ts.createProgram` handles both with `allowJs`, and the type checker is what makes call-site detection honest rather than regex-shaped.

The slice's success criterion is detecting one data-flow violation with file-linked evidence. It is not language coverage. The Atlas benchmark repository is authored by the team, so it can be TypeScript. Adding a second language doubles the hardest work in the plan — call graph plus taint — for zero additional benchmark signal, against a stop trigger that already warns about conformance requiring more program understanding than the team can feasibly build.

**Changes to make:**

- Ship TS + JS in slice 1.
- Publish the detector interface in Milestone 5 as a real extension point — inventory, call-site detection, and taint source/sink identification — with the TS detector as its first implementation.
- Python is the first post-slice language. It is the right second choice because most AI application code is Python, so the plugin interface gets validated against the case that matters.

**What would change this:** if the team decides the benchmark repository must be Python to be credible, then build Python first and skip TS. Do not build both.

---

## 8. Should promptfoo and llmfit be subprocess adapters, libraries, or inspiration?

**Recommendation: optional subprocess adapters, both. Never libraries, never reimplemented.**

Subprocess rather than library, for three reasons: in-process linking makes their network behavior and global state ANVILMARK's problem; it couples ANVILMARK's dependency graph to theirs; and a subprocess boundary is where a command manifest and a raw-output hash can be recorded, which the evidence model requires anyway.

Reimplementing is worse. Both tools are squarely in the integrate column of brief §8, and §15 lists rebuilding mature infrastructure as a named risk.

**promptfoo adapter requirements:**

- Force `PROMPTFOO_CONFIG_DIR` to a project-local path. The hands-on record shows the CLI creating a global `~/.promptfoo` until redirected; writing outside the project by default is not acceptable for a local-first tool.
- Disable telemetry and optional sharing by default.
- Ingest results as `measured_evaluation` evidence carrying dataset version, exact candidate configuration, and a result artifact hash — the §10 requirement.
- Pin and record the CLI version. `0.122.0` is the tested one.

**llmfit adapter requirements:**

- Record version, full command manifest, raw output hash, and both the detected and declared target hardware.
- **Refuse to emit hardware-fit evidence when the detected backend does not match the declared target.** Emit `unknown` with a caveat naming the mismatch instead. This follows directly from the observed Mac/RTX 4090 limitation; without this guard the adapter launders host-machine results into evidence about a machine it never saw.
- Never promote llmfit's composite `quality` score into a workload quality gate. It is catalog-level, and the matrix already says so.

**Both:** absence of the tool yields `unknown` evidence, never a failure and never a silent skip. Neither may become a required dependency, per brief §8's replaceable-adapter rule.

**What would change this:** if subprocess startup cost makes an interactive loop unusable, cache results keyed by input hash. Do not switch to in-process linking.

---

## 9. Which fields are safe to expose to remote intelligence by default?

**Recommendation: default-allow the decision layer; default-deny anything that names the machine, the filesystem, or the code. Distinguish local from remote adapters, because the risk is genuinely different.**

The distinction matters and is easy to get wrong. Claude Code running on the user's machine can already read the repository. Withholding file paths from it is theater. Sending those same paths to a remote API is a real disclosure. One policy for both is either too tight to be useful or too loose to be safe.

### Default-allow (the public projection)

`schema_version`; `project.name`, `state`, `contract_revision`; all of `intent`; all of `constraints`; workloads, including data classification _labels_, output contract kinds, usage numbers, latency requirements, and quality gate metrics and minimums; `resources` hardware specifications and budget amounts; candidates, including model, deployment, status, and estimates; evidence _metadata_ — kind, subject, producer, `observed_at`, confidence, caveats; decisions and rationale; conformance rule definitions.

This is the material an intelligence needs to propose useful candidates and architectures. Withholding it makes the adapter useless.

### Default-deny (explicit per-action consent)

`project.repository_roots` and every absolute path; all of `repository_bindings` — a path plus a symbol name discloses code structure; file contents in any form; `integrations`, because `credential_ref` names and `data_directory` paths leak environment variable names and machine layout; `owners`; any evidence record whose `source.locator` is a local path or a command line; evaluation dataset rows, which in Atlas are real customer tickets and therefore the most sensitive data in the project; conformance explanations that quote source.

### Cross-cutting rules

- Hostnames, usernames, and absolute paths are redacted or relativized everywhere before any remote call, including inside free-text rationale.
- Remote adapters receive the public projection by default. Local adapters may receive the full contract, still with a disclosure of what was sent.
- The user sees what will be sent before it is sent, per §15. A count is not a disclosure; show the payload.
- Secret-pattern scanning runs on the outbound payload, not only on persistence. §17 invariant 10 covers persistent artifacts; the same check belongs on the wire.

**What would change this:** if a remote adapter cannot produce useful proposals from the public projection, widen it field by field with a recorded reason. Do not add a global "send everything" toggle.

---

## 10. What is the minimum data-flow analysis to detect the benchmark violation honestly?

**Recommendation: the provider allowlist carries the slice. Taint analysis is a genuine but partial second signal, and its limits must be stated rather than hidden.**

The planted violation is a classification workload changed to call a disallowed remote provider with raw ticket text. It trips two independent rules, and they are not equally hard.

**Rule 1 — provider allowlist. Fully deterministic, no data-flow needed.** Resolve the module graph with the TypeScript program and identify which provider SDK is imported and called at the classification binding's call site. A disallowed provider is a definite fail with an exact file and symbol. This rule alone satisfies the Milestone 6 exit criterion. It cannot produce false confidence because it makes no claim about what data flows.

**Rule 2 — forbidden data flow. Honest but partial.** The minimum that is defensible:

1. **Declared sources.** The contract declares where raw data enters — a type such as `RawTicket`, or the ingest handler's return. Sources are contract-declared, not inferred. Without a declared source, taint analysis is guesswork dressed as analysis.
2. **Type-resolved sinks.** Identify call sites whose receiver type traces to a known provider SDK, using the type checker. Not regex: `openai.chat.completions.create` matched textually breaks on aliasing, re-export, and wrapper functions, in both directions.
3. **Intraprocedural def-use**, plus one level of interprocedural propagation across statically resolved direct call edges.
4. **Sanitizers.** Passing through the declared redaction component clears taint, which is exactly the `unless.passes_through` clause already in the rule.
5. **Everything else is `unknown`, with the reason named.** Dynamic dispatch; `any` or `unknown` types; endpoints built by string concatenation; values crossing a queue, database, or network boundary; indirection past depth 1.

The unknowns are not a defect to be minimized into silence. §14 requires unknown rather than pass when evidence is absent, and Milestone 6 requires an ambiguous dynamic call to return unknown.

**One addition to Milestone 6.** The plan calls for a compliant fixture variant and a violating one. Add a third: an **ambiguous** variant where the provider is selected from an environment variable at runtime. It must return `unknown`, not pass and not fail. Without this case, a detector written against two fixtures the team authored will look far more capable than it is — and the team will not find out until a real repository.

**What would change this:** if rule 2 cannot reach the violation without more than one interprocedural level on the team's own benchmark repository, ship rule 1 alone in slice 1 and say so plainly. A working allowlist with an honest "data-flow analysis is not implemented" is worth more than a taint engine whose unknowns are not surfaced.

---

## Ratification checklist

Milestone 0 is complete when the three developers have, for each of the ten questions above, recorded accept / amend / reject with a reason; and when the CALM spike in question 4 has been run and its result written down regardless of which way it goes.

The proposal's acceptance condition still governs: ratify only if the contract can represent the Atlas benchmark without embedding a specific provider, coding agent, evaluation platform, hardware-fit tool, cloud, or model family into the core schema.
