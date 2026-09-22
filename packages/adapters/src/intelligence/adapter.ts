import type { Constraint, ProjectContract } from "@anvilmark/project-contract";
import { compareCodeUnits } from "@anvilmark/project-contract";

import type {
  AdapterError,
  AdapterIdentity,
  AdapterOutcome,
} from "../envelope.js";
import { adapterError } from "../envelope.js";
import type { IntelligenceProposal, IntelligenceRequest } from "./proposal.js";
import { IntelligenceProposalSchema } from "./proposal.js";
import type { OutboundProjection } from "./projection.js";

export interface IntelligenceCapabilities {
  readonly clarify_intent: boolean;
  readonly propose_constraints: boolean;
  readonly propose_candidates: boolean;
  readonly explain_tradeoffs: boolean;
  readonly propose_architecture: boolean;
}

/**
 * The provider-neutral intelligence interface.
 *
 * Claude Code, Codex, a user-supplied API endpoint, an OpenAI-compatible
 * endpoint, and a local runtime all implement this same shape. Nothing
 * downstream branches on which one is installed, and there is no ANVILMARK
 * default: if the user has selected no intelligence, there is simply no
 * adapter, and the workflow continues with whatever deterministic facts exist.
 */
export interface IntelligenceAdapter {
  readonly identity: AdapterIdentity;
  readonly capabilities: IntelligenceCapabilities;

  /** The exact payload this adapter would receive. Shown before sending. */
  describeProjection(contract: ProjectContract): OutboundProjection;

  /** Ask for a proposal. Never for a decision. */
  propose(
    request: IntelligenceRequest,
    options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
  ): Promise<AdapterOutcome<IntelligenceProposal>>;
}

export interface ProposalReview {
  readonly accepted: boolean;
  readonly errors: readonly AdapterError[];
  readonly proposal: IntelligenceProposal | null;
}

/**
 * Parse a document against the intelligence proposal schema alone.
 *
 * This is the contract-independent half of `reviewProposal`, shared so that
 * every intelligence mechanism reports a malformed or overreaching response in
 * exactly the same terms. It never inspects the project contract; callers that
 * are about to apply a proposal must still run `reviewProposal`.
 */
export function parseProposalDocument(
  raw: unknown,
):
  | { readonly ok: true; readonly proposal: IntelligenceProposal }
  | { readonly ok: false; readonly errors: readonly AdapterError[] } {
  const parsed = IntelligenceProposalSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, proposal: parsed.data };
  }
  const forbidden = parsed.error.issues
    .filter((entry) => entry.code === "unrecognized_keys")
    .flatMap((entry) => ("keys" in entry ? (entry.keys as string[]) : []))
    .sort(compareCodeUnits);
  const problems = parsed.error.issues
    .slice(0, 20)
    .map(
      (entry) =>
        `${entry.path.length === 0 ? "<proposal>" : entry.path.join(".")}: ${entry.message}`,
    );
  return {
    ok: false,
    errors: [
      adapterError(
        forbidden.length > 0 ? "forbidden_proposal" : "schema_rejected",
        forbidden.length > 0
          ? `an intelligence adapter may not supply ${forbidden.join(", ")}; adapters propose, they do not decide`
          : "the proposal did not match the adapter protocol",
        { fields: forbidden, problems },
      ),
    ],
  };
}

/**
 * Check a proposal against the boundaries an adapter may not cross.
 *
 * Two of these are enforced by the schema and repeated here only for the
 * error message; the third cannot be: whether a suggestion would weaken a
 * constraint depends on the contract, not on the proposal alone.
 *
 *   - An adapter may not approve anything. `approvals` is not a field the
 *     proposal schema defines, so it is rejected as unrecognised.
 *   - An adapter may not label its own output as measured. `kind` on an
 *     inference is the literal `agent_inference`.
 *   - An adapter may not touch an existing HARD constraint. Reusing the id of
 *     a hard constraint is refused outright, because a proposal that redefines
 *     a gate is indistinguishable from one that weakens it.
 */
export function reviewProposal(
  contract: ProjectContract,
  raw: unknown,
): ProposalReview {
  const parsed = parseProposalDocument(raw);
  if (!parsed.ok) {
    return { accepted: false, proposal: null, errors: parsed.errors };
  }

  const proposal = parsed.proposal;
  const hardById = new Map<string, Constraint>(
    contract.constraints
      .filter((entry) => entry.severity === "hard")
      .map((entry) => [entry.id, entry]),
  );

  const collisions = proposal.proposed_constraints
    .filter((entry) => hardById.has(entry.id))
    .map((entry) => entry.id)
    .sort(compareCodeUnits);

  if (collisions.length > 0) {
    return {
      accepted: false,
      proposal: null,
      errors: [
        adapterError(
          "forbidden_proposal",
          `an intelligence adapter may not redefine the hard constraint(s) ${collisions.join(", ")}; hard constraints are the user's and only the user can change them`,
          { constraints: collisions },
        ),
      ],
    };
  }

  return { accepted: true, proposal, errors: [] };
}
