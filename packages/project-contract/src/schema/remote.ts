import { z } from "zod/v4";

/**
 * Fields that may appear in a remote-intelligence projection decision,
 * enumerated from doc 06 section 9.
 */
export const ProjectionFieldSchema = z.enum([
  // Safe by default.
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
  // Denied by default.
  "repository_roots",
  "repository_bindings",
  "file_contents",
  "owners",
  "local_machine_identifiers",
  "integration_credential_references",
  "integration_data_directories",
  "local_command_lines",
  "evaluation_rows",
  "source_quoting_conformance_explanations",
]);

export type ProjectionField = z.infer<typeof ProjectionFieldSchema>;

/**
 * The ratified default-deny set. These fields identify the user's machine,
 * their source code, or their credentials. A contract may not move any of
 * them into `default_allow`: hardware CAPACITY such as "24 GB NVIDIA GPU" is
 * shareable, machine IDENTITY is not.
 */
export const RATIFIED_DEFAULT_DENY: readonly ProjectionField[] = [
  "repository_roots",
  "repository_bindings",
  "file_contents",
  "owners",
  "local_machine_identifiers",
  "integration_credential_references",
  "integration_data_directories",
  "local_command_lines",
  "evaluation_rows",
  "source_quoting_conformance_explanations",
] as const;

export const RemoteIntelligencePolicySchema = z.strictObject({
  default_allow: z.array(ProjectionFieldSchema).default([]),
  default_deny: z.array(ProjectionFieldSchema).default([]),
  /** The exact outbound payload is shown before sending. */
  show_payload_before_remote_send: z.boolean().default(true),
  /** The outbound payload is scanned for secret patterns before sending. */
  scan_outbound_payload_for_secrets: z.boolean().default(true),
});

export type RemoteIntelligencePolicy = z.infer<
  typeof RemoteIntelligencePolicySchema
>;
