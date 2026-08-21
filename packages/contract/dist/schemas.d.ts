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
export declare const SCHEMA_VERSION: "0.1.0";
export declare const ConstraintsSchema: z.ZodObject<{
    budgetMonthlyUsd: z.ZodNullable<z.ZodNumber>;
    deployment: z.ZodEnum<{
        cloud: "cloud";
        "on-prem": "on-prem";
        hybrid: "hybrid";
    }>;
    privacyRequirements: z.ZodArray<z.ZodString>;
    latencyRequirementMs: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type Constraints = z.infer<typeof ConstraintsSchema>;
export declare const SystemComponentSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    purpose: z.ZodString;
    currentModel: z.ZodNullable<z.ZodString>;
    monthlyInputTokens: z.ZodNullable<z.ZodNumber>;
    monthlyOutputTokens: z.ZodNullable<z.ZodNumber>;
    monthlyReasoningTokens: z.ZodNullable<z.ZodNumber>;
    monthlyCalls: z.ZodNullable<z.ZodNumber>;
    isAsync: z.ZodBoolean;
    filePath: z.ZodNullable<z.ZodString>;
    lineNumber: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type SystemComponent = z.infer<typeof SystemComponentSchema>;
export declare const AuditInputSchema: z.ZodObject<{
    components: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        purpose: z.ZodString;
        currentModel: z.ZodNullable<z.ZodString>;
        monthlyInputTokens: z.ZodNullable<z.ZodNumber>;
        monthlyOutputTokens: z.ZodNullable<z.ZodNumber>;
        monthlyReasoningTokens: z.ZodNullable<z.ZodNumber>;
        monthlyCalls: z.ZodNullable<z.ZodNumber>;
        isAsync: z.ZodBoolean;
        filePath: z.ZodNullable<z.ZodString>;
        lineNumber: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    constraints: z.ZodObject<{
        budgetMonthlyUsd: z.ZodNullable<z.ZodNumber>;
        deployment: z.ZodEnum<{
            cloud: "cloud";
            "on-prem": "on-prem";
            hybrid: "hybrid";
        }>;
        privacyRequirements: z.ZodArray<z.ZodString>;
        latencyRequirementMs: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>;
    repoPath: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export type AuditInput = z.infer<typeof AuditInputSchema>;
export declare const FindingSchema: z.ZodObject<{
    id: z.ZodString;
    componentId: z.ZodString;
    category: z.ZodEnum<{
        "model-choice": "model-choice";
        "self-host": "self-host";
        "token-efficiency": "token-efficiency";
    }>;
    ruleId: z.ZodString;
    title: z.ZodString;
    reasoning: z.ZodString;
    currentModel: z.ZodNullable<z.ZodString>;
    recommendedModel: z.ZodNullable<z.ZodString>;
    currentMonthlyUsd: z.ZodNumber;
    projectedMonthlyUsd: z.ZodNumber;
    savingsMonthlyUsd: z.ZodNumber;
    savingsPercent: z.ZodNumber;
    confidence: z.ZodEnum<{
        high: "high";
        medium: "medium";
        low: "low";
    }>;
    tokenizerType: z.ZodEnum<{
        native: "native";
        approximate: "approximate";
    }>;
    filePath: z.ZodNullable<z.ZodString>;
    lineNumber: z.ZodNullable<z.ZodNumber>;
}, z.core.$strip>;
export type Finding = z.infer<typeof FindingSchema>;
export declare const AuditResultSchema: z.ZodObject<{
    findings: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        componentId: z.ZodString;
        category: z.ZodEnum<{
            "model-choice": "model-choice";
            "self-host": "self-host";
            "token-efficiency": "token-efficiency";
        }>;
        ruleId: z.ZodString;
        title: z.ZodString;
        reasoning: z.ZodString;
        currentModel: z.ZodNullable<z.ZodString>;
        recommendedModel: z.ZodNullable<z.ZodString>;
        currentMonthlyUsd: z.ZodNumber;
        projectedMonthlyUsd: z.ZodNumber;
        savingsMonthlyUsd: z.ZodNumber;
        savingsPercent: z.ZodNumber;
        confidence: z.ZodEnum<{
            high: "high";
            medium: "medium";
            low: "low";
        }>;
        tokenizerType: z.ZodEnum<{
            native: "native";
            approximate: "approximate";
        }>;
        filePath: z.ZodNullable<z.ZodString>;
        lineNumber: z.ZodNullable<z.ZodNumber>;
    }, z.core.$strip>>;
    totalCurrentMonthlyUsd: z.ZodNumber;
    totalProjectedMonthlyUsd: z.ZodNumber;
    totalSavingsMonthlyUsd: z.ZodNumber;
    totalSavingsPercent: z.ZodNumber;
    generatedAt: z.ZodISODateTime;
    schemaVersion: z.ZodString;
}, z.core.$strip>;
export type AuditResult = z.infer<typeof AuditResultSchema>;
//# sourceMappingURL=schemas.d.ts.map