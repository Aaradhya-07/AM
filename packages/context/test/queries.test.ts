import { describe, expect, it } from "vitest";

import type { QueryContext, QueryEnvelope, QueryError } from "../src/index.js";
import {
  PROJECT_TOOL_NAMES,
  buildProjectFacts,
  runProjectQuery,
} from "../src/index.js";
import { AS_OF, allKindsContract, approvedAtlas, atlas } from "./helpers.js";

function context(contract = approvedAtlas()): QueryContext {
  return {
    contract,
    stateRevision: 5,
    asOf: AS_OF,
    projection: "remote-default",
  };
}

function ok<T = Record<string, unknown>>(result: unknown): QueryEnvelope<T> {
  expect((result as { ok: boolean }).ok, JSON.stringify(result)).toBe(true);
  return result as QueryEnvelope<T>;
}

function error(result: unknown): QueryError {
  expect((result as { ok: boolean }).ok).toBe(false);
  return result as QueryError;
}

describe("every tool", () => {
  it("is exactly the five read-only tools", () => {
    expect([...PROJECT_TOOL_NAMES]).toEqual([
      "get_project_summary",
      "get_constraints",
      "get_workload_decision",
      "get_architecture_context",
      "list_evidence_gaps",
    ]);
  });

  it.each(PROJECT_TOOL_NAMES)(
    "%s carries the source marker and approval standing",
    (tool) => {
      const ctx = context();
      const args =
        tool === "get_workload_decision" ? { workload: "classification" } : {};
      const result = ok(runProjectQuery(tool, args, ctx));
      expect(result.source).toEqual(
        buildProjectFacts(ctx.contract, { asOf: AS_OF, stateRevision: 5 })
          .source,
      );
      expect(result.approval_standing.summary).toBe("approved_current 1");
      expect(result.approval_standing.note).toMatch(
        /does not show that evidence is fresh/,
      );
      expect(result.authority).toMatch(/Generated files are never read/);
      // Same inputs, same bytes: nothing depends on who asks or when it runs.
      expect(JSON.stringify(runProjectQuery(tool, args, ctx))).toBe(
        JSON.stringify(result),
      );
    },
  );

  it.each(PROJECT_TOOL_NAMES)(
    "%s refuses unknown arguments with a source-marked error",
    (tool) => {
      const args =
        tool === "get_workload_decision"
          ? { workload: "classification", extra: 1 }
          : { extra: 1 };
      const result = error(runProjectQuery(tool, args, context()));
      expect(result.error.code).toBe("invalid_arguments");
      expect(result.error.message).toContain("extra");
      expect(result.source?.contract_hash).toMatch(/^sha256:/);
    },
  );
});

describe("get_project_summary", () => {
  it("summarises intent, workloads with effective decisions and counts", () => {
    const result = ok<{
      intent: string;
      workloads: { id: string; effective_decision: string | null }[];
      counts: Record<string, number>;
    }>(runProjectQuery("get_project_summary", {}, context()));
    expect(result.data.intent).toMatch(/multilingual customer tickets/);
    expect(
      result.data.workloads.find((entry) => entry.id === "classification")
        ?.effective_decision,
    ).toBe("decision.classification");
    expect(result.data.counts.architecture_nodes).toBe(4);
    expect(result.data.counts.evidence_gaps).toBeGreaterThan(0);
  });
});

describe("get_constraints", () => {
  it("filters by workload, severity and domain and says why each applies", () => {
    const result = ok<{
      constraints: { id: string; applies_because: string }[];
    }>(
      runProjectQuery(
        "get_constraints",
        { workload: "pii_redaction" },
        context(),
      ),
    );
    expect(
      result.data.constraints.map((entry) => [entry.id, entry.applies_because]),
    ).toEqual([
      ["budget.ai_monthly", "project-wide subject"],
      [
        "privacy.raw_ticket_remote",
        "subject names data classification raw_customer_ticket, which workload pii_redaction declares",
      ],
      ["quality.pii_recall", "subject names workload pii_redaction"],
    ]);
    const hard = ok<{ constraints: { severity: string }[] }>(
      runProjectQuery(
        "get_constraints",
        { severity: "hard", domain: "quality" },
        context(),
      ),
    );
    expect(hard.data.constraints.length).toBeGreaterThan(0);
    expect(
      hard.data.constraints.every((entry) => entry.severity === "hard"),
    ).toBe(true);
  });

  it.each([
    [
      { workload: "nope" },
      "workload",
      [
        "classification",
        "extraction",
        "pii_redaction",
        "response_drafting",
        "retrieval",
      ],
    ],
    [{ severity: "critical" }, "severity", ["hard", "soft", "informational"]],
    [
      { domain: "vibes" },
      "domain",
      ["availability", "cost", "latency", "privacy", "quality"],
    ],
  ])(
    "reports an invalid filter %j with the valid values",
    (args, field, validValues) => {
      const result = error(runProjectQuery("get_constraints", args, context()));
      expect(result.error).toMatchObject({
        code: "invalid_filter",
        field,
        valid_values: validValues,
      });
    },
  );

  it("refuses a non-string filter", () => {
    expect(
      error(runProjectQuery("get_constraints", { workload: 3 }, context()))
        .error.message,
    ).toBe("workload must be a non-empty string");
  });
});

describe("get_workload_decision", () => {
  it("returns the approved decision as an instruction", () => {
    const result = ok<{
      instruction: string;
      workload: { effective_decision: string | null };
    }>(
      runProjectQuery(
        "get_workload_decision",
        { workload: "classification" },
        context(),
      ),
    );
    expect(result.data.workload.effective_decision).toBe(
      "decision.classification",
    );
    expect(result.data.instruction).toBe(
      "Decision decision.classification is approved and current for workload classification.",
    );
    expect(result.approval_standing.decisions).toEqual([
      {
        id: "decision.classification",
        standing: "approved_current",
        instruction_eligible: true,
      },
    ]);
  });

  it("never presents a stale decision as an instruction", () => {
    const contract = structuredClone(approvedAtlas());
    contract.candidates[0]!.estimates.assumptions.push("changed");
    contract.candidates[1]!.estimates.assumptions.push("changed");
    const result = ok<{ instruction: string }>(
      runProjectQuery(
        "get_workload_decision",
        { workload: "classification" },
        context(contract),
      ),
    );
    expect(result.approval_standing.decisions[0]).toMatchObject({
      standing: "approved_stale",
      instruction_eligible: false,
    });
    expect(result.data.instruction).toMatch(
      /^No approved, current decision exists/,
    );
  });

  it("requires a workload and lists the valid ones", () => {
    const result = error(
      runProjectQuery("get_workload_decision", {}, context()),
    );
    expect(result.error.message).toMatch(
      /^workload is required; valid values: classification/,
    );
  });
});

describe("get_architecture_context", () => {
  it("filters by component to the component and its neighbours", () => {
    const result = ok<{
      nodes: { id: string }[];
      relationships: { id: string }[];
      trust_boundary_crossings: unknown[];
    }>(
      runProjectQuery(
        "get_architecture_context",
        { component: "ticket-classifier" },
        context(),
      ),
    );
    expect(result.data.nodes.map((node) => node.id)).toEqual([
      "pii-redactor",
      "remote-model-provider",
      "ticket-classifier",
    ]);
    expect(result.data.relationships.map((entry) => entry.id)).toEqual([
      "pii-redactor-to-ticket-classifier",
      "ticket-classifier-to-remote-model-provider",
    ]);
    expect(result.data.trust_boundary_crossings).toEqual([
      {
        relationship: "ticket-classifier-to-remote-model-provider",
        from: "local",
        to: "remote_provider",
        data_classification: "redacted_customer_ticket",
      },
    ]);
  });

  it("filters by workload, and by both", async () => {
    const ctx = context(await atlas());
    const byWorkload = ok<{ nodes: { id: string }[] }>(
      runProjectQuery(
        "get_architecture_context",
        { workload: "pii_redaction" },
        ctx,
      ),
    );
    expect(byWorkload.data.nodes.map((node) => node.id)).toEqual([
      "pii-redactor",
      "ticket-intake",
    ]);
    const both = ok<{ nodes: { id: string }[]; relationships: unknown[] }>(
      runProjectQuery(
        "get_architecture_context",
        { workload: "retrieval", component: "ticket-intake" },
        ctx,
      ),
    );
    expect(both.data.relationships).toEqual([]);
    expect(both.data.nodes.map((node) => node.id)).toEqual(["ticket-intake"]);
  });

  it("reports an unknown component with the valid node ids", () => {
    const result = error(
      runProjectQuery(
        "get_architecture_context",
        { component: "mainframe" },
        context(allKindsContract()),
      ),
    );
    expect(result.error.valid_values).toEqual([
      "agent",
      "api",
      "provider",
      "queue",
      "runtime",
      "store",
      "vendor",
    ]);
  });
});

describe("list_evidence_gaps", () => {
  it("lists gaps at as_of, optionally for one workload", () => {
    const all = ok<{
      workloads: { workload_ref: string }[];
      project: unknown[];
    }>(runProjectQuery("list_evidence_gaps", {}, context()));
    expect(all.data.workloads.map((entry) => entry.workload_ref)).toContain(
      "classification",
    );
    expect(all.data.project.length).toBeGreaterThan(0);
    const one = ok<{
      workloads: { workload_ref: string }[];
      project: unknown[];
    }>(
      runProjectQuery(
        "list_evidence_gaps",
        { workload: "retrieval" },
        context(),
      ),
    );
    expect(one.data.workloads.map((entry) => entry.workload_ref)).toEqual([
      "retrieval",
    ]);
    expect(one.data.project).toEqual([]);
  });
});
