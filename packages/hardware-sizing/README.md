# Hardware sizing

`@anvilmark/hardware-sizing` is a pure planning library shared by the CLI, playground, Studio, and optional MCP calculators. It imports no Node modules, reads no hardware, starts no processes, fetches no model data, and cannot write a project contract.

## Supported scope

| Dimension      | This version                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Models         | Pinned Qwen2.5-Coder-7B-Instruct and Mixtral-8x7B-Instruct-v0.1                                                    |
| Placement      | One discrete GPU, one Apple unified-memory pool, CPU-only, or a pinned homogeneous contiguous-layer profile        |
| Weight storage | BF16/FP16/FP32 tensor payload; hypothetical nominal 4/8-bit packing with explicit metadata allowance               |
| KV cache       | FP16/BF16/FP32; per-layer attention metadata; independent concurrent sequences                                     |
| Budget         | Explicit allocation limit minus reserve, counted once                                                              |
| Runtime        | Explicit user overhead and allocator allowances; compatibility remains unknown                                     |
| Performance    | Optional caller-supplied exact-envelope calibration; otherwise numeric decode speed is null                        |
| Authority      | Pure library never writes or admits evidence; the CLI separately validates and attaches eligible local comparisons |

Other multi-device/multi-node placement, offload, named GGUF/AWQ/GPTQ variants, FP8/quantized KV, and context extensions return unsupported, never a substituted configuration. The layer-wise cache primitive supports explicit sliding-window retention; the two shipped model profiles use full attention. Prefix sharing, speculative decoding, beams, and multimodal caches need additional profiles.

The default example deliberately leaves allocation limit and runtime allowances unknown. Supplying zero is an explicit assumption, not a measurement. A known memory lower bound above the selected budget can show estimated-over-budget even when the total is incomplete. Incomplete estimates never show estimated-within-budget. All results remain conditional on the input assumptions.

## CLI

Run from the repository root after `pnpm build`:

```sh
node packages/cli/bin/anvilmark.mjs hardware catalog --json
node packages/cli/bin/anvilmark.mjs hardware example --json > /tmp/sizing-input.json
node packages/cli/bin/anvilmark.mjs hardware estimate --file /tmp/sizing-input.json --json
node packages/cli/bin/anvilmark.mjs hardware estimate --file packages/hardware-sizing/examples/standalone-qwen.json
```

Edit the input's allocation and workload assumptions before relying on a result. The CLI accepts either strict input JSON or an exported `anvilmark-hardware-sizing/1` artifact, bounded to a regular file of at most 1 MiB. It verifies exported digests and independently recomputes all results. Exit 0 means calculation completed, including an incomplete or unsupported result; inspect `result.status` and `result.memory.assessment`. Invalid inputs/artifacts return 2; I/O errors return 1; cancellation returns 3. JSON mode keeps stdout machine-readable.

These calculation commands do not require a project and never write project state. `hardware add` retains its existing declaration workflow.

### Inventory and persistence

```sh
anvilmark hardware probe --json > /tmp/inventory.json
anvilmark hardware discover --json
anvilmark hardware recommend --file /tmp/sizing-input.json --json
anvilmark hardware probe --host user@host --known-hosts /absolute/path/known_hosts --json
anvilmark hardware probe --write --id observed.local --evidence-id inventory.local --capacity-unit gib --as-declared target.local --json
```

`probe` defaults to read-only. `--write` appends a complete T3 observation; `--as-declared NEW_ID` explicitly creates a distinct T1 target. Existing IDs are refused, never replaced. The last command needs an initialized project, and the optional declaration flag is not implicit in `--write`. Partial or visibility-limited snapshots can be exported but cannot become complete Hardware entries.

Local collectors support Linux CPU/RAM and NVIDIA inventory, and Apple Silicon CPU/unified RAM/Metal inventory. Linux AMD sysfs observations remain partial because discrete/APU topology and ROCm support are not established. Windows and Intel Mac GPU support remain partial/unsupported. Missing tools, malformed output, MIG/unknown partition modes, visibility filters, unknown cgroup limits, deadlines, and cancellation do not yield a complete inventory.

The collector deadline defaults to 15 seconds, configurable with `--timeout-ms` from 1 to 30000. Each local subprocess has at most 5 seconds and 1 MiB combined output. Device enumeration is bounded to 64 GPUs. Available memory expires separately after 30 seconds and is never a reservation or an automatically selected budget. Apple recommended working set remains unknown until directly measured; RAM is counted once, with the full GPU topology retained in observation evidence.

SSH runs a fixed Linux/Python 3 collector. It uses batch mode, strict host-key checking, a 5-second connect timeout, one connection attempt, disabled forwarding/proxy/local commands, and a bounded whole session. It never falls back to local hardware. The caller must provide a host already trusted through their normal SSH setup; unknown/changed keys fail. No host trust is created and no package, driver, or model is installed. Remote output retains capabilities, not SSH destinations or machine identifiers.

Discovery only GETs literal IPv4/IPv6 loopback endpoints: Ollama 11434 (`/api/tags`, `/api/ps`) and ports 8000/8080/8001/1234 (`/v1/models`). Three concurrent requests, two seconds per request, five seconds overall, 1 MiB per response. No redirects, ambient proxy, credentials, arbitrary URLs, or generation requests are accepted. A returned name proves only that the endpoint listed it, not that the artifact is pinned, loaded, runnable, or using a GPU.

Probe exit codes: 0 complete, 1 partial/unsupported/failed or refused persistence, 2 invalid usage, 3 cancellation. Discovery returns endpoint-specific statuses; unreachable optional endpoints do not by themselves fail the command. All JSON output is one document; commit notices go to stderr.

### Bound local evidence attachment

```sh
anvilmark hardware apply --file /tmp/sizing-input.json --candidate model.local --target target.local --observation-evidence inventory.local --constraint hardware.memory --id fit.local --scenario-id scenario.local --json > /tmp/fit-proposal.json
anvilmark hardware apply --file /tmp/fit-proposal.json --write --json
```

Before previewing, record the candidate and constraint using the existing project commands. The candidate must serve an existing workload, name the exact catalog model ID/revision/weight format, and deploy locally to the declared target with the same runtime name. Supply an explicit runtime version, allocation, reserve, overhead and allocator allowance in the sizing input. The constraint must be unconditional, soft, domain `hardware`, subject `candidate.model.local.memory_fit`, operator `eq`, value `true` (replace `model.local` with the actual candidate ID).

Preview recomputes the scenario and binds the actual project/base digest, IDs and persisted inventory. `--write` accepts that bound proposal only and checks the digest again inside the existing locked transaction store. It records T1 serving assumptions and a separate T2 tool observation, never a measurement or a decision. Matching includes declared versus observed hardware capabilities, exact model identity, workload, configuration, constraint, inventory and scenario fingerprints. Material edits make the evidence stale across admission, comparison, gaps and context; the CLI reconciles affected results to unknown and retains the historical records. A claimed pass that contradicts recomputed over-budget arithmetic is rejected.

Only complete supported memory accounting can attach. Runtime compatibility, latency, throughput, quality, and hard hardware gates remain unresolved. The current schema has no self-hosted hardware binding, so remote observations cannot be used for self-hosted fit attachment; a separate schema amendment is required. Browser-uploaded observation claims are unverified and do not substitute for the CLI-persisted observation.

## Units, formulas, and identity

All serialized quantities use exact integer bytes. The UI displays GiB (`2^30` bytes); decimal GB is `10^9` bytes. Integer multiplication and addition use BigInt internally and reject totals outside JavaScript's safe integer range.

Resident floating-point weights use **total parameters**, including all MoE experts. Nominal integer payload is `ceil(total_parameters * bits / 8)`; its stated metadata/mixed-precision allowance is added separately. These hypothetical layouts do not identify a downloadable quantized artifact.

For each attention group:

```text
KV bytes = layers * kv_heads * retained_tokens * concurrent_sequences
           * (key_head_dimension * key_bytes + value_head_dimension * value_bytes)
```

An explicit sliding retention window caps retained tokens only for that group. Active expert count never substitutes for attention dimensions. Runtime loading/prefill/decode overhead and allocator allowances are separate, required inputs for a complete total. Installed capacity never silently becomes an allocatable budget; unified memory is one pool, and device count is never a capacity multiplier.

`createSizingArtifact` accepts an injected SHA-256 text hasher and timestamp. Canonical JSON sorts object keys lexically and preserves array order. `input_digest` binds normalized input; `dependency_digest` also binds the model profile and catalog/estimator versions. `integrity_hash` includes the timestamp and derived result. Node and Web Crypto produce the same identity. Verification recomputes the result even if someone reseals edited numbers. A digest proves reproducibility, not hardware truth or provenance authenticity.

`project_binding` is optional proposal metadata. It is not a checked project attachment; no current contract is loaded or authenticated by this library. The bound example uses fictional identifiers and a placeholder digest. `ProbeArtifactSchema` retains the earlier `/1` draft envelope for compatibility. Collectors and imports use strict `ProbeSnapshotSchema` (`anvilmark-hardware-probe/2`); the formats are not interchangeable. T3 input claims are rejected by `SizingInputSchema`; all planning hardware inputs are T1 declarations.

## Per-device placement and calibration

The optional `anvilmark-sizing-extensions/1` input records imported inventory,
per-device budgets, an explicit placement profile, and optional calibration.
Without extensions, original `/1` sizing artifacts keep their existing numerical
and digest behavior. Extended results use estimator `0.2.0-draft.1`.

`contiguous-layer-residency/1` supports 2–16 homogeneous discrete GPUs on one host,
floating-point weights, and the two exact pinned model revisions. Layers must
cover the model once; embeddings live on the first device, final norm/output head
on the last, and KV follows layer placement. Each device needs its own allocation,
reserve, runtime overhead, and allocator allowance. Inter-stage/loading buffers
must be included in those declared allowances. Every device is assessed separately:
excess capacity elsewhere cannot hide one device's overflow. Aggregate required
bytes can be summed, but aggregate budget/headroom remain null. No runtime,
interconnect, throughput scaling, or multi-node support is implied.

`anvilmark-decode-calibration/1` requires an HTTPS source reference, revision,
methodology, validity window, and at least three decode samples. It applies only
when model revision, runtime/version, exact SKU/capacity/backend, weight/KV
precision, retained context, and single-sequence/single-device execution match.
The result reports the sample median and range as advisory; mismatches or expiry
leave speed null. Artifact creation evaluates calibration at the artifact's injected
time, and verification reproduces that same instant. A calibration file does not
authenticate measurements on the current target and cannot meet a T3 gate. No real
benchmark profile is bundled; synthetic profiles exist only in tests. There is no
universal `0.55` efficiency factor or active-parameter bandwidth extrapolation.

Both playground and Studio import inventory, scenarios, artifacts, and calibration
JSON up to 1 MiB. Imported inventory supplies T1 planning capacities; editing them
never edits the snapshot. File authenticity, dated availability, per-device
headroom, and unknown runtime support remain visible. Exports have a visible JSON
fallback and can be recomputed by the CLI. MCP capability flags are documented in
[the MCP README](../mcp/README.md).

## Catalog provenance

No code was copied from Odysseus. This implementation replaces its reviewed sizing heuristics with independent, explicit architecture calculations. The two publisher `config.json` fixtures were retrieved on 2026-09-17; formatting may differ from upstream. The catalog records immutable revisions, publisher configuration/index URLs, and license URLs. Qwen supplies an Apache-2.0 license file; Mixtral declares `license: apache-2.0` in its pinned model card; no model weights are bundled or downloaded by ANVILMARK.

| Publisher model                                                                                                                                     | Immutable revision                         | BF16 tensor-index bytes | Total parameters | FP16 KV at 32,768 tokens, one sequence |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------: | ---------------: | -------------------------------------: |
| [Qwen2.5-Coder-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/c03e6d358207e414f1eca0bb1891e29f1db0e242/config.json)        | `c03e6d358207e414f1eca0bb1891e29f1db0e242` |          15,231,233,024 |    7,615,616,512 |                          1,879,048,192 |
| [Mixtral-8x7B-Instruct-v0.1](https://huggingface.co/mistralai/Mixtral-8x7B-Instruct-v0.1/blob/eba92302a2861cdc0098cc54bc9f17cb2c47eb61/config.json) | `eba92302a2861cdc0098cc54bc9f17cb2c47eb61` |          93,405,585,408 |   46,702,792,704 |                          4,294,967,296 |

The BF16 index totals agree with parameter counts independently derived from the pinned configuration dimensions. Mixtral's active count is shared parameters plus two feedforward experts per layer: 12,879,925,248 parameters. This count is descriptive; it is not used to infer memory bandwidth or measured speed. Full resident storage includes all eight experts.

## Verification

```sh
pnpm --filter @anvilmark/hardware-sizing test
pnpm --filter @anvilmark/cli test
pnpm --filter @anvilmark/web test
```

Fixtures and tests run offline without a GPU. They cover independent byte totals, unknown handling, safe numeric boundaries, unsupported placement, digest/recomputation parity, read-only CLI behavior, and DOM interactions including export races and clipboard rejection. Current verification and hardware coverage are recorded in [the implementation record](../../docs/handoffs/hardware-sizing-implementation.md). The earlier [first-slice browser record](../../docs/handoffs/hardware-sizing-first-slice.md) is retained as history.
