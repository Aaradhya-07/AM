import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PlaygroundDataError } from "../app/playground/types";
import {
  buildPlaygroundModel,
  humanizeToken,
} from "../app/playground/view-models";

const bundlePath = join(
  process.cwd(),
  "..",
  "..",
  "docs",
  "handoffs",
  "emergent-playground",
  "samples",
  "atlas.json",
);
const raw = JSON.parse(readFileSync(bundlePath, "utf8"));
const model = buildPlaygroundModel(raw);

function scenario(id: string) {
  const found = model.scenarios.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing scenario ${id}`);
  return found;
}

describe("playground data adapter", () => {
  it("narrows the three recorded scenarios with matching summaries", () => {
    expect(model.scenarios.map((entry) => entry.id)).toEqual([
      "violation",
      "corrected",
      "ambiguous",
    ]);

    const violation = scenario("violation");
    expect(violation.summary).toMatchObject({ fail: 2, pass: 0, unknown: 0 });
    expect(violation.overallStanding).toBe("fail");
    expect(violation.findings.every((f) => f.verdict === "fail")).toBe(true);

    const corrected = scenario("corrected");
    expect(corrected.summary).toMatchObject({ pass: 2, fail: 0, unknown: 0 });
    expect(corrected.overallStanding).toBe("pass");
    expect(corrected.summary.compliant).toBe(true);

    const ambiguous = scenario("ambiguous");
    expect(ambiguous.summary).toMatchObject({ unknown: 2, pass: 0, fail: 0 });
    expect(ambiguous.overallStanding).toBe("unknown");
  });

  it("keeps the synthetic approved contract hash stable across scenarios", () => {
    const hashes = new Set(model.scenarios.map((entry) => entry.contractHash));
    expect(hashes.size).toBe(1);
    expect(model.integrity.contractHashConsistent).toBe(true);
    expect(model.integrity.contractHash).toBe([...hashes][0]);
  });

  it("shows the draft as unchecked with no report", () => {
    expect(model.draft.hasReport).toBe(false);
    expect(model.draft.name.length).toBeGreaterThan(0);
  });

  it("records analysis errors separately from verdicts", () => {
    for (const entry of model.scenarios) {
      expect(entry.analysisErrorCount).toBe(0);
      expect(entry.summary.total).toBe(entry.findings.length);
    }
  });

  it("links every finding location to committed sample source", () => {
    for (const entry of model.scenarios) {
      for (const finding of entry.findings) {
        if (finding.location) {
          expect(entry.sourceFiles[finding.location.path]).toBeTypeOf("string");
        }
      }
    }
  });

  it("rejects an unsupported or non-synthetic bundle", () => {
    expect(() => buildPlaygroundModel({ format: "other" })).toThrow(
      PlaygroundDataError,
    );
    expect(() =>
      buildPlaygroundModel({
        format: "anvilmark-playground-samples/1",
        synthetic: false,
      }),
    ).toThrow(/synthetic/);
  });

  it("humanizes reference tokens", () => {
    expect(humanizeToken("approved_candidate_only")).toBe(
      "Approved candidate only",
    );
  });
});
