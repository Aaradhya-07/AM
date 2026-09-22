import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { attachEvidence, importManualEvidence } from "@anvilmark/adapters";
import type {
  Candidate,
  Constraint,
  ProjectContract,
  Workload,
} from "@anvilmark/project-contract";
import {
  CandidateSchema,
  ComponentKindSchema,
  ConstraintDomainSchema,
  ConstraintOperatorSchema,
  ConstraintSchema,
  HardwareSchema,
  BudgetSchema,
  OutcomeSchema,
  SoftDirectionSchema,
  UsageBasisSchema,
  WorkloadSchema,
} from "@anvilmark/project-contract";
import type { z } from "zod/v4";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { StoreError } from "../store.js";
import { standingFor, constraintsFor } from "../workflow/compare.js";
import {
  DIRECT_CANDIDATE_STATUSES,
  WorkflowError,
  addBudget,
  addBurstAssumption,
  addCandidate,
  addCandidateAssumption,
  addConstraint,
  addHardware,
  addIntentEntry,
  addOutcome,
  addWorkload,
  removeConstraint,
  requireId,
  recordConstraintResult,
  resolveQuestion,
  setCandidateDeployment,
  setCandidateModel,
  setCandidateStatus,
  setPriorityOrder,
  setSummary,
  snakeId,
  updateWorkload,
} from "../workflow/edit.js";
import type { CommandContext, Parsed } from "./common.js";
import {
  Cancelled,
  UsageError,
  commit,
  confirm,
  flag,
  listOption,
  numberOption,
  openProject,
  parse,
  requiredOption,
  stringOption,
} from "./common.js";

function schemaValue<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new WorkflowError(
      `${label} is invalid: ${result.error.issues.map((entry) => `${entry.path.join(".") || "value"}: ${entry.message}`).join("; ")}`,
    );
  }
  return result.data;
}

async function edit(
  context: CommandContext,
  parsed: Parsed,
  command: string,
  change: (
    contract: ProjectContract,
    now: string,
  ) => {
    readonly contract: ProjectContract;
    readonly summary: string;
    readonly notices?: readonly string[];
  },
): Promise<ExitCode> {
  const loaded = await openProject(context.io, parsed);
  const now = context.io.clock();
  const result = change(loaded.contract, now);
  await commit(context, loaded, result.contract, {
    command,
    summary: result.summary,
    ...(result.notices === undefined ? {} : { notices: result.notices }),
  });
  return EXIT.ok;
}

function help(context: CommandContext, parsed: Parsed, usage: string): boolean {
  if (flag(parsed, "help")) {
    context.io.stdout(`${usage}\n`);
    return true;
  }
  return false;
}

function mutabilityOption(
  parsed: Parsed,
  usage: string,
): "pinned" | "floating" | undefined {
  const value = stringOption(parsed, "model-mutability");
  if (value !== undefined && value !== "pinned" && value !== "floating") {
    throw new UsageError(
      `--model-mutability must be pinned or floating, got "${value}"`,
      usage,
    );
  }
  return value;
}

function positional(
  parsed: Parsed,
  index: number,
  label: string,
  usage: string,
): string {
  const value = parsed.positionals[index];
  if (value === undefined || value.trim() === "") {
    throw new UsageError(`${label} is required`, usage);
  }
  return value;
}

// --- intent ----------------------------------------------------------------

export const INTENT_USAGE = `Usage:
  anvilmark intent summary "TEXT"
  anvilmark intent add-user "TEXT"
  anvilmark intent add-non-goal "TEXT"
  anvilmark intent add-outcome --measure MEASURE --target "TARGET" [--id ID]
  anvilmark intent add-question "TEXT"        record an unknown explicitly
  anvilmark intent resolve-question N|"TEXT"   remove an answered question (record the answer with the matching command)`;

export async function intentCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      measure: { type: "string" },
      target: { type: "string" },
      id: { type: "string" },
    },
    INTENT_USAGE,
  );
  if (help(context, parsed, INTENT_USAGE)) return EXIT.ok;
  const text = () => positional(parsed, 0, "TEXT", INTENT_USAGE);
  switch (sub) {
    case "summary":
      return edit(context, parsed, "intent summary", (contract, now) => ({
        contract: setSummary(contract, text(), now),
        summary: "updated the intent summary",
      }));
    case "add-user":
      return edit(context, parsed, "intent add-user", (contract, now) => ({
        contract: addIntentEntry(contract, "users", text(), now),
        summary: `added user "${text()}"`,
      }));
    case "add-non-goal":
      return edit(context, parsed, "intent add-non-goal", (contract, now) => ({
        contract: addIntentEntry(contract, "non_goals", text(), now),
        summary: `added non-goal "${text()}"`,
      }));
    case "add-question":
      return edit(context, parsed, "intent add-question", (contract, now) => ({
        contract: addIntentEntry(contract, "unresolved_questions", text(), now),
        summary: `recorded unresolved question "${text()}"`,
      }));
    case "resolve-question":
      return edit(
        context,
        parsed,
        "intent resolve-question",
        (contract, now) => {
          const result = resolveQuestion(contract, text(), now);
          return {
            contract: result.contract,
            summary: `resolved question "${result.question}"`,
          };
        },
      );
    case "add-outcome": {
      const measure = requiredOption(parsed, "measure", INTENT_USAGE);
      const target = requiredOption(parsed, "target", INTENT_USAGE);
      const id = stringOption(parsed, "id") ?? snakeId(measure);
      if (id === null) {
        throw new UsageError(
          "cannot derive an outcome id; pass --id",
          INTENT_USAGE,
        );
      }
      return edit(context, parsed, "intent add-outcome", (contract, now) => ({
        contract: addOutcome(contract, { id, measure, target }, now),
        summary: `added outcome ${id}`,
      }));
    }
    default:
      throw new UsageError(
        `unknown intent subcommand "${sub ?? ""}"`,
        INTENT_USAGE,
      );
  }
}

// --- priority --------------------------------------------------------------

export const PRIORITY_USAGE = `Usage: anvilmark priority set DOMAIN[,DOMAIN...]
Domains, most important first: ${ConstraintDomainSchema.options.join(", ")}`;

export async function priorityCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(context.args, {}, PRIORITY_USAGE);
  if (help(context, parsed, PRIORITY_USAGE)) return EXIT.ok;
  if (sub !== "set") {
    throw new UsageError(
      `unknown priority subcommand "${sub ?? ""}"`,
      PRIORITY_USAGE,
    );
  }
  const domains = parsed.positionals
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (domains.length === 0) {
    throw new UsageError("at least one domain is required", PRIORITY_USAGE);
  }
  return edit(context, parsed, "priority set", (contract, now) => ({
    contract: setPriorityOrder(contract, domains, now),
    summary: `set priority order ${domains.join(" > ")}`,
  }));
}

// --- workloads -------------------------------------------------------------

export const WORKLOAD_USAGE = `Usage:
  anvilmark workload add --id ID --name NAME --input CLASSIFICATION
        --output plain_text|cited_text|ranked_document_refs|json_schema [--output-schema PATH]
        [--output-classification LABEL]
        [--calls-per-month N [--usage-basis user_assumption|measured|vendor_claim|agent_inference]]
        [--input-tokens N] [--output-tokens N] [--reasoning-tokens N]
        [--latency-percentile p50|p90|p95|p99 --latency-max-ms N]
        [--quality-gate METRIC:MINIMUM:EVALUATION_REF]...
        [--fallback degrade|queue|human_handoff|fail_closed:"DESCRIPTION"]
  anvilmark workload usage ID (--calls-per-month N [--usage-basis BASIS] | --unknown)
        [--input-tokens N] [--output-tokens N] [--reasoning-tokens N]
  anvilmark workload output-classification ID (LABEL | --unknown)
  anvilmark workload burst --workload ID --peak-calls-per-minute N [--note "TEXT"]

Without --calls-per-month the monthly volume is recorded as unknown
(calls_per_month: null, basis: unknown); it is never guessed or read as zero, and
projected cost and token comparisons for the workload stay unknown until it is
supplied. --output-classification is the data classification of what the workload
produces, e.g. customer_reply_draft; omitted, it is recorded as not declared (null),
which means unknown, not "not sensitive". The input classification and the output
format are still required.`;

/** Expected usage from options: unknown unless a volume is given. */
function usageFromOptions(
  parsed: Parsed,
  usage: string,
): { readonly calls_per_month: number | null; readonly basis: string } {
  const calls = numberOption(parsed, "calls-per-month", usage);
  const basis = stringOption(parsed, "usage-basis");
  if (calls === undefined) {
    if (basis !== undefined && basis !== "unknown") {
      throw new UsageError(
        `--usage-basis ${basis} describes a volume, so it needs --calls-per-month`,
        usage,
      );
    }
    return { calls_per_month: null, basis: "unknown" };
  }
  if (basis === "unknown") {
    throw new UsageError(
      "--usage-basis unknown cannot be combined with --calls-per-month; omit the volume to record it as unknown",
      usage,
    );
  }
  return { calls_per_month: calls, basis: basis ?? "user_assumption" };
}

function tokenChanges(parsed: Parsed, usage: string) {
  return {
    input: numberOption(parsed, "input-tokens", usage),
    output: numberOption(parsed, "output-tokens", usage),
    reasoning: numberOption(parsed, "reasoning-tokens", usage),
  };
}

export async function workloadCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      id: { type: "string" },
      name: { type: "string" },
      input: { type: "string" },
      output: { type: "string" },
      "output-schema": { type: "string" },
      "calls-per-month": { type: "string" },
      "usage-basis": { type: "string" },
      "output-classification": { type: "string" },
      unknown: { type: "boolean" },
      "input-tokens": { type: "string" },
      "output-tokens": { type: "string" },
      "reasoning-tokens": { type: "string" },
      "latency-percentile": { type: "string" },
      "latency-max-ms": { type: "string" },
      "quality-gate": { type: "string", multiple: true },
      fallback: { type: "string" },
      workload: { type: "string" },
      "peak-calls-per-minute": { type: "string" },
      note: { type: "string" },
    },
    WORKLOAD_USAGE,
  );
  if (help(context, parsed, WORKLOAD_USAGE)) return EXIT.ok;
  const usage = WORKLOAD_USAGE;

  if (sub === "burst") {
    const workload = requiredOption(parsed, "workload", usage);
    const peak = numberOption(parsed, "peak-calls-per-minute", usage);
    if (peak === undefined) {
      throw new UsageError("--peak-calls-per-minute is required", usage);
    }
    return edit(context, parsed, "workload burst", (contract, now) => ({
      contract: addBurstAssumption(
        contract,
        {
          workload,
          peakCallsPerMinute: peak,
          note: stringOption(parsed, "note") ?? null,
        },
        now,
      ),
      summary: `recorded burst assumption for ${workload} (informational throughput constraint)`,
    }));
  }
  if (sub === "usage") {
    const id = positional(parsed, 0, "ID", usage);
    const unknown = flag(parsed, "unknown");
    if (unknown === (parsed.values["calls-per-month"] !== undefined)) {
      throw new UsageError(
        "give exactly one of --calls-per-month N or --unknown",
        usage,
      );
    }
    if (unknown && parsed.values["usage-basis"] !== undefined) {
      throw new UsageError("--unknown takes no --usage-basis", usage);
    }
    const expected = usageFromOptions(parsed, usage);
    const tokens = tokenChanges(parsed, usage);
    return edit(context, parsed, "workload usage", (contract, now) => ({
      contract: updateWorkload(
        contract,
        id,
        (workload) => {
          workload.expected_usage = {
            ...workload.expected_usage,
            calls_per_month: expected.calls_per_month,
            basis: expected.basis as Workload["expected_usage"]["basis"],
            ...(tokens.input === undefined
              ? {}
              : { input_tokens_per_call: tokens.input }),
            ...(tokens.output === undefined
              ? {}
              : { output_tokens_per_call: tokens.output }),
            ...(tokens.reasoning === undefined
              ? {}
              : { reasoning_tokens_per_call: tokens.reasoning }),
          };
        },
        now,
      ),
      summary:
        expected.calls_per_month === null
          ? `recorded monthly usage of ${id} as unknown`
          : `set monthly usage of ${id} to ${expected.calls_per_month} calls (${expected.basis})`,
    }));
  }
  if (sub === "output-classification") {
    const id = positional(parsed, 0, "ID", usage);
    const label = parsed.positionals[1];
    const unknown = flag(parsed, "unknown");
    if (unknown === (label !== undefined)) {
      throw new UsageError("give exactly one of LABEL or --unknown", usage);
    }
    return edit(
      context,
      parsed,
      "workload output-classification",
      (contract, now) => ({
        contract: updateWorkload(
          contract,
          id,
          (workload) => {
            workload.output_classification = unknown ? null : (label ?? null);
          },
          now,
        ),
        summary: unknown
          ? `recorded the output classification of ${id} as not declared (unknown)`
          : `set the output classification of ${id} to ${label}`,
      }),
    );
  }
  if (sub !== "add") {
    throw new UsageError(`unknown workload subcommand "${sub ?? ""}"`, usage);
  }
  if (parsed.values.unknown !== undefined) {
    throw new UsageError(
      "workload add takes no --unknown: omit --calls-per-month to record usage as unknown",
      usage,
    );
  }

  const expected = usageFromOptions(parsed, usage);
  const output = requiredOption(parsed, "output", usage);
  const outputContract =
    output === "json_schema"
      ? {
          kind: "json_schema",
          ref: requiredOption(parsed, "output-schema", usage),
        }
      : { kind: output };
  const percentile = stringOption(parsed, "latency-percentile");
  const maxMs = numberOption(parsed, "latency-max-ms", usage);
  if ((percentile === undefined) !== (maxMs === undefined)) {
    throw new UsageError(
      "--latency-percentile and --latency-max-ms go together",
      usage,
    );
  }
  const gates = listOption(parsed, "quality-gate").map((entry) => {
    const [metric, minimum, evaluationRef] = entry.split(":");
    if (
      metric === undefined ||
      minimum === undefined ||
      evaluationRef === undefined ||
      !Number.isFinite(Number(minimum))
    ) {
      throw new UsageError(
        `--quality-gate "${entry}" must be METRIC:MINIMUM:EVALUATION_REF`,
        usage,
      );
    }
    return { metric, minimum: Number(minimum), evaluation_ref: evaluationRef };
  });
  const fallbackRaw = stringOption(parsed, "fallback");
  const fallback =
    fallbackRaw === undefined
      ? null
      : (() => {
          const index = fallbackRaw.indexOf(":");
          if (index < 0) {
            throw new UsageError("--fallback must be KIND:DESCRIPTION", usage);
          }
          return {
            kind: fallbackRaw.slice(0, index),
            description: fallbackRaw.slice(index + 1),
          };
        })();
  const workload: Workload = schemaValue(
    WorkloadSchema,
    {
      id: requireId(requiredOption(parsed, "id", usage), "workload id"),
      name: requiredOption(parsed, "name", usage),
      input_classification: requiredOption(parsed, "input", usage),
      output_classification:
        stringOption(parsed, "output-classification") ?? null,
      output_contract: outputContract,
      expected_usage: {
        basis: schemaValue(UsageBasisSchema, expected.basis, "--usage-basis"),
        calls_per_month: expected.calls_per_month,
        input_tokens_per_call:
          numberOption(parsed, "input-tokens", usage) ?? null,
        output_tokens_per_call:
          numberOption(parsed, "output-tokens", usage) ?? null,
        reasoning_tokens_per_call:
          numberOption(parsed, "reasoning-tokens", usage) ?? null,
      },
      latency:
        percentile === undefined ? null : { percentile, maximum_ms: maxMs },
      quality_gates: gates,
      fallback,
      current_decision_ref: null,
    },
    "workload",
  );
  return edit(context, parsed, "workload add", (contract, now) => ({
    contract: addWorkload(contract, workload, now),
    summary: `added workload ${workload.id}`,
    notices: [
      ...(workload.expected_usage.calls_per_month === null
        ? [
            `monthly usage of ${workload.id} is recorded as unknown; projected cost and token comparisons for it stay unknown until "anvilmark workload usage ${workload.id} --calls-per-month N" supplies a volume`,
          ]
        : []),
      ...(workload.output_classification === null
        ? [
            `the output data classification of ${workload.id} is not declared (unknown); set it with "anvilmark workload output-classification ${workload.id} LABEL"`,
          ]
        : []),
    ],
  }));
}

// --- constraints -----------------------------------------------------------

export const CONSTRAINT_USAGE = `Usage:
  anvilmark constraint add --id ID --domain DOMAIN --severity hard|soft|informational
        [--direction minimize|maximize|target]   (required for soft, refused otherwise)
        --subject SUBJECT --operator OPERATOR --value VALUE
        [--condition "WHEN"] [--rationale "WHY"]
  anvilmark constraint remove ID     (a hard constraint needs interactive confirmation)

Domains: ${ConstraintDomainSchema.options.join(", ")}
Operators: ${ConstraintOperatorSchema.options.join(", ")}
Subjects name what is constrained, e.g. workload.classification.metric.macro_f1,
data.raw_customer_ticket or project.ai_effective_cost_monthly_usd.
VALUE is read as a number or true/false when it looks like one; for in/not_in it is a comma list.`;

function constraintValue(raw: string, operator: string): Constraint["value"] {
  const scalar = (value: string): string | number => {
    const trimmed = value.trim();
    return trimmed !== "" && Number.isFinite(Number(trimmed))
      ? Number(trimmed)
      : trimmed;
  };
  if (operator === "in" || operator === "not_in") {
    return raw.split(",").map(scalar);
  }
  if (raw === "true" || raw === "false") return raw === "true";
  return scalar(raw);
}

export async function constraintCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      id: { type: "string" },
      domain: { type: "string" },
      severity: { type: "string" },
      direction: { type: "string" },
      subject: { type: "string" },
      operator: { type: "string" },
      value: { type: "string" },
      condition: { type: "string" },
      rationale: { type: "string" },
    },
    CONSTRAINT_USAGE,
  );
  if (help(context, parsed, CONSTRAINT_USAGE)) return EXIT.ok;
  const usage = CONSTRAINT_USAGE;

  if (sub === "remove") {
    const id = positional(parsed, 0, "ID", usage);
    const loaded = await openProject(context.io, parsed);
    const now = context.io.clock();
    const result = removeConstraint(loaded.contract, id, now);
    if (result.removed.severity === "hard") {
      if (!context.io.interactive) {
        throw new WorkflowError(
          `removing hard constraint "${id}" weakens the contract and needs confirmation in an interactive terminal`,
        );
      }
      const yes = await confirm(
        context.io,
        `Remove HARD constraint "${id}" (${result.removed.subject} ${result.removed.operator} ${JSON.stringify(result.removed.value)})? This weakens the contract.`,
      );
      if (!yes) {
        throw new Cancelled("Not removed; nothing was written.");
      }
    }
    await commit(context, loaded, result.contract, {
      command: "constraint remove",
      summary: `removed ${result.removed.severity} constraint ${id}`,
    });
    return EXIT.ok;
  }
  if (sub !== "add") {
    throw new UsageError(`unknown constraint subcommand "${sub ?? ""}"`, usage);
  }
  const severity = requiredOption(parsed, "severity", usage);
  const direction = stringOption(parsed, "direction");
  if (severity === "soft" && direction === undefined) {
    throw new UsageError("a soft constraint needs --direction", usage);
  }
  if (severity !== "soft" && direction !== undefined) {
    throw new UsageError(
      "--direction applies only to soft constraints; hard constraints are gates and informational ones are not scored",
      usage,
    );
  }
  const operator = requiredOption(parsed, "operator", usage);
  const constraint = schemaValue(
    ConstraintSchema,
    {
      id: requireId(requiredOption(parsed, "id", usage), "constraint id"),
      domain: requiredOption(parsed, "domain", usage),
      severity,
      ...(direction === undefined
        ? {}
        : {
            direction: schemaValue(
              SoftDirectionSchema,
              direction,
              "--direction",
            ),
          }),
      subject: requiredOption(parsed, "subject", usage),
      operator,
      value: constraintValue(requiredOption(parsed, "value", usage), operator),
      source: "user",
      rationale: stringOption(parsed, "rationale") ?? null,
      condition: stringOption(parsed, "condition") ?? null,
      exceptions: [],
    },
    "constraint",
  );
  return edit(context, parsed, "constraint add", (contract, now) => ({
    contract: addConstraint(contract, constraint, now),
    summary: `added ${constraint.severity} constraint ${constraint.id}`,
  }));
}

// --- resources -------------------------------------------------------------

export const HARDWARE_USAGE = `Usage:
  anvilmark hardware add --id ID --cpu-cores N [--cpu-model MODEL] --ram-gb N
        --os linux|macos|windows|other [--backend cuda|metal|rocm|cpu|...]
        [--accelerator VENDOR:MODEL:VRAM_GB[:COUNT]]...
Records hardware you DECLARE you own or plan to use (user_declared, tier T1).`;

export async function hardwareCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      id: { type: "string" },
      "cpu-cores": { type: "string" },
      "cpu-model": { type: "string" },
      "ram-gb": { type: "string" },
      os: { type: "string" },
      backend: { type: "string" },
      accelerator: { type: "string", multiple: true },
    },
    HARDWARE_USAGE,
  );
  if (help(context, parsed, HARDWARE_USAGE)) return EXIT.ok;
  if (sub !== "add") {
    throw new UsageError(
      `unknown hardware subcommand "${sub ?? ""}"`,
      HARDWARE_USAGE,
    );
  }
  const usage = HARDWARE_USAGE;
  const accelerators = (
    Array.isArray(parsed.values.accelerator) ? parsed.values.accelerator : []
  ).map((entry) => {
    const [vendor, model, vram, count] = entry.split(":");
    if (vendor === undefined || model === undefined || vram === undefined) {
      throw new UsageError(
        `--accelerator "${entry}" must be VENDOR:MODEL:VRAM_GB[:COUNT]`,
        usage,
      );
    }
    return {
      vendor,
      model,
      vram_gb: Number(vram),
      count: count === undefined ? 1 : Number(count),
    };
  });
  const hardware = schemaValue(
    HardwareSchema,
    {
      id: requireId(requiredOption(parsed, "id", usage), "hardware id"),
      evidence_kind: "user_declared",
      cpu: {
        cores: numberOption(parsed, "cpu-cores", usage),
        model: stringOption(parsed, "cpu-model") ?? null,
      },
      ram_gb: numberOption(parsed, "ram-gb", usage),
      accelerators,
      backend: stringOption(parsed, "backend") ?? null,
      operating_system: requiredOption(parsed, "os", usage),
      evidence_refs: [],
    },
    "hardware",
  );
  return edit(context, parsed, "hardware add", (contract, now) => ({
    contract: addHardware(contract, hardware, now),
    summary: `declared hardware ${hardware.id}`,
  }));
}

export const BUDGET_USAGE = `Usage:
  anvilmark budget add --currency USD --period day|month|year --amount N --scope SCOPE
SCOPE is lower_snake_case, e.g. ai_inference_and_ai_specific_infrastructure.`;

export async function budgetCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      currency: { type: "string" },
      period: { type: "string" },
      amount: { type: "string" },
      scope: { type: "string" },
    },
    BUDGET_USAGE,
  );
  if (help(context, parsed, BUDGET_USAGE)) return EXIT.ok;
  if (sub !== "add") {
    throw new UsageError(
      `unknown budget subcommand "${sub ?? ""}"`,
      BUDGET_USAGE,
    );
  }
  const budget = schemaValue(
    BudgetSchema,
    {
      currency: requiredOption(parsed, "currency", BUDGET_USAGE),
      period: requiredOption(parsed, "period", BUDGET_USAGE),
      amount: numberOption(parsed, "amount", BUDGET_USAGE),
      scope: requiredOption(parsed, "scope", BUDGET_USAGE),
    },
    "budget",
  );
  return edit(context, parsed, "budget add", (contract, now) => ({
    contract: addBudget(contract, budget, now),
    summary: `declared budget ${budget.amount} ${budget.currency}/${budget.period} for ${budget.scope}`,
  }));
}

// --- candidates ------------------------------------------------------------

export const CANDIDATE_USAGE = `Usage:
  anvilmark candidate add --id ID [--workload ID] --component-kind KIND
        --mode local|managed_api|self_hosted [--runtime R] [--hardware ID]
        [--provider P] [--region R]
        [--model FAMILY [--model-version V --model-mutability pinned|floating] [--quantization Q]]
  anvilmark candidate model ID [--model FAMILY] [--model-version V] [--model-mutability pinned|floating]
        [--quantization Q]
  anvilmark candidate assume ID "ASSUMPTION"
  anvilmark candidate deploy ID [--runtime R] [--hardware ID] [--provider P] [--region R]
  anvilmark candidate status ID discovered|unevaluated|incompatible|rejected|unavailable|viable
  anvilmark candidate result ID --constraint ID --status pass|fail|unknown|not_applicable
        [--evidence EVIDENCE_ID]... [--explanation "TEXT"] [--determinism deterministic|inferred]

A model version needs an explicit --model-mutability: "pinned" only when V names an
immutable artifact (an exact release or digest), "floating" for an alias such as
"latest" that can change underneath. A model with no version is always floating.
"candidate model" requires --model-mutability again whenever the family or the
version changes, because a pin describes one exact family@version; re-stating the
same identity or changing only --quantization keeps the existing choice. Changing
the family clears licence evidence recorded for the old family.
Candidates proposed by an intelligence are recorded floating until you confirm
otherwise with "candidate model".

New candidates start "discovered". "viable" is refused unless every relevant hard
constraint passes on admissible, current evidence. A "pass" result is refused unless
its evidence meets the ratified floor.
Component kinds: ${ComponentKindSchema.options.join(", ")}`;

export async function candidateCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      id: { type: "string" },
      workload: { type: "string" },
      "component-kind": { type: "string" },
      mode: { type: "string" },
      runtime: { type: "string" },
      hardware: { type: "string" },
      provider: { type: "string" },
      region: { type: "string" },
      model: { type: "string" },
      "model-version": { type: "string" },
      "model-mutability": { type: "string" },
      quantization: { type: "string" },
      constraint: { type: "string" },
      status: { type: "string" },
      evidence: { type: "string", multiple: true },
      explanation: { type: "string" },
      determinism: { type: "string" },
    },
    CANDIDATE_USAGE,
  );
  if (help(context, parsed, CANDIDATE_USAGE)) return EXIT.ok;
  const usage = CANDIDATE_USAGE;
  const optional = (name: string) => stringOption(parsed, name) ?? null;

  switch (sub) {
    case "add": {
      const mode = requiredOption(parsed, "mode", usage);
      const family = stringOption(parsed, "model");
      const version = stringOption(parsed, "model-version");
      const mutability = mutabilityOption(parsed, usage);
      if (
        family === undefined &&
        (version !== undefined ||
          mutability !== undefined ||
          parsed.values.quantization !== undefined)
      ) {
        throw new UsageError(
          "--model-version, --model-mutability and --quantization need --model",
          usage,
        );
      }
      if (version !== undefined && mutability === undefined) {
        throw new UsageError(
          `--model-version "${version}" needs --model-mutability pinned|floating: a version string alone does not establish that it names an immutable artifact`,
          usage,
        );
      }
      if (version === undefined && mutability === "pinned") {
        throw new UsageError(
          "--model-mutability pinned needs --model-version: a model without an exact version is floating",
          usage,
        );
      }
      const deployment =
        mode === "local"
          ? {
              mode,
              runtime: optional("runtime"),
              hardware_ref: optional("hardware"),
            }
          : mode === "managed_api"
            ? {
                mode,
                provider: optional("provider"),
                region: optional("region"),
              }
            : {
                mode,
                provider: optional("provider"),
                region: optional("region"),
                runtime: optional("runtime"),
              };
      const candidate: Candidate = schemaValue(
        CandidateSchema,
        {
          id: requireId(requiredOption(parsed, "id", usage), "candidate id"),
          workload_ref: optional("workload"),
          component_kind: requiredOption(parsed, "component-kind", usage),
          model:
            family === undefined
              ? null
              : {
                  family,
                  version: version ?? null,
                  version_mutability: mutability ?? "floating",
                  quantization: optional("quantization"),
                  license_evidence_ref: null,
                },
          deployment,
          measurements: {},
          estimates: {},
          constraint_results: [],
          status: "discovered",
        },
        "candidate",
      );
      return edit(context, parsed, "candidate add", (contract, now) => ({
        contract: addCandidate(contract, candidate, now),
        summary: `added candidate ${candidate.id} (discovered)`,
        notices:
          family !== undefined && (mutability ?? "floating") === "floating"
            ? [
                `model "${family}"${version === undefined ? " has no version and" : ` version "${version}"`} is recorded as floating: the artifact it names can change without this contract changing`,
              ]
            : [],
      }));
    }
    case "model": {
      const id = positional(parsed, 0, "ID", usage);
      const change = {
        ...(parsed.values.model === undefined
          ? {}
          : { family: stringOption(parsed, "model") as string }),
        ...(parsed.values["model-version"] === undefined
          ? {}
          : { version: stringOption(parsed, "model-version") as string }),
        ...(parsed.values["model-mutability"] === undefined
          ? {}
          : {
              mutability: mutabilityOption(parsed, usage) as
                "pinned" | "floating",
            }),
        ...(parsed.values.quantization === undefined
          ? {}
          : { quantization: stringOption(parsed, "quantization") as string }),
      };
      if (Object.keys(change).length === 0) {
        throw new UsageError(
          "give at least one of --model, --model-version, --model-mutability or --quantization",
          usage,
        );
      }
      return edit(context, parsed, "candidate model", (contract, now) => {
        const result = setCandidateModel(contract, id, change, now);
        const model = result.contract.candidates.find(
          (entry) => entry.id === id,
        )?.model;
        return {
          contract: result.contract,
          summary: `set model of ${id} to ${model?.family}${model?.version === null ? " (no version)" : `@${model?.version}`} [${model?.version_mutability}]${model?.quantization === null ? "" : `, quantization ${model?.quantization}`}`,
          notices: result.notices,
        };
      });
    }
    case "assume": {
      const id = positional(parsed, 0, "ID", usage);
      const assumption = positional(parsed, 1, "ASSUMPTION", usage);
      return edit(context, parsed, "candidate assume", (contract, now) => ({
        contract: addCandidateAssumption(contract, id, assumption, now),
        summary: `recorded an operating assumption for ${id}`,
      }));
    }
    case "deploy": {
      const id = positional(parsed, 0, "ID", usage);
      const change: Parameters<typeof setCandidateDeployment>[2] = {
        ...(parsed.values.runtime === undefined
          ? {}
          : { runtime: optional("runtime") }),
        ...(parsed.values.hardware === undefined
          ? {}
          : { hardwareRef: optional("hardware") }),
        ...(parsed.values.provider === undefined
          ? {}
          : { provider: optional("provider") }),
        ...(parsed.values.region === undefined
          ? {}
          : { region: optional("region") }),
      };
      return edit(context, parsed, "candidate deploy", (contract, now) => ({
        contract: setCandidateDeployment(contract, id, change, now),
        summary: `updated deployment of ${id}`,
      }));
    }
    case "status": {
      const id = positional(parsed, 0, "ID", usage);
      const status = positional(parsed, 1, "STATUS", usage);
      return edit(context, parsed, "candidate status", (contract, now) => {
        if (status === "viable") {
          const candidate = contract.candidates.find(
            (entry) => entry.id === id,
          );
          if (candidate === undefined) {
            throw new WorkflowError(`candidate "${id}" does not exist`);
          }
          const open = constraintsFor(contract, candidate)
            .filter((constraint) => constraint.severity === "hard")
            .map((constraint) =>
              standingFor(contract, constraint, candidate, now),
            )
            .filter(
              (standing) =>
                standing.outcome !== "pass" &&
                standing.outcome !== "not_applicable",
            );
          const hardCount = constraintsFor(contract, candidate).filter(
            (constraint) => constraint.severity === "hard",
          ).length;
          if (open.length > 0 || hardCount === 0) {
            throw new WorkflowError(
              hardCount === 0
                ? `candidate "${id}" cannot be marked viable: no hard constraint applies to it, so nothing establishes viability`
                : `candidate "${id}" cannot be marked viable while hard constraints are not satisfied:\n  - ${open.map((entry) => `${entry.constraint_ref}: ${entry.outcome}`).join("\n  - ")}`,
            );
          }
        } else if (
          !(DIRECT_CANDIDATE_STATUSES as readonly string[]).includes(status)
        ) {
          throw new WorkflowError(
            `candidate status "${status}" is not set by hand; use ${DIRECT_CANDIDATE_STATUSES.join(", ")} or viable`,
          );
        }
        return {
          contract: setCandidateStatus(
            contract,
            id,
            status as Candidate["status"],
            now,
          ),
          summary: `set ${id} status to ${status}`,
        };
      });
    }
    case "result": {
      const id = positional(parsed, 0, "ID", usage);
      const constraintRef = requiredOption(parsed, "constraint", usage);
      const status = schemaValue(
        OutcomeSchema,
        requiredOption(parsed, "status", usage),
        "--status",
      );
      return edit(context, parsed, "candidate result", (contract, now) => ({
        contract: recordConstraintResult(
          contract,
          id,
          {
            constraint_ref: constraintRef,
            status,
            evidence_refs: listOption(parsed, "evidence"),
            determinism: (stringOption(parsed, "determinism") ??
              "deterministic") as "deterministic" | "inferred",
            explanation: optional("explanation"),
            evaluated_at: now,
          },
          now,
        ),
        summary: `recorded ${status} for ${constraintRef} on ${id}`,
      }));
    }
    default:
      throw new UsageError(
        `unknown candidate subcommand "${sub ?? ""}"`,
        usage,
      );
  }
}

// --- evidence ----------------------------------------------------------------

export const EVIDENCE_USAGE = `Usage: anvilmark evidence import FILE
FILE holds one manual import request, or an array of them, in the
@anvilmark/adapters manual-import shape (pricing, licence, residency,
provider_capability, model_documentation). A fact without both a publisher and a
source locator is recorded as a vendor claim (T1), not official evidence.`;

export async function evidenceCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(context.args, {}, EVIDENCE_USAGE);
  if (help(context, parsed, EVIDENCE_USAGE)) return EXIT.ok;
  if (sub !== "import") {
    throw new UsageError(
      `unknown evidence subcommand "${sub ?? ""}"`,
      EVIDENCE_USAGE,
    );
  }
  const file = positional(parsed, 0, "FILE", EVIDENCE_USAGE);
  let document: unknown;
  try {
    document = JSON.parse(
      await readFile(resolve(context.io.cwd, file), "utf8"),
    );
  } catch {
    throw new WorkflowError(`"${file}" is not a readable JSON file`);
  }
  const requests = Array.isArray(document) ? document : [document];
  const loaded = await openProject(context.io, parsed);
  const records = [];
  const diagnostics: string[] = [];
  for (const [index, request] of requests.entries()) {
    const outcome = importManualEvidence(request, { clock: context.io.clock });
    if (outcome.standing !== "available") {
      throw new WorkflowError(
        `import request ${index + 1} was rejected: ${outcome.errors.map((entry) => entry.message).join("; ")}`,
      );
    }
    records.push(outcome.value.record);
    diagnostics.push(
      ...outcome.diagnostics.map(
        (entry) => `${outcome.value.record.id}: ${entry}`,
      ),
    );
  }
  const attached = attachEvidence(loaded.contract, records);
  if (!attached.ok) {
    throw new StoreError(
      "the evidence could not be attached; nothing was written",
      attached.issues,
    );
  }
  await commit(context, loaded, attached.value, {
    command: "evidence import",
    summary: `imported evidence ${records.map((entry) => `${entry.id} (${entry.kind})`).join(", ")}`,
    notices: diagnostics,
  });
  return EXIT.ok;
}
