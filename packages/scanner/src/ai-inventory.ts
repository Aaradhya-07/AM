import type { ProjectContract } from "@anvilmark/project-contract";
import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  unwrap,
  validateProjectContract,
} from "@anvilmark/project-contract";

import type { Observation, ScanContent } from "./artifact.js";
import { defaultScanConfig } from "./config.js";
import { compareStrings } from "./model.js";
import type { RecognizerSet } from "./recognizers/index.js";
import { scanRepository } from "./scan.js";
import { SCANNER_ID, SCANNER_VERSION } from "./version.js";

/**
 * A zero-configuration AI usage inventory: which providers, models, endpoints
 * and call sites the scanner recognizes in a repository, which AI SDKs it
 * cannot inventory, and where it is uncertain.
 *
 * It needs no project, contract or declarations, and states no conformance
 * result. Environment variables are listed by NAME only; values are never
 * read. It is a summary of one scan's observations, so everything the scan
 * artifact says about completeness applies here too.
 */

export const AI_INVENTORY_FORMAT =
  "anvilmark-ai-inventory/0.1.0-draft.1" as const;

type Call = Extract<Observation, { kind: "provider_call" }>;

/**
 * Where a call's request goes: the provider its endpoint identifies, or why
 * that is not established.
 */
export type Destination =
  string | "runtime_selected" | "unlinked" | "unrecognized_host";

export interface InventoryCall {
  readonly path: string;
  readonly line: number;
  readonly symbol: string | null;
  readonly sdk: string;
  readonly operation: string;
  readonly operation_kind: Call["operation_kind"];
  readonly destination: Destination;
  readonly endpoint: Call["endpoint"];
  readonly model: string | null;
  readonly model_selection: Call["model"]["kind"];
}

export interface AiInventory {
  readonly format: typeof AI_INVENTORY_FORMAT;
  readonly scanner: { readonly id: string; readonly version: string };
  readonly repository: {
    readonly snapshot_hash: string;
    readonly source_file_count: number;
  };
  readonly destinations: readonly {
    readonly destination: Destination;
    readonly hosts: readonly string[];
    readonly deployments: readonly string[];
    readonly sdks: readonly string[];
    readonly operation_kinds: readonly string[];
    readonly call_count: number;
  }[];
  readonly models: readonly {
    /** The literal model id, or null when it is not a literal. */
    readonly model: string | null;
    readonly selection: Call["model"]["kind"];
    readonly destinations: readonly Destination[];
    readonly call_count: number;
  }[];
  readonly calls: readonly InventoryCall[];
  /** AI SDKs imported without a recognizer: their calls are not inventoried. */
  readonly unsupported_sdks: readonly {
    readonly package: string;
    readonly files: readonly string[];
  }[];
  readonly dependencies: readonly {
    readonly name: string;
    readonly declared: string;
    readonly installed_version: string | null;
    readonly manifest: string;
    readonly category: string;
  }[];
  /** Variable names read in files that import an AI SDK or call a provider. */
  readonly environment_variables: readonly {
    readonly name: string;
    readonly files: readonly string[];
  }[];
  readonly uncertainty: {
    readonly ai_related_unknowns: number;
    readonly by_reason: readonly {
      readonly reason: string;
      readonly count: number;
    }[];
    readonly locations: readonly {
      readonly reason: string;
      readonly path: string;
      readonly line: number;
      readonly detail: readonly string[];
      /** About a call or client listed above (its model or endpoint), not something missing from the list. */
      readonly listed_call: boolean;
    }[];
    /** Every unknown in the scan, including data-flow unknowns unrelated to AI. */
    readonly all_unknowns: number;
  };
  readonly completeness: ScanContent["completeness"];
  readonly limits: number;
  readonly analysis_errors: number;
  readonly statement: string;
}

export const AI_INVENTORY_STATEMENT =
  "This inventory lists the AI provider usage the scanner recognized in TypeScript and JavaScript source. It is not proof that nothing else reaches an AI provider: SDKs without a recognizer, other languages, and calls whose endpoint or client could not be established are listed as unsupported or uncertain, not inventoried.";

export function destinationOf(endpoint: Call["endpoint"]): Destination {
  if (endpoint.provider !== null) return endpoint.provider;
  if (endpoint.selection === "runtime_selected") return "runtime_selected";
  if (endpoint.selection === "unlinked") return "unlinked";
  return "unrecognized_host";
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/** Summarize one scan's content as an AI usage inventory. Pure. */
export function aiInventory(content: ScanContent): AiInventory {
  const calls = content.observations
    .filter((entry): entry is Call => entry.kind === "provider_call")
    .map((call): InventoryCall => ({
      path: call.location.path,
      line: call.location.start.line,
      symbol: call.location.symbol,
      sdk: call.recognizer,
      operation: call.operation,
      operation_kind: call.operation_kind,
      destination: destinationOf(call.endpoint),
      endpoint: call.endpoint,
      model: call.model.kind === "literal" ? call.model.value : null,
      model_selection: call.model.kind,
    }))
    .sort(
      (left, right) =>
        compareStrings(left.path, right.path) || left.line - right.line,
    );

  const destinations = sorted(calls.map((call) => call.destination)).map(
    (destination) => {
      const group = calls.filter((call) => call.destination === destination);
      return {
        destination,
        hosts: sorted(
          group.flatMap((call) =>
            call.endpoint.host === null ? [] : [call.endpoint.host],
          ),
        ),
        deployments: sorted(
          group.flatMap((call) =>
            call.endpoint.deployment === null ? [] : [call.endpoint.deployment],
          ),
        ),
        sdks: sorted(group.map((call) => call.sdk)),
        operation_kinds: sorted(group.map((call) => call.operation_kind)),
        call_count: group.length,
      };
    },
  );

  const modelKey = (call: InventoryCall) =>
    call.model === null ? `~${call.model_selection}` : `=${call.model}`;
  const models = sorted(
    calls.filter((call) => call.operation_kind !== "management").map(modelKey),
  ).map((key) => {
    const group = calls.filter(
      (call) => call.operation_kind !== "management" && modelKey(call) === key,
    );
    const first = group[0] as InventoryCall;
    return {
      model: first.model,
      selection: first.model_selection,
      destinations: sorted(group.map((call) => call.destination)),
      call_count: group.length,
    };
  });

  const imports = content.observations.filter(
    (entry): entry is Extract<Observation, { kind: "sdk_import" }> =>
      entry.kind === "sdk_import",
  );
  const unsupported_sdks = sorted(
    imports
      .filter((entry) => entry.category === "unsupported_ai_sdk")
      .map((entry) => entry.package),
  ).map((name) => ({
    package: name,
    files: sorted(
      imports
        .filter((entry) => entry.package === name)
        .map((entry) => entry.location.path),
    ),
  }));

  const aiFiles = new Set([
    ...calls.map((call) => call.path),
    ...imports
      .filter((entry) => entry.category !== "boundary")
      .map((entry) => entry.location.path),
    ...content.observations
      .filter((entry) => entry.kind === "client_instantiation")
      .map((entry) => entry.location.path),
  ]);
  const environment_variables = content.inventory.environment_variables
    .map((variable) => ({
      name: variable.name,
      files: sorted(
        variable.locations
          .map((span) => span.path)
          .filter((path) => aiFiles.has(path)),
      ),
    }))
    .filter((variable) => variable.files.length > 0)
    .sort((left, right) => compareStrings(left.name, right.name));

  const uncertain = content.unknowns.filter((unknown) => unknown.ai_related);
  const seen = new Set<string>();
  const listed = new Set(
    content.observations
      .filter(
        (entry) =>
          entry.kind === "provider_call" ||
          entry.kind === "client_instantiation",
      )
      .map((entry) => entry.id),
  );
  const locations: {
    reason: string;
    path: string;
    line: number;
    detail: readonly string[];
    listed_call: boolean;
  }[] = [];
  for (const unknown of uncertain) {
    const key = `${unknown.reason} ${unknown.location.path} ${unknown.location.start.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({
      reason: unknown.reason,
      path: unknown.location.path,
      line: unknown.location.start.line,
      detail: unknown.detail,
      listed_call:
        unknown.observation_ref !== null && listed.has(unknown.observation_ref),
    });
  }
  locations.sort(
    (left, right) =>
      compareStrings(left.path, right.path) ||
      left.line - right.line ||
      compareStrings(left.reason, right.reason),
  );

  return {
    format: AI_INVENTORY_FORMAT,
    scanner: { id: SCANNER_ID, version: SCANNER_VERSION },
    repository: {
      snapshot_hash: content.repository.snapshot_hash,
      source_file_count: content.inventory.source_file_count,
    },
    destinations,
    models,
    calls,
    unsupported_sdks,
    dependencies: content.inventory.ai_dependencies
      .map((dependency) => ({
        name: dependency.name,
        declared: dependency.declared,
        installed_version: dependency.installed_version,
        manifest: dependency.manifest,
        category: dependency.category,
      }))
      .sort(
        (left, right) =>
          compareStrings(left.name, right.name) ||
          compareStrings(left.manifest, right.manifest),
      ),
    environment_variables,
    uncertainty: {
      ai_related_unknowns: uncertain.length,
      by_reason: sorted(uncertain.map((unknown) => unknown.reason))
        .map((reason) => ({
          reason,
          count: locations.filter((entry) => entry.reason === reason).length,
        }))
        .sort(
          (left, right) =>
            right.count - left.count ||
            compareStrings(left.reason, right.reason),
        ),
      locations,
      all_unknowns: content.unknowns.length,
    },
    completeness: content.completeness,
    limits: content.limits.length,
    analysis_errors: content.analysis_errors.length,
    statement: AI_INVENTORY_STATEMENT,
  };
}

/**
 * The empty contract an inventory scan runs against. It has no nodes,
 * candidates or workloads, so nothing is bound and no decision is implied.
 */
function inventoryContract(): ProjectContract {
  return unwrap(
    validateProjectContract({
      schema: PROJECT_SCHEMA_ID,
      schema_version: PROJECT_SCHEMA_VERSION,
      project: {
        id: "ai-inventory",
        name: "AI usage inventory",
        created_at: "1970-01-01T00:00:00Z",
        updated_at: "1970-01-01T00:00:00Z",
        contract_revision: 1,
        state: "draft",
        repository_roots: [],
        owners: [],
        priority_order: [],
      },
      intent: {
        summary: "AI usage inventory without a project",
        users: [],
        outcomes: [],
        non_goals: [],
        unresolved_questions: [],
      },
      architecture: { authority: "anvilmark" },
    }),
  );
}

export interface AiInventoryInput {
  /** Absolute path of the repository. */
  readonly repositoryPath: string;
  /** Directories never read (for example a project's `.anvilmark/`). */
  readonly deniedDirectories?: readonly string[];
  readonly recognizers?: RecognizerSet;
  readonly budget?: number;
  /** Observes stage starts so a caller can show progress; changes nothing. */
  readonly onStage?: (event: {
    readonly stage: string;
    readonly sourceFiles: number;
  }) => void;
}

/**
 * Scan a repository with no project and no declarations and summarize what
 * it uses. Reads through the scanner's bounded reader only; writes nothing.
 */
export function inventoryRepository(input: AiInventoryInput): {
  readonly inventory: AiInventory;
  readonly content: ScanContent;
} {
  const outcome = scanRepository({
    repositoryPath: input.repositoryPath,
    repositoryRoot: ".",
    repositoryDeclaredInContract: true,
    deniedDirectories: input.deniedDirectories ?? [],
    contract: inventoryContract(),
    stateRevision: null,
    config: defaultScanConfig(),
    configSource: { source: "default" },
    ...(input.recognizers === undefined
      ? {}
      : { recognizers: input.recognizers }),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    ...(input.onStage === undefined ? {} : { onStage: input.onStage }),
  });
  return { inventory: aiInventory(outcome.content), content: outcome.content };
}
