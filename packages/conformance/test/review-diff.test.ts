import { afterEach, describe, expect, it } from "vitest";

import { buildProjectFacts } from "@anvilmark/context";
import type { ProjectContract } from "@anvilmark/project-contract";
import { assembleWebReviewBundle } from "../src/bundle.js";
import type { WebReviewEnvelope } from "../src/bundle.js";
import { evaluateConformance } from "../src/engine.js";
import {
  collectEvidenceGaps,
  diffReviewBundles,
  openEvidenceGaps,
  renderReviewMarkdown,
} from "../src/review/index.js";
import { approvedRemote, cleanup, materialize, scan } from "./helpers.js";

afterEach(cleanup);

async function snapshot(
  fixture: string,
  contractOverride?: (contract: ProjectContract) => ProjectContract,
): Promise<WebReviewEnvelope> {
  const approved = await approvedRemote();
  const contract = contractOverride ? contractOverride(approved) : approved;
  const scanArtifact = scan(await materialize(fixture), contract);
  const report = evaluateConformance({
    contract,
    scan: scanArtifact,
    evaluatedAt: "2026-09-15T12:00:00Z",
  });
  return assembleWebReviewBundle({
    contract,
    scan: { artifact: scanArtifact, freshness: "current" },
    report: { artifact: report, freshness: "current" },
    exportedAt: "2026-09-15T12:00:00Z",
  });
}

function change(diff: ReturnType<typeof diffReviewBundles>, rule: string) {
  return diff.findings.find((finding) => finding.rule_ref === rule)?.change;
}

describe("diffReviewBundles", () => {
  it("reports a fixed data flow as resolved with no policy change", async () => {
    const base = await snapshot("handoff-disallowed-raw");
    const head = await snapshot("handoff-approved-sanitized");
    const diff = diffReviewBundles(base, head);

    expect(change(diff, "rule.raw_ticket_never_remote")).toBe("resolved");
    expect(change(diff, "rule.classification_approved_candidate")).toBe(
      "unchanged",
    );
    expect(diff.counts.resolved).toBe(1);
    expect(diff.policy_changed).toBe(false);
    expect(diff.findings.every((finding) => !finding.policy_affected)).toBe(
      true,
    );
  });

  it("reports the reverse as a regression", async () => {
    const diff = diffReviewBundles(
      await snapshot("handoff-approved-sanitized"),
      await snapshot("handoff-disallowed-raw"),
    );
    expect(change(diff, "rule.raw_ticket_never_remote")).toBe("regressed");
  });

  it("matches a finding whose lines moved", async () => {
    const base = await snapshot("handoff-disallowed-raw");
    const report = base.report.artifact!;
    const moved = {
      ...base,
      report: {
        ...base.report,
        artifact: {
          ...report,
          results: report.results.map((result) => ({
            ...result,
            locations: result.locations.map((location) => ({
              ...location,
              start: { ...location.start, line: location.start.line + 20 },
            })),
          })),
        },
      },
    };
    const diff = diffReviewBundles(base, moved);
    expect(diff.findings.map((finding) => finding.change)).toEqual([
      "unchanged",
      "unchanged",
    ]);
  });

  it("does not count a removed rule as a fix", async () => {
    const base = await snapshot("handoff-disallowed-raw");
    const head = await snapshot("handoff-disallowed-raw", (contract) => ({
      ...contract,
      conformance_rules: contract.conformance_rules.filter(
        (rule) => rule.id !== "rule.raw_ticket_never_remote",
      ),
    }));
    const diff = diffReviewBundles(base, head);

    expect(diff.policy.rules_removed).toEqual(["rule.raw_ticket_never_remote"]);
    expect(diff.policy.contract_changed).toBe(true);
    expect(diff.policy_changed).toBe(true);
    const removed = diff.findings.find(
      (finding) => finding.rule_ref === "rule.raw_ticket_never_remote",
    );
    expect(removed).toMatchObject({ change: "removed", policy_affected: true });
    expect(diff.counts.resolved).toBe(0);
  });

  it("detects a changed scan configuration", async () => {
    const base = await snapshot("handoff-disallowed-raw");
    const artifact = base.scan.artifact!;
    const head = {
      ...base,
      scan: {
        ...base.scan,
        artifact: {
          ...artifact,
          configuration: { ...artifact.configuration, exclude: ["src"] },
        },
      },
    };
    const diff = diffReviewBundles(base, head);
    expect(diff.policy.scan_scope.configuration_changed).toBe(true);
    expect(diff.policy_changed).toBe(true);
  });
});

describe("renderReviewMarkdown", () => {
  it("keeps code checks, policy changes and evidence apart", async () => {
    const base = await snapshot("handoff-disallowed-raw");
    const head = await snapshot("handoff-approved-sanitized");
    const diff = diffReviewBundles(base, head);
    const gaps = collectEvidenceGaps(
      buildProjectFacts(head.contract.canonical, {
        asOf: "2026-09-15T12:00:00Z",
        projection: "remote-default",
        stateRevision: null,
      }),
    );
    const markdown = renderReviewMarkdown({
      diff,
      policy: diff.policy,
      evidenceGaps: openEvidenceGaps(head.report.artifact!.results, gaps),
      brief: "FIX nothing",
    });

    expect(markdown).toContain("1 resolved · 0 new or regressed");
    expect(markdown).toContain(
      "| resolved | `rule.raw_ticket_never_remote` | fail | pass | src/classify.ts:",
    );
    expect(markdown).toContain(
      "**Policy changes in this pull request.**\n\nNone.",
    );
    expect(markdown).toContain("workload.classification.metric.macro_f1");
    expect(markdown).toContain("<summary>Agent brief for the open findings");
  });

  it("marks findings whose policy the pull request changes", async () => {
    const base = await snapshot("handoff-disallowed-raw");
    const head = await snapshot("handoff-disallowed-raw", (contract) => ({
      ...contract,
      conformance_rules: contract.conformance_rules.filter(
        (rule) => rule.id !== "rule.raw_ticket_never_remote",
      ),
    }));
    const diff = diffReviewBundles(base, head);
    const markdown = renderReviewMarkdown({
      diff,
      policy: diff.policy,
      notices: ["The head check could not run."],
    });

    expect(markdown).toContain("> [!WARNING]\n> The head check could not run.");
    expect(markdown).toContain("| removed † | `rule.raw_ticket_never_remote`");
    expect(markdown).toContain(
      "- Rules removed: `rule.raw_ticket_never_remote`",
    );
    expect(markdown).toContain("does not count as a fix");
  });
});
