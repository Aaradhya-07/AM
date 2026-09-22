import { z } from "zod/v4";

import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";
import type { AdapterIdentity, AdapterOutcome } from "../envelope.js";
import { ADAPTER_PROTOCOL_VERSION } from "../version.js";
import { adapterError, available, notAvailable } from "../envelope.js";
import type { BuiltEvidence } from "./builder.js";
import { buildEvidenceRecord } from "./builder.js";
import { ProposalAttributionSchema } from "./proposal.js";

/** The classes of attributable fact a person can enter by hand. */
export const MANUAL_IMPORT_SUBJECTS = [
  "pricing",
  "licence",
  "residency",
  "provider_capability",
  "model_documentation",
] as const;

export type ManualImportSubject = (typeof MANUAL_IMPORT_SUBJECTS)[number];

const AttributionSourceSchema = z.strictObject({
  /** Who published the fact, e.g. the provider or the model publisher. */
  publisher: z.string().min(1).nullable(),
  /** Where it was read. */
  locator: z.string().min(1).nullable(),
  /** When it was read. */
  retrieved_at: z.iso.datetime({ offset: true }),
});

const CommonSchema = {
  id: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  claim: z.string().min(1),
  /** The exact thing described, e.g. a model or provider identifier. */
  exact_subject: z.string().min(1),
  exact_version: z.string().min(1).nullable().default(null),
  source: AttributionSourceSchema,
  applies_to: ProposalAttributionSchema,
  assumptions: z.array(z.string().min(1)).default([]),
  exclusions: z.array(z.string().min(1)).default([]),
  caveats: z.array(z.string().min(1)).default([]),
  expires_at: z.iso.datetime({ offset: true }).nullable().default(null),
};

export const ManualImportRequestSchema = z.discriminatedUnion("subject", [
  z.strictObject({
    ...CommonSchema,
    subject: z.literal("pricing"),
    currency: z.string().regex(/^[A-Z]{3}$/),
    unit: z.string().min(1),
    amount: z.number().nonnegative(),
    region: z.string().min(1).nullable().default(null),
    tier: z.string().min(1).nullable().default(null),
  }),
  z.strictObject({
    ...CommonSchema,
    subject: z.enum([
      "licence",
      "residency",
      "provider_capability",
      "model_documentation",
    ]),
    /** Free-form attributable detail, e.g. the licence identifier. */
    details: z.record(z.string(), z.unknown()).default({}),
  }),
]);

export type ManualImportRequest = z.infer<typeof ManualImportRequestSchema>;

export const MANUAL_IMPORTER_IDENTITY: AdapterIdentity = {
  id: "manual-import",
  kind: "manual_import",
  version: ADAPTER_PROTOCOL_VERSION,
  execution: "local",
  protocol_version: ADAPTER_PROTOCOL_VERSION,
};

/**
 * Import an attributable fact entered by a person.
 *
 * The load-bearing rule, from the milestone guide: a copied claim without an
 * attributable source stays T1. If either the publisher or the source locator
 * is missing, the record is recorded as a `vendor_claim` rather than as
 * official pricing or documentation, and a caveat says why. It is downgraded
 * rather than rejected, because an unattributed claim is still worth keeping —
 * it just cannot clear a T2 floor.
 */
export function importManualEvidence(
  request: unknown,
  options: { readonly clock?: Clock } = {},
): AdapterOutcome<BuiltEvidence> {
  const clock = options.clock ?? systemClock;
  const startedAt = clock();

  const meta = (diagnostics: readonly string[]) => ({
    adapter: MANUAL_IMPORTER_IDENTITY,
    started_at: startedAt,
    completed_at: clock(),
    provenance: {
      command_manifest: null,
      locator:
        typeof request === "object" &&
        request !== null &&
        "source" in request &&
        typeof (request as { source?: { locator?: unknown } }).source
          ?.locator === "string"
          ? (request as { source: { locator: string } }).source.locator
          : null,
      raw_result_hash: null,
    },
    diagnostics,
  });

  const parsed = ManualImportRequestSchema.safeParse(request);
  if (!parsed.success) {
    return notAvailable(
      "failed",
      [
        adapterError(
          "schema_rejected",
          "the manual import request was incomplete; every imported fact needs a subject, source, retrieval time, and constraint attribution",
          { issues: parsed.error.issues.length },
        ),
      ],
      meta([]),
    );
  }

  const input = parsed.data;
  const attributable =
    input.source.publisher !== null && input.source.locator !== null;

  const diagnostics: string[] = [];
  const caveats = [...input.caveats];
  if (!attributable) {
    diagnostics.push(
      "recorded as a vendor claim because the publisher or source locator is missing",
    );
    caveats.push(
      "no attributable publisher and source locator were supplied, so this is a claim rather than authoritative documentation",
    );
  }

  const kind = attributable
    ? input.subject === "pricing"
      ? "official_pricing"
      : "official_documentation"
    : "vendor_claim";

  // `official_pricing` has a required payload shape in the contract. A
  // downgraded claim uses the generic shape and keeps the same numbers.
  const value =
    input.subject === "pricing"
      ? kind === "official_pricing"
        ? {
            currency: input.currency,
            unit: input.unit,
            amount: input.amount,
            region: input.region,
            tier: input.tier,
            exclusions: input.exclusions,
          }
        : {
            currency: input.currency,
            unit: input.unit,
            amount: input.amount,
            region: input.region,
            tier: input.tier,
            exclusions: input.exclusions,
            exact_subject: input.exact_subject,
            exact_version: input.exact_version,
          }
      : {
          ...input.details,
          exact_subject: input.exact_subject,
          exact_version: input.exact_version,
        };

  const built = buildEvidenceRecord({
    id: input.id,
    kind,
    subject: input.exact_subject,
    claim: input.claim,
    producer: {
      name: input.source.publisher ?? "unattributed",
      version: input.exact_version,
    },
    observed_at: input.source.retrieved_at,
    source: {
      type: input.source.locator === null ? "manual" : "url",
      locator: input.source.locator,
    },
    command_manifest: null,
    applies_to: input.applies_to,
    value,
    units: input.subject === "pricing" ? { amount: input.unit } : {},
    assumptions: input.assumptions,
    exclusions: input.exclusions,
    raw_result_hash: null,
    confidence: attributable ? "high" : "low",
    caveats,
    refresh: {
      policy: input.subject === "pricing" ? "on_pricing_change" : "periodic",
      expires_at: input.expires_at,
    },
    standing: "available",
  });

  if (!built.ok) {
    return notAvailable("failed", built.errors, meta(diagnostics));
  }
  return available(built.value, meta(diagnostics));
}
