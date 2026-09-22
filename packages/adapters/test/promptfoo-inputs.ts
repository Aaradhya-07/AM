import { PROMPTFOO_SPEC_VERSION, planEvaluation } from "../src/index.js";
import type { EvaluationPlan, ProviderRegistration } from "../src/index.js";

/**
 * The providers the default tests are allowed to run.
 *
 * Registration is explicit and local-only: `echo` is promptfoo's built-in
 * local provider, and the fake tool stands in for a run against it. Nothing
 * remote is registered, so no test can reach the network by accident, and the
 * default policy allows no credential names at all.
 */
export const TEST_PROVIDERS: readonly ProviderRegistration[] = [
  { id: "echo", reach: "local", destination: "local", credentialEnvNames: [] },
];

/** The local `echo` registration, allowing exactly the given credential names. */
export function echoAllowing(
  names: readonly string[],
): readonly ProviderRegistration[] {
  return [
    {
      id: "echo",
      reach: "local",
      destination: "local",
      credentialEnvNames: [...names],
    },
  ];
}

/** A registered REMOTE provider, for the authorization boundary tests. */
export const REMOTE_PROVIDER: ProviderRegistration = {
  id: "example:model-a",
  reach: "remote",
  destination: "api.example.com",
  credentialEnvNames: ["EXAMPLE_API_KEY"],
};

/**
 * A valid evaluation spec, and the plan ANVILMARK derives from it.
 *
 * Tests derive identities through the adapter's own function rather than
 * hard-coding digests: a hard-coded digest proves only that a constant matches
 * a constant.
 */
export function evaluationSpec(
  overrides: {
    readonly provider?: string;
    readonly prompt?: string;
    readonly ticket?: string;
    readonly assertValue?: string;
    readonly datasetVersion?: string;
    readonly workloadRef?: string;
    readonly candidateRef?: string;
    readonly datasetId?: string;
    readonly credentialEnvNames?: readonly string[];
    readonly providerConfig?: Record<string, unknown>;
    /** A second row whose assertion fails, for the two-case fixture. */
    readonly secondRow?: boolean;
  } = {},
): Record<string, unknown> {
  return {
    spec_version: PROMPTFOO_SPEC_VERSION,
    workload_ref: overrides.workloadRef ?? "classification",
    candidate_ref: overrides.candidateRef ?? "candidate.local",
    dataset: {
      id: overrides.datasetId ?? "dataset.classification",
      version: overrides.datasetVersion ?? "v1",
      rows: [
        {
          vars: { ticket: overrides.ticket ?? "billing question" },
          assert: [
            { type: "contains", value: overrides.assertValue ?? "billing" },
          ],
        },
        ...(overrides.secondRow === true
          ? [
              {
                vars: { ticket: "shipping question" },
                assert: [{ type: "contains", value: "refund" }],
              },
            ]
          : []),
      ],
    },
    prompts: [overrides.prompt ?? "Classify the ticket: {{ticket}}"],
    provider: {
      id: overrides.provider ?? "echo",
      config: overrides.providerConfig ?? {},
      credential_env_names: [...(overrides.credentialEnvNames ?? [])],
    },
    default_assertions: [],
  };
}

/** The plan for a spec, or a thrown error naming why it was refused. */
export function planFor(
  overrides: Parameters<typeof evaluationSpec>[0] = {},
): EvaluationPlan {
  const planned = planEvaluation(evaluationSpec(overrides));
  if (!("plan" in planned)) {
    throw new Error(`fixture spec was refused: ${planned.reasons.join("; ")}`);
  }
  return planned.plan;
}

export function specIdentity(
  overrides: Parameters<typeof evaluationSpec>[0] = {},
) {
  return planFor(overrides).identities;
}
