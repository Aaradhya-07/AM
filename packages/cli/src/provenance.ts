import type { HistoryEntry, LoadedProject } from "./store.js";

/**
 * The record of a proposal applied in a state revision.
 *
 * It is written ONLY inside the history metadata, before `project.yaml` is
 * replaced. The proposal is accepted exactly when that state revision is on the
 * committed chain: no record claims acceptance for a change that never reached
 * the project, and no committed change lacks its record.
 */
export interface AppliedProposalRecord {
  readonly format: "anvilmark-intelligence-proposal/0.1";
  /** Contained in this state revision; accepted only if it is on the committed chain. */
  readonly outcome: "applied";
  readonly proposal_id: string;
  readonly request_id: string;
  readonly request_digest: string;
  readonly received_at: string;
  readonly adapter: {
    readonly id: string;
    readonly execution: string;
    readonly version: string | null;
  };
  readonly raw_result_hash: string | null;
  readonly consent: unknown;
  readonly added: {
    readonly constraints: readonly string[];
    readonly candidates: readonly string[];
    readonly questions: readonly string[];
    readonly inferences: readonly string[];
    /** Protocol draft.2 only; absent from records written before it. */
    readonly architecture_nodes?: readonly string[];
    readonly relationships?: readonly string[];
    readonly decision_bindings?: readonly string[];
  };
  readonly proposal: {
    readonly rationale: {
      readonly summary: string;
      readonly generated_by: string;
    } | null;
    readonly proposed_candidates: readonly {
      readonly id: string;
      readonly rationale: string | null;
    }[];
  };
}

export interface CommittedProposal {
  readonly entry: HistoryEntry;
  readonly record: AppliedProposalRecord;
}

function appliedRecords(
  entries: readonly HistoryEntry[],
): readonly CommittedProposal[] {
  return entries.flatMap((entry) => {
    const record = (entry.provenance as { record?: unknown } | null)?.record as
      AppliedProposalRecord | undefined;
    return record !== undefined && record.outcome === "applied"
      ? [{ entry, record }]
      : [];
  });
}

/**
 * Accepted proposals: those applied in a COMMITTED revision, oldest first.
 *
 * Committed standing comes from `classifyHistory`, never from being the newest
 * file. A snapshot left by a failed commit, or one whose standing is ambiguous,
 * contributes nothing here, however project.yaml was edited afterwards.
 */
export async function committedProposals(
  loaded: Pick<LoadedProject, "history">,
): Promise<readonly CommittedProposal[]> {
  return appliedRecords(loaded.history.committed);
}

/** Proposals applied in a revision whose commit standing is ambiguous. */
export function ambiguousProposals(
  loaded: Pick<LoadedProject, "history">,
): readonly CommittedProposal[] {
  return appliedRecords(loaded.history.ambiguous);
}

export interface CandidateOrigin {
  readonly proposal_id: string;
  readonly adapter_id: string;
  readonly state_revision: number;
  /** Generated prose: provenance, never evidence. */
  readonly rationale: string | null;
}

/** Which accepted proposal, if any, added each candidate. */
export async function candidateOrigins(
  loaded: Pick<LoadedProject, "history">,
): Promise<ReadonlyMap<string, CandidateOrigin>> {
  const origins = new Map<string, CandidateOrigin>();
  for (const { entry, record } of await committedProposals(loaded)) {
    for (const id of record.added.candidates) {
      const proposed = record.proposal.proposed_candidates.find(
        (candidate) => candidate.id === id,
      );
      origins.set(id, {
        proposal_id: record.proposal_id,
        adapter_id: record.adapter.id,
        state_revision: entry.revision,
        rationale: proposed?.rationale ?? null,
      });
    }
  }
  return origins;
}

export type ArchitectureElementKind = "node" | "relationship" | "binding";

export type ProposalProvenanceCheck =
  | {
      readonly ok: true;
      readonly entry: HistoryEntry;
      readonly record: AppliedProposalRecord;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Verify that `proposalRef` names a proposal applied in a COMMITTED state
 * revision whose record lists this element.
 *
 * Only committed standing counts. A proposal found only in an ambiguous,
 * abandoned or uncommitted revision, or not found at all, or whose record does
 * not list the element, does not establish provenance.
 */
export function verifyArchitectureProvenance(
  loaded: Pick<LoadedProject, "history">,
  proposalRef: string,
  element: { readonly kind: ArchitectureElementKind; readonly id: string },
): ProposalProvenanceCheck {
  const listed = (record: AppliedProposalRecord): readonly string[] =>
    element.kind === "node"
      ? (record.added.architecture_nodes ?? [])
      : element.kind === "relationship"
        ? (record.added.relationships ?? [])
        : (record.added.decision_bindings ?? []);
  const committed = appliedRecords(loaded.history.committed).find(
    (candidate) => candidate.record.proposal_id === proposalRef,
  );
  if (committed !== undefined) {
    return listed(committed.record).includes(element.id)
      ? { ok: true, entry: committed.entry, record: committed.record }
      : {
          ok: false,
          reason: `proposal "${proposalRef}" was applied in committed revision r${committed.entry.revision}, but its record does not list ${element.kind} "${element.id}"`,
        };
  }
  if (
    appliedRecords(loaded.history.ambiguous).some(
      (candidate) => candidate.record.proposal_id === proposalRef,
    )
  ) {
    return {
      ok: false,
      reason: `proposal "${proposalRef}" is recorded only in a revision whose commit standing is ambiguous; resolve it with "anvilmark history resolve" first`,
    };
  }
  const uncommitted = loaded.history.revisions.find(
    (revision) =>
      revision.standing !== "committed" &&
      (revision.entry.provenance as { record?: AppliedProposalRecord } | null)
        ?.record?.proposal_id === proposalRef,
  );
  if (uncommitted !== undefined) {
    return {
      ok: false,
      reason: `proposal "${proposalRef}" is recorded only in revision r${uncommitted.entry.revision}, which is ${uncommitted.standing}; it was never accepted`,
    };
  }
  return {
    ok: false,
    reason: `no committed state revision records proposal "${proposalRef}"`,
  };
}
