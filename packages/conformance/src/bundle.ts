import { z } from "zod/v4";

import {
  ProjectContractSchema,
  TimestampSchema,
  stableStringify,
} from "@anvilmark/project-contract";
import type { ProjectContract } from "@anvilmark/project-contract";
import { ScanArtifactSchema, sha256 } from "@anvilmark/scanner";
import type { ScanArtifact } from "@anvilmark/scanner";
import { ConformanceReportSchema, reportConformanceHash } from "./schemas.js";
import type { ConformanceReport } from "./schemas.js";
import {
  WEB_REVIEW_BUNDLE_FORMAT,
  WEB_REVIEW_BUNDLE_SCHEMA_VERSION,
} from "./version.js";
import { buildProjectFacts, contractHash } from "@anvilmark/context";

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/**
 * `local` carries the full canonical contract. `shareable` removes identities,
 * local directories and credential references so the bundle can be attached
 * to a pull request or sent to a teammate; code locations are kept.
 */
export const ReviewBundleProjectionSchema = z.enum(["local", "shareable"]);
export type ReviewBundleProjection = z.infer<
  typeof ReviewBundleProjectionSchema
>;

/** Whether a stored artifact still matched the project when it was exported. */
export const ArtifactFreshnessSchema = z.enum(["current", "stale"]);
export type ArtifactFreshness = z.infer<typeof ArtifactFreshnessSchema>;

export const OmittedSourceReasonSchema = z.enum([
  "outside_repository",
  "unreadable",
  "too_large",
  "total_limit",
  "modified_since_scan",
  "not_in_scan",
  "possible_secret",
]);
export type OmittedSourceReason = z.infer<typeof OmittedSourceReasonSchema>;

export const OmittedSourceSchema = z.strictObject({
  path: z.string(),
  reason: OmittedSourceReasonSchema,
});
export type OmittedSource = z.infer<typeof OmittedSourceSchema>;

const PartStatusSchema = z.enum(["available", "missing", "error"]);

export const WebReviewEnvelopeSchema = z.strictObject({
  format: z.literal(WEB_REVIEW_BUNDLE_FORMAT),
  schema_version: z.string(),
  exported_at: TimestampSchema,
  generator: z.string(),
  projection: ReviewBundleProjectionSchema,
  project: z.strictObject({
    id: z.string(),
    name: z.string(),
    contract_revision: z.int(),
    state_revision: z.int().nullable(),
    contract_hash: DigestSchema,
  }),
  contract: z.strictObject({
    canonical: ProjectContractSchema,
    /** Hash of the full contract, taken before any redaction. */
    content_hash: DigestSchema,
    /** Paths cleared by the shareable projection; empty for `local`. */
    redactions: z.array(z.string()),
  }),
  facts: z.record(z.string(), z.unknown()),
  source_control: z
    .strictObject({
      head_sha: z.string().nullable(),
      dirty: z.boolean().nullable(),
    })
    .nullable(),
  scan: z.strictObject({
    status: PartStatusSchema,
    freshness: ArtifactFreshnessSchema.nullable(),
    problems: z.array(z.string()),
    content_hash: DigestSchema.nullable(),
    observed_at: TimestampSchema.nullable(),
    artifact: ScanArtifactSchema.nullable(),
  }),
  report: z.strictObject({
    status: PartStatusSchema,
    freshness: ArtifactFreshnessSchema.nullable(),
    problems: z.array(z.string()),
    conformance_hash: DigestSchema.nullable(),
    evaluated_at: TimestampSchema.nullable(),
    artifact: ConformanceReportSchema.nullable(),
  }),
  sources: z.record(z.string(), z.string()).optional(),
  manifest: z.strictObject({
    files_included: z.array(z.string()),
    has_source: z.boolean(),
    sources_omitted: z.array(OmittedSourceSchema),
    rule_count: z.int(),
    workload_count: z.int(),
  }),
  integrity_hash: DigestSchema,
});

export type WebReviewEnvelope = z.infer<typeof WebReviewEnvelopeSchema>;

export type WebReviewEnvelopeContent = Omit<
  WebReviewEnvelope,
  "integrity_hash"
>;

export function computeBundleIntegrityHash(
  content: WebReviewEnvelopeContent,
): string {
  return sha256(stableStringify(content));
}

const REDACTED = "redacted";

/**
 * Clear the contract fields that identify people or describe this machine.
 * Every replacement keeps the contract schema-valid; the returned paths list
 * only fields that actually held a value.
 */
export function redactContractForSharing(contract: ProjectContract): {
  readonly contract: ProjectContract;
  readonly redactions: readonly string[];
} {
  const redactions: string[] = [];
  const copy = structuredClone(contract);

  if (copy.project.owners.length > 0) {
    copy.project.owners = [];
    redactions.push("project.owners");
  }
  if (copy.project.repository_roots.length > 0) {
    copy.project.repository_roots = [];
    redactions.push("project.repository_roots");
  }
  if (copy.repository_bindings.length > 0) {
    copy.repository_bindings = [];
    redactions.push("repository_bindings");
  }
  copy.approvals.forEach((approval, index) => {
    approval.actor = { ...approval.actor, ref: REDACTED };
    redactions.push(`approvals[${index}].actor.ref`);
    if (approval.note !== null) {
      approval.note = null;
      redactions.push(`approvals[${index}].note`);
    }
  });
  copy.constraints.forEach((constraint, index) => {
    constraint.exceptions.forEach((exception, exceptionIndex) => {
      exception.approved_by = REDACTED;
      redactions.push(
        `constraints[${index}].exceptions[${exceptionIndex}].approved_by`,
      );
    });
  });
  copy.evidence_refs.forEach((evidence, index) => {
    if (evidence.source.locator !== null) {
      evidence.source.locator = null;
      redactions.push(`evidence_refs[${index}].source.locator`);
    }
  });
  copy.integrations.forEach((integration, index) => {
    if ("credential_ref" in integration && integration.credential_ref) {
      integration.credential_ref = null;
      redactions.push(`integrations[${index}].credential_ref`);
    }
    if ("data_directory" in integration && integration.data_directory) {
      integration.data_directory = null;
      redactions.push(`integrations[${index}].data_directory`);
    }
  });

  return { contract: copy, redactions };
}

export interface BundlePartInput<T> {
  /** The stored artifact, or null when it is not included. */
  readonly artifact: T | null;
  /** Required with an artifact: whether it matched the project at export. */
  readonly freshness?: ArtifactFreshness;
  /** `error` when the stored artifact could not be read or was tampered with. */
  readonly status?: "missing" | "error";
  /** Why the artifact is stale, missing or unreadable. */
  readonly problems?: readonly string[];
}

export interface AssembleBundleOptions {
  readonly contract: ProjectContract;
  readonly stateRevision?: number | null | undefined;
  readonly scan?: BundlePartInput<ScanArtifact> | undefined;
  readonly report?: BundlePartInput<ConformanceReport> | undefined;
  readonly sources?: Record<string, string> | undefined;
  readonly sourcesOmitted?: readonly OmittedSource[] | undefined;
  readonly projection?: ReviewBundleProjection | undefined;
  readonly sourceControl?:
    | { readonly head_sha: string | null; readonly dirty: boolean | null }
    | null
    | undefined;
  readonly generator?: string | undefined;
  readonly exportedAt?: string | undefined;
}

function part<T>(input: BundlePartInput<T> | undefined) {
  const artifact = input?.artifact ?? null;
  return {
    artifact,
    status: artifact ? ("available" as const) : (input?.status ?? "missing"),
    freshness: artifact ? (input?.freshness ?? "current") : null,
    problems: [...(input?.problems ?? [])],
  };
}

export function assembleWebReviewBundle(
  options: AssembleBundleOptions,
): WebReviewEnvelope {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const projection = options.projection ?? "local";
  const cHash = contractHash(options.contract);
  const shared =
    projection === "shareable"
      ? redactContractForSharing(options.contract)
      : { contract: options.contract, redactions: [] };

  const facts = buildProjectFacts(options.contract, {
    asOf: exportedAt,
    projection: "remote-default",
    stateRevision: options.stateRevision ?? null,
  }) as unknown as Record<string, unknown>;

  const scan = part(options.scan);
  const report = part(options.report);

  const manifestFiles: string[] = ["contract.yaml"];
  if (scan.artifact) manifestFiles.push("scan.json");
  if (report.artifact) manifestFiles.push("report.json");
  if (options.sources) {
    manifestFiles.push(
      ...Object.keys(options.sources).map((p) => `source/${p}`),
    );
  }

  const content: WebReviewEnvelopeContent = {
    format: WEB_REVIEW_BUNDLE_FORMAT,
    schema_version: WEB_REVIEW_BUNDLE_SCHEMA_VERSION,
    exported_at: exportedAt,
    generator: options.generator ?? "anvilmark-cli/export",
    projection,
    project: {
      id: options.contract.project.id,
      name: options.contract.project.name,
      contract_revision: options.contract.project.contract_revision,
      state_revision: options.stateRevision ?? null,
      contract_hash: cHash,
    },
    contract: {
      canonical: shared.contract,
      content_hash: cHash,
      redactions: [...shared.redactions],
    },
    facts,
    source_control: options.sourceControl ?? null,
    scan: {
      status: scan.status,
      freshness: scan.freshness,
      problems: scan.problems,
      content_hash: scan.artifact ? scan.artifact.content_hash : null,
      observed_at: scan.artifact ? scan.artifact.observation.observed_at : null,
      artifact: scan.artifact,
    },
    report: {
      status: report.status,
      freshness: report.freshness,
      problems: report.problems,
      conformance_hash: report.artifact
        ? report.artifact.conformance_hash
        : null,
      evaluated_at: report.artifact ? report.artifact.evaluated_at : null,
      artifact: report.artifact,
    },
    sources: options.sources,
    manifest: {
      files_included: manifestFiles,
      has_source: Boolean(
        options.sources && Object.keys(options.sources).length > 0,
      ),
      sources_omitted: [...(options.sourcesOmitted ?? [])],
      rule_count: options.contract.conformance_rules.length,
      workload_count: options.contract.workloads.length,
    },
  };

  const integrityHash = computeBundleIntegrityHash(content);
  return {
    ...content,
    integrity_hash: integrityHash,
  };
}

export type WebReviewBundleValidationResult =
  | { readonly status: "valid"; readonly bundle: WebReviewEnvelope }
  | { readonly status: "invalid"; readonly errors: readonly string[] };

export function readWebReviewBundle(
  raw: unknown,
): WebReviewBundleValidationResult {
  const parsed = WebReviewEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "invalid",
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    };
  }

  const bundle = parsed.data;
  const errors: string[] = [];

  // 1. Verify bundle integrity hash
  const { integrity_hash, ...content } = bundle;
  const expectedIntegrityHash = computeBundleIntegrityHash(content);
  if (integrity_hash !== expectedIntegrityHash) {
    errors.push(
      `Bundle integrity hash mismatch: expected ${expectedIntegrityHash}, got ${integrity_hash}`,
    );
  }

  // 2. Verify contract hash. A shareable contract is redacted, so its hash was
  //    taken before redaction and cannot be recomputed from the bundle.
  if (bundle.contract.content_hash !== bundle.project.contract_hash) {
    errors.push(
      `Project contract hash mismatch: project says ${bundle.project.contract_hash}, contract says ${bundle.contract.content_hash}`,
    );
  }
  if (bundle.projection === "local") {
    const expectedContractHash = contractHash(bundle.contract.canonical);
    if (bundle.contract.content_hash !== expectedContractHash) {
      errors.push(
        `Contract content hash mismatch: expected ${expectedContractHash}, got ${bundle.contract.content_hash}`,
      );
    }
    if (bundle.contract.redactions.length > 0) {
      errors.push("A local bundle must not list contract redactions");
    }
  }

  // 3. Each part: status, freshness and artifact must agree, and an artifact
  //    produced for a different contract must be marked stale.
  const checkPart = (
    name: "Scan" | "Report",
    status: string,
    freshness: ArtifactFreshness | null,
    artifact: {
      contract: { project_id: string; contract_hash: string };
    } | null,
  ) => {
    if (status !== "available") {
      if (artifact)
        errors.push(`${name} status is ${status} but an artifact is included`);
      if (freshness !== null)
        errors.push(`${name} status is ${status} but freshness is set`);
      return;
    }
    if (!artifact) {
      errors.push(`${name} status is available but artifact is null`);
      return;
    }
    if (freshness === null) {
      errors.push(`${name} status is available but freshness is not set`);
    }
    if (artifact.contract.project_id !== bundle.project.id) {
      errors.push(
        `${name} contract project ID mismatch: ${name.toLowerCase()} has ${artifact.contract.project_id}, project has ${bundle.project.id}`,
      );
    }
    if (
      artifact.contract.contract_hash !== bundle.project.contract_hash &&
      freshness !== "stale"
    ) {
      errors.push(
        `${name} was produced for contract ${artifact.contract.contract_hash}, not ${bundle.project.contract_hash}, but is not marked stale`,
      );
    }
  };

  checkPart(
    "Scan",
    bundle.scan.status,
    bundle.scan.freshness,
    bundle.scan.artifact,
  );
  if (
    bundle.scan.artifact &&
    bundle.scan.content_hash !== bundle.scan.artifact.content_hash
  ) {
    errors.push(
      `Scan content hash mismatch: expected ${bundle.scan.content_hash}, got ${bundle.scan.artifact.content_hash}`,
    );
  }

  checkPart(
    "Report",
    bundle.report.status,
    bundle.report.freshness,
    bundle.report.artifact,
  );
  if (bundle.report.artifact) {
    const expectedReportHash = reportConformanceHash(bundle.report.artifact);
    if (bundle.report.artifact.conformance_hash !== expectedReportHash) {
      errors.push(
        `Report internal conformance hash mismatch: expected ${expectedReportHash}, got ${bundle.report.artifact.conformance_hash}`,
      );
    }
    if (
      bundle.report.conformance_hash !== bundle.report.artifact.conformance_hash
    ) {
      errors.push(
        `Report conformance hash envelope mismatch: expected ${bundle.report.conformance_hash}, got ${bundle.report.artifact.conformance_hash}`,
      );
    }
  }

  // 4. Two current artifacts describe the same repository state, so the
  //    report must have been evaluated on the included scan.
  if (
    bundle.scan.artifact &&
    bundle.report.artifact &&
    bundle.scan.freshness === "current" &&
    bundle.report.freshness === "current" &&
    bundle.report.artifact.scan.content_hash !==
      bundle.scan.artifact.content_hash
  ) {
    errors.push(
      "Scan and report are both marked current but the report was evaluated on a different scan",
    );
  }

  if (errors.length > 0) {
    return { status: "invalid", errors };
  }

  return { status: "valid", bundle };
}
