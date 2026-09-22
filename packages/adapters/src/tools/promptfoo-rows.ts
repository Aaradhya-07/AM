import { stableStringify } from "@anvilmark/project-contract";

import type { EvaluationPlan } from "./promptfoo-spec.js";

/**
 * Bind every result row to the evaluation that was requested.
 *
 * Counting cases and tallying outcomes proves an artifact is internally
 * consistent. It does not prove the artifact describes THIS evaluation: an
 * artifact from another evaluation of the same size, or one whose rows name a
 * different prompt, different variables or different assertions, has the right
 * totals. So each row must identify exactly one planned prompt-by-row pair and
 * restate that pair's inputs.
 *
 * The fields used, and why they are trustworthy, from promptfoo 0.122.0 at
 * commit 0170037970dd4732f7542c60ceafa5f4951289de and its real output:
 *
 * - `promptIdx` and `testIdx` are integers indexing the prompt list and the
 *   test list; genuine output carries both on every row.
 * - `results.prompts[i]` for a string prompt has `raw` and `label` equal to the
 *   prompt text, because the string processor sets `label: prompt.label ??
 *   raw` (`src/prompts/processors/string.ts:19`). A row's `prompt.label` is that
 *   same template; its `prompt.raw` is the RENDERED prompt, which this adapter
 *   does not re-render and so does not compare.
 * - `testCase.assert` is the default assertions followed by the row's own, as
 *   built by `prepareTestCaseForEval` (`src/evaluator.ts:2526-2529`).
 * - `vars`, `testCase.vars` and `testCase.description` restate the row.
 *
 * Anything missing that these facts depend on is refused rather than assumed.
 */
export interface RowBindingProblem {
  readonly code:
    "malformed_output" | "identity_mismatch" | "ambiguous_attribution";
  readonly message: string;
  readonly detail: Record<string, unknown>;
}

function providerIdOf(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (value !== null && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameData(left: unknown, right: unknown): boolean {
  try {
    return stableStringify(left) === stableStringify(right);
  } catch {
    return false;
  }
}

function isIndex(value: unknown, size: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < size
  );
}

export function bindResultRows(
  plan: EvaluationPlan,
  results: { readonly prompts?: unknown; readonly results?: unknown },
): RowBindingProblem | null {
  const planned = plan.spec;
  const promptCount = planned.prompts.length;
  const rowCount = planned.dataset.rows.length;

  // --- the prompt list --------------------------------------------------------
  const prompts = results.prompts;
  if (!Array.isArray(prompts) || prompts.length !== promptCount) {
    return {
      code: "malformed_output",
      message: `the artifact's prompt list does not have exactly ${promptCount} entr${promptCount === 1 ? "y" : "ies"}, so its rows cannot be matched to the planned prompts`,
      detail: {
        expected_prompts: promptCount,
        reported_prompts: Array.isArray(prompts) ? prompts.length : null,
      },
    };
  }
  for (const [index, entry] of prompts.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.raw !== "string" ||
      typeof entry.label !== "string"
    ) {
      return {
        code: "malformed_output",
        message: `prompt ${index} in the artifact has no text and label to compare`,
        detail: { prompt_index: index },
      };
    }
    if (
      entry.raw !== planned.prompts[index] ||
      entry.label !== planned.prompts[index]
    ) {
      return {
        code: "identity_mismatch",
        message: `prompt ${index} in the artifact is not the prompt this evaluation planned`,
        detail: { prompt_index: index },
      };
    }
  }

  // --- every row --------------------------------------------------------------
  const rows = results.results;
  if (!Array.isArray(rows)) {
    return {
      code: "malformed_output",
      message: "the artifact carries no per-case results to bind to the plan",
      detail: {},
    };
  }

  const seen = new Set<string>();
  const duplicates: [number, number][] = [];

  for (const [position, row] of rows.entries()) {
    if (!isRecord(row)) {
      return {
        code: "malformed_output",
        message: `per-case result ${position} is not an object`,
        detail: { row_position: position },
      };
    }

    const { promptIdx, testIdx } = row;
    if (!isIndex(promptIdx, promptCount) || !isIndex(testIdx, rowCount)) {
      return {
        code: "malformed_output",
        message: `per-case result ${position} does not carry integer prompt and test indexes within this evaluation (${promptCount} prompt(s), ${rowCount} row(s))`,
        detail: {
          row_position: position,
          prompt_index: promptIdx ?? null,
          test_index: testIdx ?? null,
        },
      };
    }

    const provider = providerIdOf(row.provider);
    if (provider === null) {
      return {
        code: "malformed_output",
        message: `per-case result ${position} names no provider, so it cannot be attributed`,
        detail: { row_position: position },
      };
    }
    if (provider !== plan.providerId) {
      return {
        code: "ambiguous_attribution",
        message: `per-case result ${position} names provider "${provider}" while the run is attributed to "${plan.providerId}"`,
        detail: { observed: provider, declared: plan.providerId },
      };
    }

    const key = `${promptIdx}:${testIdx}`;
    if (seen.has(key)) {
      duplicates.push([promptIdx, testIdx]);
      continue;
    }
    seen.add(key);

    const prompt = row.prompt;
    if (!isRecord(prompt) || typeof prompt.label !== "string") {
      return {
        code: "malformed_output",
        message: `per-case result ${position} has no prompt label to compare with the planned prompt`,
        detail: { row_position: position },
      };
    }
    const testCase = row.testCase;
    if (!isRecord(testCase) || !isRecord(row.vars)) {
      return {
        code: "malformed_output",
        message: `per-case result ${position} has no test case and variables to compare with the planned row`,
        detail: { row_position: position },
      };
    }

    const plannedRow = planned.dataset.rows[testIdx]!;
    const mismatch = (field: string): RowBindingProblem => ({
      code: "identity_mismatch",
      message: `per-case result ${position} (prompt ${promptIdx}, row ${testIdx}) reports a different ${field} from the one this evaluation planned`,
      detail: {
        row_position: position,
        prompt_index: promptIdx,
        test_index: testIdx,
        field,
      },
    });

    if (prompt.label !== planned.prompts[promptIdx]) {
      return mismatch("prompt");
    }
    if (
      !sameData(row.vars, plannedRow.vars) ||
      !sameData(testCase.vars, plannedRow.vars)
    ) {
      return mismatch("variables");
    }
    if (
      !sameData(testCase.assert ?? [], [
        ...planned.default_assertions,
        ...plannedRow.assert,
      ])
    ) {
      return mismatch("assertions");
    }
    if ((testCase.description ?? undefined) !== plannedRow.description) {
      return mismatch("description");
    }
  }

  const missing: [number, number][] = [];
  for (let p = 0; p < promptCount; p += 1) {
    for (let t = 0; t < rowCount; t += 1) {
      if (!seen.has(`${p}:${t}`)) {
        missing.push([p, t]);
      }
    }
  }
  if (duplicates.length > 0 || missing.length > 0) {
    const order = (a: [number, number], b: [number, number]) =>
      a[0] - b[0] || a[1] - b[1];
    return {
      code: "malformed_output",
      message: `the per-case results do not cover each planned prompt-by-row pair exactly once: ${duplicates.length} duplicated and ${missing.length} missing`,
      detail: {
        duplicate_pairs: duplicates.sort(order),
        missing_pairs: missing.sort(order),
      },
    };
  }

  return null;
}

/** `metadata.promptfooVersion`, when the artifact carries one. */
export function artifactPromptfooVersion(
  output: unknown,
): string | null | undefined {
  if (!isRecord(output) || !isRecord(output.metadata)) {
    return undefined;
  }
  const version = output.metadata.promptfooVersion;
  if (version === undefined) {
    return undefined;
  }
  return typeof version === "string" ? version : null;
}
