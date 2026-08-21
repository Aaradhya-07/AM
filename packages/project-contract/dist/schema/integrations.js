import { z } from "zod/v4";
import { IdSchema, NonEmptyStringSchema, RelativePathSchema, } from "./primitives.js";
/**
 * A credential REFERENCE, never a credential value. Examples of acceptable
 * values are `OPENAI_API_KEY`, `env:MY_TOKEN`, `keychain:anvilmark/openai`,
 * or `existing_session_or_environment`. Secret scanning independently
 * rejects anything that looks like a real key, token, or password.
 */
export const CredentialRefSchema = NonEmptyStringSchema;
/**
 * `adapter` is a free string on purpose. Enumerating adapters here would
 * couple the core schema to a fixed set of vendors and tools, which the
 * canonical brief forbids.
 */
const integrationBase = {
    id: IdSchema,
    adapter: NonEmptyStringSchema,
};
/** The user's chosen intelligence: a coding agent, an API key, or a local runtime. */
export const IntelligenceIntegrationSchema = z.strictObject({
    ...integrationBase,
    kind: z.literal("intelligence"),
    credential_ref: CredentialRefSchema.nullable().default(null),
    default_data_projection: z
        .enum(["public_decision_layer", "local_full"])
        .default("public_decision_layer"),
    additional_data_requires_consent: z.array(NonEmptyStringSchema).default([]),
});
/** An optional evaluation subprocess such as promptfoo. */
export const EvaluationIntegrationSchema = z.strictObject({
    ...integrationBase,
    kind: z.literal("evaluation"),
    credential_ref: CredentialRefSchema.nullable().default(null),
    /** Isolated data directory; default-denied to remote intelligence. */
    data_directory: RelativePathSchema.nullable().default(null),
    network_policy: z
        .enum(["explicit_provider_only", "offline", "unrestricted"])
        .default("explicit_provider_only"),
});
/** An optional hardware-fit subprocess such as llmfit. */
export const HardwareFitIntegrationSchema = z.strictObject({
    ...integrationBase,
    kind: z.literal("hardware_fit"),
    mode: z.enum(["local", "remote"]).default("local"),
});
export const IntegrationSchema = z.discriminatedUnion("kind", [
    IntelligenceIntegrationSchema,
    EvaluationIntegrationSchema,
    HardwareFitIntegrationSchema,
]);
