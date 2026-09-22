import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { ContractIssue } from "../src/index.js";
import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  approvalState,
  computeApprovalHash,
  parseProjectContract,
  readAtlasFixtureText,
  toNormalizedYaml,
  validateProjectContract,
} from "../src/index.js";
import { at, baseDocument } from "./helpers.js";

/**
 * Amendments 6 and 7 (docs/vnext/08-milestone-3-scope-proposal.md), accepted
 * September 14, 2026 and implemented as 0.1.0-draft.4.
 */

function issuesFor(
  mutate: (document: Record<string, unknown>) => void,
): readonly ContractIssue[] {
  const document = baseDocument();
  mutate(document);
  const result = validateProjectContract(document);
  return result.ok ? [] : result.issues;
}

const usage = (d: Record<string, unknown>, index = 1) =>
  at(d, "workloads", index, "expected_usage") as Record<string, unknown>;

/** Rewrites only the two version fields, as the migration note describes. */
function asVersion(text: string, version: string): string {
  return text
    .replace(
      /^schema: https:\/\/anvilmark\.dev\/schemas\/project\/[^\n]+$/m,
      `schema: https://anvilmark.dev/schemas/project/${version}`,
    )
    .replace(/^schema_version: [^\n]+$/m, `schema_version: ${version}`);
}

describe("draft.4 schema line", () => {
  it("has been superseded by draft.5, which keeps these amendments", () => {
    // The current version is asserted in draft5-amendments.test.ts.
    expect(PROJECT_SCHEMA_VERSION).not.toBe("0.1.0-draft.4");
    expect(PROJECT_SCHEMA_ID).toBe(
      `https://anvilmark.dev/schemas/project/${PROJECT_SCHEMA_VERSION}`,
    );
  });
});

describe("Amendment 6: a workload whose monthly usage is unknown", () => {
  it("is valid with calls_per_month null and basis unknown, and stays null", () => {
    const document = baseDocument();
    usage(document).calls_per_month = null;
    usage(document).basis = "unknown";
    const result = validateProjectContract(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.value.workloads[1]?.expected_usage;
    expect(stored?.calls_per_month).toBeNull();
    expect(stored?.basis).toBe("unknown");
    // Round trip: unknown never becomes zero.
    const reparsed = parseProjectContract(toNormalizedYaml(result.value));
    expect(reparsed.ok && reparsed.value.workloads[1]?.expected_usage).toEqual(
      stored,
    );
    expect(toNormalizedYaml(result.value)).toContain("calls_per_month: null");
  });

  it.each(["user_assumption", "measured", "vendor_claim", "agent_inference"])(
    "refuses a null volume with basis %s",
    (basis) => {
      const issues = issuesFor((d) => {
        usage(d).calls_per_month = null;
        usage(d).basis = basis;
      });
      expect(issues.map((entry) => entry.path)).toContain(
        "workloads[1].expected_usage.basis",
      );
      expect(issues[0]?.message).toContain('basis must be "unknown"');
    },
  );

  it.each([0, 1000])("refuses basis unknown with a number (%s)", (calls) => {
    const issues = issuesFor((d) => {
      usage(d).calls_per_month = calls;
      usage(d).basis = "unknown";
    });
    expect(issues.map((entry) => entry.path)).toContain(
      "workloads[1].expected_usage.calls_per_month",
    );
  });

  it("still requires the key: unknown is written, never implied by omission", () => {
    const issues = issuesFor((d) => {
      delete usage(d).calls_per_month;
      usage(d).basis = "unknown";
    });
    expect(issues.some((entry) => entry.code === "missing_field")).toBe(true);
  });

  it("keeps a projected cost comparison from passing", () => {
    // The same complete pricing, arithmetic and assumptions that pass with a
    // declared volume (evidence.test.ts) are refused when usage is unknown.
    const costResult = (unknown: boolean) =>
      issuesFor((d) => {
        const expected = at(d, "workloads", 0, "expected_usage");
        if (unknown) {
          expected.calls_per_month = null;
          expected.basis = "unknown";
        }
        at(d, "candidates", 0).estimates = {
          monthly_effective_cost_usd: 120,
          basis: "official pricing multiplied by declared monthly call volume",
          assumptions: ["40k calls per month at 900 input tokens"],
        };
        (d.evidence_refs as unknown[]).push({
          id: "evidence.pricing",
          kind: "official_pricing",
          subject: "candidate pricing",
          producer: { name: "publisher" },
          observed_at: "2026-08-17T00:00:00Z",
          source: { type: "url", locator: "https://example.invalid/pricing" },
          applies_to: {
            candidate_ref: "candidate.classification.local",
            constraint_refs: ["cost.monthly"],
          },
          value: {
            currency: "USD",
            unit: "1k_tokens",
            amount: 0.5,
            exclusions: [],
          },
          confidence: "high",
          caveats: [],
          refresh: { policy: "on_pricing_change" },
        });
        (
          at(d, "candidates", 0).constraint_results as Record<string, unknown>[]
        ).push({
          constraint_ref: "cost.monthly",
          status: "pass",
          evidence_refs: ["evidence.pricing"],
          determinism: "deterministic",
        });
      });
    expect(costResult(false)).toEqual([]);
    expect(
      costResult(true).some(
        (entry) => entry.code === "pass_below_evidence_floor",
      ),
    ).toBe(true);
  });
});

describe("Amendment 7: workload output data classification", () => {
  it("defaults to null, meaning not declared", () => {
    const result = validateProjectContract(baseDocument());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.workloads.map((entry) => entry.output_classification),
    ).toEqual([null, null]);
  });

  it("lets constraints, relationships and dataflow rules name a declared output label", () => {
    const document = baseDocument();
    at(document, "workloads", 1).output_classification = "customer_reply_draft";
    (document.constraints as unknown[]).push({
      id: "privacy.reply_draft",
      domain: "privacy",
      severity: "informational",
      subject: "data.customer_reply_draft",
      operator: "must_not_leave",
      value: "local_trust_boundary",
      source: "user",
    });
    at(document, "architecture", "relationships", 0).data_classification =
      "customer_reply_draft";
    at(document, "conformance_rules", 0).from = {
      data_classification: "customer_reply_draft",
    };
    const result = validateProjectContract(document);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it("still refuses a label no workload declares as input or output", () => {
    const issues = issuesFor((d) => {
      (d.constraints as unknown[]).push({
        id: "privacy.unknown_label",
        domain: "privacy",
        severity: "informational",
        subject: "data.customer_reply_draft",
        operator: "must_not_leave",
        value: "local_trust_boundary",
        source: "user",
      });
    });
    expect(issues.map((entry) => entry.code)).toContain(
      "constraint_subject_unresolved",
    );
    expect(issues.map((entry) => entry.message).join(" ")).toContain(
      "which no workload declares as an input or output",
    );
  });

  it("refuses a label that is not lower_snake_case", () => {
    const issues = issuesFor((d) => {
      at(d, "workloads", 0).output_classification = "Not A Label";
    });
    expect(issues.map((entry) => entry.path)).toContain(
      "workloads[0].output_classification",
    );
  });
});

describe("compatibility with draft.3 documents", () => {
  it("migrates the Atlas fixture by changing only its version fields", async () => {
    const draft4 = await readAtlasFixtureText();
    const draft3 = asVersion(draft4, "0.1.0-draft.3");
    // The committed fixture differs from its draft.3 form in exactly two lines.
    const changed = draft4
      .split("\n")
      .filter((line, index) => line !== draft3.split("\n")[index]);
    expect(changed).toEqual([
      `schema: https://anvilmark.dev/schemas/project/${PROJECT_SCHEMA_VERSION}`,
      `schema_version: ${PROJECT_SCHEMA_VERSION}`,
    ]);
    expect(parseProjectContract(draft3, "yaml").ok).toBe(false);
    const parsed = parseProjectContract(draft4, "yaml");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Atlas declares no output labels, and none is inferred.
    expect(
      parsed.value.workloads.map((entry) => entry.output_classification),
    ).toEqual([null, null, null, null, null]);
    // Normalized serialization, unlike the version-only migration, writes the
    // new field explicitly.
    expect(draft4).not.toContain("output_classification");
    expect(
      toNormalizedYaml(parsed.value).match(/output_classification: null/g),
    ).toHaveLength(5);
  });

  it("keeps an approval hash computed by draft.3 code current after migration", async () => {
    const draft3 = await readFile(
      new URL("./fixtures/approved-atlas.draft3.yaml", import.meta.url),
      "utf8",
    );
    const stored = /content_hash: ([0-9a-f]{64})/.exec(draft3)?.[1];
    expect(stored).toBe(
      "81b8559b4cd6fdddd5addfb4bd065caa574529f8802e4f1bfe85292efe481f1d",
    );
    expect(draft3).toContain("schema_version: 0.1.0-draft.3");
    expect(parseProjectContract(draft3, "yaml").ok).toBe(false);

    const migrated = parseProjectContract(
      asVersion(draft3, PROJECT_SCHEMA_VERSION),
      "yaml",
    );
    expect(migrated.ok ? [] : migrated.issues).toEqual([]);
    if (!migrated.ok) return;
    const hash = computeApprovalHash(migrated.value, "decision.classification");
    expect(hash.ok && hash.value).toBe(stored);
    expect(approvalState(migrated.value, "decision.classification").state).toBe(
      "current",
    );

    // Re-serializing adds output_classification: null to every workload; the
    // approval still verifies, because workloads are not approval content.
    const normalized = toNormalizedYaml(migrated.value);
    expect(normalized).toContain("output_classification: null");
    const reparsed = parseProjectContract(normalized, "yaml");
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(approvalState(reparsed.value, "decision.classification").state).toBe(
      "current",
    );
  });
});
