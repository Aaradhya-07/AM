import { z } from "zod";

const Nonempty = z.string().trim().min(1);
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const Timestamp = z
  .string()
  .refine(
    (value) =>
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "use a UTC ISO timestamp with milliseconds",
  );
const Source = z
  .strictObject({
    kind: z.enum([
      "provider_document",
      "operator_attestation",
      "local_observation",
      "public_research",
    ]),
    ref: Nonempty,
    observed_at: Timestamp,
    expires_at: Timestamp,
  })
  .refine(
    (source) => Date.parse(source.expires_at) > Date.parse(source.observed_at),
    "fact expiry must follow observation",
  );

const Sourced = <T extends z.ZodType>(value: T) =>
  z.strictObject({ value, source: Source });

export const ConfigurationBilling = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("subscription") }),
  z.strictObject({
    mode: z.literal("api_estimate"),
    input_usd_per_million: z.number().finite().nonnegative(),
    cached_input_usd_per_million: z.number().finite().nonnegative().optional(),
    output_usd_per_million: z.number().finite().nonnegative(),
  }),
]);

export const DevelopmentConfiguration = z.strictObject({
  format: z.literal("anvilmark-development-configuration/1"),
  id: Id,
  agent: Nonempty,
  model: Nonempty,
  deployment_id: Nonempty,
  provider: Sourced(Nonempty).optional(),
  data_regions: Sourced(z.array(Nonempty).min(1)).optional(),
  billing: Sourced(ConfigurationBilling).optional(),
  capabilities: z.record(Id, Sourced(z.boolean())).optional(),
});

export const DevelopmentConfigurationImport = z.strictObject({
  format: z.literal("anvilmark-development-catalog/1"),
  configurations: z.array(DevelopmentConfiguration).min(1),
});
