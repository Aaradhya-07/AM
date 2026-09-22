# Hardware sizing implementation record

Completed 2026-09-19 (Asia/Kolkata) in `/Users/na61/Desktop/ANVILMARK-milestone-5`, branch `emergent-playground`. This supersedes the paused resume checklist and extends [the first slice](hardware-sizing-first-slice.md). Changes are uncommitted; nothing was pushed or deployed.

## Delivered behavior

- **Inventory:** strict `anvilmark-hardware-probe/2` snapshots; local Linux CPU/RAM/NVIDIA and Apple Silicon shared-memory collection; explicit partial/unsupported outcomes. SSH uses a fixed Linux/Python 3 collector, non-interactive batch mode, pre-existing host trust, bounded output and deadlines, cancellation, and process-group cleanup. Failed remote probing never falls back to local inventory. Loopback-only model listing is a separate, bounded command.
- **Contract workflow:** `hardware probe` is read-only by default. Explicit persistence appends an observed hardware entry and attributable T3 evidence. `--as-declared NEW_ID` creates a distinct T1 target; collisions refuse the transaction. `hardware apply` first recomputes and binds a proposal to the actual project/base digest, then `--write` validates it again inside the existing transaction store.
- **Evidence:** serving assumptions stay T1 and derived memory arithmetic stays T2. Only an unconditional soft `candidate.<id>.memory_fit eq true` comparison can use this evidence. Shared admission/freshness checks bind hardware, persisted inventory, exact model/runtime configuration, workload, scenario and constraint. Material edits reconcile results to unknown while retaining history. Recomputed over-budget evidence cannot support an edited claim of pass. Hard hardware, runtime compatibility, latency, throughput and quality gates remain unresolved.
- **Sizing:** exact integer-byte resident weights use total MoE parameters; KV uses architecture dimensions, context, precision and concurrency. Missing allocation/overhead remains unknown. Apple RAM is one pool. The two pinned models support a homogeneous, single-host contiguous-layer residency profile for 2–16 GPUs with independent device budgets and no aggregate headroom.
- **Performance:** caller-supplied calibration requires an exact model/runtime/SKU/capacity/backend/precision/context envelope, validity window and at least three samples. Median/range are advisory. There is no universal bandwidth efficiency multiplier, fabricated benchmark catalog or inferred latency P95.
- **Web:** playground and Studio import inventory, scenarios, verifiable artifacts and calibration; all imported hardware remains unverified planning input. Controls expose runtime/SKU, explicit budgets, context, precision and layer placement. Multi-GPU mode disables inactive shared budget controls, labels aggregate composition clearly, and exports per-device details in the brief. JSON export includes a visible fallback. Existing conformance checks and Studio bundle verification remain available.
- **MCP:** sizing and local-probe capabilities are opt-in. The default project server retains eight tools; the historical server retains three. Probe tools accept no command, host, path or URL inputs. Remote-default projection removes private inventory details and aliases discovered model names.

The project schema remains `0.1.0-draft.5`. Versioned payloads use its existing evidence extension points; this implementation does not invent ratification, add authoritative serving fields or modify historical decisions. See [package documentation](../../packages/hardware-sizing/README.md), [CLI commands](../../packages/cli/README.md) and [MCP capabilities](../../packages/mcp/README.md).

## Verification

The full `pnpm build` and `pnpm test` passed after collector hardening and the contradictory-result guard. The suite reported **1,639 passing tests and 22 skipped tests** across 11 packages. Skipped tests were not changed to obtain a pass. The final UI-only refinement then passed the web suite again (48 tests) and a production web rebuild.

| Package          | Passed | Skipped |
| ---------------- | -----: | ------: |
| contract         |      1 |       0 |
| hardware-sizing  |     53 |       0 |
| engine           |      1 |       0 |
| project-contract |    310 |       0 |
| adapters         |    756 |      19 |
| context          |     88 |       3 |
| scanner          |     66 |       0 |
| conformance      |     70 |       0 |
| web              |     48 |       0 |
| cli              |    220 |       0 |
| mcp              |     26 |       0 |

Additional checks: repository lint and formatting; `git diff --check`; zero case-insensitive `approv` matches in both `packages/web/app/` and `packages/mcp/src/`; historical MCP tools-list verification; project MCP verification with 11/11 client responses byte-identical, protocol-only stdout and unchanged fixture tree; all six playground API variants. A previous MCP timeout under concurrent test load passed in isolation and in the final monorepo run without relaxing its timeout.

Real local validation used this host's Apple M4: complete inventory, 10 logical cores and 17,179,869,184 bytes of physical RAM, one Metal/shared-memory device, no duplicated VRAM, and unknown allocation/recommended working set. The newer macOS Metal field has regression coverage. Availability remains a dated observation, not a reservation.

Browser verification covered the real probe import, explicit T1/unverified labeling, unknown allocation, recomputation of a negative headroom, two-GPU independent budgets and one-device overflow, and a 390 × 844 responsive layout with no horizontal overflow. Synthetic calibration produced its known 90 tokens/s median and became inapplicable after a context edit; this checked behavior, not hardware performance. Studio loaded the Atlas example with hashes recomputed and consistent while keeping its sizing workspace and separate evidence/conformance findings. Artifact integrity, clipboard rejection, concurrent export edits and CLI/browser arithmetic parity are covered by automated tests.

## Explicit limits and future extensions

- No live NVIDIA/AMD hardware or SSH target was available for this verification. Their supported behavior and failures are fixture-tested; no remote hardware coverage is claimed. AMD observations remain partial until discrete/APU topology and backend support can be established. Windows and Intel Mac GPU collection remain partial/unsupported.
- The current `self_hosted` deployment schema lacks a hardware reference. SSH inventory can be exported and persisted, but remote self-hosted fit attachment is refused pending a separately versioned schema amendment. Do not bypass that refusal by inventing a local deployment.
- Multi-node, arbitrary tensor/expert/offload layouts, real named quantized artifact layouts and runtime/interconnect compatibility are unsupported. Nominal integer storage is labeled hypothetical. Added model profiles require pinned architecture/format metadata and independent sizing fixtures.
- No empirical calibration profile or target benchmark is shipped. Importing a file cannot authenticate its measurements or satisfy a T3 performance gate. Benchmarks, model downloads and server lifecycle actions are outside this implementation.

These are declared support boundaries, not partially enabled features. Unsupported inputs remain unknown or are refused, with reasons. Further scope must extend the shared schema/admission and capability matrix before exposing broader claims.

## Independent review, September 19, 2026

Reviewed by a second agent (Claude) against the checkout, not the record. The
implementation was not restarted, and no claim below was taken from this
document without re-running it.

**Reproduced.** `pnpm build` and `pnpm test` pass at **1,639 passing, 22
skipped**, matching the per-package table above exactly. `pnpm format:check`
and `git diff --check` pass. `pnpm lint` passes (the only failures seen were in
the reviewer's own new test file and were fixed before it was kept). The MCP
timeout reported earlier under concurrent load did not recur.

**Re-derived, not read.** Adversarial inputs were run against the built
estimator: Mixtral weights count all eight experts (93,405,585,408 bytes at
BF16, matching the publisher index); a nominal INT4 request with unknown
metadata never produces a within-budget assessment; an unnamed quantized format
is refused rather than inferred; and with four devices where one is starved,
each device is judged independently, the aggregate is over budget, and pooled
budget and headroom stay null. Per-device weights sum exactly to the
single-pool total.

**Attachment boundary.** `packages/cli/test/review-probes.test.ts` adds five
adversarial regression tests that must never be admitted: findings relabelled
to a pass while the recomputation is over budget (refused as
`pass_below_evidence_floor`, naming the recomputed contradiction), an edited
persisted inventory, a declared target cited as its own observed inventory,
remotely collected inventory used as a fit basis, and a record detached from
its constraint. All five are refused.

**Previously untested paths.** The SSH option construction was verified with
`ssh -G`: the quoted `UserKnownHostsFile` value is parsed and resolves to the
intended path, so host-key verification applies as written; an unknown option
fails loudly, confirming the check. This validates option construction only —
no remote host was contacted, and no live NVIDIA/AMD/SSH coverage is claimed.
The local Apple probe was re-run on this machine and reproduced the recorded
result: complete status, 10 logical cores, 17,179,869,184 bytes, one Metal
shared-memory device with null installed memory, and allocation unknown.

**Repository hygiene.** `reference/` (an audited upstream checkout kept locally,
already excluded from lint and formatting) is now git-ignored, so 177 MB of
third-party source cannot be committed by accident.

No security or arithmetic defect was found in the reviewed surfaces. The
support boundaries stated above are unchanged, including the refusal to attach
remote self-hosted inventory pending a separately versioned schema amendment.
