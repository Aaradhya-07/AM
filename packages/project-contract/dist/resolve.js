import { compareCodeUnits } from "./canonical.js";
import { fail, issue, ok } from "./errors.js";
/**
 * Resolve everything an approval of `decisionId` would cover.
 *
 * Missing referenced content prevents resolution: a decision cannot be
 * approved when its selected candidate, one of its cited evidence records, or
 * a constraint result it claims to satisfy cannot be found.
 */
export function resolveDecision(contract, decisionId) {
    const decision = contract.decisions.find((entry) => entry.id === decisionId);
    if (decision === undefined) {
        return fail([
            issue("reference_not_found", "decisions", `no decision with id "${decisionId}" exists in this contract`, { decision: decisionId }),
        ]);
    }
    const issues = [];
    const base = `decisions[${contract.decisions.indexOf(decision)}]`;
    if (decision.selected_candidate_ref === null) {
        return fail([
            issue("approval_content_unresolved", `${base}.selected_candidate_ref`, `decision "${decisionId}" selects no candidate, so there is no resolved content to approve`, { decision: decisionId }),
        ]);
    }
    const selected = contract.candidates.find((entry) => entry.id === decision.selected_candidate_ref);
    if (selected === undefined) {
        issues.push(issue("approval_content_unresolved", `${base}.selected_candidate_ref`, `selected candidate "${decision.selected_candidate_ref}" is missing, so the approved content cannot be resolved`, { decision: decisionId, candidate: decision.selected_candidate_ref }));
    }
    const constraintResults = [];
    if (selected !== undefined) {
        for (const constraintRef of decision.satisfies_constraints) {
            const result = selected.constraint_results.find((entry) => entry.constraint_ref === constraintRef);
            if (result === undefined) {
                issues.push(issue("approval_content_unresolved", `${base}.satisfies_constraints`, `decision "${decisionId}" claims constraint "${constraintRef}" is satisfied, but the selected candidate records no result for it`, { decision: decisionId, constraint: constraintRef }));
                continue;
            }
            constraintResults.push(result);
        }
    }
    // Close over every record the approval actually relies on, not merely the
    // ones the decision happened to list.
    const reliedUpon = new Set(decision.evidence_refs);
    for (const result of constraintResults) {
        for (const ref of result.evidence_refs) {
            reliedUpon.add(ref);
        }
    }
    const citedEvidence = [];
    for (const ref of [...reliedUpon].sort(compareCodeUnits)) {
        const record = contract.evidence_refs.find((entry) => entry.id === ref);
        if (record === undefined) {
            issues.push(issue("approval_content_unresolved", `${base}.evidence_refs`, `evidence "${ref}" relied on by this decision is missing, so the approved content cannot be resolved`, { decision: decisionId, evidence: ref }));
            continue;
        }
        citedEvidence.push(record);
    }
    if (issues.length > 0 || selected === undefined) {
        return fail(issues);
    }
    return ok({
        decision,
        content: {
            decision_id: decision.id,
            decision_revision: decision.revision,
            selected_candidate: selected,
            cited_evidence: [...citedEvidence].sort((left, right) => compareCodeUnits(left.id, right.id)),
            constraint_results: [...constraintResults].sort((left, right) => compareCodeUnits(left.constraint_ref, right.constraint_ref)),
        },
    });
}
