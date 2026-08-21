import { describe, expect, it } from "vitest";

import type { IssueCode } from "../src/index.js";
import { validateProjectContract } from "../src/index.js";
import { at, baseDocument } from "./helpers.js";

function issuesFor(mutate: (document: Record<string, unknown>) => void) {
  const document = baseDocument();
  mutate(document);
  const result = validateProjectContract(document);
  return result.ok ? [] : result.issues;
}

describe("the base document", () => {
  it("is valid, so every mutation below isolates one failure", () => {
    const result = validateProjectContract(baseDocument());
    if (!result.ok) {
      throw new Error(
        result.issues
          .map((entry) => `[${entry.code}] ${entry.path}: ${entry.message}`)
          .join("\n"),
      );
    }
    expect(result.ok).toBe(true);
  });
});

interface Case {
  readonly name: string;
  readonly mutate: (document: Record<string, unknown>) => void;
  readonly code: IssueCode;
  readonly path?: string;
}

const unknownFieldCases: readonly Case[] = [
  {
    name: "at the top level",
    mutate: (document) => {
      document.unexpected_section = {};
    },
    code: "unknown_field",
    path: "unexpected_section",
  },
  {
    name: "inside project",
    mutate: (document) => {
      at(document, "project").favourite_colour = "blue";
    },
    code: "unknown_field",
    path: "project.favourite_colour",
  },
  {
    name: "inside a workload",
    mutate: (document) => {
      at(document, "workloads", 0).best_model = "some-model";
    },
    code: "unknown_field",
    path: "workloads[0].best_model",
  },
  {
    name: "inside a constraint (a misspelled field)",
    mutate: (document) => {
      at(document, "constraints", 0).sevrity = "hard";
    },
    code: "unknown_field",
    path: "constraints[0].sevrity",
  },
  {
    name: "inside architecture",
    mutate: (document) => {
      at(document, "architecture").imported_from = "calm";
    },
    code: "unknown_field",
    path: "architecture.imported_from",
  },
];

describe("unknown fields are rejected during the draft phase", () => {
  it.each(unknownFieldCases)("$name", ({ mutate, code, path }) => {
    const issues = issuesFor(mutate);

    expect(
      issues.some((entry) => entry.code === code && entry.path === path),
    ).toBe(true);
  });
});

const duplicateIdCases: readonly Case[] = [
  {
    name: "duplicate constraint ids",
    mutate: (document) => {
      const constraints = document.constraints as Record<string, unknown>[];
      at(document, "constraints", 1).id = constraints[0]?.id;
    },
    code: "duplicate_id",
    path: "constraints[1].id",
  },
  {
    name: "duplicate workload ids",
    mutate: (document) => {
      at(document, "workloads", 1).id = "classification";
    },
    code: "duplicate_id",
    path: "workloads[1].id",
  },
  {
    name: "duplicate candidate ids",
    mutate: (document) => {
      at(document, "candidates", 1).id = "candidate.classification.local";
    },
    code: "duplicate_id",
    path: "candidates[1].id",
  },
  {
    name: "duplicate evidence ids",
    mutate: (document) => {
      at(document, "evidence_refs", 1).id = "evidence.eval.classification";
    },
    code: "duplicate_id",
    path: "evidence_refs[1].id",
  },
  {
    name: "duplicate architecture node ids",
    mutate: (document) => {
      at(document, "architecture", "nodes", 1).id = "intake";
    },
    code: "duplicate_id",
    path: "architecture.nodes[1].id",
  },
  {
    name: "a repeated priority domain",
    mutate: (document) => {
      at(document, "project").priority_order = [
        "privacy",
        "quality",
        "privacy",
      ];
    },
    code: "duplicate_id",
    path: "project.priority_order[2]",
  },
];

describe("ids must be unique within their collection", () => {
  it.each(duplicateIdCases)("$name", ({ mutate, code, path }) => {
    const issues = issuesFor(mutate);

    expect(
      issues.some((entry) => entry.code === code && entry.path === path),
    ).toBe(true);
  });
});

describe("required fields and value shapes", () => {
  it("distinguishes a missing field from a wrong-typed one", () => {
    const missing = issuesFor((document) => {
      delete at(document, "project").created_at;
    });
    const wrongType = issuesFor((document) => {
      at(document, "project").contract_revision = "one";
    });

    expect(missing[0]).toMatchObject({
      code: "missing_field",
      path: "project.created_at",
    });
    expect(wrongType[0]).toMatchObject({
      code: "schema_violation",
      path: "project.contract_revision",
    });
  });

  it("rejects a schema version this package cannot read", () => {
    const issues = issuesFor((document) => {
      document.schema_version = "0.2.0";
    });

    expect(issues.some((entry) => entry.path === "schema_version")).toBe(true);
  });

  it("requires soft constraints to declare a direction", () => {
    const issues = issuesFor((document) => {
      delete at(document, "constraints", 2).direction;
    });

    expect(
      issues.some((entry) => entry.path === "constraints[2].direction"),
    ).toBe(true);
  });

  it("forbids a direction on a hard constraint, which is a gate not a preference", () => {
    const issues = issuesFor((document) => {
      at(document, "constraints", 0).direction = "minimize";
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "unknown_field" &&
          entry.path === "constraints[0].direction",
      ),
    ).toBe(true);
  });

  it("rejects an absolute repository root as machine-identifying", () => {
    const issues = issuesFor((document) => {
      at(document, "project").repository_roots = ["/Users/someone/code"];
    });

    expect(
      issues.some((entry) => entry.path === "project.repository_roots[0]"),
    ).toBe(true);
  });

  it("requires an exact model version or an explicit floating declaration", () => {
    const pinnedAbsent = issuesFor((document) => {
      at(document, "candidates", 0).model = { family: "example-model" };
    });
    expect(
      pinnedAbsent.some((entry) =>
        entry.path.startsWith("candidates[0].model"),
      ),
    ).toBe(true);

    const declaredFloating = issuesFor((document) => {
      at(document, "candidates", 0).model = {
        family: "example-model",
        version: null,
        version_mutability: "floating",
      };
    });
    expect(declaredFloating).toEqual([]);
  });

  it("requires an estimate to record its basis", () => {
    const issues = issuesFor((document) => {
      at(document, "candidates", 1).estimates = {
        monthly_effective_cost_usd: 120,
      };
    });

    expect(
      issues.some((entry) => entry.path === "candidates[1].estimates.basis"),
    ).toBe(true);
  });

  it("accepts an estimate that records its basis", () => {
    const issues = issuesFor((document) => {
      at(document, "candidates", 1).estimates = {
        monthly_effective_cost_usd: 120,
        basis: "official pricing multiplied by declared monthly call volume",
      };
    });

    expect(issues).toEqual([]);
  });

  it("requires a constraint exception to carry an expiry or review date", () => {
    const issues = issuesFor((document) => {
      at(document, "constraints", 0).exceptions = [
        {
          id: "exception.one",
          reason: "temporary waiver during migration",
          approved_by: "local_user",
        },
      ];
    });

    expect(
      issues.some((entry) =>
        entry.path.startsWith("constraints[0].exceptions[0]"),
      ),
    ).toBe(true);
  });

  it("fixes ANVILMARK as the architecture authority", () => {
    const issues = issuesFor((document) => {
      at(document, "architecture").authority = "calm";
    });

    expect(
      issues.some((entry) => entry.path === "architecture.authority"),
    ).toBe(true);
  });
});
