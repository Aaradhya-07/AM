/**
 * Secret rejection.
 *
 * A persistent contract may hold credential REFERENCES but never credential
 * VALUES. The detector is deliberately shaped to avoid the two failure modes
 * that make such checks useless in practice:
 *
 *   - rejecting harmless text merely because it contains the word "secret",
 *     names an environment variable, or documents a credential; and
 *   - accepting a real key because it did not match one narrow vendor pattern.
 *
 * Order of decision: a known secret SHAPE always wins, then a known reference
 * shape clears the value, then a context-plus-entropy heuristic catches
 * unlabelled high-entropy material in credential-bearing fields.
 */
export interface SecretFinding {
    readonly path: string;
    readonly detector: string;
    readonly explanation: string;
}
/** Shannon entropy in bits per character. */
export declare function shannonEntropy(value: string): number;
export interface SecretVerdict {
    readonly isSecret: boolean;
    readonly detector: string;
    readonly explanation: string;
}
/**
 * Decide whether one string value is a secret.
 *
 * `path` supplies field context: an unlabelled 40-character random string is
 * treated as a secret under `credential_ref` but not under `intent.summary`,
 * because context is what separates a key from an artifact hash.
 */
export declare function classifyValue(value: string, path: string): SecretVerdict;
/** Walk any parsed document and report every string that looks like a secret. */
export declare function findSecrets(root: unknown, basePath?: string): SecretFinding[];
//# sourceMappingURL=secrets.d.ts.map