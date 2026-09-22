import { createHash } from "node:crypto";

import type {
  ProjectContract,
  ProjectionField,
  SecretFinding,
} from "@anvilmark/project-contract";
import { findSecrets, stableStringify } from "@anvilmark/project-contract";

import type { ExecutionLocality } from "../envelope.js";
import { INTELLIGENCE_PROTOCOL_VERSION } from "../version.js";
import type { OutboundProjection } from "./projection.js";
import { buildProjection } from "./projection.js";
import type { IntelligenceRequest } from "./proposal.js";
import { IntelligenceRequestSchema } from "./proposal.js";

export type IntelligenceTask = IntelligenceRequest["task"];

export const INTELLIGENCE_TASKS: readonly IntelligenceTask[] =
  IntelligenceRequestSchema.shape.task.options;

/**
 * Fields a LOCAL intelligence may receive in addition to the contract's own
 * allow-list, under the separately disclosed local policy of doc 06 section 9.
 * They are the ratified safe-by-default set; `buildProjection` still strips
 * every ratified default-deny field.
 */
export const LOCAL_DISCLOSED_FIELDS: readonly ProjectionField[] = [
  "intent",
  "constraints",
  "workloads",
  "data_classification_labels",
  "budgets",
  "non_identifying_hardware_capabilities",
  "candidates",
  "evidence_metadata_without_local_locators",
  "decisions",
  "conformance_rule_definitions",
];

const TASK_FOCUS: Readonly<Record<IntelligenceTask, string>> = {
  clarify_intent:
    "Identify what is missing or ambiguous in the intent, users, outcomes, non-goals and workloads. Prefer questions over guesses.",
  propose_constraints:
    "Suggest constraints the project appears to need but has not declared.",
  propose_candidates:
    "Suggest meaningfully different candidates (for example local-first and managed) for the declared workloads.",
  explain_tradeoffs:
    "Explain trade-offs between the declared candidates as inferences, and ask for the evidence that would settle them.",
  propose_architecture:
    "Suggest architecture components, relationships and decision bindings the declared workloads appear to need. Every trust boundary you state is a proposal the user must confirm.",
};

/**
 * The response contract, stated to every intelligence in the same words.
 *
 * It describes intelligence protocol `0.1.0-draft.2` exactly. It does not
 * invite fields the protocol lacks (structured evidence requests, decisions,
 * approvals, statuses, measurements, origins, confirmations, interfaces): a
 * response carrying any of them is rejected, so asking for them would only
 * produce rejections.
 */
export function responseInstructions(task: IntelligenceTask): string {
  return [
    "You are assisting with an ANVILMARK project contract. You PROPOSE; the user decides.",
    `Task: ${task}. ${TASK_FOCUS[task]}`,
    "The projection field holds the only project data you have been given. Do not assume facts it does not contain.",
    'In workloads, expected_usage.calls_per_month null with basis "unknown" means the monthly volume is unknown, and output_classification null means the output data classification has not been declared. Treat both as unknown; do not supply values for them, ask a question instead.',
    "Respond with a single JSON object and nothing else, with exactly these top-level fields:",
    `  protocol_version: "${INTELLIGENCE_PROTOCOL_VERSION}"`,
    '  proposed_constraints: array of { id, domain, severity (hard|soft|informational), direction (minimize|maximize|target, or null unless severity is soft), subject, operator (lte|gte|lt|gt|eq|neq|in|not_in|must_not_leave|must_remain_available_without|must_pass_through), value (string|number|boolean), source: "agent_proposed", rationale (string or null) }',
    "  proposed_candidates: array of { id, workload_ref (an existing workload id or null), component_kind (model_runtime|embedding_model|vector_store|retrieval_service|sanitizer|gateway|infrastructure), model_family (string or null), model_version (string or null), deployment_mode (local|managed_api|self_hosted), provider (string or null; managed_api or self_hosted only), rationale (string or null) }",
    "  questions: array of strings: unknowns the user must answer",
    '  inferences: array of { subject, claim, kind: "agent_inference", confidence (high|medium|low), caveats: array of strings }',
    "  rationale: { summary, generated_by } or null",
    "  proposed_architecture_nodes: array of { id, kind (service|external_system|datastore|queue|runtime|actor), name, trust_boundary (local|internal_network|remote_provider|third_party), description (string or null) }",
    "  proposed_relationships: array of { id, kind (connects|uses|deployed_in|composed_of), source, destination (node ids you propose in this response), workload_ref (an existing workload id or null), data_classification (a data classification declared by a workload, or null when unknown) }",
    "  proposed_decision_bindings: array of { decision_ref (an existing decision id with no binding yet), node_refs (node ids you propose in this response) }",
    "Existing architecture is not included in the projection. Propose only new node and relationship ids, and reference only nodes you propose here unless the user has given you an existing node id. Everything you propose is recorded as agent-proposed and unconfirmed until the user confirms it.",
    "Rules: ids must be new (never reuse an existing constraint, candidate, node or relationship id); never include approvals, decisions, statuses, measurements, estimates, constraint results, exceptions, evidence records, origins, confirmations or interfaces; never claim anything was measured, is viable or is confirmed; never include credentials. If something is unknown, add a question instead of guessing.",
  ].join("\n");
}

/** `sha256:` digest over the canonical bytes of a request. */
export function intelligenceRequestDigest(
  request: IntelligenceRequest,
): string {
  return `sha256:${createHash("sha256").update(stableStringify(request), "utf8").digest("hex")}`;
}

export interface BuiltIntelligenceRequest {
  readonly request: IntelligenceRequest;
  readonly projection: OutboundProjection;
  /** Digest over the exact request, which is what outbound consent binds. */
  readonly digest: string;
  /** Secrets anywhere in the request, not only the projection. Non-empty blocks sending. */
  readonly secret_findings: readonly SecretFinding[];
  /** Canonical rendering of the whole request, shown before anything is sent. */
  readonly request_json: string;
}

/**
 * Build the one provider-neutral request every intelligence mechanism receives.
 *
 * The same contract and task produce byte-identical requests regardless of
 * mechanism; only the projection's locality rules differ, and they are decided
 * by where the request will execute, never by which vendor receives it.
 */
export function buildIntelligenceRequest(
  contract: ProjectContract,
  options: {
    readonly task: IntelligenceTask;
    readonly execution: ExecutionLocality;
  },
): BuiltIntelligenceRequest {
  const projection = buildProjection(contract, {
    execution: options.execution,
    ...(options.execution === "local"
      ? { additionalFields: LOCAL_DISCLOSED_FIELDS }
      : {}),
  });
  const request = IntelligenceRequestSchema.parse({
    protocol_version: INTELLIGENCE_PROTOCOL_VERSION,
    task: options.task,
    projection: projection.payload,
    instructions: responseInstructions(options.task),
  });
  return {
    request,
    projection,
    digest: intelligenceRequestDigest(request),
    secret_findings: findSecrets(request),
    request_json: `${JSON.stringify(JSON.parse(stableStringify(request)), null, 2)}\n`,
  };
}
