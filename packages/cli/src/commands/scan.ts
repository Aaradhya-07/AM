import { resolve } from "node:path";

import { assertTimestamp } from "@anvilmark/context";
import type { EndpointRecord, ScanArtifact } from "@anvilmark/scanner";
import { draftDeclarations } from "@anvilmark/scanner";

import type { CliIo, ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines } from "../render.js";
import {
  SCAN_CONFIG_PATH,
  SCAN_OUTPUT_PATH,
  checkScan,
  prepareScan,
  readStoredScan,
  scanProject,
} from "../scan.js";
import { StoreError, findProjectRoot } from "../store.js";
import type { CommandContext, Parsed } from "./common.js";
import { UsageError, flag, parse, stringOption, writeJson } from "./common.js";

export const SCAN_USAGE = `Usage:
  anvilmark scan [--repository PATH] [--config FILE] [--observed-at TIMESTAMP] [--json]
  anvilmark scan --check [--repository PATH] [--config FILE] [--json]
  anvilmark scan show [--section NAME] [--all] [--json]
  anvilmark scan draft-config [--repository PATH] [--config FILE]

Scans one TypeScript/JavaScript repository locally with the TypeScript
compiler and writes ONE file:
  ${SCAN_OUTPUT_PATH}   observations, data flows, unknowns, proposed bindings

Inputs
  --repository PATH   the repository (default: repository_root in the declaration
                      file, else the contract's single repository root)
  --config FILE       scan declarations (default: ${SCAN_CONFIG_PATH} if present;
                      otherwise no sources, sanitizers, sinks or components)

Nothing is sent anywhere. The scanner never runs the repository's package
scripts, builds, executables or tsconfig plugins, never follows links or
imports outside the repository, and never reads .env files, dist/, vendor/,
node_modules sources or .anvilmark/. It does not change project.yaml,
decisions, approvals or repository bindings.

The artifact records observations, not conformance results. Unknowns and
analysis errors mark the scan incomplete; an empty result never means the
repository is safe. Rule evaluation is a later milestone.

observation.observed_at is --observed-at, else reused when the scan content is
unchanged (an unchanged rescan is byte-identical), else the clock.

Exit codes
  scan         0 the scan completed and the artifact is written or unchanged,
                 whatever it observed (unknowns included); 1 the scanner failed
                 or refused (invalid project or declarations, a missing
                 repository, a boundary refusal, inputs changed during the
                 scan); 2 usage error
  scan --check 0 the stored artifact matches a fresh scan; 1 missing, invalid,
                 tampered or stale (changes nothing)
  scan show    0 shown; 1 missing, invalid or tampered

Sections for show: summary (default), inventory, declarations, observations,
flows, bindings, unknowns, errors, limits, all

draft-config scans without declarations and prints a draft declaration file
built from the provider calls it observes: one sink per SDK, a component per
file, and commented suggestions for sources. It writes nothing; review it and
save it as .anvilmark/scanner.yaml yourself.

The unknowns section lists, once per location, the unknowns that concern AI
provider calls, declared data or unresolved imports; --all lists every
unknown. --json always returns the complete records.`;

type UnknownEntry = ScanArtifact["unknowns"][number];

/** Unknowns a reader should look at first; the rest stay in the artifact. */
export function relevantUnknown(unknown: UnknownEntry): boolean {
  return (
    unknown.ai_related ||
    unknown.carries === "declared_data" ||
    unknown.stage === "resolution" ||
    unknown.reason === "analysis_budget_exceeded"
  );
}

function formatEndpoint(endpoint: EndpointRecord): string {
  switch (endpoint.selection) {
    case "default":
      return `default ${endpoint.host ?? "endpoint"}${endpoint.provider === null ? "" : ` (${endpoint.provider})`}`;
    case "literal_override":
      return `${endpoint.host ?? "literal URL"} (${endpoint.provider ?? (endpoint.deployment === "local" ? "local runtime" : "unrecognized host")})`;
    case "runtime_selected":
      return `chosen at run time${endpoint.provider === null ? "" : ` (${endpoint.provider})`}`;
    default:
      return "client not linked";
  }
}

const SECTIONS = [
  "summary",
  "inventory",
  "declarations",
  "observations",
  "flows",
  "bindings",
  "unknowns",
  "errors",
  "limits",
  "all",
] as const;
type Section = (typeof SECTIONS)[number];

async function projectRoot(io: CliIo, parsed: Parsed): Promise<string> {
  const explicit = stringOption(parsed, "project-dir");
  const root =
    explicit === undefined
      ? await findProjectRoot(io.cwd)
      : resolve(io.cwd, explicit);
  if (root === null) {
    throw new StoreError(
      `no ANVILMARK project found in ${io.cwd} or any parent directory; run "anvilmark init" first`,
    );
  }
  return root;
}

function position(location: {
  path: string;
  start: { line: number; column: number };
}): string {
  return `${location.path}:${location.start.line}:${location.start.column}`;
}

function summaryLines(artifact: ScanArtifact): string[] {
  const calls = artifact.observations.filter(
    (entry) => entry.kind === "provider_call",
  );
  const clients = artifact.observations.filter(
    (entry) => entry.kind === "client_instantiation",
  );
  const statusCount = (status: string) =>
    artifact.data_flows.filter((flow) => flow.status === status).length;
  const discovery = (kind: string) =>
    artifact.proposed_bindings.filter((binding) => binding.discovery === kind)
      .length;
  return [
    `  repository:   ${artifact.repository.root}${artifact.repository.declared_in_contract ? "" : " (not in the contract's repository_roots)"}  snapshot ${artifact.repository.snapshot_hash}`,
    `  contract:     ${artifact.contract.project_id} revision ${artifact.contract.contract_revision}${artifact.contract.state_revision === null ? "" : ` (state r${artifact.contract.state_revision})`}  ${artifact.contract.contract_hash}`,
    `  declarations: ${artifact.configuration.source === "file" ? (artifact.configuration.path ?? "file outside the project") : "none (default)"}`,
    `  scanner:      ${artifact.scanner.id} ${artifact.scanner.version}, TypeScript ${artifact.scanner.typescript_version}, flow ${artifact.scanner.flow_model.id}/${artifact.scanner.flow_model.version} (call depth ${artifact.scanner.flow_model.call_depth})`,
    `  observed_at:  ${artifact.observation.observed_at} (${artifact.observation.basis})`,
    `  inventory:    ${artifact.inventory.source_file_count} source file(s), ${artifact.inventory.ai_dependencies.length} AI SDK dependenc${artifact.inventory.ai_dependencies.length === 1 ? "y" : "ies"}, ${artifact.inventory.excluded.length} exclusion(s)`,
    `  observed:     ${clients.length} client instantiation(s), ${calls.length} provider call(s)`,
    `  data reaching provider calls: ${statusCount("raw_reaches")} raw_reaches, ${statusCount("unresolved")} unresolved, ${statusCount("sanitized_only")} sanitized_only, ${statusCount("no_declared_data")} no_declared_data`,
    `  proposed bindings: ${artifact.proposed_bindings.length} (${discovery("declared_mapping")} declared_mapping, ${discovery("heuristic_association")} heuristic_association, ${discovery("unresolved")} unresolved)`,
    `  unknowns: ${artifact.unknowns.length} (${artifact.unknowns.filter(relevantUnknown).length} about AI calls, declared data or imports)   analysis errors: ${artifact.analysis_errors.length}   limits: ${artifact.limits.length}`,
    `  completeness: ${artifact.completeness.status}${artifact.completeness.reasons.length === 0 ? "" : ` (${artifact.completeness.reasons.join(", ")})`}`,
    "  These are observations and proposed bindings, not conformance results.",
  ];
}

function sectionLines(
  artifact: ScanArtifact,
  section: Section,
  everyUnknown: boolean,
): string[] {
  const out: string[] = [];
  const want = (name: Section) => section === name || section === "all";
  if (section === "summary" || section === "all")
    out.push("Summary", ...summaryLines(artifact));
  if (want("inventory")) {
    out.push("Inventory");
    for (const manifest of artifact.inventory.manifests) {
      out.push(
        `  manifest ${manifest.path}${manifest.name === null ? "" : ` (${manifest.name})`}${manifest.package_manager === null ? "" : ` packageManager ${manifest.package_manager}`}`,
      );
      for (const entry of manifest.entry_points)
        out.push(`    entry ${entry.field}: ${entry.path}`);
    }
    for (const lockfile of artifact.inventory.lockfiles)
      out.push(`  lockfile ${lockfile.path} (${lockfile.package_manager})`);
    for (const dependency of artifact.inventory.ai_dependencies) {
      out.push(
        `  dependency ${dependency.name} ${dependency.declared} [${dependency.category}] installed ${dependency.installed_version ?? "no"} (${dependency.manifest})`,
      );
    }
    for (const variable of artifact.inventory.environment_variables) {
      out.push(
        `  env ${variable.name} (name only) at ${variable.locations.map(position).join(", ")}`,
      );
    }
    for (const excluded of artifact.inventory.excluded)
      out.push(`  excluded ${excluded.path} (${excluded.reason})`);
  }
  if (want("declarations")) {
    out.push("Declarations");
    for (const declaration of artifact.declarations) {
      out.push(
        `  ${declaration.kind} ${declaration.id}: ${declaration.status}${declaration.location === null ? "" : ` at ${position(declaration.location)}`}${declaration.architecture_node?.ref ? ` -> ${declaration.architecture_node.ref} (${declaration.architecture_node.standing})` : ""}${declaration.problems.length === 0 ? "" : ` [${declaration.problems.join(", ")}]`}`,
      );
    }
  }
  if (want("observations")) {
    out.push("Observations");
    for (const observation of artifact.observations) {
      const detail =
        observation.kind === "provider_call"
          ? `${observation.provider} ${observation.operation} [${observation.operation_kind}] to ${formatEndpoint(observation.endpoint)} model ${observation.model.kind === "literal" ? observation.model.value : observation.model.kind}`
          : observation.kind === "client_instantiation"
            ? `${observation.provider} ${observation.owner} endpoint ${formatEndpoint(observation.endpoint)}`
            : `${observation.package} (${observation.import_kind})`;
      out.push(
        `  ${observation.id} ${observation.kind} ${detail} at ${position(observation.location)}${observation.location.symbol === null ? "" : ` in ${observation.location.symbol}`} [${observation.discovery}, ${observation.evidence_tier}]`,
      );
    }
  }
  if (want("flows")) {
    out.push("Data flows");
    for (const flow of artifact.data_flows) {
      out.push(
        `  ${flow.id} for ${flow.observation_ref}: ${flow.status}${flow.classifications.length === 0 ? "" : ` ${flow.classifications.join(", ")}`}${flow.unknown_reasons.length === 0 ? "" : ` unknown: ${flow.unknown_reasons.join(", ")}`} [${flow.evidence_tier}]`,
      );
      for (const context of flow.contexts) {
        out.push(
          `    ${context.kind} from ${context.root.symbol ?? context.root.path}${context.call_site === null ? "" : ` via ${position(context.call_site)}`}: ${context.status}${context.superseded ? " (superseded by direct calls)" : ""}`,
        );
        for (const fact of context.facts) {
          out.push(
            `      ${fact.classification} ${fact.state}${fact.conditional ? " on some paths" : ""}: ${fact.trace.map((step) => `${step.kind}@${step.start.line}`).join(" -> ")}`,
          );
        }
      }
      if (flow.caveats.length > 0)
        out.push(`    caveats: ${flow.caveats.join(", ")}`);
    }
  }
  if (want("bindings")) {
    out.push("Proposed bindings (not recorded in the contract)");
    for (const binding of artifact.proposed_bindings) {
      out.push(
        `  ${binding.id} at ${position(binding.location)} [${binding.discovery}, confidence ${binding.confidence ?? "none"}, ${binding.evidence_tier}]`,
      );
      out.push(
        `    component ${binding.component.ref ?? "unbound"}${binding.component.standing === null ? "" : ` (${binding.component.standing})`}; provider node ${binding.provider_node.ref ?? "unbound"} (${binding.provider_node.association}); workload ${binding.workload.ref ?? "unbound"}; candidate ${binding.candidate.ref ?? "unbound"}`,
      );
      out.push(
        `    decision ${binding.decision.ref ?? "unbound"}${binding.decision.ref === null ? "" : ` (${binding.decision.status}, approval ${binding.decision.approval_state}, selected ${binding.decision.selected_candidate_ref ?? "none"})`}`,
      );
      if (binding.unbound_reasons.length > 0)
        out.push(`    unbound: ${binding.unbound_reasons.join(", ")}`);
    }
  }
  if (want("unknowns")) {
    const shown = everyUnknown
      ? artifact.unknowns
      : artifact.unknowns.filter(relevantUnknown);
    const lines = new Map<string, string>();
    for (const unknown of shown) {
      const line = `  ${unknown.reason} [${unknown.stage}] at ${position(unknown.location)}${unknown.classifications.length === 0 ? "" : ` carrying ${unknown.classifications.join(", ")}`}${unknown.detail.length === 0 ? "" : ` (${unknown.detail.join(", ")})`}`;
      // The same unknown reached from several analysis roots is listed once.
      lines.set(line, line);
    }
    out.push(
      everyUnknown
        ? `Unknowns (all ${artifact.unknowns.length})`
        : `Unknowns about AI calls, declared data or imports (${lines.size} location(s); ${artifact.unknowns.length} record(s) in total, --all lists every one)`,
      ...lines.values(),
    );
  }
  if (want("errors")) {
    out.push("Analysis errors");
    for (const error of artifact.analysis_errors) {
      out.push(
        `  ${error.kind} ${error.path ?? ""}${error.span === null ? "" : `:${error.span.start.line}:${error.span.start.column}`}${error.code === null ? "" : ` ${error.code}`}`,
      );
    }
  }
  if (want("limits")) {
    out.push("Limits");
    for (const limit of artifact.limits) {
      out.push(
        `  ${limit.kind}${limit.path === null ? "" : ` ${limit.path}`}${limit.detail === null ? "" : ` (${limit.detail})`}`,
      );
    }
  }
  return out;
}

export async function scanCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  if (sub !== undefined && sub !== "show" && sub !== "draft-config") {
    throw new UsageError(`unknown scan subcommand "${sub}"`, SCAN_USAGE);
  }
  if (sub === "draft-config") {
    const draftParsed = parse(
      context.args,
      { repository: { type: "string" }, config: { type: "string" } },
      SCAN_USAGE,
    );
    if (flag(draftParsed, "help")) {
      context.io.stdout(`${SCAN_USAGE}\n`);
      return EXIT.ok;
    }
    const draftRoot = await projectRoot(context.io, draftParsed);
    const repositoryOption = stringOption(draftParsed, "repository");
    const configOption = stringOption(draftParsed, "config");
    const showProgress =
      !flag(draftParsed, "json") && Boolean(process.stderr?.isTTY);
    const prepared = await prepareScan({
      root: draftRoot,
      clock: context.io.clock,
      withoutDeclarations: true,
      ...(showProgress
        ? {
            onProgress: (message: string) => context.io.stderr(`${message}\n`),
          }
        : {}),
      ...(repositoryOption === undefined
        ? {}
        : { repository: resolve(context.io.cwd, repositoryOption) }),
      ...(configOption === undefined
        ? {}
        : { config: resolve(context.io.cwd, configOption) }),
    });
    context.io.stdout(
      draftDeclarations({
        content: prepared.outcome.content,
        contract: prepared.contract,
        repositoryRoot: prepared.repositoryRoot,
      }),
    );
    return EXIT.ok;
  }
  const parsed = parse(
    context.args,
    sub === "show"
      ? { section: { type: "string" }, all: { type: "boolean" } }
      : {
          repository: { type: "string" },
          config: { type: "string" },
          "observed-at": { type: "string" },
          check: { type: "boolean" },
        },
    SCAN_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${SCAN_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected argument "${parsed.positionals[0]}"`,
      SCAN_USAGE,
    );
  }
  const root = await projectRoot(context.io, parsed);
  const json = flag(parsed, "json");

  if (sub === "show") {
    const section = (stringOption(parsed, "section") ?? "summary") as Section;
    if (!SECTIONS.includes(section)) {
      throw new UsageError(
        `--section must be one of ${SECTIONS.join(", ")}`,
        SCAN_USAGE,
      );
    }
    const stored = await readStoredScan(root);
    if (stored.status !== "valid") {
      const message =
        stored.status === "missing"
          ? `no scan artifact at ${SCAN_OUTPUT_PATH}; run "anvilmark scan"`
          : stored.status === "invalid"
            ? `${SCAN_OUTPUT_PATH} is not a valid scan artifact (${stored.problem}); run "anvilmark scan"`
            : `${SCAN_OUTPUT_PATH} does not match its own content hash; it was edited after the scan. Run "anvilmark scan"`;
      if (json)
        writeJson(context.io, {
          status: stored.status,
          path: SCAN_OUTPUT_PATH,
        });
      else context.io.stderr(lines(`error: ${message}`));
      return EXIT.failed;
    }
    const artifact = stored.artifact;
    if (json) {
      const pick: Record<Section, unknown> = {
        all: artifact,
        summary: {
          content_hash: artifact.content_hash,
          observation: artifact.observation,
          contract: artifact.contract,
          repository: {
            root: artifact.repository.root,
            snapshot_hash: artifact.repository.snapshot_hash,
            declared_in_contract: artifact.repository.declared_in_contract,
          },
          completeness: artifact.completeness,
          statement: artifact.statement,
        },
        inventory: artifact.inventory,
        declarations: artifact.declarations,
        observations: artifact.observations,
        flows: artifact.data_flows,
        bindings: artifact.proposed_bindings,
        unknowns: artifact.unknowns,
        errors: artifact.analysis_errors,
        limits: artifact.limits,
      };
      writeJson(context.io, pick[section]);
    } else {
      context.io.stdout(
        lines(
          `Repository scan ${SCAN_OUTPUT_PATH}`,
          sectionLines(artifact, section, flag(parsed, "all")),
        ),
      );
    }
    return EXIT.ok;
  }

  const repositoryOption = stringOption(parsed, "repository");
  const configOption = stringOption(parsed, "config");
  const showProgress = !json && Boolean(process.stderr?.isTTY);
  const inputs = {
    root,
    clock: context.io.clock,
    ...(showProgress
      ? {
          onProgress: (message: string) => context.io.stderr(`${message}\n`),
        }
      : {}),
    ...(repositoryOption === undefined
      ? {}
      : { repository: resolve(context.io.cwd, repositoryOption) }),
    ...(configOption === undefined
      ? {}
      : { config: resolve(context.io.cwd, configOption) }),
  };

  if (flag(parsed, "check")) {
    if (stringOption(parsed, "observed-at") !== undefined) {
      throw new UsageError("--check takes no --observed-at", SCAN_USAGE);
    }
    const check = await checkScan(inputs);
    if (json) writeJson(context.io, { path: SCAN_OUTPUT_PATH, ...check });
    else {
      context.io.stdout(
        lines(
          `Repository scan ${SCAN_OUTPUT_PATH}: ${check.status}`,
          check.reasons.map((reason) => `  ${reason}`),
          check.status === "current" ? [] : ['  Rescan with "anvilmark scan".'],
        ),
      );
    }
    return check.status === "current" ? EXIT.ok : EXIT.failed;
  }

  const observedAt = stringOption(parsed, "observed-at");
  if (observedAt !== undefined) {
    try {
      assertTimestamp(observedAt);
    } catch {
      throw new UsageError(
        `--observed-at must be an RFC 3339 timestamp with an explicit offset, e.g. 2026-09-15T00:00:00Z`,
        SCAN_USAGE,
      );
    }
  }
  const result = await scanProject({
    ...inputs,
    ...(observedAt === undefined ? {} : { observedAt }),
  });
  if (json) {
    writeJson(context.io, {
      status: result.unchanged ? "unchanged" : "written",
      path: result.path,
      content_hash: result.artifact.content_hash,
      observation: result.artifact.observation,
      observed_at_basis: result.basis,
      completeness: result.artifact.completeness,
      counts: {
        observations: result.artifact.observations.length,
        data_flows: result.artifact.data_flows.length,
        proposed_bindings: result.artifact.proposed_bindings.length,
        unknowns: result.artifact.unknowns.length,
        analysis_errors: result.artifact.analysis_errors.length,
        limits: result.artifact.limits.length,
      },
      statement: result.artifact.statement,
    });
  } else {
    context.io.stdout(
      lines(
        `Repository scan ${result.unchanged ? "unchanged" : "written"}: ${result.path}`,
        summaryLines(result.artifact),
        '  Inspect with "anvilmark scan show --section observations|flows|bindings|unknowns".',
      ),
    );
  }
  return EXIT.ok;
}
