import { createHash } from "node:crypto";

import { compareCodeUnits, stableStringify } from "./canonical.js";
import type {
  ArchitectureNode,
  ArchitectureOrigin,
  ArchitectureRelationship,
  DecisionBinding,
} from "./schema/architecture.js";

/**
 * Architecture content hashing and confirmation standing (amendment 8,
 * draft.5), specified in
 * docs/vnext/09-milestone-4-architecture-amendment-proposal.md.
 *
 * Everything here is pure: it reads an element, never the filesystem or the
 * CLI's history. A `confirmed` standing therefore means "this element's
 * content is exactly the content whose hash was recorded at confirmation". It
 * does not mean the `proposal_ref` was checked against committed history (only
 * the local CLI does that), it does not identify who confirmed, and it does not
 * protect against a rewrite of the whole contract including the hash.
 */

export const ARCHITECTURE_CONTENT_FORMAT =
  "anvilmark-architecture-content/1" as const;

export type ArchitectureElementType =
  "node" | "relationship" | "decision_binding";

export type ArchitectureElement =
  | { readonly type: "node"; readonly value: ArchitectureNode }
  | { readonly type: "relationship"; readonly value: ArchitectureRelationship }
  | { readonly type: "decision_binding"; readonly value: DecisionBinding };

/** The content a confirmation covers: the element without its origin. */
export function architectureContent(
  element: ArchitectureElement,
): Record<string, unknown> {
  switch (element.type) {
    case "node": {
      const node = element.value;
      return {
        id: node.id,
        kind: node.kind,
        name: node.name,
        trust_boundary: node.trust_boundary,
        description: node.description,
        interfaces: [...node.interfaces]
          .sort((left, right) => compareCodeUnits(left.id, right.id))
          .map((entry) => ({
            id: entry.id,
            protocol: entry.protocol,
            description: entry.description,
          })),
      };
    }
    case "relationship": {
      const relationship = element.value;
      return {
        id: relationship.id,
        kind: relationship.kind,
        source: relationship.source,
        destination: relationship.destination,
        workload_ref: relationship.workload_ref,
        data_classification: relationship.data_classification,
        source_interface_ref: relationship.source_interface_ref,
        destination_interface_ref: relationship.destination_interface_ref,
      };
    }
    case "decision_binding": {
      const binding = element.value;
      return {
        decision_ref: binding.decision_ref,
        node_refs: [...new Set(binding.node_refs)].sort(compareCodeUnits),
      };
    }
    default: {
      const exhaustive: never = element;
      return exhaustive;
    }
  }
}

/**
 * Lower-case hex SHA-256 over the canonical JSON of
 * `{ format, element, content }`. The element type separates the three
 * domains; the format string versions the payload.
 */
export function architectureContentHash(element: ArchitectureElement): string {
  return createHash("sha256")
    .update(
      stableStringify({
        format: ARCHITECTURE_CONTENT_FORMAT,
        element: element.type,
        content: architectureContent(element),
      }),
      "utf8",
    )
    .digest("hex");
}

export type ConfirmationStanding =
  "user_declared" | "unconfirmed" | "confirmed" | "confirmation_stale";

/** The element's origin, whichever type it is. */
export function originOf(element: ArchitectureElement): ArchitectureOrigin {
  return element.value.origin;
}

/**
 * Derive confirmation standing by recomputing the content hash.
 *
 * A stored hash that no longer matches is `confirmation_stale`: the record is
 * kept for inspection, and the element is not trusted.
 */
export function confirmationStanding(
  element: ArchitectureElement,
): ConfirmationStanding {
  const origin = originOf(element);
  if (origin.kind === "user") {
    return "user_declared";
  }
  if (origin.confirmed_at === null || origin.confirmed_content_hash === null) {
    return "unconfirmed";
  }
  return origin.confirmed_content_hash === architectureContentHash(element)
    ? "confirmed"
    : "confirmation_stale";
}

/** User-declared or confirmed with matching content. */
export function isArchitectureElementTrusted(
  element: ArchitectureElement,
): boolean {
  const standing = confirmationStanding(element);
  return standing === "user_declared" || standing === "confirmed";
}
