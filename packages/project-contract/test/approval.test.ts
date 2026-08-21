import { describe, expect, it } from "vitest";

import type { ProjectContract } from "../src/index.js";
import {
  appendApproval,
  approvalState,
  computeApprovalHash,
  isApprovalCurrent,
  resolveDecision,
  unwrap,
  validateProjectContract,
} from "../src/index.js";
import { at, baseDocument } from "./helpers.js";

const DECISION = "decision.classification.v1";

function contractFrom(
  mutate: (document: Record<string, unknown>) => void = () => {},
): ProjectContract {
  const document = baseDocument();
  mutate(document);
  return unwrap(validateProjectContract(document));
}

/** An approved contract: base document plus a matching approval record. */
function approvedContract(
  mutate: (document: Record<string, unknown>) => void = () => {},
): ProjectContract {
  const base = contractFrom(mutate);
  const approved = unwrap(
    appendApproval(base, {
      decisionId: DECISION,
      actorRef: "developer",
      approvedAt: "2026-08-18T00:00:00Z",
    }),
  );
  return approved;
}

describe("resolved approval content", () => {
  it("covers the decision revision, candidate, evidence, and constraint results", () => {
    const resolved = unwrap(resolveDecision(contractFrom(), DECISION));

    expect(resolved.content.decision_id).toBe(DECISION);
    expect(resolved.content.decision_revision).toBe(1);
    expect(resolved.content.selected_candidate.id).toBe(
      "candidate.classification.local",
    );
    expect(resolved.content.cited_evidence.map((entry) => entry.id)).toEqual([
      "evidence.eval.classification",
    ]);
    expect(
      resolved.content.constraint_results.map((entry) => entry.constraint_ref),
    ).toEqual(["quality.classification_f1"]);
  });

  it("is stable across repeated computation", () => {
    const contract = contractFrom();

    const first = unwrap(computeApprovalHash(contract, DECISION));
    const second = unwrap(computeApprovalHash(contract, DECISION));

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on the key order of the source document", () => {
    const document = baseDocument();
    const reversed = Object.fromEntries(Object.entries(document).reverse());

    const fromOriginal = unwrap(
      computeApprovalHash(unwrap(validateProjectContract(document)), DECISION),
    );
    const fromReversed = unwrap(
      computeApprovalHash(unwrap(validateProjectContract(reversed)), DECISION),
    );

    expect(fromReversed).toBe(fromOriginal);
  });
});

describe("an approval becomes non-current when resolved content changes", () => {
  it("starts current", () => {
    const contract = approvedContract();

    expect(isApprovalCurrent(contract, DECISION)).toBe(true);
    expect(approvalState(contract, DECISION).state).toBe("current");
  });

  it("is invalidated when the selected candidate changes", () => {
    const approved = approvedContract();
    const edited: ProjectContract = {
      ...approved,
      candidates: approved.candidates.map((candidate) =>
        candidate.id === "candidate.classification.local"
          ? {
              ...candidate,
              deployment: {
                mode: "managed_api",
                provider: "other",
                region: "us",
              },
            }
          : candidate,
      ),
    };

    expect(isApprovalCurrent(edited, DECISION)).toBe(false);
    expect(approvalState(edited, DECISION).state).toBe("stale");
  });

  it("is invalidated when the decision selects a different candidate", () => {
    const approved = approvedContract();
    const edited: ProjectContract = {
      ...approved,
      decisions: approved.decisions.map((decision) => ({
        ...decision,
        selected_candidate_ref: "candidate.classification.remote",
        satisfies_constraints: [],
      })),
    };

    expect(isApprovalCurrent(edited, DECISION)).toBe(false);
  });

  it("is invalidated when cited evidence changes", () => {
    const approved = approvedContract();
    const edited: ProjectContract = {
      ...approved,
      evidence_refs: approved.evidence_refs.map((record) =>
        record.id === "evidence.eval.classification" &&
        record.kind === "measured_evaluation"
          ? {
              ...record,
              value: { ...record.value, metrics: { macro_f1: 0.91 } },
            }
          : record,
      ),
    };

    expect(isApprovalCurrent(edited, DECISION)).toBe(false);
  });

  it("is invalidated when a constraint result changes", () => {
    const approved = approvedContract();
    const edited: ProjectContract = {
      ...approved,
      candidates: approved.candidates.map((candidate) =>
        candidate.id === "candidate.classification.local"
          ? {
              ...candidate,
              constraint_results: candidate.constraint_results.map(
                (result) => ({
                  ...result,
                  status: "unknown" as const,
                }),
              ),
            }
          : candidate,
      ),
    };

    expect(isApprovalCurrent(edited, DECISION)).toBe(false);
  });

  it("is invalidated when the decision revision is bumped", () => {
    const approved = approvedContract();
    const edited: ProjectContract = {
      ...approved,
      decisions: approved.decisions.map((decision) => ({
        ...decision,
        revision: 2,
      })),
    };

    expect(isApprovalCurrent(edited, DECISION)).toBe(false);
  });
});

describe("unrelated presentation changes do not disturb an approval", () => {
  const presentationEdits: readonly [
    string,
    (c: ProjectContract) => ProjectContract,
  ][] = [
    [
      "the project name",
      (c) => ({ ...c, project: { ...c.project, name: "Renamed Project" } }),
    ],
    [
      "the project updated_at timestamp",
      (c) => ({
        ...c,
        project: { ...c.project, updated_at: "2026-09-01T00:00:00Z" },
      }),
    ],
    [
      "the intent summary",
      (c) => ({
        ...c,
        intent: { ...c.intent, summary: "A reworded summary." },
      }),
    ],
    [
      "an unresolved question",
      (c) => ({
        ...c,
        intent: { ...c.intent, unresolved_questions: ["Which region?"] },
      }),
    ],
    [
      "the decision rationale prose",
      (c) => ({
        ...c,
        decisions: c.decisions.map((decision) => ({
          ...decision,
          rationale: { ...decision.rationale, summary: "Reworded rationale." },
        })),
      }),
    ],
    [
      "an unrelated candidate",
      (c) => ({
        ...c,
        candidates: c.candidates.map((candidate) =>
          candidate.id === "candidate.drafting.local"
            ? { ...candidate, status: "rejected" as const }
            : candidate,
        ),
      }),
    ],
    [
      "an unrelated evidence record",
      (c) => ({
        ...c,
        evidence_refs: c.evidence_refs.map((record) =>
          record.id === "evidence.vendor.claim"
            ? { ...record, confidence: "medium" as const }
            : record,
        ),
      }),
    ],
  ];

  it.each(presentationEdits)(
    "changing %s keeps the approval current",
    (_name, edit) => {
      const approved = approvedContract();
      const before = unwrap(computeApprovalHash(approved, DECISION));

      const edited = edit(approved);

      expect(unwrap(computeApprovalHash(edited, DECISION))).toBe(before);
      expect(isApprovalCurrent(edited, DECISION)).toBe(true);
    },
  );
});

describe("approval history is append-only", () => {
  it("appends without removing earlier entries", () => {
    const first = approvedContract();
    const second = unwrap(
      appendApproval(first, {
        decisionId: DECISION,
        actorRef: "second-developer",
        approvedAt: "2026-08-19T00:00:00Z",
        note: "re-approved after review",
      }),
    );

    expect(first.approvals).toHaveLength(1);
    expect(second.approvals).toHaveLength(2);
    expect(second.approvals[0]).toEqual(first.approvals[0]);
  });

  it("does not mutate the contract it was given", () => {
    const contract = contractFrom();
    appendApproval(contract, {
      decisionId: DECISION,
      actorRef: "developer",
      approvedAt: "2026-08-18T00:00:00Z",
    });

    expect(contract.approvals).toEqual([]);
  });

  it("records the actor as a local user", () => {
    const approved = approvedContract();

    expect(approved.approvals[0]?.actor).toEqual({
      kind: "local_user",
      ref: "developer",
    });
    expect(approved.approvals[0]?.hash_algorithm).toBe("sha-256");
  });

  it("refuses an entry that predates the previous one", () => {
    const approved = approvedContract();

    const result = appendApproval(approved, {
      decisionId: DECISION,
      actorRef: "developer",
      approvedAt: "2026-08-01T00:00:00Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("approval_history_not_append_only");
  });

  it("keeps a superseded approval in history rather than deleting it", () => {
    const approved = approvedContract();
    const edited: ProjectContract = {
      ...approved,
      decisions: approved.decisions.map((decision) => ({
        ...decision,
        revision: 2,
      })),
    };

    const state = approvalState(edited, DECISION);
    expect(state.state).toBe("stale");
    expect(edited.approvals).toHaveLength(1);
  });

  it("rejects a contract whose approval history is out of order", () => {
    const document = baseDocument();
    document.approvals = [
      {
        decision_ref: DECISION,
        decision_revision: 1,
        actor: { kind: "local_user", ref: "developer" },
        approved_at: "2026-08-19T00:00:00Z",
        content_hash: "a".repeat(64),
      },
      {
        decision_ref: DECISION,
        decision_revision: 1,
        actor: { kind: "local_user", ref: "developer" },
        approved_at: "2026-08-18T00:00:00Z",
        content_hash: "b".repeat(64),
      },
    ];

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (entry) => entry.code === "approval_history_not_append_only",
      ),
    ).toBe(true);
  });
});

describe("missing content prevents approval resolution", () => {
  it("refuses when the decision selects no candidate", () => {
    const contract = contractFrom((document) => {
      at(document, "decisions", 0).selected_candidate_ref = null;
      at(document, "decisions", 0).satisfies_constraints = [];
    });

    const result = computeApprovalHash(contract, DECISION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("approval_content_unresolved");
  });

  it("refuses when the selected candidate has been removed", () => {
    const approved = approvedContract();
    const edited: ProjectContract = {
      ...approved,
      candidates: approved.candidates.filter(
        (candidate) => candidate.id !== "candidate.classification.local",
      ),
    };

    const result = computeApprovalHash(edited, DECISION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("approval_content_unresolved");
    expect(approvalState(edited, DECISION).state).toBe("unresolvable");
  });

  it("refuses when cited evidence has been removed", () => {
    const approved = approvedContract();
    const edited: ProjectContract = { ...approved, evidence_refs: [] };

    const result = computeApprovalHash(edited, DECISION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("approval_content_unresolved");
  });

  it("refuses when a claimed constraint result is absent", () => {
    const contract = contractFrom((document) => {
      at(document, "candidates", 0).constraint_results = [];
      at(document, "decisions", 0).satisfies_constraints = [
        "quality.classification_f1",
      ];
    });

    const result = computeApprovalHash(contract, DECISION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("approval_content_unresolved");
    expect(result.issues[0]?.message).toContain("records no result for it");
  });

  it("refuses for a decision that does not exist", () => {
    const result = computeApprovalHash(contractFrom(), "decision.missing");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("reference_not_found");
  });

  it("reports no approval when none was ever made", () => {
    expect(approvalState(contractFrom(), DECISION).state).toBe("none");
  });
});

/**
 * The tests above exercise `approvalState` and `isApprovalCurrent`. These
 * exercise `validateProjectContract` itself: a contract carrying a stale or
 * forged approval hash must not validate.
 */
describe("validateProjectContract verifies stored approval hashes", () => {
  /** An approved decision plus a matching, current approval record. */
  function approvedDocument(): Record<string, unknown> {
    const contract = approvedContract();
    const document = JSON.parse(
      JSON.stringify({
        ...contract,
        decisions: contract.decisions.map((decision) => ({
          ...decision,
          status: "approved",
        })),
      }),
    ) as Record<string, unknown>;
    return document;
  }

  it("accepts an approved decision whose approval matches current content", () => {
    const result = validateProjectContract(approvedDocument());

    if (!result.ok) {
      throw new Error(
        result.issues
          .map((entry) => `[${entry.code}] ${entry.path}: ${entry.message}`)
          .join("\n"),
      );
    }
    expect(result.ok).toBe(true);
  });

  it("rejects a forged approval hash", () => {
    const document = approvedDocument();
    at(document, "approvals", 0).content_hash = "0".repeat(64);

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const match = result.issues.find(
      (entry) => entry.code === "approval_hash_mismatch",
    );
    expect(match?.path).toBe("approvals[0].content_hash");
    expect(match?.details).toMatchObject({ stored_hash: "0".repeat(64) });
  });

  it("rejects an approved decision after its selected candidate changed", () => {
    const document = approvedDocument();
    at(document, "candidates", 0, "deployment").runtime = "a-different-runtime";

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((entry) => entry.code === "approval_hash_mismatch"),
    ).toBe(true);
  });

  it("rejects an approved decision after cited evidence changed", () => {
    const document = approvedDocument();
    at(document, "evidence_refs", 0, "value").metrics = { macro_f1: 0.91 };

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((entry) => entry.code === "approval_hash_mismatch"),
    ).toBe(true);
  });

  it("rejects an approved decision after an approved constraint result changed", () => {
    const document = approvedDocument();
    at(document, "candidates", 0, "constraint_results", 0).determinism =
      "inferred";

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some((entry) => entry.code === "approval_hash_mismatch"),
    ).toBe(true);
  });

  it("rejects an approval whose content can no longer be resolved", () => {
    const document = approvedDocument();
    // Remove the evidence the approved constraint result relies on.
    (document.evidence_refs as unknown[]).splice(0, 1);
    at(document, "candidates", 0).measurements = {};
    at(document, "decisions", 0).evidence_refs = [];
    at(document, "candidates", 0, "constraint_results", 0).evidence_refs = [];

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The result now asserts a pass with no evidence at all, and the approval
    // no longer describes the content.
    expect(
      result.issues.some(
        (entry) =>
          entry.code === "approval_hash_mismatch" ||
          entry.code === "approval_content_unresolved",
      ),
    ).toBe(true);
  });

  it("reports unresolvable approval content rather than silently passing", () => {
    const document = approvedDocument();
    at(document, "decisions", 0).satisfies_constraints = [
      "quality.classification_f1",
      "privacy.raw_remote",
    ];

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (entry) =>
          entry.code === "approval_content_unresolved" &&
          entry.path === "approvals[0].content_hash",
      ),
    ).toBe(true);
  });

  it("keeps an approval of an older revision as valid history", () => {
    const document = approvedDocument();
    // The decision advances to revision 2 and is re-approved; the revision-1
    // entry must remain in history without being rejected.
    const firstApproval = JSON.parse(
      JSON.stringify(at(document, "approvals", 0)),
    ) as Record<string, unknown>;
    at(document, "decisions", 0).revision = 2;
    at(document, "decisions", 0).status = "proposed";
    document.approvals = [firstApproval];

    const result = validateProjectContract(document);

    if (!result.ok) {
      expect(
        result.issues.filter(
          (entry) =>
            entry.code === "approval_hash_mismatch" ||
            entry.code === "approval_content_unresolved",
        ),
      ).toEqual([]);
    }
    expect(result.ok).toBe(true);
  });

  it("refuses an approved decision covered only by an older revision's approval", () => {
    const document = approvedDocument();
    at(document, "decisions", 0).revision = 2;

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (entry) =>
          entry.code === "approval_content_unresolved" &&
          entry.path === "decisions[0].status",
      ),
    ).toBe(true);
  });
});

describe("approval evidence closure", () => {
  it("covers evidence relied on by a constraint result even when the decision omits it", () => {
    // The decision lists no evidence of its own; the constraint result does.
    const contract = contractFrom((document) => {
      at(document, "decisions", 0).evidence_refs = [];
    });

    const resolved = unwrap(resolveDecision(contract, DECISION));
    expect(resolved.content.cited_evidence.map((entry) => entry.id)).toEqual([
      "evidence.eval.classification",
    ]);
  });

  it("invalidates an approval when that undeclared evidence is edited", () => {
    const base = contractFrom((document) => {
      at(document, "decisions", 0).evidence_refs = [];
    });
    const approved = unwrap(
      appendApproval(base, {
        decisionId: DECISION,
        actorRef: "developer",
        approvedAt: "2026-08-18T00:00:00Z",
      }),
    );
    expect(isApprovalCurrent(approved, DECISION)).toBe(true);

    const edited: ProjectContract = {
      ...approved,
      evidence_refs: approved.evidence_refs.map((record) =>
        record.id === "evidence.eval.classification" &&
        record.kind === "measured_evaluation"
          ? {
              ...record,
              value: { ...record.value, metrics: { macro_f1: 0.42 } },
            }
          : record,
      ),
    };

    expect(isApprovalCurrent(edited, DECISION)).toBe(false);
  });

  it("fails to resolve when constraint-result evidence is missing", () => {
    const contract = contractFrom((document) => {
      at(document, "decisions", 0).evidence_refs = [];
    });
    const stripped: ProjectContract = { ...contract, evidence_refs: [] };

    const result = computeApprovalHash(stripped, DECISION);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("approval_content_unresolved");
  });
});

describe("constraint attribution is part of approved content", () => {
  it("invalidates an approval when evidence attribution is edited", () => {
    const approved = approvedContract();
    expect(isApprovalCurrent(approved, DECISION)).toBe(true);

    // `applies_to` lives inside the evidence record, and the approval hash
    // covers each cited record's full content, so re-attributing the evidence
    // changes what was approved.
    const edited: ProjectContract = {
      ...approved,
      evidence_refs: approved.evidence_refs.map((record) =>
        record.id === "evidence.eval.classification"
          ? {
              ...record,
              applies_to: {
                ...record.applies_to,
                constraint_refs: [
                  ...record.applies_to.constraint_refs,
                  "privacy.raw_remote",
                ],
              },
            }
          : record,
      ),
    };

    expect(isApprovalCurrent(edited, DECISION)).toBe(false);
    expect(approvalState(edited, DECISION).state).toBe("stale");
  });
});
