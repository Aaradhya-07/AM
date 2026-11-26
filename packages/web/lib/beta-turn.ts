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

export const BetaAttachmentSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    dataUrl: z
      .string()
      .max(2_000_000)
      .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/),
  })
  .refine(
    (attachment) =>
      attachment.dataUrl.startsWith(`data:${attachment.mimeType};base64,`),
    "Attachment MIME type must match the data URL header.",
  );

export type BetaAttachment = z.infer<typeof BetaAttachmentSchema>;

export const RepoContextSnapshotSchema = z.strictObject({
  version: z.literal("anvilmark.repo-context.v1"),
  exportedAt: z.string().trim().min(1).max(64).optional(),
  repoName: z.string().trim().min(1).max(160),
  goal: z.string().trim().max(4000).optional(),
  languages: z.array(z.string().trim().min(1).max(60)).max(32),
  frameworks: z.array(z.string().trim().min(1).max(80)).max(40),
  packageManager: z.string().trim().min(1).max(40).nullable(),
  scripts: z
    .record(z.string().trim().min(1).max(120), z.string().trim().max(500))
    .refine((scripts) => Object.keys(scripts).length <= 120, {
      message: "Too many repository scripts.",
    }),
  checkCommands: z.array(z.string().trim().min(1).max(240)).max(32),
  adrPaths: z.array(z.string().trim().min(1).max(400)).max(50),
  sampleFiles: z.array(z.string().trim().min(1).max(400)).max(200),
  totalTrackedFiles: z.number().int().nonnegative().max(1_000_000),
  hasAnvilmarkDir: z.boolean(),
  summary: z.string().trim().max(2400),
});

export type RepoContextSnapshot = z.infer<typeof RepoContextSnapshotSchema>;

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
  attachments: z.array(BetaAttachmentSchema).max(4).optional(),
  repoContext: RepoContextSnapshotSchema.optional(),
});

export type BetaTurnInput = z.infer<typeof BetaTurnRequest>;

export type BetaTurnProgressSection =
  "overview" | "architecture" | "flows" | "tasks" | "security";

export interface BetaTurnStreamStatus {
  phase: "triage" | "synthesis";
  message: string;
  model: string;
}

export interface BetaTurnStreamArchitectSummary {
  reply: string;
  elevatedBrief: string;
}

export interface BetaTurnStreamProgress {
  chars: number;
  section: BetaTurnProgressSection;
}

export interface BetaTurnStreamError {
  error: string;
  status: number;
}

export type BetaTurnStreamEvent =
  | { type: "status"; data: BetaTurnStreamStatus }
  | { type: "architect_summary"; data: BetaTurnStreamArchitectSummary }
  | { type: "progress"; data: BetaTurnStreamProgress }
  | { type: "done"; data: BetaTurnResponse }
  | { type: "error"; data: BetaTurnStreamError };

export function detectPlanProgressSection(
  partialText: string,
): BetaTurnProgressSection {
  const cleaned = partialText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "");
  let section: BetaTurnProgressSection = "overview";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = -1;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        if (depth === 1 && stringStart >= 0) {
          const token = cleaned.slice(stringStart, i);
          if (
            token === "architecture" ||
            token === "flows" ||
            token === "tasks" ||
            token === "security"
          ) {
            let j = i + 1;
            while (j < cleaned.length && /\s/.test(cleaned[j] ?? "")) {
              j += 1;
            }
            if (cleaned[j] === ":") {
              section = token;
            }
          }
        }
        stringStart = -1;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      stringStart = i + 1;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
    }
  }

  return section;
}

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

function formatCandidateBillingTag(
  modelId: string,
  candidates: readonly RoutableCandidate[],
): string {
  const candidate = candidates.find((item) => item.model === modelId);
  if (!candidate) return modelId;
  const billingLabel =
    candidate.billing === "local"
      ? "local OSS · $0 API"
      : candidate.billing === "subscription"
        ? "subscription"
        : "API-rate";
  return `${candidate.label} (${candidate.tier} · ${billingLabel})`;
}

function escapeYamlString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, " ")
    .trim();
}

export function formatRepoContextPromptSection(
  repoContext: RepoContextSnapshot,
): string {
  const scriptEntries = Object.entries(repoContext.scripts).slice(0, 24);
  const sampleFiles = repoContext.sampleFiles.slice(0, 60);
  const lines: string[] = [
    `Verified Local Repository Metadata (${repoContext.version}):`,
    `- Repository: ${repoContext.repoName} (${repoContext.totalTrackedFiles} tracked files, .anvilmark/ present: ${repoContext.hasAnvilmarkDir ? "yes" : "no"})`,
    repoContext.goal ? `- Stated repo goal: ${repoContext.goal}` : "",
    repoContext.summary ? `- Summary: ${repoContext.summary}` : "",
    `- Package manager: ${repoContext.packageManager ?? "unknown"}`,
    `- Languages: ${repoContext.languages.length > 0 ? repoContext.languages.join(", ") : "none detected"}`,
    `- Frameworks: ${repoContext.frameworks.length > 0 ? repoContext.frameworks.join(", ") : "none detected"}`,
    repoContext.checkCommands.length > 0
      ? `- Verified check commands: ${repoContext.checkCommands.join(" | ")}`
      : "- Verified check commands: none detected",
    scriptEntries.length > 0
      ? `- Package scripts:\n${scriptEntries.map(([name, cmd]) => `  - ${name}: ${cmd}`).join("\n")}`
      : "",
    repoContext.adrPaths.length > 0
      ? `- ADR / architecture docs: ${repoContext.adrPaths.join(", ")}`
      : "",
    sampleFiles.length > 0
      ? `- Sample tracked file paths (${sampleFiles.length} of ${repoContext.totalTrackedFiles}): ${sampleFiles.join(", ")}`
      : "",
    `- Grounding rule: Reference these real checkCommands, scripts, frameworks, ADR paths, and tracked file paths instead of guessing. Raw file contents were NOT read and no checks have been executed yet.`,
  ];

  return lines.filter(Boolean).join("\n");
}

export interface PlanHandoffCandidate {
  model: string;
  label: string;
  provider: string;
  tier: RoutableCandidate["tier"];
  billing: RoutableCandidate["billing"];
}

export interface PlanHandoffBundle {
  version: "anvilmark.plan-handoff.v1";
  createdAt: string;
  plan: GeneratedPlan;
  candidates: PlanHandoffCandidate[];
  strict: boolean;
  masterPrompt: string;
  claudeMdSection: string;
  cursorRuleMdc: string;
  codexAgentsSection: string;
}

export function buildClaudeMdSection(
  plan: GeneratedPlan,
  candidates: readonly RoutableCandidate[],
  strict: boolean,
): string {
  const sections: string[] = [
    `## AnvilMark Active Plan: ${plan.title}`,
    `- **Goal:** ${plan.goal}\n- **Target users:** ${plan.users}\n- **Execution mode:** ${strict ? "Strict security verification enabled" : "Standard verification"}`,
    `### Working Rules for Claude Code\n- Inspect the repository structure, scripts, and actual files before editing.\n- Treat proposed paths, commands, and interfaces below as a blueprint—confirm against the real codebase first.\n- Implement one ordered slice at a time, run its verification checks, and report exact files changed, commands run, and check outcomes.\n- Never describe unrun checks as passed; keep a slice open if verification fails or cannot run.`,
    `### Scope & Non-Goals\n**In scope:**\n${plan.scope.map((item) => `- ${item}`).join("\n")}${
      plan.nonGoals.length > 0
        ? `\n\n**Explicit non-goals (do not build):**\n${plan.nonGoals.map((item) => `- ${item}`).join("\n")}`
        : ""
    }`,
    `### Architecture Decisions\n${plan.architecture
      .map(
        (decision) =>
          `- **${decision.title}:** ${decision.decision} *(${decision.why}; rejected ${decision.alternative})*`,
      )
      .join("\n")}`,
    `### Ordered Task Slices & Model Routing\n${plan.tasks
      .map((task, idx) => {
        const modelInfo = formatCandidateBillingTag(task.model, candidates);
        const prereqs =
          task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none";
        const fallbacks =
          task.alternatives.length > 0
            ? `\n  - Fallbacks: ${task.alternatives.map((alt) => `\`${alt.model}\` (${alt.tradeoff})`).join("; ")}`
            : "";
        return [
          `${idx + 1}. **${task.title}** (\`${task.id}\`) — recommended \`${task.model}\` (${modelInfo})`,
          `  - Prerequisites: ${prereqs}`,
          `  - Outcome: ${task.outcome}`,
          `  - Acceptance: ${task.acceptance.join("; ")}`,
          `  - Checks: ${task.checks.join(" · ")}${fallbacks}`,
        ].join("\n");
      })
      .join("\n")}`,
  ];

  if (strict || plan.security.length > 0) {
    const secLines: string[] = plan.security.map(
      (item) =>
        `- **${item.risk}:** ${item.control} *(Verify: ${item.verification})*`,
    );
    if (strict) {
      secLines.push(...strictChecks.map((check) => `- ${check}`));
    }
    sections.push(`### Security & Verification Gate\n${secLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

export function buildCursorRuleMdc(
  plan: GeneratedPlan,
  candidates: readonly RoutableCandidate[],
  strict: boolean,
): string {
  const description = escapeYamlString(`AnvilMark active plan: ${plan.title}`);
  const bodySections: string[] = [
    `# AnvilMark Plan Rule: ${plan.title}`,
    `**Goal:** ${plan.goal}\n**Target users:** ${plan.users}`,
    `## Guardrails\n- Inspect existing repository files and scripts before editing; verify proposed paths and commands against the codebase.\n- Follow the architecture decisions and explicit non-goals below.\n- Execute one slice at a time, run its checks, and report exact outcomes—never claim unrun checks passed.`,
    plan.nonGoals.length > 0
      ? `## Explicit Non-Goals (Do Not Build)\n${plan.nonGoals.map((item) => `- ${item}`).join("\n")}`
      : "",
    `## Architecture Decisions\n${plan.architecture
      .map(
        (decision) =>
          `- **${decision.title}:** ${decision.decision} *(Why: ${decision.why}; rejected: ${decision.alternative})*`,
      )
      .join("\n")}`,
    plan.flows.length > 0
      ? `## Data Flows & Trust Boundaries\n${plan.flows.map((flow) => `- ${flow.from} -> ${flow.to}: ${flow.data} (${flow.boundary})`).join("\n")}`
      : "",
    `## Ordered Slices & Recommended Models\n${plan.tasks
      .map((task, idx) => {
        const modelInfo = formatCandidateBillingTag(task.model, candidates);
        const deps =
          task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none";
        return [
          `### ${String(idx + 1).padStart(2, "0")}. ${task.title} (\`${task.id}\`)`,
          `- Model: \`${task.model}\` — ${modelInfo} (${task.why})`,
          `- Prerequisites: ${deps}`,
          `- Outcome: ${task.outcome}`,
          `- Acceptance:\n${task.acceptance.map((item) => `  - ${item}`).join("\n")}`,
          `- Verification checks:\n${task.checks.map((item) => `  - ${item}`).join("\n")}`,
        ].join("\n");
      })
      .join("\n\n")}`,
  ];

  if (strict || plan.security.length > 0) {
    const secLines: string[] = plan.security.map(
      (item) =>
        `- **${item.risk}:** ${item.control} (Verify: ${item.verification})`,
    );
    if (strict) {
      secLines.push(...strictChecks.map((check) => `- ${check}`));
    }
    bodySections.push(
      `## Security & Verification Requirements\n${secLines.join("\n")}`,
    );
  }

  return [
    "---",
    `description: "${description}"`,
    "alwaysApply: true",
    "---",
    "",
    bodySections.filter(Boolean).join("\n\n"),
  ].join("\n");
}

export function buildCodexAgentsSection(
  plan: GeneratedPlan,
  candidates: readonly RoutableCandidate[],
  strict: boolean,
): string {
  const sections: string[] = [
    `## AnvilMark Active Plan: ${plan.title}`,
    `**Goal:** ${plan.goal}\n**Target users:** ${plan.users}`,
    `### Agent Execution Protocol\n1. Inspect the repository layout, package scripts, and existing conventions before making edits.\n2. Confirm all assumptions, file paths, and check commands against the actual repository.\n3. Deliver one task slice at a time in dependency order without expanding into listed non-goals.\n4. Run the verification checks for each slice and report exact commands, results, and remaining risks. Keep the current model if a recommended model is unavailable and note the substitution.`,
    `### Scope & Non-Goals\n- **In scope:** ${plan.scope.join("; ")}${
      plan.nonGoals.length > 0
        ? `\n- **Non-goals (out of bounds):** ${plan.nonGoals.join("; ")}`
        : ""
    }${
      plan.assumptions.length > 0
        ? `\n- **Assumptions to confirm:** ${plan.assumptions.join("; ")}`
        : ""
    }`,
    `### Architecture Constraints\n${plan.architecture
      .map(
        (decision) =>
          `- **${decision.title}:** ${decision.decision} *(Rationale: ${decision.why}; tradeoff vs ${decision.alternative}: ${decision.tradeoff})*`,
      )
      .join("\n")}`,
    `### Task Slices & Model Routing\n${plan.tasks
      .map((task, idx) => {
        const modelInfo = formatCandidateBillingTag(task.model, candidates);
        const deps =
          task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "none";
        return [
          `- **Slice ${String(idx + 1).padStart(2, "0")} — ${task.title} (\`${task.id}\`)**`,
          `  - Recommended model: \`${task.model}\` (${modelInfo}) — ${task.why}`,
          `  - Depends on: ${deps}`,
          `  - Outcome: ${task.outcome}`,
          `  - Acceptance: ${task.acceptance.join("; ")}`,
          `  - Required checks: ${task.checks.join(" | ")}`,
        ].join("\n");
      })
      .join("\n")}`,
  ];

  if (strict || plan.security.length > 0) {
    const secLines: string[] = plan.security.map(
      (item) =>
        `- **${item.risk}:** ${item.control} (Verify: ${item.verification})`,
    );
    if (strict) {
      secLines.push(...strictChecks.map((check) => `- ${check}`));
    }
    sections.push(`### Security & Strict Gate\n${secLines.join("\n")}`);
  }

  return sections.join("\n\n");
}

export function buildPlanBundle(
  plan: GeneratedPlan,
  candidates: readonly RoutableCandidate[],
  strict: boolean,
  createdAt: string = new Date().toISOString(),
): PlanHandoffBundle {
  return {
    version: "anvilmark.plan-handoff.v1",
    createdAt,
    plan,
    candidates: candidates.map(({ model, label, provider, tier, billing }) => ({
      model,
      label,
      provider,
      tier,
      billing,
    })),
    strict,
    masterPrompt: buildMasterHandoffPrompt(plan, candidates, strict),
    claudeMdSection: buildClaudeMdSection(plan, candidates, strict),
    cursorRuleMdc: buildCursorRuleMdc(plan, candidates, strict),
    codexAgentsSection: buildCodexAgentsSection(plan, candidates, strict),
  };
}

export function buildPlanBundleJson(
  plan: GeneratedPlan,
  candidates: readonly RoutableCandidate[],
  strict: boolean,
  createdAt: string = new Date().toISOString(),
): string {
  return JSON.stringify(
    buildPlanBundle(plan, candidates, strict, createdAt),
    null,
    2,
  );
}
