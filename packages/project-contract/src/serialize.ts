import { JSON_SCHEMA, dump as dumpYaml } from "js-yaml";

import { canonicalize, prettyStringify, stableStringify } from "./canonical.js";
import type { ProjectContract } from "./schema/contract.js";

/**
 * Deterministic serialization.
 *
 * Object keys are emitted in lexicographic order and array order is preserved,
 * so `priority_order`, `constraints`, and every other semantically ordered
 * array survives a round trip unchanged.
 *
 * Key ordering is lexicographic rather than schema-declaration order because
 * lexicographic ordering is provably stable across refactors of the schema
 * modules: reordering a Zod object literal can never change committed bytes.
 */
const YAML_OPTIONS = {
  /** Match the loader: JSON scalars only, so a round trip cannot change types. */
  schema: JSON_SCHEMA,
  indent: 2,
  /** Never fold long scalars; folding is width-dependent and unstable. */
  lineWidth: -1,
  /** Anchors and aliases would make output depend on object identity. */
  noRefs: true,
  sortKeys: true,
  quotingType: '"',
  forceQuotes: false,
} as const;

/** Canonical YAML for on-disk storage. */
export function toNormalizedYaml(contract: ProjectContract): string {
  return dumpYaml(canonicalize(contract), YAML_OPTIONS);
}

/** Canonical, human-readable JSON. */
export function toNormalizedJson(contract: ProjectContract): string {
  return prettyStringify(contract);
}

/** Compact canonical JSON. These are the exact bytes covered by a hash. */
export function toCanonicalBytes(value: unknown): string {
  return stableStringify(value);
}

export { canonicalize, stableStringify, prettyStringify };
