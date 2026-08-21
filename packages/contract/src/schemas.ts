/**
 * FROZEN CONTRACT — v0.1.0
 *
 * This schema is the interface between the engine and all consumers.
 * Changing it breaks parallel work across the team.
 *
 * Do not modify without agreement from all three developers.
 * Bump SCHEMA_VERSION on any change.
 */

import { z } from "zod/v4";

export const SCHEMA_VERSION = "0.1.0" as const;

export const ConstraintsSchema = z.object({
  budgetMonthlyUsd: z.number().nullable(),
  deployment: z.enum(["cloud", "on-prem", "hybrid"]),
  privacyRequirements: z.array(z.string()),
  latencyRequirementMs: z.number().nullable(),
});

export type Constraints = z.infer<typeof ConstraintsSchema>;

export const SystemComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string(),
  currentModel: z.string().nullable(),
  monthlyInputTokens: z.number().nullable(),
  monthlyOutputTokens: z.number().nullable(),
  monthlyReasoningTokens: z.number().nullable(),
  monthlyCalls: z.number().nullable(),
  isAsync: z.boolean(),
  filePath: z.string().nullable(),
  lineNumber: z.number().nullable(),
});

export type SystemComponent = z.infer<typeof SystemComponentSchema>;

export const AuditInputSchema = z.object({
  components: z.array(SystemComponentSchema),
  constraints: ConstraintsSchema,
  repoPath: z.string().nullable(),
});

export type AuditInput = z.infer<typeof AuditInputSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  componentId: z.string(),
  category: z.enum(["model-choice", "self-host", "token-efficiency"]),
  ruleId: z.string(),
  title: z.string(),
  reasoning: z.string(),
  currentModel: z.string().nullable(),
  recommendedModel: z.string().nullable(),
  currentMonthlyUsd: z.number(),
  projectedMonthlyUsd: z.number(),
  savingsMonthlyUsd: z.number(),
  savingsPercent: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  tokenizerType: z.enum(["native", "approximate"]),
  filePath: z.string().nullable(),
  lineNumber: z.number().nullable(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const AuditResultSchema = z.object({
  findings: z.array(FindingSchema),
  totalCurrentMonthlyUsd: z.number(),
  totalProjectedMonthlyUsd: z.number(),
  totalSavingsMonthlyUsd: z.number(),
  totalSavingsPercent: z.number(),
  generatedAt: z.iso.datetime(),
  schemaVersion: z.string(),
});

export type AuditResult = z.infer<typeof AuditResultSchema>;
