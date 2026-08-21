import { canonicalize, prettyStringify, stableStringify } from "./canonical.js";
import type { ProjectContract } from "./schema/contract.js";
/** Canonical YAML for on-disk storage. */
export declare function toNormalizedYaml(contract: ProjectContract): string;
/** Canonical, human-readable JSON. */
export declare function toNormalizedJson(contract: ProjectContract): string;
/** Compact canonical JSON. These are the exact bytes covered by a hash. */
export declare function toCanonicalBytes(value: unknown): string;
export { canonicalize, stableStringify, prettyStringify };
//# sourceMappingURL=serialize.d.ts.map