import type { ProjectContract } from "@anvilmark/project-contract";
import {
  PROJECT_SCHEMA_VERSION,
  stableStringify,
} from "@anvilmark/project-contract";
import { contractHash } from "@anvilmark/context";

import type {
  AnalysisError,
  DeclarationRecord,
  LocationRecord,
  Observation,
  ProposedBinding,
  ScanContent,
  UnknownRecord,
} from "./artifact.js";
import { SCAN_STATEMENT, scanContentHash } from "./artifact.js";
import { proposeBindings } from "./binding.js";
import { RepositoryReader } from "./boundary.js";
import type { ScanConfig } from "./config.js";
import type { DeclarationSet } from "./declarations.js";
import { resolveDeclarations } from "./declarations.js";
import type { ObservationBundle } from "./evidence.js";
import {
  analysisErrorRecord,
  buildObservations,
  location,
} from "./evidence.js";
import type { FlowResult } from "./flow.js";
import { analyzeFlows } from "./flow.js";
import type { Inventory } from "./inventory.js";
import { buildInventory } from "./inventory.js";
import { compareStrings, sha256, stableId } from "./model.js";
import type { CompilerSetup } from "./program.js";
import { createCompilerSetup } from "./program.js";
import type { RecognizerSet } from "./recognizers/index.js";
import {
  defaultRecognizers,
  recognizerVersions,
  selectRecognizers,
} from "./recognizers/index.js";
import type { ImportFact } from "./resolution.js";
import { resolveImports } from "./resolution.js";
import type { SemanticFacts } from "./semantics.js";
import { analyzeSemantics } from "./semantics.js";
import {
  FLOW_MODEL,
  SCANNER_ID,
  SCANNER_VERSION,
  SCAN_ARTIFACT_FORMAT,
  TYPESCRIPT_VERSION,
} from "./version.js";

/**
 * The scan pipeline. Each stage is a replaceable implementation behind a
 * documented input/output interface; recognizers are a separate, replaceable
 * set of data. Stages only communicate through these values.
 */

export interface StageImplementation<Input, Output> {
  readonly id: string;
  readonly version: string;
  readonly run: (input: Input) => Output;
}

export interface InventoryInput {
  readonly reader: RepositoryReader;
  readonly config: ScanConfig;
  readonly recognizers: RecognizerSet;
}

export interface ResolutionInput extends InventoryInput {
  readonly inventory: Inventory;
}

export interface ResolutionOutput {
  readonly setup: CompilerSetup;
  readonly imports: readonly ImportFact[];
}

export interface SemanticInput {
  readonly reader: RepositoryReader;
  readonly config: ScanConfig;
  readonly contract: ProjectContract;
  readonly recognizers: RecognizerSet;
  readonly setup: CompilerSetup;
}

export interface SemanticOutput {
  readonly facts: SemanticFacts;
  readonly declarations: DeclarationSet;
}

export interface FlowInput {
  readonly reader: RepositoryReader;
  readonly recognizers: RecognizerSet;
  readonly setup: CompilerSetup;
  readonly semantic: SemanticOutput;
  readonly budget?: number;
}

export interface EvidenceInput {
  readonly imports: readonly ImportFact[];
  readonly semantic: SemanticOutput;
  readonly flows: FlowResult;
  readonly hashOf: (path: string) => string;
  readonly recognizers: RecognizerSet;
}

export interface BindingInput {
  readonly contract: ProjectContract;
  readonly recognizers: RecognizerSet;
  readonly semantic: SemanticOutput;
  readonly evidence: ObservationBundle;
  readonly repositoryRoot: string;
  readonly hashOf: (path: string) => string;
}

export interface ScanPipeline {
  readonly inventory: StageImplementation<InventoryInput, Inventory>;
  readonly resolution: StageImplementation<ResolutionInput, ResolutionOutput>;
  readonly semantics: StageImplementation<SemanticInput, SemanticOutput>;
  readonly flow: StageImplementation<FlowInput, FlowResult>;
  readonly evidence: StageImplementation<EvidenceInput, ObservationBundle>;
  readonly binding: StageImplementation<BindingInput, ProposedBinding[]>;
}

export const DEFAULT_PIPELINE: ScanPipeline = {
  inventory: {
    id: "inventory",
    version: "1",
    run: ({ reader, config, recognizers }) =>
      buildInventory(reader, config, recognizers),
  },
  resolution: {
    id: "typescript-program",
    version: "1",
    run: ({ reader, config, inventory, recognizers }) => {
      const setup = createCompilerSetup(reader, config, inventory);
      return { setup, imports: resolveImports(setup, reader, recognizers) };
    },
  },
  semantics: {
    id: "provider-semantics",
    version: "1",
    run: ({ reader, config, contract, recognizers, setup }) => ({
      facts: analyzeSemantics(setup, reader, recognizers),
      declarations: resolveDeclarations({
        setup,
        reader,
        config,
        contract,
        recognizers,
      }),
    }),
  },
  flow: {
    id: FLOW_MODEL.id,
    version: FLOW_MODEL.version,
    run: ({ reader, recognizers, setup, semantic, budget }) =>
      analyzeFlows({
        setup,
        reader,
        recognizers,
        declarations: semantic.declarations.flow,
        calls: semantic.facts.calls,
        ...(budget === undefined ? {} : { budget }),
      }),
  },
  evidence: {
    id: "source-evidence",
    version: "1",
    run: ({ imports, semantic, flows, hashOf, recognizers }) =>
      buildObservations({
        imports,
        semantics: semantic.facts,
        flows,
        hashOf,
        recognizers,
      }),
  },
  binding: {
    id: "proposed-bindings",
    version: "1",
    run: ({
      contract,
      recognizers,
      semantic,
      evidence,
      repositoryRoot,
      hashOf,
    }) => {
      const componentLocations = new Map<string, LocationRecord | null>();
      for (const record of semantic.declarations.records) {
        if (record.kind === "component") {
          componentLocations.set(
            record.id,
            record.span === null
              ? null
              : location(record.span, record.symbol, hashOf),
          );
        }
      }
      return proposeBindings({
        contract,
        declarations: semantic.declarations,
        observations: evidence.observations,
        semantics: semantic.facts,
        recognizers,
        repositoryRoot,
        componentLocations,
      });
    },
  },
};

export interface ScanInput {
  /** Absolute path of the repository to scan. */
  readonly repositoryPath: string;
  /** The project-relative reference recorded in the artifact. Never absolute. */
  readonly repositoryRoot: string;
  readonly repositoryDeclaredInContract: boolean;
  /** Directories never read, e.g. the project's `.anvilmark/`. */
  readonly deniedDirectories: readonly string[];
  readonly contract: ProjectContract;
  readonly stateRevision: number | null;
  readonly config: ScanConfig;
  readonly configSource:
    | {
        readonly source: "file";
        readonly path: string | null;
        readonly sha256: string;
      }
    | { readonly source: "default" };
  readonly recognizers?: RecognizerSet;
  /**
   * Called as each stage begins, for callers that show progress. It observes
   * the scan and cannot change it; a scan behaves identically without it.
   */
  readonly onStage?: (event: {
    readonly stage: keyof ScanPipeline;
    readonly sourceFiles: number;
  }) => void;
  readonly pipeline?: Partial<ScanPipeline>;
  readonly budget?: number;
  readonly maxFileBytes?: number;
}

export interface ScanOutcome {
  readonly content: ScanContent;
  readonly contentHash: string;
  /** Re-reads every repository input; returns the paths that changed. */
  readonly recheck: () => string[];
}

const ERROR_KINDS = new Set([
  "tsconfig_missing",
  "tsconfig_invalid",
  "compiler_option_error",
]);
const INCOMPLETE_LIMITS = new Set([
  "outside_repository_boundary",
  "file_too_large",
  "symlink_not_followed",
  "not_a_regular_file",
  "gitignore_pattern_not_applied",
  "nested_gitignore_not_applied",
  "include_path_missing",
  "project_references_not_followed",
  "recognizer_id_unknown",
]);

/**
 * Scan one repository. Reads through the bounded reader only; never writes,
 * runs a command, contacts a network, or changes the contract.
 */
export function scanRepository(input: ScanInput): ScanOutcome {
  const pipeline: ScanPipeline = { ...DEFAULT_PIPELINE, ...input.pipeline };
  const selection = selectRecognizers(
    input.recognizers ?? defaultRecognizers(),
    input.config.recognizers,
  );
  const recognizers = selection.set;
  const reader = new RepositoryReader({
    root: input.repositoryPath,
    deniedDirectories: input.deniedDirectories,
    ...(input.maxFileBytes === undefined
      ? {}
      : { maxFileBytes: input.maxFileBytes }),
  });

  const stage = (name: keyof ScanPipeline, sourceFiles: number): void =>
    input.onStage?.({ stage: name, sourceFiles });

  stage("inventory", 0);
  const inventory = pipeline.inventory.run({
    reader,
    config: input.config,
    recognizers,
  });
  const files = inventory.sourceFiles.length;
  stage("resolution", files);
  const resolution = pipeline.resolution.run({
    reader,
    config: input.config,
    recognizers,
    inventory,
  });
  stage("semantics", files);
  const semantic = pipeline.semantics.run({
    reader,
    config: input.config,
    contract: input.contract,
    recognizers,
    setup: resolution.setup,
  });
  stage("flow", files);
  const flows = pipeline.flow.run({
    reader,
    recognizers,
    setup: resolution.setup,
    semantic,
    ...(input.budget === undefined ? {} : { budget: input.budget }),
  });

  const hashes = new Map(
    reader.inputs().map((record) => [record.path, record.sha256]),
  );
  const hashOf = (path: string): string => {
    const found = hashes.get(path);
    if (found === undefined) {
      throw new Error(`internal error: no recorded hash for an observed file`);
    }
    return found;
  };
  stage("evidence", files);
  const evidence = pipeline.evidence.run({
    imports: resolution.imports,
    semantic,
    flows,
    hashOf,
    recognizers,
  });
  stage("binding", files);
  const bindings = pipeline.binding.run({
    contract: input.contract,
    recognizers,
    semantic,
    evidence,
    repositoryRoot: input.repositoryRoot,
    hashOf,
  });

  const unknowns: UnknownRecord[] = [...evidence.unknowns];
  for (const root of flows.budgetExceeded) {
    unknowns.push({
      id: stableId("unknown", ["flow", "analysis_budget_exceeded", root.span]),
      reason: "analysis_budget_exceeded",
      stage: "flow",
      location: location(root.span, root.symbol, hashOf),
      context: null,
      classifications: [],
      carries: "unresolved_data",
      ai_related: false,
      detail: [],
      observation_ref: null,
      trace: [],
    });
  }

  const analysisErrors: AnalysisError[] = [
    ...reader.failures().map((failure) =>
      analysisErrorRecord({
        kind: "file_read_error",
        path: failure.path,
        span: null,
        code: failure.code,
      }),
    ),
    ...resolution.setup.parseProblems.map((problem) =>
      analysisErrorRecord({
        kind: "parse_error",
        path: problem.span.path,
        span: problem.span,
        code: problem.code,
      }),
    ),
    ...inventory.manifestProblems.map((problem) =>
      analysisErrorRecord({
        kind: problem.kind,
        path: problem.path,
        span: null,
        code: null,
      }),
    ),
    ...resolution.setup.configProblems
      .filter((problem) => ERROR_KINDS.has(problem.kind))
      .map((problem) =>
        analysisErrorRecord({
          kind: problem.kind as AnalysisError["kind"],
          path: problem.path,
          span: null,
          code: problem.code,
        }),
      ),
  ];

  // Facts that do not limit completeness: TypeScript language-service
  // plugins only affect editors, never type checking; a repository outside
  // the contract's roots is scanned the same way.
  const NOTE_KINDS = new Set([
    "tsconfig_plugins_not_run",
    "repository_not_in_contract_repository_roots",
  ]);
  const allLimits = [
    ...reader
      .limits()
      .map((limit) => ({ kind: limit.kind, path: limit.path, detail: null })),
    ...inventory.limits.map((limit) => ({
      kind: limit.kind,
      path: limit.path,
      detail: limit.detail,
    })),
    ...resolution.setup.configProblems
      .filter((problem) => !ERROR_KINDS.has(problem.kind))
      .map((problem) => ({
        kind: problem.kind,
        path: problem.path,
        detail: null,
      })),
    ...selection.unknownIds.map((id) => ({
      kind: "recognizer_id_unknown",
      path: null,
      detail: id,
    })),
    ...(input.repositoryDeclaredInContract
      ? []
      : [
          {
            kind: "repository_not_in_contract_repository_roots",
            path: null,
            detail: null,
          },
        ]),
  ].sort(
    (left, right) =>
      compareStrings(left.kind, right.kind) ||
      compareStrings(left.path ?? "", right.path ?? "") ||
      compareStrings(left.detail ?? "", right.detail ?? ""),
  );
  const limits = allLimits.filter((limit) => !NOTE_KINDS.has(limit.kind));
  const notes = allLimits.filter((limit) => NOTE_KINDS.has(limit.kind));

  const declarations: DeclarationRecord[] = semantic.declarations.records
    .map((record) => {
      const config = input.config;
      const source = config.sources.find((entry) => entry.id === record.id);
      const sanitizer = config.sanitizers.find(
        (entry) => entry.id === record.id,
      );
      const sink = config.sinks.find((entry) => entry.id === record.id);
      const component = config.components.find(
        (entry) => entry.id === record.id,
      );
      return {
        id: record.id,
        kind: record.kind,
        status:
          record.problems.length === 0
            ? ("resolved" as const)
            : ("problem" as const),
        problems: [...new Set(record.problems)].sort(compareStrings),
        location:
          record.span === null
            ? null
            : location(record.span, record.symbol, hashOf),
        data_classification:
          source?.data_classification ?? sanitizer?.produces ?? null,
        clears: sanitizer?.clears ?? [],
        architecture_node: record.architectureNode,
        candidate_ref: sink?.candidate_ref ?? null,
        workload_ref: component?.workload_ref ?? null,
        recognizer: sink?.recognizer ?? null,
        component:
          component === undefined
            ? null
            : { path: component.path, export: component.export },
        sink:
          sink === undefined
            ? null
            : {
                operations: [...sink.operations],
                paths: [...sink.paths],
                models: sink.models === null ? null : [...sink.models],
                providers: sink.providers === null ? null : [...sink.providers],
              },
        discovery: "declared_mapping" as const,
        evidence_tier: "T1" as const,
      };
    })
    .sort((left, right) => compareStrings(left.id, right.id));

  const inputs = reader.inputs();
  const environment = new Map<
    string,
    {
      path: string;
      start: { line: number; column: number };
      end: { line: number; column: number };
    }[]
  >();
  for (const entry of semantic.facts.environment) {
    environment.set(entry.name, [
      ...(environment.get(entry.name) ?? []),
      entry.span,
    ]);
  }

  const incompleteLimits = limits.filter((limit) =>
    INCOMPLETE_LIMITS.has(limit.kind),
  );
  const declarationProblems = declarations.filter(
    (entry) => entry.status === "problem",
  );
  const reasons = [
    ...(analysisErrors.length > 0
      ? [`${analysisErrors.length} analysis error(s)`]
      : []),
    ...(unknowns.length > 0 ? [`${unknowns.length} unknown(s)`] : []),
    ...(incompleteLimits.length > 0
      ? [`${incompleteLimits.length} scope limit(s)`]
      : []),
    ...(declarationProblems.length > 0
      ? [`${declarationProblems.length} declaration problem(s)`]
      : []),
  ];

  const observations: Observation[] = evidence.observations;
  const content: ScanContent = {
    format: SCAN_ARTIFACT_FORMAT,
    scanner: {
      recognizer_configuration_hash: sha256(stableStringify(recognizers)),
      id: SCANNER_ID,
      version: SCANNER_VERSION,
      typescript_version: TYPESCRIPT_VERSION,
      flow_model: { ...FLOW_MODEL },
      stages: (
        [
          "inventory",
          "resolution",
          "semantics",
          "flow",
          "evidence",
          "binding",
        ] as const
      ).map((stage) => ({
        stage,
        id: pipeline[stage].id,
        version: pipeline[stage].version,
      })),
      recognizers: recognizerVersions(recognizers),
    },
    contract: {
      project_id: input.contract.project.id,
      schema_version: PROJECT_SCHEMA_VERSION,
      contract_revision: input.contract.project.contract_revision,
      contract_hash: contractHash(input.contract),
      state_revision: input.stateRevision,
    },
    repository: {
      root: input.repositoryRoot,
      snapshot_hash: sha256(stableStringify(inputs)),
      declared_in_contract: input.repositoryDeclaredInContract,
      inputs,
    },
    configuration: {
      normalized_sha256: sha256(stableStringify(input.config)),
      source: input.configSource.source,
      path:
        input.configSource.source === "file" ? input.configSource.path : null,
      sha256:
        input.configSource.source === "file" ? input.configSource.sha256 : null,
      include: [...input.config.include],
      exclude: [...input.config.exclude],
      recognizers:
        input.config.recognizers === null
          ? null
          : [...input.config.recognizers],
      compiler: {
        ...resolution.setup.summary,
        forced: [...resolution.setup.summary.forced],
      },
    },
    inventory: {
      source_file_count: inventory.sourceFiles.length,
      declaration_file_count: inventory.declarationFiles.length,
      manifests: inventory.manifests.map((entry) => ({
        ...entry,
        entry_points: [...entry.entry_points],
      })),
      lockfiles: [...inventory.lockfiles],
      ai_dependencies: [...inventory.dependencies],
      environment_variables: [...environment]
        .map(([name, locations]) => ({ name, locations }))
        .sort((left, right) => compareStrings(left.name, right.name)),
      excluded: [...inventory.excluded],
    },
    declarations,
    observations,
    data_flows: evidence.dataFlows,
    proposed_bindings: bindings,
    unknowns: unknowns.sort(
      (left, right) =>
        compareStrings(left.location.path, right.location.path) ||
        left.location.start.line - right.location.start.line ||
        left.location.start.column - right.location.start.column ||
        compareStrings(left.reason, right.reason) ||
        compareStrings(left.id, right.id),
    ),
    analysis_errors: [
      ...new Map(analysisErrors.map((entry) => [entry.id, entry])).values(),
    ].sort(
      (left, right) =>
        compareStrings(left.path ?? "", right.path ?? "") ||
        compareStrings(left.id, right.id),
    ),
    limits,
    notes,
    completeness: {
      status:
        reasons.length === 0 ? "complete_within_supported_scope" : "incomplete",
      reasons,
    },
    statement: SCAN_STATEMENT,
  };

  return {
    content,
    contentHash: scanContentHash(content),
    recheck: () => {
      const changed = new Set(reader.recheck());
      // Re-enumerate selected inputs as well as rehashing old inputs. The
      // compiler's existence probes above cover new resolution candidates.
      const fresh = pipeline.inventory.run({
        reader: new RepositoryReader({
          root: input.repositoryPath,
          deniedDirectories: input.deniedDirectories,
          ...(input.maxFileBytes === undefined
            ? {}
            : { maxFileBytes: input.maxFileBytes }),
        }),
        config: input.config,
        recognizers,
      });
      const paths = (value: Inventory) =>
        new Set([
          ...value.sourceFiles,
          ...value.declarationFiles,
          ...value.manifests.map((entry) => entry.path),
          ...value.lockfiles.map((entry) => entry.path),
        ]);
      const before = paths(inventory),
        after = paths(fresh);
      for (const path of new Set([...before, ...after]))
        if (before.has(path) !== after.has(path)) changed.add(path);
      return [...changed].sort(compareStrings);
    },
  };
}
