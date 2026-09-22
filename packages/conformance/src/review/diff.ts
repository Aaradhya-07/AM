import { canonicalJson } from "./canonical.js";
import type { ReviewResult } from "./types.js";

type Loose = { readonly [key: string]: unknown };

/** The parts of a review bundle a comparison reads. */
export interface ReviewSnapshot {
  readonly project: { readonly id: string; readonly contract_hash: string };
  readonly contract: {
    readonly canonical: {
      readonly conformance_rules: readonly ({ readonly id: string } & Loose)[];
      readonly decisions: readonly ({ readonly id: string } & Loose)[];
      readonly constraints: readonly ({ readonly id: string } & Loose)[];
    };
  };
  readonly scan: {
    readonly artifact: {
      readonly configuration?: Loose | undefined;
      readonly repository?:
        | {
            readonly inputs?: readonly { readonly path: string }[] | undefined;
          }
        | undefined;
    } | null;
  };
  readonly report: {
    readonly artifact: {
      readonly results: readonly ReviewResult[];
      readonly scan?: Loose | undefined;
    } | null;
  };
}

/**
 * How one finding moved between snapshots. Only `pass` counts as resolved: a
 * finding that became not applicable, or disappeared, is reported separately
 * because a scope or policy change can cause either.
 */
export type FindingChange =
  "resolved" | "regressed" | "changed" | "unchanged" | "added" | "removed";

export interface FindingDiff {
  /** Stable across line moves: rule, workload, candidate, node, symbol, source. */
  readonly key: string;
  readonly rule_ref: string;
  readonly change: FindingChange;
  readonly base: ReviewResult | null;
  readonly head: ReviewResult | null;
  /** The finding's rule, decision or constraint differs between snapshots. */
  readonly policy_affected: boolean;
}

export interface PolicyDiff {
  readonly contract_changed: boolean;
  readonly rules_added: readonly string[];
  readonly rules_removed: readonly string[];
  readonly rules_changed: readonly string[];
  readonly decisions_changed: readonly string[];
  readonly constraints_changed: readonly string[];
  readonly scan_scope: {
    readonly configuration_changed: boolean;
    readonly repository_root_changed: boolean;
    /** Scanned files that are no longer scanned; deletions also cause this. */
    readonly inputs_removed: readonly string[];
  };
}

export interface ReviewDiff {
  readonly findings: readonly FindingDiff[];
  readonly policy: PolicyDiff;
  /** Any change to contract, rules, decisions, constraints or scan scope. */
  readonly policy_changed: boolean;
  readonly counts: Readonly<Record<FindingChange, number>>;
}

const NOT_PASSING = new Set(["fail", "unknown"]);

function findingKeys(
  results: readonly ReviewResult[],
): Map<string, ReviewResult> {
  const groups = new Map<string, ReviewResult[]>();
  for (const result of results) {
    const key = [
      result.rule_ref,
      result.workload_ref ?? "",
      result.candidate_ref ?? "",
      result.architecture_node_ref ?? "",
      result.locations[0]?.symbol ?? "",
      result.trace[0]?.declaration_ref ?? "",
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  const keyed = new Map<string, ReviewResult>();
  for (const [key, group] of groups) {
    const position = (result: ReviewResult) => {
      const location = result.locations[0];
      return [location?.path ?? "", location?.start.line ?? 0] as const;
    };
    const ordered = [...group].sort((a, b) => {
      const [leftPath, leftLine] = position(a);
      const [rightPath, rightLine] = position(b);
      if (leftPath !== rightPath) return leftPath < rightPath ? -1 : 1;
      return leftLine - rightLine;
    });
    ordered.forEach((result, index) =>
      keyed.set(group.length === 1 ? key : `${key}#${index + 1}`, result),
    );
  }
  return keyed;
}

function classify(
  base: ReviewResult | null,
  head: ReviewResult | null,
): FindingChange {
  if (!base) return "added";
  if (!head) return "removed";
  if (base.verdict === head.verdict) return "unchanged";
  if (NOT_PASSING.has(base.verdict) && head.verdict === "pass")
    return "resolved";
  if (!NOT_PASSING.has(base.verdict) && NOT_PASSING.has(head.verdict)) {
    return "regressed";
  }
  return "changed";
}

function changedIds(
  base: readonly ({ readonly id: string } & Loose)[],
  head: readonly ({ readonly id: string } & Loose)[],
) {
  const before = new Map(base.map((entry) => [entry.id, canonicalJson(entry)]));
  const after = new Map(head.map((entry) => [entry.id, canonicalJson(entry)]));
  const added = [...after.keys()].filter((id) => !before.has(id)).sort();
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort();
  const changed = [...after.keys()]
    .filter((id) => before.has(id) && before.get(id) !== after.get(id))
    .sort();
  return { added, removed, changed };
}

export function diffPolicy(
  base: ReviewSnapshot,
  head: ReviewSnapshot,
): PolicyDiff {
  const rules = changedIds(
    base.contract.canonical.conformance_rules,
    head.contract.canonical.conformance_rules,
  );
  const decisions = changedIds(
    base.contract.canonical.decisions,
    head.contract.canonical.decisions,
  );
  const constraints = changedIds(
    base.contract.canonical.constraints,
    head.contract.canonical.constraints,
  );

  const scopeOf = (snapshot: ReviewSnapshot) => {
    const configuration = snapshot.scan.artifact?.configuration;
    return {
      configuration:
        configuration === undefined
          ? null
          : canonicalJson({
              normalized_sha256: configuration.normalized_sha256,
              include: configuration.include,
              exclude: configuration.exclude,
              recognizers: configuration.recognizers,
            }),
      root: snapshot.report.artifact?.scan?.repository_root ?? null,
      inputs: new Set(
        (snapshot.scan.artifact?.repository?.inputs ?? []).map(
          (input) => input.path,
        ),
      ),
    };
  };
  const before = scopeOf(base);
  const after = scopeOf(head);

  return {
    contract_changed: base.project.contract_hash !== head.project.contract_hash,
    rules_added: rules.added,
    rules_removed: rules.removed,
    rules_changed: rules.changed,
    decisions_changed: [
      ...decisions.added,
      ...decisions.removed,
      ...decisions.changed,
    ].sort(),
    constraints_changed: [
      ...constraints.added,
      ...constraints.removed,
      ...constraints.changed,
    ].sort(),
    scan_scope: {
      configuration_changed:
        before.configuration !== null &&
        after.configuration !== null &&
        before.configuration !== after.configuration,
      repository_root_changed:
        before.root !== null &&
        after.root !== null &&
        before.root !== after.root,
      inputs_removed: [...before.inputs]
        .filter((path) => !after.inputs.has(path))
        .sort(),
    },
  };
}

export function policyChanged(policy: PolicyDiff): boolean {
  return (
    policy.contract_changed ||
    policy.rules_added.length > 0 ||
    policy.rules_removed.length > 0 ||
    policy.rules_changed.length > 0 ||
    policy.decisions_changed.length > 0 ||
    policy.constraints_changed.length > 0 ||
    policy.scan_scope.configuration_changed ||
    policy.scan_scope.repository_root_changed
  );
}

/**
 * Compare two review snapshots of the same project: how each finding moved,
 * and whether the policy that produced the findings changed.
 */
export function diffReviewBundles(
  base: ReviewSnapshot,
  head: ReviewSnapshot,
): ReviewDiff {
  const policy = diffPolicy(base, head);
  const affectedRules = new Set([
    ...policy.rules_added,
    ...policy.rules_removed,
    ...policy.rules_changed,
  ]);
  const affectedDecisions = new Set(policy.decisions_changed);
  const affectedConstraints = new Set(policy.constraints_changed);

  const before = findingKeys(base.report.artifact?.results ?? []);
  const after = findingKeys(head.report.artifact?.results ?? []);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();

  const findings = keys.map((key): FindingDiff => {
    const baseResult = before.get(key) ?? null;
    const headResult = after.get(key) ?? null;
    const either = (headResult ?? baseResult) as ReviewResult;
    return {
      key,
      rule_ref: either.rule_ref,
      change: classify(baseResult, headResult),
      base: baseResult,
      head: headResult,
      policy_affected:
        affectedRules.has(either.rule_ref) ||
        (either.decision_ref
          ? affectedDecisions.has(either.decision_ref)
          : false) ||
        (either.constraint_ref
          ? affectedConstraints.has(either.constraint_ref)
          : false),
    };
  });

  const counts: Record<FindingChange, number> = {
    resolved: 0,
    regressed: 0,
    changed: 0,
    unchanged: 0,
    added: 0,
    removed: 0,
  };
  for (const finding of findings) counts[finding.change] += 1;

  return { findings, policy, policy_changed: policyChanged(policy), counts };
}
