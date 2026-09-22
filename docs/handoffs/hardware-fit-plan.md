# Implementation Plan: Hardware Sizing & Contract Cockpit

Revised: 2026-09-18. Target: `ANVILMARK-milestone-5`, branch `emergent-playground`.

Status: the bounded implementation now includes local/SSH inventory, explicit observation persistence, separate T1 declarations, local memory-fit evidence attachment with shared dependency checks, cockpit/Studio import, opt-in MCP tools, supplied calibration, and homogeneous per-device placement. See [the implementation record](hardware-sizing-implementation.md) for the tested scope and exclusions. The [first-slice record](hardware-sizing-first-slice.md) is historical. This plan does not ratify a schema amendment: remote self-hosted attachment, multi-node/offload placement, named quantized artifact support, and empirical benchmarking remain separate work. No fabricated calibration or target measurement is shipped.

## 1. Outcome and delivery boundary

ANVILMARK remains an independent architectural decision, contract, and conformance verification layer for AI systems built with coding agents. Hardware sizing helps a developer choose and document an application deployment; ANVILMARK does not become an agent, model host, purchasing adviser, or automatic deployment service.

The cockpit must answer: **“Under these workload, runtime, and hardware assumptions, what is the estimated memory requirement, what remains unknown, and what evidence is needed before relying on this deployment?”**

The useful workflow is:

```text
workload + declared target + exact model/runtime configuration
  -> reproducible sizing estimate and explicit unknowns
  -> versioned sizing proposal and agent handoff
  -> CLI validation and optional contract attachment
  -> target measurements and existing conformance checks
```

Keep the current playground's real scanner/conformance path and Studio's review-bundle verification. Add sizing as a connected decision workbench. A calculator must not replace the demonstration that ANVILMARK checks code against an independently recorded contract.

### Initial release

- Pure, browser-safe memory sizing for explicitly supported dense and MoE attention architectures on one discrete GPU, a CPU memory pool, or Apple Silicon unified memory.
- Versioned model/hardware/runtime profiles; workload-specific context, concurrency, and KV precision.
- Read-only local probing and explicitly requested, bounded endpoint discovery.
- Transactional storage of complete observed hardware and explicit creation of a separate declaration.
- Playground/Studio sizing scenarios, portable proposal export, and projected agent handoff.
- Project MCP calculation and opt-in local probing, using the active project server.
- Advisory decode estimates only within a documented, calibrated profile. Missing calibration leaves numeric throughput unknown; it does not block the memory-sizing feature.

### Subsequent delivery

- Broader fit-evidence subjects beyond the implemented soft local memory-fit comparison.
- Remote self-hosted contract binding after scoped schema work. Bounded Linux SSH inventory is implemented independently.
- Additional multi-GPU placement profiles beyond the implemented single-host homogeneous contiguous-layer profile; multi-node only when topology and communication are represented.
- Runtime-specific offload estimates and target benchmark ingestion. This plan does not add automatic benchmark execution, model downloads, or model-server launch/stop operations.

Unsupported configurations remain visible with a reason. Do not substitute smaller context, lower precision, fewer concurrent requests, another model, or another machine to manufacture a fit.

## 2. Evidence and authority invariants

[Decision 06 sections 5, 6, 8, and 9](../vnext/06-contract-ratification-decision.md) remain authoritative. Reuse the implemented [evidence tiers and admission rules](../../packages/project-contract/src/evidence-tiers.ts).

| Input or result                                                             | Representation and permitted claim                                                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| User chooses a target or edits a preset                                     | T1 `user_declared`; authoritative for intended deployment, not proof of observed capacity                                                 |
| Probe directly reads inventory or a runtime limit                           | T3 `deterministic_observation` about the observed subject and collection scope only                                                       |
| Publisher supplies bandwidth, architecture, or license information          | Attributed source with URL, revision/date, and applicable evidence kind; published bandwidth is not measured effective bandwidth          |
| Calculator derives memory or decode speed                                   | Reproducible estimate; eligible attached compatibility evidence uses T2 `tool_observation` with assumptions and required subject matching |
| Workload benchmark measures target performance                              | T3 `measured_evaluation` or `runtime_measurement`, with the existing configuration, workload, and target attribution requirements         |
| Required input, supported implementation, or admissible evidence is missing | Explicit unknown with a reason; never zero, a fabricated default, or a formal pass                                                        |

Deterministic execution describes repeatability, not evidence strength. A T3 inventory observation does not promote derived sizing or speed estimates to T3. An assumed allocation percentage is not a probed fact. A `Hardware.evidence_kind` field also does not replace an attributable evidence record.

### Planning versus admitted evidence

The current `hardwareObservationProblem` requires separate declared and observed hardware references and matching capabilities. Preserve this rule. A hypothetical H100 preset with no matching observation is a planning scenario, not admitted compatibility evidence. Do not create a fictional detected subject or weaken the matcher for web convenience.

The cockpit shows these independent dimensions:

- Input basis: declared, observed, published, or assumed.
- Estimate status: calculated, incomplete, or unsupported.
- Memory assessment: estimated within budget, estimated over budget, or unknown.
- Contract evidence: unattached, insufficient, current, or stale, as resolved by the existing fact/evidence layer.
- Performance requirement: unverified until applicable measurement is admitted.

The UI must never compute a contract verdict from a green memory bar. Estimated throughput cannot settle latency, hardware-performance, or workload-quality gates. Do not fabricate `latency_p95_ms` from tokens/second. Thresholds come from the selected workload; 800 ms is only a possible example.

### Mutation and presentation boundaries

- Adapters return validated outcomes; only CLI workflows write the contract.
- Web and MCP cannot finalize decisions or mutate the authoritative project through sizing controls. Renaming an action does not change its authority.
- `packages/web/app/` and the existing MCP source boundary retain zero case-insensitive `/approv/i` occurrences, including comments, identifiers, and test text placed inside those trees. Keep the guard itself in the existing external test location.
- Preserve remote-default projection: hostnames, usernames, device identifiers, absolute paths, local commands, credentials, and raw probe output do not enter shared bundles or agent handoffs.

## 3. Data contracts and compatibility decisions

The current project schema is `0.1.0-draft.5`; the historical `@anvilmark/contract` line remains unchanged. Current limitations must be handled explicitly:

- `HardwareSchema` requires CPU and RAM and has no shared-pool, available-memory, per-device placement, or partial-observation representation.
- Workloads do not currently carry serving context length, concurrency, or KV precision.
- `DeploymentSchema` has `hardware_ref` for `local`, but not `self_hosted` deployments.
- Existing hardware matching compares capacity and accelerator grouping strictly. Two entries with count one and one entry with count two are not automatically equivalent.
- Resolved decision content includes selected candidates and cited evidence, not the contents of every hardware resource referenced by id.

### Versioned planning artifacts

Introduce strict, browser-safe formats in the pure sizing package:

1. `anvilmark-hardware-probe/2` (the earlier `/1` draft envelope is retained for compatibility but is not accepted as a collector snapshot): validated collection envelope, observed fields, collection scope, timestamp, source/version, per-capability diagnostics, and completeness. Private host/device identity stays in the local envelope, separate from its public capability projection.
2. `anvilmark-hardware-sizing/1`: input scenario, reproducible result, dependencies, assumptions, exclusions, unknowns, and optional project binding.

These are new artifact formats, not implicit additions to `project.yaml`. A version discriminator, bounded arrays/strings, finite numeric validation, and rejection of unknown executable fields are mandatory. Artifacts cannot supply shell commands, dynamic imports, or arbitrary endpoints to execute.

Minimum sizing input:

- Exact catalog model id and immutable revision/artifact identity; total parameters and architecture metadata.
- Weight format/quantization and independent key/value cache formats.
- Runtime id/version or named assumption profile, backend, attention implementation, and supported-feature matrix.
- Maximum retained tokens **per sequence**, concurrent resident sequences, expected input/output lengths when known, and any separately reserved output tokens. Distinguish full context from prompt length; never add output reserve twice.
- Memory pools in bytes, devices and pool membership, installed capacity, observed availability/runtime recommendation when known, user-selected reserve, and the basis of every quantity.
- Placement mode and selected device ids; supported profiles cover one device/shared pool and the pinned single-host homogeneous contiguous-layer placement.
- Published bandwidth source and exact SKU when known; optional calibration profile identity.

Minimum result:

- Weights, KV, runtime/activation estimate, allocator allowance, and per-pool/device totals; unavailable terms remain null with reasons.
- Budget basis, estimated headroom, uncertainty assumptions, and separate completeness/compatibility status.
- `estimated_decode_tokens_per_second`, nullable, with its applicability and calibration; no synthesized P95.
- Canonical input digest, catalog/profile revisions, estimator version, units, and evaluation timestamp kept separate from the deterministic numerical inputs.
- Optional project id, base contract digest, workload/candidate/target references, and proposed create/attach operations. No project binding means standalone planning only.

Use the same canonical representation across Node and browser; digest it with platform-appropriate crypto at the boundary. Digests establish content identity, not the truth of a claimed observation or the authenticity of a pasted probe file.

### Contract attachment and schema work

The initial planner stores serving assumptions in its artifact. Do not insert undeclared keys into strict project schemas or infer concurrency/context capacity from monthly usage.

Before adding new authoritative serving fields, shared-memory semantics, or self-hosted hardware references, record a scoped amendment through the repository's existing decision process. Include serialization, migration, integrity validation, projections, examples, and compatibility tests. This plan does not assert that such an amendment is already ratified.

For compatible current-schema cases, use existing evidence payloads with a strictly validated, versioned `estimate_basis` and `findings` structure. Persist all claim-critical inputs, units, assumptions, and fingerprints inside the cited record, not only adapter annotations or an external file. The evidence builder currently requires constraint attribution: unbound inventory probes use a dedicated observation-record constructor validated by `EvidenceRecordSchema` and secret scanning, rather than inventing a constraint solely to satisfy that builder.

Do not attach tool observations until both hardware subjects resolve, kinds are correct, capabilities match, and candidate/workload/constraint attribution is valid. Missing metadata or unsupported schema representation produces a gap. Preserve the existing llmfit adapter as an optional evidence producer; do not silently change its semantics or double-count its evidence.

### Dependency freshness and decision content

Before any sizing evidence can settle a compatibility constraint, implement dependency checks in the shared admission/freshness path used by CLI, context facts, MCP, and web bundle generation/reading. A label such as `on_hardware_or_model_change` without comparison logic is insufficient.

Bind estimates to canonical snapshots/fingerprints of the declared and observed capabilities, candidate artifact/quantization, runtime/configuration, retained tokens, concurrency, KV format, placement, catalog/profile revisions, and estimator version. Historical estimates retain their original pinned profile; comparing against a changed requested profile requires recomputation.

- Replacing or editing a dependency must not leave a formerly applicable result usable merely because its reference id is unchanged.
- New probes create snapshots; old evidence keeps its original references. Stable machine identity and observation identity are different concepts.
- Availability/pressure has a short, explicit freshness window, separately from installed capacity. A probe cannot reserve the reported free memory.
- Preserve recorded decision history. Changed cited evidence follows existing reconciliation; stale evidence is independently surfaced even where the recorded decision hash remains unchanged.
- Existing documents lacking the new dependency material must remain readable, with explicit insufficient evidence where required. Any tightening that changes accepted contract semantics needs documented migration/decision coverage, not silently invalidated fixtures.

## 4. Memory and throughput model

### Units and numeric safety

Compute in bytes. Treat GB as decimal `10^9` and GiB as binary `2^30`; display the selected unit explicitly. Normalize command output using documented source units, including NVIDIA MiB and kernel memory units. Preserve legacy contract capacity conventions until a documented conversion/migration is established; test presets against the current strict capability matcher. Never round before admission or capacity comparisons.

Reject negative, non-finite, zero-where-invalid, fractional-count, and out-of-range inputs. Bound products to safe integer arithmetic, or use a defined lossless representation; never silently overflow JSON numbers.

### Resident weights

```text
weight_bytes = sum(tensor_elements × storage_bytes_per_element)
             + quantization_metadata + padding/alignment
```

Prefer pinned tensor/format metadata. A nominal parameter-count multiplier is a labeled fallback with uncertainty. File size alone is not runtime residency: loading copies, conversion/repacking, and runtime buffers may differ.

For fully resident MoE, include **all** experts and shared weights. Active parameters describe per-token work, not resident capacity. Model expert offload only through a supported runtime placement profile.

Quantization support is a matrix of architecture, artifact format, runtime/version, backend, and device capabilities. `FP8`, GGUF `Q4_K_M`, AWQ, and GPTQ are not interchangeable because their nominal bit widths match. A catalog entry may offer only formats backed by real artifact metadata or clearly labeled hypothetical storage assumptions; hypothetical formats cannot claim runtime compatibility.

### KV cache

For conventional attention with equal key/value head dimensions and precision:

```text
KV_bytes = 2 × concurrent_sequences × retained_tokens
             × layers × KV_heads × head_dimension × bytes_per_KV_element
```

The implementation uses a layer-wise key-plus-value sum so differing dimensions, precision, attention windows, and placement are representable. Full attention retains the configured sequence length; sliding-window layers use their supported retention policy. Quantized KV includes scale/block overhead. Runtime paging, static preallocation, prefix sharing, beam expansion, and replication must be explicit. Default to no assumed prefix sharing.

MoE routing does not replace attention architecture in this calculation. Remove the `0.000008 × KV_Params × Context` heuristic and its active-expert explanation. MLA, hybrid/state-space, multimodal cache, and unsupported attention layouts return unsupported until implemented; they do not fall back to this formula silently.

Reference arithmetic fixtures, excluding runtime overhead:

| Configuration                                                                                     | Expected KV result             |
| ------------------------------------------------------------------------------------------------- | ------------------------------ |
| Qwen2.5-Coder-7B: 28 layers, 4 KV heads, head dimension 128; one sequence, 32,768 tokens, FP16 KV | 1,879,048,192 bytes = 1.75 GiB |
| Mixtral-8x7B: 32 layers, 8 KV heads, head dimension 128; one sequence, 32,768 tokens, FP16 KV     | 4,294,967,296 bytes = 4 GiB    |
| Same Mixtral configuration, two independent resident sequences                                    | 8,589,934,592 bytes = 8 GiB    |

Pin publisher configuration revisions when building these fixtures. The Mixtral result is about 4.295 GB; the removed active-parameter heuristic gives about 3.382 GB. At idealized four-bit storage, 46.7B total parameters require 23.35 GB before metadata/cache, not the 6.45 GB implied by 12.9B active parameters.

### Runtime memory and fit status

```text
required_bytes = resident_weights + KV_cache
               + runtime_and_activation_budget + allocator_allowance
headroom_bytes = usable_budget_bytes - required_bytes
```

Remove the universal 0.5 GB buffer. Version runtime profiles for prefill/decode activation peaks, batch/microbatch, graph capture, workspaces, allocator behavior, and loading peaks. Where unavailable, report known components and the missing term; do not present an incomplete total as a fit.

Known components alone exceeding a known budget can establish an estimated lower-bound overflow. Known components below budget with unknown overhead cannot establish estimated fit. A sensitivity interval is labeled as such, not a statistical confidence interval without calibration data.

Replace `perfect/good/tight/spill_to_ram/oom` as decision outcomes with `estimated_within_budget`, `estimated_over_budget`, and `unknown`. Optional headroom bands are presentation policy, separate from compatibility and contract verdicts. “Estimated over budget” is not an observed runtime OOM. Validate every selected device/pool, including reserved capacity and co-resident workloads.

### Apple Silicon and CPU memory

Represent unified physical memory once, with CPU and GPU allocations drawing from the same pool. Do not add RAM to a derived “VRAM” capacity or report a second spill pool.

Use observed Metal `hasUnifiedMemory` and `recommendedMaxWorkingSetSize` when an optional, versioned native helper/runtime capability is available. The latter is a performance recommendation, not free memory or a guaranteed allocation ceiling. Keep physical bytes, observed recommendation, current availability/pressure, and runtime limit distinct. No mandatory Xcode/Swift installation or compilation during probing; if the helper is absent, report the gap.

The 75% assumption may be offered only as an explicitly selected planning policy, never as a probed value. A user can set a planning budget without changing observed inventory. If the legacy hardware schema cannot represent the observation without conflating physical capacity and recommendation, retain the detailed probe artifact and refuse that lossy contract write.

CPU-only sizing uses a usable host-memory budget with OS/application reserve. Unknown CPU bandwidth or runtime support leaves throughput/compatibility unknown.

### Multiple GPUs and offload

Inventory every visible device; group for display only. Identical names/counts do not establish a usable pooled allocation or runtime compatibility. Until a supported placement profile is selected, aggregate VRAM is inventory information only.

Later profiles must specify tensor/pipeline/expert parallelism, runtime/version, architecture divisibility, KV sharding/replication, device-local overhead, and PCIe/NVLink/network topology. Require `required_bytes_i <= usable_budget_bytes_i` for every device. Replicas do not combine capacity for one model. Multi-node capacity requires explicit nodes and communication topology.

Do not inherit the claim that GGUF/llama.cpp cannot use multiple GPUs. Support depends on actual runtime split modes. Do not multiply bandwidth by GPU count without modeling communication and bottlenecks.

CPU/GPU offload requires explicit host/device placement, staging buffers, runtime support, and transfer costs. Neither `required <= RAM` nor `required <= RAM + VRAM` proves feasibility. There is no universal 0.5 speed penalty. Unsupported offload returns an explanation and no numeric throughput.

### Advisory decode throughput and latency

The bandwidth ratio is only a weight-dominated, single-sequence decode heuristic:

```text
estimated_decode_tokens_per_second
  ~= effective_bandwidth_bytes_per_second / weight_bytes_read_per_token
```

For dense models, weight traffic may approximate resident weights per step in that regime. For MoE, derive shared-plus-selected-expert traffic from architecture; still account for routing and distinct experts touched under batching. Long-context KV traffic, compute, kernel behavior, and interconnect costs can invalidate the weight-only regime.

Remove the universal efficiency constant `0.55`. A profile may include a measured efficiency/range only with runtime, model family, quantization, context/batch envelope, device SKU, measurement methodology, source, and revision. Otherwise show published bandwidth as a specification and leave the speed estimate unknown. Custom capacity sliders do not imply a bandwidth value.

Never infer P95 from decode speed. The declared metric must distinguish time to first token, inter-token latency, and full-response latency. Request latency also includes queueing, prefill, output length, and other overhead. Existing ambiguous latency declarations remain unresolved for measurement admission until metric meaning is supplied through the agreed configuration/schema path.

## 5. Local probing, snapshots, and CLI writes

Implement Node-only detector strategies through the existing bounded subprocess runner and injectable filesystem/platform interfaces. No mandatory llmfit installation; vendor tools such as `nvidia-smi`, the OS utilities, and later `ssh` are optional external dependencies whose absence is reported.

Probe outcomes are `complete`, `partial`, `unavailable`, `unsupported`, or `failed`, with per-capability diagnostics. Observed empty GPU inventory differs from an inability to inspect GPUs. A partial result may display verified fields, but cannot be written as a complete `Hardware` entry with guessed CPU/RAM/backend fields.

| Platform      | Collection requirements                                                                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NVIDIA        | Parse structured CSV with documented units; preserve exit status/stderr for driver mismatch; distinguish installed/used/free memory, MIG/vGPU partitions, and process-visible devices. Do not treat row position as stable identity or assume `CUDA_VISIBLE_DEVICES` is honored by inventory tools. |
| AMD/Linux     | Verify device/vendor and read total, visible, and used values independently. Visible VRAM or GTT does not establish APU topology; sysfs presence does not prove ROCm/runtime support.                                                                                                               |
| Apple Silicon | Use architecture/chip identification and physical memory observations; distinguish Intel Macs/Rosetta and unknown chip variants. Backend capability and usable allocation are separate observations.                                                                                                |
| CPU/Linux     | Distinguish installed host memory from container/cgroup limits, process CPU allocation, and `MemAvailable`; do not merge these quantities.                                                                                                                                                          |
| Other/Windows | Return supported CPU/RAM facts and explicit unsupported GPU capabilities until tested collectors exist. Never convert an unimplemented collector into “no GPU.”                                                                                                                                     |

Collection records scope (`host`, `container`, `process`, `remote`), timestamp, detector version, sanitized source identity, and per-field basis. No module-global remote host, shared mutable detection state, or cache shared across unrelated targets. Cache by scope/profile with expiry; a refresh does not rewrite old snapshots.

### Commands and collision rules

Extend the existing `hardware` command group in `packages/cli/src/commands/edit.ts` through a dedicated hardware dispatcher. Preserve `hardware add`, its usage, and T1 semantics; update the router without introducing two competing handlers.

```text
anvilmark hardware probe [--id OBSERVED_ID] [--json]
anvilmark hardware probe --write --id OBSERVED_ID --evidence-id EVIDENCE_ID
                         --capacity-unit gib|gb [--as-declared NEW_TARGET_ID] [--json]
anvilmark hardware probe --host user@host [--port 22] [--known-hosts ABSOLUTE_PATH]
                         [--timeout-ms 15000] [--json]
anvilmark hardware discover [--json]
anvilmark hardware estimate --file SCENARIO_OR_ARTIFACT_JSON [--json]
anvilmark hardware recommend --file SCENARIO_JSON [--json]
anvilmark hardware apply --file SCENARIO_OR_ARTIFACT_JSON --candidate ID --target ID
                         --observation-evidence ID --constraint ID --id NEW_EVIDENCE_ID
                         --scenario-id NEW_SCENARIO_ID [--json]
anvilmark hardware apply --file BOUND_PROPOSAL_JSON --write [--json]
```

`hardware apply` is delivered with contract attachment, not before its freshness prerequisites. All calculation commands are read-only. `recommend` compares hardware feasibility for the workload under explicit assumptions, with visible exclusions; it does not declare a global best model or import upstream parameter-count quality scores.

- Default observation ids are opaque, generated snapshot ids, not hostnames and not a reused `local-machine` id.
- `--id` always identifies the observed snapshot. Any existing id collision fails without a write, even if contents appear identical. Re-running without an explicit id creates a new snapshot; no upsert.
- `--as-declared NEW_TARGET_ID` requires `--write` and a distinct target ID. Persistence also requires an evidence ID and an explicit `--capacity-unit gib|gb` conversion for legacy hardware fields. Atomically create the T3 observation and a separate T1 declaration, each with appropriate provenance. The declaration records explicit user intent; it does not relabel the observation or alter candidate references. Existing target ids fail rather than being replaced.
- Complete observational facts must satisfy `HardwareSchema` without invented fields. Missing/partial/unsupported required facts refuse `--write`; diagnostics remain available in JSON.
- Use the existing `addHardware`, edit/reconciliation flow, and `commitRevision` for full validation, secret scanning, lock, expected digest, history, and atomic project replacement. Never write YAML directly from a detector. The common `commit` wrapper currently prints human text to stdout: separate its rendering from the transaction, or use an explicit JSON-aware output path, so `--json` stays valid without bypassing reconciliation.
- `hardware apply` previews a bounded create/attach operation. `--write` is explicit consent for that displayed operation; revalidate its base contract digest, ids, exact candidate/model/quantization, subjects, and dependencies at commit. Existing candidate selection and decisions are untouched. Any required new candidate or deployment change uses the existing explicit workflow.
- A standalone web scenario is not an applicable project patch. CLI preview must bind it to the actual project and return a project-bound proposal before application. Recompute estimates locally; do not trust imported result numbers or a file's claim to contain T3 evidence. Require stored local observation provenance for evidence admission, or collect a new explicitly requested probe.
- Use existing exit codes: `0` successful complete operation (including a valid estimate with unknown fit), `1` failed/refused/incomplete required probe, `2` invalid usage/input, `3` cancellation. Optional discovery failure is a diagnostic unless explicitly required by the caller. JSON stdout contains exactly one versioned result envelope; human diagnostics go to stderr.

Probe execution defaults: 5 seconds per local subprocess, 15 seconds total inventory deadline, 1 MiB combined output per subprocess, bounded device enumeration and concurrency, and cancellation with termination escalation. These limits are injectable in tests; overrides have documented finite maxima. Do not auto-install tools, use privilege escalation, invoke login shells, or mutate drivers/settings.

## 6. Endpoint discovery and remote probing

### Endpoint discovery

Discovery is explicit through `hardware discover`; it issues bounded inventory requests only. It never downloads, loads, starts, stops, benchmarks, or generates with a model.

- Check literal IPv4/IPv6 loopback addresses at documented ports: Ollama 11434, generic OpenAI-compatible 8000/8080/8001, and LM Studio 1234. Ports are hints, not runtime identities.
- Use Ollama `/api/tags` for installed inventory and `/api/ps` for loaded models. Inspect additional metadata only through supported, bounded APIs; absence of quantization/revision/context details remains unknown.
- `/v1/models` proves only that an endpoint lists a model. Do not infer vLLM identity, local execution, GPU placement, readiness, or model artifact equivalence from a compatible response.
- Report unreachable, timed out, authentication required, malformed, and valid-empty responses distinctly. Cap each body at 1 MiB, use a 2-second per-request and 5-second aggregate deadline, and at most three concurrent requests.
- Disable redirects and unintended proxy use; discovery destinations remain literal loopback. No arbitrary URL or shell command from imported data. Credentials, if later supported, use existing runtime references and never enter artifacts.
- Keep discovery observations separate from physical hardware evidence; an endpoint can proxy another machine. A browser does not probe the user's machine or run SSH. A hosted Next.js server must not be presented as the user's hardware.

### SSH probing: implemented Linux boundary

`--host`/`--port` select the bounded remote Linux collector, which requires Python 3. Other remote operating systems produce an unsupported outcome. Remote contract attachment remains a separate schema concern.

The mandatory SSH baseline is:

```text
ssh -T -n
  -o BatchMode=yes
  -o ConnectTimeout=5
  -o ConnectionAttempts=1
  -o StrictHostKeyChecking=yes
  -o ForwardAgent=no
  -o ClearAllForwardings=yes
  -p PORT DESTINATION FIXED_REMOTE_COMMAND
```

Supply arguments as an array without a local shell. Validate host/user/port syntax and reject option-like destinations; remote commands are fixed platform-specific commands without untrusted interpolation. Use a documented, trusted SSH configuration policy; CI supplies a preconfigured known-hosts file. Reject unknown or changed host keys. Do not use `StrictHostKeyChecking=no`, bypass trust with `/dev/null`, auto-enroll keys, or execute arbitrary config from a project artifact.

`ConnectTimeout` does not bound a connected command. Apply a 15-second default whole-session deadline (`--timeout-ms` is bounded at 30000), a fixed 12-second remote collector alarm, output caps, cancellation, and local process-tree cleanup; keep remote commands short/read-only and do not claim remote descendant cleanup is guaranteed after connection loss. Authentication failures must not trigger interactive fallback. If SSH-agent access is needed, add narrowly scoped `SSH_AUTH_SOCK` forwarding to the subprocess environment; never broadly inherit secrets or record its value.

Remote OS/CPU/RAM/GPU observations must all come from the selected remote scope. Never fall back to local `os.totalmem()`/`os.cpus()` after remote failure. Local endpoint discovery is a separate `hardware discover` command; combining it with SSH probing is not supported. There is no `--detect-local` flag. Keep target identity in local provenance and apply remote-default redaction before returning results to an agent.

CLI destination selection is explicit. The implemented opt-in MCP probe accepts no arguments and is local-only; remote aliases and caller-supplied SSH destinations or commands are not exposed. Failed probing must leave the contract and selected target unchanged.

## 7. Package and integration changes

| Area                             | Planned files and responsibilities                                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New `@anvilmark/hardware-sizing` | `src/schema.ts`, `src/memory.ts`, `src/throughput.ts`, `src/placement.ts`, `src/catalog.ts`, `src/index.ts`; pure data validation/calculation, explicit profiles, no Node APIs, I/O, wall-clock reads, or imports from adapters/CLI/context |
| Adapters                         | `src/hardware/detector.ts`, platform collectors, `discovery.ts`, `evidence.ts`, and later `remote.ts`; Node-only orchestration, existing outcome envelopes/runner, validated observations, provenance, and evidence construction            |
| Project contract                 | Scoped schema/amendment work where required; integrity/admission and dependency identity coverage; preserve frozen historical schema and explicit migrations                                                                                |
| CLI                              | Dedicated hardware command/workflow files; extend existing dispatch; proposal preview/application through common edit/store boundaries; stdout/stderr and exit-code compatibility                                                           |
| Context                          | Extend `facts.ts`, `agent-context.ts`, and freshness integration for admitted sizing facts and gaps; add a focused handoff-budget module if needed. `index.ts` only re-exports APIs.                                                        |
| Project MCP                      | Extend `project-tools.ts`, relevant query/input types and `project-server.ts` help/configuration. Keep legacy `server.ts` fixture surface unchanged.                                                                                        |
| Web                              | New `app/components/HardwareSizingCockpit.tsx`; integrate `PlaygroundClient.tsx` and `StudioClient.tsx`; put schema/domain translation outside `app/`; preserve bundle verification and scanner flow                                        |

Add package dependencies, workspace lockfile changes, TypeScript project references, and package exports deliberately. The dependency direction is pure sizing -> adapter wrappers -> CLI/context consumers, with web importing the pure sizing package directly. The pure package must not import the project-contract root barrel just to access a Node-dependent helper. Use boundary mapping rather than a new package cycle.

### MCP behavior

- `calculate_model_fit`: pure calculation over bounded versioned inputs or a selected project scenario. Return input basis, assumptions, unknowns, source marker, and digest; never write, probe implicitly, or claim a benchmark.
- `probe_hardware`: opt-in local capability configured at server startup; fixed read-only collectors, no write flag. Optional discovery requires a separate explicit argument. Remote aliases remain disabled until the SSH phase.
- Accurate tool annotations: the calculator is read-only, deterministic for fixed inputs, and closed-world. The probe is read-only and idempotent in its effects, but its observations can change between calls; mark its interaction with the OS/endpoints as open-world. Do not confuse idempotent effects with identical returned data or blindly reuse the existing closed-world annotation.
- Apply the server's remote-default projection to hardware and diagnostics. A local MCP process does not authorize disclosure to a remote model.
- Update exact project-tool-list tests and stdio verification for the enabled capability set. The legacy server remains exactly its existing three tools; the default project surface stays unchanged unless the new capability is enabled and documented.

### Agent handoff and token budgeting

Use the receiving coding agent/model's explicitly supplied budget, separate from the application inference model being sized. Account for system/tool context, current conversation where supplied, reserved output, and safety margin. Do not claim a whole-session guarantee when the recipient's hidden/current context is unknown.

Label tokenizer identity/version and exact versus approximate counts. Approximate token counts cannot satisfy a T3 token gate. Preserve mandatory constraints, source identity, decision standing, evidence gaps, and safety-relevant caveats; if they do not fit, return a budget error or a retrieval-based handoff. Optional excerpts may be omitted only with a visible omission manifest and retained source references. Do not silently truncate the generated contract facts.

Delimit external data and escape delimiter collisions/markup, but describe these as trust-labeling measures, not prompt-injection prevention. Keep instruction text separate from untrusted reference text. Do not add automatic document fetching. Apply existing projection and secret scanning before clipboard/export; the action copies a draft brief and does not contact an agent service.

## 8. Web experience and export

### Controls and result presentation

- Choose standalone planning or a workload from a verified bundle; label synthetic examples and imported observations accurately.
- Offer exact SKU presets with variant-specific bandwidth and memory, or custom capacity with unknown bandwidth. A preset is declared/planning data. Importing a file does not authenticate hardware ownership.
- Select exact model artifact/profile, runtime/backend, supported quantization, KV precision, maximum retained context, and concurrent sequences. Advanced controls expose reserve, runtime profile, and supported placement. Context bounds follow the selected model/runtime; extended context requires an explicit supported configuration.
- Show stacked memory components plus unknown terms and estimated headroom, using numeric labels and accessible status text rather than color alone. Shared memory is a single pool; future multi-GPU views show every device.
- Display advisory throughput only when its profile applies, with basis and limitations. Always distinguish memory fit, runtime compatibility, and performance evidence.
- Keep imported Studio facts immutable. Every changed control creates a planning draft; clear result freshness on dependency changes and ignore late responses for obsolete inputs. Original bundle hash/verification status never transfers to modified scenarios.

### Actions

Use “Copy sizing brief”, “Export sizing proposal”, and “View evidence needed”. Do not advertise “Export to project.yaml” when exporting a fragment or planning artifact.

Export strict `anvilmark-hardware-sizing/1` JSON containing reproducible inputs/results and safe provenance. Project-bound proposals include the exact base contract digest and intended create/attach operations; standalone proposals explicitly have no project binding. CLI preview validates and recomputes the file. No browser filesystem write or authoritative mutation is required.

A Studio remote-default bundle may omit exact configuration detail. Display a gap and request an explicit local binding/import through the CLI instead of reconstructing private hardware from presentation strings. Preserve code-to-contract navigation and the existing conformance handoff.

Provide keyboard-accessible sliders with numeric input alternatives, clear units, loading/error states, clipboard failure handling, reset behavior, and responsive layouts. Rapid slider edits must produce deterministic final results. No private host identifiers in shareable URLs or browser telemetry.

## 9. Catalog provenance and adaptation rules

Start with a small set of exact publisher artifacts covering Qwen2.5-Coder dense GQA and Mixtral-8x7B MoE. Add particular Llama/DeepSeek distill/Gemma versions only after their configurations and runtime support are represented. Family names and parameter sizes do not imply that every cross-product is a real model. Use “open weights” unless the specific license supports a stronger claim.

Each model entry records publisher URL, immutable revision, architecture, total/active/shared/expert parameters where applicable, attention metadata, supported context, artifact format/quantization, and license evidence. Hardware entries record exact SKU, memory variant, bandwidth source/unit, and revision. Runtime profiles record version, supported combinations, allocation assumptions, and calibration provenance. No live catalog fetch is needed to reproduce a saved estimate.

Treat `reference/odysseus/services/hwfit/` as audited source material, not an authoritative specification. Pin the audited upstream commit and copied paths, retain applicable notices, and record adaptations. Do not import its active-parameter KV heuristic, blanket GGUF restriction, arbitrary quality scores, silent quantization/context fallback, mutable remote globals, or swallowed subprocess errors.

Avoid adding the entire reference checkout to the shipped workspace. Ensure scoped lint/format exclusions or external reference placement are intentional; do not hide ANVILMARK source failures with broad ignores. Model/hardware catalog updates are reviewable data changes with fixture updates, not silent recommendation changes.

## 10. Delivery sequence and exit criteria

| Phase                            | Deliverable                                                                                                                                                  | Exit criterion                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 0: contracts and fixtures        | Versioned artifact schemas, supported-profile matrix, canonicalization/units policy, exact catalog fixtures, amendment scope and dependency-freshness design | Representative standalone and project-bound examples validate; no invented observed subjects; schema-gated work explicitly identified |
| 1: pure estimator                | Browser-safe package, weights/KV/runtime/placement calculations, unknown handling, conditional decode estimates                                              | Independent arithmetic and boundary tests pass; no Node dependency in the browser import graph                                        |
| 2: local observations            | Local detector, optional discovery, probe CLI and snapshot writes, separate declaration creation                                                             | Failure/collision/cancellation/concurrency tests prove no clobbering; hardware facts and assumptions remain separate                  |
| 3: cockpit and read-only tools   | Interactive web workbench, proposal export/CLI recomputation, projected handoff, opt-in project MCP tools                                                    | Real browser interactions and cross-surface calculation parity pass; existing conformance and bundle workflows remain functional      |
| 4: contract evidence             | Required accepted amendments, dependency admission/freshness, project-bound apply and history integration                                                    | Changes to every material dependency invalidate applicability everywhere; estimates cannot settle performance/quality gates           |
| 5: remote and advanced placement | Bounded SSH collector, self-hosted mapping, explicit multi-device/offload profiles                                                                           | Target-isolation and host-authentication tests pass; each supported topology has per-device accounting and documented applicability   |

Phases may ship incrementally with the stated limits. Phase 4 and 5 capabilities must not appear as available UI actions or accepted CLI flags before their prerequisites pass. New profile support requires its own fixtures; generic “supports all GPUs/models” claims are out of scope.

## 11. Verification and acceptance tests

### Evidence, persistence, and identity

- T1 target remains byte-for-byte unchanged after local/remote probe, failed write, colliding id, and repeated probe. T3 observation and T1 declaration always have different ids and provenance.
- `--as-declared` missing `--write`/`--declared-id`, colliding target ids, partial observations, and concurrent project edits refuse without contract/history corruption. Atomic two-record creation is failure-injected.
- Estimate records cannot be relabeled as measured performance. Presets without matching observations cannot produce admitted compatibility evidence. Backend/model/quantization/target mismatches and missing attribution remain unknown/refused.
- Changing hardware capability contents under the same id, candidate artifact, runtime, context, concurrency, KV precision, placement, or profile changes applicability across CLI, context, MCP, and bundles. A stable decision hash must not conceal stale supporting evidence.
- Web-imported forged T3 claims and edited result numbers do not gain trust from valid JSON/digests. CLI recomputation and local observation attribution are exercised.
- Legacy schema documents, llmfit fixtures, migrations, exact decision-history behavior, evidence gaps, and projection redaction continue to work. New claim-critical assumptions survive serialize/parse/export cycles.

### Mathematics and compatibility

- Check the independent Qwen/Mixtral byte totals above; verify resident MoE weights use total parameters while changing active expert count alone does not change an unchanged attention cache.
- Cover GQA/MQA, differing KV formats, batch/concurrency, full versus sliding attention, runtime preallocation and padding, missing architecture metadata, unsupported formats, and extended-context refusal.
- Cover unit conversion, safe numeric limits, zero/negative/NaN/infinite input, exact-capacity boundaries, unknown overhead, known lower-bound overflow, and per-device rather than aggregate fit.
- Unified memory is counted once; unknown allocation limits remain unknown. CPU offload is never inferred solely from RAM capacity. Multi-GPU inventory alone cannot establish pooled fit or multiplied bandwidth.
- Missing/out-of-envelope calibration yields null throughput; no throughput path populates P95 or settles a performance gate. Independent benchmark data calibrates later profiles; tests reproducing a formula alone do not validate empirical accuracy.

### Probe, discovery, and SSH failure injection

- Inject OS/filesystem/runner/clock dependencies; ordinary CI requires no GPU, model server, SSH host, live download, or network access.
- Test nonzero exits with useful stderr, driver mismatch, missing commands, permission errors, malformed/oversized output, deadline/cancellation cleanup, partial inventory, multiple concurrent target requests, containers, and MIG/visibility constraints.
- Test discovery empty/authenticated/unreachable/redirected/malformed/oversized responses; prove no generation/download/start endpoint is called and endpoint identity is not inferred from port alone.
- For the remote phase, test unknown/changed host keys, unavailable agent auth, hung connected command, cancellation, option/command injection inputs, remote platform failure, and zero local fallback. Assert no host identity leaks through MCP/projections.

### Browser, MCP, and end-to-end paths

- Existing web tests use a Node environment. Add an explicit DOM/browser harness for interactions; static markup tests alone do not cover sliders, keyboard use, clipboard, downloads, or race handling.
- Exercise preset -> workload assumptions -> memory breakdown -> unknown performance -> proposal export -> CLI preview/recompute. Once phase 4 ships, extend through transactional attachment -> generated review bundle -> Studio evidence/gap display.
- Verify draft changes never mutate an imported bundle or retain its verification standing. Preserve the Atlas scanner pass/fail/unknown scenarios and contract-hash checks.
- Test keyboard controls, numeric alternatives, clipboard rejection, unsupported profiles, incomplete inputs, stale results, and responsive display. Assert Node-only modules never enter the client bundle.
- Verify the legacy MCP three-tool surface, default project surface, opt-in sizing surface, strict inputs, read-only behavior, projection, stdout protocol purity, and cancellation. Update the corresponding stdio verification script alongside interface changes.
- Run the existing CLI invariant test over web app and MCP source; add a targeted CI guard only if needed. Use both textual and behavioral checks: alternative button labels must not enable authoritative mutation.

### Repository checks for implementation changes

```sh
pnpm build
pnpm test
pnpm verify:mcp
pnpm verify:mcp-project
pnpm lint
pnpm format:check
pnpm --filter @anvilmark/web build
pnpm --filter @anvilmark/web smoke:playground http://127.0.0.1:3000
```

Start the local web server before the smoke check and pass its URL explicitly: the current script defaults to the deployed site, so its default would not validate the new local implementation. The current script checks the API, not browser interactions; extend/add a browser scenario for the sizing path. Some builds overlap; CI may avoid duplicate execution while preserving coverage. Record any pre-existing failures separately; do not claim every check passed without execution. Real-device/manual validation covers available local hardware and, for subsequent phases, authenticated remote hosts and each supported topology. Hardware absence yields documented gaps rather than fabricated validation.

## 12. References for implementation

- [Decision 06](../vnext/06-contract-ratification-decision.md), [current schema version](../../packages/project-contract/src/version.ts), [hardware schema](../../packages/project-contract/src/schema/resources.ts), and [candidate schema](../../packages/project-contract/src/schema/candidates.ts).
- [Evidence admission](../../packages/project-contract/src/evidence-tiers.ts), [resolved decision content](../../packages/project-contract/src/resolve.ts), [evidence freshness](../../packages/adapters/src/evidence/freshness.ts), [llmfit adapter](../../packages/adapters/src/tools/llmfit.ts), and [subprocess runner](../../packages/adapters/src/subprocess/runner.ts).
- [CLI common mutation workflow](../../packages/cli/src/commands/common.ts), [transactional store](../../packages/cli/src/store.ts), [project MCP tools](../../packages/mcp/src/project-tools.ts), and [existing web/MCP invariant test](../../packages/cli/test/decisions.test.ts).
- [Qwen publisher configuration](https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/c03e6d358207e414f1eca0bb1891e29f1db0e242/config.json), [Mixtral publisher configuration](https://huggingface.co/mistralai/Mixtral-8x7B-Instruct-v0.1/blob/main/config.json), [Mixtral architecture](https://mistral.ai/news/mixtral-of-experts/), and [Transformers cache strategies](https://huggingface.co/docs/transformers/en/kv_cache).
- [Metal recommended working set](https://developer.apple.com/documentation/metal/mtldevice/recommendedmaxworkingsetsize), [Apple SKU bandwidth variants](https://support.apple.com/en-ie/121554), [AMDGPU memory reporting](https://docs.kernel.org/gpu/amdgpu/driver-misc.html), [vLLM KV partitioning](https://docs.vllm.ai/en/latest/serving/context_parallel_deployment/), and [llama.cpp split modes](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
- [OpenSSH configuration semantics](https://man.openbsd.com/ssh_config.5), [Ollama installed inventory](https://docs.ollama.com/api/tags), and [Ollama loaded inventory](https://docs.ollama.com/api/ps).

External references were consulted for the architecture review on 2026-09-17. Mutable documentation links are starting points; implementation must pin the model data, upstream adaptation revision, and runtime profiles it actually ships.
