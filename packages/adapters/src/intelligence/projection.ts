import type {
  ProjectContract,
  ProjectionField,
  SecretFinding,
} from "@anvilmark/project-contract";
import {
  RATIFIED_DEFAULT_DENY,
  compareCodeUnits,
  findSecrets,
  prettyStringify,
} from "@anvilmark/project-contract";

import type { ExecutionLocality } from "../envelope.js";

export interface OutboundProjection {
  readonly execution: ExecutionLocality;
  readonly allowed_fields: readonly ProjectionField[];
  readonly withheld_fields: readonly ProjectionField[];
  /** Exactly what would be sent. Nothing else leaves the machine. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Canonical rendering, for showing the user before sending. */
  readonly payload_json: string;
  /** Non-empty means the payload must not be sent. */
  readonly secret_findings: readonly SecretFinding[];
}

/**
 * Build the exact payload an intelligence adapter may receive.
 *
 * Projection is allow-list driven: a field appears only if the contract's own
 * `remote_intelligence_policy.default_allow` names it. Nothing is included by
 * being harmless-looking, and nothing is included by default.
 *
 * Hardware is the interesting case. Capacity — "24 GB NVIDIA GPU" — is
 * shareable and useful for candidate selection. Machine identity is not, so
 * the projection carries capability fields and never a hostname, serial, or
 * local path. The contract schema holds no such fields in the first place,
 * which is deliberate rather than accidental.
 */
export function buildProjection(
  contract: ProjectContract,
  options: {
    readonly execution: ExecutionLocality;
    /**
     * Extra fields a LOCAL adapter may receive under a separately disclosed
     * policy. Ratified default-deny fields are refused even here.
     */
    readonly additionalFields?: readonly ProjectionField[];
  },
): OutboundProjection {
  const policy = contract.remote_intelligence_policy;
  const requested = new Set<ProjectionField>(policy.default_allow);

  for (const field of options.additionalFields ?? []) {
    if (RATIFIED_DEFAULT_DENY.includes(field)) {
      continue;
    }
    if (options.execution === "local") {
      requested.add(field);
    }
  }

  const allowed = [...requested]
    .filter((field) => !RATIFIED_DEFAULT_DENY.includes(field))
    .sort(compareCodeUnits);

  // Projection-local aliases keep correlation possible without sending the
  // contract's own hardware identifiers.
  const hardwareAlias = new Map<string, string>(
    contract.resources.hardware.map((entry, index) => [
      entry.id,
      `hardware-${index + 1}`,
    ]),
  );
  const aliasFor = (id: string | null): string | null =>
    id === null ? null : (hardwareAlias.get(id) ?? "hardware-unknown");

  const payload: Record<string, unknown> = {};

  for (const field of allowed) {
    switch (field) {
      case "intent":
        payload.intent = contract.intent;
        break;
      case "constraints":
        payload.constraints = contract.constraints;
        break;
      case "workloads":
        payload.workloads = contract.workloads;
        break;
      case "data_classification_labels":
        // Input labels, and declared output labels (draft.4). An undeclared
        // output classification contributes nothing: it is unknown, not a label.
        payload.data_classification_labels = [
          ...new Set(
            contract.workloads.flatMap((entry) =>
              entry.output_classification === null
                ? [entry.input_classification]
                : [entry.input_classification, entry.output_classification],
            ),
          ),
        ].sort(compareCodeUnits);
        break;
      case "budgets":
        payload.budgets = contract.resources.budgets;
        break;
      case "non_identifying_hardware_capabilities":
        // Capacity only, under a projection-local alias. A contract hardware
        // id is a device identifier: it is chosen by the user, it often names
        // the machine, and decision 06 section 9 default-denies exactly that.
        payload.hardware_capabilities = contract.resources.hardware.map(
          (entry, index) => ({
            alias: `hardware-${index + 1}`,
            evidence_kind: entry.evidence_kind,
            cpu_cores: entry.cpu.cores,
            ram_gb: entry.ram_gb,
            accelerators: entry.accelerators,
            backend: entry.backend,
            operating_system: entry.operating_system,
          }),
        );
        break;
      case "candidates":
        payload.candidates = contract.candidates.map((entry) =>
          entry.deployment.mode === "local"
            ? {
                ...entry,
                deployment: {
                  ...entry.deployment,
                  // Replaced by the alias so correlation survives without the
                  // device identifier leaving the machine.
                  hardware_ref: aliasFor(entry.deployment.hardware_ref),
                },
              }
            : entry,
        );
        break;
      case "evidence_metadata_without_local_locators":
        // Metadata only: the locator can name a local path or a command
        // manifest, and the value can carry evaluation rows.
        payload.evidence_metadata = contract.evidence_refs.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          subject: entry.subject,
          producer: entry.producer,
          observed_at: entry.observed_at,
          confidence: entry.confidence,
          caveats: entry.caveats,
          refresh: entry.refresh,
          applies_to: {
            ...entry.applies_to,
            hardware_ref: aliasFor(entry.applies_to.hardware_ref),
          },
        }));
        break;
      case "decisions":
        payload.decisions = contract.decisions;
        break;
      case "conformance_rule_definitions":
        payload.conformance_rules = contract.conformance_rules;
        break;
      default:
        // Ratified default-deny fields are filtered out above. Anything
        // reaching here is deliberately not projected.
        break;
    }
  }

  const withheld = RATIFIED_DEFAULT_DENY.filter(
    (field) => !allowed.includes(field),
  ).sort(compareCodeUnits);

  return {
    execution: options.execution,
    allowed_fields: allowed,
    withheld_fields: withheld,
    payload,
    payload_json: prettyStringify(payload),
    secret_findings: findSecrets(payload),
  };
}

/** True when the projection is safe to send. */
export function isProjectionSendable(projection: OutboundProjection): boolean {
  return projection.secret_findings.length === 0;
}
