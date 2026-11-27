/**
 * @anvilmark/cli
 *
 * The local, user-operated ANVILMARK workflow: initialize a project from an
 * idea, elicit structure, take optional proposals from the user's own
 * intelligence, compare alternatives honestly, and approve one exact decision
 * revision interactively.
 */
export { USAGE, run } from "./cli.js";
export type { CliIo, ExitCode } from "./io.js";
export { EXIT, processIo } from "./io.js";
export { APPROVAL_LIMIT_STATEMENT } from "./render.js";
export * from "./store.js";
export * from "./host.js";
export * from "./workflow/edit.js";
export * from "./workflow/compare.js";
export * from "./workflow/decisions.js";
export * from "./workflow/proposal.js";
export * from "./workflow/architecture.js";
export * from "./generate.js";
export * from "./scan.js";
export * from "./conformance.js";
export * from "./commands/login.js";
export * from "./commands/push.js";
export { loadSlicePlan } from "./commands/slice-storage.js";
export { verifySlice, SliceId } from "./commands/verify-slice.js";
export type { SliceVerificationReport } from "./commands/verify-slice.js";
export {
  appendSliceOutcome,
  readSliceOutcomes,
  SliceOutcomeInputSchema,
  aggregateOutcomes,
  outcomesRepoName,
  inferDominantPathPrefix,
  inferOutcomeCategoryFromPaths,
  syncGitAttributedOutcomes,
  type OutcomeTaskCategory,
  type RepoOutcomesSummary,
} from "./commands/outcomes.js";
export {
  mineHistoricalCalibrationCommits,
  computeLineReworkRatio,
  runRepoCalibration,
  type MinedCalibrationCommit,
  type CalibrationTrialResult,
} from "./commands/calibrate-repo.js";
export { sliceDigest } from "./commands/slice-worktree.js";
export {
  exportRepoContext,
  type RepoContext,
} from "./commands/export-context.js";
export {
  PLAN_HANDOFF_VERSION,
  HandoffPlan,
  PlanHandoffBundle,
  SliceContractSchema,
  applyPlan,
  parseBundle,
  renderCursorRule,
  renderInstructionSection,
  type AppliedFile,
  type PlanTarget,
  type SliceContractSpec,
} from "./commands/apply-plan.js";
export {
  measureDrift,
  type ArchitectureDriftReport,
} from "./commands/drift.js";
export { sliceWaves } from "./commands/slice-dag.js";
export {
  connectAgents,
  type ConnectTarget,
  type ConnectedArtifact,
} from "./commands/connect.js";
export {
  installHooks,
  uninstallHooks,
  inspectHookStatus,
  runHookGate,
  type HookTarget,
} from "./commands/hooks.js";
export {
  selectNextSlice,
  inferRunnerForModel,
  renderExecutableSliceBrief,
} from "./commands/next.js";
export { collectCockpitSnapshot } from "./commands/cockpit.js";
export { generateCiReport } from "./commands/ci-report.js";
export {
  runAmServerSliceAgent,
  validatePathAgainstContract,
} from "./commands/local-agent-runner.js";
