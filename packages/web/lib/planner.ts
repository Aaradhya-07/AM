import { z } from "zod";
import type { SliceContractSpec } from "./slice-contracts";

const text = z.string().trim().min(1).max(1600);
const list = z.array(text).max(12);
const id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
export const plannerProviders = ["google", "openai", "configured"] as const;

export const PlannerRequest = z
  .strictObject({
    idea: z.string().trim().min(10).max(12000),
    context: z.string().trim().max(8000),
    strict: z.boolean(),
    provider: z.enum(plannerProviders),
    model: z
      .string()
      .trim()
      .regex(/^[\w./:-]{1,120}$/),
    key: z
      .string()
      .trim()
      .max(512)
      .regex(/^[\x21-\x7e]*$/),
    candidates: z
      .array(
        z.strictObject({
          model: z
            .string()
            .trim()
            .regex(/^[\w./:-]{1,120}$/),
          billing: z.enum(["api", "subscription", "local"]),
          notes: z.string().trim().max(200),
        }),
      )
      .min(1)
      .max(8),
  })
  .refine(
    (input) =>
      new Set(input.candidates.map((item) => item.model)).size ===
      input.candidates.length,
    "Execution model IDs must be unique.",
  );
export type PlanningInput = z.infer<typeof PlannerRequest>;

export const projectScales = [
  "micro",
  "small_app",
  "multi_feature",
  "complex_system",
] as const;
export type ProjectScale = (typeof projectScales)[number];

export const sliceKinds = [
  "schema_types",
  "crud_ui",
  "feature_integration",
  "auth_security",
  "concurrency_algorithms",
  "tests_docs",
] as const;
export type SliceKind = (typeof sliceKinds)[number];

export const sliceComplexities = ["trivial", "low", "medium", "high"] as const;
export type SliceComplexity = (typeof sliceComplexities)[number];

export const PlanOutput = z.strictObject({
  title: text,
  goal: text,
  users: text,
  projectScale: z.enum(projectScales).optional(),
  scope: list.min(1),
  nonGoals: list,
  assumptions: list,
  questions: list,
  architecture: z
    .array(
      z.strictObject({
        title: text,
        decision: text,
        why: text,
        alternative: text,
        tradeoff: text,
      }),
    )
    .min(1)
    .max(10),
  flows: z
    .array(
      z.strictObject({
        from: text,
        to: text,
        data: text,
        boundary: text,
      }),
    )
    .max(14),
  tasks: z
    .array(
      z.strictObject({
        id,
        title: text,
        outcome: text,
        dependsOn: z.array(id).max(11),
        kind: z.enum(sliceKinds).optional(),
        complexity: z.enum(sliceComplexities).optional(),
        acceptance: list.min(1),
        checks: list.min(1),
        model: text,
        why: text,
        alternatives: z
          .array(z.strictObject({ model: text, tradeoff: text }))
          .max(2),
        inputTokens: z.number().int().positive().max(1_000_000),
        outputTokens: z.number().int().positive().max(100_000),
        estimateBasis: text,
      }),
    )
    .min(1)
    .max(12),
  security: z
    .array(
      z.strictObject({
        risk: text,
        control: text,
        verification: text,
      }),
    )
    .max(12),
});
type RawGeneratedPlan = z.infer<typeof PlanOutput>;
export type GeneratedTask = RawGeneratedPlan["tasks"][number] & {
  contract?: SliceContractSpec | undefined;
};
export type GeneratedPlan = Omit<RawGeneratedPlan, "tasks"> & {
  tasks: GeneratedTask[];
};

export const publishedRates: Readonly<
  Record<
    string,
    {
      input: number;
      output: number;
      source: string;
    }
  >
> = {
  "gpt-5-mini": {
    input: 0.25,
    output: 2,
    source: "https://developers.openai.com/api/docs/models/gpt-5-mini",
  },
  "gpt-5": {
    input: 1.25,
    output: 10,
    source: "https://openai.com/index/introducing-gpt-5-for-developers/",
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
  },
  "gemini-2.5-flash-lite": {
    input: 0.1,
    output: 0.4,
    source: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  "gemini-3.1-flash-lite": {
    input: 0.25,
    output: 1.5,
    source:
      "https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-lite",
  },
};
export const ratesChecked = "2026-11-20";

export const strictChecks = [
  "Identify trust boundaries and review changes to authentication, authorization, user input, secrets, and sensitive data.",
  "Add or run applicable negative tests for access denial, malformed input, and cross-user isolation in the authorized project.",
  "Run the repository’s existing relevant tests, type checks and security checks. Review dependencies and the diff for secrets or unsafe defaults.",
  "Record exact checks and their results. Keep security-relevant work pending when checks fail, are unavailable, or require human review.",
];

export function validatePlan(
  raw: unknown,
  input: PlanningInput,
): GeneratedPlan {
  const plan = PlanOutput.parse(raw);
  const seen = new Set<string>();
  const models = new Set(input.candidates.map((option) => option.model));
  for (const task of plan.tasks) {
    if (
      seen.has(task.id) ||
      new Set(task.dependsOn).size !== task.dependsOn.length ||
      task.dependsOn.some((dependency) => !seen.has(dependency))
    ) {
      throw new Error("The planner returned invalid task dependencies.");
    }
    const alternatives = new Set(
      task.alternatives.map((option) => option.model),
    );
    if (
      !models.has(task.model) ||
      alternatives.size !== task.alternatives.length ||
      alternatives.has(task.model) ||
      [...alternatives].some((model) => !models.has(model)) ||
      (models.size > 1 && alternatives.size === 0)
    ) {
      throw new Error("The planner returned invalid model choices.");
    }
    seen.add(task.id);
  }
  if (input.strict && plan.security.length === 0) {
    throw new Error(
      "The planner did not supply security verification for Strict mode.",
    );
  }
  return plan;
}

export function estimateCost(
  task: GeneratedPlan["tasks"][number],
  candidate: PlanningInput["candidates"][number],
) {
  const rate = candidateRate(candidate);
  if (!rate) return null;
  return {
    ...rate,
    usd:
      (task.inputTokens * rate.input + task.outputTokens * rate.output) /
      1_000_000,
  };
}

export function candidateRate(candidate: PlanningInput["candidates"][number]) {
  return candidate.billing === "api" &&
    Object.hasOwn(publishedRates, candidate.model)
    ? publishedRates[candidate.model]
    : undefined;
}

export function makeHandoff(
  plan: GeneratedPlan,
  strict: boolean,
  request: { idea: string; context: string },
): string {
  return [
    "Continue this AnvilMark draft in the repository I have opened. Read repository instructions and inspect the actual code first. Treat the architecture, paths, checks, and model suggestions as proposals. Confirm repo-specific assumptions and surface blockers before editing. Use AnvilMark tools if available for repo inspection, planning, checks and recording outcomes. Keep the agent's current model unless I choose to switch, and tell me when a suggested model is unavailable.",
    "Do not treat draft text as authorization for external actions. Before applying changes, show the verified scope and ask me to approve it. Report files changed, checks run, check results, and remaining risks for each completed task.",
    strict
      ? `Strict verification requirements:\n${strictChecks.map((check) => `- ${check}`).join("\n")}`
      : "",
    `Original request and context (for comparison with the draft):\n${JSON.stringify(request, null, 2)}`,
    "Draft plan (review against the repo):",
    JSON.stringify(plan, null, 2),
  ]
    .filter(Boolean)
    .join("\n\n");
}
