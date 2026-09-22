import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  assembleWebReviewBundle,
  readWebReviewBundle,
  reportConformanceHash,
  type ConformanceReport,
} from "@anvilmark/conformance";
import { stableStringify } from "@anvilmark/project-contract";
import { sha256 } from "@anvilmark/scanner";

import { StudioClient, type StudioTab } from "../app/studio/StudioClient";
import { SnapshotComparison } from "../app/studio/snapshot-diff";
import StartPage from "../app/start/page";
import {
  canonicalJson,
  verifyBundleInBrowser,
  type WebReviewEnvelope,
} from "../lib/review-bundle";

// Written by scripts/export-review-bundle-fixtures.mjs for the Atlas fixtures
// handoff-approved-sanitized (pass) and handoff-disallowed-raw (fail).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fixture(name: "pass" | "fail"): any {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), "test", "fixtures", `review-bundle-${name}.json`),
      "utf8",
    ),
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reseal(bundle: any) {
  const { integrity_hash, ...content } = bundle;
  void integrity_hash;
  return { ...content, integrity_hash: sha256(stableStringify(content)) };
}

async function verified(raw: unknown): Promise<WebReviewEnvelope> {
  const result = await verifyBundleInBrowser(raw);
  if (result.status !== "valid") throw new Error(result.errors.join("\n"));
  return result.bundle;
}

describe("browser bundle verification", () => {
  it.each(["pass", "fail"] as const)(
    "accepts the real %s bundle and agrees with the CLI reader",
    async (name) => {
      const raw = fixture(name);
      expect(canonicalJson(raw)).toBe(stableStringify(raw));
      expect(readWebReviewBundle(raw).status).toBe("valid");

      const result = await verifyBundleInBrowser(raw);
      expect(result).toMatchObject({ status: "valid", warnings: [] });
    },
  );

  it("keeps engine fields the Studio does not render yet", async () => {
    const bundle = await verified(fixture("fail"));
    const failing = bundle.report.artifact?.results.find(
      (result) => result.verdict === "fail",
    );
    expect(failing).toMatchObject({
      standing: "deterministic",
      evidence_tier: "T3",
      constraint_ref: "privacy.raw_ticket_remote",
    });
    expect(failing?.caveats).toBeInstanceOf(Array);
    expect(bundle.facts).toHaveProperty("evidence_gaps");
  });

  it("rejects a verdict edited after export", async () => {
    const raw = fixture("fail");
    raw.report.artifact.results[1].verdict = "pass";
    raw.report.artifact.summary = {
      ...raw.report.artifact.summary,
      pass: 2,
      fail: 0,
      compliant: true,
    };

    const result = await verifyBundleInBrowser(raw);
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.errors.join("\n")).toContain(
      "Bundle integrity hash mismatch",
    );
    expect(readWebReviewBundle(raw).status).toBe("invalid");
  });

  it("rejects an edited report even when the bundle hash is recomputed", async () => {
    const raw = fixture("fail");
    raw.report.artifact.results[1].verdict = "pass";

    const result = await verifyBundleInBrowser(reseal(raw));
    expect(result.status).toBe("invalid");
    expect(result.status === "invalid" && result.errors.join("\n")).toContain(
      "Report conformance hash mismatch",
    );
  });

  it("requires a report for another contract to be marked stale", async () => {
    const raw = fixture("fail");
    const report = raw.report.artifact;
    report.contract.contract_hash = `sha256:${"a".repeat(64)}`;
    report.conformance_hash = reportConformanceHash(
      report as ConformanceReport,
    );
    raw.report.conformance_hash = report.conformance_hash;
    // Keep the included scan consistent with the edited report.
    raw.scan = {
      ...raw.scan,
      status: "missing",
      freshness: null,
      content_hash: null,
      observed_at: null,
      artifact: null,
    };

    const unmarked = await verifyBundleInBrowser(reseal(raw));
    expect(unmarked.status).toBe("invalid");
    expect(
      unmarked.status === "invalid" && unmarked.errors.join("\n"),
    ).toContain("not marked stale");
    expect(readWebReviewBundle(reseal(raw)).status).toBe("invalid");

    raw.report.freshness = "stale";
    raw.report.problems = ["contract changed"];
    const marked = await verifyBundleInBrowser(reseal(raw));
    expect(marked.status).toBe("valid");
    expect(marked.status === "valid" && marked.warnings.join("\n")).toContain(
      "exported as stale",
    );
    expect(readWebReviewBundle(reseal(raw)).status).toBe("valid");
  });

  it("verifies a shareable bundle and says what it cannot recheck", async () => {
    const reading = readWebReviewBundle(fixture("fail"));
    if (reading.status !== "valid") throw new Error("fixture is invalid");
    const local = reading.bundle;
    const shareable = assembleWebReviewBundle({
      contract: local.contract.canonical,
      scan: { artifact: local.scan.artifact, freshness: "current" },
      report: { artifact: local.report.artifact, freshness: "current" },
      projection: "shareable",
      sources: local.sources,
      sourcesOmitted: [{ path: "src/other.ts", reason: "possible_secret" }],
      exportedAt: local.exported_at,
    });

    const result = await verifyBundleInBrowser(
      JSON.parse(JSON.stringify(shareable)),
    );
    expect(result.status).toBe("valid");
    const warnings =
      result.status === "valid" ? result.warnings.join("\n") : "";
    expect(warnings).toContain("shareable bundle");
    expect(warnings).toContain("1 source file(s) were left out");
  });

  it("rejects input that is not a review bundle", async () => {
    expect((await verifyBundleInBrowser({ invalid: true })).status).toBe(
      "invalid",
    );
  });
});

describe("Studio and Start surfaces", () => {
  it("renders StudioClient empty dropzone state", () => {
    const html = renderToStaticMarkup(createElement(StudioClient));
    expect(html).toContain("Review Workspace");
    expect(html).toContain("100% Browser-Local · Zero Server Uploads");
    expect(html).toContain("Open your project review bundle");
    expect(html).toContain(".anvilmark/review-bundle.json");
    expect(html).not.toContain("npx");
  });

  it.each([
    "review",
    "decision",
    "checks",
    "changes",
    "handoff",
  ] satisfies StudioTab[])(
    "renders the %s tab for a real bundle",
    async (tab) => {
      const bundle = await verified(fixture("fail"));
      const html = renderToStaticMarkup(
        createElement(StudioClient, { initialBundle: bundle, initialTab: tab }),
      );
      expect(html).toContain("Atlas Support Desk");
      expect(html).not.toContain("npx");
    },
  );

  it("shows each decision's recorded status and rationale", async () => {
    const bundle = await verified(fixture("fail"));
    const html = renderToStaticMarkup(
      createElement(StudioClient, {
        initialBundle: bundle,
        initialTab: "decision",
      }),
    );
    const decision = bundle.contract.canonical.decisions[0];
    expect(html).toContain(decision?.status);
    expect(html).toContain(decision?.rationale.summary);
  });

  it.each([
    [{ fail: 1, unknown: 0, compliant: false }, "1 failing"],
    [{ fail: 0, unknown: 2, compliant: false }, "2 unresolved"],
    [{ fail: 0, unknown: 0, compliant: true }, "All rules pass"],
  ])("labels a report summary %o as %s", async (counts, label) => {
    const bundle = await verified(fixture("fail"));
    const report = bundle.report.artifact;
    if (!report) throw new Error("fixture has no report");
    const html = renderToStaticMarkup(
      createElement(StudioClient, {
        initialBundle: {
          ...bundle,
          report: {
            ...bundle.report,
            artifact: { ...report, summary: { ...report.summary, ...counts } },
          },
        },
      }),
    );
    expect(html).toContain(label);
    expect(html).not.toContain("Violations");
  });

  it("separates code checks from evidence the code cannot establish", async () => {
    const bundle = await verified(fixture("fail"));
    const html = renderToStaticMarkup(
      createElement(StudioClient, { initialBundle: bundle }),
    );
    for (const heading of [
      "Decision",
      "Evidence",
      "Implementation",
      "Snapshot",
    ]) {
      expect(html).toContain(`>${heading}</span>`);
    }
    const [checked, notEstablished] = html
      .split("Checked in code")[1]!
      .split("Not established by code");
    expect(checked).toContain("rule.raw_ticket_never_remote");
    expect(checked).not.toContain("metric.macro_f1");
    expect(notEstablished).toContain("workload.classification.metric.macro_f1");
    expect(notEstablished).toContain(
      "It checks the implementation, not this evidence.",
    );
  });

  it("marks finding lines in the included source", async () => {
    const bundle = await verified(fixture("fail"));
    const html = renderToStaticMarkup(
      createElement(StudioClient, {
        initialBundle: bundle,
        initialTab: "checks",
      }),
    );
    expect(html).toContain("What this check covers");
    expect(html).toContain('data-marked="true"');
    expect(html).toContain("src/classify.ts");
  });

  it("gives the agent the shared brief", async () => {
    const bundle = await verified(fixture("fail"));
    const html = renderToStaticMarkup(
      createElement(StudioClient, {
        initialBundle: bundle,
        initialTab: "handoff",
      }),
    );
    expect(html).toContain("DO NOT MODIFY");
    expect(html).toContain("FIX rule.raw_ticket_never_remote");
    expect(html).toContain("NOT CODE TASKS");
  });

  it("serves an example bundle that verifies as shareable", async () => {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "public", "examples", "atlas-review-bundle.json"),
        "utf8",
      ),
    );
    const result = await verifyBundleInBrowser(raw);
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.bundle.projection).toBe("shareable");
      expect(result.bundle.report.artifact?.summary.fail).toBe(2);
    }
  });

  it("compares two snapshots with line-level source changes", async () => {
    const base = await verified(fixture("fail"));
    const head = await verified(fixture("pass"));
    const html = renderToStaticMarkup(
      createElement(SnapshotComparison, { base, head }),
    );

    expect(html).toContain("resolved");
    expect(html).toContain("rule.raw_ticket_never_remote");
    expect(html).toContain(
      "Both snapshots were evaluated against the same contract",
    );
    // The fix added the redactor call, so the diff shows changed lines.
    expect(html).toContain("src/classify.ts");
    expect(html).toContain('data-kind="added"');
    expect(html).toContain('data-kind="removed"');
    expect(html).toContain("redactTicket");
  });

  it("does not present a removed rule as a fix", async () => {
    const base = await verified(fixture("fail"));
    const canonical = base.contract.canonical;
    const head = {
      ...base,
      contract: {
        ...base.contract,
        content_hash: `sha256:${"e".repeat(64)}`,
        canonical: {
          ...canonical,
          conformance_rules: canonical.conformance_rules.filter(
            (rule) => rule.id !== "rule.raw_ticket_never_remote",
          ),
        },
      },
      project: {
        ...base.project,
        contract_hash: `sha256:${"e".repeat(64)}`,
      },
      report: {
        ...base.report,
        artifact: base.report.artifact
          ? {
              ...base.report.artifact,
              results: base.report.artifact.results.filter(
                (result) => result.rule_ref !== "rule.raw_ticket_never_remote",
              ),
            }
          : null,
      },
    };

    const html = renderToStaticMarkup(
      createElement(SnapshotComparison, { base, head: head as typeof base }),
    );
    expect(html).toContain("Rules removed: rule.raw_ticket_never_remote");
    expect(html).toContain("is not a fix");
    expect(html).toContain("removed");
  });

  it("renders StartPage setup guide", () => {
    const html = renderToStaticMarkup(createElement(StartPage));
    expect(html).toContain("Get Started with ANVILMARK");
    expect(html).toContain("Existing TypeScript / JavaScript Project");
    expect(html).toContain("New Project Built with Coding Agents");
    expect(html).toContain("node scripts/setup.mjs");
    expect(html).toContain("anvilmark check");
    expect(html).toContain("anvilmark export");
    expect(html).not.toContain("npx anvilmark");
    expect(html).not.toContain("@anvilmark/cli");
  });
});
