import type {
  AnalysisError,
  DataFlowRecord,
  DataReachingStatus,
  LocationRecord,
  Observation,
  TraceStepRecord,
  UnknownRecord,
} from "./artifact.js";
import type {
  FlatValue,
  FlowEvent,
  FlowResult,
  SinkContext,
  TraceStep,
} from "./flow.js";
import type { Span, UnknownReason } from "./model.js";
import { compareSpans, compareStrings, spanKey, stableId } from "./model.js";
import type { RecognizerSet } from "./recognizers/index.js";
import {
  isUnsupportedSdk,
  modelFactoryFor,
  providerForPackage,
} from "./recognizers/index.js";
import type { ImportFact } from "./resolution.js";
import type { ClientFact, Endpoint, SemanticFacts } from "./semantics.js";

/** Unknown reasons that concern AI provider calls themselves. */
export const AI_UNKNOWN_REASONS: ReadonlySet<UnknownReason> = new Set([
  "unsupported_provider_sdk",
  "possible_provider_operation_unresolved",
  "runtime_selected_provider",
  "runtime_selected_endpoint",
  "runtime_selected_model",
  "request_transport_unresolved",
  "unmodelled_network_hop",
]);

export function isAiPackage(recognizers: RecognizerSet, name: string): boolean {
  return (
    providerForPackage(recognizers, name) !== null ||
    isUnsupportedSdk(recognizers, name) ||
    modelFactoryFor(recognizers, name) !== null
  );
}

/**
 * Evidence stage: turn stage facts into source-linked records with a stable
 * id, a discovery kind and an evidence tier.
 *
 * - Compiler-resolved facts (an import, a client instantiation, a provider
 *   call) are `deterministic_observation` at T3 — for exactly the fact
 *   observed at that span, and nothing more.
 * - A data-flow record is T3 for the traced path within the documented flow
 *   model. Declared sources and sanitizers it relies on are listed separately
 *   as T1 assumptions; a sanitizer's effectiveness is never observed.
 * - Anything unresolved is T0 and carries its unknown reasons.
 */

export type HashLookup = (path: string) => string;

export function location(
  span: Span,
  symbol: string | null,
  hashOf: HashLookup,
): LocationRecord {
  return {
    path: span.path,
    symbol,
    start: span.start,
    end: span.end,
    source_sha256: hashOf(span.path),
  };
}

function traceRecord(trace: readonly TraceStep[]): TraceStepRecord[] {
  return trace.map((step) => ({
    kind: step.kind,
    path: step.span.path,
    start: step.span.start,
    end: step.span.end,
    symbol: step.symbol,
    declaration_ref: step.declaration,
  }));
}

export function statusOf(value: FlatValue): DataReachingStatus {
  if (value.facts.some((fact) => fact.state === "raw")) return "raw_reaches";
  if (value.opaque.length > 0) return "unresolved";
  if (value.facts.length > 0) return "sanitized_only";
  return "no_declared_data";
}

const STATUS_ORDER: readonly DataReachingStatus[] = [
  "raw_reaches",
  "unresolved",
  "sanitized_only",
  "no_declared_data",
];

export interface ObservationBundle {
  readonly observations: Observation[];
  readonly dataFlows: DataFlowRecord[];
  readonly unknowns: UnknownRecord[];
  readonly callIds: ReadonlyMap<ts_CallNode, string>;
}

type ts_CallNode = SemanticFacts["calls"][number]["node"];

function contextRoot(root: SinkContext["root"]) {
  return {
    path: root.span.path,
    symbol: root.symbol,
    start: root.span.start,
    end: root.span.end,
  };
}

type UnknownInput = Omit<UnknownRecord, "id" | "carries" | "ai_related"> & {
  readonly unresolved?: boolean;
};

export function buildObservations(input: {
  readonly imports: readonly ImportFact[];
  readonly semantics: SemanticFacts;
  readonly flows: FlowResult;
  readonly hashOf: HashLookup;
  readonly recognizers: RecognizerSet;
}): ObservationBundle {
  const { imports, semantics, flows, hashOf, recognizers } = input;
  const observations: Observation[] = [];
  const dataFlows: DataFlowRecord[] = [];
  const unknowns = new Map<string, UnknownRecord>();
  const addUnknown = (input: UnknownInput) => {
    const { unresolved, ...fields } = input;
    const record: Omit<UnknownRecord, "id"> = {
      ...fields,
      carries:
        fields.stage !== "flow"
          ? "not_applicable"
          : fields.classifications.length > 0
            ? "declared_data"
            : unresolved === true
              ? "unresolved_data"
              : "no_tracked_data",
      // What reaches a provider call is a data question, not an AI-call one:
      // flow unknowns at a sink are AI-related only through their reason.
      ai_related:
        AI_UNKNOWN_REASONS.has(fields.reason) ||
        (fields.observation_ref !== null && fields.stage !== "flow") ||
        fields.detail.some((entry) => isAiPackage(recognizers, entry)),
    };
    const id = stableId("unknown", [
      record.stage,
      record.reason,
      spanKey({
        path: record.location.path,
        start: record.location.start,
        end: record.location.end,
      }),
      record.context === null
        ? null
        : [
            record.context.kind,
            record.context.root.path,
            record.context.root.start,
            record.context.call_site,
          ],
      record.detail,
    ]);
    unknowns.set(id, { id, ...record });
  };

  for (const fact of imports) {
    const loc = location(fact.span, fact.symbol, hashOf);
    if (fact.resolution.status === "package") {
      observations.push({
        id: stableId("import", [fact.span, fact.resolution.package, fact.kind]),
        kind: "sdk_import",
        location: loc,
        import_kind: fact.kind,
        package: fact.resolution.package,
        category: fact.resolution.category,
        recognizer: fact.resolution.recognizer,
        discovery: "deterministic_observation",
        evidence_tier: "T3",
      });
    } else {
      addUnknown({
        reason:
          fact.resolution.status === "unresolved"
            ? "unresolved_import"
            : "runtime_selected_import",
        stage: "resolution",
        location: loc,
        context: null,
        classifications: [],
        detail:
          fact.specifier === null ? [fact.kind] : [fact.kind, fact.specifier],
        observation_ref: null,
        trace: [],
      });
    }
  }

  const clientIds = new Map<ClientFact, string>();
  for (const client of semantics.clients) {
    const id = stableId("client", [
      client.span,
      client.recognizer.id,
      client.owner,
    ]);
    clientIds.set(client, id);
    const caveats = endpointCaveats(client);
    observations.push({
      id,
      kind: "client_instantiation",
      location: location(client.span, client.symbol, hashOf),
      recognizer: client.recognizer.id,
      provider: client.recognizer.provider,
      owner: client.owner,
      default_deployment: client.recognizer.defaultDeployment,
      endpoint: client.endpoint,
      discovery: "deterministic_observation",
      evidence_tier: "T3",
      caveats,
    });
    if (client.endpoint.selection === "runtime_selected") {
      addUnknown({
        reason: "runtime_selected_endpoint",
        stage: "semantics",
        location: location(client.span, client.symbol, hashOf),
        context: null,
        classifications: [],
        detail: [client.recognizer.id],
        observation_ref: id,
        trace: [],
      });
    }
  }

  const callIds = new Map<ts_CallNode, string>();
  for (const call of semantics.calls) {
    const id = stableId("call", [
      call.span,
      call.recognizer.id,
      call.operation.id,
    ]);
    callIds.set(call.node, id);
    if (call.model.kind === "runtime_selected") {
      addUnknown({
        reason: "runtime_selected_model",
        stage: "semantics",
        location: location(call.span, call.symbol, hashOf),
        context: null,
        classifications: [],
        detail: ["model value not established at call site"],
        observation_ref: id,
        trace: [],
      });
    }
    if (
      call.endpoint.selection === "runtime_selected" ||
      call.endpoint.selection === "unlinked"
    ) {
      addUnknown({
        reason: "runtime_selected_endpoint",
        stage: "semantics",
        location: location(call.span, call.symbol, hashOf),
        context: null,
        classifications: [],
        detail: [
          call.endpoint.selection === "unlinked"
            ? "client not linked to an instantiation"
            : "endpoint selected at run time",
        ],
        observation_ref: id,
        trace: [],
      });
    }
    const flowId = stableId("flow", [id]);
    const caveats = [
      ...(call.client === null
        ? call.linkage === "repository_uniform"
          ? ["client_linked_by_repository_uniform_endpoint"]
          : call.linkage === "unlinked"
            ? ["client_instantiation_not_linked"]
            : []
        : endpointCaveats(call.client)),
      ...endpointSelectionCaveats(call.endpoint),
      ...(call.model.kind === "runtime_selected"
        ? ["model_selected_at_runtime"]
        : []),
    ];
    observations.push({
      id,
      kind: "provider_call",
      location: location(call.span, call.symbol, hashOf),
      recognizer: call.recognizer.id,
      provider: call.recognizer.provider,
      operation: call.operation.id,
      operation_kind: call.operation.kind,
      owner: call.owner,
      model: call.model,
      client_ref:
        call.client === null ? null : (clientIds.get(call.client) ?? null),
      default_deployment: call.recognizer.defaultDeployment,
      endpoint: call.endpoint,
      linkage: call.linkage,
      data_flow_ref: flowId,
      discovery: "deterministic_observation",
      evidence_tier: "T3",
      caveats: [...new Set(caveats)].sort(compareStrings),
    });

    const contexts = (flows.sinks.get(call.node) ?? []).map((context) => ({
      id: stableId("context", [
        flowId,
        context.kind,
        context.root.span,
        context.call_site,
      ]),
      kind: context.kind,
      root: contextRoot(context.root),
      call_site: context.call_site,
      status: statusOf(context.value),
      superseded: context.superseded,
      facts: context.value.facts
        .map((fact) => ({
          classification: fact.classification,
          state: fact.state,
          derived_from: fact.derived_from,
          declaration_ref: fact.declaration,
          conditional: fact.conditional,
          trace: traceRecord(fact.trace),
        }))
        .sort((left, right) =>
          compareStrings(
            `${left.classification}|${left.state}|${left.declaration_ref}|${JSON.stringify(left.trace[0] ?? null)}`,
            `${right.classification}|${right.state}|${right.declaration_ref}|${JSON.stringify(right.trace[0] ?? null)}`,
          ),
        ),
      unknowns: context.value.opaque
        .map((entry) => ({
          reason: entry.reason,
          detail: entry.detail,
          conditional: entry.conditional,
          at: entry.span,
          trace: traceRecord(entry.trace),
        }))
        .sort(
          (left, right) =>
            compareSpans(left.at, right.at) ||
            compareStrings(left.reason, right.reason),
        ),
    }));
    const active = contexts.filter((context) => !context.superseded);
    const status =
      STATUS_ORDER.find((candidate) =>
        active.some((context) => context.status === candidate),
      ) ?? "no_declared_data";
    const classifications = [
      ...new Set(
        active.flatMap((context) =>
          context.facts.map((fact) => `${fact.classification}:${fact.state}`),
        ),
      ),
    ].sort(compareStrings);
    const reasons = [
      ...new Set(
        active.flatMap((context) =>
          context.unknowns.map((entry) => entry.reason),
        ),
      ),
    ].sort(compareStrings) as UnknownReason[];
    const assumptions = new Map<
      string,
      DataFlowRecord["assumptions"][number]
    >();
    for (const context of active) {
      for (const fact of context.facts) {
        for (const step of fact.trace) {
          if (
            (step.kind === "source" || step.kind === "parameter_source") &&
            step.declaration_ref !== null
          ) {
            assumptions.set(`s:${step.declaration_ref}`, {
              kind: "declared_source",
              declaration_ref: step.declaration_ref,
              evidence_tier: "T1",
            });
          }
          if (step.kind === "sanitizer" && step.declaration_ref !== null) {
            assumptions.set(`z:${step.declaration_ref}`, {
              kind: "declared_sanitizer",
              declaration_ref: step.declaration_ref,
              evidence_tier: "T1",
            });
          }
        }
      }
    }
    if (status === "sanitized_only" || status === "no_declared_data") {
      assumptions.set("complete", {
        kind: "declared_sources_complete",
        declaration_ref: null,
        evidence_tier: "T1",
      });
    }
    const rawFacts = active.flatMap((context) =>
      context.facts.filter((fact) => fact.state === "raw"),
    );
    const flowCaveats = [
      ...(active.some((context) =>
        context.facts.some((fact) => fact.state === "sanitized"),
      )
        ? ["declared_sanitizer_assumed_effective"]
        : []),
      ...(rawFacts.length > 0 && rawFacts.every((fact) => fact.conditional)
        ? ["raw_on_some_paths_only"]
        : []),
      ...(contexts.some((context) => context.superseded)
        ? ["superseded_contexts_excluded"]
        : []),
      ...(status === "no_declared_data"
        ? ["absence_is_relative_to_declared_sources"]
        : []),
    ];
    dataFlows.push({
      transport_scope: "modeled_request_inputs",
      id: flowId,
      observation_ref: id,
      status,
      classifications,
      unknown_reasons: reasons,
      contexts,
      trace_tier:
        status === "raw_reaches" || status === "sanitized_only" ? "T3" : null,
      assumptions: [...assumptions.values()].sort(
        (left, right) =>
          compareStrings(left.kind, right.kind) ||
          compareStrings(
            left.declaration_ref ?? "",
            right.declaration_ref ?? "",
          ),
      ),
      evidence_tier: status === "unresolved" ? "T0" : "T3",
      caveats: flowCaveats,
    });
    for (const context of active) {
      for (const entry of context.unknowns) {
        addUnknown({
          reason: entry.reason,
          stage: "flow",
          location: location(entry.at, null, hashOf),
          context: {
            kind: context.kind,
            root: context.root,
            call_site: context.call_site,
          },
          classifications: [],
          unresolved: true,
          detail:
            entry.detail === null
              ? ["reaches_provider_call"]
              : ["reaches_provider_call", entry.detail],
          observation_ref: id,
          trace: entry.trace,
        });
      }
    }
  }

  for (const unknown of semantics.unknowns) {
    addUnknown({
      reason: unknown.reason,
      stage: "semantics",
      location: location(unknown.span, unknown.symbol, hashOf),
      context: null,
      classifications: [],
      detail: [...unknown.detail],
      observation_ref: null,
      trace: [],
    });
  }
  for (const event of flows.events) {
    addUnknown(flowEventRecord(event, hashOf));
  }

  return {
    observations: observations.sort(
      (left, right) =>
        compareStrings(left.location.path, right.location.path) ||
        left.location.start.line - right.location.start.line ||
        left.location.start.column - right.location.start.column ||
        compareStrings(left.kind, right.kind),
    ),
    dataFlows: dataFlows.sort((left, right) =>
      compareStrings(left.id, right.id),
    ),
    unknowns: [...unknowns.values()].sort(
      (left, right) =>
        compareStrings(left.location.path, right.location.path) ||
        left.location.start.line - right.location.start.line ||
        left.location.start.column - right.location.start.column ||
        compareStrings(left.reason, right.reason) ||
        compareStrings(left.id, right.id),
    ),
    callIds,
  };
}

function flowEventRecord(event: FlowEvent, hashOf: HashLookup): UnknownInput {
  return {
    reason: event.reason,
    stage: "flow",
    location: location(event.span, event.symbol, hashOf),
    context: {
      kind: event.context.kind,
      root: contextRoot(event.context.root),
      call_site: event.context.call_site,
    },
    classifications: [...event.classifications],
    unresolved: event.unresolved,
    detail: event.detail === null ? [] : [event.detail],
    observation_ref: null,
    trace: traceRecord(event.trace),
  };
}

function endpointSelectionCaveats(endpoint: Endpoint): string[] {
  if (endpoint.selection === "literal_override")
    return endpoint.provider === null
      ? ["endpoint_overridden_in_code", "endpoint_host_unrecognized"]
      : ["endpoint_overridden_in_code"];
  if (endpoint.selection === "runtime_selected")
    return ["endpoint_selected_at_runtime"];
  return [];
}

function endpointCaveats(client: ClientFact): string[] {
  const caveats: string[] = [...endpointSelectionCaveats(client.endpoint)];
  for (const name of client.recognizer.environmentVariables) {
    if (/(?:BASE_URL|HOST)$/.test(name))
      caveats.push(`sdk_endpoint_may_be_set_by_environment:${name}`);
  }
  return caveats.sort(compareStrings);
}

export function analysisErrorRecord(
  record: Omit<AnalysisError, "id">,
): AnalysisError {
  return {
    id: stableId("error", [record.kind, record.path, record.span, record.code]),
    ...record,
  };
}
