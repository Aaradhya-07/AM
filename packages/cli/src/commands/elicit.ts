import type { Constraint, ProjectContract } from "@anvilmark/project-contract";
import {
  CandidateSchema,
  ConstraintDomainSchema,
  ConstraintOperatorSchema,
  ConstraintSchema,
  HardwareSchema,
  BudgetSchema,
  WorkloadSchema,
  validateProjectContract,
} from "@anvilmark/project-contract";

import type { CliIo, ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines, renderIssues } from "../render.js";
import type { LoadedProject } from "../store.js";
import { StoreError, loadProject } from "../store.js";
import { draftDecision } from "../workflow/decisions.js";
import {
  WorkflowError,
  addBudget,
  addBurstAssumption,
  addCandidate,
  addConstraint,
  addHardware,
  addIntentEntry,
  addOutcome,
  addWorkload,
  setPriorityOrder,
  setSummary,
  snakeId,
} from "../workflow/edit.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  commit,
  flag,
  openProject,
  parse,
  stringOption,
} from "./common.js";

export const ELICIT_USAGE = `Usage: anvilmark elicit [--section NAME] [--project-dir DIR]

Asks structured questions one section at a time and saves each completed section
as its own state revision. At any prompt:
  Enter  skip (nothing is recorded)
  ?      unknown: the question is recorded in intent.unresolved_questions
Ctrl-C or end of input stops; sections already saved are kept.

Sections: ${[
  "purpose",
  "users",
  "outcomes",
  "non-goals",
  "workloads",
  "constraints",
  "priority",
  "hardware",
  "budgets",
  "decisions",
  "questions",
].join(", ")}`;

class Stop extends Error {}

type Answer =
  { kind: "skip" } | { kind: "unknown" } | { kind: "value"; value: string };

async function ask(io: CliIo, question: string): Promise<Answer> {
  const raw = await io.prompt(question);
  if (raw === null) {
    throw new Stop();
  }
  const value = raw.trim();
  if (value === "") return { kind: "skip" };
  if (value === "?") return { kind: "unknown" };
  return { kind: "value", value };
}

interface Session {
  readonly io: CliIo;
  contract: ProjectContract;
  readonly now: string;
  /** Unknowns noted during the section, recorded with it. */
  readonly unknowns: string[];
}

function unknown(session: Session, question: string): void {
  if (
    !session.contract.intent.unresolved_questions.includes(question) &&
    !session.unknowns.includes(question)
  ) {
    session.unknowns.push(question);
  }
}

function attempt(
  session: Session,
  change: () => ProjectContract,
  label: string,
): void {
  try {
    const next = change();
    // Each answer is validated as it is recorded, so one invalid entry is
    // refused on its own instead of costing the whole section.
    const validated = validateProjectContract(next);
    if (!validated.ok) {
      session.io.stdout(
        lines(`  not recorded (${label}):`, renderIssues(validated.issues)),
      );
      return;
    }
    session.contract = next;
  } catch (error) {
    const message =
      error instanceof WorkflowError ? error.message : String(error);
    session.io.stdout(`  not recorded (${label}): ${message}\n`);
  }
}

function schemaProblem(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}): string {
  return (result.error?.issues ?? [])
    .map((entry) => `${entry.path.join(".") || "value"}: ${entry.message}`)
    .join("; ");
}

async function listSection(
  session: Session,
  field: "users" | "non_goals",
  question: string,
  unknownQuestion: string,
): Promise<void> {
  const answer = await ask(session.io, question);
  if (answer.kind === "unknown") unknown(session, unknownQuestion);
  if (answer.kind !== "value") return;
  for (const entry of answer.value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    attempt(
      session,
      () => addIntentEntry(session.contract, field, entry, session.now),
      entry,
    );
  }
}

const SECTIONS: Record<string, (session: Session) => Promise<void>> = {
  async purpose(session) {
    session.io.stdout(`Current purpose: ${session.contract.intent.summary}\n`);
    const answer = await ask(
      session.io,
      "Purpose, in your own words (Enter keeps it): ",
    );
    if (answer.kind === "value") {
      attempt(
        session,
        () => setSummary(session.contract, answer.value, session.now),
        "purpose",
      );
    }
  },

  async users(session) {
    await listSection(
      session,
      "users",
      "Who will use it? Comma-separated roles, e.g. support_agent: ",
      "Who are the users of this application?",
    );
  },

  async outcomes(session) {
    for (;;) {
      const measure = await ask(
        session.io,
        "Outcome to measure, e.g. median_handle_time (Enter when done): ",
      );
      if (measure.kind === "skip") return;
      if (measure.kind === "unknown") {
        unknown(session, "Which measurable outcomes define success?");
        return;
      }
      const target = await ask(
        session.io,
        `Target for ${measure.value}, e.g. "<= 8 minutes": `,
      );
      if (target.kind !== "value") {
        unknown(session, `What target should ${measure.value} meet?`);
        continue;
      }
      const id = snakeId(measure.value);
      if (id === null) {
        session.io.stdout("  not recorded: that measure has no usable id\n");
        continue;
      }
      attempt(
        session,
        () =>
          addOutcome(
            session.contract,
            { id, measure: measure.value, target: target.value },
            session.now,
          ),
        measure.value,
      );
    }
  },

  async "non-goals"(session) {
    await listSection(
      session,
      "non_goals",
      "What is explicitly out of scope? Comma-separated: ",
      "What is explicitly out of scope for this application?",
    );
  },

  async workloads(session) {
    session.io.stdout(
      "Describe each separate AI workload (for example redaction, classification, drafting).\n",
    );
    for (;;) {
      const name = await ask(session.io, "Workload name (Enter when done): ");
      if (name.kind === "skip") return;
      if (name.kind === "unknown") {
        unknown(
          session,
          "Which separate AI workloads does the application need?",
        );
        return;
      }
      const suggested = snakeId(name.value);
      const idAnswer = await ask(
        session.io,
        `Workload id${suggested === null ? "" : ` [${suggested}]`}: `,
      );
      const id = idAnswer.kind === "value" ? idAnswer.value : suggested;
      if (id === null) {
        session.io.stdout("  not recorded: a workload needs an id\n");
        continue;
      }
      const input = await ask(
        session.io,
        "Input data classification, lower_snake_case, e.g. raw_customer_ticket: ",
      );
      if (input.kind !== "value") {
        unknown(
          session,
          `What data does workload "${name.value}" receive (its input classification)?`,
        );
        session.io.stdout(
          "  not recorded yet: the input classification is required\n",
        );
        continue;
      }
      const output = await ask(
        session.io,
        "Output: plain_text, cited_text, ranked_document_refs or json_schema: ",
      );
      if (output.kind !== "value") {
        unknown(session, `What output must workload "${name.value}" produce?`);
        session.io.stdout(
          "  not recorded yet: the output contract is required\n",
        );
        continue;
      }
      let outputContract: Record<string, unknown> = { kind: output.value };
      if (output.value === "json_schema") {
        const ref = await ask(session.io, "Relative path of the JSON schema: ");
        if (ref.kind !== "value") {
          unknown(
            session,
            `Where is the output JSON schema for workload "${name.value}"?`,
          );
          session.io.stdout(
            "  not recorded yet: a json_schema output needs its path\n",
          );
          continue;
        }
        outputContract = { kind: "json_schema", ref: ref.value };
      }
      const outputLabel = await ask(
        session.io,
        "Output data classification, lower_snake_case, e.g. customer_reply_draft (Enter if not declared): ",
      );
      if (outputLabel.kind === "unknown") {
        unknown(
          session,
          `What data classification does the output of workload "${name.value}" have?`,
        );
      }
      const calls = await ask(
        session.io,
        "Expected calls per month (a number; Enter or ? if unknown): ",
      );
      const knownCalls =
        calls.kind === "value" && Number.isFinite(Number(calls.value))
          ? Number(calls.value)
          : null;
      if (knownCalls === null) {
        // Amendment 6: the workload is kept, with its volume explicitly unknown.
        session.io.stdout(
          `  monthly usage ${calls.kind === "value" ? `"${calls.value}" is not a number, so it is` : "is"} recorded as unknown; cost and token comparisons stay unknown until it is supplied\n`,
        );
      }
      const basis =
        knownCalls === null
          ? ({ kind: "value", value: "unknown" } as const)
          : await ask(
              session.io,
              "Is that a user_assumption, measured or vendor_claim? [user_assumption]: ",
            );
      const tokens = async (label: string): Promise<number | null> => {
        const answer = await ask(
          session.io,
          `${label} per call (Enter if unknown): `,
        );
        return answer.kind === "value" && Number.isFinite(Number(answer.value))
          ? Number(answer.value)
          : null;
      };
      const inputTokens = await tokens("Input tokens");
      const outputTokens = await tokens("Output tokens");
      const latency = await ask(
        session.io,
        "Latency requirement as PERCENTILE MAX_MS, e.g. p95 1000 (Enter if none): ",
      );
      const [percentile, maxMs] =
        latency.kind === "value"
          ? latency.value.split(/\s+/)
          : [undefined, undefined];
      const document = {
        id,
        name: name.value,
        input_classification: input.value,
        output_classification:
          outputLabel.kind === "value" ? outputLabel.value : null,
        output_contract: outputContract,
        expected_usage: {
          basis: basis.kind === "value" ? basis.value : "user_assumption",
          calls_per_month: knownCalls,
          input_tokens_per_call: inputTokens,
          output_tokens_per_call: outputTokens,
        },
        latency:
          percentile === undefined
            ? null
            : { percentile, maximum_ms: Number(maxMs) },
      };
      const parsed = WorkloadSchema.safeParse(document);
      if (!parsed.success) {
        session.io.stdout(`  not recorded: ${schemaProblem(parsed)}\n`);
        continue;
      }
      attempt(
        session,
        () => addWorkload(session.contract, parsed.data, session.now),
        id,
      );
      const burst = await ask(
        session.io,
        "Peak calls per minute during bursts (Enter to skip, ? if unknown): ",
      );
      if (burst.kind === "unknown") {
        unknown(session, `What burst load must workload "${id}" handle?`);
      } else if (burst.kind === "value") {
        attempt(
          session,
          () =>
            addBurstAssumption(
              session.contract,
              {
                workload: id,
                peakCallsPerMinute: Number(burst.value),
                note: null,
              },
              session.now,
            ),
          "burst",
        );
      }
    }
  },

  async constraints(session) {
    session.io.stdout(
      `Constraints: latency, quality, privacy, residency, provider policy, licence, budget, hardware, availability...\nDomains: ${ConstraintDomainSchema.options.join(", ")}\n`,
    );
    for (;;) {
      const domain = await ask(
        session.io,
        "Constraint domain (Enter when done): ",
      );
      if (domain.kind === "skip") return;
      if (domain.kind === "unknown") {
        unknown(
          session,
          "Which constraints (privacy, residency, budget, latency, ...) apply?",
        );
        return;
      }
      const severity = await ask(
        session.io,
        "Severity: hard (a gate), soft (a preference) or informational (recorded only): ",
      );
      if (severity.kind !== "value") {
        unknown(
          session,
          `How strict is the ${domain.value} constraint (hard, soft or informational)?`,
        );
        continue;
      }
      let direction: string | undefined;
      if (severity.value === "soft") {
        const answer = await ask(
          session.io,
          "Direction: minimize, maximize or target: ",
        );
        if (answer.kind !== "value") {
          unknown(
            session,
            `Should the ${domain.value} preference be minimized, maximized or targeted?`,
          );
          continue;
        }
        direction = answer.value;
      }
      const subject = await ask(
        session.io,
        "Subject, e.g. workload.classification.latency_p95_ms or data.raw_customer_ticket: ",
      );
      const operator = await ask(
        session.io,
        `Operator (${ConstraintOperatorSchema.options.join(", ")}): `,
      );
      const value = await ask(session.io, "Value: ");
      if (
        subject.kind !== "value" ||
        operator.kind !== "value" ||
        value.kind !== "value"
      ) {
        unknown(
          session,
          `What exactly does the ${severity.value} ${domain.value} constraint require?`,
        );
        continue;
      }
      const rationale = await ask(session.io, "Why (optional): ");
      const base = snakeId(subject.value) ?? "constraint";
      let id = `${domain.value}.${base}`;
      for (
        let n = 2;
        session.contract.constraints.some((entry) => entry.id === id);
        n += 1
      ) {
        id = `${domain.value}.${base}_${n}`;
      }
      const numeric = Number(value.value);
      const parsed = ConstraintSchema.safeParse({
        id,
        domain: domain.value,
        severity: severity.value,
        ...(direction === undefined ? {} : { direction }),
        subject: subject.value,
        operator: operator.value,
        value:
          value.value === "true" || value.value === "false"
            ? value.value === "true"
            : Number.isFinite(numeric)
              ? numeric
              : value.value,
        source: "user",
        rationale: rationale.kind === "value" ? rationale.value : null,
      });
      if (!parsed.success) {
        session.io.stdout(`  not recorded: ${schemaProblem(parsed)}\n`);
        continue;
      }
      const constraint: Constraint = parsed.data;
      attempt(
        session,
        () => addConstraint(session.contract, constraint, session.now),
        id,
      );
      session.io.stdout(`  recorded ${constraint.severity} constraint ${id}\n`);
    }
  },

  async priority(session) {
    const answer = await ask(
      session.io,
      "Priority order for trade-offs, most important first, comma-separated domains: ",
    );
    if (answer.kind === "unknown")
      unknown(
        session,
        "Which constraint domains matter most when they conflict?",
      );
    if (answer.kind !== "value") return;
    const domains = answer.value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    attempt(
      session,
      () => setPriorityOrder(session.contract, domains, session.now),
      "priority",
    );
  },

  async hardware(session) {
    for (;;) {
      const id = await ask(
        session.io,
        "Declare a machine you own or plan to use: hardware id, e.g. hardware.gpu_box (Enter when done): ",
      );
      if (id.kind === "skip") return;
      if (id.kind === "unknown") {
        unknown(
          session,
          "What hardware is available for local inference, if any?",
        );
        return;
      }
      const cores = await ask(session.io, "CPU cores: ");
      const ram = await ask(session.io, "RAM in GB: ");
      const os = await ask(
        session.io,
        "Operating system (linux, macos, windows, other): ",
      );
      const backend = await ask(
        session.io,
        "Inference backend, e.g. cuda, metal, cpu (Enter if unknown): ",
      );
      const accelerators = await ask(
        session.io,
        "Accelerators as VENDOR:MODEL:VRAM_GB[:COUNT], comma-separated (Enter for none): ",
      );
      if (
        cores.kind !== "value" ||
        ram.kind !== "value" ||
        os.kind !== "value"
      ) {
        unknown(
          session,
          `What are the CPU, RAM and operating system of "${id.value}"?`,
        );
        continue;
      }
      const parsed = HardwareSchema.safeParse({
        id: id.value,
        evidence_kind: "user_declared",
        cpu: { cores: Number(cores.value) },
        ram_gb: Number(ram.value),
        operating_system: os.value,
        backend: backend.kind === "value" ? backend.value : null,
        accelerators:
          accelerators.kind === "value"
            ? accelerators.value.split(",").map((entry) => {
                const [vendor, model, vram, count] = entry.trim().split(":");
                return {
                  vendor,
                  model,
                  vram_gb: Number(vram),
                  count: count === undefined ? 1 : Number(count),
                };
              })
            : [],
      });
      if (!parsed.success) {
        session.io.stdout(`  not recorded: ${schemaProblem(parsed)}\n`);
        continue;
      }
      attempt(
        session,
        () => addHardware(session.contract, parsed.data, session.now),
        id.value,
      );
    }
  },

  async budgets(session) {
    for (;;) {
      const amount = await ask(session.io, "Budget amount (Enter when done): ");
      if (amount.kind === "skip") return;
      if (amount.kind === "unknown") {
        unknown(
          session,
          "What budget applies to AI inference and infrastructure?",
        );
        return;
      }
      const currency = await ask(session.io, "Currency (ISO code, e.g. USD): ");
      const period = await ask(session.io, "Period (day, month, year): ");
      const scope = await ask(
        session.io,
        "What it covers, lower_snake_case, e.g. ai_inference_and_ai_specific_infrastructure: ",
      );
      const parsed = BudgetSchema.safeParse({
        amount: Number(amount.value),
        currency: currency.kind === "value" ? currency.value : undefined,
        period: period.kind === "value" ? period.value : undefined,
        scope: scope.kind === "value" ? scope.value : undefined,
      });
      if (!parsed.success) {
        unknown(
          session,
          `What currency, period and scope does the ${amount.value} budget have?`,
        );
        session.io.stdout(`  not recorded: ${schemaProblem(parsed)}\n`);
        continue;
      }
      attempt(
        session,
        () => addBudget(session.contract, parsed.data, session.now),
        "budget",
      );
    }
  },

  async decisions(session) {
    session.io.stdout(
      "Record decisions that are already made. Each becomes a DRAFT decision; nothing is approved here.\n",
    );
    for (let index = 1; ; index += 1) {
      const workload = await ask(
        session.io,
        "Workload id the decision is for (Enter when done): ",
      );
      if (workload.kind === "skip") return;
      if (workload.kind === "unknown") {
        unknown(
          session,
          "Which architecture decisions have already been made?",
        );
        return;
      }
      const mode = await ask(
        session.io,
        "Deployment: local, managed_api or self_hosted: ",
      );
      const where = await ask(
        session.io,
        "Runtime (local) or provider (managed/self-hosted) (Enter if not chosen): ",
      );
      const family = await ask(
        session.io,
        "Model family (Enter if not chosen): ",
      );
      const why = await ask(session.io, "Why was this decided? ");
      if (mode.kind !== "value" || why.kind !== "value") {
        unknown(
          session,
          `What was decided for workload "${workload.value}", and why?`,
        );
        continue;
      }
      const place = where.kind === "value" ? where.value : null;
      const candidateId = `candidate.${workload.value}.declared_${index}`;
      const parsed = CandidateSchema.safeParse({
        id: candidateId,
        workload_ref: workload.value,
        component_kind: "model_runtime",
        model:
          family.kind === "value"
            ? {
                family: family.value,
                version: null,
                version_mutability: "floating",
              }
            : null,
        deployment:
          mode.value === "local"
            ? { mode: "local", runtime: place }
            : { mode: mode.value, provider: place },
        status: "discovered",
      });
      if (!parsed.success) {
        session.io.stdout(`  not recorded: ${schemaProblem(parsed)}\n`);
        continue;
      }
      attempt(
        session,
        () => {
          const withCandidate = addCandidate(
            session.contract,
            parsed.data,
            session.now,
          );
          return draftDecision(
            withCandidate,
            {
              id: `decision.${workload.value}.declared_${index}`,
              scope: { kind: "workload", workload_ref: workload.value },
              selectedCandidate: candidateId,
              alternatives: [],
              satisfies: [],
              unresolved: [],
              evidence: [],
              rationale: { summary: why.value, generated_by: null },
            },
            session.now,
          );
        },
        candidateId,
      );
    }
  },

  async questions(session) {
    session.io.stdout("Anything still unknown? One question per line.\n");
    for (;;) {
      const answer = await ask(session.io, "Question (Enter when done): ");
      if (answer.kind !== "value") return;
      unknown(session, answer.value);
    }
  },
};

export const SECTION_NAMES = Object.keys(SECTIONS);

export async function elicitCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    { section: { type: "string" } },
    ELICIT_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${ELICIT_USAGE}\n`);
    return EXIT.ok;
  }
  const only = stringOption(parsed, "section");
  if (only !== undefined && !SECTION_NAMES.includes(only)) {
    throw new UsageError(`unknown section "${only}"`, ELICIT_USAGE);
  }
  let loaded: LoadedProject = await openProject(context.io, parsed);
  const io = context.io;
  io.stdout(
    lines(
      `Eliciting ${loaded.contract.project.name}. Enter skips, ? records an unknown, Ctrl-C stops.`,
      "Each completed section is saved as its own state revision.",
    ),
  );
  let saved = 0;
  for (const name of only === undefined ? SECTION_NAMES : [only]) {
    io.stdout(`\n== ${name} ==\n`);
    const session: Session = {
      io,
      contract: loaded.contract,
      now: io.clock(),
      unknowns: [],
    };
    try {
      await SECTIONS[name]?.(session);
    } catch (error) {
      if (error instanceof Stop) {
        io.stdout(
          lines(
            "",
            `Stopped. ${saved} section(s) were saved; the "${name}" section in progress was not.`,
          ),
        );
        return EXIT.cancelled;
      }
      throw error;
    }
    for (const question of session.unknowns) {
      attempt(
        session,
        () =>
          addIntentEntry(
            session.contract,
            "unresolved_questions",
            question,
            session.now,
          ),
        "question",
      );
    }
    if (session.contract === loaded.contract) {
      continue;
    }
    try {
      await commit(context, loaded, session.contract, {
        command: "elicit",
        summary: `elicited ${name}${session.unknowns.length === 0 ? "" : ` (${session.unknowns.length} unknown(s) recorded)`}`,
      });
      saved += 1;
      loaded = await loadProject(loaded.paths.root);
    } catch (error) {
      if (error instanceof StoreError) {
        io.stdout(
          lines(
            `  the ${name} section was not saved: ${error.message}`,
            renderIssues(error.issues),
          ),
        );
        continue;
      }
      throw error;
    }
  }
  io.stdout(
    lines("", `Done. ${saved} section(s) saved. See: anvilmark status`),
  );
  return EXIT.ok;
}
