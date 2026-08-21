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
/**
 * High-confidence secret shapes. Each is a vendor-published credential format
 * or a structural give-away such as PEM private-key armour.
 */
const SECRET_PATTERNS = [
    {
        name: "pem_private_key",
        pattern: /-----BEGIN (?:[A-Z][A-Z ]* )?PRIVATE KEY-----/,
        explanation: "PEM private-key material",
    },
    {
        name: "openai_style_key",
        pattern: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9]{2}[A-Za-z0-9_-]{18,}/,
        explanation: "an OpenAI/Anthropic-style secret key",
    },
    {
        name: "stripe_key",
        pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/,
        explanation: "a Stripe secret key",
    },
    {
        name: "github_token",
        pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/,
        explanation: "a GitHub access token",
    },
    {
        name: "github_fine_grained_token",
        pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/,
        explanation: "a GitHub fine-grained access token",
    },
    {
        name: "aws_access_key_id",
        pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/,
        explanation: "an AWS access key id",
    },
    {
        name: "google_api_key",
        pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
        explanation: "a Google API key",
    },
    {
        name: "slack_token",
        pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
        explanation: "a Slack token",
    },
    {
        name: "huggingface_token",
        pattern: /\bhf_[A-Za-z0-9]{30,}/,
        explanation: "a Hugging Face access token",
    },
    {
        name: "npm_token",
        pattern: /\bnpm_[A-Za-z0-9]{36}/,
        explanation: "an npm access token",
    },
    {
        name: "json_web_token",
        pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
        explanation: "a JSON Web Token",
    },
    {
        name: "bearer_token",
        pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/,
        explanation: "an inline bearer token",
    },
    {
        name: "url_embedded_credentials",
        pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]{3,}@/,
        explanation: "credentials embedded in a URL",
    },
];
/**
 * Shapes that are references to a credential rather than the credential.
 * These are explicitly permitted by doc 03 section 1.6.
 */
const REFERENCE_PATTERNS = [
    /^[A-Z][A-Z0-9_]*$/, // OPENAI_API_KEY
    /^\$[A-Za-z_][A-Za-z0-9_]*$/, // $OPENAI_API_KEY
    /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/, // ${OPENAI_API_KEY}
    /^env:[A-Za-z_][A-Za-z0-9_]*$/i,
    /^keychain:[\w./-]+$/i,
    /^op:\/\/[\w./-]+$/i, // 1Password
    /^vault:[\w./-]+$/i,
    /^(?:aws-sm|gcp-sm|azure-kv):[\w./-]+$/i,
    /**
     * A descriptive lower_snake_case marker such as
     * `existing_session_or_environment` or `promptfoo_cli`.
     *
     * Each segment must START with letters, which is what stops an opaque
     * base36 credential like `a7f3k9d2m5p8q1w4e6r0` from being waved through as
     * if it were a name. Digits are still allowed inside later segments so that
     * markers like `adapter_v2` remain valid.
     */
    /^[a-z]+(?:_[a-z]+[a-z0-9]*)*$/,
];
/** Field names whose values are expected to carry credential material. */
const CREDENTIAL_CONTEXT = /(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|client[_-]?secret|auth)/i;
/** Shannon entropy in bits per character. */
export function shannonEntropy(value) {
    if (value.length === 0) {
        return 0;
    }
    const counts = new Map();
    for (const character of value) {
        counts.set(character, (counts.get(character) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of counts.values()) {
        const probability = count / value.length;
        entropy -= probability * Math.log2(probability);
    }
    return entropy;
}
function looksLikeReference(value) {
    return REFERENCE_PATTERNS.some((pattern) => pattern.test(value));
}
function looksLikeProse(value) {
    // Real credentials do not contain spaces; sentences do.
    return /\s/.test(value);
}
/**
 * Relative paths, dotted identifiers, and URLs are structure, not entropy.
 * `.anvilmark/runtime/promptfoo` is long and mixes character classes, but it
 * is a directory name; treating it as a credential would make the detector
 * useless in exactly the fields that legitimately hold locators.
 */
function looksLikePathOrLocator(value) {
    return (/^[.@\w-]+(?:[/\\][.@\w-]+)+$/.test(value) ||
        /^[a-z][a-z0-9+.-]*:\/\//.test(value));
}
function hasMixedCharacterClasses(value) {
    let classes = 0;
    if (/[a-z]/.test(value))
        classes += 1;
    if (/[A-Z]/.test(value))
        classes += 1;
    if (/[0-9]/.test(value))
        classes += 1;
    if (/[^A-Za-z0-9]/.test(value))
        classes += 1;
    return classes >= 2;
}
const NOT_A_SECRET = {
    isSecret: false,
    detector: "none",
    explanation: "no credential value detected",
};
/**
 * Decide whether one string value is a secret.
 *
 * `path` supplies field context: an unlabelled 40-character random string is
 * treated as a secret under `credential_ref` but not under `intent.summary`,
 * because context is what separates a key from an artifact hash.
 */
export function classifyValue(value, path) {
    for (const candidate of SECRET_PATTERNS) {
        if (candidate.pattern.test(value)) {
            return {
                isSecret: true,
                detector: candidate.name,
                explanation: `the value looks like ${candidate.explanation}; store a reference such as an environment-variable name or keychain locator instead`,
            };
        }
    }
    if (looksLikeReference(value)) {
        return NOT_A_SECRET;
    }
    // A credential is an opaque token: it carries digits, it is not a path, and
    // it is not a sentence. Requiring a digit is what separates an unlabelled
    // key from a long lower-case identifier.
    const opaqueToken = !looksLikeProse(value) &&
        !looksLikePathOrLocator(value) &&
        value.length >= 20 &&
        /[0-9]/.test(value) &&
        (/[A-Z]/.test(value) || /^[a-z0-9_-]{20,}$/.test(value)) &&
        hasMixedCharacterClasses(value) &&
        shannonEntropy(value) >= 3.5;
    if (CREDENTIAL_CONTEXT.test(path) && opaqueToken) {
        return {
            isSecret: true,
            detector: "high_entropy_in_credential_field",
            explanation: "a high-entropy value in a credential-bearing field looks like a literal credential; store a reference instead",
        };
    }
    return NOT_A_SECRET;
}
/** Walk any parsed document and report every string that looks like a secret. */
export function findSecrets(root, basePath = "") {
    const findings = [];
    const walk = (value, path) => {
        if (typeof value === "string") {
            const verdict = classifyValue(value, path);
            if (verdict.isSecret) {
                findings.push({
                    path: path === "" ? "<root>" : path,
                    detector: verdict.detector,
                    explanation: verdict.explanation,
                });
            }
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
            return;
        }
        if (value !== null && typeof value === "object") {
            for (const [key, member] of Object.entries(value)) {
                walk(member, path === "" ? key : `${path}.${key}`);
            }
        }
    };
    walk(root, basePath);
    return findings;
}
