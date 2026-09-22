# Project-Contract Schema Amendment Proposal

Date: **August 21, 2026**

Status: **Amendments 1–4 ratified on September 13, 2026 by Anurag under the scoped acknowledgement exception recorded below. Amendment 5 remains proposed, deferred, and not implemented.**

Ratifies: **`0.1.0-draft.1` → `0.1.0-draft.3`** in `packages/project-contract` through amendments 1–4

Supersedes in part: [`06-contract-ratification-decision.md`](06-contract-ratification-decision.md) section 3

> **Later amendments.** Amendments 6 and 7 (`0.1.0-draft.4`) are recorded in
> [document 08](08-milestone-3-scope-proposal.md), accepted on September 14,
> 2026 under a separate scoped exception. They do not change anything recorded
> here, including the scope of the exception below or the status of Amendment 5.

## Why this document exists

The implementation has moved from the ratified `0.1.0-draft.1` to
`0.1.0-draft.3`. Four amendments were made during Milestone 2, each because a
rule decision 06 had already ratified could not otherwise be evaluated.
Amendments 1 to 4 are implemented in `packages/project-contract` at
`0.1.0-draft.3`. **Amendment 5 is proposed only**: it is not implemented, and
the schema does not contain the fields it describes.

Anurag accepted amendments 1–4 on September 13, 2026 and subsequently
instructed that this decision need not wait for Navaneeth or Aaradhya. His
acceptance is sufficient under the scoped exception recorded below. No decision
is attributed to either other developer. Decision 06 remains the historical
August 20, 2026 acknowledgement by all three developers; this document records
the later schema amendments and their separate decision authority.

Coding agents may draft and revise this document and transcribe actual human
decisions. They may not invent acceptance on behalf of a developer.

## Amendment 1 — `Hardware.backend`

Add a nullable `backend` field to a hardware entry, e.g. `cuda`, `metal`,
`rocm`, `cpu`.

**Why.** Decision 06 section 8 states that a backend or device mismatch
produces `unknown`. `draft.1` had nowhere to record which backend a machine
offers, so the ratified rule could not be evaluated at all: an adapter could
compare accelerators but never backends.

**Affected invariant.** "A backend/device mismatch produces `unknown`; it
cannot generate fit evidence for the target."

## Amendment 2 — `measured_evaluation.value.identity`

Add a required `identity` object to a measured evaluation, carrying
`workload_ref`, `dataset_hash`, `prompt_hash`, `evaluator_hash`,
`model_configuration_hash`, `config_digest`, and `provider_id`.

**Why.** An evaluation is evidence only about the exact dataset, prompt,
evaluator, workload, model configuration, and provider that produced it. A
single opaque `configuration_hash` could say that something had changed but
never which thing, and "the dataset was revised" and "the prompt was reworded"
have very different consequences for whether an old result still applies.
Keeping the individual identities in an adapter annotation would have lost them
the moment the evidence was attached to a contract.

**Affected invariant.** "Evaluation evidence requires dataset version, exact
candidate/configuration, metrics, and result artifact hash" — this makes each
component individually inspectable.

## Amendment 3 — digest semantics

Every digest in that identity is `sha256:` followed by 64 lower-case
hexadecimal characters.

**Why.** A fixed, algorithm-qualified format standardises how fingerprints are
written, so every consumer reads and compares them the same way. **Format alone
does not establish authenticity**: a fabricated value can be written in exactly
this format. Integrity comes only from recomputing each digest from the
canonical bytes it covers and comparing the result with the recorded value —
which is why the adapter derives every digest itself rather than accepting one
from a caller.

**What each digest covers**, so the representation is unambiguous:

| Digest                     | Canonical bytes                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `config_digest`            | the exact UTF-8 bytes of the file passed to `-c`                                                    |
| `dataset_hash`             | canonical JSON of the dataset id, version, and each case's inputs                                   |
| `prompt_hash`              | canonical JSON of the prompt content                                                                |
| `evaluator_hash`           | canonical JSON of every assertion                                                                   |
| `model_configuration_hash` | canonical JSON of the provider id, config, and credential environment-variable names (never values) |

Canonical JSON means lexicographic key ordering with array order preserved, so
one evaluation has one identity regardless of where it is written or run.

The digests cover **data the contract holds**, not files on disk. An evaluation
whose inputs are not fully present — a URL, a glob, a generated dataset, a
model-graded assertion, anything the bytes do not determine — cannot have a
verifiable identity, so it is refused before it runs rather than recorded with
a digest that proves nothing.

## Amendment 4 — required provider and expected evaluation identity

Make `provider_id` **required and non-null** on a measured evaluation, and add
`measurements.expected_evaluation` to a candidate, carrying the `provider_id`
and `configuration_hash` that candidate's measurements must match.

**Why.** A nullable provider let "we never established one" look like a
recorded value: a promptfoo artifact aggregating two providers was accepted as
T3 evidence with `provider_id: null`. And without a declared expectation the
contract could check that an evaluation was internally complete but not that it
described the candidate **as configured now**, so a measurement of a superseded
prompt or a different provider still cleared a hard quality gate.

The comparison runs inside `admitEvidence`, not in a helper a caller must
remember to invoke. A measured evaluation is refused when the expectation is
absent, when the provider differs, or when the configuration hash differs.

**Affected invariant.** "Evidence below the applicable floor yields `unknown`
and never satisfies a hard constraint" — this closes the case where evidence
was at the right tier but about the wrong configuration.

## Amendment 5 — execution identity on a measured evaluation (proposed, not implemented)

Add an `execution` object to `measured_evaluation.value.identity`:

```text
execution:
  provider_reach: "local" | "remote"
  destination_identity: string    # "local", or a lower-case host[:port]
  tool: { name: string, version: string }
  launcher_digest: sha256:<64 hex>
```

**Why.** The same evaluation run against a local provider, or against two
different hosts, is three different measurements. The Milestone 2 final
acceptance pass made the adapter distinguish them, but the contract has nowhere
to hold the distinction: `identity` is a strict object with no such fields.
Evidence from endpoint A must not be treated as current for endpoint B.

**What happens without it.** The adapter binds reach and destination into
`configuration_hash`, which `measurements.expected_evaluation` and freshness
checks already compare, so endpoint A's evidence is not admitted for endpoint B.
Reach, destination and the launcher digest are also written, in words, into the
record's `caveats`. That is enough to refuse the wrong reuse, but not enough for a
reader or a tool to see the values as structured fields, or to recompute
`configuration_hash` from the record alone.

**What it does not claim.** `destination_identity` is declared by host-owned
provider policy, not observed on the network. `launcher_digest` covers the
promptfoo launcher file only, not its transitive package dependencies.

**Affected invariant.** "Evidence below the applicable floor yields `unknown`" —
this extends the case closed by amendment 4 from the wrong configuration to the
wrong endpoint, and makes the distinction visible in the record itself.

**If rejected.** The adapter keeps the `configuration_hash` binding and the
caveat text. Nothing becomes admissible that is refused today.

## Affected Atlas acceptance tests

Atlas declares no evidence, no candidates with measurements, and no decisions,
so no Atlas assertion changes meaning. Two mechanical updates were required for
it to keep validating:

- `resources.hardware[0]` gains `backend: cuda`, matching the declared RTX 4090
  target;
- `schema` and `schema_version` move to `0.1.0-draft.3`.

Atlas still has five workloads, both hard constraints, three directional soft
constraints, empty decisions and approvals, and its unchanged remote-projection
defaults.

## Compatibility consequences

- **A `draft.1` document does not validate as `draft.3`.** A measured
  evaluation without `identity` is rejected, so is one whose digests are not
  algorithm-qualified, and so is one without a `provider_id`. A candidate
  citing a measured evaluation must also declare
  `measurements.expected_evaluation`. Nothing is silently upgraded.
- **No `draft.1` document exists outside this repository.** The line has never
  been published, so the only affected artifact is the Atlas fixture.
- **`packages/contract` at `SCHEMA_VERSION = "0.1.0"` is untouched**, as it has
  been throughout.
- **Milestone 2 adapters depend on amendments 1 to 4.** Amendment 5 is not
  depended on: its absence is handled as described in its own section.
- **Amendments 1 to 4 are depended on in this way:** Rejecting any one
  means the corresponding rule in decision 06 returns to being unevaluable, and
  the adapter that relies on it must return `unknown` unconditionally.
- **`draft.2` was an intermediate step inside Milestone 2** and was never
  merged; it is recorded here only so the numbering is not mistaken for a gap.

## Acknowledgement

### Recorded decisions

Only decisions each developer actually supplied are recorded here.

| Developer | Decision                  | Date       |
| --------- | ------------------------- | ---------- |
| Anurag    | **Accept** amendments 1–4 | 2026-09-13 |

**Anurag — as supplied:**

```text
Developer: Anurag
Decision (amendments 1–4): accept
Date: 2026-09-13
Amendment 5: remains proposed and deferred
```

Anurag also asked that Amendment 3's explanation be clarified: the SHA-256
format standardises fingerprints, authenticity does not follow from format
alone, and integrity checks depend on recomputing and comparing the digests.
That clarification has been applied to the "Why" paragraph of Amendment 3. It
changes explanatory text only; it does not change any field, format, invariant
or Atlas fixture.

**Navaneeth** and **Aaradhya**: no decision supplied. Nothing is recorded for
them, and their acknowledgements are not required for amendments 1–4 under the
scoped exception below.

### Scoped acknowledgement exception — September 13, 2026

After his acceptance was recorded in `b28f4f1`, Anurag instructed:

> actually we dont need to wait for them

For this Milestone 2 schema decision only, Anurag's recorded acceptance is
sufficient to ratify amendments 1–4. This explicitly replaces the previous
requirement to wait for all three acknowledgements for those amendments. It
does not attribute approval to Navaneeth or Aaradhya, ratify Amendment 5, or
change the acknowledgement process for other decisions.

Amendments 1–4 and project-contract `0.1.0-draft.3` are therefore **ratified**.
The exception does not change ANVILMARK's runtime approval boundary. Merge, push,
and Milestone 3 work were not authorized by the exception itself. Anurag
subsequently authorized the merge on September 13, 2026; it is recorded below.
Push and Milestone 3 work remain outside the current authorization.

### Decision record format

When a developer supplies a decision, record it in this form:

```text
Developer: <name>
Decision: accept | amend | reject
Notes: <required for amend/reject>
Date: <date>
```

An amendment must identify the affected contract field, invariant, milestone,
and Atlas acceptance test.

Amendments 1–4 are **implemented and ratified** under the scoped exception.
Independent technical review passed at `8b027ac`, with 926 workspace tests and
19 real Promptfoo integration tests passing. On September 13, 2026, Anurag
authorized the merge, and local `main` was fast-forwarded from `a30a8f4` to the
approved Milestone 2 branch tip `a43a77f`. Milestone 2 is **complete and merged
locally**. Amendment 5 remains proposed and deferred; no push or Milestone 3
implementation was performed.
