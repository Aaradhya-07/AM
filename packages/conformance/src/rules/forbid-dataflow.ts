import type { z } from "zod/v4";
import type {
  ForbidDataflowRuleSchema,
  ProjectContract,
} from "@anvilmark/project-contract";
import type {
  DataFlowRecord,
  LocationRecord,
  Observation,
  ScanArtifact,
  TraceStepRecord,
} from "@anvilmark/scanner";
import { suggestDataflowAlternatives } from "../remediation.js";
import type {
  ConformanceResultRecord,
  ConformanceVerdict,
} from "../schemas.js";
import { inventoryGaps, resultRecord, uniqueLocations } from "./shared.js";
export type ForbidDataflowRule = z.infer<typeof ForbidDataflowRuleSchema>;

const REMOTE_CAPABLE: ReadonlySet<string> = new Set([
  "unsupported_provider_sdk",
  "possible_provider_operation_unresolved",
  "runtime_selected_provider",
  "unmodelled_network_hop",
  "runtime_selected_import",
  "reflection_or_code_generation",
]);
type Call = Extract<Observation, { kind: "provider_call" }>;
type Fact = DataFlowRecord["contexts"][number]["facts"][number];

export function evaluateForbidDataflowRule({
  rule,
  contract,
  scan,
}: {
  readonly rule: ForbidDataflowRule;
  readonly contract: ProjectContract;
  readonly scan: ScanArtifact;
}): ConformanceResultRecord {
  const classification = rule.from.data_classification;
  const required =
    rule.unless?.passes_through.map((p) => p.component_ref) ?? [];
  const gaps = new Set(inventoryGaps(scan));
  const locations: LocationRecord[] = [];
  const caveats = new Set<string>([
    "Source completeness and sanitizer effectiveness are T1 declarations, not runtime measurements.",
    "This result covers modeled request inputs and bounded direct calls, not whole-program privacy or network enforcement.",
  ]);
  const violations: { call: Call; fact: Fact }[] = [];
  const compliant: { call: Call; fact: Fact }[] = [];
  let targetCalls = 0;
  const declarations = new Map(scan.declarations.map((d) => [d.id, d]));
  const related = (fact: Fact) =>
    fact.classification === classification ||
    fact.derived_from === classification ||
    fact.trace.some(
      (s) =>
        (s.kind === "source" || s.kind === "parameter_source") &&
        declarations.get(s.declaration_ref ?? "")?.data_classification ===
          classification,
    );
  const allowed = (fact: Fact) => {
    if (fact.state !== "sanitized" || required.length === 0) return false;
    const applied = fact.trace
      .filter((s) => s.kind === "sanitizer")
      .map((s) => declarations.get(s.declaration_ref ?? ""))
      .filter(
        (d) => d?.status === "resolved" && d.clears.includes(classification),
      );
    return required.every((node) =>
      applied.some(
        (d) =>
          d?.architecture_node?.ref === node &&
          d.architecture_node.association === "declared_mapping",
      ),
    );
  };
  for (const call of scan.observations.filter(
    (o): o is Call => o.kind === "provider_call",
  )) {
    const binding = scan.proposed_bindings.find(
      (b) => b.observation_ref === call.id,
    );
    const sink = scan.declarations.find(
      (d) =>
        d.kind === "sink" &&
        d.id ===
          (binding?.provider_node.declaration_ref ??
            binding?.candidate.declaration_ref),
    );
    const endpoint = call.endpoint;
    // A runtime-selected or unlinked endpoint is verified only by a declaration (T1).
    const declaredProviders = sink?.sink?.providers ?? null;
    const endpointUnverified =
      (endpoint.selection === "runtime_selected" ||
        endpoint.selection === "unlinked" ||
        endpoint.deployment === null) &&
      declaredProviders === null;
    if (declaredProviders !== null && endpoint.deployment === null)
      caveats.add(
        `The endpoint is chosen at run time; the declared providers in ${sink?.id} are a T1 statement.`,
      );
    const node = binding?.provider_node;
    const boundary = node?.trust_boundary;
    const declared =
      node?.association === "declared_mapping" && node.ref !== null;
    const couldBeTarget =
      boundary === rule.to.trust_boundary ||
      (rule.to.trust_boundary === "remote_provider" &&
        (endpoint.deployment === "managed_api" ||
          endpointUnverified ||
          (endpoint.deployment === null &&
            call.default_deployment === "managed_api")));
    if (!couldBeTarget) {
      if (!declared) gaps.add("sink_boundary_unbound");
      continue;
    }
    targetCalls++;
    locations.push(call.location);
    // A structural guess or unverified endpoint cannot establish an exact boundary.
    if (
      !declared ||
      boundary !== rule.to.trust_boundary ||
      endpointUnverified
    ) {
      gaps.add("sink_boundary_unverified");
      continue;
    }
    if (
      rule.to.trust_boundary === "remote_provider" &&
      endpoint.deployment === "local"
    ) {
      gaps.add("sink_boundary_conflicts_with_endpoint");
      continue;
    }
    const flow = scan.data_flows.find((f) => f.observation_ref === call.id);
    if (!flow) {
      gaps.add("sink_flow_missing");
      continue;
    }
    for (const caveat of flow.caveats) caveats.add(caveat);
    const active = flow.contexts.filter((c) => !c.superseded);
    if (active.length === 0) gaps.add("sink_context_missing");
    for (const ctx of active) {
      for (const unknown of ctx.unknowns) gaps.add(unknown.reason);
      for (const fact of ctx.facts.filter(related)) {
        if (allowed(fact)) compliant.push({ call, fact });
        else violations.push({ call, fact });
      }
    }
  }
  // Sensitive data handed to an unmodelled consumer may cross the boundary.
  // Empty-classification unknowns at target sinks were handled above.
  let unknownTrace: TraceStepRecord[] = [];
  for (const u of scan.unknowns) {
    if (
      u.stage === "flow" &&
      u.classifications.some(
        (c) => c === classification || c.startsWith(`${classification}:`),
      )
    ) {
      gaps.add(u.reason);
      locations.push(u.location);
      if (unknownTrace.length === 0) unknownTrace = [...u.trace];
    }
    // Values the analysis lost track of may hold the classification; they
    // matter where they reach something that can send them remotely.
    if (
      u.stage === "flow" &&
      u.carries === "unresolved_data" &&
      REMOTE_CAPABLE.has(u.reason)
    ) {
      gaps.add(u.reason);
      locations.push(u.location);
    }
    if (u.reason === "unresolved_import") {
      gaps.add(u.reason);
      locations.push(u.location);
    }
  }
  // Proven violations survive unrelated unknown paths. Superseded contexts never count.
  const verdict: ConformanceVerdict =
    violations.length > 0
      ? "fail"
      : gaps.size > 0
        ? "unknown"
        : targetCalls === 0
          ? "not_applicable"
          : "pass";
  const chosen = violations[0] ?? compliant[0];
  const binding = scan.proposed_bindings.find(
    (b) => b.observation_ref === chosen?.call.id,
  );
  const trace = chosen?.fact.trace ?? unknownTrace;
  const explanation =
    verdict === "fail"
      ? `Data classified as or derived from '${classification}' reaches '${rule.to.trust_boundary}' without the rule's required sanitizer exception at ${chosen!.call.location.path}:${chosen!.call.location.start.line}:${chosen!.call.location.start.column}.`
      : verdict === "unknown"
        ? `Data-flow conformance is unresolved (${[...gaps].sort().join(", ")}); analysis refused to guess.`
        : verdict === "not_applicable"
          ? `No applicable flow to '${rule.to.trust_boundary}' was observed in the supported inventory.`
          : compliant.length > 0
            ? `Pass within supported direct scope: every observed '${classification}' path satisfies the declared sanitizer exception (${required.join(", ")}).`
            : `Pass within supported direct scope: no declared '${classification}' data reaches the target boundary; this assumes declared sources are complete.`;
  return resultRecord(rule, contract, scan, {
    verdict,
    explanation,
    locations: uniqueLocations([
      ...violations.map((v) => v.call.location),
      ...locations,
    ]),
    trace: [...trace],
    workload_ref: binding?.workload.ref ?? null,
    decision_ref: binding?.decision.ref ?? null,
    candidate_ref: binding?.candidate.ref ?? null,
    architecture_node_ref: binding?.provider_node.ref ?? null,
    unknown_reasons: [...gaps].sort(),
    caveats: [...caveats],
    suggested_alternatives:
      verdict === "fail"
        ? suggestDataflowAlternatives({
            dataClassification: classification,
            trustBoundary: rule.to.trust_boundary,
            passesThroughComponents: required,
          })
        : [],
    supported_scope:
      "Intraprocedural def-use and one level of statically resolved direct-call propagation, with declared source/sink/sanitizer mappings and default SDK endpoints.",
  });
}
