import { describe, expect, it } from "vitest";

import type { ContractIssue, IssueCode } from "../src/index.js";
import { validateProjectContract } from "../src/index.js";
import { at, baseDocument } from "./helpers.js";

function issuesFor(
  mutate: (document: Record<string, unknown>) => void,
): readonly ContractIssue[] {
  const document = baseDocument();
  mutate(document);
  const result = validateProjectContract(document);
  return result.ok ? [] : result.issues;
}

interface RefCase {
  readonly name: string;
  readonly mutate: (document: Record<string, unknown>) => void;
  readonly code: IssueCode;
  readonly path: string;
}

const brokenReferenceCases: readonly RefCase[] = [
  {
    name: "a candidate pointing at a missing workload",
    mutate: (d) => {
      at(d, "candidates", 0).workload_ref = "no_such_workload";
    },
    code: "reference_not_found",
    path: "candidates[0].workload_ref",
  },
  {
    name: "a deployment pointing at missing hardware",
    mutate: (d) => {
      at(d, "candidates", 0, "deployment").hardware_ref = "hardware.missing";
    },
    code: "reference_not_found",
    path: "candidates[0].deployment.hardware_ref",
  },
  {
    name: "a decision citing missing evidence",
    mutate: (d) => {
      at(d, "decisions", 0).evidence_refs = ["evidence.missing"];
    },
    code: "reference_not_found",
    path: "decisions[0].evidence_refs[0]",
  },
  {
    name: "a decision satisfying a missing constraint",
    mutate: (d) => {
      at(d, "decisions", 0).satisfies_constraints = ["constraint.missing"];
    },
    code: "reference_not_found",
    path: "decisions[0].satisfies_constraints[0]",
  },
  {
    name: "a relationship with a missing source node",
    mutate: (d) => {
      at(d, "architecture", "relationships", 0).source = "node.missing";
    },
    code: "reference_not_found",
    path: "architecture.relationships[0].source",
  },
  {
    name: "a decision binding naming a missing node",
    mutate: (d) => {
      at(d, "architecture", "decision_bindings", 0).node_refs = [
        "node.missing",
      ];
    },
    code: "reference_not_found",
    path: "architecture.decision_bindings[0].node_refs[0]",
  },
  {
    name: "a conformance rule citing a missing constraint",
    mutate: (d) => {
      at(d, "conformance_rules", 0).constraint_ref = "constraint.missing";
    },
    code: "reference_not_found",
    path: "conformance_rules[0].constraint_ref",
  },
  {
    name: "a sanitizer step naming a missing component",
    mutate: (d) => {
      at(d, "conformance_rules", 0).unless = {
        passes_through: [{ component_ref: "node.missing" }],
      };
    },
    code: "reference_not_found",
    path: "conformance_rules[0].unless.passes_through[0].component_ref",
  },
  {
    name: "a workload naming a missing current decision",
    mutate: (d) => {
      at(d, "workloads", 0).current_decision_ref = "decision.missing";
    },
    code: "reference_not_found",
    path: "workloads[0].current_decision_ref",
  },
  {
    name: "an approval naming a missing decision",
    mutate: (d) => {
      d.approvals = [
        {
          decision_ref: "decision.missing",
          decision_revision: 1,
          actor: { kind: "local_user", ref: "developer" },
          approved_at: "2026-08-18T00:00:00Z",
          content_hash: "0".repeat(64),
        },
      ];
    },
    code: "reference_not_found",
    path: "approvals[0].decision_ref",
  },
];

describe("every reference must resolve", () => {
  it.each(brokenReferenceCases)("rejects $name", ({ mutate, code, path }) => {
    const issues = issuesFor(mutate);

    expect(
      issues.some((entry) => entry.code === code && entry.path === path),
    ).toBe(true);
  });
});

const wrongTypeCases: readonly RefCase[] = [
  {
    name: "a workload id used where a candidate is required",
    mutate: (d) => {
      at(d, "decisions", 0).selected_candidate_ref = "classification";
    },
    code: "reference_wrong_type",
    path: "decisions[0].selected_candidate_ref",
  },
  {
    name: "a candidate id used where a workload is required",
    mutate: (d) => {
      at(d, "candidates", 0).workload_ref = "candidate.classification.remote";
    },
    code: "reference_wrong_type",
    path: "candidates[0].workload_ref",
  },
  {
    name: "an architecture node used where a decision is required",
    mutate: (d) => {
      at(d, "architecture", "decision_bindings", 0).decision_ref = "redactor";
    },
    code: "reference_wrong_type",
    path: "architecture.decision_bindings[0].decision_ref",
  },
  {
    name: "a constraint id used where evidence is required",
    mutate: (d) => {
      at(d, "decisions", 0).evidence_refs = ["cost.monthly"];
    },
    code: "reference_wrong_type",
    path: "decisions[0].evidence_refs[0]",
  },
];

describe("references must resolve to the correct subject type", () => {
  it.each(wrongTypeCases)("rejects $name", ({ mutate, code, path }) => {
    const issues = issuesFor(mutate);

    const match = issues.find((entry) => entry.path === path);
    expect(match?.code).toBe(code);
    expect(match?.details).toHaveProperty("found_as");
  });
});

describe("decision scope", () => {
  it("rejects a scope with no discriminator", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).scope = { workload_ref: "classification" };
    });

    expect(
      issues.some((entry) => entry.path.startsWith("decisions[0].scope")),
    ).toBe(true);
  });

  it("rejects an unrecognised scope kind", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).scope = { kind: "team", team_ref: "platform" };
    });

    expect(
      issues.some((entry) => entry.path.startsWith("decisions[0].scope")),
    ).toBe(true);
  });

  it("rejects a workload scope naming a missing workload", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).scope = { kind: "workload", workload_ref: "nope" };
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "reference_not_found" &&
          entry.path === "decisions[0].scope.workload_ref",
      ),
    ).toBe(true);
  });

  it("validates a component scope against architecture nodes", () => {
    const valid = issuesFor((d) => {
      at(d, "decisions", 0).scope = {
        kind: "component",
        component_ref: "redactor",
      };
      at(d, "decisions", 0).selected_candidate_ref = "candidate.drafting.local";
      at(d, "decisions", 0).satisfies_constraints = [];
    });
    expect(valid).toEqual([]);

    const invalid = issuesFor((d) => {
      at(d, "decisions", 0).scope = {
        kind: "component",
        component_ref: "not-a-node",
      };
    });
    expect(
      invalid.some(
        (entry) => entry.path === "decisions[0].scope.component_ref",
      ),
    ).toBe(true);
  });

  it("accepts a project scope with no ref at all", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).scope = { kind: "project" };
      at(d, "decisions", 0).satisfies_constraints = [];
    });

    expect(issues).toEqual([]);
  });

  it("rejects a project scope that smuggles in a workload ref", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).scope = {
        kind: "project",
        workload_ref: "classification",
      };
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "unknown_field" &&
          entry.path === "decisions[0].scope.workload_ref",
      ),
    ).toBe(true);
  });
});

describe("a workload decision cannot select another workload's candidate", () => {
  it("rejects a selected candidate belonging to a different workload", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).selected_candidate_ref = "candidate.drafting.local";
      at(d, "decisions", 0).satisfies_constraints = [];
    });

    const match = issues.find(
      (entry) => entry.code === "candidate_workload_mismatch",
    );
    expect(match?.path).toBe("decisions[0].selected_candidate_ref");
    expect(match?.details).toMatchObject({
      candidate_workload: "drafting",
      decision_workload: "classification",
    });
  });

  it("rejects an alternative belonging to a different workload", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).alternatives = ["candidate.drafting.local"];
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "candidate_workload_mismatch" &&
          entry.path === "decisions[0].alternatives[0]",
      ),
    ).toBe(true);
  });

  it("rejects a candidate that serves no workload at all", () => {
    const issues = issuesFor((d) => {
      at(d, "candidates", 0).workload_ref = null;
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "candidate_workload_mismatch" &&
          entry.path === "decisions[0].selected_candidate_ref",
      ),
    ).toBe(true);
  });

  it("rejects an allowlist rule listing another workload's candidate", () => {
    const issues = issuesFor((d) => {
      at(d, "conformance_rules", 1).allowed_candidate_refs = [
        "candidate.drafting.local",
      ];
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "candidate_workload_mismatch" &&
          entry.path === "conformance_rules[1].allowed_candidate_refs[0]",
      ),
    ).toBe(true);
  });
});

describe("constraint subjects and data classifications", () => {
  it("rejects a subject naming a workload that does not exist", () => {
    const issues = issuesFor((d) => {
      at(d, "constraints", 0).subject = "workload.ghost.metric.macro_f1";
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "constraint_subject_unresolved" &&
          entry.path === "constraints[0].subject",
      ),
    ).toBe(true);
  });

  it("rejects a subject naming an undeclared data classification", () => {
    const issues = issuesFor((d) => {
      at(d, "constraints", 1).subject = "data.never_declared";
    });

    expect(
      issues.some((entry) => entry.code === "constraint_subject_unresolved"),
    ).toBe(true);
  });

  it("rejects a relationship carrying an undeclared data classification", () => {
    const issues = issuesFor((d) => {
      at(d, "architecture", "relationships", 0).data_classification = "mystery";
    });

    expect(
      issues.some(
        (entry) =>
          entry.path === "architecture.relationships[0].data_classification",
      ),
    ).toBe(true);
  });
});

describe("the remote-intelligence projection", () => {
  it("rejects a field that is both allowed and denied", () => {
    const issues = issuesFor((d) => {
      at(d, "remote_intelligence_policy").default_allow = ["intent", "owners"];
      at(d, "remote_intelligence_policy").default_deny = ["owners"];
    });

    expect(
      issues.some((entry) => entry.code === "remote_policy_conflict"),
    ).toBe(true);
  });

  it("refuses to send a ratified default-deny field to remote intelligence", () => {
    const issues = issuesFor((d) => {
      at(d, "remote_intelligence_policy").default_allow = [
        "intent",
        "file_contents",
      ];
    });

    const match = issues.find(
      (entry) => entry.code === "remote_policy_denied_field_allowed",
    );
    expect(match?.details).toMatchObject({ field: "file_contents" });
  });

  it("still allows non-identifying hardware capability", () => {
    const issues = issuesFor((d) => {
      at(d, "remote_intelligence_policy").default_allow = [
        "intent",
        "non_identifying_hardware_capabilities",
      ];
    });

    expect(issues).toEqual([]);
  });
});

describe("approved decisions", () => {
  it("cannot be approved without a user review", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).status = "approved";
      at(d, "decisions", 0, "rationale").reviewed_by_user = false;
    });

    expect(
      issues.some(
        (entry) => entry.path === "decisions[0].rationale.reviewed_by_user",
      ),
    ).toBe(true);
  });

  it("cannot be approved without an approval record", () => {
    const issues = issuesFor((d) => {
      at(d, "decisions", 0).status = "approved";
    });

    expect(
      issues.some(
        (entry) =>
          entry.code === "approval_content_unresolved" &&
          entry.path === "decisions[0].status",
      ),
    ).toBe(true);
  });
});
