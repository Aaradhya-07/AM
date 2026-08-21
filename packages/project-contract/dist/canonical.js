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
export function compareCodeUnits(left, right) {
    if (left < right)
        return -1;
    if (left > right)
        return 1;
    return 0;
}
export class CanonicalizationError extends Error {
    path;
    constructor(message, path) {
        super(`${message} (at ${path || "<root>"})`);
        this.name = "CanonicalizationError";
        this.path = path;
    }
}
function canonicalizeAt(value, path) {
    if (value === null) {
        return null;
    }
    const kind = typeof value;
    if (kind === "boolean" || kind === "string") {
        return value;
    }
    if (kind === "number") {
        const numeric = value;
        if (!Number.isFinite(numeric)) {
            throw new CanonicalizationError(`non-finite number ${String(numeric)} cannot be canonicalized`, path);
        }
        // Normalise -0 to 0 so that two semantically equal contracts hash equally.
        return numeric === 0 ? 0 : numeric;
    }
    if (Array.isArray(value)) {
        return value.map((entry, index) => canonicalizeAt(entry, `${path}[${index}]`));
    }
    if (kind === "object") {
        const source = value;
        const result = {};
        for (const key of Object.keys(source).sort()) {
            const member = source[key];
            if (member === undefined) {
                continue;
            }
            result[key] = canonicalizeAt(member, path === "" ? key : `${path}.${key}`);
        }
        return result;
    }
    throw new CanonicalizationError(`values of type ${kind} cannot appear in a portable contract`, path);
}
/** Deep-sort keys, preserve array order, and drop `undefined`. */
export function canonicalize(value) {
    return canonicalizeAt(value, "");
}
/** Compact canonical JSON. This is the exact byte sequence that gets hashed. */
export function stableStringify(value) {
    return JSON.stringify(canonicalize(value));
}
/** Human-readable canonical JSON with a trailing newline. */
export function prettyStringify(value) {
    return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}
