/**
 * Version of the adapter protocol: the shape of the result envelope, the
 * evidence proposal, and the intelligence proposal.
 *
 * This is independent of `PROJECT_SCHEMA_VERSION`. An adapter may be revised
 * without touching the authoritative contract, and the contract may be revised
 * without invalidating every adapter.
 */
export const ADAPTER_PROTOCOL_VERSION = "0.1.0-draft.1" as const;

export type AdapterProtocolVersion = typeof ADAPTER_PROTOCOL_VERSION;

/**
 * Versions of the intelligence request/proposal protocol.
 *
 * `0.1.0-draft.2` (amendment 8, docs/vnext/09-milestone-4-architecture-amendment-proposal.md)
 * adds proposed architecture nodes, relationships and decision bindings.
 * Requests are built at the newest version; responses and previously exported
 * requests are accepted at either version, each validated strictly against its
 * own shape. The evidence-adapter envelope stays at `ADAPTER_PROTOCOL_VERSION`.
 */
export const INTELLIGENCE_PROTOCOL_VERSIONS = [
  "0.1.0-draft.1",
  "0.1.0-draft.2",
] as const;

export const INTELLIGENCE_PROTOCOL_VERSION = "0.1.0-draft.2" as const;

export type IntelligenceProtocolVersion =
  (typeof INTELLIGENCE_PROTOCOL_VERSIONS)[number];
