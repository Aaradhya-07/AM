import type { ProjectionName } from "@anvilmark/context";
import {
  ArtifactPathError,
  artifactPaths,
  buildProjectFacts,
  decisionStanding,
} from "@anvilmark/context";
import type { ProjectContract } from "@anvilmark/project-contract";
import {
  architectureContent,
  validateProjectContract,
} from "@anvilmark/project-contract";

import { checkGenerated, generateArtifacts } from "../generate.js";
import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines, renderIssues } from "../render.js";
import { StoreError, loadProject } from "../store.js";
import { WorkflowError } from "../workflow/edit.js";
import { verifyArchitectureProvenance } from "../provenance.js";
import {
  addArchitectureInterface,
  addArchitectureNode,
  addArchitectureRelationship,
  bindDecision,
  confirmArchitectureElement,
  describeArchitectureElement,
  removeArchitectureInterface,
  removeArchitectureNode,
  removeArchitectureRelationship,
  setGeneratedViewPaths,
  unbindDecision,
  updateArchitectureInterface,
  updateArchitectureNode,
  updateArchitectureRelationship,
} from "../workflow/architecture.js";
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

export const ARCHITECTURE_USAGE = `Usage:
  anvilmark architecture show [--json]
  anvilmark architecture validate [--strict] [--json]
  anvilmark architecture node add ID --kind KIND --name "NAME" --trust-boundary BOUNDARY [--description "TEXT"]
  anvilmark architecture node update ID [--kind KIND] [--name "NAME"] [--trust-boundary BOUNDARY] [--description "TEXT" | --clear-description]
  anvilmark architecture node remove ID
  anvilmark architecture relationship add ID --kind KIND --from NODE --to NODE [--workload ID] [--data-classification LABEL]
        [--source-interface INTERFACE] [--destination-interface INTERFACE]
  anvilmark architecture relationship update ID [--kind KIND] [--from NODE] [--to NODE] [--workload ID | --no-workload]
        [--data-classification LABEL | --unknown-classification]
        [--source-interface INTERFACE | --no-source-interface] [--destination-interface INTERFACE | --no-destination-interface]
  anvilmark architecture relationship remove ID
  anvilmark architecture interface add NODE INTERFACE_ID [--protocol PROTOCOL] [--description "TEXT"]
  anvilmark architecture interface update INTERFACE_ID [--protocol PROTOCOL | --unknown-protocol] [--description "TEXT" | --clear-description]
  anvilmark architecture interface remove INTERFACE_ID
  anvilmark architecture confirm node ID                 (interactive)
  anvilmark architecture confirm relationship ID         (interactive)
  anvilmark architecture confirm binding DECISION_REF    (interactive)
  anvilmark architecture bind DECISION --node NODE[,NODE]
  anvilmark architecture unbind DECISION [--node NODE[,NODE]]    (no --node removes the whole binding)
  anvilmark architecture views [--mermaid PATH | --default-mermaid] [--calm PATH | --default-calm]

  KIND (node):          service, external_system, datastore, queue, runtime, actor
  BOUNDARY:             local, internal_network, remote_provider, third_party
  KIND (relationship):  connects, uses, deployed_in, composed_of
  LABEL:                a data classification declared as a workload input or output
  PROTOCOL:             HTTP, HTTPS, gRPC, AMQP, TCP, other (omit when unknown)
  INTERFACE:            an interface declared on that endpoint node; connects relationships only
  PATH:                 relative to .anvilmark/, e.g. architecture/view.mmd

The ANVILMARK architecture in project.yaml is authoritative. Mermaid and CALM
views are generated from it with "anvilmark generate" and are never read back.
Architecture is declared structure: it is not covered by approval hashes, and a
binding never makes a decision approved.

Elements imported from an intelligence proposal are agent-proposed and
unconfirmed: they are shown as inferred, and trust-boundary conclusions that
depend on them are unknown. "architecture confirm" records, interactively, that
you accept one element's exact content; it verifies the proposal against
committed history first. An edit that changes confirmed content clears the
confirmation. Confirming approves no decision and authorizes nothing remote.`;

export const GENERATE_USAGE = `Usage:
  anvilmark generate [--as-of TIMESTAMP | --refresh] [--projection remote-default|local-disclosed] [--json]
  anvilmark generate --check [--json]

Writes, from .anvilmark/project.yaml only:
  .anvilmark/architecture/view.mmd        Mermaid view (or architecture.generated.mermaid)
  .anvilmark/architecture/calm.json       CALM 1.2 export (or architecture.generated.calm_1_2)
  .anvilmark/generated/agent-context.md   agent context
  .anvilmark/generated/manifest.json      source, generator, projection, as_of and digests

as_of is the instant evidence freshness and exception expiry are evaluated. It is
--as-of when given; otherwise the manifest's as_of when the source, generator and
projection are unchanged (so regeneration is byte-stable); otherwise the clock,
recorded once. --refresh takes a new as_of from the clock.

Unchanged bytes are not the same as current standings. Every run also
evaluates the snapshot's time-dependent standings (evidence freshness,
exception expiry) now. When a reused or recorded as_of is no longer current,
generate reports STALE (stale_time), keeps the snapshot bytes and exits 1;
"generate --refresh" takes a new as_of. An explicit --as-of is a historical
snapshot: it succeeds and is labelled as one.

--check changes nothing. It exits 0 only when every view matches the current
contract, generator and projection, and time-dependent standings have not
changed since as_of; otherwise it reports missing, incomplete, tampered,
stale_source, stale_generator or stale_time and exits 1.

Before any output is read or written, every destination is checked below the
physical .anvilmark/ directory: symbolic links, aliases of project.yaml, the
lock, history/, intelligence/ or evaluations/, and colliding outputs are
refused, and nothing is changed.

The default projection is remote-default. local-disclosed adds repository
bindings, evidence locators and approver identities; it is for local use, and
generating it locally does not authorize sending it to a remote model.`;

function help(context: CommandContext, parsed: Parsed, usage: string): boolean {
  if (flag(parsed, "help")) {
    context.io.stdout(`${usage}\n`);
    return true;
  }
  return false;
}

function positional(parsed: Parsed, index: number, label: string): string {
  const value = parsed.positionals[index];
  if (value === undefined || value.trim() === "") {
    throw new UsageError(`${label} is required`, ARCHITECTURE_USAGE);
  }
  return value;
}

function exclusive(parsed: Parsed, a: string, b: string): void {
  if (parsed.values[a] !== undefined && parsed.values[b] !== undefined) {
    throw new UsageError(`give --${a} or --${b}, not both`, ARCHITECTURE_USAGE);
  }
}

async function apply(
  context: CommandContext,
  parsed: Parsed,
  command: string,
  change: (
    contract: ProjectContract,
    now: string,
  ) => {
    readonly contract: ProjectContract;
    readonly summary: string;
    readonly notices: readonly string[];
  },
): Promise<ExitCode> {
  const loaded = await openProject(context.io, parsed);
  const result = change(loaded.contract, context.io.clock());
  await commit(context, loaded, result.contract, {
    command,
    summary: result.summary,
    notices: result.notices,
  });
  return EXIT.ok;
}

export async function architectureCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  // Two-word subcommands: "node add", "relationship update", ...
  const nested =
    (sub === "node" ||
      sub === "relationship" ||
      sub === "interface" ||
      sub === "confirm") &&
    context.args[0] !== undefined &&
    !context.args[0].startsWith("-")
      ? context.args[0]
      : undefined;
  const args = nested === undefined ? context.args : context.args.slice(1);
  const parsed = parse(
    args,
    {
      kind: { type: "string" },
      name: { type: "string" },
      "trust-boundary": { type: "string" },
      description: { type: "string" },
      "clear-description": { type: "boolean" },
      from: { type: "string" },
      to: { type: "string" },
      workload: { type: "string" },
      "no-workload": { type: "boolean" },
      "data-classification": { type: "string" },
      "unknown-classification": { type: "boolean" },
      "source-interface": { type: "string" },
      "destination-interface": { type: "string" },
      "no-source-interface": { type: "boolean" },
      "no-destination-interface": { type: "boolean" },
      protocol: { type: "string" },
      "unknown-protocol": { type: "boolean" },
      node: { type: "string", multiple: true },
      mermaid: { type: "string" },
      calm: { type: "string" },
      "default-mermaid": { type: "boolean" },
      "default-calm": { type: "boolean" },
      strict: { type: "boolean" },
    },
    ARCHITECTURE_USAGE,
  );
  if (help(context, parsed, ARCHITECTURE_USAGE)) return EXIT.ok;

  switch (sub) {
    case "show":
      return showArchitecture(context, parsed);
    case "validate":
      return validateArchitecture(context, parsed);
    case "node":
      return nodeCommand(context, parsed, nested);
    case "relationship":
      return relationshipCommand(context, parsed, nested);
    case "interface":
      return interfaceCommand(context, parsed, nested);
    case "confirm":
      return confirmCommand(context, parsed, nested);
    case "bind": {
      const decision = positional(parsed, 0, "DECISION");
      const nodes = listOption(parsed, "node");
      if (nodes.length === 0) {
        throw new UsageError("--node is required", ARCHITECTURE_USAGE);
      }
      const loaded = await openProject(context.io, parsed);
      const target = loaded.contract.decisions.find(
        (entry) => entry.id === decision,
      );
      const standing =
        target === undefined
          ? "missing"
          : decisionStanding(loaded.contract, target);
      const result = bindDecision(
        loaded.contract,
        decision,
        nodes,
        context.io.clock(),
        standing,
      );
      await commit(context, loaded, result.contract, {
        command: "architecture bind",
        summary: result.summary,
        notices: result.notices,
      });
      return EXIT.ok;
    }
    case "unbind": {
      const decision = positional(parsed, 0, "DECISION");
      const nodes = listOption(parsed, "node");
      return apply(context, parsed, "architecture unbind", (contract, now) =>
        unbindDecision(contract, decision, nodes, now),
      );
    }
    case "views": {
      exclusive(parsed, "mermaid", "default-mermaid");
      exclusive(parsed, "calm", "default-calm");
      const mermaid = flag(parsed, "default-mermaid")
        ? null
        : stringOption(parsed, "mermaid");
      const calm = flag(parsed, "default-calm")
        ? null
        : stringOption(parsed, "calm");
      return apply(context, parsed, "architecture views", (contract, now) => {
        const result = setGeneratedViewPaths(
          contract,
          {
            ...(mermaid === undefined ? {} : { mermaid }),
            ...(calm === undefined ? {} : { calm }),
          },
          now,
        );
        // Refuse a path outside .anvilmark/ or over a reserved file before
        // saving it, not at the next generation.
        try {
          artifactPaths(result.contract);
        } catch (error) {
          if (error instanceof ArtifactPathError) {
            throw new WorkflowError(`${error.message}; nothing was saved`);
          }
          throw error;
        }
        return result;
      });
    }
    default:
      throw new UsageError(
        `unknown architecture subcommand "${sub ?? ""}"`,
        ARCHITECTURE_USAGE,
      );
  }
}

async function nodeCommand(
  context: CommandContext,
  parsed: Parsed,
  action: string | undefined,
): Promise<ExitCode> {
  const id = () => positional(parsed, 0, "ID");
  switch (action) {
    case "add": {
      const nodeId = id();
      const input = {
        id: nodeId,
        kind: requiredOption(parsed, "kind", ARCHITECTURE_USAGE),
        name: requiredOption(parsed, "name", ARCHITECTURE_USAGE),
        trustBoundary: requiredOption(
          parsed,
          "trust-boundary",
          ARCHITECTURE_USAGE,
        ),
        description: stringOption(parsed, "description") ?? null,
      };
      return apply(context, parsed, "architecture node add", (contract, now) =>
        addArchitectureNode(contract, input, now),
      );
    }
    case "update": {
      const nodeId = id();
      exclusive(parsed, "description", "clear-description");
      const kind = stringOption(parsed, "kind");
      const name = stringOption(parsed, "name");
      const trustBoundary = stringOption(parsed, "trust-boundary");
      const description = flag(parsed, "clear-description")
        ? null
        : stringOption(parsed, "description");
      return apply(
        context,
        parsed,
        "architecture node update",
        (contract, now) =>
          updateArchitectureNode(
            contract,
            nodeId,
            {
              ...(kind === undefined ? {} : { kind }),
              ...(name === undefined ? {} : { name }),
              ...(trustBoundary === undefined ? {} : { trustBoundary }),
              ...(description === undefined ? {} : { description }),
            },
            now,
          ),
      );
    }
    case "remove": {
      const nodeId = id();
      return apply(
        context,
        parsed,
        "architecture node remove",
        (contract, now) => removeArchitectureNode(contract, nodeId, now),
      );
    }
    default:
      throw new UsageError(
        `unknown architecture node action "${action ?? ""}"; use add, update or remove`,
        ARCHITECTURE_USAGE,
      );
  }
}

async function relationshipCommand(
  context: CommandContext,
  parsed: Parsed,
  action: string | undefined,
): Promise<ExitCode> {
  const id = () => positional(parsed, 0, "ID");
  switch (action) {
    case "add": {
      const input = {
        id: id(),
        kind: requiredOption(parsed, "kind", ARCHITECTURE_USAGE),
        source: requiredOption(parsed, "from", ARCHITECTURE_USAGE),
        destination: requiredOption(parsed, "to", ARCHITECTURE_USAGE),
        workload: stringOption(parsed, "workload") ?? null,
        dataClassification: stringOption(parsed, "data-classification") ?? null,
        sourceInterface: stringOption(parsed, "source-interface") ?? null,
        destinationInterface:
          stringOption(parsed, "destination-interface") ?? null,
      };
      if (
        parsed.values["no-workload"] !== undefined ||
        parsed.values["unknown-classification"] !== undefined ||
        parsed.values["no-source-interface"] !== undefined ||
        parsed.values["no-destination-interface"] !== undefined
      ) {
        throw new UsageError(
          "relationship add records an omitted --workload or --data-classification as none or unknown; --no-workload and --unknown-classification are for update",
          ARCHITECTURE_USAGE,
        );
      }
      return apply(
        context,
        parsed,
        "architecture relationship add",
        (contract, now) => addArchitectureRelationship(contract, input, now),
      );
    }
    case "update": {
      const relationshipId = id();
      exclusive(parsed, "workload", "no-workload");
      exclusive(parsed, "data-classification", "unknown-classification");
      exclusive(parsed, "source-interface", "no-source-interface");
      exclusive(parsed, "destination-interface", "no-destination-interface");
      const sourceInterface = flag(parsed, "no-source-interface")
        ? null
        : stringOption(parsed, "source-interface");
      const destinationInterface = flag(parsed, "no-destination-interface")
        ? null
        : stringOption(parsed, "destination-interface");
      const kind = stringOption(parsed, "kind");
      const source = stringOption(parsed, "from");
      const destination = stringOption(parsed, "to");
      const workload = flag(parsed, "no-workload")
        ? null
        : stringOption(parsed, "workload");
      const dataClassification = flag(parsed, "unknown-classification")
        ? null
        : stringOption(parsed, "data-classification");
      return apply(
        context,
        parsed,
        "architecture relationship update",
        (contract, now) =>
          updateArchitectureRelationship(
            contract,
            relationshipId,
            {
              ...(kind === undefined ? {} : { kind }),
              ...(source === undefined ? {} : { source }),
              ...(destination === undefined ? {} : { destination }),
              ...(workload === undefined ? {} : { workload }),
              ...(dataClassification === undefined
                ? {}
                : { dataClassification }),
              ...(sourceInterface === undefined ? {} : { sourceInterface }),
              ...(destinationInterface === undefined
                ? {}
                : { destinationInterface }),
            },
            now,
          ),
      );
    }
    case "remove": {
      const relationshipId = id();
      return apply(
        context,
        parsed,
        "architecture relationship remove",
        (contract, now) =>
          removeArchitectureRelationship(contract, relationshipId, now),
      );
    }
    default:
      throw new UsageError(
        `unknown architecture relationship action "${action ?? ""}"; use add, update or remove`,
        ARCHITECTURE_USAGE,
      );
  }
}

async function interfaceCommand(
  context: CommandContext,
  parsed: Parsed,
  action: string | undefined,
): Promise<ExitCode> {
  switch (action) {
    case "add": {
      const node = positional(parsed, 0, "NODE");
      const id = positional(parsed, 1, "INTERFACE_ID");
      if (parsed.values["unknown-protocol"] !== undefined) {
        throw new UsageError(
          "interface add records an omitted --protocol as unknown; --unknown-protocol is for update",
          ARCHITECTURE_USAGE,
        );
      }
      const input = {
        id,
        protocol: stringOption(parsed, "protocol") ?? null,
        description: stringOption(parsed, "description") ?? null,
      };
      return apply(
        context,
        parsed,
        "architecture interface add",
        (contract, now) => addArchitectureInterface(contract, node, input, now),
      );
    }
    case "update": {
      const id = positional(parsed, 0, "INTERFACE_ID");
      exclusive(parsed, "protocol", "unknown-protocol");
      exclusive(parsed, "description", "clear-description");
      const protocol = flag(parsed, "unknown-protocol")
        ? null
        : stringOption(parsed, "protocol");
      const description = flag(parsed, "clear-description")
        ? null
        : stringOption(parsed, "description");
      return apply(
        context,
        parsed,
        "architecture interface update",
        (contract, now) =>
          updateArchitectureInterface(
            contract,
            id,
            {
              ...(protocol === undefined ? {} : { protocol }),
              ...(description === undefined ? {} : { description }),
            },
            now,
          ),
      );
    }
    case "remove": {
      const id = positional(parsed, 0, "INTERFACE_ID");
      return apply(
        context,
        parsed,
        "architecture interface remove",
        (contract, now) => removeArchitectureInterface(contract, id, now),
      );
    }
    default:
      throw new UsageError(
        `unknown architecture interface action "${action ?? ""}"; use add, update or remove`,
        ARCHITECTURE_USAGE,
      );
  }
}

async function confirmCommand(
  context: CommandContext,
  parsed: Parsed,
  kind: string | undefined,
): Promise<ExitCode> {
  const io = context.io;
  if (kind !== "node" && kind !== "relationship" && kind !== "binding") {
    throw new UsageError(
      `architecture confirm needs a target: node ID, relationship ID or binding DECISION_REF`,
      ARCHITECTURE_USAGE,
    );
  }
  const ref = positional(parsed, 0, kind === "binding" ? "DECISION_REF" : "ID");
  if (flag(parsed, "json")) {
    throw new UsageError(
      "architecture confirm has no machine-readable mode",
      ARCHITECTURE_USAGE,
    );
  }
  if (!io.interactive) {
    throw new WorkflowError(
      "confirmation needs an interactive terminal (stdin and stdout must both be a TTY); nothing was confirmed. An interactive terminal reduces accidental confirmation; it does not prove a person is present",
    );
  }
  const loaded = await openProject(io, parsed);
  const target = { kind, ref } as const;
  const described = describeArchitectureElement(loaded.contract, target);
  if (described.origin.kind !== "agent_proposed") {
    throw new WorkflowError(
      `architecture ${kind} "${ref}" was declared by the user; only agent-proposed elements are confirmed. Nothing was confirmed`,
    );
  }
  if (described.standing === "confirmed") {
    throw new WorkflowError(
      `architecture ${kind} "${ref}" is already confirmed for its current content; nothing was confirmed`,
    );
  }
  const proposalRef = described.origin.proposal_ref ?? "";
  const provenance = verifyArchitectureProvenance(loaded, proposalRef, {
    kind,
    id: ref,
  });
  if (!provenance.ok) {
    throw new WorkflowError(
      `cannot confirm architecture ${kind} "${ref}": ${provenance.reason}. Nothing was confirmed`,
    );
  }

  const hash = described.content_hash;
  io.stdout(
    lines(
      `Confirm agent-proposed architecture ${kind} ${ref}`,
      `  proposal: ${proposalRef} from ${provenance.record.adapter.id}, applied in committed revision r${provenance.entry.revision}`,
      `  standing now: ${described.standing}${described.standing === "confirmation_stale" ? ` (previously confirmed ${described.origin.confirmed_at}; its content has changed since)` : ""}`,
      "  content this confirmation covers:",
      JSON.stringify(architectureContent(described.element), null, 2)
        .split("\n")
        .map((line) => `    ${line}`),
      `  content hash (sha-256): ${hash}`,
      "",
      "Confirming records that you accept this exact content. The element stays attributed to its proposal. It does not approve any decision, make anything measured, or authorize any remote evaluation. An edit that changes this content clears the confirmation.",
    ),
  );
  const answer = await io.prompt(
    `\nTo confirm, type the first 12 characters of the content hash (${hash.slice(0, 4)}...). Press Enter to cancel: `,
  );
  if (answer === null || answer.trim() !== hash.slice(0, 12)) {
    throw new Cancelled(
      answer === null || answer.trim() === ""
        ? "Not confirmed; nothing was written."
        : "That does not match the content hash. Not confirmed; nothing was written.",
    );
  }
  const current = await loadProject(loaded.paths.root);
  if (current.digest !== loaded.digest) {
    throw new WorkflowError(
      "the project changed while you were reviewing; nothing was confirmed. Run the command again",
    );
  }
  const confirmedAt = io.clock();
  const result = confirmArchitectureElement(
    current.contract,
    target,
    hash,
    confirmedAt,
  );
  await commit(context, current, result.contract, {
    command: "architecture confirm",
    summary: result.summary,
    notices: result.notices,
    provenance: {
      kind: "architecture_confirmation",
      element: kind,
      ref,
      proposal_ref: proposalRef,
      proposal_state_revision: provenance.entry.revision,
      content_hash: hash,
      confirmed_at: confirmedAt,
    },
  });
  return EXIT.ok;
}

function originText(origin: {
  readonly kind: string;
  readonly proposal_ref: string | null;
  readonly confirmation: string;
  readonly confirmed_at: string | null;
}): string {
  if (origin.kind === "user") return "declared by user";
  const base = `agent-proposed (proposal ${origin.proposal_ref ?? "unknown"})`;
  return origin.confirmation === "confirmed"
    ? `${base}, confirmed ${origin.confirmed_at ?? ""}`
    : origin.confirmation === "confirmation_stale"
      ? `${base}, CONFIRMATION STALE (content changed since ${origin.confirmed_at ?? "confirmation"}); inferred`
      : `${base}, UNCONFIRMED; inferred`;
}

async function showArchitecture(
  context: CommandContext,
  parsed: Parsed,
): Promise<ExitCode> {
  const loaded = await openProject(context.io, parsed);
  // A local terminal: the local-disclosed projection, labelled as such.
  const facts = buildProjectFacts(loaded.contract, {
    asOf: context.io.clock(),
    projection: "local-disclosed",
  });
  if (flag(parsed, "json")) {
    writeJson(context.io, {
      source: facts.source,
      disclosure: facts.disclosure,
      architecture: facts.architecture,
    });
    return EXIT.ok;
  }
  const { nodes, relationships, conformance_rules } = facts.architecture;
  context.io.stdout(
    lines(
      `Architecture of ${facts.summary.name} (declared structure; authoritative in project.yaml)`,
      `  source: contract revision ${facts.source.contract_revision}, ${facts.source.contract_hash}; as of ${facts.source.as_of}`,
      `  ${facts.disclosure}`,
      "",
      "Nodes:",
      nodes.length === 0 ? ["  none declared (UNRESOLVED)"] : [],
      nodes.flatMap((node) => [
        `  ${node.id}  ${node.kind}  [${node.trust_boundary}${node.origin.trusted ? "" : ", effective: UNKNOWN"}]  ${node.name}`,
        `    origin:      ${originText(node.origin)}`,
        ...(node.interfaces.length === 0
          ? []
          : [
              `    interfaces:  ${node.interfaces.map((entry) => `${entry.id} (${entry.protocol ?? "protocol unknown"})`).join(", ")}`,
            ]),
        `    workloads associated through relationships: ${node.associated_workloads.join(", ") || "none"}`,
        `    decisions:   ${node.decisions.map((entry) => `${entry.decision_ref} (${entry.link}, ${entry.standing}${entry.authoritative ? "" : ", not authoritative"})`).join(", ") || "none"}`,
        `    constraints: ${[...new Set(node.constraints.map((entry) => entry.constraint_ref))].join(", ") || "none"}`,
        ...node.unresolved.map((entry) => `    UNRESOLVED:  ${entry}`),
        ...(node.local_repository_bindings ?? []).map(
          (binding) =>
            `    binding:     ${binding.id} ${binding.repository_root} ${binding.locations.join(", ")}`,
        ),
      ]),
      "",
      "Relationships:",
      relationships.length === 0 ? ["  none declared"] : [],
      relationships.flatMap((relationship) => [
        `  ${relationship.id}  ${relationship.source} -${relationship.kind}-> ${relationship.destination}`,
        `    origin:      ${originText(relationship.origin)}`,
        `    workload: ${relationship.workload_ref ?? "none"}; data: ${relationship.data_classification ?? "unknown"}${relationship.effective_crossing === "crossing" ? `; CROSSES ${relationship.crossing?.from ?? ""} -> ${relationship.crossing?.to ?? ""}` : relationship.effective_crossing === "unknown" ? `; crossing UNKNOWN${relationship.crossing === null ? "" : ` (declared ${relationship.crossing.from} -> ${relationship.crossing.to})`}` : ""}`,
        ...(relationship.source_interface_ref === null &&
        relationship.destination_interface_ref === null
          ? []
          : [
              `    interfaces:  ${relationship.source_interface_ref ?? "undeclared"} -> ${relationship.destination_interface_ref ?? "undeclared"}`,
            ]),
        `    decisions:   ${relationship.decisions.map((entry) => `${entry.decision_ref} (${entry.standing}${entry.authoritative ? "" : ", not authoritative"})`).join(", ") || "none"}`,
        `    constraints: ${[...new Set(relationship.constraints.map((entry) => entry.constraint_ref))].join(", ") || "none"}`,
        ...relationship.unresolved.map((entry) => `    UNRESOLVED:  ${entry}`),
      ]),
      "",
      "Decision bindings:",
      facts.architecture.decision_bindings.length === 0
        ? ["  none declared"]
        : facts.architecture.decision_bindings.map(
            (binding) =>
              `  ${binding.decision_ref} (${binding.standing}) -> ${binding.node_refs.join(", ")}; ${originText(binding.origin)}`,
          ),
      "",
      "Conformance rules (declared; not evaluated):",
      conformance_rules.length === 0 ? ["  none declared"] : [],
      conformance_rules.map((rule) => `  ${rule.id}: ${rule.statement}`),
    ),
  );
  return EXIT.ok;
}

async function validateArchitecture(
  context: CommandContext,
  parsed: Parsed,
): Promise<ExitCode> {
  // openProject already refuses a contract that does not parse and validate;
  // re-validating keeps the issue list for the report.
  const loaded = await openProject(context.io, parsed);
  const validation = validateProjectContract(loaded.contract);
  const issues = validation.ok
    ? []
    : validation.issues.filter((entry) =>
        entry.path.startsWith("architecture"),
      );
  let pathError: string | null = null;
  try {
    artifactPaths(loaded.contract);
  } catch (error) {
    if (!(error instanceof ArtifactPathError)) throw error;
    pathError = error.message;
  }
  const facts = buildProjectFacts(loaded.contract, {
    asOf: context.io.clock(),
  });
  const unresolved = [
    ...facts.architecture.nodes.flatMap((node) =>
      node.unresolved.map((entry) => `node ${node.id}: ${entry}`),
    ),
    ...facts.architecture.relationships.flatMap((relationship) =>
      relationship.unresolved.map(
        (entry) => `relationship ${relationship.id}: ${entry}`,
      ),
    ),
  ];
  if (facts.architecture.nodes.length === 0) {
    unresolved.unshift("no architecture nodes are declared");
  }
  const valid = validation.ok && pathError === null;
  const strict = flag(parsed, "strict");
  const ok = valid && (!strict || unresolved.length === 0);
  if (flag(parsed, "json")) {
    writeJson(context.io, {
      ok,
      valid,
      strict,
      source: facts.source,
      issues: validation.ok ? [] : validation.issues,
      generated_path_error: pathError,
      unresolved,
    });
  } else {
    context.io.stdout(
      lines(
        valid
          ? `Architecture is valid: ${facts.architecture.nodes.length} node(s), ${facts.architecture.relationships.length} relationship(s), ${loaded.contract.architecture.decision_bindings.length} decision binding(s).`
          : "Architecture is NOT valid.",
        renderIssues(issues),
        pathError === null ? [] : [`  generated views: ${pathError}`],
        unresolved.length === 0
          ? ["No unresolved architecture support."]
          : [
              `Unresolved (${unresolved.length})${strict ? "; --strict treats these as failures" : "; shown, not failures"}:`,
              ...unresolved.map((entry) => `  - ${entry}`),
            ],
      ),
    );
  }
  return ok ? EXIT.ok : EXIT.failed;
}

function projectionOption(parsed: Parsed): ProjectionName | undefined {
  const value = stringOption(parsed, "projection");
  if (value === undefined) return undefined;
  if (value !== "remote-default" && value !== "local-disclosed") {
    throw new UsageError(
      `--projection must be remote-default or local-disclosed, got "${value}"`,
      GENERATE_USAGE,
    );
  }
  return value;
}

export async function generateCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      "as-of": { type: "string" },
      refresh: { type: "boolean" },
      check: { type: "boolean" },
      projection: { type: "string" },
    },
    GENERATE_USAGE,
  );
  if (help(context, parsed, GENERATE_USAGE)) return EXIT.ok;
  const projection = projectionOption(parsed);
  const asOf = stringOption(parsed, "as-of");
  if (asOf !== undefined && flag(parsed, "refresh")) {
    throw new UsageError("give --as-of or --refresh, not both", GENERATE_USAGE);
  }
  const loaded = await openProject(context.io, parsed);
  const root = loaded.paths.root;

  if (flag(parsed, "check")) {
    if (asOf !== undefined || flag(parsed, "refresh")) {
      throw new UsageError(
        "--check takes no --as-of or --refresh",
        GENERATE_USAGE,
      );
    }
    let check;
    try {
      check = await checkGenerated({
        root,
        now: context.io.clock(),
        ...(projection === undefined ? {} : { projection }),
      });
    } catch (error) {
      if (error instanceof ArtifactPathError) {
        throw new WorkflowError(error.message);
      }
      throw error;
    }
    if (flag(parsed, "json")) {
      writeJson(context.io, check);
    } else {
      context.io.stdout(
        lines(
          `Generated output: ${check.status}`,
          check.artifacts.map(
            (artifact) => `  ${artifact.status.padEnd(16)} ${artifact.path}`,
          ),
          check.problems.map((problem) => `  problem: ${problem}`),
          check.notices.map((notice) => `  ${notice}`),
          check.ok
            ? []
            : check.status === "stale_time"
              ? [
                  '  The snapshot is not current. Take a new as_of with "anvilmark generate --refresh".',
                ]
              : ['  Regenerate with "anvilmark generate".'],
        ),
      );
    }
    return check.ok ? EXIT.ok : EXIT.failed;
  }

  let result;
  try {
    result = await generateArtifacts({
      root,
      clock: context.io.clock,
      ...(asOf === undefined ? {} : { asOf }),
      refresh: flag(parsed, "refresh"),
      ...(projection === undefined ? {} : { projection }),
    });
  } catch (error) {
    if (error instanceof ArtifactPathError) {
      throw new StoreError(`${error.message}; no generated output was changed`);
    }
    throw error;
  }
  const source = result.rendered.facts.source;
  const freshness = result.freshness;
  const historical = result.asOfBasis === "explicit";
  // A reused or recorded as_of that no longer reflects the present is a
  // failure of the ordinary workflow, even when no byte changed. An explicit
  // --as-of asks for a historical snapshot and succeeds, labelled as one.
  const staleOrdinary = freshness.status === "stale_time" && !historical;
  const standing =
    freshness.status === "current"
      ? "current"
      : historical
        ? "historical_snapshot"
        : "stale_time";
  if (flag(parsed, "json")) {
    writeJson(context.io, {
      status: standing,
      unchanged: result.unchanged,
      as_of: result.asOf,
      as_of_basis: result.asOfBasis,
      freshness,
      remediation: staleOrdinary ? "anvilmark generate --refresh" : null,
      written: result.written,
      manifest: result.rendered.manifest,
      warnings: result.warnings,
    });
  } else {
    const head = result.unchanged
      ? "Generated output already matches this snapshot; nothing was written."
      : `Generated ${result.written.length} file(s) from contract revision ${source.contract_revision} (${source.contract_hash}).`;
    context.io.stdout(
      lines(
        staleOrdinary
          ? [
              `STALE: the generated snapshot as of ${result.asOf} is not current at ${freshness.evaluated_at} (stale_time).`,
              ...freshness.differences.map((entry) => `  - ${entry}`),
              '  Take a new as_of with "anvilmark generate --refresh".',
            ]
          : [],
        head,
        `  as_of: ${result.asOf} (${result.asOfBasis === "reused" ? "reused from the manifest for this unchanged source" : historical ? "given with --as-of" : "taken from the clock and recorded"})`,
        freshness.status === "current"
          ? `  freshness: current at ${freshness.evaluated_at}`
          : historical
            ? [
                `  HISTORICAL SNAPSHOT: standings as of ${result.asOf}; at ${freshness.evaluated_at} they differ (stale_time):`,
                ...freshness.differences.map((entry) => `    - ${entry}`),
              ]
            : `  freshness: stale_time at ${freshness.evaluated_at}`,
        `  projection: ${source.projection}`,
        result.rendered.artifacts.map(
          (artifact) => `  ${artifact.path}  ${artifact.digest}`,
        ),
        `  ${result.rendered.manifestPath}`,
        result.warnings.map((warning) => `  warning: ${warning}`),
        source.projection === "local-disclosed"
          ? [
              "  notice: local-disclosed output includes local-only fields; do not send it to a remote model unless you intend to.",
            ]
          : [],
      ),
    );
  }
  return staleOrdinary ? EXIT.failed : EXIT.ok;
}
