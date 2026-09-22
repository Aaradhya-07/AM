import type { AdapterIdentity, AdapterOutcome } from "../envelope.js";
import type { BuiltEvidence } from "./builder.js";

/** What a probe establishes about an optional tool before it is used. */
export interface AdapterProbe {
  /** The exact version reported by the tool itself. */
  readonly version: string;
  readonly capabilities: readonly string[];
}

/**
 * The interface every evidence source implements.
 *
 * Optional tools, manual imports, and future integrations are all reached
 * through this one shape, so nothing downstream needs to know which of them
 * produced a record. An adapter never writes the contract: it returns an
 * outcome, and the caller decides whether to attach the evidence.
 */
export interface EvidenceAdapter<Request, Value = BuiltEvidence> {
  readonly identity: AdapterIdentity;

  /**
   * Establish whether the tool is present and usable.
   *
   * A missing tool answers `unavailable`, which is an evidence gap. It is not
   * an error, and ANVILMARK continues without it.
   */
  probe(options?: {
    readonly signal?: AbortSignal;
  }): Promise<AdapterOutcome<AdapterProbe>>;

  /** Collect one piece of evidence. */
  collect(
    request: Request,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AdapterOutcome<Value>>;
}
