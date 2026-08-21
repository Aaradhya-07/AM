import type { AuditInput, Finding } from "@anvilmark/contract";

export type RuleCategory = Finding["category"];

export interface DetectionRule {
  readonly id: string;
  readonly category: RuleCategory;
  detect(input: AuditInput): Promise<Finding[] | null>;
}

export function createStubRule(
  id: string,
  category: RuleCategory,
): DetectionRule {
  return {
    id,
    category,
    async detect(_input) {
      // TODO(engine): implement detection after the frozen contract is accepted.
      return null;
    },
  };
}
