import type { z } from "zod/v4";

import type { ConformanceRule } from "@anvilmark/project-contract";
import {
  ConformanceRuleSchema,
  RuleSeveritySchema,
  TrustBoundarySchema,
} from "@anvilmark/project-contract";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines } from "../render.js";
import { WorkflowError, requireId } from "../workflow/edit.js";
import type { CommandContext } from "./common.js";
import {
  Cancelled,
  UsageError,
  commit,
  confirm,
  flag,
  listOption,
  openProject,
  parse,
  requiredOption,
  stringOption,
  writeJson,
} from "./common.js";

export const RULE_USAGE = `Usage:
  anvilmark rule list [--json]
  anvilmark rule add approved-candidate --id ID --workload WORKLOAD
        [--decision DECISION] [--severity error|warning]
  anvilmark rule add provider-allowlist --id ID --workload WORKLOAD
        --allow CANDIDATE[,CANDIDATE]... [--severity error|warning]
  anvilmark rule add forbid-dataflow --id ID --constraint CONSTRAINT
        --data CLASSIFICATION --to local|internal_network|remote_provider|third_party
        [--unless-through NODE]... [--severity error|warning]
  anvilmark rule remove ID          (an error-severity rule needs interactive confirmation)

Conformance rules say what "anvilmark conformance" checks:
  approved-candidate   the workload's calls use only its approved decision's candidate
                       (--decision defaults to the workload's current decision)
  provider-allowlist   the workload's calls use only the listed candidates
  forbid-dataflow      data of a classification never reaches a trust boundary,
                       unless it passes through each --unless-through node

Every reference must already exist in the contract; an invalid rule is refused
and nothing is written. Rules are not approval content, so adding or removing
one never changes an approval.`;

function schemaValue<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new WorkflowError(
      `${label} is invalid: ${result.error.issues.map((entry) => `${entry.path.map(String).join(".") || "value"}: ${entry.message}`).join("; ")}`,
    );
  }
  return result.data;
}

function describe(rule: ConformanceRule): string {
  switch (rule.kind) {
    case "approved_candidate_only":
      return `workload ${rule.workload_ref} uses only its approved candidate (decision ${rule.approved_decision_ref ?? "current"})`;
    case "provider_allowlist":
      return `workload ${rule.workload_ref} uses only ${rule.allowed_candidate_refs.join(", ")}`;
    case "forbid_dataflow":
      return `${rule.from.data_classification} never reaches ${rule.to.trust_boundary}${rule.unless === null ? "" : ` unless it passes through ${rule.unless.passes_through.map((entry) => entry.component_ref).join(", ")}`} (constraint ${rule.constraint_ref})`;
  }
}

export async function ruleCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      id: { type: "string" },
      workload: { type: "string" },
      decision: { type: "string" },
      allow: { type: "string", multiple: true },
      constraint: { type: "string" },
      data: { type: "string" },
      to: { type: "string" },
      "unless-through": { type: "string", multiple: true },
      severity: { type: "string" },
    },
    RULE_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${RULE_USAGE}\n`);
    return EXIT.ok;
  }
  const usage = RULE_USAGE;

  if (sub === "list") {
    const loaded = await openProject(context.io, parsed);
    const rules = loaded.contract.conformance_rules;
    if (flag(parsed, "json")) writeJson(context.io, rules);
    else
      context.io.stdout(
        lines(
          rules.length === 0
            ? 'No conformance rules. Add one with "anvilmark rule add".'
            : `Conformance rules (${rules.length}):`,
          rules.map(
            (rule) =>
              `  ${rule.id} [${rule.kind}, ${rule.severity}]: ${describe(rule)}`,
          ),
        ),
      );
    return EXIT.ok;
  }

  if (sub === "remove") {
    const id = parsed.positionals[0];
    if (id === undefined || id.trim() === "")
      throw new UsageError("ID is required", usage);
    const loaded = await openProject(context.io, parsed);
    const rule = loaded.contract.conformance_rules.find(
      (entry) => entry.id === id,
    );
    if (rule === undefined)
      throw new WorkflowError(`no conformance rule with id "${id}" exists`);
    if (rule.severity === "error") {
      if (!context.io.interactive)
        throw new WorkflowError(
          `removing error-severity rule "${id}" stops conformance from checking it and needs confirmation in an interactive terminal`,
        );
      const yes = await confirm(
        context.io,
        `Remove rule "${id}" (${describe(rule)})? Conformance will stop checking it.`,
      );
      if (!yes) throw new Cancelled("Not removed; nothing was written.");
    }
    await commit(
      context,
      loaded,
      {
        ...loaded.contract,
        conformance_rules: loaded.contract.conformance_rules.filter(
          (entry) => entry.id !== id,
        ),
      },
      { command: "rule remove", summary: `removed conformance rule ${id}` },
    );
    return EXIT.ok;
  }

  if (sub !== "add")
    throw new UsageError(`unknown rule subcommand "${sub ?? ""}"`, usage);
  const kind = parsed.positionals[0];
  const id = requireId(requiredOption(parsed, "id", usage), "rule id");
  const severity = schemaValue(
    RuleSeveritySchema,
    stringOption(parsed, "severity") ?? "error",
    "--severity",
  );
  const loaded = await openProject(context.io, parsed);
  const contract = loaded.contract;
  if (contract.conformance_rules.some((entry) => entry.id === id))
    throw new WorkflowError(
      `a conformance rule with id "${id}" already exists`,
    );

  let draft: Record<string, unknown>;
  if (kind === "approved-candidate") {
    const workload = requiredOption(parsed, "workload", usage);
    const known = contract.workloads.find((entry) => entry.id === workload);
    if (known === undefined)
      throw new WorkflowError(`workload "${workload}" does not exist`);
    draft = {
      id,
      kind: "approved_candidate_only",
      severity,
      workload_ref: workload,
      approved_decision_ref:
        stringOption(parsed, "decision") ?? known.current_decision_ref,
    };
  } else if (kind === "provider-allowlist") {
    const allowed = listOption(parsed, "allow");
    if (allowed.length === 0)
      throw new UsageError("--allow needs at least one candidate", usage);
    draft = {
      id,
      kind: "provider_allowlist",
      severity,
      workload_ref: requiredOption(parsed, "workload", usage),
      allowed_candidate_refs: allowed,
    };
  } else if (kind === "forbid-dataflow") {
    const through = listOption(parsed, "unless-through");
    draft = {
      id,
      kind: "forbid_dataflow",
      severity,
      constraint_ref: requiredOption(parsed, "constraint", usage),
      from: { data_classification: requiredOption(parsed, "data", usage) },
      to: {
        trust_boundary: schemaValue(
          TrustBoundarySchema,
          requiredOption(parsed, "to", usage),
          "--to",
        ),
      },
      unless:
        through.length === 0
          ? null
          : {
              passes_through: through.map((node) => ({ component_ref: node })),
            },
    };
  } else {
    throw new UsageError(
      kind === undefined
        ? "a rule kind is required: approved-candidate, provider-allowlist or forbid-dataflow"
        : `unknown rule kind "${kind}"`,
      usage,
    );
  }
  const rule = schemaValue(ConformanceRuleSchema, draft, "the rule");
  // The commit validates every reference (workload, candidates, constraint,
  // classification, nodes) against the contract and refuses the whole change.
  await commit(
    context,
    loaded,
    { ...contract, conformance_rules: [...contract.conformance_rules, rule] },
    {
      command: "rule add",
      summary: `added conformance rule ${id}: ${describe(rule)}`,
    },
  );
  return EXIT.ok;
}
