/**
 * Canonical form.
 *
 * Determinism is a product requirement, not a convenience: approval hashes are
 * taken over canonical bytes, and a contract must serialize identically on
 * every machine and every run.
 *
 * Rules:
 *   - object keys are emitted in lexicographic (UTF-16 code-unit) order;
 *   - array order is PRESERVED, because arrays such as `priority_order` and
 *     `constraints` carry meaning in their ordering;
 *   - `undefined` members are dropped; `null` is preserved and meaningful;
 *   - non-finite numbers are rejected rather than silently becoming `null`.
 */
/**
 * Locale-independent ordering by UTF-16 code unit.
 *
 * `String.prototype.localeCompare` depends on the host's collation: under
 * some locales "a" and "A" compare equal, and accented characters reorder.
 * Anything that feeds a hash or committed bytes must not vary by machine, so
 * ordering is always done with this comparator.
 */
export declare function compareCodeUnits(left: string, right: string): number;
export type CanonicalValue = null | boolean | number | string | readonly CanonicalValue[] | {
    readonly [key: string]: CanonicalValue;
};
export declare class CanonicalizationError extends Error {
    readonly path: string;
    constructor(message: string, path: string);
}
/** Deep-sort keys, preserve array order, and drop `undefined`. */
export declare function canonicalize(value: unknown): CanonicalValue;
/** Compact canonical JSON. This is the exact byte sequence that gets hashed. */
export declare function stableStringify(value: unknown): string;
/** Human-readable canonical JSON with a trailing newline. */
export declare function prettyStringify(value: unknown): string;
//# sourceMappingURL=canonical.d.ts.map