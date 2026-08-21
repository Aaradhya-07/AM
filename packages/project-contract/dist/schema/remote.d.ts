import { z } from "zod/v4";
/**
 * Fields that may appear in a remote-intelligence projection decision,
 * enumerated from doc 06 section 9.
 */
export declare const ProjectionFieldSchema: z.ZodEnum<{
    repository_roots: "repository_roots";
    owners: "owners";
    intent: "intent";
    constraints: "constraints";
    workloads: "workloads";
    data_classification_labels: "data_classification_labels";
    budgets: "budgets";
    non_identifying_hardware_capabilities: "non_identifying_hardware_capabilities";
    candidates: "candidates";
    evidence_metadata_without_local_locators: "evidence_metadata_without_local_locators";
    decisions: "decisions";
    conformance_rule_definitions: "conformance_rule_definitions";
    repository_bindings: "repository_bindings";
    file_contents: "file_contents";
    local_machine_identifiers: "local_machine_identifiers";
    integration_credential_references: "integration_credential_references";
    integration_data_directories: "integration_data_directories";
    local_command_lines: "local_command_lines";
    evaluation_rows: "evaluation_rows";
    source_quoting_conformance_explanations: "source_quoting_conformance_explanations";
}>;
export type ProjectionField = z.infer<typeof ProjectionFieldSchema>;
/**
 * The ratified default-deny set. These fields identify the user's machine,
 * their source code, or their credentials. A contract may not move any of
 * them into `default_allow`: hardware CAPACITY such as "24 GB NVIDIA GPU" is
 * shareable, machine IDENTITY is not.
 */
export declare const RATIFIED_DEFAULT_DENY: readonly ProjectionField[];
export declare const RemoteIntelligencePolicySchema: z.ZodObject<{
    default_allow: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        repository_roots: "repository_roots";
        owners: "owners";
        intent: "intent";
        constraints: "constraints";
        workloads: "workloads";
        data_classification_labels: "data_classification_labels";
        budgets: "budgets";
        non_identifying_hardware_capabilities: "non_identifying_hardware_capabilities";
        candidates: "candidates";
        evidence_metadata_without_local_locators: "evidence_metadata_without_local_locators";
        decisions: "decisions";
        conformance_rule_definitions: "conformance_rule_definitions";
        repository_bindings: "repository_bindings";
        file_contents: "file_contents";
        local_machine_identifiers: "local_machine_identifiers";
        integration_credential_references: "integration_credential_references";
        integration_data_directories: "integration_data_directories";
        local_command_lines: "local_command_lines";
        evaluation_rows: "evaluation_rows";
        source_quoting_conformance_explanations: "source_quoting_conformance_explanations";
    }>>>;
    default_deny: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        repository_roots: "repository_roots";
        owners: "owners";
        intent: "intent";
        constraints: "constraints";
        workloads: "workloads";
        data_classification_labels: "data_classification_labels";
        budgets: "budgets";
        non_identifying_hardware_capabilities: "non_identifying_hardware_capabilities";
        candidates: "candidates";
        evidence_metadata_without_local_locators: "evidence_metadata_without_local_locators";
        decisions: "decisions";
        conformance_rule_definitions: "conformance_rule_definitions";
        repository_bindings: "repository_bindings";
        file_contents: "file_contents";
        local_machine_identifiers: "local_machine_identifiers";
        integration_credential_references: "integration_credential_references";
        integration_data_directories: "integration_data_directories";
        local_command_lines: "local_command_lines";
        evaluation_rows: "evaluation_rows";
        source_quoting_conformance_explanations: "source_quoting_conformance_explanations";
    }>>>;
    show_payload_before_remote_send: z.ZodDefault<z.ZodBoolean>;
    scan_outbound_payload_for_secrets: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export type RemoteIntelligencePolicy = z.infer<typeof RemoteIntelligencePolicySchema>;
//# sourceMappingURL=remote.d.ts.map