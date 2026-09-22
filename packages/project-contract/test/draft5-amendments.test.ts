import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type {
  ArchitectureElement,
  ContractIssue,
  ProjectContract,
} from "../src/index.js";
import {
  ARCHITECTURE_CONTENT_FORMAT,
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  approvalState,
  architectureContentHash,
  computeApprovalHash,
  confirmationStanding,
  isArchitectureElementTrusted,
  parseProjectContract,
  parseYamlDocument,
  readAtlasFixtureText,
  stableStringify,
  toNormalizedYaml,
  validateProjectContract,
} from "../src/index.js";
import { at, baseDocument } from "./helpers.js";
import { createHash } from "node:crypto";

/**
 * Amendments 8 and 9 (docs/vnext/09-milestone-4-architecture-amendment-proposal.md),
 * accepted with modifications on September 14, 2026 and implemented as
 * 0.1.0-draft.5.
 */

function issuesFor(
  mutate: (document: Record<string, unknown>) => void,
): readonly ContractIssue[] {
  const document = baseDocument();
  mutate(document);
  const result = validateProjectContract(document);
  return result.ok ? [] : result.issues;
}

function valid(document: Record<string, unknown>): ProjectContract {
  const result = validateProjectContract(document);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.value;
}

const HASH = "a".repeat(64);
const nodes = (d: Record<string, unknown>) =>
  at(d, "architecture", "nodes") as unknown as Record<string, unknown>[];
const relationships = (d: Record<string, unknown>) =>
  at(d, "architecture", "relationships") as unknown as Record<
    string,
    unknown
  >[];
const bindings = (d: Record<string, unknown>) =>
  at(d, "architecture", "decision_bindings") as unknown as Record<
    string,
    unknown
  >[];

describe("draft.5 schema line", () => {
  it("is the current version", () => {
    expect(PROJECT_SCHEMA_VERSION).toBe("0.1.0-draft.5");
    expect(PROJECT_SCHEMA_ID).toBe(
      "https://anvilmark.dev/schemas/project/0.1.0-draft.5",
    );
  });
});

describe("origin defaults and invariants", () => {
  it("defaults every element to a user origin and no interfaces", () => {
    const contract = valid(baseDocument());
    const origin = {
      kind: "user",
      proposal_ref: null,
      confirmed_at: null,
      confirmed_content_hash: null,
    };
    for (const node of contract.architecture.nodes) {
      expect(node.origin).toEqual(origin);
      expect(node.interfaces).toEqual([]);
    }
    for (const relationship of contract.architecture.relationships) {
      expect(relationship.origin).toEqual(origin);
      expect(relationship.source_interface_ref).toBeNull();
      expect(relationship.destination_interface_ref).toBeNull();
    }
    expect(contract.architecture.decision_bindings[0]?.origin).toEqual(origin);
  });

  it.each(["proposal_ref", "confirmed_at", "confirmed_content_hash"])(
    "O1: refuses %s on a user-declared element",
    (field) => {
      const issues = issuesFor((d) => {
        nodes(d)[0]!.origin = {
          kind: "user",
          [field]:
            field === "confirmed_at"
              ? "2026-09-14T00:00:00Z"
              : field === "proposal_ref"
                ? "prop-1"
                : HASH,
        };
      });
      expect(issues.map((entry) => entry.path)).toContain(
        `architecture.nodes[0].origin.${field}`,
      );
    },
  );

  it("O2: requires a proposal_ref on an agent-proposed element", () => {
    const issues = issuesFor((d) => {
      relationships(d)[0]!.origin = { kind: "agent_proposed" };
    });
    expect(issues.map((entry) => entry.path)).toContain(
      "architecture.relationships[0].origin.proposal_ref",
    );
  });

  it("O3: records confirmed_at and confirmed_content_hash together", () => {
    for (const partial of [
      { confirmed_at: "2026-09-14T00:00:00Z" },
      { confirmed_content_hash: HASH },
    ]) {
      const issues = issuesFor((d) => {
        bindings(d)[0]!.origin = {
          kind: "agent_proposed",
          proposal_ref: "prop-1",
          ...partial,
        };
      });
      expect(issues.map((entry) => entry.path)).toContain(
        "architecture.decision_bindings[0].origin.confirmed_content_hash",
      );
    }
    expect(
      issuesFor((d) => {
        bindings(d)[0]!.origin = {
          kind: "agent_proposed",
          proposal_ref: "prop-1",
          confirmed_at: "2026-09-14T00:00:00Z",
          confirmed_content_hash: "NOT-A-HASH",
        };
      }).map((entry) => entry.path),
    ).toContain(
      "architecture.decision_bindings[0].origin.confirmed_content_hash",
    );
  });

  it("refuses fields the origin does not define", () => {
    const issues = issuesFor((d) => {
      nodes(d)[0]!.origin = {
        kind: "agent_proposed",
        proposal_ref: "prop-1",
        confirmed_by: "someone",
      };
    });
    expect(issues.some((entry) => entry.code === "unknown_field")).toBe(true);
  });
});

describe("interfaces", () => {
  const withInterfaces = (d: Record<string, unknown>) => {
    nodes(d)[0]!.interfaces = [
      { id: "intake-http", protocol: "HTTPS", description: "Ticket API" },
      { id: "intake-queue", protocol: null },
    ];
    nodes(d)[1]!.interfaces = [{ id: "redactor-grpc", protocol: "gRPC" }];
  };

  it("accepts declared interfaces with unknown protocols and connects references", () => {
    const document = baseDocument();
    withInterfaces(document);
    relationships(document)[0]!.source_interface_ref = "intake-http";
    relationships(document)[0]!.destination_interface_ref = "redactor-grpc";
    const contract = valid(document);
    expect(contract.architecture.nodes[0]?.interfaces[1]).toEqual({
      id: "intake-queue",
      protocol: null,
      description: null,
    });
  });

  it("I1: refuses a duplicated interface id across nodes", () => {
    const issues = issuesFor((d) => {
      withInterfaces(d);
      nodes(d)[2]!.interfaces = [{ id: "intake-http" }];
    });
    expect(issues.map((entry) => entry.path)).toContain(
      "architecture.nodes[2].interfaces[0].id",
    );
  });

  it("I2: refuses an interface reference on the wrong node or to nothing", () => {
    const wrongNode = issuesFor((d) => {
      withInterfaces(d);
      relationships(d)[0]!.source_interface_ref = "redactor-grpc";
    });
    expect(wrongNode.map((entry) => entry.code)).toContain(
      "reference_wrong_type",
    );
    const dangling = issuesFor((d) => {
      withInterfaces(d);
      relationships(d)[0]!.destination_interface_ref = "missing-interface";
    });
    expect(dangling.map((entry) => entry.path)).toContain(
      "architecture.relationships[0].destination_interface_ref",
    );
  });

  it("I3: refuses interface references on a relationship that is not connects", () => {
    const issues = issuesFor((d) => {
      withInterfaces(d);
      relationships(d)[0]!.kind = "uses";
      relationships(d)[0]!.source_interface_ref = "intake-http";
    });
    expect(issues.map((entry) => entry.message).join(" ")).toContain(
      "only connects relationships may reference interfaces",
    );
  });

  it("refuses an unknown protocol", () => {
    const issues = issuesFor((d) => {
      nodes(d)[0]!.interfaces = [{ id: "x", protocol: "websocket" }];
    });
    expect(issues.map((entry) => entry.path)).toContain(
      "architecture.nodes[0].interfaces[0].protocol",
    );
  });
});

describe("decision bindings", () => {
  it.each(["agent_proposed", "user"])(
    "I4: refuses a duplicate binding when the existing origin is %s and the new one is agent-proposed",
    (kind) => {
      const issues = issuesFor((d) => {
        if (kind === "agent_proposed") {
          bindings(d)[0]!.origin = { kind, proposal_ref: "prop-original" };
        }
        bindings(d).push({
          decision_ref: "decision.classification.v1",
          node_refs: ["intake"],
          origin: {
            kind: "agent_proposed",
            proposal_ref: "prop-other",
            confirmed_at: "2026-09-14T00:00:00Z",
            confirmed_content_hash: HASH,
          },
        });
      });
      expect(issues.map((entry) => entry.path)).toContain(
        "architecture.decision_bindings[1].decision_ref",
      );
    },
  );

  it("I5: refuses a duplicated node in an agent-proposed binding", () => {
    const issues = issuesFor((d) => {
      bindings(d)[0]!.node_refs = ["redactor", "redactor"];
      bindings(d)[0]!.origin = {
        kind: "agent_proposed",
        proposal_ref: "prop-1",
      };
    });
    expect(issues.map((entry) => entry.path)).toContain(
      "architecture.decision_bindings[0].node_refs[1]",
    );
  });

  it("normalizes user-declared sets without changing the input or accepting dangling refs", () => {
    const document = baseDocument();
    bindings(document)[0]!.node_refs = ["redactor", "redactor"];
    bindings(document).push({
      decision_ref: "decision.classification.v1",
      node_refs: ["intake", "redactor"],
    });
    const before = structuredClone(document);
    const normalized = valid(document);
    expect(normalized.architecture.decision_bindings).toHaveLength(1);
    expect(normalized.architecture.decision_bindings[0]!.node_refs).toEqual([
      "intake",
      "redactor",
    ]);
    expect(document).toEqual(before);
    bindings(document).push({
      decision_ref: "decision.classification.v1",
      node_refs: ["missing-node"],
    });
    const invalid = validateProjectContract(document);
    expect(invalid.ok).toBe(false);
    expect(
      !invalid.ok &&
        invalid.issues.some((issue) => issue.code === "reference_not_found"),
    ).toBe(true);
  });
});

describe("architecture content hash", () => {
  const contract = () => {
    const document = baseDocument();
    nodes(document)[0]!.interfaces = [
      { id: "b-interface", protocol: "HTTP" },
      { id: "a-interface", protocol: null },
    ];
    bindings(document)[0]!.node_refs = ["redactor", "intake"];
    return valid(document);
  };

  it("is the documented payload", () => {
    const node = contract().architecture.nodes[0]!;
    const expected = createHash("sha256")
      .update(
        stableStringify({
          format: ARCHITECTURE_CONTENT_FORMAT,
          element: "node",
          content: {
            id: node.id,
            kind: node.kind,
            name: node.name,
            trust_boundary: node.trust_boundary,
            description: null,
            interfaces: [
              { id: "a-interface", protocol: null, description: null },
              { id: "b-interface", protocol: "HTTP", description: null },
            ],
          },
        }),
        "utf8",
      )
      .digest("hex");
    expect(ARCHITECTURE_CONTENT_FORMAT).toBe(
      "anvilmark-architecture-content/1",
    );
    expect(architectureContentHash({ type: "node", value: node })).toBe(
      expected,
    );
  });

  it("canonicalizes unordered sets and excludes origin", () => {
    const base = contract();
    const reordered = structuredClone(base);
    reordered.architecture.nodes[0]!.interfaces.reverse();
    reordered.architecture.decision_bindings[0]!.node_refs.reverse();
    reordered.architecture.nodes[0]!.origin = {
      kind: "agent_proposed",
      proposal_ref: "prop-1",
      confirmed_at: "2026-09-14T00:00:00Z",
      confirmed_content_hash: HASH,
    };
    const hash = (c: ProjectContract, element: "node" | "decision_binding") =>
      architectureContentHash(
        element === "node"
          ? { type: "node", value: c.architecture.nodes[0]! }
          : {
              type: "decision_binding",
              value: c.architecture.decision_bindings[0]!,
            },
      );
    expect(hash(reordered, "node")).toBe(hash(base, "node"));
    expect(hash(reordered, "decision_binding")).toBe(
      hash(base, "decision_binding"),
    );
  });

  it("changes with every covered field", () => {
    const base = contract();
    const node = base.architecture.nodes[0]!;
    const relationship = base.architecture.relationships[0]!;
    const original = architectureContentHash({ type: "node", value: node });
    for (const change of [
      { name: "Renamed" },
      { trust_boundary: "remote_provider" },
      { description: "now described" },
      { kind: "datastore" },
      {
        interfaces: [{ id: "a-interface", protocol: "TCP", description: null }],
      },
    ]) {
      expect(
        architectureContentHash({
          type: "node",
          value: { ...node, ...change } as typeof node,
        }),
      ).not.toBe(original);
    }
    const relationshipHash = architectureContentHash({
      type: "relationship",
      value: relationship,
    });
    for (const change of [
      { destination: "remote-provider" },
      { data_classification: null },
      { workload_ref: null },
      { source_interface_ref: "a-interface" },
    ]) {
      expect(
        architectureContentHash({
          type: "relationship",
          value: { ...relationship, ...change } as typeof relationship,
        }),
      ).not.toBe(relationshipHash);
    }
  });

  it("separates element domains", () => {
    // A relationship and a binding cannot collide even with equal-looking content.
    const elements: ArchitectureElement[] = [
      { type: "node", value: contract().architecture.nodes[1]! },
      {
        type: "relationship",
        value: contract().architecture.relationships[0]!,
      },
      {
        type: "decision_binding",
        value: contract().architecture.decision_bindings[0]!,
      },
    ];
    expect(new Set(elements.map(architectureContentHash)).size).toBe(3);
  });
});

describe("confirmation standing", () => {
  const proposed = (confirmedHash: string | null) => {
    const document = baseDocument();
    nodes(document)[2]!.origin = {
      kind: "agent_proposed",
      proposal_ref: "prop-20260914T000000Z-abcd1234",
      confirmed_at: confirmedHash === null ? null : "2026-09-14T00:00:00Z",
      confirmed_content_hash: confirmedHash,
    };
    return valid(document);
  };

  it("derives user_declared, unconfirmed, confirmed and confirmation_stale", () => {
    const user = valid(baseDocument()).architecture.nodes[2]!;
    expect(confirmationStanding({ type: "node", value: user })).toBe(
      "user_declared",
    );
    expect(isArchitectureElementTrusted({ type: "node", value: user })).toBe(
      true,
    );

    const unconfirmed = proposed(null).architecture.nodes[2]!;
    expect(confirmationStanding({ type: "node", value: unconfirmed })).toBe(
      "unconfirmed",
    );
    expect(
      isArchitectureElementTrusted({ type: "node", value: unconfirmed }),
    ).toBe(false);

    const hash = architectureContentHash({ type: "node", value: unconfirmed });
    const confirmed = proposed(hash);
    const node = confirmed.architecture.nodes[2]!;
    expect(confirmationStanding({ type: "node", value: node })).toBe(
      "confirmed",
    );

    // A manual edit keeps the record but fails effective confirmation.
    const edited = parseProjectContract(
      toNormalizedYaml(confirmed).replace(
        "trust_boundary: remote_provider",
        "trust_boundary: internal_network",
      ),
      "yaml",
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const stale = edited.value.architecture.nodes[2]!;
    expect(stale.origin.confirmed_content_hash).toBe(hash);
    expect(confirmationStanding({ type: "node", value: stale })).toBe(
      "confirmation_stale",
    );
    expect(isArchitectureElementTrusted({ type: "node", value: stale })).toBe(
      false,
    );
  });
});

describe("compatibility with draft.4 documents", () => {
  const draft4Path = new URL(
    "./fixtures/approved-atlas.draft4.yaml",
    import.meta.url,
  );
  const toDraft5 = (text: string) =>
    text
      .replace(
        /^schema: https:\/\/anvilmark\.dev\/schemas\/project\/[^\n]+$/m,
        `schema: ${PROJECT_SCHEMA_ID}`,
      )
      .replace(
        /^schema_version: [^\n]+$/m,
        `schema_version: ${PROJECT_SCHEMA_VERSION}`,
      );

  it("migrates a fixture written by the draft.4 build through its version lines", async () => {
    const draft4 = await readFile(draft4Path, "utf8");
    expect(draft4).toContain("schema_version: 0.1.0-draft.4");
    expect(draft4).not.toContain("origin:");
    expect(parseProjectContract(draft4, "yaml").ok).toBe(false);

    const migrated = parseProjectContract(toDraft5(draft4), "yaml");
    expect(migrated.ok ? [] : migrated.issues).toEqual([]);
    if (!migrated.ok) return;
    const architecture = migrated.value.architecture;
    expect(architecture.decision_bindings).toHaveLength(1);
    for (const element of [
      ...architecture.nodes,
      ...architecture.relationships,
      ...architecture.decision_bindings,
    ]) {
      expect(element.origin.kind).toBe("user");
      expect(
        confirmationStanding(
          "kind" in element && "trust_boundary" in element
            ? { type: "node", value: element }
            : "source" in element
              ? { type: "relationship", value: element }
              : { type: "decision_binding", value: element },
        ),
      ).toBe("user_declared");
    }
    expect(
      architecture.nodes.every((node) => node.interfaces.length === 0),
    ).toBe(true);

    const normalized = toNormalizedYaml(migrated.value);
    expect(normalized.match(/confirmed_content_hash: null/g)).toHaveLength(
      architecture.nodes.length +
        architecture.relationships.length +
        architecture.decision_bindings.length,
    );
    expect(normalized).toContain("interfaces: []");
    expect(normalized).toContain("source_interface_ref: null");
    const reparsed = parseProjectContract(normalized, "yaml");
    expect(reparsed.ok && reparsed.value).toEqual(migrated.value);
  });

  it("keeps the approval hash written by draft.3 code current, unchanged, after migration", async () => {
    const draft4 = await readFile(draft4Path, "utf8");
    const stored = /content_hash: ([0-9a-f]{64})/.exec(draft4)?.[1];
    expect(stored).toBe(
      "81b8559b4cd6fdddd5addfb4bd065caa574529f8802e4f1bfe85292efe481f1d",
    );
    const migrated = parseProjectContract(toDraft5(draft4), "yaml");
    if (!migrated.ok) throw new Error("migration failed");
    const recomputed = computeApprovalHash(
      migrated.value,
      "decision.classification",
    );
    expect(recomputed.ok && recomputed.value).toBe(stored);
    expect(approvalState(migrated.value, "decision.classification").state).toBe(
      "current",
    );
    const normalized = parseProjectContract(
      toNormalizedYaml(migrated.value),
      "yaml",
    );
    expect(
      normalized.ok &&
        approvalState(normalized.value, "decision.classification").state,
    ).toBe("current");
  });

  it.each(["repeated_nodes", "overlapping_bindings", "disjoint_bindings"])(
    "migrates independently validated draft.4 %s without losing associations or approvals",
    async (name) => {
      const fixtures = JSON.parse(
        await readFile(
          new URL("./fixtures/draft4-binding-cases.json", import.meta.url),
          "utf8",
        ),
      ) as {
        cases: {
          name: string;
          decision_bindings: { decision_ref: string; node_refs: string[] }[];
          document_sha256: string;
          approval_hash: string;
          expected_node_refs: string[];
        }[];
      };
      const fixture = fixtures.cases.find((entry) => entry.name === name)!;
      const parsed = parseYamlDocument(await readFile(draft4Path, "utf8"));
      if (!parsed.ok) throw new Error("fixture did not parse");
      const document = parsed.value as Record<string, unknown>;
      (document.architecture as Record<string, unknown>).decision_bindings =
        fixture.decision_bindings;
      // This exact document was accepted by the unmodified efb5539 validator.
      expect(
        createHash("sha256").update(stableStringify(document)).digest("hex"),
      ).toBe(fixture.document_sha256);
      document.schema = PROJECT_SCHEMA_ID;
      document.schema_version = PROJECT_SCHEMA_VERSION;
      const migrated = valid(document);
      expect(migrated.architecture.decision_bindings).toHaveLength(1);
      expect(migrated.architecture.decision_bindings[0]!.node_refs).toEqual(
        fixture.expected_node_refs,
      );
      expect(migrated.architecture.decision_bindings[0]!.origin.kind).toBe(
        "user",
      );
      const hash = computeApprovalHash(migrated, "decision.classification");
      expect(hash.ok && hash.value).toBe(fixture.approval_hash);
      expect(approvalState(migrated, "decision.classification").state).toBe(
        "current",
      );
      const text = toNormalizedYaml(migrated);
      const roundTrip = parseProjectContract(text, "yaml");
      expect(roundTrip.ok && roundTrip.value).toEqual(migrated);
      expect(roundTrip.ok && toNormalizedYaml(roundTrip.value)).toBe(text);
      // Permuting a legacy set still yields the same canonical association.
      (document.architecture as Record<string, unknown>).decision_bindings =
        fixture.decision_bindings
          .slice()
          .reverse()
          .map((binding) => ({
            ...binding,
            node_refs: [...binding.node_refs].reverse(),
          }));
      expect(toNormalizedYaml(valid(document))).toBe(text);
    },
  );

  it("reads the Atlas fixture at draft.5 with every element user-declared", async () => {
    const parsed = parseProjectContract(await readAtlasFixtureText(), "yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      [
        ...parsed.value.architecture.nodes,
        ...parsed.value.architecture.relationships,
      ].every((element) => element.origin.kind === "user"),
    ).toBe(true);
  });
});
