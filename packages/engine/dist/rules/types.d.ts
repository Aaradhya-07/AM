import type { AuditInput, Finding } from "@anvilmark/contract";
export type RuleCategory = Finding["category"];
export interface DetectionRule {
    readonly id: string;
    readonly category: RuleCategory;
    detect(input: AuditInput): Promise<Finding[] | null>;
}
export declare function createStubRule(id: string, category: RuleCategory): DetectionRule;
//# sourceMappingURL=types.d.ts.map