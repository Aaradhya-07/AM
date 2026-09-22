import { describe, expect, it } from "vitest";

import {
  adapterError,
  containsSecret,
  sanitizeStructured,
  sanitizeText,
  structuredContainsSecret,
} from "../src/index.js";

/** Syntactically shaped, non-functional examples constructed for this test. */
const OPENAI = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
const GITHUB = "ghp_a1B2c3D4e5a1B2c3D4e5a1B2c3D4e5a1B2c3";
const AWS = "AKIAIOSFODNN7EXAMPLE";

describe("sanitizing untrusted tool output", () => {
  it("redacts vendor-shaped keys anywhere in the text", () => {
    const { text, redactions } = sanitizeText(`connecting with ${OPENAI} now`);

    expect(text).not.toContain(OPENAI);
    expect(text).toContain("[redacted:openai_style_key]");
    expect(redactions[0]?.detector).toBe("openai_style_key");
  });

  it("redacts multi-line private key material", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----";
    const { text } = sanitizeText(`loaded key:\n${pem}\ndone`);

    expect(text).not.toContain("MIIEpQIBAAKCAQEA");
    expect(text).toContain("[redacted:pem_private_key]");
    expect(text).toContain("done");
  });

  it("redacts the value of a credential-shaped assignment", () => {
    const { text } = sanitizeText("OPENAI_API_KEY=super-secret-value-1234");

    expect(text).not.toContain("super-secret-value-1234");
    expect(text).toContain("[redacted:");
  });

  it("redacts a bearer token in a header dump", () => {
    const { text } = sanitizeText(
      "authorization: Bearer abcdefghijklmnopqrstuvwxyz",
    );

    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(text).toContain("[redacted:bearer_token]");
  });

  it("leaves ordinary tool output alone", () => {
    const output =
      "evaluating 40 cases against dataset v1; macro_f1=0.93; wrote results to ./out/results.json";
    const { text, redactions } = sanitizeText(output);

    expect(text).toBe(output);
    expect(redactions).toEqual([]);
  });

  it("does not mangle hashes or identifiers", () => {
    const output = `configuration_hash=${"a".repeat(64)} candidate=candidate.local`;

    // A hash is not a credential; redacting it would destroy provenance.
    expect(sanitizeText(output).text).toContain("a".repeat(64));
  });

  it("sanitizes strings nested anywhere in a structure", () => {
    const cleaned = sanitizeStructured({
      results: [{ note: `failed with ${GITHUB}` }],
      meta: { region: "eu" },
    }) as { results: { note: string }[]; meta: { region: string } };

    expect(cleaned.results[0]?.note).not.toContain("ghp_");
    expect(cleaned.meta.region).toBe("eu");
  });

  it("reports whether text carries anything credential-shaped", () => {
    expect(containsSecret(`id ${AWS}`)).toBe(true);
    expect(containsSecret("no credentials here")).toBe(false);
  });
});

/**
 * An opaque credential with no vendor prefix matches no published pattern.
 * The only thing marking it as a credential is the key it sits under, so
 * structured sanitization has to pass the key path to the classifier.
 */
describe("structured sanitization uses the key path", () => {
  const OPAQUE = "mQ7vL2xP9cR4nT8kW6zB";

  it("redacts a credential-named field with no vendor prefix", () => {
    const cleaned = sanitizeStructured({
      api_token: OPAQUE,
      nested: { password: OPAQUE },
      list: [{ client_secret: OPAQUE }],
    });

    expect(JSON.stringify(cleaned)).not.toContain(OPAQUE);
  });

  it("leaves numeric token counts intact", () => {
    const cleaned = sanitizeStructured({
      input_tokens_per_call: 900,
      estimated_tokens_per_second: 47.5,
      token_usage_total: 38400,
    }) as Record<string, number>;

    expect(cleaned.input_tokens_per_call).toBe(900);
    expect(cleaned.estimated_tokens_per_second).toBe(47.5);
    expect(cleaned.token_usage_total).toBe(38400);
  });

  it("leaves hashes and identifiers alone", () => {
    const cleaned = sanitizeStructured({
      configuration_hash: "a".repeat(64),
      candidate_ref: "candidate.local",
    }) as Record<string, string>;

    expect(cleaned.configuration_hash).toBe("a".repeat(64));
    expect(cleaned.candidate_ref).toBe("candidate.local");
  });

  it("reports a nested credential", () => {
    expect(structuredContainsSecret({ deep: { auth: OPAQUE } })).toBe(true);
    expect(structuredContainsSecret({ deep: { region: "eu-west-1" } })).toBe(
      false,
    );
  });
});

describe("structured errors carry no credentials", () => {
  const OPAQUE = "mQ7vL2xP9cR4nT8kW6zB";

  it("redacts an opaque credential quoted in the message", () => {
    const error = adapterError("spawn_failed", `failed using ${OPAQUE}`, {});

    expect(error.message).not.toContain(OPAQUE);
    expect(error.message).toContain("[redacted:");
  });

  it("keeps ordinary error text readable", () => {
    const error = adapterError(
      "non_zero_exit",
      "the tool exited with status 3",
      {
        exit_code: 3,
      },
    );

    expect(error.message).toBe("the tool exited with status 3");
  });

  it("sanitizes both the message and the structured detail", () => {
    const error = adapterError(
      "spawn_failed",
      `failed while using sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD`,
      { api_token: OPAQUE, nested: { password: OPAQUE }, exit_code: 3 },
    );

    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("sk-abcdefghij");
    expect(serialized).not.toContain(OPAQUE);
    // Non-credential detail survives.
    expect(error.detail.exit_code).toBe(3);
  });
});
