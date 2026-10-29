import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { sanitizeText } from "@anvilmark/adapters";
import {
  DevelopmentConfigurationCatalog,
  DevelopmentEvidenceCatalog,
  configurationFactFreshness,
  openModelCatalog,
  type ConfigurationBilling,
  type ConfigurationFact,
  type DevelopmentEvidenceRow,
  type StoredDevelopmentConfiguration,
} from "@anvilmark/model-catalog";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import type { CommandContext } from "./common.js";
import {
  Cancelled,
  UsageError,
  flag,
  parse,
  projectDirectory,
  requiredOption,
  writeJson,
} from "./common.js";
import { DevelopmentConfigurationImport } from "./development-configuration-schema.js";
import {
  matchedDevelopmentEvidence,
  type SelectionEvidenceRecord,
} from "./development-selection.js";

export const DEVELOPMENT_USAGE = `anvilmark development <catalog|plan|approve|recommend|run|review|report> [options]

  catalog import --file FILE   append reviewed configuration snapshots to the local database
  catalog list|show|history --id ID
                             inspect exact offers, snapshot history, and fact freshness
  plan --file PLAN.json       validate and save a development plan in .anvilmark/development/
  approve [--agent-test]     approve the exact plan; agent-test is excluded from outcome evidence
  recommend [--catalog-db FILE]
                             compare eligible setups with mapped research and local outcomes
  run --candidate ID --prompt-file FILE
                             run an exact setup, collect metadata and check the result
  run --model ID --prompt-file FILE
                             use a model name when it identifies one candidate
  review --run ID [--decision reject --reason TEXT] [--agent-test]
                             review the exact run; agent-test is excluded from outcome evidence
  report                     show the connected plan, comparison and recorded runs

Options: --project-dir DIR (-C), --json (catalog, recommend, report), --help`;

const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const Nonempty = z.string().trim().min(1);
const Check = z.strictObject({
  name: Id,
  argv: z.array(Nonempty).min(1),
});
const TaskProfile = z.strictObject({
  kind: z.enum([
    "architecture",
    "bug",
    "feature",
    "refactor",
    "test",
    "review",
  ]),
  languages: z.array(Nonempty).min(1),
  risk: z.enum(["low", "medium", "high"]),
});
const SourcedValue = z.strictObject({ value: Nonempty, source: Nonempty });
const SourcedRegions = z.strictObject({
  values: z.array(Nonempty).min(1),
  source: Nonempty,
});
const Billing = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("subscription") }),
  z.strictObject({
    mode: z.literal("api_estimate"),
    input_usd_per_million: z.number().nonnegative(),
    cached_input_usd_per_million: z.number().nonnegative().optional(),
    output_usd_per_million: z.number().nonnegative(),
    source: Nonempty,
  }),
]);
const ProviderRestriction = z
  .strictObject({
    allowed: z.array(Nonempty).min(1).optional(),
    excluded: z.array(Nonempty).min(1).optional(),
    source: Nonempty,
  })
  .refine((value) => value.allowed || value.excluded, {
    message: "provider restriction needs allowed or excluded providers",
  });
const Candidate = z
  .strictObject({
    id: Id,
    agent: z.literal("codex_cli"),
    model: Nonempty,
    expected_input_tokens: z.number().int().nonnegative(),
    expected_output_tokens: z.number().int().nonnegative(),
    billing: Billing.optional(),
    catalog_ref: z
      .strictObject({
        configuration_id: Id,
        snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    quality_evidence: z.enum(["none", "public", "project_task"]),
    evidence_note: Nonempty,
    provider_evidence: SourcedValue.optional(),
    data_region_evidence: SourcedRegions.optional(),
    research_mapping: z
      .strictObject({
        source_key: Nonempty,
        source_model_id: Nonempty,
        relevance_note: Nonempty,
        identity_note: Nonempty,
      })
      .optional(),
  })
  .refine((candidate) => candidate.billing || candidate.catalog_ref, {
    message:
      "candidate needs billing or an exact configuration catalog reference",
  });
const Plan = z.strictObject({
  schema_version: z.literal(1),
  architecture: z.strictObject({ id: Id, summary: Nonempty }),
  task: z.strictObject({
    id: Id,
    summary: Nonempty,
    profile: TaskProfile.optional(),
    checks: z.array(Check).min(1),
  }),
  restrictions: z.strictObject({
    allowed_models: z.array(Nonempty).min(1),
    max_estimated_usd: z.number().nonnegative().nullable(),
    provider: ProviderRestriction.optional(),
    data_region: z
      .strictObject({ allowed: z.array(Nonempty).min(1), source: Nonempty })
      .optional(),
    required_capabilities: z.array(Id).optional(),
  }),
  candidates: z.array(Candidate).min(2),
  evaluation: z
    .strictObject({
      baseline_candidate_id: Id,
      max_acceptance_drop: z.number().min(0).max(1).optional(),
    })
    .optional(),
});
type DevelopmentPlan = z.infer<typeof Plan>;
type DevelopmentCandidate = DevelopmentPlan["candidates"][number];
type CandidateBilling = z.infer<typeof Billing> | ConfigurationBilling;
const configurationKey = (candidate: DevelopmentCandidate): string =>
  candidate.catalog_ref
    ? `${candidate.catalog_ref.configuration_id}@${candidate.catalog_ref.snapshot_sha256}`
    : "legacy";
type RestrictionStanding = {
  restriction:
    | "provider_allowlist"
    | "provider_exclusion"
    | "data_region_allowlist"
    | "capability";
  standing: "satisfied" | "failed" | "unknown";
  rule_values: string[];
  restriction_source: string;
  evidence_source: string | null;
  observed: string | string[] | boolean | null;
  reason: string;
};

interface Approval {
  readonly plan_hash: string;
  readonly approved_at: string;
  readonly actor: "interactive_local_operator" | "agent_test_operator";
}
interface TokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
}
interface CheckResult {
  name: string;
  argv: string[];
  exit_code: number | null;
  duration_ms: number;
}
interface DevelopmentRun {
  schema_version: 1;
  id: string;
  plan_hash: string;
  approval_at_start: "current" | "missing_or_stale";
  approval_actor_at_start?: Approval["actor"] | null;
  architecture_id: string;
  task_id: string;
  candidate_id: string;
  configuration_snapshot_sha256?: string | null;
  configured_model: string;
  model_events: Array<{ event_index: number; model: string }>;
  model_identity:
    "tool_reported" | "tool_reported_multiple" | "configured_only";
  codex_thread_id: string | null;
  prompt_sha256: string;
  started_at: string;
  finished_at: string;
  agent_exit_code: number | null;
  agent_error: string | null;
  event_count: number;
  event_parse_errors: number;
  event_stream_sha256: string;
  usage: TokenUsage;
  billing: "subscription_allowance" | "api_rate_estimate";
  estimated_usd_from_observed_tokens: number | null;
  base_commit: string;
  baseline_clean: boolean;
  changed_paths: string[];
  change_sha256: string;
  checks: CheckResult[];
}
interface RunReview {
  readonly run_id: string;
  readonly run_hash: string;
  readonly decision?: "accepted" | "rejected";
  readonly accepted_at?: string;
  readonly reviewed_at?: string;
  readonly reason?: string;
  readonly actor: "interactive_local_operator" | "agent_test_operator";
}

const zeroUsage = (): TokenUsage => ({
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
});
const digest = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
const directory = (root: string): string =>
  join(root, ".anvilmark", "development");
const planFile = (root: string): string => join(directory(root), "plan.json");
const approvalFile = (root: string): string =>
  join(directory(root), "approval.json");
const runsDirectory = (root: string): string => join(directory(root), "runs");
const reviewsDirectory = (root: string): string =>
  join(directory(root), "reviews");
const plansDirectory = (root: string): string => join(directory(root), "plans");
const evidenceFile = (root: string): string =>
  join(directory(root), "development-evidence.sqlite");
const configurationFile = (root: string): string =>
  join(directory(root), "configurations.sqlite");

type ConfigurationResolution = {
  readonly status:
    | "current"
    | "catalog_missing"
    | "snapshot_missing"
    | "superseded"
    | "identity_mismatch";
  readonly stored: StoredDevelopmentConfiguration | null;
};

async function resolveConfigurations(
  root: string,
  plan: DevelopmentPlan,
): Promise<Map<string, ConfigurationResolution>> {
  const mapped = plan.candidates.filter((candidate) => candidate.catalog_ref);
  const result = new Map<string, ConfigurationResolution>();
  if (!mapped.length) return result;
  const path = configurationFile(root);
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) {
    for (const candidate of mapped)
      result.set(candidate.id, { status: "catalog_missing", stored: null });
    return result;
  }
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("configuration catalog must be a regular file");
  const catalog = await DevelopmentConfigurationCatalog.open(path);
  try {
    for (const candidate of mapped) {
      const ref = candidate.catalog_ref!;
      const stored = catalog.getByHash(
        ref.configuration_id,
        ref.snapshot_sha256,
      );
      const latest = catalog.getLatest(ref.configuration_id);
      const status = !stored
        ? "snapshot_missing"
        : latest?.snapshot_sha256 !== ref.snapshot_sha256
          ? "superseded"
          : stored.snapshot.agent !== candidate.agent ||
              stored.snapshot.model !== candidate.model
            ? "identity_mismatch"
            : "current";
      result.set(candidate.id, { status, stored });
    }
  } finally {
    catalog.close();
  }
  return result;
}

function sourcedFact<T>(
  fact: ConfigurationFact<T> | undefined,
  now: Date,
): {
  status: "fresh" | "stale" | "missing";
  source: string | null;
  source_kind: string | null;
} {
  return fact
    ? {
        status: configurationFactFreshness(fact.source, now),
        source: fact.source.ref,
        source_kind: fact.source.kind,
      }
    : { status: "missing", source: null, source_kind: null };
}

function freshFact<T>(
  resolution: ConfigurationResolution | undefined,
  fact: ConfigurationFact<T> | undefined,
  now: Date,
  allowLocalObservation = false,
): ConfigurationFact<T> | undefined {
  return resolution?.status === "current" &&
    fact &&
    fact.source.kind !== "public_research" &&
    (allowLocalObservation || fact.source.kind !== "local_observation") &&
    configurationFactFreshness(fact.source, now) === "fresh"
    ? fact
    : undefined;
}

function effectiveBilling(
  candidate: DevelopmentCandidate,
  resolution: ConfigurationResolution | undefined,
  now: Date,
): CandidateBilling | undefined {
  if (!candidate.catalog_ref) return candidate.billing;
  return freshFact(resolution, resolution?.stored?.snapshot.billing, now)
    ?.value;
}

function profileKey(
  profile: z.infer<typeof TaskProfile>,
  architectureId: string,
): string {
  return JSON.stringify({
    architecture_id: architectureId,
    kind: profile.kind,
    languages: [
      ...new Set(profile.languages.map((item) => item.toLowerCase())),
    ].sort(),
    risk: profile.risk,
  });
}

async function safeDirectory(root: string, child?: string): Promise<void> {
  const paths = [join(root, ".anvilmark"), directory(root)];
  if (child) paths.push(child);
  for (const path of paths) {
    await mkdir(path, { recursive: false, mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(
        `development storage path is not a real directory: ${path}`,
      );
  }
}

async function verifyStorage(root: string): Promise<void> {
  for (const path of [join(root, ".anvilmark"), directory(root)]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(
        `development storage path is not a real directory: ${path}`,
      );
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function loadPlan(
  root: string,
): Promise<{ plan: DevelopmentPlan; hash: string }> {
  await verifyStorage(root);
  if ((await lstat(planFile(root))).isSymbolicLink())
    throw new Error("development plan cannot be a symbolic link");
  const raw = await readFile(planFile(root), "utf8");
  const plan = Plan.parse(JSON.parse(raw));
  return { plan, hash: digest(JSON.stringify(plan)) };
}

async function currentApproval(
  root: string,
  hash: string,
): Promise<Approval | null> {
  try {
    if ((await lstat(approvalFile(root))).isSymbolicLink())
      throw new Error("development approval cannot be a symbolic link");
    const approval = JSON.parse(
      await readFile(approvalFile(root), "utf8"),
    ) as Approval;
    return approval.plan_hash === hash ? approval : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function approvalStanding(
  root: string,
  hash: string,
): Promise<"current" | "missing_or_stale"> {
  return (await currentApproval(root, hash)) ? "current" : "missing_or_stale";
}

function estimate(
  candidate: DevelopmentCandidate,
  billing: CandidateBilling | undefined,
): number | null {
  if (!billing || billing.mode === "subscription") return null;
  return (
    (candidate.expected_input_tokens * billing.input_usd_per_million +
      candidate.expected_output_tokens * billing.output_usd_per_million) /
    1_000_000
  );
}

function observedApiEstimate(
  bill: CandidateBilling | undefined,
  usage: TokenUsage,
  modelRateApplicable: boolean,
): number | null {
  if (!bill || bill.mode === "subscription" || !modelRateApplicable)
    return null;
  if (usage.cached_input_tokens > usage.input_tokens) return null;
  if (
    usage.cached_input_tokens > 0 &&
    bill.cached_input_usd_per_million === undefined
  )
    return null;
  return (
    ((usage.input_tokens - usage.cached_input_tokens) *
      bill.input_usd_per_million +
      usage.cached_input_tokens *
        (bill.cached_input_usd_per_million ?? bill.input_usd_per_million) +
      usage.output_tokens * bill.output_usd_per_million) /
    1_000_000
  );
}

function restrictionStandings(
  plan: DevelopmentPlan,
  candidate: DevelopmentCandidate,
  resolution: ConfigurationResolution | undefined,
  now: Date,
): RestrictionStanding[] {
  const standings: RestrictionStanding[] = [];
  const same = (left: string, right: string) =>
    left.toLowerCase() === right.toLowerCase();
  const providerRule = plan.restrictions.provider;
  if (providerRule) {
    const catalogFact = freshFact(
      resolution,
      resolution?.stored?.snapshot.provider,
      now,
    );
    const evidence = candidate.catalog_ref
      ? catalogFact && {
          value: catalogFact.value,
          source: catalogFact.source.ref,
        }
      : candidate.provider_evidence;
    const provider = evidence?.value ?? null;
    if (providerRule.allowed) {
      const standing =
        provider === null
          ? "unknown"
          : providerRule.allowed.some((value) => same(value, provider))
            ? "satisfied"
            : "failed";
      standings.push({
        restriction: "provider_allowlist",
        standing,
        rule_values: providerRule.allowed,
        restriction_source: providerRule.source,
        evidence_source: evidence?.source ?? null,
        observed: provider,
        reason:
          standing === "unknown"
            ? "provider evidence is missing, stale, or has an ineligible source"
            : standing === "failed"
              ? "provider is outside the allowed set"
              : "provider is allowed",
      });
    }
    if (providerRule.excluded) {
      const standing =
        provider === null
          ? "unknown"
          : providerRule.excluded.some((value) => same(value, provider))
            ? "failed"
            : "satisfied";
      standings.push({
        restriction: "provider_exclusion",
        standing,
        rule_values: providerRule.excluded,
        restriction_source: providerRule.source,
        evidence_source: evidence?.source ?? null,
        observed: provider,
        reason:
          standing === "unknown"
            ? "provider evidence is missing, stale, or has an ineligible source"
            : standing === "failed"
              ? "provider is excluded"
              : "provider is not excluded",
      });
    }
  }
  const regionRule = plan.restrictions.data_region;
  if (regionRule) {
    const catalogFact = freshFact(
      resolution,
      resolution?.stored?.snapshot.data_regions,
      now,
    );
    const evidence = candidate.catalog_ref
      ? catalogFact && {
          values: [...catalogFact.value],
          source: catalogFact.source.ref,
        }
      : candidate.data_region_evidence;
    const regions = evidence?.values ?? null;
    const standing =
      regions === null
        ? "unknown"
        : regions.every((region) =>
              regionRule.allowed.some((allowed) => same(allowed, region)),
            )
          ? "satisfied"
          : "failed";
    standings.push({
      restriction: "data_region_allowlist",
      standing,
      rule_values: regionRule.allowed,
      restriction_source: regionRule.source,
      evidence_source: evidence?.source ?? null,
      observed: regions,
      reason:
        standing === "unknown"
          ? "data-region evidence is missing, stale, or has an ineligible source"
          : standing === "failed"
            ? "a processing region is outside the allowed set"
            : "all declared processing regions are allowed",
    });
  }
  for (const capability of plan.restrictions.required_capabilities ?? []) {
    const fact = freshFact(
      resolution,
      resolution?.stored?.snapshot.capabilities?.[capability],
      now,
      true,
    );
    const standing = fact ? (fact.value ? "satisfied" : "failed") : "unknown";
    standings.push({
      restriction: "capability",
      standing,
      rule_values: [capability],
      restriction_source: "development plan",
      evidence_source: fact?.source.ref ?? null,
      observed: fact?.value ?? null,
      reason:
        standing === "unknown"
          ? `capability ${capability} has no current eligible catalog fact`
          : standing === "failed"
            ? `capability ${capability} is unavailable`
            : `capability ${capability} is available`,
    });
  }
  return standings;
}

function comparison(
  plan: DevelopmentPlan,
  resolutions = new Map<string, ConfigurationResolution>(),
  now = new Date(),
): Array<{
  id: string;
  model: string;
  standing: "eligible" | "excluded" | "unknown";
  reason: string;
  expected_tokens: number;
  projected_usd: number | null;
  quality_evidence: string;
  restriction_standings: RestrictionStanding[];
  configuration: {
    id: string;
    snapshot_sha256: string;
    standing: ConfigurationResolution["status"];
    deployment_id: string | null;
    facts: {
      provider: ReturnType<typeof sourcedFact<string>>;
      data_regions: ReturnType<typeof sourcedFact<string[]>>;
      billing: ReturnType<typeof sourcedFact<ConfigurationBilling>>;
      capabilities: Record<string, ReturnType<typeof sourcedFact<boolean>>>;
    };
  } | null;
}> {
  return plan.candidates.map((candidate) => {
    const resolution = resolutions.get(candidate.id);
    const snapshot = resolution?.stored?.snapshot;
    const billing = effectiveBilling(candidate, resolution, now);
    const projected = estimate(candidate, billing);
    const restriction_standings = restrictionStandings(
      plan,
      candidate,
      resolution,
      now,
    );
    const allowed = plan.restrictions.allowed_models.includes(candidate.model);
    const overBudget =
      projected !== null &&
      plan.restrictions.max_estimated_usd !== null &&
      projected > plan.restrictions.max_estimated_usd;
    const budgetUnknown =
      projected === null && plan.restrictions.max_estimated_usd !== null;
    const configurationUnknown =
      candidate.catalog_ref &&
      (resolution?.status !== "current" || billing === undefined);
    const failedRestriction = restriction_standings.find(
      (entry) => entry.standing === "failed",
    );
    const unknownRestriction = restriction_standings.find(
      (entry) => entry.standing === "unknown",
    );
    return {
      id: candidate.id,
      model: candidate.model,
      standing:
        !allowed || overBudget || failedRestriction
          ? "excluded"
          : budgetUnknown || unknownRestriction || configurationUnknown
            ? "unknown"
            : "eligible",
      reason: !allowed
        ? "model excluded by plan"
        : overBudget
          ? "projected API cost exceeds plan limit"
          : failedRestriction
            ? failedRestriction.reason
            : configurationUnknown
              ? resolution?.status !== "current"
                ? `configuration catalog reference is ${resolution?.status ?? "missing"}`
                : "configuration billing fact is missing, stale, or has an ineligible source"
              : budgetUnknown
                ? "cash budget cannot be checked against subscription billing"
                : unknownRestriction
                  ? unknownRestriction.reason
                  : billing?.mode === "subscription"
                    ? "allowed; incremental cash cost unknown under subscription"
                    : "allowed; API cost is an estimate from declared usage and rates",
      expected_tokens:
        candidate.expected_input_tokens + candidate.expected_output_tokens,
      projected_usd: projected,
      quality_evidence: candidate.quality_evidence,
      restriction_standings,
      configuration: candidate.catalog_ref
        ? {
            id: candidate.catalog_ref.configuration_id,
            snapshot_sha256: candidate.catalog_ref.snapshot_sha256,
            standing: resolution?.status ?? "catalog_missing",
            deployment_id: snapshot?.deployment_id ?? null,
            facts: {
              provider: sourcedFact(snapshot?.provider, now),
              data_regions: sourcedFact(snapshot?.data_regions, now),
              billing: sourcedFact(snapshot?.billing, now),
              capabilities: Object.fromEntries(
                Object.entries(snapshot?.capabilities ?? {}).map(
                  ([key, fact]) => [key, sourcedFact(fact, now)],
                ),
              ),
            },
          }
        : null,
    };
  });
}

function suggestion(
  plan: DevelopmentPlan,
  resolutions = new Map<string, ConfigurationResolution>(),
  now = new Date(),
): string {
  const eligible = comparison(plan, resolutions, now).filter(
    (candidate) => candidate.standing === "eligible",
  );
  if (eligible.length === 0)
    return "No eligible candidate; revise restrictions or options.";
  const byCost = eligible.filter(
    (candidate) => candidate.projected_usd !== null,
  );
  if (byCost.length === eligible.length) {
    const lowest = [...byCost].sort(
      (a, b) => (a.projected_usd ?? 0) - (b.projected_usd ?? 0),
    )[0];
    return `Provisional cost-first option: ${lowest?.id ?? "unknown"}; projected API cost uses declared usage and rates. Task quality is not verified by this pilot.`;
  }
  if (byCost.length === 0) {
    const lowest = [...eligible].sort(
      (a, b) => a.expected_tokens - b.expected_tokens,
    )[0];
    return `Provisional allowance-use starting point: ${lowest?.id ?? "unknown"}; expected tokens are declared, cash savings and task quality are unknown.`;
  }
  return "Eligible options have different billing bases; this pilot cannot rank their total cash cost or task quality.";
}

function printRestrictionStandings(
  context: CommandContext,
  standings: readonly RestrictionStanding[],
): void {
  for (const entry of standings) {
    const observed =
      entry.observed === null
        ? "missing"
        : Array.isArray(entry.observed)
          ? entry.observed.join(", ")
          : String(entry.observed);
    context.io.stdout(
      `    ${entry.restriction}: ${entry.standing}; rule ${entry.rule_values.join(", ")} (source: ${entry.restriction_source}); observed ${observed} (evidence: ${entry.evidence_source ?? "missing"}). ${entry.reason}.\n`,
    );
  }
}

function printPlan(
  context: CommandContext,
  plan: DevelopmentPlan,
  hash: string,
  resolutions = new Map<string, ConfigurationResolution>(),
  now = new Date(),
): void {
  context.io.stdout(
    `Architecture: ${plan.architecture.id} — ${plan.architecture.summary}\n`,
  );
  context.io.stdout(`Task: ${plan.task.id} — ${plan.task.summary}\n`);
  context.io.stdout(`Plan hash: ${hash}\n`);
  for (const option of comparison(plan, resolutions, now)) {
    const cost =
      option.projected_usd === null
        ? "cash cost unknown"
        : `$${option.projected_usd.toFixed(4)} projected`;
    context.io.stdout(
      `  ${option.id}: ${option.model}; ${option.standing}; ${option.expected_tokens} expected tokens; ${cost}; quality evidence ${option.quality_evidence}. ${option.reason}\n`,
    );
    if (option.configuration)
      context.io.stdout(
        `    Configuration ${option.configuration.id}@${option.configuration.snapshot_sha256.slice(0, 12)}: ${option.configuration.standing}; deployment ${option.configuration.deployment_id ?? "unknown"}; provider ${option.configuration.facts.provider.status}, regions ${option.configuration.facts.data_regions.status}, billing ${option.configuration.facts.billing.status}.\n`,
      );
    printRestrictionStandings(context, option.restriction_standings);
  }
  context.io.stdout(`${suggestion(plan, resolutions, now)}\n`);
}

async function commandOutput(
  program: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on(
      "data",
      (chunk: Buffer) => (stdout += chunk.toString("utf8")),
    );
    child.stderr.on(
      "data",
      (chunk: Buffer) => (stderr += chunk.toString("utf8")),
    );
    child.on("error", reject);
    child.on("close", (code) =>
      resolveResult({
        code,
        stdout: code === 0 ? stdout : stderr.slice(0, 500),
      }),
    );
  });
}

async function git(root: string, args: string[]): Promise<string> {
  const result = await commandOutput("git", args, root);
  if (result.code !== 0)
    throw new Error(`Git observation failed: ${result.stdout.trim()}`);
  return result.stdout;
}

/** Extract only structured metadata. Agent messages, prompt bodies and tool arguments are discarded. */
export function collectCodexMetadata(lines: readonly string[]): {
  threadId: string | null;
  modelEvents: Array<{ event_index: number; model: string }>;
  eventCount: number;
  parseErrors: number;
  usage: TokenUsage;
} {
  let threadId: string | null = null;
  const modelEvents: Array<{ event_index: number; model: string }> = [];
  let eventCount = 0;
  let parseErrors = 0;
  const usage = zeroUsage();
  for (const line of lines) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      )
        throw new Error("not an event");
      event = parsed as Record<string, unknown>;
    } catch {
      parseErrors += 1;
      continue;
    }
    eventCount += 1;
    if (event.type === "thread.started" && typeof event.thread_id === "string")
      threadId = event.thread_id;
    if (event.type === "model.changed" && typeof event.model === "string")
      modelEvents.push({ event_index: eventCount, model: event.model });
    if (
      event.type === "turn.completed" &&
      event.usage !== null &&
      typeof event.usage === "object"
    ) {
      const values = event.usage as Record<string, unknown>;
      for (const key of Object.keys(usage) as (keyof TokenUsage)[]) {
        const value = values[key];
        if (
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0
        )
          usage[key] += value;
      }
    }
  }
  return { threadId, modelEvents, eventCount, parseErrors, usage };
}

async function runCodex(
  root: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  binary = "codex",
): Promise<{
  code: number | null;
  lines: string[];
  errorSummary: string | null;
}> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      binary,
      [
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        "workspace-write",
        "--cd",
        root,
        "--model",
        model,
        "-",
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"], signal },
    );
    const lines: string[] = [];
    let pending = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const pieces = pending.split("\n");
      pending = pieces.pop() ?? "";
      lines.push(...pieces);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (pending) lines.push(pending);
      resolveResult({
        code,
        lines,
        errorSummary:
          code === 0 ? null : sanitizeText(stderr.slice(-500)).text.trim(),
      });
    });
    child.stdin.end(prompt);
  });
}

async function runCheck(
  root: string,
  check: z.infer<typeof Check>,
): Promise<CheckResult> {
  const start = Date.now();
  let code: number | null = null;
  try {
    code = (await commandOutput(check.argv[0] ?? "", check.argv.slice(1), root))
      .code;
  } catch {
    // Keep the failed check in the run record, including missing executables.
  }
  return {
    name: check.name,
    argv: check.argv,
    exit_code: code,
    duration_ms: Date.now() - start,
  };
}

async function observedChange(
  root: string,
): Promise<{ paths: string[]; hash: string }> {
  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude).anvilmark",
  ]);
  const entries = status.split("\0").filter(Boolean);
  const paths: string[] = [];
  const untracked: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const line = entries[index] ?? "";
    const state = line.slice(0, 2);
    const path = line.slice(3);
    paths.push(path);
    if (state === "??") untracked.push(path);
    if (state.includes("R") || state.includes("C")) index += 1; // porcelain -z adds the source path
  }
  const diff = await git(root, [
    "diff",
    "--binary",
    "HEAD",
    "--",
    ".",
    ":(exclude).anvilmark",
  ]);
  const hashes: string[] = [];
  for (const path of untracked) {
    const file = resolve(root, path);
    if (!file.startsWith(`${root}/`)) continue;
    const info = await lstat(file);
    if (info.isFile() && (await realpath(file)).startsWith(`${root}/`))
      hashes.push(`${path}:${digest(await readFile(file))}`);
  }
  return { paths, hash: digest(`${diff}\n${hashes.sort().join("\n")}`) };
}

async function saveRun(root: string, run: DevelopmentRun): Promise<void> {
  await safeDirectory(root, runsDirectory(root));
  await atomicJson(join(runsDirectory(root), `${run.id}.json`), run);
}

async function loadRuns(root: string): Promise<DevelopmentRun[]> {
  let files: string[];
  try {
    files = await readdir(runsDirectory(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const runs: DevelopmentRun[] = [];
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    if ((await lstat(join(runsDirectory(root), file))).isSymbolicLink())
      throw new Error("development run cannot be a symbolic link");
    runs.push(
      JSON.parse(
        await readFile(join(runsDirectory(root), file), "utf8"),
      ) as DevelopmentRun,
    );
  }
  return runs;
}

async function loadReview(root: string, id: string): Promise<RunReview | null> {
  try {
    if (
      (await lstat(join(reviewsDirectory(root), `${id}.json`))).isSymbolicLink()
    )
      throw new Error("development review cannot be a symbolic link");
    return JSON.parse(
      await readFile(join(reviewsDirectory(root), `${id}.json`), "utf8"),
    ) as RunReview;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function archivedPlan(
  root: string,
  hash: string,
): Promise<DevelopmentPlan | null> {
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  try {
    const file = join(plansDirectory(root), `${hash}.json`);
    if ((await lstat(file)).isSymbolicLink()) return null;
    const plan = Plan.parse(JSON.parse(await readFile(file, "utf8")));
    return digest(JSON.stringify(plan)) === hash ? plan : null;
  } catch {
    return null;
  }
}

async function syncDevelopmentEvidence(root: string): Promise<{
  catalog: DevelopmentEvidenceCatalog;
  skipped: number;
  records: SelectionEvidenceRecord[];
}> {
  await safeDirectory(root);
  const catalog = await DevelopmentEvidenceCatalog.open(evidenceFile(root));
  try {
    const rows: DevelopmentEvidenceRow[] = [];
    const records: SelectionEvidenceRecord[] = [];
    let skipped = 0;
    for (const run of await loadRuns(root)) {
      const plan = await archivedPlan(root, run.plan_hash);
      const candidate = plan?.candidates.find(
        (item) =>
          item.id === run.candidate_id && item.model === run.configured_model,
      );
      if (
        !plan?.task.profile ||
        !candidate ||
        (candidate.catalog_ref &&
          run.configuration_snapshot_sha256 !==
            candidate.catalog_ref.snapshot_sha256) ||
        plan.task.id !== run.task_id ||
        plan.architecture.id !== run.architecture_id ||
        run.approval_at_start !== "current" ||
        run.approval_actor_at_start === "agent_test_operator" ||
        run.model_identity === "tool_reported_multiple" ||
        run.model_events.some((event) => event.model !== run.configured_model)
      ) {
        skipped += 1;
        continue;
      }
      const review = await loadReview(root, run.id);
      const reviewValid =
        review !== null && review.run_hash === digest(JSON.stringify(run));
      if (review?.actor === "agent_test_operator") {
        skipped += 1;
        continue;
      }
      if (review !== null && !reviewValid) {
        skipped += 1;
        continue;
      }
      const completed =
        run.agent_exit_code === 0 &&
        run.changed_paths.length > 0 &&
        run.checks.every((check) => check.exit_code === 0);
      const outcome: DevelopmentEvidenceRow["outcome"] =
        reviewValid && review?.decision === "rejected"
          ? "rejected"
          : reviewValid && completed && review?.decision !== "rejected"
            ? "accepted"
            : !completed
              ? "failed"
              : "unreviewed";
      const row: DevelopmentEvidenceRow = {
        run_id: run.id,
        run_hash: digest(JSON.stringify(run)),
        plan_hash: run.plan_hash,
        profile_key: profileKey(plan.task.profile, plan.architecture.id),
        agent: candidate.agent,
        model: candidate.model,
        configuration_key: configurationKey(candidate),
        model_identity: run.model_identity,
        outcome,
        observed_at: run.finished_at,
        billing: run.billing,
        estimated_usd: run.estimated_usd_from_observed_tokens,
        input_tokens: run.usage.input_tokens,
        output_tokens: run.usage.output_tokens,
      };
      rows.push(row);
      const elapsed =
        Date.parse(run.finished_at) - Date.parse(run.started_at);
      records.push({
        row,
        task_id: run.task_id,
        base_commit: run.base_commit,
        prompt_sha256: run.prompt_sha256,
        cached_input_tokens: run.usage.cached_input_tokens,
        elapsed_ms: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0,
        reviewed_by_human:
          reviewValid &&
          review?.actor === "interactive_local_operator" &&
          run.approval_actor_at_start === "interactive_local_operator",
      });
    }
    catalog.replaceAll(rows);
    return { catalog, skipped, records };
  } catch (error) {
    catalog.close();
    throw error;
  }
}

function recommendation(
  plan: DevelopmentPlan,
  catalog: DevelopmentEvidenceCatalog,
  records: readonly SelectionEvidenceRecord[],
  resolutions = new Map<string, ConfigurationResolution>(),
  now = new Date(),
) {
  const key =
    plan.task.profile && profileKey(plan.task.profile, plan.architecture.id);
  const options = comparison(plan, resolutions, now).map((option) => {
    const candidate = plan.candidates.find((item) => item.id === option.id);
    const rows =
      key && candidate
        ? catalog.comparable(
            key,
            candidate.agent,
            candidate.model,
            configurationKey(candidate),
          )
        : [];
    const final = rows.filter((row) => row.outcome !== "unreviewed");
    const accepted = final.filter((row) => row.outcome === "accepted").length;
    const rejected = final.filter((row) => row.outcome === "rejected").length;
    const failed = final.filter((row) => row.outcome === "failed").length;
    const sample_cost_per_accepted =
      accepted > 0 &&
      final.every(
        (row) =>
          row.billing === "api_rate_estimate" && row.estimated_usd !== null,
      )
        ? final.reduce((sum, row) => sum + (row.estimated_usd ?? 0), 0) /
          accepted
        : null;
    return {
      ...option,
      comparable: {
        accepted,
        rejected,
        failed,
        unreviewed: rows.length - final.length,
        configured_only: rows.filter(
          (row) => row.model_identity === "configured_only",
        ).length,
        sample_cost_per_accepted,
      },
    };
  });
  const eligible = options.filter((option) => option.standing === "eligible");
  const matched = matchedDevelopmentEvidence(
    eligible.map((option) => {
      const candidate = plan.candidates.find((item) => item.id === option.id)!;
      return {
        id: candidate.id,
        agent: candidate.agent,
        model: candidate.model,
        configuration_key: configurationKey(candidate),
      };
    }),
    records,
    key ?? null,
    plan.evaluation?.baseline_candidate_id ?? null,
    plan.evaluation?.max_acceptance_drop ?? 0,
  );
  const selection =
    matched.standing === "shadow_trial_candidate"
      ? `Shadow-trial candidate: ${matched.trial_candidate_id}. ${matched.reason}. The person still chooses the setup.`
      : matched.standing === "baseline_retained"
        ? `Retain fixed baseline ${matched.baseline_candidate_id} for the next shadow comparison: ${matched.reason}. The person still chooses the setup.`
      : `${suggestion(plan, resolutions, now)} No evidence-backed model choice: ${matched.reason}.`;
  return {
    profile_key: key ?? null,
    options,
    matched_evidence: matched,
    selection,
    evidence_scope:
      "same repository and architecture part; exact task kind, language set and risk",
  };
}

async function mappedResearch(plan: DevelopmentPlan, path: string | null) {
  if (path === null)
    return plan.candidates.map((candidate) => ({
      candidate_id: candidate.id,
      standing: candidate.research_mapping
        ? "catalog_not_supplied"
        : "unmapped",
      mapping: candidate.research_mapping ?? null,
      snapshot: null,
      observations: [],
    }));
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("public model catalog must be a regular existing file");
  const catalog = await openModelCatalog(path);
  try {
    return plan.candidates.map((candidate) => {
      const mapping = candidate.research_mapping;
      if (!mapping)
        return {
          candidate_id: candidate.id,
          standing: "unmapped",
          mapping: null,
          snapshot: null,
          observations: [],
        };
      const snapshot = catalog.getLatest(mapping.source_key);
      const observations = snapshot
        ? catalog
            .getObservations(snapshot.id)
            .filter((item) => item.model_id === mapping.source_model_id)
            .map((item) => ({
              kind: item.kind,
              benchmark_id: item.benchmark_id,
              score: item.score,
              verified: item.verified,
              result_source_url: item.result_source_url,
            }))
        : [];
      return {
        candidate_id: candidate.id,
        standing:
          snapshot === null
            ? "source_missing"
            : observations.length === 0
              ? "model_missing"
              : snapshot.freshness,
        mapping,
        snapshot:
          snapshot === null
            ? null
            : {
                source: snapshot.source,
                source_url: snapshot.source_url,
                fetched_at: snapshot.fetched_at,
                usage_rights: snapshot.usage_rights,
              },
        observations,
      };
    });
  } finally {
    catalog.close();
  }
}

export async function developmentCommand(
  context: CommandContext,
  sub?: string,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      file: { type: "string" },
      model: { type: "string" },
      candidate: { type: "string" },
      "prompt-file": { type: "string" },
      run: { type: "string" },
      decision: { type: "string" },
      reason: { type: "string" },
      "catalog-db": { type: "string" },
      id: { type: "string" },
      "agent-test": { type: "boolean" },
    },
    DEVELOPMENT_USAGE,
  );
  if (flag(parsed, "help") || sub === undefined) {
    context.io.stdout(`${DEVELOPMENT_USAGE}\n`);
    return sub === undefined && !flag(parsed, "help") ? EXIT.usage : EXIT.ok;
  }
  if (sub !== "catalog" && parsed.positionals.length)
    throw new UsageError("unexpected positional argument", DEVELOPMENT_USAGE);
  const root = projectDirectory(context.io, parsed);
  if (sub === "catalog") {
    const action = parsed.positionals[0];
    if (
      !["import", "list", "show", "history"].includes(action ?? "") ||
      parsed.positionals.length !== 1
    )
      throw new UsageError(
        "expected catalog import, list, show, or history",
        DEVELOPMENT_USAGE,
      );
    await safeDirectory(root);
    const catalog = await DevelopmentConfigurationCatalog.open(
      configurationFile(root),
    );
    try {
      if (action === "import") {
        const source = resolve(
          root,
          requiredOption(parsed, "file", DEVELOPMENT_USAGE),
        );
        const info = await lstat(source);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error("configuration import must be a regular file");
        const imported = DevelopmentConfigurationImport.parse(
          JSON.parse(await readFile(source, "utf8")),
        );
        const stored = catalog.importSnapshots(
          imported.configurations,
          new Date(context.io.clock()),
        );
        if (flag(parsed, "json")) writeJson(context.io, stored);
        else
          for (const entry of stored)
            context.io.stdout(
              `${entry.snapshot.id}@${entry.snapshot_sha256} · ${entry.snapshot.agent}/${entry.snapshot.model} · deployment ${entry.snapshot.deployment_id}\n`,
            );
        return EXIT.ok;
      }
      const entries =
        action === "show"
          ? [
              catalog.getLatest(
                requiredOption(parsed, "id", DEVELOPMENT_USAGE),
              ),
            ].filter((entry) => entry !== null)
          : action === "history"
            ? catalog.getHistory(
                requiredOption(parsed, "id", DEVELOPMENT_USAGE),
              )
            : catalog.listLatest();
      if ((action === "show" || action === "history") && entries.length === 0)
        throw new Error("configuration id is absent from the local catalog");
      const now = new Date(context.io.clock());
      const visible = entries.map((entry) => ({
        ...entry,
        facts: {
          provider: sourcedFact(entry.snapshot.provider, now),
          data_regions: sourcedFact(entry.snapshot.data_regions, now),
          billing: sourcedFact(entry.snapshot.billing, now),
          capabilities: Object.fromEntries(
            Object.entries(entry.snapshot.capabilities ?? {}).map(
              ([key, fact]) => [key, sourcedFact(fact, now)],
            ),
          ),
        },
      }));
      if (flag(parsed, "json")) writeJson(context.io, visible);
      else
        for (const entry of visible)
          context.io.stdout(
            `${entry.snapshot.id}@${entry.snapshot_sha256} · ${entry.snapshot.agent}/${entry.snapshot.model} · deployment ${entry.snapshot.deployment_id}; provider ${entry.facts.provider.status}, regions ${entry.facts.data_regions.status}, billing ${entry.facts.billing.status}\n`,
          );
      return EXIT.ok;
    } finally {
      catalog.close();
    }
  }
  if (sub === "plan") {
    const source = resolve(
      root,
      requiredOption(parsed, "file", DEVELOPMENT_USAGE),
    );
    const plan = Plan.parse(JSON.parse(await readFile(source, "utf8")));
    if (
      plan.evaluation &&
      !plan.candidates.some(
        (candidate) => candidate.id === plan.evaluation!.baseline_candidate_id,
      )
    )
      throw new Error("evaluation baseline candidate must be in this plan");
    if (
      new Set(plan.candidates.map((candidate) => candidate.id)).size !==
      plan.candidates.length
    )
      throw new Error("candidate ids must be unique");
    const resolutions = await resolveConfigurations(root, plan);
    for (const candidate of plan.candidates) {
      if (
        candidate.catalog_ref &&
        resolutions.get(candidate.id)?.status !== "current"
      )
        throw new Error(
          `candidate ${candidate.id} needs a current exact configuration catalog snapshot`,
        );
    }
    await safeDirectory(root);
    const hash = digest(JSON.stringify(plan));
    await safeDirectory(root, plansDirectory(root));
    await atomicJson(join(plansDirectory(root), `${hash}.json`), plan);
    await atomicJson(planFile(root), plan);
    printPlan(context, plan, hash, resolutions, new Date(context.io.clock()));
    context.io.stdout(
      "Saved local development plan. Any previous approval of different content is stale.\n",
    );
    return EXIT.ok;
  }
  if (sub === "approve") {
    const { plan, hash } = await loadPlan(root);
    const resolutions = await resolveConfigurations(root, plan);
    printPlan(context, plan, hash, resolutions, new Date(context.io.clock()));
    const agentTest = flag(parsed, "agent-test");
    if (!agentTest && !context.io.interactive)
      throw new Cancelled("Approval requires an interactive local terminal.");
    if (!agentTest) {
      const answer = await context.io.prompt(
        `Type ${hash.slice(0, 12)} to approve this architecture and task plan: `,
      );
      if (answer?.trim() !== hash.slice(0, 12))
        throw new Cancelled("Plan was not approved.");
    }
    await atomicJson(approvalFile(root), {
      plan_hash: hash,
      approved_at: context.io.clock(),
      actor: agentTest ? "agent_test_operator" : "interactive_local_operator",
    } satisfies Approval);
    context.io.stdout(
      `${agentTest ? "Test approved" : "Approved"} plan ${hash.slice(0, 12)}.\n`,
    );
    return EXIT.ok;
  }
  if (sub === "recommend") {
    const { plan, hash } = await loadPlan(root);
    const resolutions = await resolveConfigurations(root, plan);
    const { catalog, skipped, records } = await syncDevelopmentEvidence(root);
    try {
      const result = recommendation(
        plan,
        catalog,
        records,
        resolutions,
        new Date(context.io.clock()),
      );
      const research = await mappedResearch(
        plan,
        typeof parsed.values["catalog-db"] === "string"
          ? resolve(root, parsed.values["catalog-db"])
          : null,
      );
      if (flag(parsed, "json")) {
        writeJson(context.io, {
          plan_hash: hash,
          ...result,
          research,
          excluded_historical_runs: skipped,
        });
      } else {
        context.io.stdout(`Task: ${plan.task.id}. ${result.evidence_scope}.\n`);
        for (const option of result.options) {
          const sample = option.comparable;
          const mapped = research.find(
            (item) => item.candidate_id === option.id,
          );
          context.io.stdout(
            `  ${option.id}: ${option.standing}; ${sample.accepted} accepted, ${sample.rejected} rejected, ${sample.failed} failed, ${sample.unreviewed} awaiting review; ${sample.configured_only} configured-only model identities; ${sample.sample_cost_per_accepted === null ? "sample cash cost per accepted unknown" : `$${sample.sample_cost_per_accepted.toFixed(4)} estimated sample cost per accepted`}; public mapping ${mapped?.standing ?? "unmapped"} (${mapped?.observations.length ?? 0} source observations).\n`,
          );
          printRestrictionStandings(context, option.restriction_standings);
          if (mapped?.snapshot && mapped.mapping)
            context.io.stdout(
              `    Public source: ${mapped.snapshot.source_url} fetched ${mapped.snapshot.fetched_at}; rights ${mapped.snapshot.usage_rights ?? "source-specific"}. Identity: ${mapped.mapping.identity_note} Relevance: ${mapped.mapping.relevance_note}\n`,
            );
        }
        context.io.stdout(`${result.selection}\n`);
        const matched = result.matched_evidence;
        context.io.stdout(
          `Matched comparison: ${matched.matched_tasks} distinct frozen tasks; ${matched.standing}. ${matched.reason}.\n`,
        );
        for (const sample of matched.candidates)
          context.io.stdout(
            `  ${sample.candidate_id}: ${sample.accepted} accepted, ${sample.rejected} rejected, ${sample.failed} failed; ${sample.configured_only} configured-only identities; ${sample.estimated_api_usd === null ? "cash estimate unknown" : `$${sample.estimated_api_usd.toFixed(4)} total declared-rate estimate`}.\n`,
          );
        if (!result.profile_key)
          context.io.stdout(
            "Add task.profile to the plan to match local outcomes.\n",
          );
        if (skipped)
          context.io.stdout(
            `${skipped} historical runs were excluded from comparison due to approval, profile, review, identity, or test-only status.\n`,
          );
      }
      return EXIT.ok;
    } finally {
      catalog.close();
    }
  }
  if (sub === "run") {
    const { plan, hash } = await loadPlan(root);
    const resolutions = await resolveConfigurations(root, plan);
    const now = new Date(context.io.clock());
    const candidateId = parsed.values["candidate"];
    const modelOption = parsed.values["model"];
    if (candidateId && modelOption)
      throw new UsageError("choose --candidate or --model", DEVELOPMENT_USAGE);
    const matches = candidateId
      ? plan.candidates.filter((item) => item.id === candidateId)
      : plan.candidates.filter(
          (item) =>
            item.model === requiredOption(parsed, "model", DEVELOPMENT_USAGE),
        );
    if (matches.length > 1)
      throw new Error(
        "model identifies multiple candidates; use --candidate ID",
      );
    const candidate = matches[0];
    const model = candidate?.model;
    const promptPath = resolve(
      root,
      requiredOption(parsed, "prompt-file", DEVELOPMENT_USAGE),
    );
    const option = comparison(plan, resolutions, now).find(
      (entry) => entry.id === candidate?.id,
    );
    if (!candidate || !model || option?.standing !== "eligible")
      throw new Error(
        "selected candidate is absent, excluded, or has an unresolved hard restriction",
      );
    const prompt = await readFile(promptPath, "utf8");
    if (!prompt.trim()) throw new Error("prompt file is empty");
    const repositoryRoot = (
      await git(root, ["rev-parse", "--show-toplevel"])
    ).trim();
    if (repositoryRoot !== root)
      throw new Error("--project-dir must be the Git repository root");
    const baseCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
    const baseline = await observedChange(root);
    if (baseline.paths.length)
      throw new Error(
        "development pilot requires a clean repository outside .anvilmark",
      );
    const approvalRecord = await currentApproval(root, hash);
    const approval = approvalRecord ? "current" : "missing_or_stale";
    if (approval !== "current")
      context.io.stdout(
        "Architecture approval is missing or stale; this run will be marked unapproved.\n",
      );
    else if (approvalRecord?.actor === "agent_test_operator")
      context.io.stdout(
        "Agent test approval is current; this run will be excluded from model-ranking evidence.\n",
      );
    const started = context.io.clock();
    const runId = `${started.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    const execution = await runCodex(
      root,
      model,
      prompt,
      context.io.signal,
      context.io.env.ANVILMARK_CODEX_EXECUTABLE ?? "codex",
    );
    const metadata = collectCodexMetadata(execution.lines);
    const checks: CheckResult[] = [];
    for (const check of plan.task.checks)
      checks.push(await runCheck(root, check));
    const changes = await observedChange(root);
    const bill = effectiveBilling(
      candidate,
      resolutions.get(candidate.id),
      now,
    );
    if (!bill)
      throw new Error("current configuration billing fact is required");
    const modelRateApplicable = metadata.modelEvents.every(
      (event) => event.model === model,
    );
    const run: DevelopmentRun = {
      schema_version: 1,
      id: runId,
      plan_hash: hash,
      approval_at_start: approval,
      approval_actor_at_start: approvalRecord?.actor ?? null,
      architecture_id: plan.architecture.id,
      task_id: plan.task.id,
      candidate_id: candidate.id,
      configuration_snapshot_sha256:
        candidate.catalog_ref?.snapshot_sha256 ?? null,
      configured_model: model,
      model_events: metadata.modelEvents,
      model_identity:
        metadata.modelEvents.length === 0
          ? "configured_only"
          : new Set(metadata.modelEvents.map((event) => event.model)).size > 1
            ? "tool_reported_multiple"
            : "tool_reported",
      codex_thread_id: metadata.threadId,
      prompt_sha256: digest(prompt),
      started_at: started,
      finished_at: context.io.clock(),
      agent_exit_code: execution.code,
      agent_error: execution.errorSummary,
      event_count: metadata.eventCount,
      event_parse_errors: metadata.parseErrors,
      event_stream_sha256: digest(execution.lines.join("\n")),
      usage: metadata.usage,
      billing:
        bill.mode === "subscription"
          ? "subscription_allowance"
          : "api_rate_estimate",
      estimated_usd_from_observed_tokens: observedApiEstimate(
        bill,
        metadata.usage,
        modelRateApplicable,
      ),
      base_commit: baseCommit,
      baseline_clean: true,
      changed_paths: changes.paths,
      change_sha256: changes.hash,
      checks,
    };
    await saveRun(root, run);
    context.io.stdout(
      `Recorded run ${run.id}: ${run.changed_paths.length} changed paths, ${run.usage.input_tokens} input and ${run.usage.output_tokens} output tokens.\n`,
    );
    context.io.stdout(
      `Model identity: ${run.model_identity}; cash cost: ${run.estimated_usd_from_observed_tokens === null ? (bill.mode === "subscription" ? "unknown (subscription)" : !modelRateApplicable ? "unknown (reported model differs from configured rate)" : "unknown (cached-input usage or rate unavailable)") : `$${run.estimated_usd_from_observed_tokens.toFixed(4)} estimated from rates`}.\n`,
    );
    context.io.stdout(
      `Checks: ${run.checks.map((check) => `${check.name}=${check.exit_code ?? "error"}`).join(", ")}.\n`,
    );
    if (run.agent_exit_code !== 0)
      context.io.stdout(
        `Agent exited ${run.agent_exit_code ?? "without a code"}; this run did not pass.${run.agent_error ? ` ${run.agent_error}` : ""}\n`,
      );
    if (run.changed_paths.length === 0)
      context.io.stdout(
        "No code change was observed; this coding task did not pass.\n",
      );
    return run.agent_exit_code === 0 &&
      run.changed_paths.length > 0 &&
      run.checks.every((check) => check.exit_code === 0)
      ? EXIT.ok
      : EXIT.failed;
  }
  if (sub === "review") {
    const runId = requiredOption(parsed, "run", DEVELOPMENT_USAGE);
    const decision = parsed.values["decision"] ?? "accept";
    if (decision !== "accept" && decision !== "reject")
      throw new UsageError(
        "decision must be accept or reject",
        DEVELOPMENT_USAGE,
      );
    const reason =
      typeof parsed.values["reason"] === "string"
        ? parsed.values["reason"].trim()
        : undefined;
    if (decision === "reject" && !reason)
      throw new UsageError("rejection requires --reason", DEVELOPMENT_USAGE);
    if (!Id.safeParse(runId).success)
      throw new UsageError("invalid run id", DEVELOPMENT_USAGE);
    const { hash } = await loadPlan(root);
    const run = (await loadRuns(root)).find((entry) => entry.id === runId);
    if (!run) throw new Error("run not found");
    if (
      run.plan_hash !== hash ||
      run.approval_at_start !== "current" ||
      (await approvalStanding(root, hash)) !== "current"
    )
      throw new Error("run has no current architecture approval");
    if (
      decision === "accept" &&
      (run.agent_exit_code !== 0 ||
        run.changed_paths.length === 0 ||
        run.checks.some((check) => check.exit_code !== 0))
    )
      throw new Error(
        "run lacks a code change or did not complete all checks successfully",
      );
    const currentCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
    const currentChange = await observedChange(root);
    if (
      currentCommit !== run.base_commit ||
      currentChange.hash !== run.change_sha256
    )
      throw new Error(
        "repository changed since this run; review the current code first",
      );
    const agentTest = flag(parsed, "agent-test");
    if (!agentTest && !context.io.interactive)
      throw new Cancelled("Run review requires an interactive local terminal.");
    const runHash = digest(JSON.stringify(run));
    context.io.stdout(
      `Run ${run.id}: ${run.changed_paths.join(", ") || "no changed paths"}; checks ${run.checks.map((check) => `${check.name}=${check.exit_code ?? "error"}`).join(", ")}; model identity ${run.model_identity}; cash cost ${run.estimated_usd_from_observed_tokens === null ? "unknown" : "estimated only"}.\n`,
    );
    if (!agentTest) {
      const answer = await context.io.prompt(
        `Type ${runHash.slice(0, 12)} to ${decision} this exact run and code state: `,
      );
      if (answer?.trim() !== runHash.slice(0, 12))
        throw new Cancelled("Run was not reviewed.");
    }
    await safeDirectory(root, reviewsDirectory(root));
    const reviewedAt = context.io.clock();
    await atomicJson(join(reviewsDirectory(root), `${run.id}.json`), {
      run_id: run.id,
      run_hash: runHash,
      decision: decision === "accept" ? "accepted" : "rejected",
      reviewed_at: reviewedAt,
      ...(decision === "accept"
        ? { accepted_at: reviewedAt }
        : { reason: reason! }),
      actor: agentTest ? "agent_test_operator" : "interactive_local_operator",
    } satisfies RunReview);
    context.io.stdout(
      `${agentTest ? "Agent-test " : ""}${decision === "accept" ? "accepted" : "rejected"} run ${run.id}.\n`,
    );
    return EXIT.ok;
  }
  if (sub === "report") {
    const { plan, hash } = await loadPlan(root);
    const resolutions = await resolveConfigurations(root, plan);
    const now = new Date(context.io.clock());
    const approvalRecord = await currentApproval(root, hash);
    const approval = approvalRecord ? "current" : "missing_or_stale";
    const runs = await loadRuns(root);
    const reviews = await Promise.all(
      runs.map((run) => loadReview(root, run.id)),
    );
    const accepted = runs.some((_, index) => {
      const review = reviews[index];
      return (
        review !== null &&
        review !== undefined &&
        review.decision !== "rejected"
      );
    });
    const currentCommit = accepted
      ? (await git(root, ["rev-parse", "HEAD"])).trim()
      : null;
    const currentChange = accepted ? await observedChange(root) : null;
    const runSummaries = runs.map((run, index) => {
      const review = reviews[index];
      const review_status =
        review === null || review === undefined
          ? "pending"
          : review.actor === "agent_test_operator" &&
              review.run_hash === digest(JSON.stringify(run))
            ? review.decision === "rejected"
              ? "agent_test_rejected"
              : run.plan_hash === hash &&
                  approval === "current" &&
                  currentCommit === run.base_commit &&
                  currentChange?.hash === run.change_sha256
                ? "agent_test_accepted_current"
                : "agent_test_accepted_stale"
            : review.decision === "rejected" &&
                review.run_hash === digest(JSON.stringify(run))
              ? "rejected"
              : review.run_hash === digest(JSON.stringify(run)) &&
                  run.plan_hash === hash &&
                  approval === "current" &&
                  currentCommit === run.base_commit &&
                  currentChange?.hash === run.change_sha256
                ? "accepted_current"
                : "accepted_stale";
      return { ...run, review_status };
    });
    if (flag(parsed, "json")) {
      writeJson(context.io, {
        plan,
        plan_hash: hash,
        approval,
        approval_actor: approvalRecord?.actor ?? null,
        comparison: comparison(plan, resolutions, now),
        suggestion: suggestion(plan, resolutions, now),
        runs: runSummaries,
      });
      return EXIT.ok;
    }
    printPlan(context, plan, hash, resolutions, now);
    context.io.stdout(
      `Approval: ${approval}${approvalRecord?.actor === "agent_test_operator" ? " (agent test)" : ""}. Recorded runs: ${runs.length}.\n`,
    );
    for (const run of runSummaries) {
      context.io.stdout(
        `  ${run.id}: ${run.candidate_id}; approval at start ${run.approval_at_start}; agent exit ${run.agent_exit_code ?? "unknown"}; model ${run.model_identity}; tokens ${run.usage.input_tokens} in/${run.usage.output_tokens} out; changed ${run.changed_paths.join(", ") || "none"}; checks ${run.checks.map((check) => `${check.name}=${check.exit_code ?? "error"}`).join(", ")}; review ${run.review_status}; cash ${run.estimated_usd_from_observed_tokens === null ? "unknown" : `$${run.estimated_usd_from_observed_tokens.toFixed(4)} estimated`}\n`,
      );
    }
    return EXIT.ok;
  }
  throw new UsageError(
    `unknown development subcommand "${sub}"`,
    DEVELOPMENT_USAGE,
  );
}
