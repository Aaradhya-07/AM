/**
 * @anvilmark/project-contract
 *
 * The durable, versioned decision contract ANVILMARK owns.
 *
 * This is an INDEPENDENT schema line from the historical `@anvilmark/contract`
 * package. That package's `SCHEMA_VERSION = "0.1.0"` describes the earlier
 * cost-audit scaffold and is frozen; nothing here modifies or migrates it.
 */
export { PROJECT_SCHEMA_ID, PROJECT_SCHEMA_VERSION } from "./version.js";
export type { ProjectSchemaVersion } from "./version.js";
export { ContractValidationError, ISSUE_CODES, fail, issue, ok, sortIssues, unwrap, } from "./errors.js";
export type { ContractIssue, ContractResult, IssueCode } from "./errors.js";
export * from "./schema/index.js";
export { parseJsonDocument, parseProjectContract, parseYamlDocument, validateProjectContract, } from "./parse.js";
export type { ContractFormat } from "./parse.js";
export { compareCodeUnits } from "./canonical.js";
export { canonicalize, prettyStringify, stableStringify, toCanonicalBytes, toNormalizedJson, toNormalizedYaml, } from "./serialize.js";
export { CanonicalizationError } from "./canonical.js";
export type { CanonicalValue } from "./canonical.js";
export { checkIntegrity } from "./validate/integrity.js";
export type { SubjectType } from "./validate/integrity.js";
export { ADMISSIBLE_EVIDENCE_KINDS, RATIFIED_EVIDENCE_FLOORS, TIER_ORDER, admitEvidence, assessEvidence, effectiveFloor, evaluateConstraint, floorSubjectForConstraint, isHardwareIdentityMismatch, tierForEvidence, tierForEvidenceKind, tierMeets, tierRank, } from "./evidence-tiers.js";
export type { AdmissionVerdict, ConstraintEvaluation, EvidenceAssessment, EvidenceContext, } from "./evidence-tiers.js";
export { listEvidenceGaps } from "./gaps.js";
export type { EvidenceGap } from "./gaps.js";
export { classifyValue, findSecrets, shannonEntropy } from "./secrets.js";
export type { SecretFinding, SecretVerdict } from "./secrets.js";
export { resolveDecision } from "./resolve.js";
export type { ResolvedApprovalContent, ResolvedDecision } from "./resolve.js";
export { HASH_ALGORITHM, appendApproval, approvalState, computeApprovalHash, hashApprovalContent, isApprovalCurrent, } from "./approval.js";
export type { ApprovalState, AppendApprovalInput } from "./approval.js";
export { ATLAS_FIXTURE_PATH, loadAtlasFixture, readAtlasFixtureText, } from "./fixtures.js";
//# sourceMappingURL=index.d.ts.map