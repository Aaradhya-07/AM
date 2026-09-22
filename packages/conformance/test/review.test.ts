import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildProjectFacts, contractHash } from "@anvilmark/context";
import type { ProjectContract } from "@anvilmark/project-contract";
import { evaluateConformance } from "../src/engine.js";
import { buildAgentBrief, collectEvidenceGaps } from "../src/review/index.js";
import {
  REPO_ROOT,
  approvedRemote,
  cleanup,
  materialize,
  scan,
} from "./helpers.js";

afterEach(cleanup);

async function reviewInput(fixture: string) {
  const contract = await approvedRemote();
  const report = evaluateConformance({
    contract,
    scan: scan(await materialize(fixture), contract),
    evaluatedAt: "2026-09-15T12:00:00Z",
  });
  return {
    contract,
    report,
    input: {
      project: {
        id: contract.project.id,
        name: contract.project.name,
        contract_revision: contract.project.contract_revision,
        contract_hash: contractHash(contract),
      },
      results: report.results,
      evidenceGaps: collectEvidenceGaps(facts(contract)),
    },
  };
}

function facts(contract: ProjectContract) {
  return buildProjectFacts(contract, {
    asOf: "2026-09-15T12:00:00Z",
    projection: "remote-default",
    stateRevision: null,
  });
}

describe("collectEvidenceGaps", () => {
  it("keeps project, workload and selected-candidate gaps only", async () => {
    const contract = await approvedRemote();
    const gaps = collectEvidenceGaps(facts(contract));

    expect(gaps).toContainEqual(
      expect.objectContaining({
        scope: "workload",
        workload_ref: "classification",
        subject: "workload.classification.metric.macro_f1",
        required_floor: "T3",
        admissible_kinds: ["measured_evaluation"],
      }),
    );
    expect(gaps.some((gap) => gap.scope === "project")).toBe(true);
    const candidates = new Set(
      gaps
        .filter((gap) => gap.scope === "selected_candidate")
        .map((gap) => gap.candidate_ref),
    );
    expect([...candidates]).toEqual([
      "candidate.classification.remote_unselected",
    ]);
  });

  it("returns nothing for facts without evidence gaps", () => {
    expect(collectEvidenceGaps(null)).toEqual([]);
    expect(collectEvidenceGaps({ evidence_gaps: "nope" })).toEqual([]);
  });
});

describe("buildAgentBrief", () => {
  it("names the failing rule, its trace and the policy the agent must not touch", async () => {
    const { input } = await reviewInput("handoff-disallowed-raw");
    const brief = buildAgentBrief(input);

    expect(brief).toContain("FIX rule.raw_ticket_never_remote  [fail");
    expect(brief).toContain("constraint privacy.raw_ticket_remote");
    expect(brief).toMatch(/trace: source src\/classify\.ts:\d+/);
    expect(brief).toContain("DO NOT MODIFY: .anvilmark/**");
    expect(brief).toContain("DONE WHEN: `anvilmark check`");
    expect(brief).not.toContain("FIX rule.classification_approved_candidate");
  });

  it("keeps evidence gaps out of the agent's hands", async () => {
    const { input } = await reviewInput("handoff-disallowed-raw");
    const brief = buildAgentBrief(input);

    expect(brief).toContain("NOT CODE TASKS");
    expect(brief).toContain("must not create metrics, evaluation results");
    expect(brief.split("workload.classification.metric.macro_f1")).toHaveLength(
      2,
    );
    // The failing data-flow check already reports on this constraint.
    expect(brief).not.toContain("data.raw_customer_ticket (project)");
    expect(brief.toLowerCase()).not.toMatch(/collect .*evidence/);
  });

  it("asks for unresolved paths to be made statically resolvable", async () => {
    const { input, report } = await reviewInput("handoff-ambiguous-runtime");
    expect(report.results.some((result) => result.verdict === "unknown")).toBe(
      true,
    );
    const brief = buildAgentBrief(input);
    expect(brief).toContain("RESOLVE ");
    expect(brief).toContain("expected: ");
  });

  it("tells the agent not to change code when every check passes", async () => {
    const { input } = await reviewInput("handoff-approved-sanitized");
    const brief = buildAgentBrief(input);
    expect(brief).toContain("No code check is failing or unresolved");
    expect(brief).not.toContain("FIX ");
    expect(brief).not.toContain("DONE WHEN");
  });

  it("flags stale results and uses the given recheck command", async () => {
    const { input } = await reviewInput("handoff-disallowed-raw");
    const brief = buildAgentBrief({
      ...input,
      reportFreshness: "stale",
      recheckCommand: "node tools/anvilmark.mjs check",
    });
    expect(brief).toContain("exported from a stale report");
    expect(brief).toContain("`node tools/anvilmark.mjs check`");
  });
});

describe("review entry point", () => {
  it("imports nothing at runtime from outside itself, so browsers can load it", async () => {
    const directory = join(REPO_ROOT, "packages/conformance/src/review");
    for (const file of await readdir(directory)) {
      const text = await readFile(join(directory, file), "utf8");
      // Statements may span lines, so match each import up to its specifier.
      for (const [statement] of text.matchAll(
        /^import [\s\S]*?from "[^"]+";/gm,
      )) {
        const runtimeOutside =
          !statement.startsWith("import type ") &&
          !/from "\.\/[^"]+";$/.test(statement);
        expect({ file, statement, runtimeOutside }).toEqual({
          file,
          statement,
          runtimeOutside: false,
        });
      }
    }
  });
});
