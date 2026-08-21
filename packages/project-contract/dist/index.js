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
// Errors and result envelope.
export { ContractValidationError, ISSUE_CODES, fail, issue, ok, sortIssues, unwrap, } from "./errors.js";
// Schemas and inferred types.
export * from "./schema/index.js";
// Parsing and validation.
export { parseJsonDocument, parseProjectContract, parseYamlDocument, validateProjectContract, } from "./parse.js";
// Deterministic serialization.
export { compareCodeUnits } from "./canonical.js";
export { canonicalize, prettyStringify, stableStringify, toCanonicalBytes, toNormalizedJson, toNormalizedYaml, } from "./serialize.js";
export { CanonicalizationError } from "./canonical.js";
// Referential integrity.
export { checkIntegrity } from "./validate/integrity.js";
// Evidence tiers, floors, and outcomes.
export { ADMISSIBLE_EVIDENCE_KINDS, RATIFIED_EVIDENCE_FLOORS, TIER_ORDER, admitEvidence, assessEvidence, effectiveFloor, evaluateConstraint, floorSubjectForConstraint, isHardwareIdentityMismatch, tierForEvidence, tierForEvidenceKind, tierMeets, tierRank, } from "./evidence-tiers.js";
// Evidence gaps.
export { listEvidenceGaps } from "./gaps.js";
// Secret rejection.
export { classifyValue, findSecrets, shannonEntropy } from "./secrets.js";
// Decision resolution and approval hashing.
export { resolveDecision } from "./resolve.js";
export { HASH_ALGORITHM, appendApproval, approvalState, computeApprovalHash, hashApprovalContent, isApprovalCurrent, } from "./approval.js";
// Fixtures.
export { ATLAS_FIXTURE_PATH, loadAtlasFixture, readAtlasFixtureText, } from "./fixtures.js";
