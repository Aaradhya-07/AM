import type { Constraint } from "./schema/constraints.js";
import type { EvidenceFloorSubject, EvidenceKind, EvidencePolicy, EvidenceRecord, EvidenceTier } from "./schema/evidence.js";
import type { Outcome } from "./schema/primitives.js";
/** Total ordering of evidence tiers, weakest first. */
export declare const TIER_ORDER: readonly EvidenceTier[];
export declare function tierRank(tier: EvidenceTier): number;
/** True when `tier` is at least as strong as `floor`. */
export declare function tierMeets(tier: EvidenceTier, floor: EvidenceTier): boolean;
export declare function tierForEvidenceKind(kind: EvidenceKind): EvidenceTier;
export declare function tierForEvidence(record: EvidenceRecord): EvidenceTier;
/**
 * The ratified per-subject evidence floors, taken verbatim from the amended
 * table in doc 06 section 6.
 *
 * The separation matters: a projected cost comparison may proceed on T2
 * official pricing plus T1 usage assumptions, while a HARD realized-cost gate
 * demands T3 billing measurement. Collapsing the two would let an estimate be
 * presented as a measurement.
 */
export declare const RATIFIED_EVIDENCE_FLOORS: Readonly<Record<EvidenceFloorSubject, EvidenceTier>>;
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
export declare const ADMISSIBLE_EVIDENCE_KINDS: Readonly<Record<EvidenceFloorSubject, readonly EvidenceKind[]>>;
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
    /** The candidate whose result is being evaluated. */
    readonly candidateRef?: string | null;
    /** The workload that candidate serves. */
    readonly workloadRef?: string | null;
    /** Ids of hardware entries the user DECLARED, as opposed to detected ones. */
    readonly declaredTargetHardwareRefs?: readonly string[];
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
}
export interface AdmissionVerdict {
    readonly admitted: boolean;
    readonly reason: string;
}
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
export declare function admitEvidence(record: EvidenceRecord, constraint: Constraint, context: EvidenceContext): AdmissionVerdict;
/**
 * The floor actually in force for a subject: the contract's declaration when
 * present, otherwise the ratified baseline. A contract may raise a floor but
 * never lower it, and validation rejects an attempt to lower one rather than
 * silently repairing it.
 */
export declare function effectiveFloor(policy: EvidencePolicy, subject: EvidenceFloorSubject): EvidenceTier;
/**
 * Map a constraint to the ratified floor subject that governs it.
 *
 * Returns `null` for soft and informational constraints that doc 06 does not
 * assign a floor to. Those are directional comparison inputs, never gates, so
 * inventing a floor for them would be product design rather than
 * implementation. The one soft constraint doc 06 DOES name is cost, which maps
 * to `projected_cost_comparison`.
 */
export declare function floorSubjectForConstraint(constraint: Constraint): EvidenceFloorSubject | null;
/**
 * A hardware-fit tool observation can only speak for the target it actually
 * inspected. When the declared target and the detected machine differ, the
 * observation is not evidence about the target at all.
 *
 * Ratified in doc 06 section 8.
 */
export declare function isHardwareIdentityMismatch(record: EvidenceRecord): boolean;
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
export declare function assessEvidence(constraint: Constraint, citedEvidence: readonly EvidenceRecord[], policy: EvidencePolicy, context: EvidenceContext): EvidenceAssessment;
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
export declare function evaluateConstraint(constraint: Constraint, assertedStatus: Outcome, citedEvidence: readonly EvidenceRecord[], policy: EvidencePolicy, context: EvidenceContext): ConstraintEvaluation;
//# sourceMappingURL=evidence-tiers.d.ts.map