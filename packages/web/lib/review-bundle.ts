import { z } from "zod";

// Browser-side reading of `anvilmark-review-bundle/1`. Objects are loose so
// that engine fields the Studio does not render yet are kept, not stripped.

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const PositionSchema = z.looseObject({
  line: z.number(),
  column: z.number(),
});

const LocationSchema = z.looseObject({
  path: z.string(),
  start: PositionSchema,
  end: PositionSchema.optional(),
  symbol: z.string().nullable().optional(),
  source_sha256: z.string().optional(),
});

const OptionalRef = z.string().nullable().optional();

const ResultSchema = z.looseObject({
  id: z.string().optional(),
  rule_ref: z.string(),
  rule_kind: z.string().optional(),
  verdict: z.string(),
  explanation: z.string(),
  standing: z.string().optional(),
  evidence_tier: z.string().optional(),
  constraint_ref: OptionalRef,
  decision_ref: OptionalRef,
  workload_ref: OptionalRef,
  candidate_ref: OptionalRef,
  architecture_node_ref: OptionalRef,
  locations: z.array(LocationSchema),
  trace: z.array(
    z.looseObject({
      kind: z.string(),
      path: z.string().optional(),
      start: PositionSchema.optional(),
      end: PositionSchema.optional(),
      symbol: z.string().nullable().optional(),
      declaration_ref: OptionalRef,
    }),
  ),
  supported_scope: z.string().optional(),
  caveats: z.array(z.string()).optional(),
  unknown_reasons: z.array(z.string()).optional(),
  suggested_alternatives: z.array(
    z.looseObject({
      kind: z.string().optional(),
      summary: z.string(),
      details: z.string().optional(),
    }),
  ),
});

const ArtifactContractSchema = z.looseObject({
  project_id: z.string(),
  contract_hash: z.string(),
});

const PartStatusSchema = z.enum(["available", "missing", "error"]);
const FreshnessSchema = z.enum(["current", "stale"]).nullable();

export const BrowserReviewEnvelopeSchema = z.looseObject({
  format: z.literal("anvilmark-review-bundle/1"),
  schema_version: z.string(),
  exported_at: z.string(),
  generator: z.string(),
  projection: z.enum(["local", "shareable"]),
  source_control: z
    .looseObject({
      head_sha: z.string().nullable(),
      dirty: z.boolean().nullable(),
    })
    .nullable(),
  project: z.looseObject({
    id: z.string(),
    name: z.string(),
    contract_revision: z.number(),
    state_revision: z.number().nullable(),
    contract_hash: DigestSchema,
  }),
  contract: z.looseObject({
    canonical: z.looseObject({
      project: z.looseObject({
        id: z.string(),
        name: z.string(),
      }),
      decisions: z.array(
        z.looseObject({
          id: z.string(),
          revision: z.number(),
          status: z.string(),
          selected_candidate_ref: z.string().nullable(),
          rationale: z.looseObject({ summary: z.string() }),
        }),
      ),
      constraints: z.array(
        z.looseObject({
          id: z.string(),
          domain: z.string(),
          severity: z.string(),
          value: z.unknown(),
        }),
      ),
      conformance_rules: z.array(z.looseObject({ id: z.string() })),
    }),
    content_hash: DigestSchema,
    redactions: z.array(z.string()),
  }),
  facts: z.record(z.string(), z.unknown()),
  scan: z.looseObject({
    status: PartStatusSchema,
    freshness: FreshnessSchema,
    problems: z.array(z.string()),
    content_hash: DigestSchema.nullable(),
    observed_at: z.string().nullable(),
    artifact: z
      .looseObject({
        content_hash: z.string(),
        contract: ArtifactContractSchema,
        // Read when comparing snapshots, to see whether the scanned scope moved.
        configuration: z.looseObject({}).optional(),
        repository: z
          .looseObject({
            inputs: z.array(z.looseObject({ path: z.string() })).optional(),
          })
          .optional(),
      })
      .nullable(),
  }),
  report: z.looseObject({
    status: PartStatusSchema,
    freshness: FreshnessSchema,
    problems: z.array(z.string()),
    conformance_hash: DigestSchema.nullable(),
    evaluated_at: z.string().nullable(),
    artifact: z
      .looseObject({
        conformance_hash: z.string(),
        contract: ArtifactContractSchema,
        scan: z.looseObject({ content_hash: z.string() }),
        summary: z.looseObject({
          total: z.number(),
          pass: z.number(),
          fail: z.number(),
          unknown: z.number(),
          compliant: z.boolean(),
        }),
        results: z.array(ResultSchema),
        analysis_errors: z.array(z.string()),
      })
      .nullable(),
  }),
  sources: z.record(z.string(), z.string()).optional(),
  manifest: z.looseObject({
    files_included: z.array(z.string()),
    has_source: z.boolean(),
    sources_omitted: z.array(
      z.looseObject({ path: z.string(), reason: z.string() }),
    ),
    rule_count: z.number(),
    workload_count: z.number(),
  }),
  integrity_hash: DigestSchema,
});

export type WebReviewEnvelope = z.infer<typeof BrowserReviewEnvelopeSchema>;

export type WebReviewBundleValidationResult =
  | {
      readonly status: "valid";
      readonly bundle: WebReviewEnvelope;
      /** The bundle is consistent, but these limits apply to what it shows. */
      readonly warnings: readonly string[];
    }
  | { readonly status: "invalid"; readonly errors: readonly string[] };

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * The canonical JSON that `@anvilmark/project-contract` hashes: keys sorted by
 * UTF-16 code unit, array order kept, `undefined` members dropped. Input here
 * is always parsed JSON, so no other value types can occur.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value as Json));
}

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

export async function sha256Digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const hex = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

/** Mirrors `reportConformanceHash`: observation time is provenance, not identity. */
function reportHashInput(report: Record<string, unknown>): unknown {
  const { observed_at, ...scan } = report.scan as Record<string, unknown>;
  void observed_at;
  return {
    format: report.format,
    engine: report.engine,
    contract: report.contract,
    scan,
    summary: report.summary,
    results: report.results,
    analysis_errors: report.analysis_errors,
  };
}

/**
 * Validate a bundle's shape and recompute its hashes, as the CLI's
 * `readWebReviewBundle` does. Matching hashes show the content is internally
 * consistent; they do not show who produced it.
 */
export async function verifyBundleInBrowser(
  raw: unknown,
): Promise<WebReviewBundleValidationResult> {
  const parsed = BrowserReviewEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "invalid",
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    };
  }

  const bundle = parsed.data;
  const input = raw as Record<string, unknown>;
  const errors: string[] = [];
  const warnings: string[] = [];

  const { integrity_hash, ...content } = input;
  const expectedIntegrity = await sha256Digest(canonicalJson(content));
  if (integrity_hash !== expectedIntegrity) {
    errors.push(
      `Bundle integrity hash mismatch: the content changed after export (expected ${expectedIntegrity}, bundle says ${String(integrity_hash)})`,
    );
  }

  const contractHash = bundle.contract.content_hash;
  if (bundle.project.contract_hash !== contractHash) {
    errors.push(
      `Project contract hash mismatch: project says ${bundle.project.contract_hash}, contract says ${contractHash}`,
    );
  }
  if (bundle.projection === "local") {
    const canonical = (input.contract as Record<string, unknown>).canonical;
    const expectedContract = await sha256Digest(canonicalJson(canonical));
    if (contractHash !== expectedContract) {
      errors.push(
        `Contract content hash mismatch: expected ${expectedContract}, bundle says ${contractHash}`,
      );
    }
    if (bundle.contract.redactions.length > 0) {
      errors.push("A local bundle must not list contract redactions");
    }
  } else {
    warnings.push(
      `This is a shareable bundle: ${bundle.contract.redactions.length} contract field(s) such as identities and local paths were removed. The contract hash was taken before removal and cannot be rechecked here.`,
    );
  }

  const checkPart = (
    name: "Scan" | "Report",
    part: {
      readonly status: string;
      readonly freshness: "current" | "stale" | null;
      readonly problems: readonly string[];
    },
    artifact: {
      readonly contract: { project_id: string; contract_hash: string };
    } | null,
  ) => {
    if (part.status !== "available") {
      if (artifact) {
        errors.push(
          `${name} status is ${part.status} but an artifact is included`,
        );
      }
      if (part.problems.length > 0) {
        warnings.push(`${name} not included: ${part.problems.join("; ")}`);
      }
      return;
    }
    if (!artifact) {
      errors.push(`${name} status is available but the artifact is missing`);
      return;
    }
    if (part.freshness === null) {
      errors.push(`${name} status is available but freshness is not set`);
    }
    if (artifact.contract.project_id !== bundle.project.id) {
      errors.push(
        `${name} belongs to project ${artifact.contract.project_id}, not ${bundle.project.id}`,
      );
    }
    if (part.freshness === "stale") {
      warnings.push(
        `The ${name.toLowerCase()} was exported as stale, so it may not reflect the current code or contract${
          part.problems.length > 0 ? `: ${part.problems.join("; ")}` : "."
        }`,
      );
    } else if (artifact.contract.contract_hash !== contractHash) {
      errors.push(
        `${name} was produced for a different contract but is not marked stale`,
      );
    }
  };

  const scan = bundle.scan.artifact;
  checkPart("Scan", bundle.scan, scan);
  if (scan && bundle.scan.content_hash !== scan.content_hash) {
    errors.push(
      `Scan content hash mismatch: envelope says ${bundle.scan.content_hash}, artifact says ${scan.content_hash}`,
    );
  }

  const report = bundle.report.artifact;
  checkPart("Report", bundle.report, report);
  if (report) {
    const rawReport = (input.report as Record<string, unknown>)
      .artifact as Record<string, unknown>;
    const expectedReport = await sha256Digest(
      canonicalJson(reportHashInput(rawReport)),
    );
    if (report.conformance_hash !== expectedReport) {
      errors.push(
        `Report conformance hash mismatch: expected ${expectedReport}, report says ${report.conformance_hash}`,
      );
    }
    if (bundle.report.conformance_hash !== report.conformance_hash) {
      errors.push(
        `Report hash mismatch: envelope says ${bundle.report.conformance_hash}, report says ${report.conformance_hash}`,
      );
    }
  }

  if (
    scan &&
    report &&
    bundle.scan.freshness === "current" &&
    bundle.report.freshness === "current" &&
    report.scan.content_hash !== scan.content_hash
  ) {
    errors.push(
      "Scan and report are both marked current but the report was evaluated on a different scan",
    );
  }

  const omitted = bundle.manifest.sources_omitted;
  if (omitted.length > 0) {
    const reasons = [...new Set(omitted.map((entry) => entry.reason))];
    warnings.push(
      `${omitted.length} source file(s) were left out of this bundle (${reasons.join(", ")}), so their code cannot be shown.`,
    );
  }

  if (errors.length > 0) {
    return { status: "invalid", errors };
  }
  return { status: "valid", bundle, warnings };
}
