import { randomBytes } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";

import type {
  AdapterOutcome,
  BuiltIntelligenceRequest,
  IntelligenceAdapter,
  IntelligenceProposal,
  IntelligenceRequest,
  IntelligenceTask,
  OutboundConsentRecord,
  OutboundDisclosure,
} from "@anvilmark/adapters";
import {
  INTELLIGENCE_TASKS,
  buildHandoffDocument,
  buildIntelligenceRequest,
  createHandoffAdapter,
  createOpenAiCompatibleAdapter,
  createOutboundConsentStore,
  describeHandoffDisclosure,
  describeProviderDisclosure,
  adapterError,
  notAvailable,
  sanitizeStructured,
  sanitizeText,
} from "@anvilmark/adapters";

import { loadHostConfig } from "../host.js";
import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines, renderDisclosure } from "../render.js";
import type { LoadedProject } from "../store.js";
import { readJson, writeRecord } from "../store.js";
import {
  WorkflowError,
  selectIntelligence,
  selectedIntelligence,
} from "../workflow/edit.js";
import { applyProposal } from "../workflow/proposal.js";
import type { CommandContext, Parsed } from "./common.js";
import {
  Cancelled,
  UsageError,
  commit,
  confirm,
  flag,
  openProject,
  parse,
  stringOption,
  writeJson,
} from "./common.js";

export const INTELLIGENCE_USAGE = `Usage:
  anvilmark intelligence list              built-in mechanisms and host-registered providers
  anvilmark intelligence select ID         none | handoff | a registered provider id

Mechanisms:
  none      no intelligence; every deterministic command still works
  handoff   a structured request file for Claude Code, Codex or any agent you run;
            the agent writes a response file that you import. ANVILMARK sends nothing.
  PROVIDER  an OpenAI-compatible chat-completions endpoint registered in HOST
            configuration (never in the project): a local runtime such as Ollama,
            or a remote API. Remote providers need interactive consent per request.

Host configuration: $ANVILMARK_CONFIG_HOME/host.json, else
$XDG_CONFIG_HOME/anvilmark/host.json, else ~/.config/anvilmark/host.json:
  {
    "format": "anvilmark-host/0.1",
    "intelligence_providers": [
      { "id": "ollama-local", "mechanism": "openai_compatible",
        "base_url": "http://127.0.0.1:11434/v1", "model": "MODEL",
        "reach": "local", "cost": "no_provider_charge" },
      { "id": "my-api", "mechanism": "openai_compatible",
        "base_url": "https://api.example.com/v1", "model": "MODEL",
        "reach": "remote", "credential_env": "MY_API_KEY", "cost": "may_incur_cost" }
    ]
  }
credential_env names an environment variable; its value is read when sending and
is never written to the project, the history or the output.`;

export const PROPOSE_USAGE = `Usage:
  anvilmark propose preview --task TASK [--via ID] [--json]   show exactly what would be sent; sends nothing
  anvilmark propose send    --task TASK [--via PROVIDER_ID]   ask a registered provider
  anvilmark propose export  --task TASK                       write a handoff request for your agent
  anvilmark propose import  REQUEST_ID [--response FILE]      validate and apply your agent's response

Tasks: ${INTELLIGENCE_TASKS.join(", ")}
--via defaults to the project's selected mechanism.
A response can only PROPOSE constraints, candidates, questions and inferences. It is
validated as a whole; if any part is refused, nothing changes. Accepted content is
saved as a new state revision with its provenance.`;

function taskOption(parsed: Parsed): IntelligenceTask {
  const task = stringOption(parsed, "task");
  if (task === undefined) {
    throw new UsageError("--task is required", PROPOSE_USAGE);
  }
  if (!(INTELLIGENCE_TASKS as readonly string[]).includes(task)) {
    throw new UsageError(
      `--task must be one of ${INTELLIGENCE_TASKS.join(", ")}`,
      PROPOSE_USAGE,
    );
  }
  return task as IntelligenceTask;
}

function recordId(prefix: string, now: string): string {
  const stamp = now.replace(/[-:]/g, "").replace(/\.\d+/, "");
  return `${prefix}-${stamp}-${randomBytes(4).toString("hex")}`;
}

function projectRelative(loaded: LoadedProject, path: string): string {
  return relative(loaded.paths.root, path).split(sep).join("/");
}

async function hostFor(context: CommandContext, loaded: LoadedProject) {
  return loadHostConfig({
    env: context.io.env,
    homedir: context.io.homedir,
    projectRoot: loaded.paths.root,
  });
}

export async function intelligenceCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(context.args, {}, INTELLIGENCE_USAGE);
  if (flag(parsed, "help") || sub === undefined) {
    context.io.stdout(`${INTELLIGENCE_USAGE}\n`);
    return sub === undefined && !flag(parsed, "help") ? EXIT.usage : EXIT.ok;
  }
  const loaded = await openProject(context.io, parsed);
  const host = await hostFor(context, loaded);
  const selected = selectedIntelligence(loaded.contract);

  if (sub === "list") {
    const providers = [...host.providers.values()].map((provider) => ({
      id: provider.registration.id,
      reach: provider.registration.reach,
      destination: provider.destination,
      model: provider.registration.model,
      cost: provider.registration.cost,
      credential_env: provider.registration.credential_env,
    }));
    if (flag(parsed, "json")) {
      writeJson(context.io, {
        selected,
        host_config: host.path,
        host_config_exists: host.exists,
        problems: host.problems,
        providers,
      });
      return EXIT.ok;
    }
    context.io.stdout(
      lines(
        `Selected: ${selected}`,
        "Built in:",
        "  none      no intelligence; the deterministic workflow does not need one",
        "  handoff   request/response files for an agent you run (Claude Code, Codex, ...)",
        `Host configuration: ${host.path}${host.exists ? "" : " (not present: no providers registered, nothing remote can run)"}`,
        providers.length === 0
          ? "  no registered providers"
          : providers.map(
              (entry) =>
                `  ${entry.id}  ${entry.reach}  ${entry.destination}  model ${entry.model}  cost ${entry.cost}${entry.credential_env === null ? "" : `  credential $${entry.credential_env}`}`,
            ),
        host.problems.map((problem) => `  problem: ${problem}`),
      ),
    );
    return EXIT.ok;
  }

  if (sub === "select") {
    const id = parsed.positionals[0];
    if (id === undefined) {
      throw new UsageError("ID is required", INTELLIGENCE_USAGE);
    }
    if (id !== "none" && id !== "handoff" && !host.providers.has(id)) {
      throw new WorkflowError(
        `"${id}" is not registered in host configuration ${host.path}; projects cannot register providers`,
      );
    }
    await commit(
      context,
      loaded,
      selectIntelligence(loaded.contract, id, context.io.clock()),
      {
        command: "intelligence select",
        summary: `selected intelligence mechanism ${id}`,
      },
    );
    return EXIT.ok;
  }
  throw new UsageError(
    `unknown intelligence subcommand "${sub}"`,
    INTELLIGENCE_USAGE,
  );
}

interface Target {
  readonly built: BuiltIntelligenceRequest;
  readonly disclosure: OutboundDisclosure;
  readonly mechanism: "handoff" | "openai_compatible";
  readonly via: string;
}

async function prepare(
  context: CommandContext,
  loaded: LoadedProject,
  task: IntelligenceTask,
  via: string,
): Promise<
  Target & {
    readonly provider?: Parameters<typeof describeProviderDisclosure>[1];
  }
> {
  if (via === "none") {
    throw new WorkflowError(
      'no intelligence mechanism is selected. The deterministic workflow does not need one; to use one, run "anvilmark intelligence select handoff" or select a registered provider',
    );
  }
  if (via === "handoff") {
    const built = buildIntelligenceRequest(loaded.contract, {
      task,
      execution: "remote",
    });
    return {
      built,
      disclosure: describeHandoffDisclosure(built),
      mechanism: "handoff",
      via,
    };
  }
  const host = await hostFor(context, loaded);
  const provider = host.providers.get(via);
  if (provider === undefined) {
    throw new WorkflowError(
      `"${via}" is not a registered provider in ${host.path}${host.problems.length === 0 ? "" : `; problems: ${host.problems.join("; ")}`}`,
    );
  }
  const built = buildIntelligenceRequest(loaded.contract, {
    task,
    execution: provider.registration.reach,
  });
  return {
    built,
    disclosure: describeProviderDisclosure(built, provider),
    mechanism: "openai_compatible",
    via,
    provider,
  };
}

function gate(target: Target): void {
  if (target.built.secret_findings.length > 0) {
    throw new WorkflowError(
      `the request contains secret-shaped values at ${target.built.secret_findings.map((entry) => entry.path).join(", ")}; nothing was sent or written`,
    );
  }
  if (target.disclosure.data_categories.length === 0) {
    throw new WorkflowError(
      "the project's remote_intelligence_policy allows no data categories for this destination, so there is nothing to send; nothing was sent or written",
    );
  }
}

async function receive(
  context: CommandContext,
  loaded: LoadedProject,
  input: {
    readonly adapter: IntelligenceAdapter;
    readonly request: IntelligenceRequest;
    readonly requestId: string;
    readonly requestDigest: string;
    readonly mechanism: "handoff" | "openai_compatible";
    readonly destination: string | null;
    readonly consent: OutboundConsentRecord | null;
    readonly notices: readonly string[];
    /** The handoff response file, reported if it holds a secret. */
    readonly responsePath: string | null;
  },
): Promise<ExitCode> {
  const io = context.io;
  const startedAt = io.clock();
  let outcome: AdapterOutcome<IntelligenceProposal>;
  try {
    outcome = await input.adapter.propose(input.request, { signal: io.signal });
  } catch (error) {
    // An adapter is supposed to report every failure as an outcome. If one
    // throws anyway, it is still a failed attempt and is recorded as one.
    outcome = notAvailable(
      "failed",
      [
        adapterError(
          "adapter_internal_error",
          `the adapter failed without returning an outcome: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
      {
        adapter: input.adapter.identity,
        started_at: startedAt,
        completed_at: io.clock(),
        provenance: {
          command_manifest: null,
          locator: null,
          raw_result_hash: null,
        },
        diagnostics: [],
      },
    );
  }
  const proposalId = recordId("prop", io.clock());
  const receivedAt = io.clock();
  const recordPath = join(
    loaded.paths.proposalsDirectory,
    `${proposalId}.json`,
  );
  const base = {
    format: "anvilmark-intelligence-proposal/0.1" as const,
    proposal_id: proposalId,
    request_id: input.requestId,
    request_digest: input.requestDigest,
    received_at: receivedAt,
    adapter: outcome.adapter,
    standing: outcome.standing,
    raw_result_hash: outcome.provenance.raw_result_hash,
    consent: input.consent,
  };

  /**
   * Record an attempt that changed nothing. The project is untouched whether
   * or not this write succeeds, so a failure here is reported, not hidden.
   */
  const recordRefusal = async (
    record: Record<string, unknown>,
  ): Promise<string> => {
    try {
      await writeRecord(recordPath, { ...base, ...record }, context.storeFs);
      return `Recorded in ${projectRelative(loaded, recordPath)}`;
    } catch (error) {
      return `warning: the attempt could not be recorded in ${projectRelative(loaded, recordPath)} (${sanitizeText(error instanceof Error ? error.message : String(error)).text}); the project is still unchanged`;
    }
  };

  if (outcome.standing !== "available") {
    const recorded = await recordRefusal({
      outcome: "not_accepted",
      problems: outcome.errors,
    });
    const leakedFile =
      input.mechanism === "handoff" &&
      input.responsePath !== null &&
      outcome.errors.some((entry) => entry.code === "secret_detected");
    io.stderr(
      lines(
        `No proposal was applied (${outcome.standing}). The project is unchanged.`,
        outcome.errors.map((entry) => `  [${entry.code}] ${entry.message}`),
        recorded,
        leakedFile
          ? `warning: ANVILMARK stored none of it, but the response file your agent wrote still contains a secret-shaped value: ${input.responsePath}. Delete it and rotate the credential if it is real.`
          : [],
      ),
    );
    return outcome.standing === "unavailable" ||
      outcome.standing === "timed_out"
      ? EXIT.failed
      : outcome.errors.some((entry) => entry.code === "cancelled")
        ? EXIT.cancelled
        : EXIT.failed;
  }

  const applied = applyProposal(loaded.contract, outcome.value, {
    proposalId,
    adapterId: outcome.adapter.id,
    receivedAt,
    sourceType: input.mechanism === "handoff" ? "file" : "api",
  });
  if (!applied.ok) {
    const recorded = await recordRefusal({
      outcome: "rejected",
      problems: applied.problems,
      proposal: sanitizeStructured(outcome.value, "proposal"),
    });
    io.stderr(
      lines(
        "The proposal was rejected as a whole. The project is unchanged.",
        applied.problems.map((entry) => `  [${entry.code}] ${entry.message}`),
        recorded,
      ),
    );
    return EXIT.failed;
  }

  const value = applied.value;
  // The accepted record travels INSIDE the state revision: it is written with
  // the history metadata, before project.yaml is replaced, so it exists exactly
  // when the change was committed.
  const provenance = {
    kind: "intelligence_proposal",
    proposal_id: proposalId,
    request_id: input.requestId,
    request_digest: input.requestDigest,
    mechanism: input.mechanism,
    adapter_id: outcome.adapter.id,
    adapter_execution: outcome.adapter.execution,
    adapter_version: outcome.adapter.version,
    declared_destination: input.destination,
    raw_result_hash: outcome.provenance.raw_result_hash,
    consent: input.consent,
    generated_rationale: value.generated_rationale,
    added: value.added,
    record: {
      ...base,
      // "applied": this state revision contains the proposal. It is accepted
      // exactly when this revision is on the committed chain; a snapshot left
      // by a failed commit is never on it.
      outcome: "applied",
      added: value.added,
      proposal: value.proposal,
    },
  };
  try {
    await commit(context, loaded, value.contract, {
      command: `propose ${input.mechanism === "handoff" ? "import" : "send"}`,
      summary: `applied proposal ${proposalId} from ${outcome.adapter.id}: ${value.added.constraints.length} constraint(s), ${value.added.candidates.length} candidate(s), ${value.added.questions.length} question(s), ${value.added.inferences.length} inference(s)${value.added.architecture_nodes.length + value.added.relationships.length + value.added.decision_bindings.length === 0 ? "" : `, ${value.added.architecture_nodes.length} architecture node(s), ${value.added.relationships.length} relationship(s), ${value.added.decision_bindings.length} decision binding(s) (agent-proposed, unconfirmed)`}`,
      notices: [
        ...input.notices,
        ...(value.duplicate_questions.length === 0
          ? []
          : [
              `${value.duplicate_questions.length} proposed question(s) were already recorded`,
            ]),
      ],
      provenance,
    });
  } catch (error) {
    // Nothing was committed, so the proposal was not accepted. Say so in the
    // attempt record rather than leaving an acceptance nobody can find.
    const recorded = await recordRefusal({
      outcome: "not_committed",
      problems: [
        {
          code: "commit_failed",
          message: sanitizeText(
            error instanceof Error ? error.message : String(error),
          ).text,
        },
      ],
      proposal: sanitizeStructured(outcome.value, "proposal"),
    });
    io.stderr(
      lines(
        "The proposal was valid but could not be committed. The project is unchanged.",
        recorded,
      ),
    );
    throw error;
  }
  io.stdout(
    lines(
      value.added.constraints.length === 0
        ? []
        : `  constraints (agent_proposed): ${value.added.constraints.join(", ")}`,
      value.added.candidates.length === 0
        ? []
        : `  candidates (discovered): ${value.added.candidates.join(", ")}`,
      value.added.questions.length === 0
        ? []
        : `  unresolved questions: ${value.added.questions.length} added`,
      value.added.inferences.length === 0
        ? []
        : `  inferences recorded as T0 agent_inference evidence: ${value.added.inferences.join(", ")}`,
      value.added.architecture_nodes.length === 0
        ? []
        : `  architecture nodes (agent-proposed, unconfirmed): ${value.added.architecture_nodes.join(", ")}`,
      value.added.relationships.length === 0
        ? []
        : `  relationships (agent-proposed, unconfirmed): ${value.added.relationships.join(", ")}`,
      value.added.decision_bindings.length === 0
        ? []
        : `  decision bindings (agent-proposed, unconfirmed): ${value.added.decision_bindings.join(", ")}`,
      value.added.architecture_nodes.length +
        value.added.relationships.length +
        value.added.decision_bindings.length ===
        0
        ? []
        : "  Proposed architecture is shown as inferred until you confirm each element with: anvilmark architecture confirm node|relationship|binding REF",
      value.generated_rationale.summary === null
        ? []
        : `  generated rationale (not evidence, from ${value.generated_rationale.summary.generated_by}): ${value.generated_rationale.summary.summary}`,
      `  accepted proposal ${proposalId} is recorded in this state revision's history entry`,
      "Nothing proposed is approved, measured or viable. Compare with: anvilmark compare",
    ),
  );
  return EXIT.ok;
}

export async function proposeCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      task: { type: "string" },
      via: { type: "string" },
      response: { type: "string" },
    },
    PROPOSE_USAGE,
  );
  if (flag(parsed, "help") || sub === undefined) {
    context.io.stdout(`${PROPOSE_USAGE}\n`);
    return sub === undefined && !flag(parsed, "help") ? EXIT.usage : EXIT.ok;
  }
  const io = context.io;
  const loaded = await openProject(io, parsed);
  const selected = selectedIntelligence(loaded.contract);

  switch (sub) {
    case "preview": {
      const target = await prepare(
        context,
        loaded,
        taskOption(parsed),
        stringOption(parsed, "via") ?? selected,
      );
      if (flag(parsed, "json")) {
        writeJson(io, {
          disclosure: target.disclosure,
          secret_findings: target.built.secret_findings,
          request: target.built.request,
        });
        return EXIT.ok;
      }
      io.stdout(
        lines(
          renderDisclosure(target.disclosure),
          "Exact request:",
          target.built.request_json,
          target.built.secret_findings.length > 0
            ? "BLOCKED: the request contains secret-shaped values and would not be sent."
            : target.disclosure.data_categories.length === 0
              ? "BLOCKED: the project's policy allows no data categories for this destination."
              : "Preview only: nothing was sent or written.",
        ),
      );
      return EXIT.ok;
    }

    case "export": {
      const via = stringOption(parsed, "via") ?? "handoff";
      if (via !== "handoff") {
        throw new UsageError(
          "export writes a handoff request; use propose send for a registered provider",
          PROPOSE_USAGE,
        );
      }
      const target = await prepare(
        context,
        loaded,
        taskOption(parsed),
        "handoff",
      );
      gate(target);
      const now = io.clock();
      const requestId = recordId("req", now);
      const requestPath = join(
        loaded.paths.handoffDirectory,
        `${requestId}.request.json`,
      );
      const responsePath = join(
        loaded.paths.handoffDirectory,
        `${requestId}.response.json`,
      );
      const document = buildHandoffDocument({
        request: target.built.request,
        requestId,
        responseFile: projectRelative(loaded, responsePath),
        createdAt: now,
      });
      await writeRecord(
        join(loaded.paths.requestsDirectory, `${requestId}.json`),
        {
          format: "anvilmark-intelligence-request/0.1",
          request_id: requestId,
          created_at: now,
          mechanism: "handoff",
          base_state_revision: loaded.head?.revision ?? null,
          base_project_digest: loaded.digest,
          disclosure: target.disclosure,
          request_digest: target.built.digest,
          request: target.built.request,
          response_file: document.response_file,
        },
      );
      await writeRecord(requestPath, document, context.storeFs);
      io.stdout(
        lines(
          renderDisclosure(target.disclosure),
          `Wrote ${projectRelative(loaded, requestPath)}`,
          "",
          "Give that file to your agent, for example:",
          `  "Read ${projectRelative(loaded, requestPath)} and follow how_to_respond exactly."`,
          "Then import the response (nothing changes until you do, and it is validated first):",
          `  anvilmark propose import ${requestId}`,
        ),
      );
      return EXIT.ok;
    }

    case "import": {
      const requestId = parsed.positionals[0];
      if (requestId === undefined || !/^req-[A-Za-z0-9-]+$/.test(requestId)) {
        throw new UsageError("REQUEST_ID (req-...) is required", PROPOSE_USAGE);
      }
      let record: {
        mechanism?: unknown;
        request?: IntelligenceRequest;
        request_digest?: string;
        response_file?: string;
        base_project_digest?: string;
        base_state_revision?: number | null;
      };
      try {
        record = (await readJson(
          join(loaded.paths.requestsDirectory, `${requestId}.json`),
        )) as typeof record;
      } catch {
        throw new WorkflowError(
          `no exported request "${requestId}" exists in this project`,
        );
      }
      if (
        record.mechanism !== "handoff" ||
        record.request === undefined ||
        record.request_digest === undefined ||
        record.response_file === undefined
      ) {
        throw new WorkflowError(
          `request "${requestId}" is not a handoff request`,
        );
      }
      const response = stringOption(parsed, "response");
      const responsePath =
        response === undefined
          ? resolve(loaded.paths.root, record.response_file)
          : resolve(io.cwd, response);
      const notices =
        record.base_project_digest === loaded.digest
          ? []
          : [
              `the project changed since request ${requestId} was exported (from state r${record.base_state_revision ?? "?"}); the proposal was validated against the current state`,
            ];
      return receive(context, loaded, {
        adapter: createHandoffAdapter({
          responsePath,
          expectedRequestDigest: record.request_digest,
          clock: io.clock,
        }),
        request: record.request,
        requestId,
        requestDigest: record.request_digest,
        mechanism: "handoff",
        destination: null,
        consent: null,
        notices,
        responsePath,
      });
    }

    case "send": {
      const via = stringOption(parsed, "via") ?? selected;
      if (via === "handoff") {
        throw new UsageError(
          "the handoff mechanism does not send; use propose export and propose import",
          PROPOSE_USAGE,
        );
      }
      const target = await prepare(context, loaded, taskOption(parsed), via);
      const provider = target.provider;
      if (provider === undefined) {
        throw new WorkflowError(`"${via}" is not a registered provider`);
      }
      gate(target);
      io.stdout(renderDisclosure(target.disclosure));

      const remote = provider.registration.reach === "remote";
      const store = createOutboundConsentStore({ clock: io.clock });
      let consent: OutboundConsentRecord | null = null;
      if (remote) {
        if (!io.interactive) {
          throw new WorkflowError(
            "sending to a remote provider needs consent in an interactive terminal, and there is no flag or environment variable that replaces it; nothing was sent. Use propose preview to inspect the request, or the handoff mechanism",
          );
        }
        if (
          loaded.contract.remote_intelligence_policy
            .show_payload_before_remote_send
        ) {
          io.stdout(lines("Exact request:", target.built.request_json));
        } else {
          io.stdout(
            lines(
              "The project's policy does not print the payload here; run propose preview to see it.",
            ),
          );
        }
        const yes = await confirm(
          io,
          `Send this exact request (${target.built.digest}) to ${provider.destination}? This is consent to send, not approval of anything.`,
        );
        if (!yes) {
          throw new Cancelled("Nothing was sent.");
        }
        consent = store.grant({
          provider_id: provider.registration.id,
          destination: provider.destination,
          registration_digest: provider.digest,
          request_digest: target.built.digest,
        });
      }
      const now = io.clock();
      const requestId = recordId("req", now);
      await writeRecord(
        join(loaded.paths.requestsDirectory, `${requestId}.json`),
        {
          format: "anvilmark-intelligence-request/0.1",
          request_id: requestId,
          created_at: now,
          mechanism: "openai_compatible",
          base_state_revision: loaded.head?.revision ?? null,
          base_project_digest: loaded.digest,
          disclosure: target.disclosure,
          consent,
          request_digest: target.built.digest,
          request: target.built.request,
        },
      );
      io.stdout(`Sending to ${provider.destination}...\n`);
      return receive(context, loaded, {
        adapter: createOpenAiCompatibleAdapter({
          provider,
          consent: remote ? store.verifier : null,
          readEnv: (name) => io.env[name],
          clock: io.clock,
        }),
        request: target.built.request,
        requestId,
        requestDigest: target.built.digest,
        mechanism: "openai_compatible",
        destination: provider.destination,
        consent,
        notices: [],
        responsePath: null,
      });
    }

    default:
      throw new UsageError(
        `unknown propose subcommand "${sub}"`,
        PROPOSE_USAGE,
      );
  }
}
