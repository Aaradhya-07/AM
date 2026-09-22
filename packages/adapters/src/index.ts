/**
 * @anvilmark/adapters
 *
 * Replaceable boundaries between ANVILMARK and the outside world: optional
 * command-line tools, user-selected intelligence, and facts a person enters by
 * hand.
 *
 * Two rules shape everything here. Adapters never write the authoritative
 * contract — they return validated envelopes the caller may choose to attach.
 * And the absence of an optional tool is an evidence GAP: never a crash, and
 * never a pass.
 */

export * from "./version.js";
export * from "./clock.js";
export * from "./envelope.js";
export * from "./sanitize.js";

// Subprocess execution.
export * from "./subprocess/manifest.js";
export * from "./subprocess/runner.js";

// Evidence.
export * from "./evidence/proposal.js";
export * from "./evidence/builder.js";
export * from "./evidence/adapter.js";
export * from "./evidence/freshness.js";
export * from "./evidence/importer.js";
export * from "./evidence/gaps.js";

// Intelligence.
export * from "./intelligence/proposal.js";
export * from "./intelligence/projection.js";
export * from "./intelligence/adapter.js";
export * from "./intelligence/request.js";
export * from "./intelligence/registration.js";
export * from "./intelligence/consent.js";
export * from "./intelligence/disclosure.js";
export * from "./intelligence/openai-compatible.js";
export * from "./intelligence/handoff.js";

// Optional tools.
export * from "./tools/llmfit.js";
export * from "./tools/promptfoo-spec.js";
export * from "./tools/promptfoo-execution.js";
export * from "./tools/promptfoo-rows.js";
export * from "./tools/promptfoo.js";

export * from "./hardware/detector.js";
export * from "./hardware/remote.js";
export * from "./hardware/discovery.js";
export * from "./hardware/records.js";
