# ANVILMARK Contract Ratification Decision

Date: **August 19, 2026**

Acknowledged: **August 20, 2026**

Status: **Original decision ratified by all three developers; Milestone 1 authorized. The current schema is amended to `0.1.0-draft.3` by the separately ratified amendments 1–4 in [document 07](07-schema-amendment-proposal.md), and to `0.1.0-draft.4` by amendments 6–7 in [document 08](08-milestone-3-scope-proposal.md), accepted September 14, 2026 under a separate scoped exception.**

Reviews: [`05-contract-ratification-answers.md`](05-contract-ratification-answers.md) and the current FINOS CALM 1.2 specification

## Outcome

The ten recommendations in document 05 are accepted as the basis of the first vertical slice, with four amendments needed for internal consistency and an honest security/evidence model.

|   # | Decision                                                         | Standing                                      |
| --: | ---------------------------------------------------------------- | --------------------------------------------- |
|   1 | Workload is primary; component/project scopes also exist         | **Accepted**                                  |
|   2 | Hard/soft/informational plus soft direction and project priority | **Accepted**                                  |
|   3 | Separate `packages/project-contract` and independent schema line | **Accepted with version amendment**           |
|   4 | ANVILMARK authoritative; CALM generated export                   | **Accepted and spike-verified**               |
|   5 | Explicit local CLI approval; no MCP approval                     | **Accepted with security-boundary amendment** |
|   6 | Evidence tiers and per-domain floors                             | **Accepted with floor amendments**            |
|   7 | TypeScript/JavaScript as one first detector                      | **Accepted**                                  |
|   8 | promptfoo and llmfit as optional subprocess adapters             | **Accepted**                                  |
|   9 | Remote public projection with machine/code details denied        | **Accepted with clarification**               |
|  10 | Deterministic provider allowlist plus deliberately partial taint | **Accepted with acceptance-test amendment**   |

---

## 1. Decision scope

The workload is the primary unit for model and deployment choices. `decision.scope` is a discriminated union:

```text
workload | component | project
```

Evaluation execution is a process and evidence producer, not a workload. `quality_evaluation` is removed from the Atlas workload list. Retrieval remains a workload while its embedding model and vector-store choices may be separate component-scoped decisions.

## 2. Constraint shape

The first slice has three severities only:

- hard;
- soft;
- informational.

Soft constraints gain `direction: minimize | maximize | target`. The project records a user-declared `priority_order` for transparent tie-breaking. Conditions and exceptions are separate fields, not new severities.

## 3. Package and schema version

Create `packages/project-contract`. Leave the historical `packages/contract` and `SCHEMA_VERSION = "0.1.0"` untouched.

Document 05 correctly identifies the project contract as a separate schema line, but retaining `0.2.0-draft.1` would contradict that reasoning. The first project-contract draft is therefore:

```text
PROJECT_SCHEMA_VERSION = 0.1.0-draft.1
https://anvilmark.dev/schemas/project/0.1.0-draft.1
```

> **Historical decision and current amendment.** `0.1.0-draft.1` is the
> initial version the three developers accepted on August 20, 2026. Amendments
> 1–4 in [`07-schema-amendment-proposal.md`](07-schema-amendment-proposal.md)
> were ratified on September 13, 2026 through Anurag's acceptance and his scoped
> exception to the three-acknowledgement requirement for this decision.
> Amendments 6–7 in [`08-milestone-3-scope-proposal.md`](08-milestone-3-scope-proposal.md)
> were accepted on September 14, 2026 by Anurag under a separate exception scoped
> to those Milestone 3 decisions, giving the current implemented version
> **`0.1.0-draft.4`**. No acceptance of any of these amendments is attributed to
> Navaneeth or Aaradhya. Amendment 5 remains proposed and deferred; the other
> decisions in this document remain in force.

The identical numeric prefix in two differently named packages is not a collision. Package/schema identity supplies the namespace.

## 4. CALM standing

ANVILMARK's architecture nodes and relationships remain authoritative. Mermaid and FINOS CALM are generated views/exports.

This was checked against the current **CALM 1.2** documentation and CLI rather than the older “CALM v1” wording. CALM 1.2 supports nodes, relationships, interfaces, controls, metadata, standards, timelines, and decorators. Standards and arbitrary metadata can carry organization-specific relationship data, but proposed candidates, workload-quality evidence, effective-cost evidence, and approval semantics are not native architecture concepts.

The spike [`spikes/atlas-calm-1.2.export.json`](spikes/atlas-calm-1.2.export.json) passed `@finos/calm-cli 1.56.0` validation with no errors or warnings. It required ANVILMARK-specific metadata for workload references, data classification, trust-boundary crossing, and decision references. This supports export interoperability without making CALM authoritative.

CALM export remains in the first slice. Import and round-trip editing do not.

## 5. Approval boundary

The first slice exposes approval only through an interactive local CLI command over a resolved content hash. It is not an MCP tool and the web view remains read-only.

The resolved hash covers:

- the decision revision;
- the full selected candidate revision;
- every cited evidence record and its content;
- the constraint results being approved.

There is **no noninteractive approval flag in the first slice**. Document 05's proposed environment-variable escape hatch is rejected because a coding agent with shell access can set it.

Removing approval from MCP and requiring an interactive terminal reduces accidental approval; it is not a cryptographic human-presence guarantee. Claude Code or Codex with unrestricted shell access can invoke local programs. ANVILMARK must state that limit and rely on the user's agent permission boundary. A stronger approval identity mechanism is a later security design, not a claim for the prototype.

Approval history is append-only. Changing resolved approved content produces a new proposed revision and makes the old approval non-current without deleting it.

## 6. Evidence ladder and floors

The four evidence tiers are accepted:

| Tier | Meaning                             | Examples                                                                                        |
| ---- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| T3   | Directly observed or measured       | deterministic observation, measured evaluation, runtime measurement, relevant source inspection |
| T2   | Attributable authoritative evidence | official documentation, official pricing, tool observation with assumptions                     |
| T1   | Declared or claimed                 | user declaration, vendor claim                                                                  |
| T0   | Inference or absence                | agent inference, unknown                                                                        |

Evidence below the applicable floor yields `unknown`, never `pass`.

The floors are amended to separate facts that document 05 grouped too broadly:

| Subject                            | Floor for first slice                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Workload quality hard gate         | T3 measured evaluation on the declared dataset/configuration                       |
| Privacy/data-flow hard gate        | T3 deterministic source observation; runtime may add confirmation                  |
| Latency/throughput hard gate       | T3 measurement on the declared target environment                                  |
| Token hard gate                    | T3 tokenizer/provider measurement for the exact configuration                      |
| Projected cost comparison          | T2 official pricing plus explicit arithmetic and T1 usage assumptions              |
| Hard realized-cost gate            | T3 runtime/billing measurement                                                     |
| License                            | T2 publisher license text                                                          |
| Residency/provider capability      | T2 official documentation plus T3 configured-endpoint observation when implemented |
| Target hardware inventory          | T1 user declaration is authoritative for what the user owns/plans                  |
| Hardware compatibility estimate    | T2 tool observation whose detected/target hardware identity matches                |
| Hardware performance gate          | T3 benchmark on the declared target hardware                                       |
| Budget amount                      | T1 user declaration                                                                |
| Availability/portability structure | T3 deterministic contract observation over independently viable candidates         |
| Repository policy                  | T3 deterministic repository observation                                            |

The hard/realized versus projected distinction prevents the system from presenting estimates as measurements while still allowing useful idea-stage comparisons. Atlas cost and latency constraints are soft, so they can inform selection before production measurement without becoming false hard passes.

## 7. First repository detector

The first detector covers TypeScript and JavaScript through the TypeScript compiler API with `allowJs`. This is one detector implementation.

The detector interface must separate:

- inventory;
- module/call-site resolution;
- provider source/sink recognition;
- partial taint propagation;
- repository binding output.

Python is the first post-slice plugin and is not required for prototype completion.

## 8. Evaluation and hardware adapters

promptfoo and llmfit are optional subprocess adapters.

The promptfoo adapter must isolate its data directory, disable telemetry/sharing by default, pin/record the CLI version, and attach dataset/candidate/configuration hashes.

The llmfit adapter must preserve declared target and detected local hardware as separate subjects. A backend/device mismatch produces `unknown`; it cannot generate fit evidence for the target. Its generic quality score cannot satisfy a workload quality gate.

Tool absence produces an explicit evidence gap, not a product failure and not a silent pass.

## 9. Remote intelligence projection

Remote intelligence receives a public projection by default:

- intent;
- constraints;
- workloads and non-sensitive data-classification labels;
- budgets and non-identifying hardware capabilities;
- candidates;
- evidence metadata without local locators;
- decisions;
- conformance rule definitions.

Default-denied fields include:

- repository roots and absolute paths;
- file contents, symbols, bindings, and source excerpts;
- owners and local identities;
- hostnames, usernames, device identifiers, serial numbers, and local command lines;
- integration credential references and data directories;
- evaluation rows;
- conformance explanations quoting source.

Hardware capacity such as “24 GB NVIDIA GPU” may be included; machine identity may not. The exact outbound payload is shown before sending and scanned for secret patterns. Local adapters may receive broader data under a separate disclosed policy.

## 10. Data-flow and acceptance test

The provider allowlist is the first complete deterministic rule. Type-resolved direct data flow is the second, deliberately partial rule.

The allowlist alone proves that a disallowed provider is called. It does **not** prove that raw ticket data reached that provider, so it cannot by itself satisfy the full Atlas violation criterion.

For the authored direct-flow fixture, the slice must report both:

1. provider allowlist failure;
2. raw-ticket-to-remote-sink failure with the declared redactor as sanitizer.

The initial taint boundary is:

- contract-declared sources;
- type-resolved provider sinks;
- intraprocedural def-use;
- one level of statically resolved direct-call propagation;
- declared sanitizer clearing;
- `unknown` for dynamic dispatch, unresolved `any`, deeper indirection, queues, databases, and runtime-selected endpoints.

Milestone 6 has three fixture variants:

- compliant → pass;
- direct violating → fail both applicable rules;
- ambiguous runtime provider/data path → unknown for unresolved claims, never pass.

---

## Implementation gate — closed

All three developers recorded acceptance on August 20, 2026. No amendments or rejections were submitted.

| Developer | Decision   | Date            |
| --------- | ---------- | --------------- |
| Anurag    | **Accept** | August 20, 2026 |
| Navaneeth | **Accept** | August 20, 2026 |
| Aaradhya  | **Accept** | August 20, 2026 |

Milestone 1 may begin from this ratified baseline. Future changes must be recorded as new decisions rather than silently changing the accepted contract.

No additional broad competitor research is required before Milestone 1.
