import { z } from "zod/v4";
/**
 * A credential REFERENCE, never a credential value. Examples of acceptable
 * values are `OPENAI_API_KEY`, `env:MY_TOKEN`, `keychain:anvilmark/openai`,
 * or `existing_session_or_environment`. Secret scanning independently
 * rejects anything that looks like a real key, token, or password.
 */
export declare const CredentialRefSchema: z.ZodString;
/** The user's chosen intelligence: a coding agent, an API key, or a local runtime. */
export declare const IntelligenceIntegrationSchema: z.ZodObject<{
    kind: z.ZodLiteral<"intelligence">;
    credential_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    default_data_projection: z.ZodDefault<z.ZodEnum<{
        public_decision_layer: "public_decision_layer";
        local_full: "local_full";
    }>>;
    additional_data_requires_consent: z.ZodDefault<z.ZodArray<z.ZodString>>;
    id: z.ZodString;
    adapter: z.ZodString;
}, z.core.$strict>;
/** An optional evaluation subprocess such as promptfoo. */
export declare const EvaluationIntegrationSchema: z.ZodObject<{
    kind: z.ZodLiteral<"evaluation">;
    credential_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    data_directory: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    network_policy: z.ZodDefault<z.ZodEnum<{
        explicit_provider_only: "explicit_provider_only";
        offline: "offline";
        unrestricted: "unrestricted";
    }>>;
    id: z.ZodString;
    adapter: z.ZodString;
}, z.core.$strict>;
/** An optional hardware-fit subprocess such as llmfit. */
export declare const HardwareFitIntegrationSchema: z.ZodObject<{
    kind: z.ZodLiteral<"hardware_fit">;
    mode: z.ZodDefault<z.ZodEnum<{
        local: "local";
        remote: "remote";
    }>>;
    id: z.ZodString;
    adapter: z.ZodString;
}, z.core.$strict>;
export declare const IntegrationSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"intelligence">;
    credential_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    default_data_projection: z.ZodDefault<z.ZodEnum<{
        public_decision_layer: "public_decision_layer";
        local_full: "local_full";
    }>>;
    additional_data_requires_consent: z.ZodDefault<z.ZodArray<z.ZodString>>;
    id: z.ZodString;
    adapter: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"evaluation">;
    credential_ref: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    data_directory: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    network_policy: z.ZodDefault<z.ZodEnum<{
        explicit_provider_only: "explicit_provider_only";
        offline: "offline";
        unrestricted: "unrestricted";
    }>>;
    id: z.ZodString;
    adapter: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"hardware_fit">;
    mode: z.ZodDefault<z.ZodEnum<{
        local: "local";
        remote: "remote";
    }>>;
    id: z.ZodString;
    adapter: z.ZodString;
}, z.core.$strict>], "kind">;
export type Integration = z.infer<typeof IntegrationSchema>;
//# sourceMappingURL=integrations.d.ts.map