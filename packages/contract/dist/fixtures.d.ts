import type { AuditResult } from "./schemas.js";
export declare const FIXTURE_NAMES: readonly ["saas-support", "document-review", "research-agent"];
export type FixtureName = (typeof FIXTURE_NAMES)[number];
export declare function loadFixture(name: FixtureName): Promise<AuditResult>;
export declare function loadAllFixtures(): Promise<AuditResult[]>;
//# sourceMappingURL=fixtures.d.ts.map