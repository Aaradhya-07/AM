import type { AdapterIdentity, AdapterStanding } from "@anvilmark/adapters";
import {
  createLlmfitAdapter,
  createPromptfooAdapter,
} from "@anvilmark/adapters";
import type { DecisionScope } from "@anvilmark/project-contract";
import { approvalState } from "@anvilmark/project-contract";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import {
  APPROVAL_LIMIT_STATEMENT,
  lines,
  renderComparison,
  renderReview,
} from "../render.js";
import {
  ambiguousProposals,
  candidateOrigins,
  committedProposals,
} from "../provenance.js";
import type { LoadedProject } from "../store.js";
import { ambiguityGuidance, loadProject } from "../store.js";
import { compareAlternatives } from "../workflow/compare.js";
import type { DecisionInput, DecisionRevision } from "../workflow/decisions.js";
import {
  approveDecision,
  draftDecision,
  proposeDecision,
  rejectDecision,
  reviewDecision,
  reviseDecision,
} from "../workflow/decisions.js";
import { WorkflowError } from "../workflow/edit.js";
import type { CommandContext, Parsed } from "./common.js";
import {
  Cancelled,
  UsageError,
  commit,
  flag,
  listOption,
  openProject,
  parse,
  requiredOption,
  stringOption,
  writeJson,
} from "./common.js";

// --- compare ---------------------------------------------------------------

export const COMPARE_USAGE = `Usage: anvilmark compare [--workload ID] [--as-of TIMESTAMP] [--probe-tools] [--json]
Shows every candidate per workload: satisfied, failed and unknown constraints, the
evidence behind each with tier and freshness, assumptions, incompatibility reasons,
and the evidence still required. No overall score is computed.
--probe-tools  also check whether the optional llmfit and promptfoo tools are
               installed (runs "<tool> --version" locally); a missing tool is a gap.`;

async function probeTools(): Promise<
  { identity: AdapterIdentity; standing: AdapterStanding; reason: string }[]
> {
  const results = [];
  for (const adapter of [createLlmfitAdapter(), createPromptfooAdapter()]) {
    const outcome = await adapter.probe();
    results.push({
      identity: adapter.identity,
      standing: outcome.standing,
      reason:
        outcome.standing === "available"
          ? `version ${outcome.value.version}`
          : `${outcome.errors.map((entry) => entry.message).join("; ")} — evidence it would produce must be imported another way or stays a gap`,
    });
  }
  return results;
}

export async function compareCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      workload: { type: "string" },
      "as-of": { type: "string" },
      "probe-tools": { type: "boolean" },
    },
    COMPARE_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${COMPARE_USAGE}\n`);
    return EXIT.ok;
  }
  const loaded = await openProject(context.io, parsed);
  const asOf = stringOption(parsed, "as-of") ?? context.io.clock();
  if (!Number.isFinite(Date.parse(asOf))) {
    throw new UsageError(`--as-of "${asOf}" is not a timestamp`, COMPARE_USAGE);
  }
  const adapters = flag(parsed, "probe-tools") ? await probeTools() : undefined;
  const comparison = compareAlternatives(loaded.contract, {
    asOf,
    ...(adapters === undefined ? {} : { adapters }),
  });
  const workload = stringOption(parsed, "workload");
  const filtered =
    workload === undefined
      ? comparison
      : {
          ...comparison,
          workloads: comparison.workloads.filter(
            (entry) => entry.workload_ref === workload,
          ),
        };
  if (workload !== undefined && filtered.workloads.length === 0) {
    throw new WorkflowError(`workload "${workload}" does not exist`);
  }
  if (flag(parsed, "json")) {
    writeJson(context.io, filtered);
  } else {
    context.io.stdout(renderComparison(filtered));
  }
  return EXIT.ok;
}

// --- decisions -------------------------------------------------------------

export const DECISION_USAGE = `Usage:
  anvilmark decision draft --id ID (--workload ID | --component NODE_ID | --project)
        --select CANDIDATE [--alternative CANDIDATE]... [--satisfies CONSTRAINT]...
        [--unresolved CONSTRAINT]... [--evidence EVIDENCE_ID]...
        (--rationale "TEXT" | --rationale-from-proposal PROPOSAL_ID)
  anvilmark decision propose ID      draft -> proposed (refused while claims are not backed)
  anvilmark decision revise ID [same options as draft, except scope]   -> draft, new revision
  anvilmark decision reject ID       proposed -> rejected

Approve a proposed decision with "anvilmark approve ID" in an interactive terminal.`;

async function rationaleFrom(
  parsed: Parsed,
  loaded: LoadedProject,
): Promise<DecisionInput["rationale"] | undefined> {
  const text = stringOption(parsed, "rationale");
  const proposalId = stringOption(parsed, "rationale-from-proposal");
  if (text !== undefined && proposalId !== undefined) {
    throw new UsageError(
      "use --rationale or --rationale-from-proposal, not both",
      DECISION_USAGE,
    );
  }
  if (text !== undefined) {
    return { summary: text, generated_by: null };
  }
  if (proposalId === undefined) {
    return undefined;
  }
  if (!/^prop-[A-Za-z0-9-]+$/.test(proposalId)) {
    throw new UsageError("PROPOSAL_ID must look like prop-...", DECISION_USAGE);
  }
  // Only a proposal applied in a committed revision was accepted. Hand edits
  // to project.yaml do not change which revisions were committed; a revision
  // whose standing is ambiguous is not treated as committed.
  const pending = ambiguousProposals(loaded).find(
    (entry) => entry.record.proposal_id === proposalId,
  );
  if (pending !== undefined) {
    throw new WorkflowError(
      `proposal "${proposalId}" was applied in revision r${pending.entry.revision}, whose commit is ambiguous, so it is not treated as accepted.\n${ambiguityGuidance(loaded.paths, [pending.entry])}`,
    );
  }
  const committed = (await committedProposals(loaded)).find(
    (entry) => entry.record.proposal_id === proposalId,
  );
  const rationale = committed?.record.proposal.rationale ?? null;
  if (committed === undefined || rationale === null) {
    throw new WorkflowError(
      `proposal "${proposalId}" is not an accepted proposal in this project's committed history, or carries no rationale`,
    );
  }
  return {
    summary: rationale.summary,
    generated_by: `${rationale.generated_by} (via ${committed.record.adapter.id}, proposal ${proposalId}, state r${committed.entry.revision})`,
  };
}

const DECISION_OPTIONS = {
  id: { type: "string" },
  workload: { type: "string" },
  component: { type: "string" },
  project: { type: "boolean" },
  select: { type: "string" },
  alternative: { type: "string", multiple: true },
  satisfies: { type: "string", multiple: true },
  unresolved: { type: "string", multiple: true },
  evidence: { type: "string", multiple: true },
  rationale: { type: "string" },
  "rationale-from-proposal": { type: "string" },
} as const;

export async function decisionCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(context.args, DECISION_OPTIONS, DECISION_USAGE);
  if (flag(parsed, "help") || sub === undefined) {
    context.io.stdout(`${DECISION_USAGE}\n`);
    return sub === undefined && !flag(parsed, "help") ? EXIT.usage : EXIT.ok;
  }
  const loaded = await openProject(context.io, parsed);
  const now = context.io.clock();
  const id = (): string => {
    const value = parsed.positionals[0];
    if (value === undefined)
      throw new UsageError("ID is required", DECISION_USAGE);
    return value;
  };

  switch (sub) {
    case "draft": {
      const scopes = [
        stringOption(parsed, "workload"),
        stringOption(parsed, "component"),
        flag(parsed, "project") ? "project" : undefined,
      ].filter((entry) => entry !== undefined);
      if (scopes.length !== 1) {
        throw new UsageError(
          "give exactly one scope: --workload, --component or --project",
          DECISION_USAGE,
        );
      }
      const workload = stringOption(parsed, "workload");
      const component = stringOption(parsed, "component");
      const scope: DecisionScope =
        workload !== undefined
          ? { kind: "workload", workload_ref: workload }
          : component !== undefined
            ? { kind: "component", component_ref: component }
            : { kind: "project" };
      const rationale = await rationaleFrom(parsed, loaded);
      if (rationale === undefined) {
        throw new UsageError(
          "a rationale is required: --rationale or --rationale-from-proposal",
          DECISION_USAGE,
        );
      }
      const decisionId = requiredOption(parsed, "id", DECISION_USAGE);
      await commit(
        context,
        loaded,
        draftDecision(
          loaded.contract,
          {
            id: decisionId,
            scope,
            selectedCandidate: requiredOption(parsed, "select", DECISION_USAGE),
            alternatives: listOption(parsed, "alternative"),
            satisfies: listOption(parsed, "satisfies"),
            unresolved: listOption(parsed, "unresolved"),
            evidence: listOption(parsed, "evidence"),
            rationale,
          },
          now,
        ),
        {
          command: "decision draft",
          summary: `drafted decision ${decisionId}`,
        },
      );
      return EXIT.ok;
    }
    case "propose": {
      const decisionId = id();
      await commit(
        context,
        loaded,
        proposeDecision(loaded.contract, decisionId, now),
        {
          command: "decision propose",
          summary: `proposed decision ${decisionId}`,
        },
      );
      context.io.stdout(
        `Review it with "anvilmark review ${decisionId}"; approve it with "anvilmark approve ${decisionId}" in a terminal.\n`,
      );
      return EXIT.ok;
    }
    case "revise": {
      const decisionId = id();
      if (
        parsed.values.workload !== undefined ||
        parsed.values.component !== undefined ||
        parsed.values.project !== undefined
      ) {
        throw new UsageError(
          "a decision's scope cannot be revised; draft a new decision",
          DECISION_USAGE,
        );
      }
      const rationale = await rationaleFrom(parsed, loaded);
      const change: DecisionRevision = {
        ...(parsed.values.select === undefined
          ? {}
          : {
              selectedCandidate: requiredOption(
                parsed,
                "select",
                DECISION_USAGE,
              ),
            }),
        ...(parsed.values.alternative === undefined
          ? {}
          : { alternatives: listOption(parsed, "alternative") }),
        ...(parsed.values.satisfies === undefined
          ? {}
          : { satisfies: listOption(parsed, "satisfies") }),
        ...(parsed.values.unresolved === undefined
          ? {}
          : { unresolved: listOption(parsed, "unresolved") }),
        ...(parsed.values.evidence === undefined
          ? {}
          : { evidence: listOption(parsed, "evidence") }),
        ...(rationale === undefined ? {} : { rationale }),
      };
      const result = reviseDecision(loaded.contract, decisionId, change, now);
      const revision = result.contract.decisions.find(
        (entry) => entry.id === decisionId,
      )?.revision;
      await commit(context, loaded, result.contract, {
        command: "decision revise",
        summary: `revised decision ${decisionId} to draft revision ${revision}`,
        notices: result.notices,
      });
      return EXIT.ok;
    }
    case "reject": {
      const decisionId = id();
      await commit(
        context,
        loaded,
        rejectDecision(loaded.contract, decisionId, now),
        {
          command: "decision reject",
          summary: `rejected decision ${decisionId}`,
        },
      );
      return EXIT.ok;
    }
    default:
      throw new UsageError(
        `unknown decision subcommand "${sub}"`,
        DECISION_USAGE,
      );
  }
}

// --- review and approval ---------------------------------------------------

export const REVIEW_USAGE = `Usage: anvilmark review DECISION_ID [--as-of TIMESTAMP] [--json]
Shows the exact content an approval would cover and its approval hash.`;

export async function reviewCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    { "as-of": { type: "string" } },
    REVIEW_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${REVIEW_USAGE}\n`);
    return EXIT.ok;
  }
  const decisionId = parsed.positionals[0];
  if (decisionId === undefined) {
    throw new UsageError("DECISION_ID is required", REVIEW_USAGE);
  }
  const loaded = await openProject(context.io, parsed);
  const review = reviewDecision(
    loaded.contract,
    decisionId,
    stringOption(parsed, "as-of") ?? context.io.clock(),
  );
  if (flag(parsed, "json")) {
    writeJson(context.io, review);
  } else {
    context.io.stdout(
      renderReview(review, { origins: await candidateOrigins(loaded) }),
    );
  }
  return EXIT.ok;
}

export const APPROVE_USAGE = `Usage: anvilmark approve DECISION_ID [--as NAME] [--note "TEXT"]
Interactive only. Shows the exact resolved content and its approval hash, then asks
you to type the first 12 characters of that hash. Anything else, or no answer,
approves nothing. There is no --yes flag and no environment variable that skips this.

${APPROVAL_LIMIT_STATEMENT}`;

const BYPASS_ATTEMPTS =
  /^(?:-y|--yes|--force|--non-interactive|--no-input|--assume-yes|--auto-approve)(?:=.*)?$/;

export async function approveCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const io = context.io;
  const bypass = context.args.find((entry) => BYPASS_ATTEMPTS.test(entry));
  if (bypass !== undefined) {
    throw new UsageError(
      `"${bypass}" is not supported: approval is always interactive and defaults to no`,
      APPROVE_USAGE,
    );
  }
  const parsed = parse(
    context.args,
    { as: { type: "string" }, note: { type: "string" } },
    APPROVE_USAGE,
  );
  if (flag(parsed, "help")) {
    io.stdout(`${APPROVE_USAGE}\n`);
    return EXIT.ok;
  }
  if (flag(parsed, "json")) {
    throw new UsageError("approve has no machine-readable mode", APPROVE_USAGE);
  }
  const decisionId = parsed.positionals[0];
  if (decisionId === undefined) {
    throw new UsageError("DECISION_ID is required", APPROVE_USAGE);
  }
  if (!io.interactive) {
    throw new WorkflowError(
      `approval needs an interactive terminal (stdin and stdout must both be a TTY); nothing was approved. ${APPROVAL_LIMIT_STATEMENT}`,
    );
  }

  const loaded = await openProject(io, parsed);
  const shownAt = io.clock();
  const review = reviewDecision(loaded.contract, decisionId, shownAt);
  io.stdout(renderReview(review, { origins: await candidateOrigins(loaded) }));
  if (review.blockers.length > 0 || review.approval_hash === null) {
    throw new WorkflowError(
      `decision "${decisionId}" cannot be approved yet; nothing was approved`,
    );
  }

  let actor = stringOption(parsed, "as");
  if (actor === undefined) {
    const answer = await io.prompt("Approving as (your name or role): ");
    if (answer === null || answer.trim() === "") {
      throw new Cancelled("Cancelled; nothing was approved.");
    }
    actor = answer.trim();
  }
  const hash = review.approval_hash;
  const answer = await io.prompt(
    `\nTo approve decision ${decisionId} revision ${review.decision.revision} exactly as shown, type the first 12 characters of the approval hash (${hash.slice(0, 4)}...). Press Enter to cancel: `,
  );
  if (answer === null || answer.trim() !== hash.slice(0, 12)) {
    throw new Cancelled(
      answer === null || answer.trim() === ""
        ? "Not approved; nothing was written."
        : "That does not match the approval hash. Not approved; nothing was written.",
    );
  }

  // Re-read from disk: the approval must cover what is on disk NOW, and that
  // must be exactly what was displayed.
  const current = await loadProject(loaded.paths.root);
  if (current.digest !== loaded.digest) {
    throw new WorkflowError(
      "the project changed while you were reviewing; nothing was approved. Run the review again",
    );
  }
  const approvedAt = io.clock();
  const result = approveDecision(current.contract, {
    id: decisionId,
    confirmedHash: hash,
    actorRef: actor,
    note: stringOption(parsed, "note") ?? null,
    now: approvedAt,
  });
  await commit(context, current, result.contract, {
    command: "approve",
    summary: `approved decision ${decisionId} revision ${review.decision.revision} (sha-256 ${hash})`,
    notices: result.superseded.map(
      (entry) => `decision "${entry}" is superseded by this approval`,
    ),
  });
  io.stdout(
    lines(
      `Approved. The approval record is appended to the contract's approval history and covers hash ${hash}.`,
      "If the selected candidate, its cited evidence or the constraint results change, this approval stops being current.",
      APPROVAL_LIMIT_STATEMENT,
    ),
  );
  return EXIT.ok;
}

export const APPROVAL_USAGE = `Usage: anvilmark approval status [DECISION_ID] [--json]`;

export async function approvalCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(context.args, {}, APPROVAL_USAGE);
  if (flag(parsed, "help")) {
    context.io.stdout(`${APPROVAL_USAGE}\n`);
    return EXIT.ok;
  }
  if (sub !== "status") {
    throw new UsageError(
      sub === "grant" || sub === "add" || sub === "approve"
        ? 'approval is recorded only by the interactive "anvilmark approve" command'
        : `unknown approval subcommand "${sub ?? ""}"`,
      APPROVAL_USAGE,
    );
  }
  const loaded = await openProject(context.io, parsed);
  const only = parsed.positionals[0];
  const decisions = loaded.contract.decisions.filter(
    (entry) => only === undefined || entry.id === only,
  );
  if (only !== undefined && decisions.length === 0) {
    throw new WorkflowError(`decision "${only}" does not exist`);
  }
  const report = decisions.map((decision) => {
    const state = approvalState(loaded.contract, decision.id);
    return {
      decision: decision.id,
      revision: decision.revision,
      status: decision.status,
      approval: state.state,
      current_approval: state.state === "current" ? state.approval : null,
      latest_approval:
        state.state === "current" || state.state === "stale"
          ? state.approval
          : null,
      history: loaded.contract.approvals.filter(
        (entry) => entry.decision_ref === decision.id,
      ),
    };
  });
  if (flag(parsed, "json")) {
    writeJson(context.io, report);
    return EXIT.ok;
  }
  context.io.stdout(
    lines(
      report.length === 0
        ? "no decisions"
        : report.flatMap((entry) => [
            `${entry.decision} r${entry.revision} ${entry.status}: approval ${entry.approval}`,
            ...entry.history.map(
              (approval) =>
                `    approved r${approval.decision_revision} by ${approval.actor.ref} at ${approval.approved_at}, sha-256 ${approval.content_hash}`,
            ),
          ]),
    ),
  );
  return EXIT.ok;
}
