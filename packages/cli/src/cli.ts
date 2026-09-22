import { hardwareCommand } from "./commands/hardware.js";
import {
  ARCHITECTURE_USAGE,
  GENERATE_USAGE,
  architectureCommand,
  generateCommand,
} from "./commands/architecture.js";
import {
  decisionCommand,
  APPROVE_USAGE,
  approvalCommand,
  approveCommand,
  compareCommand,
  reviewCommand,
} from "./commands/decision.js";
import type { CommandContext } from "./commands/common.js";
import {
  CONFORMANCE_USAGE,
  conformanceCommand,
} from "./commands/conformance.js";
import { SCAN_USAGE, scanCommand } from "./commands/scan.js";
import { CLI_VERSION } from "./version.js";
import { exportCommand } from "./commands/export.js";
import { INVENTORY_USAGE, inventoryCommand } from "./commands/inventory.js";
import { LOGIN_USAGE, loginCommand } from "./commands/login.js";
import { PUSH_USAGE, pushCommand } from "./commands/push.js";
import { RULE_USAGE, ruleCommand } from "./commands/rule.js";
import { reportError } from "./commands/common.js";
import {
  budgetCommand,
  candidateCommand,
  constraintCommand,
  evidenceCommand,
  intentCommand,
  priorityCommand,
  workloadCommand,
} from "./commands/edit.js";
import { elicitCommand } from "./commands/elicit.js";
import {
  intelligenceCommand,
  proposeCommand,
} from "./commands/intelligence.js";
import {
  historyCommand,
  initCommand,
  statusCommand,
  validateCommand,
} from "./commands/project.js";
import type { CliIo, ExitCode } from "./io.js";
import { EXIT } from "./io.js";
import { APPROVAL_LIMIT_STATEMENT } from "./render.js";
import type { StoreFs } from "./store.js";

export const USAGE = `anvilmark — local decision and conformance contracts for AI systems

Usage: anvilmark <command> [options]      (anvilmark <command> --help for details)

Inventory (no project needed; writes nothing)
  inventory       list the AI providers, models and call sites a repository uses

Start
  init            create .anvilmark/ from an idea, a repository reference, or a contract file
  status          what is recorded, what is unknown, what is not yet provided
  validate        validate the project contract (or any file with --file)
  history         committed state revisions and provenance; resolve an ambiguous revision

Describe the project
  elicit          answer structured questions section by section
  intent          summary, users, outcomes, non-goals, unresolved questions
  workload        separate workloads, usage and burst assumptions
  constraint      hard, soft and informational constraints
  priority        tie-breaking order of constraint domains
  hardware        hardware declarations, bounded probing, sizing and explicit attachment
  budget          budgets you declare
  candidate       alternatives, assumptions, deployment, results
  evidence        import attributable facts (pricing, licence, residency, ...)

Intelligence (optional; never an ANVILMARK model)
  intelligence    list or select a mechanism: none, handoff, or a host-registered provider
  propose         preview, send, export or import a structured proposal

Architecture and generated context
  architecture    declare nodes, relationships, trust boundaries and decision bindings
  generate        write Mermaid, CALM 1.2 and agent context from the contract; --check for freshness

Repository mapping (local only; observations, not conformance results)
  scan            scan a TypeScript/JavaScript repository; scan show to inspect, --check for freshness

Conformance loop (local deterministic compliance results)
  rule            add, list or remove the conformance rules conformance checks
  conformance     evaluate repository compliance against contract; --check for freshness
  check           alias for conformance
  export          assemble standalone Web Review Bundle for ANVILMARK Studio

Cloud Console & Telemetry (local-first; transmits verification hashes, never source)
  login           authenticate with ANVILMARK Cloud Console
  push            transmit contract verification hashes and conformance telemetry

Decide
  compare         alternatives side by side, with evidence gaps and no overall score
  decision        draft, propose, revise or reject a decision
  review          the exact content and hash an approval would cover
  approve         interactive approval of one exact decision revision
  approval        approval status and history

Global options: --project-dir DIR (-C), --json where supported, --help
Exit codes: 0 ok, 1 refused or failed, 2 usage error, 3 cancelled or declined

${APPROVAL_LIMIT_STATEMENT}`;

const GROUPED = new Set([
  "history",
  "intent",
  "workload",
  "constraint",
  "priority",
  "hardware",
  "budget",
  "candidate",
  "evidence",
  "intelligence",
  "propose",
  "decision",
  "approval",
  "architecture",
  "scan",
  "conformance",
  "check",
  "rule",
  "login",
  "push",
]);

/**
 * Run one command. Never throws: every failure becomes output and an exit code.
 */
export async function run(
  argv: readonly string[],
  io: CliIo,
  options: { readonly storeFs?: StoreFs } = {},
): Promise<ExitCode> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    io.stdout(`${USAGE}\n`);
    return command === undefined ? EXIT.usage : EXIT.ok;
  }
  if (command === "help") {
    const topic = rest[0];
    if (topic === undefined) {
      io.stdout(`${USAGE}\n`);
      return EXIT.ok;
    }
    return run([topic, "--help"], io, options);
  }
  if (command === "--version") {
    io.stdout(`anvilmark ${CLI_VERSION}\n`);
    return EXIT.ok;
  }

  const grouped = GROUPED.has(command);
  const sub =
    grouped && rest[0] !== undefined && !rest[0].startsWith("-")
      ? rest[0]
      : undefined;
  const context: CommandContext = {
    io,
    args: grouped && sub !== undefined ? rest.slice(1) : rest,
    ...(options.storeFs === undefined ? {} : { storeFs: options.storeFs }),
  };

  try {
    switch (command) {
      case "init":
        return await initCommand(context);
      case "status":
        return await statusCommand(context);
      case "validate":
        return await validateCommand(context);
      case "history":
        return await historyCommand(context, sub);
      case "elicit":
        return await elicitCommand(context);
      case "intent":
        return await intentCommand(context, sub);
      case "workload":
        return await workloadCommand(context, sub);
      case "constraint":
        return await constraintCommand(context, sub);
      case "priority":
        return await priorityCommand(context, sub);
      case "hardware":
        return await hardwareCommand(context, sub);
      case "budget":
        return await budgetCommand(context, sub);
      case "candidate":
        return await candidateCommand(context, sub);
      case "evidence":
        return await evidenceCommand(context, sub);
      case "intelligence":
        return await intelligenceCommand(context, sub);
      case "propose":
        return await proposeCommand(context, sub);
      case "compare":
        return await compareCommand(context);
      case "decision":
        return await decisionCommand(context, sub);
      case "review":
        return await reviewCommand(context);
      case "approve":
        return await approveCommand(context);
      case "approval":
        return await approvalCommand(context, sub);
      case "architecture":
        return await architectureCommand(context, sub);
      case "generate":
        return await generateCommand(context);
      case "inventory":
        return await inventoryCommand(context);
      case "rule":
        return await ruleCommand(context, sub);
      case "scan":
        return await scanCommand(context, sub);
      case "conformance":
      case "check":
        return await conformanceCommand(context, rest);
      case "export":
        return await exportCommand(context, rest);
      case "login":
        return await loginCommand(context, sub);
      case "push":
        return await pushCommand(context);
      default:
        io.stderr(`error: unknown command "${command}"\n\n${USAGE}\n`);
        return EXIT.usage;
    }
  } catch (error) {
    return reportError(io, error);
  }
}

export {
  APPROVE_USAGE,
  ARCHITECTURE_USAGE,
  CONFORMANCE_USAGE,
  GENERATE_USAGE,
  INVENTORY_USAGE,
  LOGIN_USAGE,
  PUSH_USAGE,
  RULE_USAGE,
  SCAN_USAGE,
};
