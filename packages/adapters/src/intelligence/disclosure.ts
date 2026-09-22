import type { ProjectionField } from "@anvilmark/project-contract";

import type { BuiltIntelligenceRequest } from "./request.js";
import type { ValidatedRegistration } from "./registration.js";

/**
 * Everything the user is told before a request leaves ANVILMARK.
 *
 * Milestone 3 requires, before remote execution: the adapter and destination
 * category, the exact data categories in the projection, whether repository
 * content or evaluation rows are included, and whether provider usage may cost
 * money. Each is a field here so that no mechanism can omit one.
 */
export interface OutboundDisclosure {
  readonly adapter_id: string;
  readonly mechanism: "openai_compatible" | "handoff";
  readonly destination_category:
    "local_runtime" | "remote_provider" | "user_operated_agent";
  /** Declared `host[:port]`, or null when ANVILMARK does not send anything itself. */
  readonly destination: string | null;
  readonly destination_is_declared_policy: true;
  readonly model: string | null;
  readonly data_categories: readonly ProjectionField[];
  readonly withheld_categories: readonly ProjectionField[];
  readonly includes_repository_contents: boolean;
  readonly includes_evaluation_rows: boolean;
  readonly cost: "may_incur_cost" | "no_provider_charge" | "unknown";
  readonly credential_env: string | null;
  readonly request_digest: string;
  readonly request_bytes: number;
  readonly consent_required: boolean;
}

const REPOSITORY_FIELDS: readonly ProjectionField[] = [
  "repository_roots",
  "repository_bindings",
  "file_contents",
  "source_quoting_conformance_explanations",
];

function flags(fields: readonly ProjectionField[]) {
  return {
    includes_repository_contents: fields.some((field) =>
      REPOSITORY_FIELDS.includes(field),
    ),
    includes_evaluation_rows: fields.includes("evaluation_rows"),
  };
}

export function describeProviderDisclosure(
  built: BuiltIntelligenceRequest,
  provider: ValidatedRegistration,
): OutboundDisclosure {
  const registration = provider.registration;
  return {
    adapter_id: registration.id,
    mechanism: "openai_compatible",
    destination_category:
      registration.reach === "local" ? "local_runtime" : "remote_provider",
    destination: provider.destination,
    destination_is_declared_policy: true,
    model: registration.model,
    data_categories: built.projection.allowed_fields,
    withheld_categories: built.projection.withheld_fields,
    ...flags(built.projection.allowed_fields),
    cost: registration.cost,
    credential_env: registration.credential_env,
    request_digest: built.digest,
    request_bytes: Buffer.byteLength(built.request_json, "utf8"),
    consent_required: registration.reach === "remote",
  };
}

/**
 * A handoff file is written locally and ANVILMARK sends nothing. The agent the
 * user gives it to may well send it to a model provider, so the projection is
 * built under the REMOTE rules and the destination is reported as unknown
 * rather than as local.
 */
export function describeHandoffDisclosure(
  built: BuiltIntelligenceRequest,
): OutboundDisclosure {
  return {
    adapter_id: "handoff",
    mechanism: "handoff",
    destination_category: "user_operated_agent",
    destination: null,
    destination_is_declared_policy: true,
    model: null,
    data_categories: built.projection.allowed_fields,
    withheld_categories: built.projection.withheld_fields,
    ...flags(built.projection.allowed_fields),
    cost: "unknown",
    credential_env: null,
    request_digest: built.digest,
    request_bytes: Buffer.byteLength(built.request_json, "utf8"),
    consent_required: false,
  };
}
