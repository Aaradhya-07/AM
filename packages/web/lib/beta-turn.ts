import { z } from "zod";

import { plannerProviders, strictChecks, type GeneratedPlan } from "./planner";
import { subscriptionIds, type RoutableCandidate } from "./routing-types";

export const ClarificationQuestion = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  question: z.string().trim().min(3).max(260),
  why: z.string().trim().min(3).max(220),
  options: z.array(z.string().trim().min(1).max(110)).min(2).max(5),
  allowMultiple: z.boolean(),
});

export type ClarificationQuestionItem = z.infer<typeof ClarificationQuestion>;

export const TurnTriageSchema = z.strictObject({
  mode: z.enum(["chat", "clarify", "plan"]),
  reply: z.string().trim().min(1).max(1600),
  questions: z.array(ClarificationQuestion).max(4),
  elevatedBrief: z.string().trim().max(3600),
});

export type TurnTriage = z.infer<typeof TurnTriageSchema>;

export const BetaTurnRequest = z.strictObject({
  messages: z
    .array(
      z.strictObject({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(12000),
      }),
    )
    .min(1)
    .max(24),
  effort: z.enum(["low", "medium", "max"]),
  strict: z.boolean(),
  forcePlan: z.boolean().optional(),
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
  routingPrefs: z.strictObject({
    mode: z.enum(["open", "subscriptions"]),
    subscriptions: z.array(z.enum(subscriptionIds)).max(5),
  }),
});

export type BetaTurnInput = z.infer<typeof BetaTurnRequest>;

export type BetaTurnResponse =
  | {
      mode: "chat";
      reply: string;
    }
  | {
      mode: "clarify";
      reply: string;
      questions: ClarificationQuestionItem[];
    }
  | {
      mode: "plan";
      reply: string;
      plan: GeneratedPlan;
      candidates: RoutableCandidate[];
      catalogDate: string;
      strict: boolean;
      request: { idea: string; context: string };
    };

export function resolveCandidateLabel(
  modelId: string,
  candidates: readonly RoutableCandidate[],
): string {
  return candidates.find((item) => item.model === modelId)?.label ?? modelId;
}

export function buildMasterHandoffPrompt(
  plan: GeneratedPlan,
  candidates: readonly RoutableCandidate[],
  strict: boolean,
): string {
  const sections: string[] = [
    `# Implementation Handoff: ${plan.title}`,
    `You are executing an architecture-reviewed implementation plan prepared in AnvilMark.\n\n**Before writing or editing code:**\n1. Inspect the repository structure, existing conventions, and package scripts.\n2. Treat file paths, interfaces, and commands below as proposals—verify them against actual files first and surface any conflict before mutating code.\n3. Execute one task slice at a time, run its verification checks, and report files changed, check outputs, and any unresolved risk before moving to the next slice.`,
    `## 1. Goal & Target Audience\n- **Goal:** ${plan.goal}\n- **Target users:** ${plan.users}`,
    `## 2. Scope & Boundaries\n### In Scope\n${plan.scope.map((s) => `- ${s}`).join("\n")}${
      plan.nonGoals.length > 0
        ? `\n\n### Explicit Non-Goals (Do Not Build)\n${plan.nonGoals.map((s) => `- ${s}`).join("\n")}`
        : ""
    }${
      plan.assumptions.length > 0
        ? `\n\n### Working Assumptions to Confirm in Repo\n${plan.assumptions.map((s) => `- ${s}`).join("\n")}`
        : ""
    }${
      plan.questions.length > 0
        ? `\n\n### Open Questions to Confirm Before Irreversible Changes\n${plan.questions.map((s) => `- ${s}`).join("\n")}`
        : ""
    }`,
    `## 3. Architecture Decisions & Tradeoffs\n${plan.architecture
      .map(
        (d, idx) =>
          `### ${idx + 1}. ${d.title}\n- **Decision:** ${d.decision}\n- **Why:** ${d.why}\n- **Rejected alternative:** ${d.alternative} *(Tradeoff: ${d.tradeoff})*`,
      )
      .join("\n\n")}`,
  ];

  if (plan.flows.length > 0) {
    sections.push(
      `## 4. Data Flows & Trust Boundaries\n${plan.flows
        .map((f) => `- **${f.from} → ${f.to}:** ${f.data} *(${f.boundary})*`)
        .join("\n")}`,
    );
  }

  sections.push(
    `## ${plan.flows.length > 0 ? "5" : "4"}. Ordered Task Slices & Model Routing\n${plan.tasks
      .map((task, idx) => {
        const label = resolveCandidateLabel(task.model, candidates);
        const deps =
          task.dependsOn.length > 0
            ? task.dependsOn
                .map(
                  (depId) =>
                    plan.tasks.find((t) => t.id === depId)?.title ?? depId,
                )
                .join(", ")
            : "None (can start first)";
        return [
          `### Task ${String(idx + 1).padStart(2, "0")}: ${task.title} (\`${task.id}\`)`,
          `- **Recommended model:** \`${task.model}\` (${label}) — ${task.why}`,
          task.alternatives.length > 0
            ? `- **Fallback models:** ${task.alternatives.map((a) => `\`${a.model}\` (${a.tradeoff})`).join("; ")}`
            : "",
          `- **Prerequisites:** ${deps}`,
          `- **Outcome:** ${task.outcome}`,
          `- **Acceptance criteria:**\n${task.acceptance.map((a) => `  - ${a}`).join("\n")}`,
          `- **Verification checks:**\n${task.checks.map((c) => `  - ${c}`).join("\n")}`,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n")}`,
  );

  if (strict || plan.security.length > 0) {
    const secLines: string[] = [];
    if (plan.security.length > 0) {
      secLines.push(
        ...plan.security.map(
          (item) =>
            `- **Risk:** ${item.risk}\n  - **Control:** ${item.control}\n  - **Verify:** ${item.verification}`,
        ),
      );
    }
    if (strict) {
      secLines.push(
        `\n### Strict Security Verification Gate\n${strictChecks.map((c) => `- ${c}`).join("\n")}`,
      );
    }
    sections.push(
      `## Security & Verification Requirements\n${secLines.join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

export function buildTaskSlicePrompt(
  plan: GeneratedPlan,
  taskIndex: number,
  candidates: readonly RoutableCandidate[],
  strict: boolean,
): string {
  const task = plan.tasks[taskIndex];
  if (!task) return "";
  const label = resolveCandidateLabel(task.model, candidates);
  const prereqTitles = task.dependsOn.map(
    (depId) => plan.tasks.find((t) => t.id === depId)?.title ?? depId,
  );

  return [
    `# Slice ${String(taskIndex + 1).padStart(2, "0")} of ${plan.tasks.length}: ${task.title}`,
    `**Project:** ${plan.title} — ${plan.goal}`,
    `**Recommended coding model for this slice:** \`${task.model}\` (${label})\n*Why this model:* ${task.why}`,
    prereqTitles.length > 0
      ? `**Assumed completed prerequisites:** ${prereqTitles.join(", ")}`
      : `**Prerequisites:** None — this is an entry slice.`,
    `## Slice Objective\n${task.outcome}`,
    `## Relevant Architecture Constraints\n${plan.architecture
      .map((a) => `- **${a.title}:** ${a.decision}`)
      .join("\n")}`,
    `## Done When (Acceptance Criteria)\n${task.acceptance.map((a) => `- ${a}`).join("\n")}`,
    `## Required Checks Before Marking Complete\n${task.checks.map((c) => `- ${c}`).join("\n")}`,
    strict
      ? `## Strict Security Checks\n${strictChecks.map((c) => `- ${c}`).join("\n")}`
      : "",
    `Inspect the repository first, confirm affected files, implement ONLY this slice cleanly without scope creep, run the checks above, and report exact check results.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
