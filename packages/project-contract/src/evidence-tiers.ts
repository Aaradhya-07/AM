import type { ProjectContract } from "./schema/contract.js";
import { hardwareSizingEvidenceProblem } from "./hardware-sizing-evidence.js";
import type { Constraint } from "./schema/constraints.js";
import type { Hardware } from "./schema/resources.js";
import type {
  EvidenceFloorSubject,
  EvidenceKind,
  EvidencePolicy,
  EvidenceRecord,
  EvidenceTier,
} from "./schema/evidence.js";
import type { Outcome } from "./schema/primitives.js";

/** Total ordering of evidence tiers, weakest first. */
export const TIER_ORDER: readonly EvidenceTier[] = ["T0", "T1", "T2", "T3"];

const TIER_RANK: Readonly<Record<EvidenceTier, number>> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
};

export function tierRank(tier: EvidenceTier): number {
  return TIER_RANK[tier];
}

/** True when `tier` is at least as strong as `floor`. */
export function tierMeets(tier: EvidenceTier, floor: EvidenceTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[floor];
}

/**
 * The tier of a piece of evidence is DERIVED from its kind, never declared.
 * This is what stops a vendor claim or an agent inference from being labelled
 * a measurement in order to clear a hard gate.
 *
 * Ratified in doc 06 section 6.
 */
const KIND_TIER: Readonly<Record<EvidenceKind, EvidenceTier>> = {
  // T3 — directly observed or measured.
  deterministic_observation: "T3",
  measured_evaluation: "T3",
  runtime_measurement: "T3",
  source_code: "T3",
  // T2 — attributable authoritative evidence.
  official_documentation: "T2",
  official_pricing: "T2",
  tool_observation: "T2",
  // T1 — declared or claimed.
  user_declared: "T1",
  vendor_claim: "T1",
  // T0 — inference or absence.
  agent_inference: "T0",
  unknown: "T0",
};

export function tierForEvidenceKind(kind: EvidenceKind): EvidenceTier {
  return KIND_TIER[kind];
}

export function tierForEvidence(record: EvidenceRecord): EvidenceTier {
  return tierForEvidenceKind(record.kind);
}

/**
 * The ratified per-subject evidence floors, taken verbatim from the amended
 * table in doc 06 section 6.
 *
 * The separation matters: a projected cost comparison may proceed on T2
 * official pricing plus T1 usage assumptions, while a HARD realized-cost gate
 * demands T3 billing measurement. Collapsing the two would let an estimate be
 * presented as a measurement.
 */
export const RATIFIED_EVIDENCE_FLOORS: Readonly<
  Record<EvidenceFloorSubject, EvidenceTier>
> = {
  workload_quality_hard_gate: "T3",
  privacy_data_flow_hard_gate: "T3",
  latency_throughput_hard_gate: "T3",
  token_hard_gate: "T3",
  projected_cost_comparison: "T2",
  realized_cost_hard_gate: "T3",
  license: "T2",
  residency_provider_capability: "T2",
  target_hardware_inventory: "T1",
  hardware_compatibility_estimate: "T2",
  hardware_performance_gate: "T3",
  budget_amount: "T1",
  availability_portability_structure: "T3",
  repository_policy: "T3",
};

/**
 * Which evidence KINDS can speak to each subject.
 *
 * The tier ladder answers "how strong is this evidence"; it does not answer
 * "is this evidence about the right thing". Decision 06 section 6 states a
 * requirement per subject, not a universal rule that any T3 record satisfies
 * any T3 floor. Reading source code is a T3 observation, but it is not a
 * measured evaluation of a workload's quality, and a runtime latency trace is
 * not a deterministic observation of where data flows.
 *
 * Two entries are deliberately narrow rather than tier-driven:
 *
 *   - `target_hardware_inventory` admits only `user_declared`, because the
 *     user's declaration is authoritative for what they own or plan. A
 *     detected machine must never overwrite a declared target.
 *   - `budget_amount` admits only `user_declared` for the same reason.
 *
 * `privacy_data_flow_hard_gate` admits deterministic and source observation.
 * Decision 06 says runtime "may add confirmation": it can corroborate a
 * finding, but it cannot establish the gate on its own, so it is not listed.
 */
export const ADMISSIBLE_EVIDENCE_KINDS: Readonly<
  Record<EvidenceFloorSubject, readonly EvidenceKind[]>
> = {
  workload_quality_hard_gate: ["measured_evaluation"],
  privacy_data_flow_hard_gate: ["deterministic_observation", "source_code"],
  latency_throughput_hard_gate: ["measured_evaluation", "runtime_measurement"],
  token_hard_gate: [
    "deterministic_observation",
    "measured_evaluation",
    "runtime_measurement",
  ],
  projected_cost_comparison: ["official_pricing"],
  realized_cost_hard_gate: ["runtime_measurement"],
  license: ["official_documentation", "source_code"],
  residency_provider_capability: [
    "official_documentation",
    "deterministic_observation",
  ],
  target_hardware_inventory: ["user_declared"],
  hardware_compatibility_estimate: [
    "tool_observation",
    "measured_evaluation",
    "runtime_measurement",
  ],
  hardware_performance_gate: ["measured_evaluation", "runtime_measurement"],
  budget_amount: ["user_declared"],
  availability_portability_structure: ["deterministic_observation"],
  repository_policy: ["deterministic_observation", "source_code"],
};

/**
 * Subjects whose evidence must describe one specific candidate. A measurement
 * of a different candidate is not weaker evidence, it is evidence about
 * something else.
 */
const CANDIDATE_SCOPED_SUBJECTS: ReadonlySet<EvidenceFloorSubject> = new Set([
  "workload_quality_hard_gate",
  "latency_throughput_hard_gate",
  "token_hard_gate",
  "realized_cost_hard_gate",
  "projected_cost_comparison",
  "hardware_compatibility_estimate",
  "hardware_performance_gate",
  "license",
]);

/**
 * What the evidence is being asked to speak about.
 *
 * Every field is optional in the TYPE but required in EFFECT for the subjects
 * that need it. A missing field is treated as insufficient evidence, never as
 * permission to skip a check: relaxing a gate because the caller forgot to say
 * which candidate it was asking about is exactly the failure this contract
 * exists to prevent.
 *
 * The parameter itself is mandatory on `assessEvidence` and
 * `evaluateConstraint` so that a Milestone 2 adapter cannot reach a `pass` by
 * simply omitting it.
 */
export interface EvidenceContext {
  readonly projectContract?: ProjectContract;
  /** The candidate whose result is being evaluated. */
  readonly candidateRef?: string | null;
  /** The workload that candidate serves. */
  readonly workloadRef?: string | null;
  /** Ids of hardware entries the user DECLARED, as opposed to detected ones. */
  readonly declaredTargetHardwareRefs?: readonly string[];
  /**
   * Resolves a hardware id to its entry. Required for hardware subjects,
   * because whether an observation describes the target depends on what the
   * two machines actually are, not on their ids.
   */
  readonly resolveHardware?: (id: string) => Hardware | undefined;
  /** The hardware this candidate actually deploys to. */
  readonly deploymentHardwareRef?: string | null;
  /**
   * True only when the citing candidate records BOTH a projected monthly cost
   * and the arithmetic behind it. Must be explicitly `true`.
   */
  readonly hasExplicitCostCalculation?: boolean;
  /**
   * True only when the workload's `expected_usage.basis` is declared or
   * stronger, and any assumption the calculation rests on is written down.
   * Must be explicitly `true`.
   */
  readonly hasDeclaredUsageInputs?: boolean;
  /**
   * The evaluation identity the current candidate configuration expects.
   *
   * REQUIRED for a `measured_evaluation` to be admitted. Without it the
   * contract can check that a result is internally complete but not that it
   * describes THIS candidate as configured now, so a measurement of a
   * superseded prompt or a different provider would still look like valid T3
   * evidence. Absence fails closed.
   */
  readonly expectedEvaluation?: {
    readonly provider_id: string;
    readonly configuration_hash: string;
  } | null;
}

/**
 * Subjects whose evidence must describe one specific workload. A quality or
 * latency figure is meaningless without knowing which workload produced it.
 */
const WORKLOAD_SCOPED_SUBJECTS: ReadonlySet<EvidenceFloorSubject> = new Set([
  "workload_quality_hard_gate",
  "latency_throughput_hard_gate",
  "token_hard_gate",
]);

/** Subjects that can only be settled against the candidate's real hardware. */
const HARDWARE_SCOPED_SUBJECTS: ReadonlySet<EvidenceFloorSubject> = new Set([
  "hardware_compatibility_estimate",
  "hardware_performance_gate",
]);

export interface AdmissionVerdict {
  readonly admitted: boolean;
  readonly reason: string;
}

const ADMITTED: AdmissionVerdict = { admitted: true, reason: "" };

/**
 * Decide whether one evidence record may speak to one constraint.
 *
 * This runs BEFORE the tier comparison. Inadmissible evidence is excluded
 * entirely rather than counted at a lower tier, because its tier is
 * irrelevant: it is not about the thing being gated.
 *
 * The constraint id is taken from `constraint.id` rather than from the
 * context, so a caller cannot accidentally assess evidence against one
 * constraint while claiming another.
 */
export function admitEvidence(
  record: EvidenceRecord,
  constraint: Constraint,
  context: EvidenceContext,
): AdmissionVerdict {
  // Defensive: a JavaScript caller can still omit the argument. An absent
  // context is an EMPTY context, which fails closed below, never a bypass.
  const supplied: EvidenceContext = context ?? {};

  const reject = (reason: string): AdmissionVerdict => ({
    admitted: false,
    reason,
  });

  // Defensive: a hand-built record may omit the field entirely. Absent
  // attribution is empty attribution, which is excluded below, not a bypass.
  const appliesToConstraints = record.applies_to?.constraint_refs ?? [];

  // Which CLAIM does this artifact support? Kind and subject cannot answer
  // that, so the record must say so explicitly. This is what stops evidence
  // gathered for one constraint from being reused for another in the same
  // domain.
  if (!appliesToConstraints.includes(constraint.id)) {
    return reject(
      appliesToConstraints.length === 0
        ? `this evidence is not attributed to any constraint, so it cannot support "${constraint.id}"`
        : `this evidence supports ${appliesToConstraints.map((entry) => `"${entry}"`).join(", ")}, not "${constraint.id}"`,
    );
  }

  const sizingProblem = hardwareSizingEvidenceProblem(
    record,
    supplied.projectContract,
  );
  if (sizingProblem !== null) return reject(sizingProblem);

  const floorSubject = floorSubjectForConstraint(constraint);
  if (floorSubject === null) {
    return ADMITTED;
  }

  const admissibleKinds = ADMISSIBLE_EVIDENCE_KINDS[floorSubject];
  if (!admissibleKinds.includes(record.kind)) {
    return reject(
      `evidence of kind "${record.kind}" cannot establish ${floorSubject}; that subject requires ${admissibleKinds.join(" or ")}`,
    );
  }

  const appliesTo = record.applies_to ?? {
    candidate_ref: null,
    workload_ref: null,
    hardware_ref: null,
    constraint_refs: [],
  };

  // --- candidate scope: fails closed when the caller supplied no candidate --
  if (CANDIDATE_SCOPED_SUBJECTS.has(floorSubject)) {
    const candidateRef = supplied.candidateRef;
    if (candidateRef === undefined || candidateRef === null) {
      return reject(
        `${floorSubject} is candidate-specific, but no candidate context was supplied; missing context is insufficient evidence, not permission to skip the check`,
      );
    }
    if (appliesTo.candidate_ref === null) {
      return reject(
        `${floorSubject} is candidate-specific, but this evidence is not attributed to any candidate`,
      );
    }
    if (appliesTo.candidate_ref !== candidateRef) {
      return reject(
        `this evidence describes candidate "${appliesTo.candidate_ref}", not "${candidateRef}"`,
      );
    }
    if (
      record.kind === "measured_evaluation" &&
      record.value.candidate_ref !== candidateRef
    ) {
      return reject(
        `the evaluation was run against candidate "${record.value.candidate_ref}", not "${candidateRef}"`,
      );
    }
  }

  // --- workload scope: fails closed when the caller supplied no workload ---
  if (WORKLOAD_SCOPED_SUBJECTS.has(floorSubject)) {
    const workloadRef = supplied.workloadRef;
    if (workloadRef === undefined || workloadRef === null) {
      return reject(
        `${floorSubject} is workload-specific, but no workload context was supplied`,
      );
    }
    if (
      appliesTo.workload_ref !== null &&
      appliesTo.workload_ref !== workloadRef
    ) {
      return reject(
        `this evidence describes workload "${appliesTo.workload_ref}", not "${workloadRef}"`,
      );
    }
  } else if (
    appliesTo.workload_ref !== null &&
    supplied.workloadRef !== undefined &&
    supplied.workloadRef !== null &&
    appliesTo.workload_ref !== supplied.workloadRef
  ) {
    return reject(
      `this evidence describes workload "${appliesTo.workload_ref}", not "${supplied.workloadRef}"`,
    );
  }

  // A measured evaluation must describe the candidate AS CONFIGURED NOW.
  // Leaving this to a caller who remembers to ask separately is how a stale
  // result keeps clearing a gate, so the check lives in admission itself.
  if (record.kind === "measured_evaluation") {
    const expected = supplied.expectedEvaluation;
    if (expected === undefined || expected === null) {
      return reject(
        "no expected evaluation identity was supplied, so this measurement cannot be shown to describe the candidate's current configuration",
      );
    }
    if (record.value.identity.provider_id !== expected.provider_id) {
      return reject(
        `this evaluation ran against provider "${record.value.identity.provider_id}" but the candidate is configured for "${expected.provider_id}"`,
      );
    }
    if (record.value.configuration_hash !== expected.configuration_hash) {
      return reject(
        "this evaluation describes a different configuration from the candidate's current one",
      );
    }
  }

  // --- hardware scope ------------------------------------------------------
  //
  // A benchmark is only evidence about the machine the candidate actually
  // deploys to. Being *a* declared machine somewhere in the contract is not
  // enough: the evidence must name the candidate's own deployment target.
  if (HARDWARE_SCOPED_SUBJECTS.has(floorSubject)) {
    const declared = supplied.declaredTargetHardwareRefs;
    if (declared === undefined) {
      return reject(
        `${floorSubject} needs the declared-target hardware context, and none was supplied`,
      );
    }
    const deployment = supplied.deploymentHardwareRef;
    if (deployment === undefined || deployment === null) {
      return reject(
        `${floorSubject} needs the candidate's deployment hardware, and none was supplied`,
      );
    }
    if (!declared.includes(deployment)) {
      return reject(
        `deployment hardware "${deployment}" is not a user-declared target, so nothing measured on it can settle a target gate`,
      );
    }

    if (record.kind === "tool_observation") {
      const resolve = supplied.resolveHardware;
      if (resolve === undefined) {
        return reject(
          `${floorSubject} needs to resolve the hardware this observation names, and no resolver was supplied`,
        );
      }
      const problem = hardwareObservationProblem(record, resolve);
      if (problem !== null) {
        return reject(problem);
      }
      if (record.value.target_hardware_ref !== deployment) {
        return reject(
          `this observation describes hardware "${String(record.value.target_hardware_ref)}", not the candidate's deployment target "${deployment}"`,
        );
      }
    } else if (appliesTo.hardware_ref === null) {
      return reject("a hardware measurement must name the hardware it ran on");
    } else if (appliesTo.hardware_ref !== deployment) {
      return reject(
        `this measurement ran on hardware "${appliesTo.hardware_ref}", not the candidate's deployment target "${deployment}"`,
      );
    }
  }

  // Belt and braces for a hardware-shaped record reaching a non-hardware
  // subject: a mismatched observation is never evidence about its target.
  if (
    record.kind === "tool_observation" &&
    supplied.resolveHardware !== undefined
  ) {
    const problem = hardwareObservationProblem(
      record,
      supplied.resolveHardware,
    );
    if (problem !== null) {
      return reject(problem);
    }
  }

  return ADMITTED;
}

/**
 * The floor actually in force for a subject: the contract's declaration when
 * present, otherwise the ratified baseline. A contract may raise a floor but
 * never lower it, and validation rejects an attempt to lower one rather than
 * silently repairing it.
 */
export function effectiveFloor(
  policy: EvidencePolicy,
  subject: EvidenceFloorSubject,
): EvidenceTier {
  const declared = policy.floors[subject];
  const ratified = RATIFIED_EVIDENCE_FLOORS[subject];
  if (declared === undefined) {
    return ratified;
  }
  return tierRank(declared) > tierRank(ratified) ? declared : ratified;
}

/**
 * Map a constraint to the ratified floor subject that governs it.
 *
 * Returns `null` for soft and informational constraints that doc 06 does not
 * assign a floor to. Those are directional comparison inputs, never gates, so
 * inventing a floor for them would be product design rather than
 * implementation. The one soft constraint doc 06 DOES name is cost, which maps
 * to `projected_cost_comparison`.
 */
export function floorSubjectForConstraint(
  constraint: Constraint,
): EvidenceFloorSubject | null {
  const hard = constraint.severity === "hard";

  switch (constraint.domain) {
    case "quality":
      return hard ? "workload_quality_hard_gate" : null;
    case "privacy":
      return hard ? "privacy_data_flow_hard_gate" : null;
    case "latency":
    case "throughput":
      return hard ? "latency_throughput_hard_gate" : null;
    case "tokens":
      return hard ? "token_hard_gate" : null;
    case "cost":
      return hard ? "realized_cost_hard_gate" : "projected_cost_comparison";
    case "licensing":
      return "license";
    case "residency":
    case "provider_policy":
      return "residency_provider_capability";
    case "hardware":
      return hard
        ? "hardware_performance_gate"
        : "hardware_compatibility_estimate";
    case "availability":
      return hard ? "availability_portability_structure" : null;
    case "repository_policy":
      return hard ? "repository_policy" : null;
    case "functionality":
    case "operability":
      return null;
    default: {
      const exhaustive: never = constraint.domain;
      return exhaustive;
    }
  }
}

/** Vendor and brand words that carry no model information. */
const ACCELERATOR_BRAND_WORDS: ReadonlySet<string> = new Set([
  "nvidia",
  "geforce",
  "amd",
  "radeon",
  "intel",
  "arc",
  "apple",
  "gpu",
]);

function canonicalToken(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Compare accelerator model names on WORD boundaries.
 *
 * A user writes "RTX 4090" and a detection tool reports
 * "NVIDIA GeForce RTX 4090", so brand words are dropped before comparing. What
 * remains must then be EQUAL, not merely contained: "RTX 4090 Ti" and
 * "RTX 4070 SUPER" are different cards, and substring containment cannot tell
 * them apart from the base models whose names they extend.
 */
export function acceleratorModelsMatch(
  declared: string,
  detected: string,
): boolean {
  const significant = (value: string): string[] =>
    value
      .toLowerCase()
      .split(/[\s_-]+/)
      .filter(
        (token) => token.length > 0 && !ACCELERATOR_BRAND_WORDS.has(token),
      );

  const left = significant(declared);
  const right = significant(detected);

  if (left.length !== right.length) {
    return false;
  }
  return left.every((token, index) => token === right[index]);
}

/**
 * Compare a declared target machine with a detected one.
 *
 * Decision 06 sections 6 and 8 keep these as SEPARATE subjects: a user
 * declaration of what they own, and a deterministic observation of what is
 * actually present. They are different records with different ids and
 * different evidence kinds, and they always will be — so identity can never be
 * decided by comparing ids.
 *
 * The rule for this milestone is deliberately CONSERVATIVE: the two machines
 * must be the same machine in every respect a fit result depends on — RAM, CPU
 * core count, CPU model where the target names one, operating system, backend,
 * and every accelerator's model, count and VRAM. "The detected machine has
 * more" is not proof about a smaller target, and anything missing or
 * incomparable yields no match, which the caller reports as `unknown`.
 */
export function hardwareCapabilitiesMatch(
  declared: Hardware,
  detected: Hardware,
): { readonly matches: boolean; readonly reason: string } {
  const declaredBackend = declared.backend ?? null;
  const detectedBackend = detected.backend ?? null;

  if (declaredBackend !== null && detectedBackend !== null) {
    if (canonicalToken(declaredBackend) !== canonicalToken(detectedBackend)) {
      return {
        matches: false,
        reason: `declared backend "${declaredBackend}" and detected backend "${detectedBackend}" differ`,
      };
    }
  } else if (declaredBackend !== null || detectedBackend !== null) {
    return {
      matches: false,
      reason:
        "one of the declared target and the detected machine records a backend and the other does not, so they cannot be compared",
    };
  }

  // A fit estimate depends on the whole machine. A CUDA-on-Linux estimate does
  // not describe a macOS host even with an identical card, so an operating
  // system difference invalidates rather than merely downgrades the evidence.
  if (declared.operating_system !== detected.operating_system) {
    return {
      matches: false,
      reason: `declared operating system "${declared.operating_system}" and detected "${detected.operating_system}" differ`,
    };
  }

  // RAM and CPU must MATCH, not merely suffice.
  //
  // A measurement taken on a 64 GB / 16-core machine is not evidence about a
  // 32 GB / 8-core target: the fit, the achievable context, and the throughput
  // all differ. "The detected machine is bigger" says nothing about how the
  // smaller one behaves, so anything other than equality is `unknown`.
  if (detected.ram_gb !== declared.ram_gb) {
    return {
      matches: false,
      reason: `declared RAM ${declared.ram_gb}GB and detected RAM ${detected.ram_gb}GB differ; a result from a different machine size does not transfer`,
    };
  }
  if (detected.cpu.cores !== declared.cpu.cores) {
    return {
      matches: false,
      reason: `declared CPU cores ${declared.cpu.cores} and detected ${detected.cpu.cores} differ; a result from a different machine size does not transfer`,
    };
  }
  // The CPU model is compared only when the declared target names one: a
  // target that does not specify a CPU is not making a claim about it.
  if (declared.cpu.model !== null) {
    if (detected.cpu.model === null) {
      return {
        matches: false,
        reason: `the declared target names CPU "${declared.cpu.model}" but the detected machine reports none, so they cannot be compared`,
      };
    }
    if (
      canonicalToken(declared.cpu.model) !== canonicalToken(detected.cpu.model)
    ) {
      return {
        matches: false,
        reason: `declared CPU "${declared.cpu.model}" and detected "${detected.cpu.model}" differ`,
      };
    }
  }

  const declaredCount = declared.accelerators.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  const detectedCount = detected.accelerators.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  if (declaredCount !== detectedCount) {
    return {
      matches: false,
      reason: `declared target has ${declaredCount} accelerator(s) but the detected machine has ${detectedCount}`,
    };
  }

  if (declared.accelerators.length !== detected.accelerators.length) {
    return {
      matches: false,
      reason: `declared target lists ${declared.accelerators.length} accelerator entr(ies) but the detected machine lists ${detected.accelerators.length}`,
    };
  }

  const order = (entry: Hardware["accelerators"][number]): string =>
    `${entry.vram_gb.toString().padStart(8, "0")}|${entry.count}`;
  const declaredSorted = [...declared.accelerators].sort((left, right) =>
    order(left) < order(right) ? -1 : 1,
  );
  const detectedSorted = [...detected.accelerators].sort((left, right) =>
    order(left) < order(right) ? -1 : 1,
  );

  for (let index = 0; index < declaredSorted.length; index += 1) {
    const declaredEntry = declaredSorted[index];
    const detectedEntry = detectedSorted[index];
    if (declaredEntry === undefined || detectedEntry === undefined) {
      return {
        matches: false,
        reason: "accelerator lists could not be paired",
      };
    }
    if (declaredEntry.vram_gb !== detectedEntry.vram_gb) {
      return {
        matches: false,
        reason: `declared VRAM ${declaredEntry.vram_gb}GB and detected VRAM ${detectedEntry.vram_gb}GB differ`,
      };
    }
    if (declaredEntry.count !== detectedEntry.count) {
      return {
        matches: false,
        reason: `declared accelerator count ${declaredEntry.count} and detected count ${detectedEntry.count} differ`,
      };
    }
    if (!acceleratorModelsMatch(declaredEntry.model, detectedEntry.model)) {
      return {
        matches: false,
        reason: `declared accelerator "${declaredEntry.model}" and detected device "${detectedEntry.model}" differ`,
      };
    }
  }

  return {
    matches: true,
    reason:
      "the detected machine has the capabilities the declared target claims",
  };
}

/**
 * Check a hardware-fit observation against the two machines it names.
 *
 * Returns `null` when the observation legitimately describes the declared
 * target, and a reason when it does not. Requires a resolver because the
 * question cannot be answered from the record alone: it depends on what the
 * two referenced hardware entries actually say.
 */
export function hardwareObservationProblem(
  record: EvidenceRecord,
  resolve: (id: string) => Hardware | undefined,
): string | null {
  if (record.kind !== "tool_observation") {
    return null;
  }
  const { target_hardware_ref: targetRef, detected_hardware_ref: detectedRef } =
    record.value;

  if (targetRef === null || detectedRef === null) {
    return "a hardware observation must name both the target it describes and the machine it inspected";
  }
  if (targetRef === detectedRef) {
    // The two are different subjects by ratified design. Collapsing them hides
    // whether anything was actually detected.
    return "the declared target and the detected machine must be separate subjects, but this observation names the same entry for both";
  }

  const declared = resolve(targetRef);
  const detected = resolve(detectedRef);
  if (declared === undefined) {
    return `declared target "${targetRef}" does not resolve to a hardware entry`;
  }
  if (detected === undefined) {
    return `detected machine "${detectedRef}" does not resolve to a hardware entry`;
  }
  if (declared.evidence_kind !== "user_declared") {
    return `"${targetRef}" is not a user-declared target`;
  }
  if (detected.evidence_kind !== "deterministic_observation") {
    return `"${detectedRef}" is not a deterministic observation of a machine`;
  }

  const comparison = hardwareCapabilitiesMatch(declared, detected);
  return comparison.matches ? null : comparison.reason;
}

export interface EvidenceAssessment {
  /** The strongest tier among ADMISSIBLE evidence, or `T0` when there is none. */
  readonly bestTier: EvidenceTier;
  /** The floor in force, or `null` when the subject has no ratified floor. */
  readonly floor: EvidenceTier | null;
  /** The governing floor subject, or `null` for comparison-only constraints. */
  readonly floorSubject: EvidenceFloorSubject | null;
  /** True when admissible evidence reaches the floor. */
  readonly meetsFloor: boolean;
  /** Evidence ids excluded as inadmissible, with the reason. */
  readonly excluded: readonly {
    readonly id: string;
    readonly reason: string;
  }[];
  /** Why the floor was not met, or `null` when it was. */
  readonly shortfall: string | null;
}

/**
 * Assess the evidence cited for one constraint.
 *
 * `context` is REQUIRED. Passing `{}` is legal but is not a way to bypass a
 * check: every subject that needs a context field treats its absence as
 * insufficient evidence.
 *
 * Evidence is first filtered for ADMISSIBILITY: the wrong kind of evidence, or
 * evidence about a different candidate, workload, or machine, is excluded
 * entirely rather than counted at its tier. Only what survives contributes to
 * `bestTier`, which is then compared against the floor.
 */
export function assessEvidence(
  constraint: Constraint,
  citedEvidence: readonly EvidenceRecord[],
  policy: EvidencePolicy,
  context: EvidenceContext,
): EvidenceAssessment {
  const supplied: EvidenceContext = context ?? {};
  const floorSubject = floorSubjectForConstraint(constraint);
  const floor =
    floorSubject === null ? null : effectiveFloor(policy, floorSubject);

  const excluded: { id: string; reason: string }[] = [];
  let bestTier: EvidenceTier = "T0";

  for (const record of citedEvidence) {
    const verdict = admitEvidence(record, constraint, supplied);
    if (!verdict.admitted) {
      excluded.push({ id: record.id, reason: verdict.reason });
      continue;
    }
    const tier = tierForEvidence(record);
    if (tierRank(tier) > tierRank(bestTier)) {
      bestTier = tier;
    }
  }

  let meetsFloor = floor === null ? true : tierMeets(bestTier, floor);
  let shortfall: string | null = meetsFloor
    ? null
    : `admissible evidence reaches only ${bestTier} but ${floorSubject ?? "this subject"} requires ${floor ?? "none"}`;

  // Official pricing alone is a price list, not a comparison. Decision 06
  // requires official pricing PLUS explicit arithmetic PLUS declared usage
  // assumptions. Both flags must be explicitly true; `undefined` fails closed,
  // because a caller that never computed them has not established anything.
  if (meetsFloor && floorSubject === "projected_cost_comparison") {
    const missing: string[] = [];
    if (supplied.hasExplicitCostCalculation !== true) {
      missing.push(
        "a recorded projected monthly cost and the arithmetic behind it",
      );
    }
    if (supplied.hasDeclaredUsageInputs !== true) {
      missing.push(
        "declared-or-stronger workload usage inputs with their assumptions written down",
      );
    }
    if (missing.length > 0) {
      meetsFloor = false;
      shortfall = `a projected cost comparison needs official pricing plus ${missing.join(" and ")}`;
    }
  }

  return { bestTier, floor, floorSubject, meetsFloor, excluded, shortfall };
}

export interface ConstraintEvaluation {
  readonly outcome: Outcome;
  readonly assessment: EvidenceAssessment;
  /** Present when the asserted status was downgraded. */
  readonly downgradedFrom?: Outcome;
  readonly explanation: string;
}

/**
 * Determine the trustworthy outcome for one constraint.
 *
 * The critical rule, ratified in doc 06 section 6: evidence below the
 * applicable floor yields `unknown` and can never satisfy a hard constraint.
 * An asserted `pass` that is not backed by sufficient evidence is downgraded,
 * never accepted.
 *
 * `fail` is preserved regardless of tier. Weak evidence is a reason to doubt a
 * success claim, not a reason to ignore a reported problem, and a `fail`
 * blocks approval either way.
 */
export function evaluateConstraint(
  constraint: Constraint,
  assertedStatus: Outcome,
  citedEvidence: readonly EvidenceRecord[],
  policy: EvidencePolicy,
  context: EvidenceContext,
): ConstraintEvaluation {
  const assessment = assessEvidence(
    constraint,
    citedEvidence,
    policy,
    context ?? {},
  );

  if (constraint.severity === "informational") {
    return {
      outcome: "not_applicable",
      assessment,
      explanation:
        "informational constraints are recorded but not scored, so they are never a gate",
    };
  }

  if (assertedStatus === "not_applicable" || assertedStatus === "fail") {
    return {
      outcome: assertedStatus,
      assessment,
      explanation:
        assertedStatus === "fail"
          ? "a reported failure is preserved regardless of evidence tier"
          : "the constraint does not apply to this subject",
    };
  }

  if (assertedStatus === "unknown") {
    return {
      outcome: "unknown",
      assessment,
      explanation: "the recorded result is already unknown",
    };
  }

  const contradictorySizing = citedEvidence.find(
    (record) =>
      record.kind === "tool_observation" &&
      record.value?.estimate_basis?.format ===
        "anvilmark-hardware-fit-evidence/1" &&
      !assessment.excluded.some((entry) => entry.id === record.id) &&
      record.value.findings.memory_fit !== true,
  );
  if (contradictorySizing) {
    return {
      outcome: "unknown",
      assessment,
      downgradedFrom: "pass",
      explanation:
        "The recomputed memory estimate exceeds its selected budget; an asserted pass contradicts that evidence.",
    };
  }

  if (!assessment.meetsFloor) {
    const excludedNote =
      assessment.excluded.length === 0
        ? ""
        : ` (${assessment.excluded.length} record(s) excluded as inadmissible: ${assessment.excluded
            .map((entry) => `${entry.id} — ${entry.reason}`)
            .join("; ")})`;
    return {
      outcome: "unknown",
      assessment,
      downgradedFrom: "pass",
      explanation:
        `${assessment.shortfall ?? "the evidence floor was not met"}${excludedNote}; ` +
        "insufficient evidence yields unknown and never satisfies a hard constraint",
    };
  }

  return {
    outcome: "pass",
    assessment,
    explanation: `admissible evidence reaches ${assessment.bestTier}, meeting the required floor`,
  };
}
