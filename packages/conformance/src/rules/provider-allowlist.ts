import type { z } from "zod/v4";
import type {
  ApprovedCandidateOnlyRuleSchema,
  ProviderAllowlistRuleSchema,
  ProjectContract,
} from "@anvilmark/project-contract";
import type {
  DeclarationRecord,
  LocationRecord,
  Observation,
  ScanArtifact,
  UnknownRecord,
} from "@anvilmark/scanner";
import { suggestProviderAlternatives } from "../remediation.js";
import type {
  ConformanceResultRecord,
  ConformanceVerdict,
} from "../schemas.js";
import {
  currentDecision,
  inventoryGaps,
  resultRecord,
  uniqueLocations,
  workloadScope,
} from "./shared.js";

export type ApprovedCandidateOnlyRule = z.infer<
  typeof ApprovedCandidateOnlyRuleSchema
>;
export type ProviderAllowlistRule = z.infer<typeof ProviderAllowlistRuleSchema>;
export type ProviderRule = ProviderAllowlistRule | ApprovedCandidateOnlyRule;
type Call = Extract<Observation, { kind: "provider_call" }>;
type Candidate = ProjectContract["candidates"][number];

interface Identity {
  readonly verdict: ConformanceVerdict;
  readonly reason: string;
  /** A T1 declaration the result relies on (declared runtime models or providers). */
  readonly declared: string | null;
}

/**
 * Unknowns that can hide a provider call or its identity. Provider calls are
 * recognized wherever they appear in scanned code, whatever calls them, so a
 * dynamic dispatch or an `any`-typed call cannot hide one inside the
 * repository; only code the scanner cannot see can.
 *
 * - Loading code the scanner cannot see (a runtime-selected or unresolved
 *   import, reflection or code generation) matters anywhere in the
 *   repository: that code may call a provider for any workload.
 * - AI-shaped unknowns and network hops matter where the workload lives.
 */
const REPOSITORY_WIDE_REASONS: ReadonlySet<string> = new Set([
  "runtime_selected_import",
  "unresolved_import",
  "reflection_or_code_generation",
]);

/** Test code: not where a production workload runs. */
export function isTestPath(path: string): boolean {
  return (
    path
      .split("/")
      .some((part) =>
        ["__tests__", "__mocks__", "test", "tests", "e2e", "cypress"].includes(
          part,
        ),
      ) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
  );
}

function providerRelevant(unknown: UnknownRecord): boolean {
  return (
    unknown.ai_related ||
    unknown.reason === "unmodelled_network_hop" ||
    REPOSITORY_WIDE_REASONS.has(unknown.reason)
  );
}

function sinkDeclaration(
  scan: ScanArtifact,
  call: Call,
): DeclarationRecord | undefined {
  const binding = scan.proposed_bindings.find(
    (entry) => entry.observation_ref === call.id,
  );
  const ref =
    binding?.candidate.declaration_ref ??
    binding?.provider_node.declaration_ref;
  return scan.declarations.find(
    (entry) => entry.id === ref && entry.kind === "sink",
  );
}

/** Exact provider/model identity, never family-name guessing. */
function identity(
  call: Call,
  candidate: Candidate,
  sink: DeclarationRecord | undefined,
): Identity {
  const deployment = candidate.deployment;
  if (deployment.mode !== "managed_api" && deployment.mode !== "local")
    return {
      verdict: "unknown",
      reason: "candidate_deployment_unsupported",
      declared: null,
    };
  const expected =
    deployment.mode === "local" ? deployment.runtime : deployment.provider;
  if (expected === null)
    return {
      verdict: "unknown",
      reason: "candidate_provider_unspecified",
      declared: null,
    };

  // Where the request goes.
  const endpoint = call.endpoint;
  let providers: readonly string[];
  let declared: string | null = null;
  if (
    endpoint.selection === "default" ||
    endpoint.selection === "literal_override"
  ) {
    if (endpoint.deployment !== null && endpoint.deployment !== deployment.mode)
      return {
        verdict: "fail",
        reason: "candidate_deployment_mismatch",
        declared: null,
      };
    if (endpoint.provider === null)
      return {
        verdict: "unknown",
        reason: "provider_endpoint_unrecognized",
        declared: null,
      };
    providers = [endpoint.provider];
  } else if (endpoint.provider !== null) {
    providers = [endpoint.provider];
  } else if (sink?.sink?.providers) {
    providers = sink.sink.providers;
    declared = sink.id;
  } else {
    return {
      verdict: "unknown",
      reason: "provider_endpoint_unverified",
      declared: null,
    };
  }
  if (providers.some((provider) => provider !== expected))
    return {
      verdict: "fail",
      reason:
        declared === null
          ? "candidate_provider_mismatch"
          : "declared_runtime_providers_not_approved",
      declared,
    };

  // Operations that invoke no model are checked for their destination only.
  if (
    call.operation_kind === "data_upload" ||
    call.operation_kind === "management"
  )
    return { verdict: "pass", reason: "provider_identity_only", declared };

  const model = candidate.model;
  if (model === null)
    return {
      verdict: "unknown",
      reason: "candidate_model_unspecified",
      declared,
    };
  const approved =
    model.version ??
    (model.version_mutability === "floating" ? model.family : null);
  if (approved === null)
    return {
      verdict: "unknown",
      reason: "candidate_model_unspecified",
      declared,
    };
  let models: readonly string[];
  if (call.model.kind === "literal") {
    models = [call.model.value];
  } else if (sink?.sink?.models) {
    models = sink.sink.models;
    declared = sink.id;
  } else {
    return { verdict: "unknown", reason: "runtime_selected_model", declared };
  }
  if (models.some((value) => value !== approved))
    return {
      verdict: "fail",
      reason:
        call.model.kind === "literal"
          ? "candidate_model_mismatch"
          : "declared_runtime_models_not_approved",
      declared,
    };
  return {
    verdict: "pass",
    reason:
      model.version_mutability === "floating"
        ? "floating_model_reference_only"
        : "exact_model_reference",
    declared,
  };
}

/** Whether a call's operation can be served by a candidate's component kind. */
function kindFits(call: Call, candidate: Candidate): boolean {
  if (call.operation_kind === "embedding")
    return candidate.component_kind === "embedding_model";
  if (call.operation_kind === "inference")
    return candidate.component_kind !== "embedding_model";
  return true;
}

function describeCall(call: Call): string {
  const provider = call.endpoint.provider ?? "an unresolved provider";
  const model =
    call.model.kind === "literal" ? ` model '${call.model.value}'` : "";
  return `${provider}${model} (${call.operation}) at ${call.location.path}:${call.location.start.line}`;
}

export function evaluateProviderRule({
  rule,
  contract,
  scan,
}: {
  readonly rule: ProviderRule;
  readonly contract: ProjectContract;
  readonly scan: ScanArtifact;
}): ConformanceResultRecord {
  const workload = rule.workload_ref;
  const decision =
    rule.kind === "approved_candidate_only"
      ? currentDecision(contract, workload, rule.approved_decision_ref)
      : null;
  const allowed =
    rule.kind === "provider_allowlist"
      ? rule.allowed_candidate_refs
      : decision?.selected_candidate_ref
        ? [decision.selected_candidate_ref]
        : [];
  const candidates = allowed
    .map((id) =>
      contract.candidates.find(
        (c) => c.id === id && c.workload_ref === workload,
      ),
    )
    .filter((c): c is Candidate => c !== undefined);
  const scope = workloadScope(scan, workload);
  const allCalls = scan.observations.filter(
    (o): o is Call => o.kind === "provider_call",
  );
  const calls = allCalls.filter((o) => {
    const binding = scan.proposed_bindings.find(
      (b) => b.observation_ref === o.id,
    );
    // A declared association to another workload is not overridden by a file
    // match, and a call outside an export-scoped component is not the workload's.
    return binding?.workload.ref
      ? binding.workload.ref === workload
      : !(binding?.unbound_reasons ?? []).includes(
          "outside_declared_components_of_workload",
        ) && scope.wholeFiles.has(o.location.path);
  });
  const callFiles = new Set(calls.map((call) => call.location.path));
  const unknowns = new Set(inventoryGaps(scan));
  const locations: LocationRecord[] = [];
  const caveats = new Set<string>([
    "Candidate and workload associations are declared mappings; this proves only the supported SDK/model references in the selected source.",
    "Endpoints are the SDK defaults or literal URLs in code; runtime environment overrides and network routing are not verified.",
  ]);
  if (scope.declaredFiles.size > 0)
    caveats.add(
      `The workload is scoped to its declared component files (${scope.declaredFiles.size}); provider calls elsewhere are not attributed to it.`,
    );

  let outOfScope = 0;
  for (const u of scan.unknowns) {
    if (!providerRelevant(u)) {
      outOfScope++;
      continue;
    }
    const inScope = REPOSITORY_WIDE_REASONS.has(u.reason)
      ? !scope.otherWorkloadFiles.has(u.location.path) &&
        (!isTestPath(u.location.path) ||
          [...scope.declaredFiles].some(isTestPath))
      : scope.declaredFiles.size > 0
        ? scope.declaredFiles.has(u.location.path) ||
          callFiles.has(u.location.path) ||
          (u.observation_ref !== null &&
            calls.some((call) => call.id === u.observation_ref))
        : callFiles.has(u.location.path) ||
          !scope.otherWorkloadFiles.has(u.location.path);
    if (!inScope) {
      outOfScope++;
      continue;
    }
    // A call's own endpoint and model unknowns, and those of its client, are
    // judged with its identity below.
    if (
      u.observation_ref !== null &&
      calls.some(
        (call) =>
          call.id === u.observation_ref ||
          call.client_ref === u.observation_ref,
      ) &&
      (u.reason === "runtime_selected_endpoint" ||
        u.reason === "runtime_selected_model")
    )
      continue;
    unknowns.add(u.reason);
    locations.push(u.location);
  }
  if (outOfScope > 0)
    caveats.add(
      `${outOfScope} unknown(s) were not treated as blocking: dynamic dispatch and unresolved values in scanned code cannot hide a provider call, because provider calls are recognized wherever they appear, and AI-related unknowns outside the workload's declared files are not attributed to it.`,
    );

  for (const call of allCalls) {
    const binding = scan.proposed_bindings.find(
      (b) => b.observation_ref === call.id,
    );
    if (
      !binding?.workload.ref &&
      !calls.includes(call) &&
      scope.declaredFiles.size === 0 &&
      (call.operation_kind === "inference" ||
        call.operation_kind === "embedding")
    )
      unknowns.add("provider_workload_unbound");
  }
  const failures: { call: Call; reason: string }[] = [];
  const declaredRefs = new Set<string>();
  let representative = calls[0];
  if (calls.length > 0 && candidates.length === 0)
    unknowns.add("current_candidate_policy_unresolved");
  let otherKinds = 0;
  for (const call of calls) {
    const binding = scan.proposed_bindings.find(
      (b) => b.observation_ref === call.id,
    );
    if (
      candidates.length > 0 &&
      candidates.every((candidate) => !kindFits(call, candidate))
    ) {
      // An embedding call is not judged against a chat model candidate, or the reverse.
      otherKinds++;
      continue;
    }
    locations.push(call.location);
    if (candidates.length === 0) continue;
    const sink = sinkDeclaration(scan, call);
    const matches = candidates.map((c) => ({
      candidate: c,
      ...identity(call, c, sink),
    }));
    const match = matches.find((m) => m.verdict === "pass");
    if (match) {
      if (match.declared !== null) declaredRefs.add(match.declared);
      const modelInvocation =
        call.operation_kind === "inference" ||
        call.operation_kind === "embedding";
      if (
        modelInvocation &&
        (binding?.candidate.ref !== match.candidate.id ||
          binding.candidate.association !== "declared_mapping")
      )
        unknowns.add("candidate_mapping_unverified");
      if (match.reason === "floating_model_reference_only")
        caveats.add(
          "The approved floating model reference matches; the runtime model artifact/version is not pinned.",
        );
      if (call.linkage === "repository_uniform")
        caveats.add(
          "Some clients were linked because every client of that SDK in the repository uses the same endpoint.",
        );
    } else if (matches.every((m) => m.verdict === "fail")) {
      for (const m of matches)
        if (m.declared !== null) declaredRefs.add(m.declared);
      failures.push({ call, reason: matches.map((m) => m.reason).join(", ") });
    } else
      for (const match of matches.filter((m) => m.verdict === "unknown"))
        unknowns.add(match.reason);
  }
  if (otherKinds > 0)
    caveats.add(
      `${otherKinds} call(s) of another operation kind (embedding versus model inference) were not judged against this workload's candidates.`,
    );
  if (declaredRefs.size > 0)
    caveats.add(
      `Runtime-selected values were checked against declared values (${[...declaredRefs].sort().join(", ")}); those declarations are T1 statements, not observations.`,
    );
  if (failures.length > 0) representative = failures[0]!.call;
  const binding = scan.proposed_bindings.find(
    (b) => b.observation_ref === representative?.id,
  );
  const verdict: ConformanceVerdict =
    failures.length > 0
      ? "fail"
      : unknowns.size > 0
        ? "unknown"
        : calls.length - otherKinds === 0
          ? "not_applicable"
          : "pass";
  const explanation =
    verdict === "fail"
      ? `Workload '${workload}' invokes ${describeCall(failures[0]!.call)}, outside its current candidate policy (${failures[0]!.reason}).`
      : verdict === "unknown"
        ? `Candidate conformance for workload '${workload}' is unresolved: ${[...unknowns].sort().join(", ")}.`
        : verdict === "not_applicable"
          ? `No applicable provider calls were observed for workload '${workload}' in the supported inventory.`
          : `Workload '${workload}' invokes only the provider/model references allowed by its current candidate policy.`;
  const alternatives =
    verdict !== "fail"
      ? []
      : suggestProviderAlternatives({
          workloadRef: workload,
          approvedCandidateRef: decision?.selected_candidate_ref ?? null,
          allowedCandidateRefs:
            rule.kind === "provider_allowlist" ? allowed : [],
          observed: describeCall(representative!),
          provider: representative?.endpoint.provider ?? "unresolved",
          isLocalApproved:
            candidates.length === 1 &&
            candidates[0]?.deployment.mode === "local",
        });
  return resultRecord(rule, contract, scan, {
    verdict,
    explanation,
    evidence_tier:
      verdict === "unknown" ? "T0" : declaredRefs.size > 0 ? "T1" : "T3",
    decision_ref: decision?.id ?? null,
    candidate_ref: binding?.candidate.ref ?? null,
    architecture_node_ref:
      binding?.component.ref ?? binding?.provider_node.ref ?? null,
    locations: uniqueLocations([
      ...failures.map((f) => f.call.location),
      ...locations,
    ]),
    unknown_reasons: [...unknowns].sort(),
    caveats: [...caveats],
    suggested_alternatives: alternatives,
    supported_scope:
      "Type- and symbol-resolved OpenAI, Anthropic, Ollama and Vercel AI SDK calls, and fetch to known AI provider hosts, attributed through declared components and sinks; literal provider hosts and model references, or declared runtime values.",
  });
}
