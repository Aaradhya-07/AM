import { effectiveFloor, floorSubjectForConstraint } from "./evidence-tiers.js";
/**
 * Report where the contract honestly lacks evidence.
 *
 * A gap is not an error. A quality gate whose evaluation has not been run yet
 * is the expected state of a draft contract; what matters is that the gap is
 * visible and that the missing evidence yields `unknown` rather than `pass`.
 */
export function listEvidenceGaps(contract) {
    const gaps = [];
    const evidenceIds = new Set(contract.evidence_refs.map((entry) => entry.id));
    contract.workloads.forEach((workload, position) => {
        workload.quality_gates.forEach((gate, gatePosition) => {
            if (evidenceIds.has(gate.evaluation_ref)) {
                return;
            }
            gaps.push({
                subject: `workload.${workload.id}.metric.${gate.metric}`,
                path: `workloads[${position}].quality_gates[${gatePosition}].evaluation_ref`,
                reason: `evaluation "${gate.evaluation_ref}" has not produced an evidence record yet, so this gate resolves to unknown`,
                requiredFloor: effectiveFloor(contract.evidence_policy, "workload_quality_hard_gate"),
            });
        });
    });
    const resultsByConstraint = new Set();
    for (const candidate of contract.candidates) {
        for (const result of candidate.constraint_results) {
            resultsByConstraint.add(result.constraint_ref);
        }
    }
    contract.constraints.forEach((constraint, position) => {
        if (constraint.severity !== "hard") {
            return;
        }
        if (resultsByConstraint.has(constraint.id)) {
            return;
        }
        const floorSubject = floorSubjectForConstraint(constraint);
        gaps.push({
            subject: constraint.subject,
            path: `constraints[${position}]`,
            reason: `no candidate records a result for hard constraint "${constraint.id}", so it resolves to unknown`,
            requiredFloor: floorSubject === null
                ? null
                : effectiveFloor(contract.evidence_policy, floorSubject),
        });
    });
    return gaps;
}
