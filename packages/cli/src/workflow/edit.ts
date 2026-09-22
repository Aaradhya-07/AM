import { LOCAL_DISCLOSED_FIELDS } from "@anvilmark/adapters";
import type {
  Candidate,
  Constraint,
  ConstraintDomain,
  Hardware,
  ProjectContract,
  Workload,
} from "@anvilmark/project-contract";
import {
  ConstraintDomainSchema,
  ID_PATTERN,
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  RATIFIED_DEFAULT_DENY,
  validateProjectContract,
} from "@anvilmark/project-contract";

/** A user-facing refusal. The message says what to do instead. */
export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export function clone(contract: ProjectContract): ProjectContract {
  return structuredClone(contract);
}

/** A stable id from free text, or null when nothing usable remains. */
export function slugId(text: string): string | null {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug.length > 0 && ID_PATTERN.test(slug) ? slug : null;
}

export function snakeId(text: string): string | null {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
    .replace(/_+$/g, "");
  return /^[a-z0-9][a-z0-9_]*$/.test(slug) ? slug : null;
}

export function requireId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new WorkflowError(
      `${label} "${value}" is not a valid id: start with a letter or digit and use only letters, digits, '.', '_' or '-'`,
    );
  }
  return value;
}

export type RemoteIntelligencePosture = "public_projection" | "nothing";

export interface NewProjectInput {
  readonly id: string;
  readonly name: string;
  readonly idea: string;
  readonly repositoryRoots: readonly string[];
  readonly intelligence: string;
  readonly remoteIntelligence: RemoteIntelligencePosture;
  readonly now: string;
}

/**
 * The smallest valid draft for an informal idea.
 *
 * Only what the user actually said is recorded. Users, outcomes, workloads,
 * constraints, hardware and budgets start EMPTY -- not guessed -- and the
 * status view lists them as not yet provided.
 */
export function newProjectContract(input: NewProjectInput): ProjectContract {
  const document = {
    schema: PROJECT_SCHEMA_ID,
    schema_version: PROJECT_SCHEMA_VERSION,
    project: {
      id: requireId(input.id, "project id"),
      name: input.name,
      created_at: input.now,
      updated_at: input.now,
      contract_revision: 1,
      state: "draft",
      repository_roots: [...input.repositoryRoots],
      owners: [],
      priority_order: [],
    },
    intent: {
      summary: input.idea,
      users: [],
      outcomes: [],
      non_goals: [],
      unresolved_questions: [],
    },
    architecture: { authority: "anvilmark" },
    integrations: [
      {
        id: "intelligence.selected",
        kind: "intelligence",
        adapter: input.intelligence,
        credential_ref: null,
        default_data_projection: "public_decision_layer",
        additional_data_requires_consent: [],
      },
    ],
    remote_intelligence_policy: {
      default_allow:
        input.remoteIntelligence === "nothing"
          ? []
          : [...LOCAL_DISCLOSED_FIELDS],
      default_deny: [...RATIFIED_DEFAULT_DENY],
      show_payload_before_remote_send: true,
      scan_outbound_payload_for_secrets: true,
    },
  };
  const validated = validateProjectContract(document);
  if (!validated.ok) {
    throw new WorkflowError(
      `the initial draft is invalid: ${validated.issues.map((entry) => `${entry.path}: ${entry.message}`).join("; ")}`,
    );
  }
  return validated.value;
}

function touch(contract: ProjectContract, now: string): ProjectContract {
  contract.project.updated_at = now;
  return contract;
}

// --- intelligence selection ------------------------------------------------

export function selectedIntelligence(contract: ProjectContract): string {
  const integration = contract.integrations.find(
    (entry) => entry.kind === "intelligence",
  );
  return integration?.adapter ?? "none";
}

export function selectIntelligence(
  contract: ProjectContract,
  mechanism: string,
  now: string,
): ProjectContract {
  const next = clone(contract);
  const integration = next.integrations.find(
    (entry) => entry.kind === "intelligence",
  );
  if (integration === undefined) {
    next.integrations.push({
      id: "intelligence.selected",
      kind: "intelligence",
      adapter: mechanism,
      credential_ref: null,
      default_data_projection: "public_decision_layer",
      additional_data_requires_consent: [],
    });
  } else {
    integration.adapter = mechanism;
  }
  return touch(next, now);
}

// --- intent ----------------------------------------------------------------

export function setSummary(
  contract: ProjectContract,
  summary: string,
  now: string,
): ProjectContract {
  const next = clone(contract);
  next.intent.summary = nonEmpty(summary, "summary");
  return touch(next, now);
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new WorkflowError(`${label} must not be empty`);
  }
  return trimmed;
}

function appendUnique(list: string[], value: string): boolean {
  if (list.includes(value)) {
    return false;
  }
  list.push(value);
  return true;
}

export function addIntentEntry(
  contract: ProjectContract,
  field: "users" | "non_goals" | "unresolved_questions",
  value: string,
  now: string,
): ProjectContract {
  const next = clone(contract);
  if (!appendUnique(next.intent[field], nonEmpty(value, field))) {
    throw new WorkflowError(`"${value}" is already recorded in ${field}`);
  }
  return touch(next, now);
}

export function addOutcome(
  contract: ProjectContract,
  input: {
    readonly id: string;
    readonly measure: string;
    readonly target: string;
  },
  now: string,
): ProjectContract {
  const next = clone(contract);
  requireId(input.id, "outcome id");
  if (next.intent.outcomes.some((entry) => entry.id === input.id)) {
    throw new WorkflowError(`outcome "${input.id}" already exists`);
  }
  next.intent.outcomes.push({
    id: input.id,
    measure: nonEmpty(input.measure, "measure"),
    target: nonEmpty(input.target, "target"),
  });
  return touch(next, now);
}

/**
 * Remove an answered question. The answer itself must be recorded as
 * structured data by the command that captures it; the question text is kept
 * in the history entry for this state.
 */
export function resolveQuestion(
  contract: ProjectContract,
  selector: string,
  now: string,
): { readonly contract: ProjectContract; readonly question: string } {
  const next = clone(contract);
  const list = next.intent.unresolved_questions;
  const index = /^\d+$/.test(selector)
    ? Number(selector) - 1
    : list.indexOf(selector);
  const question = list[index];
  if (index < 0 || question === undefined) {
    throw new WorkflowError(
      `no unresolved question matches "${selector}"; use its number from "anvilmark status"`,
    );
  }
  list.splice(index, 1);
  return { contract: touch(next, now), question };
}

// --- priority --------------------------------------------------------------

export function setPriorityOrder(
  contract: ProjectContract,
  domains: readonly string[],
  now: string,
): ProjectContract {
  const parsed: ConstraintDomain[] = [];
  for (const domain of domains) {
    const result = ConstraintDomainSchema.safeParse(domain);
    if (!result.success) {
      throw new WorkflowError(
        `"${domain}" is not a constraint domain; use ${ConstraintDomainSchema.options.join(", ")}`,
      );
    }
    if (parsed.includes(result.data)) {
      throw new WorkflowError(
        `"${domain}" appears twice in the priority order`,
      );
    }
    parsed.push(result.data);
  }
  const next = clone(contract);
  next.project.priority_order = parsed;
  return touch(next, now);
}

// --- workloads -------------------------------------------------------------

export function addWorkload(
  contract: ProjectContract,
  workload: Workload,
  now: string,
): ProjectContract {
  const next = clone(contract);
  if (next.workloads.some((entry) => entry.id === workload.id)) {
    throw new WorkflowError(`workload "${workload.id}" already exists`);
  }
  next.workloads.push(workload);
  return touch(next, now);
}

/** Change one existing workload. Validation happens when the change is committed. */
export function updateWorkload(
  contract: ProjectContract,
  id: string,
  change: (workload: Workload) => void,
  now: string,
): ProjectContract {
  const next = clone(contract);
  const workload = next.workloads.find((entry) => entry.id === id);
  if (workload === undefined) {
    throw new WorkflowError(`workload "${id}" does not exist`);
  }
  change(workload);
  return touch(next, now);
}

/**
 * Record a burst assumption.
 *
 * `expected_usage` has no burst field (through schema 0.1.0-draft.4), so a burst is
 * recorded as an INFORMATIONAL throughput constraint: recorded, never scored,
 * and visibly a user statement rather than a measurement.
 */
export function addBurstAssumption(
  contract: ProjectContract,
  input: {
    readonly workload: string;
    readonly peakCallsPerMinute: number;
    readonly note: string | null;
  },
  now: string,
): ProjectContract {
  if (!contract.workloads.some((entry) => entry.id === input.workload)) {
    throw new WorkflowError(`workload "${input.workload}" does not exist`);
  }
  if (
    !Number.isFinite(input.peakCallsPerMinute) ||
    input.peakCallsPerMinute <= 0
  ) {
    throw new WorkflowError("peak calls per minute must be a positive number");
  }
  return addConstraint(
    contract,
    {
      id: `throughput.${input.workload}.burst`,
      domain: "throughput",
      severity: "informational",
      subject: `workload.${input.workload}.peak_calls_per_minute`,
      operator: "gte",
      value: input.peakCallsPerMinute,
      source: "user",
      rationale:
        input.note ??
        "Burst assumption declared by the user; recorded for comparison, not scored.",
      condition: "burst",
      exceptions: [],
    },
    now,
  );
}

// --- constraints -----------------------------------------------------------

export function addConstraint(
  contract: ProjectContract,
  constraint: Constraint,
  now: string,
): ProjectContract {
  const next = clone(contract);
  if (next.constraints.some((entry) => entry.id === constraint.id)) {
    throw new WorkflowError(
      `constraint "${constraint.id}" already exists; remove it first to replace it`,
    );
  }
  next.constraints.push(constraint);
  return touch(next, now);
}

export function removeConstraint(
  contract: ProjectContract,
  id: string,
  now: string,
): { readonly contract: ProjectContract; readonly removed: Constraint } {
  const next = clone(contract);
  const index = next.constraints.findIndex((entry) => entry.id === id);
  const removed = next.constraints[index];
  if (index < 0 || removed === undefined) {
    throw new WorkflowError(`constraint "${id}" does not exist`);
  }
  next.constraints.splice(index, 1);
  return { contract: touch(next, now), removed };
}

// --- resources -------------------------------------------------------------

export function addHardware(
  contract: ProjectContract,
  hardware: Hardware,
  now: string,
): ProjectContract {
  const next = clone(contract);
  if (next.resources.hardware.some((entry) => entry.id === hardware.id)) {
    throw new WorkflowError(`hardware "${hardware.id}" already exists`);
  }
  next.resources.hardware.push(hardware);
  return touch(next, now);
}

export function addBudget(
  contract: ProjectContract,
  budget: ProjectContract["resources"]["budgets"][number],
  now: string,
): ProjectContract {
  const next = clone(contract);
  next.resources.budgets.push(budget);
  return touch(next, now);
}

// --- candidates ------------------------------------------------------------

export function addCandidate(
  contract: ProjectContract,
  candidate: Candidate,
  now: string,
): ProjectContract {
  const next = clone(contract);
  if (next.candidates.some((entry) => entry.id === candidate.id)) {
    throw new WorkflowError(`candidate "${candidate.id}" already exists`);
  }
  next.candidates.push(candidate);
  return touch(next, now);
}

function candidateIn(contract: ProjectContract, id: string): Candidate {
  const candidate = contract.candidates.find((entry) => entry.id === id);
  if (candidate === undefined) {
    throw new WorkflowError(`candidate "${id}" does not exist`);
  }
  return candidate;
}

export function addCandidateAssumption(
  contract: ProjectContract,
  id: string,
  assumption: string,
  now: string,
): ProjectContract {
  const next = clone(contract);
  const candidate = candidateIn(next, id);
  if (
    !appendUnique(
      candidate.estimates.assumptions,
      nonEmpty(assumption, "assumption"),
    )
  ) {
    throw new WorkflowError("that assumption is already recorded");
  }
  return touch(next, now);
}

export function setCandidateDeployment(
  contract: ProjectContract,
  id: string,
  change: {
    readonly runtime?: string | null;
    readonly hardwareRef?: string | null;
    readonly provider?: string | null;
    readonly region?: string | null;
  },
  now: string,
): ProjectContract {
  const next = clone(contract);
  const candidate = candidateIn(next, id);
  const deployment = candidate.deployment;
  if (deployment.mode === "local") {
    if (change.provider !== undefined || change.region !== undefined) {
      throw new WorkflowError(
        "a local deployment has a runtime and hardware, not a provider or region",
      );
    }
    if (change.runtime !== undefined) deployment.runtime = change.runtime;
    if (change.hardwareRef !== undefined)
      deployment.hardware_ref = change.hardwareRef;
  } else {
    if (change.hardwareRef !== undefined) {
      throw new WorkflowError(
        `a ${deployment.mode} deployment has no hardware reference`,
      );
    }
    if (change.provider !== undefined) deployment.provider = change.provider;
    if (change.region !== undefined) deployment.region = change.region;
    if (change.runtime !== undefined) {
      if (deployment.mode !== "self_hosted") {
        throw new WorkflowError("a managed API deployment has no runtime");
      }
      deployment.runtime = change.runtime;
    }
  }
  return touch(next, now);
}

/**
 * Change a candidate's model identity.
 *
 * The identity is the family and the version together. A pinning claim is a
 * statement about one exact identity, so it never carries over to a different
 * one: if the family or the version changes and a version remains, the
 * mutability must be stated again. A model without a version is always
 * floating. Re-stating the same family and version, or changing only the
 * quantization, keeps the existing claim.
 *
 * A licence evidence reference is a claim about one model family, so it is
 * cleared when the family changes.
 */
export function setCandidateModel(
  contract: ProjectContract,
  id: string,
  change: {
    readonly family?: string;
    readonly version?: string;
    readonly mutability?: "pinned" | "floating";
    readonly quantization?: string;
  },
  now: string,
): { readonly contract: ProjectContract; readonly notices: readonly string[] } {
  const next = clone(contract);
  const candidate = candidateIn(next, id);
  const current = candidate.model;
  const family = change.family ?? current?.family;
  if (family === undefined) {
    throw new WorkflowError(
      `candidate "${id}" has no model yet; give --model FAMILY`,
    );
  }
  const version = change.version ?? current?.version ?? null;
  const familyChanged = current === null || family !== current.family;
  const versionChanged = current === null || version !== current.version;
  const identityChanged = familyChanged || versionChanged;
  if (identityChanged && version !== null && change.mutability === undefined) {
    const what = familyChanged
      ? `the model family changes to "${family}"${current === null ? "" : ` from "${current.family}"`}`
      : `the model version changes to "${version}"`;
    throw new WorkflowError(
      `${what}, so --model-mutability pinned|floating must be stated again for ${family}@${version}; a pinning claim about one model identity does not carry over to another`,
    );
  }
  const mutability = identityChanged
    ? (change.mutability ?? "floating")
    : (change.mutability ?? current?.version_mutability ?? "floating");
  if (version === null && mutability === "pinned") {
    throw new WorkflowError(
      "a model without an exact version cannot be pinned; give --model-version",
    );
  }
  const notices: string[] = [];
  const licence =
    familyChanged && current !== null
      ? null
      : (current?.license_evidence_ref ?? null);
  if (familyChanged && current?.license_evidence_ref != null) {
    notices.push(
      `licence evidence "${current.license_evidence_ref}" described "${current.family}", not "${family}", so it was cleared from the candidate`,
    );
  }
  candidate.model = {
    family,
    version,
    version_mutability: mutability,
    quantization: change.quantization ?? current?.quantization ?? null,
    license_evidence_ref: licence,
  };
  return { contract: touch(next, now), notices };
}

/** Statuses a user may set directly. `viable` has its own evidence check. */
export const DIRECT_CANDIDATE_STATUSES = [
  "discovered",
  "unevaluated",
  "incompatible",
  "rejected",
  "unavailable",
] as const;

export function setCandidateStatus(
  contract: ProjectContract,
  id: string,
  status: Candidate["status"],
  now: string,
): ProjectContract {
  const next = clone(contract);
  candidateIn(next, id).status = status;
  return touch(next, now);
}

export function recordConstraintResult(
  contract: ProjectContract,
  id: string,
  result: Candidate["constraint_results"][number],
  now: string,
): ProjectContract {
  const next = clone(contract);
  const candidate = candidateIn(next, id);
  if (!next.constraints.some((entry) => entry.id === result.constraint_ref)) {
    throw new WorkflowError(
      `constraint "${result.constraint_ref}" does not exist`,
    );
  }
  const existing = candidate.constraint_results.findIndex(
    (entry) => entry.constraint_ref === result.constraint_ref,
  );
  if (existing >= 0) {
    candidate.constraint_results.splice(existing, 1, result);
  } else {
    candidate.constraint_results.push(result);
  }
  return touch(next, now);
}
