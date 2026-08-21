import type { ContractIssue } from "../errors.js";
import { issue } from "../errors.js";
import { hashApprovalContent } from "../approval.js";
import type { EvidenceContext } from "../evidence-tiers.js";
import {
  RATIFIED_EVIDENCE_FLOORS,
  evaluateConstraint,
  isHardwareIdentityMismatch,
  tierRank,
} from "../evidence-tiers.js";
import type { ProjectContract } from "../schema/contract.js";
import type { EvidenceKind, EvidenceRecord } from "../schema/evidence.js";
import { resolveDecision } from "../resolve.js";
import { RATIFIED_DEFAULT_DENY } from "../schema/remote.js";

/** The named collections a reference can point into. */
export type SubjectType =
  | "constraint"
  | "workload"
  | "hardware"
  | "candidate"
  | "evidence"
  | "decision"
  | "architecture_node"
  | "architecture_relationship"
  | "repository_binding"
  | "conformance_rule"
  | "integration"
  | "outcome";

interface Index {
  readonly tables: Readonly<Record<SubjectType, ReadonlyMap<string, unknown>>>;
  /** Every id in the contract, with the collections it appears in. */
  readonly global: ReadonlyMap<string, readonly SubjectType[]>;
  readonly dataClassifications: ReadonlySet<string>;
}

function buildIndex(contract: ProjectContract): {
  index: Index;
  issues: ContractIssue[];
} {
  const issues: ContractIssue[] = [];
  const tables: Record<SubjectType, Map<string, unknown>> = {
    constraint: new Map(),
    workload: new Map(),
    hardware: new Map(),
    candidate: new Map(),
    evidence: new Map(),
    decision: new Map(),
    architecture_node: new Map(),
    architecture_relationship: new Map(),
    repository_binding: new Map(),
    conformance_rule: new Map(),
    integration: new Map(),
    outcome: new Map(),
  };

  const collect = (
    type: SubjectType,
    path: string,
    entries: readonly { id: string }[],
  ): void => {
    entries.forEach((entry, position) => {
      const table = tables[type];
      if (table.has(entry.id)) {
        issues.push(
          issue(
            "duplicate_id",
            `${path}[${position}].id`,
            `duplicate ${type} id "${entry.id}"; ids must be unique within their collection`,
            { id: entry.id, subject_type: type },
          ),
        );
        return;
      }
      table.set(entry.id, entry);
    });
  };

  collect("constraint", "constraints", contract.constraints);
  collect("workload", "workloads", contract.workloads);
  collect("hardware", "resources.hardware", contract.resources.hardware);
  collect("candidate", "candidates", contract.candidates);
  collect("evidence", "evidence_refs", contract.evidence_refs);
  collect("decision", "decisions", contract.decisions);
  collect(
    "architecture_node",
    "architecture.nodes",
    contract.architecture.nodes,
  );
  collect(
    "architecture_relationship",
    "architecture.relationships",
    contract.architecture.relationships,
  );
  collect(
    "repository_binding",
    "repository_bindings",
    contract.repository_bindings,
  );
  collect("conformance_rule", "conformance_rules", contract.conformance_rules);
  collect("integration", "integrations", contract.integrations);
  collect("outcome", "intent.outcomes", contract.intent.outcomes);

  const global = new Map<string, SubjectType[]>();
  for (const [type, table] of Object.entries(tables) as [
    SubjectType,
    Map<string, unknown>,
  ][]) {
    for (const id of table.keys()) {
      const existing = global.get(id);
      if (existing === undefined) {
        global.set(id, [type]);
      } else {
        existing.push(type);
      }
    }
  }

  // Data classifications are project vocabulary, declared by workload inputs.
  const dataClassifications = new Set<string>(
    contract.workloads.map((workload) => workload.input_classification),
  );

  return { index: { tables, global, dataClassifications }, issues };
}

interface RefCheck {
  readonly path: string;
  readonly value: string;
  readonly expected: SubjectType;
  readonly label: string;
}

function checkRef(index: Index, check: RefCheck): ContractIssue | null {
  if (index.tables[check.expected].has(check.value)) {
    return null;
  }
  const foundAs = index.global.get(check.value);
  if (foundAs !== undefined && foundAs.length > 0) {
    return issue(
      "reference_wrong_type",
      check.path,
      `${check.label} "${check.value}" resolves to a ${foundAs.join(" and ")}, but a ${check.expected} is required`,
      { reference: check.value, expected: check.expected, found_as: foundAs },
    );
  }
  return issue(
    "reference_not_found",
    check.path,
    `${check.label} "${check.value}" does not resolve to any declared ${check.expected}`,
    { reference: check.value, expected: check.expected },
  );
}

/**
 * Evidence kinds that may legitimately back each `measurements.*` field.
 *
 * `measurements` asserts that something was MEASURED. Pointing one of these
 * fields at a vendor claim, an agent inference, or a documentation page is
 * exactly the "estimate presented as measurement" failure, so it is rejected
 * rather than quietly downgraded.
 *
 * `hardware_fit_evidence_ref` admits `tool_observation` because doc 06 sets
 * the hardware-compatibility floor at T2 tool observation; a hardware
 * PERFORMANCE gate still requires a T3 benchmark through its constraint.
 */
const MEASUREMENT_KINDS: Readonly<Record<string, readonly EvidenceKind[]>> = {
  quality_result_ref: ["measured_evaluation"],
  latency_measurement_ref: ["measured_evaluation", "runtime_measurement"],
  token_measurement_ref: [
    "measured_evaluation",
    "runtime_measurement",
    "deterministic_observation",
  ],
  cost_measurement_ref: ["runtime_measurement", "deterministic_observation"],
  hardware_fit_evidence_ref: [
    "tool_observation",
    "measured_evaluation",
    "runtime_measurement",
    "deterministic_observation",
  ],
};

function checkIntegrityInner(
  contract: ProjectContract,
  index: Index,
): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const push = (candidate: ContractIssue | null): void => {
    if (candidate !== null) {
      issues.push(candidate);
    }
  };

  const evidenceById = index.tables.evidence as ReadonlyMap<
    string,
    EvidenceRecord
  >;

  // --- project ---------------------------------------------------------
  const seenDomains = new Set<string>();
  contract.project.priority_order.forEach((domain, position) => {
    if (seenDomains.has(domain)) {
      issues.push(
        issue(
          "duplicate_id",
          `project.priority_order[${position}]`,
          `domain "${domain}" appears more than once in priority_order; the ordering must be unambiguous`,
          { domain },
        ),
      );
    }
    seenDomains.add(domain);
  });

  // --- evidence policy floors -----------------------------------------
  for (const [subject, declared] of Object.entries(
    contract.evidence_policy.floors,
  )) {
    if (declared === undefined) {
      continue;
    }
    const ratified =
      RATIFIED_EVIDENCE_FLOORS[
        subject as keyof typeof RATIFIED_EVIDENCE_FLOORS
      ];
    if (tierRank(declared) < tierRank(ratified)) {
      issues.push(
        issue(
          "evidence_floor_below_ratified_baseline",
          `evidence_policy.floors.${subject}`,
          `declared floor ${declared} is weaker than the ratified baseline ${ratified} for "${subject}"; floors may be raised but never lowered`,
          { subject, declared, ratified },
        ),
      );
    }
  }

  // --- constraints ------------------------------------------------------
  const exceptionIds = new Set<string>();
  contract.constraints.forEach((constraint, position) => {
    const base = `constraints[${position}]`;

    const [head, second] = constraint.subject.split(".");
    if (head === "workload" && second !== undefined) {
      if (!index.tables.workload.has(second)) {
        issues.push(
          issue(
            "constraint_subject_unresolved",
            `${base}.subject`,
            `subject "${constraint.subject}" names workload "${second}", which is not declared`,
            { subject: constraint.subject, workload: second },
          ),
        );
      }
    }
    if (head === "data" && second !== undefined) {
      if (!index.dataClassifications.has(second)) {
        issues.push(
          issue(
            "constraint_subject_unresolved",
            `${base}.subject`,
            `subject "${constraint.subject}" names data classification "${second}", which no workload declares as an input`,
            { subject: constraint.subject, data_classification: second },
          ),
        );
      }
    }

    constraint.exceptions.forEach((exception, exceptionPosition) => {
      const exceptionPath = `${base}.exceptions[${exceptionPosition}]`;
      if (exceptionIds.has(exception.id)) {
        issues.push(
          issue(
            "duplicate_id",
            `${exceptionPath}.id`,
            `duplicate exception id "${exception.id}"`,
            { id: exception.id },
          ),
        );
      }
      exceptionIds.add(exception.id);
      if (exception.decision_ref !== null) {
        push(
          checkRef(index, {
            path: `${exceptionPath}.decision_ref`,
            value: exception.decision_ref,
            expected: "decision",
            label: "exception decision_ref",
          }),
        );
      }
    });
  });

  // --- workloads --------------------------------------------------------
  contract.workloads.forEach((workload, position) => {
    const base = `workloads[${position}]`;
    if (workload.current_decision_ref !== null) {
      push(
        checkRef(index, {
          path: `${base}.current_decision_ref`,
          value: workload.current_decision_ref,
          expected: "decision",
          label: "current_decision_ref",
        }),
      );
    }
  });

  // --- resources --------------------------------------------------------
  contract.resources.hardware.forEach((hardware, position) => {
    hardware.evidence_refs.forEach((ref, refPosition) => {
      push(
        checkRef(index, {
          path: `resources.hardware[${position}].evidence_refs[${refPosition}]`,
          value: ref,
          expected: "evidence",
          label: "hardware evidence ref",
        }),
      );
    });
  });

  // --- evidence records -------------------------------------------------
  // Evidence carries references of its own. A measured evaluation that names
  // a candidate which does not exist, or a tool observation naming absent
  // hardware, is unverifiable and must not be treated as evidence at all.
  contract.evidence_refs.forEach((record, position) => {
    const base = `evidence_refs[${position}]`;

    if (record.applies_to.candidate_ref !== null) {
      push(
        checkRef(index, {
          path: `${base}.applies_to.candidate_ref`,
          value: record.applies_to.candidate_ref,
          expected: "candidate",
          label: "evidence applies_to.candidate_ref",
        }),
      );
    }
    if (record.applies_to.workload_ref !== null) {
      push(
        checkRef(index, {
          path: `${base}.applies_to.workload_ref`,
          value: record.applies_to.workload_ref,
          expected: "workload",
          label: "evidence applies_to.workload_ref",
        }),
      );
    }
    if (record.applies_to.hardware_ref !== null) {
      push(
        checkRef(index, {
          path: `${base}.applies_to.hardware_ref`,
          value: record.applies_to.hardware_ref,
          expected: "hardware",
          label: "evidence applies_to.hardware_ref",
        }),
      );
    }

    const seenConstraintRefs = new Set<string>();
    record.applies_to.constraint_refs.forEach((ref, refPosition) => {
      const refPath = `${base}.applies_to.constraint_refs[${refPosition}]`;
      if (seenConstraintRefs.has(ref)) {
        issues.push(
          issue(
            "duplicate_id",
            refPath,
            `constraint "${ref}" is listed more than once; each supported claim is named exactly once`,
            { constraint: ref },
          ),
        );
        return;
      }
      seenConstraintRefs.add(ref);
      push(
        checkRef(index, {
          path: refPath,
          value: ref,
          expected: "constraint",
          label: "evidence applies_to.constraint_refs entry",
        }),
      );
    });

    if (record.kind === "measured_evaluation") {
      const problem = checkRef(index, {
        path: `${base}.value.candidate_ref`,
        value: record.value.candidate_ref,
        expected: "candidate",
        label: "evaluation candidate_ref",
      });
      push(problem);
      if (
        problem === null &&
        record.applies_to.candidate_ref !== null &&
        record.applies_to.candidate_ref !== record.value.candidate_ref
      ) {
        issues.push(
          issue(
            "reference_wrong_type",
            `${base}.value.candidate_ref`,
            `this evaluation was run against candidate "${record.value.candidate_ref}" but claims to apply to "${record.applies_to.candidate_ref}"`,
            {
              evaluated: record.value.candidate_ref,
              claimed: record.applies_to.candidate_ref,
            },
          ),
        );
      }
    }

    if (record.kind === "tool_observation") {
      for (const field of [
        "target_hardware_ref",
        "detected_hardware_ref",
      ] as const) {
        const ref = record.value[field];
        if (ref === null) {
          continue;
        }
        push(
          checkRef(index, {
            path: `${base}.value.${field}`,
            value: ref,
            expected: "hardware",
            label: `tool observation ${field}`,
          }),
        );
      }
    }
  });

  // --- candidates -------------------------------------------------------
  // Only hardware the user DECLARED can stand as a target. Detected machines
  // are a separate subject and can never satisfy a target's gate.
  const declaredTargetHardware = contract.resources.hardware
    .filter((entry) => entry.evidence_kind === "user_declared")
    .map((entry) => entry.id);

  contract.candidates.forEach((candidate, position) => {
    const base = `candidates[${position}]`;

    if (candidate.workload_ref !== null) {
      push(
        checkRef(index, {
          path: `${base}.workload_ref`,
          value: candidate.workload_ref,
          expected: "workload",
          label: "candidate workload_ref",
        }),
      );
    }

    if (
      candidate.deployment.mode === "local" &&
      candidate.deployment.hardware_ref !== null
    ) {
      push(
        checkRef(index, {
          path: `${base}.deployment.hardware_ref`,
          value: candidate.deployment.hardware_ref,
          expected: "hardware",
          label: "deployment hardware_ref",
        }),
      );
    }

    if (
      candidate.model !== null &&
      candidate.model.license_evidence_ref !== null
    ) {
      push(
        checkRef(index, {
          path: `${base}.model.license_evidence_ref`,
          value: candidate.model.license_evidence_ref,
          expected: "evidence",
          label: "license_evidence_ref",
        }),
      );
    }

    for (const [field, allowedKinds] of Object.entries(MEASUREMENT_KINDS)) {
      const ref =
        candidate.measurements[field as keyof typeof candidate.measurements];
      if (ref === null || ref === undefined) {
        continue;
      }
      const path = `${base}.measurements.${field}`;
      const problem = checkRef(index, {
        path,
        value: ref,
        expected: "evidence",
        label: `measurement ${field}`,
      });
      if (problem !== null) {
        issues.push(problem);
        continue;
      }
      const record = evidenceById.get(ref);
      if (record === undefined) {
        continue;
      }
      if (!allowedKinds.includes(record.kind)) {
        issues.push(
          issue(
            "estimate_presented_as_measurement",
            path,
            `${field} cites evidence "${ref}" of kind "${record.kind}", which is not a measurement; expected one of ${allowedKinds.join(", ")}`,
            { evidence: ref, kind: record.kind, allowed: allowedKinds },
          ),
        );
      }
      // The evidence must describe THIS candidate. A measurement of another
      // candidate is not weaker evidence, it is evidence about something else.
      const describes =
        record.applies_to.candidate_ref ??
        (record.kind === "measured_evaluation"
          ? record.value.candidate_ref
          : null);
      if (describes === null) {
        issues.push(
          issue(
            "evidence_not_applicable",
            path,
            `${field} cites evidence "${ref}" that is not attributed to any candidate; a measurement must name the candidate it describes`,
            { evidence: ref, candidate: candidate.id },
          ),
        );
      } else if (describes !== candidate.id) {
        issues.push(
          issue(
            "evidence_not_applicable",
            path,
            `${field} cites evidence "${ref}", which describes candidate "${describes}", not "${candidate.id}"`,
            { evidence: ref, describes, candidate: candidate.id },
          ),
        );
      }

      if (isHardwareIdentityMismatch(record)) {
        issues.push(
          issue(
            "estimate_presented_as_measurement",
            path,
            `${field} cites hardware evidence "${ref}" whose declared target and detected hardware differ; a mismatched observation cannot describe the target`,
            {
              evidence: ref,
              target_hardware_ref:
                record.kind === "tool_observation"
                  ? record.value.target_hardware_ref
                  : null,
              detected_hardware_ref:
                record.kind === "tool_observation"
                  ? record.value.detected_hardware_ref
                  : null,
            },
          ),
        );
      }
    }

    candidate.constraint_results.forEach((result, resultPosition) => {
      const resultPath = `${base}.constraint_results[${resultPosition}]`;
      const constraintProblem = checkRef(index, {
        path: `${resultPath}.constraint_ref`,
        value: result.constraint_ref,
        expected: "constraint",
        label: "constraint_ref",
      });
      push(constraintProblem);

      const cited: EvidenceRecord[] = [];
      result.evidence_refs.forEach((ref, refPosition) => {
        const problem = checkRef(index, {
          path: `${resultPath}.evidence_refs[${refPosition}]`,
          value: ref,
          expected: "evidence",
          label: "constraint result evidence ref",
        });
        if (problem !== null) {
          issues.push(problem);
          return;
        }
        const record = evidenceById.get(ref);
        if (record === undefined) {
          return;
        }
        cited.push(record);

        // Evidence cited BY a constraint result must say it supports that
        // constraint. Direct `measurements.*` references are exempt: they
        // describe the candidate, not a particular claim.
        if (
          !record.applies_to.constraint_refs.includes(result.constraint_ref)
        ) {
          issues.push(
            issue(
              "evidence_not_applicable",
              `${resultPath}.evidence_refs[${refPosition}]`,
              record.applies_to.constraint_refs.length === 0
                ? `evidence "${ref}" is not attributed to any constraint, so it cannot support a result for "${result.constraint_ref}"`
                : `evidence "${ref}" supports ${record.applies_to.constraint_refs.map((entry) => `"${entry}"`).join(", ")}, not "${result.constraint_ref}"`,
              {
                evidence: ref,
                constraint: result.constraint_ref,
                attributed_to: record.applies_to.constraint_refs,
              },
            ),
          );
        }
      });

      if (constraintProblem !== null || result.status !== "pass") {
        return;
      }
      const constraint = index.tables.constraint.get(result.constraint_ref);
      if (constraint === undefined) {
        return;
      }
      // Usage inputs come from the WORKLOAD's declared basis, not from prose
      // on the candidate: a sentence in `estimates.basis` is not usage
      // evidence. An agent-inferred basis is T0 and settles nothing.
      const servingWorkload =
        candidate.workload_ref === null
          ? undefined
          : (index.tables.workload.get(candidate.workload_ref) as
              { expected_usage: { basis: string } } | undefined);
      // Only the user can say how many calls their application will make.
      // A model or provider vendor cannot establish that, so `vendor_claim`
      // is not acceptable usage evidence, and `agent_inference` is T0.
      const usageBasis = servingWorkload?.expected_usage.basis;
      const usageIsUserEstablished =
        usageBasis === "user_assumption" || usageBasis === "measured";
      const assumptionsRecorded =
        usageBasis === "measured" || candidate.estimates.assumptions.length > 0;

      const context: EvidenceContext = {
        candidateRef: candidate.id,
        workloadRef: candidate.workload_ref,
        declaredTargetHardwareRefs: declaredTargetHardware,
        deploymentHardwareRef:
          candidate.deployment.mode === "local"
            ? candidate.deployment.hardware_ref
            : null,
        hasExplicitCostCalculation:
          candidate.estimates.monthly_effective_cost_usd !== null &&
          candidate.estimates.basis !== null,
        hasDeclaredUsageInputs: usageIsUserEstablished && assumptionsRecorded,
      };
      const evaluation = evaluateConstraint(
        constraint as Parameters<typeof evaluateConstraint>[0],
        "pass",
        cited,
        contract.evidence_policy,
        context,
      );
      // Only an evidence shortfall is an error here. An informational
      // constraint resolves to `not_applicable` by design, and flagging that
      // would report a scoring rule as if it were a missing measurement.
      if (evaluation.outcome === "unknown") {
        issues.push(
          issue(
            "pass_below_evidence_floor",
            `${resultPath}.status`,
            `this result asserts "pass" for constraint "${result.constraint_ref}" but ${evaluation.explanation}`,
            {
              constraint: result.constraint_ref,
              excluded_evidence: evaluation.assessment.excluded,
              best_tier: evaluation.assessment.bestTier,
              required_floor: evaluation.assessment.floor,
              floor_subject: evaluation.assessment.floorSubject,
              resolved_outcome: evaluation.outcome,
            },
          ),
        );
      }
    });
  });

  // --- decisions --------------------------------------------------------
  const candidateById = index.tables.candidate as ReadonlyMap<
    string,
    {
      workload_ref: string | null;
      model: { version: string | null; version_mutability: string } | null;
    }
  >;

  contract.decisions.forEach((decision, position) => {
    const base = `decisions[${position}]`;
    let scopedWorkload: string | null = null;

    if (decision.scope.kind === "workload") {
      const problem = checkRef(index, {
        path: `${base}.scope.workload_ref`,
        value: decision.scope.workload_ref,
        expected: "workload",
        label: "decision scope workload_ref",
      });
      push(problem);
      if (problem === null) {
        scopedWorkload = decision.scope.workload_ref;
      }
    } else if (decision.scope.kind === "component") {
      push(
        checkRef(index, {
          path: `${base}.scope.component_ref`,
          value: decision.scope.component_ref,
          expected: "architecture_node",
          label: "decision scope component_ref",
        }),
      );
    }

    const checkSelection = (ref: string, path: string): void => {
      const problem = checkRef(index, {
        path,
        value: ref,
        expected: "candidate",
        label: "candidate reference",
      });
      if (problem !== null) {
        issues.push(problem);
        return;
      }
      if (scopedWorkload === null) {
        return;
      }
      const candidate = candidateById.get(ref);
      if (candidate === undefined) {
        return;
      }
      if (candidate.workload_ref !== scopedWorkload) {
        issues.push(
          issue(
            "candidate_workload_mismatch",
            path,
            `candidate "${ref}" serves ${candidate.workload_ref === null ? "no workload" : `workload "${candidate.workload_ref}"`}, but this decision is scoped to workload "${scopedWorkload}"`,
            {
              candidate: ref,
              candidate_workload: candidate.workload_ref,
              decision_workload: scopedWorkload,
            },
          ),
        );
      }
    };

    if (decision.selected_candidate_ref !== null) {
      checkSelection(
        decision.selected_candidate_ref,
        `${base}.selected_candidate_ref`,
      );
    }
    decision.alternatives.forEach((ref, refPosition) => {
      checkSelection(ref, `${base}.alternatives[${refPosition}]`);
    });

    decision.satisfies_constraints.forEach((ref, refPosition) => {
      push(
        checkRef(index, {
          path: `${base}.satisfies_constraints[${refPosition}]`,
          value: ref,
          expected: "constraint",
          label: "satisfied constraint",
        }),
      );
    });
    decision.unresolved_constraints.forEach((ref, refPosition) => {
      push(
        checkRef(index, {
          path: `${base}.unresolved_constraints[${refPosition}]`,
          value: ref,
          expected: "constraint",
          label: "unresolved constraint",
        }),
      );
    });
    decision.evidence_refs.forEach((ref, refPosition) => {
      push(
        checkRef(index, {
          path: `${base}.evidence_refs[${refPosition}]`,
          value: ref,
          expected: "evidence",
          label: "decision evidence ref",
        }),
      );
    });

    if (decision.status === "approved") {
      if (!decision.rationale.reviewed_by_user) {
        issues.push(
          issue(
            "decision_scope_invalid",
            `${base}.rationale.reviewed_by_user`,
            `decision "${decision.id}" is approved but was never marked reviewed by a user; an adapter cannot approve on the user's behalf`,
            { decision: decision.id },
          ),
        );
      }
      // An approval of an older revision is history, not authorisation for
      // the revision now in the contract.
      const coveringApproval = contract.approvals.find(
        (approval) =>
          approval.decision_ref === decision.id &&
          approval.decision_revision === decision.revision,
      );
      if (coveringApproval === undefined) {
        issues.push(
          issue(
            "approval_content_unresolved",
            `${base}.status`,
            `decision "${decision.id}" revision ${decision.revision} is approved but no approval record covers that revision`,
            { decision: decision.id, revision: decision.revision },
          ),
        );
      }
      if (decision.selected_candidate_ref !== null) {
        const candidate = candidateById.get(decision.selected_candidate_ref);
        if (
          candidate !== undefined &&
          candidate.model !== null &&
          candidate.model.version === null
        ) {
          issues.push(
            issue(
              "model_version_unpinned",
              `${base}.selected_candidate_ref`,
              `approved decision "${decision.id}" selects a candidate whose model version is floating; an approved decision must reference an exact candidate revision`,
              {
                decision: decision.id,
                candidate: decision.selected_candidate_ref,
              },
            ),
          );
        }
      }
    }
  });

  // --- architecture -----------------------------------------------------
  contract.architecture.relationships.forEach((relationship, position) => {
    const base = `architecture.relationships[${position}]`;
    push(
      checkRef(index, {
        path: `${base}.source`,
        value: relationship.source,
        expected: "architecture_node",
        label: "relationship source",
      }),
    );
    push(
      checkRef(index, {
        path: `${base}.destination`,
        value: relationship.destination,
        expected: "architecture_node",
        label: "relationship destination",
      }),
    );
    if (relationship.workload_ref !== null) {
      push(
        checkRef(index, {
          path: `${base}.workload_ref`,
          value: relationship.workload_ref,
          expected: "workload",
          label: "relationship workload_ref",
        }),
      );
    }
    if (
      relationship.data_classification !== null &&
      !index.dataClassifications.has(relationship.data_classification)
    ) {
      issues.push(
        issue(
          "reference_not_found",
          `${base}.data_classification`,
          `data classification "${relationship.data_classification}" is not declared as the input of any workload`,
          { data_classification: relationship.data_classification },
        ),
      );
    }
  });

  contract.architecture.decision_bindings.forEach((binding, position) => {
    const base = `architecture.decision_bindings[${position}]`;
    push(
      checkRef(index, {
        path: `${base}.decision_ref`,
        value: binding.decision_ref,
        expected: "decision",
        label: "decision binding decision_ref",
      }),
    );
    binding.node_refs.forEach((ref, refPosition) => {
      push(
        checkRef(index, {
          path: `${base}.node_refs[${refPosition}]`,
          value: ref,
          expected: "architecture_node",
          label: "decision binding node_ref",
        }),
      );
    });
  });

  // --- repository bindings ---------------------------------------------
  contract.repository_bindings.forEach((binding, position) => {
    const base = `repository_bindings[${position}]`;
    push(
      checkRef(index, {
        path: `${base}.decision_ref`,
        value: binding.decision_ref,
        expected: "decision",
        label: "binding decision_ref",
      }),
    );
    if (binding.architecture_node_ref !== null) {
      push(
        checkRef(index, {
          path: `${base}.architecture_node_ref`,
          value: binding.architecture_node_ref,
          expected: "architecture_node",
          label: "binding architecture_node_ref",
        }),
      );
    }
  });

  // --- conformance rules ------------------------------------------------
  contract.conformance_rules.forEach((rule, position) => {
    const base = `conformance_rules[${position}]`;

    if (rule.kind === "forbid_dataflow") {
      push(
        checkRef(index, {
          path: `${base}.constraint_ref`,
          value: rule.constraint_ref,
          expected: "constraint",
          label: "rule constraint_ref",
        }),
      );
      if (!index.dataClassifications.has(rule.from.data_classification)) {
        issues.push(
          issue(
            "reference_not_found",
            `${base}.from.data_classification`,
            `data classification "${rule.from.data_classification}" is not declared as the input of any workload`,
            { data_classification: rule.from.data_classification },
          ),
        );
      }
      if (rule.unless !== null) {
        rule.unless.passes_through.forEach((step, stepPosition) => {
          push(
            checkRef(index, {
              path: `${base}.unless.passes_through[${stepPosition}].component_ref`,
              value: step.component_ref,
              expected: "architecture_node",
              label: "sanitizer component_ref",
            }),
          );
        });
      }
      return;
    }

    const workloadProblem = checkRef(index, {
      path: `${base}.workload_ref`,
      value: rule.workload_ref,
      expected: "workload",
      label: "rule workload_ref",
    });
    push(workloadProblem);

    if (rule.kind === "approved_candidate_only") {
      if (rule.approved_decision_ref !== null) {
        push(
          checkRef(index, {
            path: `${base}.approved_decision_ref`,
            value: rule.approved_decision_ref,
            expected: "decision",
            label: "approved_decision_ref",
          }),
        );
      }
      return;
    }

    rule.allowed_candidate_refs.forEach((ref, refPosition) => {
      const path = `${base}.allowed_candidate_refs[${refPosition}]`;
      const problem = checkRef(index, {
        path,
        value: ref,
        expected: "candidate",
        label: "allowed candidate",
      });
      if (problem !== null) {
        issues.push(problem);
        return;
      }
      if (workloadProblem !== null) {
        return;
      }
      const candidate = candidateById.get(ref);
      if (
        candidate !== undefined &&
        candidate.workload_ref !== rule.workload_ref
      ) {
        issues.push(
          issue(
            "candidate_workload_mismatch",
            path,
            `candidate "${ref}" serves ${candidate.workload_ref === null ? "no workload" : `workload "${candidate.workload_ref}"`}, but this rule governs workload "${rule.workload_ref}"`,
            {
              candidate: ref,
              candidate_workload: candidate.workload_ref,
              rule_workload: rule.workload_ref,
            },
          ),
        );
      }
    });
  });

  // --- remote intelligence policy ---------------------------------------
  const policy = contract.remote_intelligence_policy;
  const denySet = new Set(policy.default_deny);
  policy.default_allow.forEach((field, position) => {
    if (denySet.has(field)) {
      issues.push(
        issue(
          "remote_policy_conflict",
          `remote_intelligence_policy.default_allow[${position}]`,
          `"${field}" appears in both default_allow and default_deny; the projection would be ambiguous`,
          { field },
        ),
      );
    }
    if (RATIFIED_DEFAULT_DENY.includes(field)) {
      issues.push(
        issue(
          "remote_policy_denied_field_allowed",
          `remote_intelligence_policy.default_allow[${position}]`,
          `"${field}" is default-denied by the ratified projection policy and must not be allowed to remote intelligence; hardware capacity may be shared, machine identity may not`,
          { field },
        ),
      );
    }
  });

  // --- approvals --------------------------------------------------------
  //
  // A stored hash is the whole point of an approval: it is the claim that a
  // named human saw exactly this content. Validation therefore recomputes it
  // rather than trusting the stored value.
  //
  // Only approvals covering a decision's CURRENT revision are re-checked.
  // An approval of an earlier revision is valid history: the decision has
  // moved on, and that entry is reported stale by `approvalState` rather than
  // rejected here. Rewriting or deleting it is what the contract forbids.
  const decisionsById = index.tables.decision as ReadonlyMap<
    string,
    { id: string; revision: number; status: string }
  >;

  let previousApprovedAt: number | null = null;
  contract.approvals.forEach((approval, position) => {
    const base = `approvals[${position}]`;
    const decisionProblem = checkRef(index, {
      path: `${base}.decision_ref`,
      value: approval.decision_ref,
      expected: "decision",
      label: "approval decision_ref",
    });
    push(decisionProblem);

    const approvedAt = Date.parse(approval.approved_at);
    if (previousApprovedAt !== null && approvedAt < previousApprovedAt) {
      issues.push(
        issue(
          "approval_history_not_append_only",
          `${base}.approved_at`,
          "approval history must be append-only and ordered oldest first; this entry predates the one before it",
          { approved_at: approval.approved_at },
        ),
      );
    }
    previousApprovedAt = approvedAt;

    if (decisionProblem !== null) {
      return;
    }
    const decision = decisionsById.get(approval.decision_ref);
    if (
      decision === undefined ||
      approval.decision_revision !== decision.revision
    ) {
      return;
    }

    const resolved = resolveDecision(contract, decision.id);
    if (!resolved.ok) {
      const first = resolved.issues[0];
      issues.push(
        issue(
          "approval_content_unresolved",
          `${base}.content_hash`,
          `this approval covers the current revision of decision "${decision.id}", but its content cannot be resolved: ${first === undefined ? "resolution failed" : first.message}`,
          { decision: decision.id, revision: approval.decision_revision },
        ),
      );
      return;
    }

    const expected = hashApprovalContent(resolved.value.content);
    if (expected !== approval.content_hash) {
      issues.push(
        issue(
          "approval_hash_mismatch",
          `${base}.content_hash`,
          `the resolved content of decision "${decision.id}" revision ${decision.revision} no longer matches this approval; approve the new content or restore what was approved`,
          {
            decision: decision.id,
            revision: decision.revision,
            stored_hash: approval.content_hash,
            resolved_hash: expected,
          },
        ),
      );
    }
  });

  return issues;
}

/**
 * Run every referential-integrity and cross-field invariant over a
 * schema-valid contract. Issues are returned rather than thrown so that a
 * caller sees ALL problems at once instead of only the first.
 */
export function checkIntegrity(contract: ProjectContract): ContractIssue[] {
  const { index, issues } = buildIndex(contract);
  return [...issues, ...checkIntegrityInner(contract, index)];
}

export { buildIndex, checkIntegrityInner, checkRef };
export type { Index, RefCheck };
