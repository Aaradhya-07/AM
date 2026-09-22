import type { Clock } from "../clock.js";
import { systemClock } from "../clock.js";

/**
 * Exactly what one outbound send would be, as the adapter computes it at the
 * moment of sending. Consent is checked against THIS, never against anything a
 * request or a caller claims.
 */
export interface OutboundAttempt {
  readonly provider_id: string;
  readonly destination: string;
  /** `sha256:` over the trusted registration the adapter was constructed with. */
  readonly registration_digest: string;
  /** `sha256:` over the exact request about to be serialised and sent. */
  readonly request_digest: string;
}

/**
 * What the user was shown and agreed to. Recorded as provenance, never as a
 * reusable authorization: it carries no capability.
 */
export interface OutboundConsentRecord extends OutboundAttempt {
  readonly granted_at: string;
}

/**
 * Verifies an attempt against consent granted in THIS process.
 *
 * Handed to an adapter when it is constructed. The adapter asks; it cannot
 * mint. There is no serialised form that satisfies it, so an object inside a
 * request, a project file or a proposal can never stand in for consent.
 */
export interface OutboundConsentVerifier {
  /** Null when a matching, unused, unexpired grant exists (and consumes it). */
  consume(attempt: OutboundAttempt): string | null;
}

export interface OutboundConsentStore {
  readonly verifier: OutboundConsentVerifier;
  /**
   * Record that the user agreed to exactly this attempt. Called by the
   * interactive host flow after it has displayed the disclosure and the user
   * has answered yes -- and by nothing else.
   */
  grant(attempt: OutboundAttempt): OutboundConsentRecord;
}

export const DEFAULT_CONSENT_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * An in-memory, single-use, time-limited consent store.
 *
 * A grant matches only the same provider, destination, registration digest and
 * request digest: a change to the payload, the destination, the model, the
 * credential name or any other registered setting produces a different digest
 * and needs new consent. Each grant is consumed by the first send it matches,
 * so a retry is a new decision.
 *
 * This is consent to SEND, and it is deliberately unrelated to approving a
 * decision: nothing here can record or imply an approval.
 */
export function createOutboundConsentStore(
  options: { readonly clock?: Clock; readonly maxAgeMs?: number } = {},
): OutboundConsentStore {
  const clock = options.clock ?? systemClock;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_CONSENT_MAX_AGE_MS;
  const grants: { record: OutboundConsentRecord; used: boolean }[] = [];

  const same = (left: OutboundAttempt, right: OutboundAttempt): boolean =>
    left.provider_id === right.provider_id &&
    left.destination === right.destination &&
    left.registration_digest === right.registration_digest &&
    left.request_digest === right.request_digest;

  return {
    grant(attempt) {
      const record: OutboundConsentRecord = Object.freeze({
        provider_id: attempt.provider_id,
        destination: attempt.destination,
        registration_digest: attempt.registration_digest,
        request_digest: attempt.request_digest,
        granted_at: clock(),
      });
      grants.push({ record, used: false });
      return record;
    },
    verifier: Object.freeze({
      consume(attempt: OutboundAttempt): string | null {
        const now = Date.parse(clock());
        const matching = grants.filter((entry) => same(entry.record, attempt));
        if (matching.length === 0) {
          return grants.some(
            (entry) => entry.record.provider_id === attempt.provider_id,
          )
            ? "consent was given for different content, destination or provider configuration; the exact request must be shown and agreed to again"
            : "no consent has been given in this session for sending this request to this provider";
        }
        const usable = matching.find((entry) => {
          const granted = Date.parse(entry.record.granted_at);
          return (
            !entry.used &&
            Number.isFinite(granted) &&
            Number.isFinite(now) &&
            granted <= now &&
            now - granted <= maxAgeMs
          );
        });
        if (usable === undefined) {
          return matching.every((entry) => entry.used)
            ? "the consent for this request was already used; each send needs its own consent"
            : "the consent for this request has expired; review and agree again";
        }
        usable.used = true;
        return null;
      },
    }),
  };
}
