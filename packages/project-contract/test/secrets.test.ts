import { describe, expect, it } from "vitest";

import {
  classifyValue,
  findSecrets,
  validateProjectContract,
} from "../src/index.js";
import { at, baseDocument } from "./helpers.js";

/**
 * Every literal below is a syntactically shaped but non-functional example
 * constructed for this test. None is a real credential.
 */
const SECRET_VALUES: readonly [string, string][] = [
  ["an OpenAI-style key", "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD"],
  [
    "an Anthropic-style key",
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
  ],
  ["a GitHub token", `ghp_${"a1B2c3D4e5".repeat(4)}`],
  ["a GitHub fine-grained token", `github_pat_${"aB3".repeat(10)}`],
  ["an AWS access key id", "AKIAIOSFODNN7EXAMPLE"],
  [
    "a Google API key",
    `AIza${"aB3cD4eF5gH6iJ7kL8mN9oP0qR1sT2uV3w".slice(0, 35)}`,
  ],
  ["a Slack token", "xoxb-123456789012-abcdefghijklmnop"],
  ["a Hugging Face token", `hf_${"aBcDeFgHiJ".repeat(4)}`],
  ["a Stripe secret key", "sk_live_abcdefghijklmnop1234567890"],
  ["an npm token", `npm_${"a1b2c3d4e5f6g7h8i9j0".padEnd(36, "x")}`],
  [
    "a JSON Web Token",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQabcdefghij",
  ],
  ["an inline bearer token", "Bearer abcdefghijklmnopqrstuvwxyz0123456789"],
  [
    "credentials embedded in a URL",
    "https://admin:hunter2pass@example.invalid/api",
  ],
  [
    "PEM private-key material",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
  ],
];

const SAFE_VALUES: readonly [string, string][] = [
  ["an environment-variable name", "OPENAI_API_KEY"],
  ["another environment-variable name", "ANTHROPIC_API_KEY"],
  ["a shell-style reference", "$OPENAI_API_KEY"],
  ["a braced reference", "${OPENAI_API_KEY}"],
  ["an env-prefixed reference", "env:OPENAI_API_KEY"],
  ["a keychain reference", "keychain:anvilmark/openai"],
  ["a 1Password reference", "op://vault/item/credential"],
  ["a vault reference", "vault:secret/data/anvilmark"],
  ["an AWS secrets-manager reference", "aws-sm:anvilmark/api-key"],
  ["a descriptive session marker", "existing_session_or_environment"],
  ["prose that merely mentions a secret", "Never write the secret to disk."],
  [
    "documentation naming an environment variable",
    "Set OPENAI_API_KEY in your shell before running the adapter.",
  ],
  ["a policy sentence about tokens", "The token budget is measured per call."],
  [
    "a password policy sentence",
    "The password must never appear in the contract.",
  ],
  ["a plain adapter name", "promptfoo_cli"],
  ["a relative data directory", ".anvilmark/runtime/promptfoo"],
];

describe("credential values are rejected", () => {
  it.each(SECRET_VALUES)("rejects %s", (_name, value) => {
    const verdict = classifyValue(value, "integrations[0].credential_ref");

    expect(verdict.isSecret).toBe(true);
    expect(verdict.explanation).toMatch(/reference/);
  });
});

describe("credential references and ordinary text are accepted", () => {
  it.each(SAFE_VALUES)("accepts %s", (_name, value) => {
    expect(
      classifyValue(value, "integrations[0].credential_ref").isSecret,
    ).toBe(false);
  });

  it("does not flag hashes stored in non-credential fields", () => {
    expect(
      classifyValue("a".repeat(64), "approvals[0].content_hash").isSecret,
    ).toBe(false);
    expect(
      classifyValue(
        "cfg-9f8a7b6c5d4e",
        "evidence_refs[0].value.configuration_hash",
      ).isSecret,
    ).toBe(false);
  });

  it("does flag unlabelled high-entropy material in a credential field", () => {
    const verdict = classifyValue(
      "T0k3n-9f8A7b6C5d4E3f2A1b0C9d8E7f",
      "integrations[0].credential_ref",
    );

    expect(verdict.isSecret).toBe(true);
    expect(verdict.detector).toBe("high_entropy_in_credential_field");
  });

  it("does not flag an unlabelled lower-case identifier without digits", () => {
    expect(
      classifyValue(
        "promptfoo_evaluation_adapter",
        "integrations[0].credential_ref",
      ).isSecret,
    ).toBe(false);
  });

  it("does flag an unlabelled lower-case hex credential", () => {
    expect(
      classifyValue(
        "9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c",
        "integrations[0].credential_ref",
      ).isSecret,
    ).toBe(true);
  });

  it("does not flag the same material outside a credential field", () => {
    expect(
      classifyValue("T0k3n-9f8A7b6C5d4E3f2A1b0C9d8E7f", "intent.summary")
        .isSecret,
    ).toBe(false);
  });
});

describe("secret scanning over a whole contract", () => {
  it("finds nothing in the base document", () => {
    expect(findSecrets(baseDocument())).toEqual([]);
  });

  it("rejects a contract that stores a key in a credential reference", () => {
    const document = baseDocument();
    at(document, "integrations", 0).credential_ref =
      "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const match = result.issues.find(
      (entry) => entry.code === "secret_value_detected",
    );
    expect(match?.path).toBe("integrations[0].credential_ref");
    expect(match?.details).toMatchObject({ detector: "openai_style_key" });
  });

  it("rejects a key hidden anywhere else in the contract", () => {
    const document = baseDocument();
    at(document, "intent").summary =
      "Use AKIAIOSFODNN7EXAMPLE for the classification workload.";

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (entry) =>
          entry.code === "secret_value_detected" &&
          entry.path === "intent.summary",
      ),
    ).toBe(true);
  });

  it("accepts a contract whose integration names an environment variable", () => {
    const document = baseDocument();
    at(document, "integrations", 0).credential_ref = "OPENAI_API_KEY";

    expect(validateProjectContract(document).ok).toBe(true);
  });

  it("reports the path of every finding", () => {
    const findings = findSecrets({
      nested: { list: ["AKIAIOSFODNN7EXAMPLE"] },
    });

    expect(findings[0]?.path).toBe("nested.list[0]");
  });
});

/**
 * The descriptive lower_snake_case reference rule used to be
 * `/^[a-z][a-z0-9_]*$/`, which matched any opaque lowercase base36 string and
 * cleared it before the entropy check could run.
 */
describe("opaque lowercase values cannot pose as descriptive references", () => {
  const OPAQUE: readonly [string, string][] = [
    ["a 32-character base36 blob", "a7f3k9d2m5p8q1w4e6r0t3y5u7i9o2p4"],
    ["a 24-character base36 blob", "k3j5h7g9f2d4s6a8z1x3c5v7"],
    ["a 20-character base36 blob", "q1w2e3r4t5y6u7i8o9p0"],
    ["an underscored opaque blob", "tok_9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b"],
  ];

  it.each(OPAQUE)("rejects %s in a credential field", (_name, value) => {
    expect(
      classifyValue(value, "integrations[0].credential_ref").isSecret,
    ).toBe(true);
  });

  const NAMED: readonly [string, string][] = [
    ["existing_session_or_environment", "existing_session_or_environment"],
    ["env:OPENAI_API_KEY", "env:OPENAI_API_KEY"],
    ["keychain:anvilmark/openai", "keychain:anvilmark/openai"],
    ["vault:secret/data/anvilmark", "vault:secret/data/anvilmark"],
    ["op://vault/item/credential", "op://vault/item/credential"],
    ["user_selected", "user_selected"],
    ["promptfoo_cli", "promptfoo_cli"],
    ["a versioned adapter marker", "adapter_v2"],
  ];

  it.each(NAMED)("still accepts %s", (_name, value) => {
    expect(
      classifyValue(value, "integrations[0].credential_ref").isSecret,
    ).toBe(false);
  });

  it("rejects an opaque credential stored in a whole contract", () => {
    const document = baseDocument();
    at(document, "integrations", 0).credential_ref =
      "a7f3k9d2m5p8q1w4e6r0t3y5u7i9o2p4";

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (entry) =>
          entry.code === "secret_value_detected" &&
          entry.path === "integrations[0].credential_ref",
      ),
    ).toBe(true);
  });
});
