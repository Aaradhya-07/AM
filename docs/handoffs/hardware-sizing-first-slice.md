# Hardware sizing: first implementation slice

Historical first-slice record. Follow-on implementation and current verification are recorded in [hardware-sizing-implementation.md](hardware-sizing-implementation.md).

Verified on 2026-09-18 in `ANVILMARK-milestone-5`, branch `emergent-playground`.

## Implemented

- `@anvilmark/hardware-sizing`: browser-safe strict schemas, canonical artifact hashes, pinned Qwen/Mixtral profiles, exact-byte resident weights and architecture-derived KV, explicit allocation/runtime assumptions, and unsupported/unknown handling.
- `hardware catalog`, `hardware example`, and `hardware estimate --file … [--json]`: read-only calculations and browser artifact verification without a project. Existing `hardware add` delegates to its unchanged implementation.
- `/playground`: live context/concurrency/precision/memory controls, component breakdown, gaps, portable proposal JSON and copied agent brief, reset, invalid-input handling, clipboard errors, and stale-export rejection. Existing Atlas conformance controls remain operational below it.
- Independent publisher-dimension arithmetic tests, example validation, artifact tamper checks, CLI regression tests, and an explicit happy-dom interaction harness.
- Local development selects webpack consistently with the production build. Automatic Next agent-file generation is disabled. Lint/format ignore only the external `reference/odysseus/` checkout; ANVILMARK source remains covered.

This delivers phases 0–1's planning foundation and the standalone part of phase 3 from [the implementation plan](hardware-fit-plan.md). It does not finish the whole plan. The [package README](../../packages/hardware-sizing/README.md) is the supported-profile and units reference.

## Boundaries still in force

All sizing hardware is T1 `user_declared`. Results are estimates with `contract_evidence: unattached`; no forged T3 inventory is created or admitted. Runtime compatibility stays unknown and numerical throughput stays null. No project schema, evidence floor, history, freshness rule, or MCP tool surface is changed. Project-binding fields in a proposal are metadata only; the example binding is fictional and is not validated against a real contract.

No hardware probe, endpoint discovery, SSH, writes, project attachment, Studio sizing import, opt-in sizing MCP tools, hardware SKU catalog, runtime calibration, named quantized artifact support, offload, or multi-device placement is implemented yet. Unsupported configurations remain explicit. There are no model downloads or server start/stop operations.

## Verification record

- `pnpm build`: all packages and production Next build pass.
- `pnpm test`: 1,565 passed, 22 skipped. Baseline was 1,506 passed with the same 22 skips. New coverage: 43 sizing tests, 10 CLI tests, 6 DOM interaction tests.
- `pnpm lint` and `pnpm format:check`: pass with the narrowly scoped upstream-reference exclusions.
- `pnpm verify:mcp`: legacy three-tool surface passes.
- `pnpm verify:mcp-project`: 11/11 client responses byte-identical; JSON-RPC stdout and project immutability pass.
- `pnpm --filter @anvilmark/web smoke:playground http://127.0.0.1:3107`: all six real Atlas pass/fail/unknown variants pass against the local implementation.
- Case-insensitive `approv` scan: zero occurrences in `packages/web/app/` and `packages/mcp/src/`; existing invariant test also passes.

Real browser checks exercised dense-model budgeting, 32,768-token/two-sequence Mixtral, nominal integer metadata gaps, unified-memory reserve accounting, invalid input disabling exports, native arrow-key context changes, reset, copied caveats, and JSON generation. Desktop and 390 px mobile layouts were inspected; a collapsed mobile slider found during inspection was fixed. Mobile page width is 390 px with no horizontal document overflow.

The browser's download-event hook timed out despite the app requesting a Blob download. File arrival through that browser hook is **not verified**. The visible proposal JSON fallback is verified; that exact browser-produced artifact was independently passed to the built CLI and validated successfully. The DOM harness verifies Blob creation and stale-result suppression, not OS download delivery.

Browser-to-CLI parity scenario: Qwen BF16, FP16 KV, 4,097 retained tokens, one sequence; 24 GiB declared capacity/allocation, 2 GiB reserve, 1 GiB runtime allowance, 0.25 GiB allocator allowance. Both surfaces report 16,808,348,672 required bytes and 6,813,971,456 bytes of estimated headroom, with runtime/performance still unverified.

```text
input_digest: sha256:8634cb4d4928f111e9a02bfd3ca62d85ad32555bf4f4467060eef321c3b84fbf
dependency_digest: sha256:376b05387aa5888705ee2cdabbd806de18da19fd26af6e535870e625efec968a
```

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm dev:web
# Open http://localhost:3000/playground
node packages/cli/bin/anvilmark.mjs hardware estimate --file packages/hardware-sizing/examples/standalone-qwen.json
```

For browser regression: enter allocation 24 GiB, reserve 2 GiB, runtime 1 GiB, allocator 0.25 GiB; change context/concurrency; select Mixtral and nominal 4-bit storage; leave metadata empty and verify unknown total; supply metadata and switch to unified memory; test invalid concurrency; reset; export, expand the JSON, save it locally, and run `hardware estimate --file` against it. Numerical results must not become measured performance or contract evidence.

## Next implementation boundary

Implement phase 2 local collection with injected runners and fixtures, bounded subprocesses, explicit completeness, and independent observation identity. Before enabling persistence, prove declaration immutability, collision refusal, cancellation cleanup, and transactional writes. Leave SSH and multi-device estimates unavailable until their separate prerequisites pass. Contract-bound application remains gated on accepted schema work and dependency-freshness checks across every reader.
