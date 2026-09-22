import type {
  ContractIssue,
  ContractResult,
  EvidenceRecord,
  EvidenceTier,
  ProjectContract,
} from "@anvilmark/project-contract";
import {
  EvidenceRecordSchema,
  fail,
  findSecrets,
  issue,
  ok,
  sortIssues,
  tierForEvidenceKind,
  validateProjectContract,
} from "@anvilmark/project-contract";

import type { AdapterError } from "../envelope.js";
import { adapterError } from "../envelope.js";
import { sanitizeStructured, sanitizeText } from "../sanitize.js";
import type { EvidenceProposal } from "./proposal.js";
import { EvidenceProposalSchema } from "./proposal.js";

/** A proposal that has been accepted into contract-valid form. */
export interface BuiltEvidence {
  readonly record: EvidenceRecord;
  /** Derived from `kind`, never supplied by the adapter. */
  readonly tier: EvidenceTier;
  /** Adapter-side detail the authoritative contract deliberately does not hold. */
  readonly annotations: {
    readonly claim: string;
    readonly units: Readonly<Record<string, string>>;
    readonly assumptions: readonly string[];
    readonly exclusions: readonly string[];
    readonly command_manifest: EvidenceProposal["command_manifest"];
    readonly raw_result_hash: string | null;
  };
}

export interface BuildFailure {
  readonly errors: readonly AdapterError[];
  readonly issues: readonly ContractIssue[];
}

export type BuildResult =
  | { readonly ok: true; readonly value: BuiltEvidence }
  | ({ readonly ok: false } & BuildFailure);

/**
 * Turn an adapter proposal into a contract-valid evidence record.
 *
 * Subprocess and model output is untrusted input. Everything an adapter offers
 * passes three gates before it is allowed near the contract:
 *
 *   1. the proposal shape, including non-empty constraint attribution;
 *   2. secret scanning, because a tool can print a credential into any field;
 *   3. the contract's own `EvidenceRecordSchema`, which enforces the
 *      kind-specific payload the evidence pipeline later relies on.
 *
 * The tier is computed here from the kind. There is no path by which an
 * adapter can assert its own tier.
 */
export function buildEvidenceRecord(proposal: unknown): BuildResult {
  const parsed = EvidenceProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    const missingAttribution = parsed.error.issues.some((entry) =>
      entry.path.join(".").startsWith("applies_to.constraint_refs"),
    );
    return {
      ok: false,
      errors: [
        adapterError(
          missingAttribution ? "attribution_missing" : "schema_rejected",
          missingAttribution
            ? "an evidence proposal must name at least one constraint it supports"
            : "the evidence proposal did not match the adapter protocol",
          { issues: parsed.error.issues.length },
        ),
      ],
      issues: parsed.error.issues.map((entry) =>
        issue(
          "schema_violation",
          entry.path.join(".") || "<proposal>",
          sanitizeText(entry.message).text,
        ),
      ),
    };
  }

  const candidate = parsed.data;

  if (candidate.standing !== "available") {
    return {
      ok: false,
      errors: [
        adapterError(
          "schema_rejected",
          `an adapter result with standing "${candidate.standing}" is an evidence gap, not evidence`,
          { standing: candidate.standing },
        ),
      ],
      issues: [],
    };
  }

  // Secrets are checked BEFORE the record is assembled, so a credential can
  // never reach a persisted artifact even transiently.
  const secrets = findSecrets(candidate);
  if (secrets.length > 0) {
    return {
      ok: false,
      errors: [
        adapterError(
          "secret_detected",
          "the adapter result contains a credential value and was discarded",
          { paths: secrets.map((entry) => entry.path) },
        ),
      ],
      issues: secrets.map((entry) =>
        issue("secret_value_detected", entry.path, entry.explanation),
      ),
    };
  }

  const record = {
    id: candidate.id,
    kind: candidate.kind,
    subject: candidate.subject,
    producer: candidate.producer,
    observed_at: candidate.observed_at,
    source: candidate.source,
    confidence: candidate.confidence,
    caveats: candidate.caveats,
    refresh: candidate.refresh,
    applies_to: candidate.applies_to,
    value: sanitizeStructured(candidate.value),
  };

  const validated = EvidenceRecordSchema.safeParse(record);
  if (!validated.success) {
    return {
      ok: false,
      errors: [
        adapterError(
          "schema_rejected",
          `the ${candidate.kind} payload does not satisfy the contract's requirements for that evidence kind`,
          { kind: candidate.kind },
        ),
      ],
      issues: validated.error.issues.map((entry) =>
        issue(
          "schema_violation",
          `evidence.${entry.path.join(".")}`,
          sanitizeText(entry.message).text,
        ),
      ),
    };
  }

  return {
    ok: true,
    value: {
      record: validated.data,
      tier: tierForEvidenceKind(validated.data.kind),
      annotations: {
        claim: candidate.claim,
        units: candidate.units,
        assumptions: candidate.assumptions,
        exclusions: candidate.exclusions,
        command_manifest: candidate.command_manifest,
        raw_result_hash: candidate.raw_result_hash,
      },
    },
  };
}

/**
 * Append evidence to a contract, or return the reasons it cannot be appended.
 *
 * The merged contract is re-validated in full. If anything about it is
 * invalid — a dangling reference, an unresolvable approval, a secret — the
 * ORIGINAL contract is returned untouched and the caller receives issues. A
 * failing adapter can therefore never leave the project in a half-written
 * state, which is the whole reason adapters hand back data instead of writing.
 */
export function attachEvidence(
  contract: ProjectContract,
  records: readonly EvidenceRecord[],
): ContractResult<ProjectContract> {
  if (records.length === 0) {
    return ok(contract);
  }

  const existing = new Set(contract.evidence_refs.map((entry) => entry.id));
  const collisions = records.filter((entry) => existing.has(entry.id));
  if (collisions.length > 0) {
    return fail(
      collisions.map((entry) =>
        issue(
          "duplicate_id",
          `evidence_refs`,
          `evidence "${entry.id}" already exists; evidence is append-only and ids are never reused`,
          { id: entry.id },
        ),
      ),
    );
  }

  const merged = {
    ...contract,
    evidence_refs: [...contract.evidence_refs, ...records],
  };

  const validated = validateProjectContract(merged);
  if (!validated.ok) {
    return fail(sortIssues(validated.issues));
  }
  return ok(validated.value);
}
