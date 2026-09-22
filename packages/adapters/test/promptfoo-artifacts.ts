/**
 * Artifacts shaped like genuine promptfoo 0.122.0 output.
 *
 * Every row carries what real output carries and the adapter binds to the plan:
 * integer `promptIdx`/`testIdx`, `prompt.label` as the template, `vars`, a
 * `testCase` whose `assert` is the default assertions followed by the row's own,
 * a provider object, and an outcome. Tests that want to exercise one check
 * mutate one field of an otherwise faithful artifact, so a refusal cannot come
 * from some other, incidental defect.
 */
export interface SpecRow {
  readonly description?: string;
  readonly vars: Record<string, string | number | boolean>;
  readonly assert: readonly Record<string, unknown>[];
}
export interface Spec {
  readonly prompts: readonly string[];
  readonly dataset: { readonly rows: readonly SpecRow[] };
  readonly provider: { readonly id: string };
  readonly default_assertions: readonly Record<string, unknown>[];
}

export type Outcome = readonly [success: boolean, failureReason: 0 | 1 | 2];

/**
 * An artifact with the row shape genuine promptfoo 0.122.0 output has: integer
 * promptIdx/testIdx, `prompt.label` as the template, `vars`, and a `testCase`
 * whose `assert` is the default assertions followed by the row's own.
 */
export function artifactFor(
  specValue: unknown,
  options: {
    readonly outcome?: (p: number, t: number) => Outcome;
    readonly version?: string | null;
  } = {},
) {
  const spec = specValue as Spec;
  const rows: Record<string, unknown>[] = [];
  const stats = { successes: 0, failures: 0, errors: 0 };
  spec.prompts.forEach((template, p) => {
    spec.dataset.rows.forEach((row, t) => {
      const [success, failureReason] = options.outcome?.(p, t) ?? [true, 0];
      if (success) stats.successes += 1;
      else if (failureReason === 2) stats.errors += 1;
      else stats.failures += 1;
      rows.push({
        promptIdx: p,
        testIdx: t,
        prompt: {
          raw: template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            String(row.vars[name] ?? ""),
          ),
          label: template,
        },
        vars: { ...row.vars },
        testCase: {
          vars: { ...row.vars },
          // Cloned: a test mutating the artifact must not also mutate the spec.
          assert: structuredClone([...spec.default_assertions, ...row.assert]),
          ...(row.description === undefined
            ? {}
            : { description: row.description }),
          options: {},
          metadata: {},
        },
        provider: { id: spec.provider.id, label: "" },
        success,
        failureReason,
      });
    });
  });
  return {
    evalId: "eval-accept",
    results: {
      version: 3,
      timestamp: "2026-08-20T10:30:00.000Z",
      prompts: spec.prompts.map((template) => ({
        raw: template,
        label: template,
        provider: spec.provider.id,
      })),
      results: rows,
      stats,
    },
    ...(options.version === null
      ? {}
      : { metadata: { promptfooVersion: options.version ?? "0.122.0" } }),
  };
}
