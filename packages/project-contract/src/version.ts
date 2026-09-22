/**
 * Project-contract schema line.
 *
 * This is an INDEPENDENT schema line from the historical `@anvilmark/contract`
 * package, whose `SCHEMA_VERSION = "0.1.0"` is frozen and must not change.
 * The identical numeric prefix in two differently named packages is not a
 * collision: package/schema identity supplies the namespace.
 *
 * Ratified in docs/vnext/06-contract-ratification-decision.md section 3.
 *
 * `draft.2` amends `draft.1` in two places, both forced by contradictions found
 * during Milestone 2 and recorded in
 * docs/vnext/milestones/02-evidence-and-adapter-boundaries.md:
 *
 *   - `Hardware.backend` was added. Decision 06 section 8 requires a
 *     backend/device mismatch to produce `unknown`, but `draft.1` had nowhere
 *     to record which backend a machine offers, so the rule could not be
 *     evaluated.
 *   - `measured_evaluation.value.identity` was added. An evaluation is only
 *     evidence about the exact dataset, prompt, evaluator, workload, and model
 *     configuration that produced it, and a single opaque `configuration_hash`
 *     could not say which of those changed.
 *
 * `draft.3` tightens that identity after a second review. Digests carry their
 * algorithm and are lower-case hex, so an arbitrary caller-supplied string can
 * no longer pass as proof of what ran; and the identity records the config
 * digest and the verified provider the run actually used, because a result
 * aggregated over several providers is not a measurement of one candidate.
 *
 * `draft.4` applies amendments 6 and 7 from
 * docs/vnext/08-milestone-3-scope-proposal.md, accepted on September 14, 2026:
 * a workload's monthly call volume may be recorded as explicitly unknown
 * (`calls_per_month: null` with `basis: unknown`), and a workload may declare
 * the data classification of its output (`output_classification`, null when not
 * declared). A draft.3 document migrates by changing only `schema` and
 * `schema_version`; normalized serialization then also writes
 * `output_classification: null` for each workload.
 *
 * `draft.5` applies amendments 8 and 9 from
 * docs/vnext/09-milestone-4-architecture-amendment-proposal.md, accepted with
 * modifications on September 14, 2026: every architecture node, relationship
 * and decision binding records its `origin` (user, or agent-proposed with a
 * proposal reference and a content-bound confirmation), nodes may declare
 * `interfaces`, and `connects` relationships may reference them. A draft.4
 * document migrates by changing only `schema` and `schema_version`; approval
 * hashes are unchanged because architecture is not approval content.
 */

export const PROJECT_SCHEMA_VERSION = "0.1.0-draft.5" as const;

export const PROJECT_SCHEMA_ID =
  "https://anvilmark.dev/schemas/project/0.1.0-draft.5" as const;

export type ProjectSchemaVersion = typeof PROJECT_SCHEMA_VERSION;
