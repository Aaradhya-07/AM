import { z } from "zod/v4";

import {
  DataClassificationSchema,
  RefSchema,
  RelativePathSchema,
  TimestampSchema,
  prettyStringify,
  stableStringify,
} from "@anvilmark/project-contract";

import { DISCOVERY_KINDS, UNKNOWN_REASONS, sha256 } from "./model.js";
import { SCAN_ARTIFACT_FORMAT } from "./version.js";

/**
 * The versioned LOCAL repository-scan artifact
 * (`anvilmark-repository-scan/0.1.0-draft.1`).
 *
 * This is not a project-contract schema. The draft.5 `RepositoryBinding` has
 * no spans, source hashes, traces or unknown reasons; this artifact keeps
 * them, and `toContractRepositoryBinding` projects a binding onto the draft.5
 * shape only where that shape can represent it honestly.
 *
 * `content_hash` covers every field except `content_hash` and `observation`.
 * `observation.observed_at` is the only time-derived value, so identical
 * inputs produce identical content, and the CLI reuses the previous
 * observation for identical content to keep repeated scans byte-stable.
 */

const PositionSchema = z.strictObject({
  line: z.int().positive(),
  column: z.int().positive(),
});

const RepoPathSchema = z.string().min(1);
const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const TierSchema = z.enum(["T0", "T1", "T2", "T3"]);

export const SpanSchema = z.strictObject({
  path: RepoPathSchema,
  start: PositionSchema,
  end: PositionSchema,
});

export const LocationSchema = z.strictObject({
  path: RepoPathSchema,
  symbol: z.string().nullable(),
  start: PositionSchema,
  end: PositionSchema,
  source_sha256: Sha256Schema,
});

export const TraceStepSchema = z.strictObject({
  kind: z.enum([
    "source",
    "parameter_source",
    "assignment",
    "argument",
    "return",
    "sanitizer",
    "sink",
  ]),
  path: RepoPathSchema,
  start: PositionSchema,
  end: PositionSchema,
  symbol: z.string().nullable(),
  declaration_ref: z.string().nullable(),
});

const UnknownReasonSchema = z.enum(UNKNOWN_REASONS);
const DiscoverySchema = z.enum(DISCOVERY_KINDS);

const ContextRootSchema = z.strictObject({
  path: RepoPathSchema,
  symbol: z.string().nullable(),
  start: PositionSchema,
  end: PositionSchema,
});

export const FlowFactSchema = z.strictObject({
  classification: DataClassificationSchema,
  state: z.enum(["raw", "sanitized"]),
  derived_from: DataClassificationSchema.nullable(),
  declaration_ref: z.string(),
  conditional: z.boolean(),
  trace: z.array(TraceStepSchema),
});

export const FlowUnknownSchema = z.strictObject({
  reason: UnknownReasonSchema,
  detail: z.string().nullable(),
  conditional: z.boolean(),
  at: SpanSchema,
  trace: z.array(TraceStepSchema),
});

export const DataReachingStatusSchema = z.enum([
  /** A raw declared classification reaches the call on at least one path. */
  "raw_reaches",
  /** Some of what reaches the call could not be established. */
  "unresolved",
  /** Only sanitized classifications reach the call, through declared sanitizers. */
  "sanitized_only",
  /** No declared classification was observed reaching the call. */
  "no_declared_data",
]);

export const FlowContextSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["intraprocedural", "module", "direct_call"]),
  root: ContextRootSchema,
  call_site: SpanSchema.nullable(),
  status: DataReachingStatusSchema,
  superseded: z.boolean(),
  facts: z.array(FlowFactSchema),
  unknowns: z.array(FlowUnknownSchema),
});

const AssumptionSchema = z.strictObject({
  kind: z.enum([
    "declared_source",
    "declared_sanitizer",
    "declared_sources_complete",
  ]),
  declaration_ref: z.string().nullable(),
  evidence_tier: z.literal("T1"),
});

export const DataFlowRecordSchema = z.strictObject({
  id: z.string(),
  transport_scope: z.literal("modeled_request_inputs"),
  observation_ref: z.string(),
  status: DataReachingStatusSchema,
  classifications: z.array(z.string()),
  unknown_reasons: z.array(UnknownReasonSchema),
  contexts: z.array(FlowContextSchema),
  trace_tier: z.literal("T3").nullable(),
  assumptions: z.array(AssumptionSchema),
  evidence_tier: TierSchema,
  caveats: z.array(z.string()),
});

export const EndpointSchema = z.strictObject({
  selection: z.enum([
    "default",
    "literal_override",
    "runtime_selected",
    "unlinked",
  ]),
  host: z.string().nullable(),
  provider: z.string().nullable(),
  deployment: z.enum(["managed_api", "local"]).nullable(),
});

const OperationKindSchema = z.enum([
  "inference",
  "embedding",
  "data_upload",
  "management",
]);

const ModelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.string() }),
  z.strictObject({ kind: z.literal("redacted_suspected_secret") }),
  z.strictObject({ kind: z.literal("runtime_selected") }),
  z.strictObject({ kind: z.literal("absent") }),
]);

export const ObservationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: z.string(),
    kind: z.literal("sdk_import"),
    location: LocationSchema,
    import_kind: z.enum([
      "static",
      "re_export",
      "import_equals",
      "require",
      "dynamic",
    ]),
    package: z.string(),
    category: z.enum(["provider_sdk", "unsupported_ai_sdk", "boundary"]),
    recognizer: z.string().nullable(),
    discovery: z.literal("deterministic_observation"),
    evidence_tier: z.literal("T3"),
  }),
  z.strictObject({
    id: z.string(),
    kind: z.literal("client_instantiation"),
    location: LocationSchema,
    recognizer: z.string(),
    provider: z.string(),
    owner: z.string(),
    default_deployment: z.enum(["managed_api", "local"]),
    endpoint: EndpointSchema,
    discovery: z.literal("deterministic_observation"),
    evidence_tier: z.literal("T3"),
    caveats: z.array(z.string()),
  }),
  z.strictObject({
    id: z.string(),
    kind: z.literal("provider_call"),
    location: LocationSchema,
    recognizer: z.string(),
    provider: z.string(),
    operation: z.string(),
    operation_kind: OperationKindSchema,
    owner: z.string().nullable(),
    model: ModelSchema,
    client_ref: z.string().nullable(),
    default_deployment: z.enum(["managed_api", "local"]),
    /** Where the request goes: `provider` above is the SDK vendor. */
    endpoint: EndpointSchema,
    linkage: z.enum([
      "client",
      "clients",
      "repository_uniform",
      "factory",
      "http",
      "unlinked",
    ]),
    data_flow_ref: z.string(),
    discovery: z.literal("deterministic_observation"),
    evidence_tier: z.literal("T3"),
    caveats: z.array(z.string()),
  }),
]);

const ArchitectureStandingSchema = z.enum([
  "user_declared",
  "unconfirmed",
  "confirmed",
  "confirmation_stale",
]);

const AssociationSchema = z.enum([
  "declared_mapping",
  "heuristic_association",
  "unbound",
]);

const NodeAssociationSchema = z.strictObject({
  ref: RefSchema.nullable(),
  association: AssociationSchema,
  declaration_ref: z.string().nullable(),
  trust_boundary: z.string().nullable(),
  standing: ArchitectureStandingSchema.nullable(),
  /** `architectureContentHash` of the node at scan time (the confirmation hash format). */
  content_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  trusted: z.boolean().nullable(),
});

export const ProposedBindingSchema = z.strictObject({
  id: z.string(),
  observation_ref: z.string(),
  client_ref: z.string().nullable(),
  data_flow_ref: z.string(),
  repository_root: RelativePathSchema,
  location: LocationSchema,
  component: NodeAssociationSchema,
  provider_node: NodeAssociationSchema,
  workload: z.strictObject({
    ref: RefSchema.nullable(),
    association: AssociationSchema,
    declaration_ref: z.string().nullable(),
  }),
  candidate: z.strictObject({
    ref: RefSchema.nullable(),
    association: AssociationSchema,
    declaration_ref: z.string().nullable(),
  }),
  decision: z.strictObject({
    ref: RefSchema.nullable(),
    association: z.enum(["contract_workload_decision", "unbound"]),
    status: z.string().nullable(),
    approval_state: z
      .enum(["none", "current", "stale", "unresolvable"])
      .nullable(),
    selected_candidate_ref: RefSchema.nullable(),
  }),
  discovery: DiscoverySchema,
  confidence: z.enum(["high", "medium", "low"]).nullable(),
  evidence_tier: TierSchema,
  unbound_reasons: z.array(z.string()),
  contract_projection: z.strictObject({
    eligible: z.boolean(),
    discovery_kind: z.literal("deterministic").nullable(),
    reasons: z.array(z.string()),
  }),
});

export const UnknownRecordSchema = z.strictObject({
  id: z.string(),
  reason: UnknownReasonSchema,
  stage: z.enum(["resolution", "semantics", "flow"]),
  location: LocationSchema,
  context: z
    .strictObject({
      kind: z.enum(["intraprocedural", "module", "direct_call"]),
      root: ContextRootSchema,
      call_site: SpanSchema.nullable(),
    })
    .nullable(),
  classifications: z.array(z.string()),
  /**
   * What reached this point: declared classifications, values the analysis
   * could not establish, nothing tracked, or not applicable (resolution and
   * semantic unknowns are not data-flow events).
   */
  carries: z.enum([
    "declared_data",
    "unresolved_data",
    "no_tracked_data",
    "not_applicable",
  ]),
  /** The unknown concerns an AI provider call, endpoint, model or SDK. */
  ai_related: z.boolean(),
  detail: z.array(z.string()),
  observation_ref: z.string().nullable(),
  trace: z.array(TraceStepSchema),
});

export const AnalysisErrorSchema = z.strictObject({
  id: z.string(),
  kind: z.enum([
    "file_read_error",
    "parse_error",
    "manifest_unreadable",
    "manifest_invalid_json",
    "tsconfig_missing",
    "tsconfig_invalid",
    "compiler_option_error",
  ]),
  path: z.string().nullable(),
  span: SpanSchema.nullable(),
  code: z.string().nullable(),
});

export const LimitSchema = z.strictObject({
  kind: z.string(),
  path: z.string().nullable(),
  detail: z.string().nullable(),
});

export const DeclarationRecordSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(["source", "sanitizer", "sink", "component"]),
  status: z.enum(["resolved", "problem"]),
  problems: z.array(z.string()),
  location: LocationSchema.nullable(),
  data_classification: DataClassificationSchema.nullable(),
  clears: z.array(DataClassificationSchema),
  architecture_node: NodeAssociationSchema.nullable(),
  candidate_ref: RefSchema.nullable(),
  workload_ref: RefSchema.nullable(),
  recognizer: z.string().nullable(),
  /** The declared file and export of a component, null for other kinds. */
  component: z
    .strictObject({ path: z.string(), export: z.string().nullable() })
    .nullable(),
  /** Sink scope and declared runtime values (T1 statements), null for other kinds. */
  sink: z
    .strictObject({
      operations: z.array(z.string()),
      paths: z.array(z.string()),
      models: z.array(z.string()).nullable(),
      providers: z.array(z.string()).nullable(),
    })
    .nullable(),
  discovery: z.literal("declared_mapping"),
  evidence_tier: z.literal("T1"),
});

export const ScanArtifactSchema = z.strictObject({
  format: z.literal(SCAN_ARTIFACT_FORMAT),
  content_hash: Sha256Schema,
  observation: z.strictObject({
    observed_at: TimestampSchema,
    basis: z.enum(["explicit", "reused", "clock"]),
  }),
  scanner: z.strictObject({
    recognizer_configuration_hash: Sha256Schema,
    id: z.string(),
    version: z.string(),
    typescript_version: z.string(),
    flow_model: z.strictObject({
      id: z.string(),
      version: z.string(),
      call_depth: z.int(),
    }),
    stages: z.array(
      z.strictObject({
        stage: z.string(),
        id: z.string(),
        version: z.string(),
      }),
    ),
    recognizers: z.array(
      z.strictObject({ id: z.string(), version: z.string(), kind: z.string() }),
    ),
  }),
  contract: z.strictObject({
    project_id: z.string(),
    schema_version: z.string(),
    contract_revision: z.int(),
    contract_hash: Sha256Schema,
    state_revision: z.int().nullable(),
  }),
  repository: z.strictObject({
    root: RelativePathSchema,
    snapshot_hash: Sha256Schema,
    declared_in_contract: z.boolean(),
    inputs: z.array(
      z.strictObject({
        path: z.string(),
        sha256: Sha256Schema,
        role: z.string(),
      }),
    ),
  }),
  configuration: z.strictObject({
    normalized_sha256: Sha256Schema,
    source: z.enum(["file", "default"]),
    path: z.string().nullable(),
    sha256: Sha256Schema.nullable(),
    include: z.array(z.string()),
    exclude: z.array(z.string()),
    recognizers: z.array(z.string()).nullable(),
    compiler: z.strictObject({
      tsconfig: z.string().nullable(),
      root_files: z.literal("scan_inventory"),
      options: z.strictObject({
        target: z.string().nullable(),
        module: z.string().nullable(),
        module_resolution: z.string().nullable(),
        jsx: z.string().nullable(),
        strict: z.boolean(),
        paths_configured: z.boolean(),
      }),
      forced: z.array(z.string()),
    }),
  }),
  inventory: z.strictObject({
    source_file_count: z.int(),
    declaration_file_count: z.int(),
    manifests: z.array(
      z.strictObject({
        path: z.string(),
        name: z.string().nullable(),
        package_manager: z.string().nullable(),
        entry_points: z.array(
          z.strictObject({ field: z.string(), path: z.string() }),
        ),
        dependency_count: z.int(),
      }),
    ),
    lockfiles: z.array(
      z.strictObject({ path: z.string(), package_manager: z.string() }),
    ),
    ai_dependencies: z.array(
      z.strictObject({
        name: z.string(),
        declared: z.string(),
        section: z.string(),
        manifest: z.string(),
        installed_version: z.string().nullable(),
        category: z.enum(["provider_sdk", "unsupported_ai_sdk", "other"]),
        recognizer: z.string().nullable(),
      }),
    ),
    environment_variables: z.array(
      z.strictObject({ name: z.string(), locations: z.array(SpanSchema) }),
    ),
    excluded: z.array(z.strictObject({ path: z.string(), reason: z.string() })),
  }),
  declarations: z.array(DeclarationRecordSchema),
  observations: z.array(ObservationSchema),
  data_flows: z.array(DataFlowRecordSchema),
  proposed_bindings: z.array(ProposedBindingSchema),
  unknowns: z.array(UnknownRecordSchema),
  analysis_errors: z.array(AnalysisErrorSchema),
  limits: z.array(LimitSchema),
  /** Facts about the scan that do not limit its completeness (e.g. editor-only tsconfig plugins). */
  notes: z.array(LimitSchema),
  completeness: z.strictObject({
    status: z.enum(["complete_within_supported_scope", "incomplete"]),
    reasons: z.array(z.string()),
  }),
  statement: z.string(),
});

export type ScanArtifact = z.infer<typeof ScanArtifactSchema>;
export type ScanContent = Omit<ScanArtifact, "content_hash" | "observation">;
export type Observation = z.infer<typeof ObservationSchema>;
export type DataFlowRecord = z.infer<typeof DataFlowRecordSchema>;
export type ProposedBinding = z.infer<typeof ProposedBindingSchema>;
export type UnknownRecord = z.infer<typeof UnknownRecordSchema>;
export type AnalysisError = z.infer<typeof AnalysisErrorSchema>;
export type DeclarationRecord = z.infer<typeof DeclarationRecordSchema>;
export type NodeAssociation = z.infer<typeof NodeAssociationSchema>;
export type LocationRecord = z.infer<typeof LocationSchema>;
export type TraceStepRecord = z.infer<typeof TraceStepSchema>;
export type DataReachingStatus = z.infer<typeof DataReachingStatusSchema>;
export type EndpointRecord = z.infer<typeof EndpointSchema>;

export const SCAN_STATEMENT =
  "Repository observations and proposed bindings only. This is not a conformance result: it does not say whether any rule passes or fails, and it makes no whole-program privacy, runtime-enforcement or budget claim. Unknowns and analysis errors mean the scan is incomplete; an empty list of observations does not mean the repository is safe. Proposed bindings are not recorded in the project contract.";

export function scanContentHash(content: ScanContent): string {
  return sha256(stableStringify(content));
}

export function finalizeArtifact(
  content: ScanContent,
  observation: ScanArtifact["observation"],
): ScanArtifact {
  return { ...content, content_hash: scanContentHash(content), observation };
}

export function serializeArtifact(artifact: ScanArtifact): string {
  return prettyStringify(artifact);
}

export type ArtifactReading =
  | { readonly status: "valid"; readonly artifact: ScanArtifact }
  | { readonly status: "invalid"; readonly problem: string }
  | { readonly status: "tampered"; readonly artifact: ScanArtifact };

/** Parse, validate and self-check a stored artifact. Never trusts its hash. */
export function readArtifact(text: string): ArtifactReading {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: "invalid", problem: "not JSON" };
  }
  const format = (json as { format?: unknown } | null)?.format;
  if (format !== SCAN_ARTIFACT_FORMAT) {
    return {
      status: "invalid",
      problem:
        typeof format === "string" && /^[\w./-]{1,80}$/.test(format)
          ? `unsupported format ${format}`
          : "missing or unsupported format",
    };
  }
  const parsed = ScanArtifactSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      status: "invalid",
      problem: `does not match ${SCAN_ARTIFACT_FORMAT}${first === undefined ? "" : ` at ${first.path.map(String).join(".")}`}`,
    };
  }
  const { content_hash: stored, observation, ...content } = parsed.data;
  void observation;
  return scanContentHash(content) === stored
    ? { status: "valid", artifact: parsed.data }
    : { status: "tampered", artifact: parsed.data };
}
