import { describe, expect, it } from "vitest";
import {
  checkAtlasPermutation,
  type AtlasCheckResult,
  type AtlasDataChoice,
  type AtlasModelChoice,
} from "../lib/atlas-checker";

function engineVerdict(result: AtlasCheckResult, ruleKind: string) {
  return result.report.results.find((r) => r.rule_kind === ruleKind)?.verdict;
}

const PERMUTATIONS: ReadonlyArray<
  readonly [AtlasModelChoice, AtlasDataChoice, string, string]
> = [
  ["selected", "redacted", "pass", "pass"],
  ["selected", "raw", "pass", "fail"],
  ["different", "redacted", "fail", "pass"],
  ["different", "raw", "fail", "fail"],
  ["dynamic", "redacted", "unknown", "pass"],
  ["dynamic", "raw", "unknown", "fail"],
];

describe("Real-engine Atlas checker", () => {
  it.each(PERMUTATIONS)(
    "%s model + %s text -> model %s, data flow %s",
    async (model, dataHandling, expectedModel, expectedPrivacy) => {
      const result = await checkAtlasPermutation({ model, dataHandling });

      // The verdicts must be the engine's own results, never a substitute.
      expect(result.report.analysis_errors).toEqual([]);
      expect(result.report.results).toHaveLength(2);
      expect(result.modelVerdict).toBe(
        engineVerdict(result, "approved_candidate_only"),
      );
      expect(result.privacyVerdict).toBe(
        engineVerdict(result, "forbid_dataflow"),
      );

      expect(result.modelVerdict).toBe(expectedModel);
      expect(result.privacyVerdict).toBe(expectedPrivacy);
      expect(result.modelPassed).toBe(expectedModel === "pass");
      expect(result.privacyPassed).toBe(expectedPrivacy === "pass");
      expect(result.evidenceGap.status).toBe("missing");
      // Code changes never close the recorded quality evidence gap.
      expect(result.evidenceGaps.map((gap) => gap.subject)).toContain(
        "workload.classification.metric.macro_f1",
      );
      expect(result.traces.includes("sanitizer")).toBe(
        dataHandling === "redacted",
      );
    },
  );
});
