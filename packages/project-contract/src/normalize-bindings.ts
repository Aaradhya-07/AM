import { compareCodeUnits } from "./canonical.js";
import type { DecisionBinding } from "./schema/architecture.js";

/**
 * Draft.4 allowed repeated decision bindings and node refs. Their user-declared
 * associations form a set, so combine duplicates before integrity validation.
 * Schema validation has already rejected malformed or unknown fields.
 *
 * Keep the first occurrence's position and leave already unique bindings alone.
 * Never combine a group containing agent provenance: its separate proposal or
 * confirmation records cannot be merged without changing their meaning.
 */
export function normalizeUserBindings(
  bindings: readonly DecisionBinding[],
): DecisionBinding[] {
  const groups = new Map<string, DecisionBinding[]>();
  for (const binding of bindings) {
    const group = groups.get(binding.decision_ref) ?? [];
    group.push(binding);
    groups.set(binding.decision_ref, group);
  }

  return bindings.flatMap((binding) => {
    const group = groups.get(binding.decision_ref)!;
    if (group.some((entry) => entry.origin.kind !== "user")) return [binding];
    if (group[0] !== binding) return [];
    const refs = group.flatMap((entry) => entry.node_refs);
    const unique = new Set(refs);
    if (group.length === 1 && unique.size === refs.length) return [binding];
    return [{ ...binding, node_refs: [...unique].sort(compareCodeUnits) }];
  });
}
