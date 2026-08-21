import { describe, expect, it } from "vitest";

import {
  canonicalize,
  loadAtlasFixture,
  parseProjectContract,
  readAtlasFixtureText,
  stableStringify,
  toNormalizedJson,
  toNormalizedYaml,
  unwrap,
  validateProjectContract,
} from "../src/index.js";
import { baseDocument } from "./helpers.js";

describe("deterministic serialization", () => {
  it("produces byte-identical YAML on repeated round trips", async () => {
    const contract = await loadAtlasFixture();

    const first = toNormalizedYaml(contract);
    const second = toNormalizedYaml(
      unwrap(parseProjectContract(first, "yaml")),
    );
    const third = toNormalizedYaml(
      unwrap(parseProjectContract(second, "yaml")),
    );

    expect(second).toBe(first);
    expect(third).toBe(second);
  });

  it("produces byte-identical JSON on repeated round trips", async () => {
    const contract = await loadAtlasFixture();

    const first = toNormalizedJson(contract);
    const second = toNormalizedJson(
      unwrap(parseProjectContract(first, "json")),
    );

    expect(second).toBe(first);
  });

  it("reaches the same contract through YAML and through JSON", async () => {
    const contract = await loadAtlasFixture();

    const viaYaml = unwrap(
      parseProjectContract(toNormalizedYaml(contract), "yaml"),
    );
    const viaJson = unwrap(
      parseProjectContract(toNormalizedJson(contract), "json"),
    );

    expect(toNormalizedJson(viaJson)).toBe(toNormalizedJson(viaYaml));
  });

  it("detects the format when it is not stated", async () => {
    const contract = await loadAtlasFixture();

    expect(parseProjectContract(toNormalizedJson(contract)).ok).toBe(true);
    expect(parseProjectContract(toNormalizedYaml(contract)).ok).toBe(true);
  });

  it("preserves the order of semantically ordered arrays", async () => {
    const contract = await loadAtlasFixture();
    const original = [...contract.project.priority_order];

    const round = unwrap(
      parseProjectContract(toNormalizedYaml(contract), "yaml"),
    );

    expect(round.project.priority_order).toEqual(original);
    expect(round.project.priority_order).toEqual([
      "privacy",
      "quality",
      "availability",
      "cost",
      "latency",
    ]);
    expect(round.constraints.map((entry) => entry.id)).toEqual(
      contract.constraints.map((entry) => entry.id),
    );
    expect(round.workloads.map((entry) => entry.id)).toEqual(
      contract.workloads.map((entry) => entry.id),
    );
  });

  it("keeps soft direction through a round trip", async () => {
    const contract = await loadAtlasFixture();
    const round = unwrap(
      parseProjectContract(toNormalizedYaml(contract), "yaml"),
    );

    const soft = round.constraints.filter((entry) => entry.severity === "soft");
    expect(soft.map((entry) => entry.direction)).toEqual([
      "minimize",
      "minimize",
      "minimize",
    ]);
  });

  it("does not depend on the key order of the input document", () => {
    const document = baseDocument();
    const reversed = Object.fromEntries(
      Object.entries(document).reverse(),
    ) as Record<string, unknown>;

    const fromOriginal = unwrap(validateProjectContract(document));
    const fromReversed = unwrap(validateProjectContract(reversed));

    expect(toNormalizedJson(fromReversed)).toBe(toNormalizedJson(fromOriginal));
  });

  it("sorts object keys but never reorders arrays", () => {
    const canonical = canonicalize({
      zebra: 1,
      alpha: 2,
      list: ["third", "first", "second"],
    }) as Record<string, unknown>;

    expect(Object.keys(canonical)).toEqual(["alpha", "list", "zebra"]);
    expect(canonical.list).toEqual(["third", "first", "second"]);
  });

  it("normalises -0 so equal contracts hash equally", () => {
    expect(stableStringify({ value: -0 })).toBe(stableStringify({ value: 0 }));
  });

  it("rejects values that cannot appear in a portable contract", () => {
    expect(() => stableStringify({ value: Number.NaN })).toThrow(/non-finite/);
    expect(() => stableStringify({ value: Number.POSITIVE_INFINITY })).toThrow(
      /non-finite/,
    );
  });

  it("keeps timestamps as strings rather than host Date objects", async () => {
    // js-yaml's default YAML 1.1 schema would turn an unquoted timestamp into
    // a Date, which cannot be canonically serialized.
    const contract = await loadAtlasFixture();

    expect(typeof contract.project.created_at).toBe("string");
    expect(contract.project.created_at).toBe("2026-08-17T00:00:00Z");
    expect(toNormalizedYaml(contract)).toContain("2026-08-17T00:00:00Z");
  });

  it("round-trips unicode and YAML-ambiguous strings byte-stably", async () => {
    const contract = await loadAtlasFixture();
    const awkward = {
      ...contract,
      intent: {
        ...contract.intent,
        summary: "Unicode: dashes, \u201Cquotes\u201D, tabs\tand \u4E2D\u6587.",
        non_goals: [
          "a: b",
          "- dash",
          "#hash",
          "*star",
          "@at",
          "null",
          "true",
          "123",
        ],
      },
    };

    const first = toNormalizedYaml(awkward);
    const reparsed = unwrap(parseProjectContract(first, "yaml"));

    expect(toNormalizedYaml(reparsed)).toBe(first);
    expect(reparsed.intent.summary).toBe(awkward.intent.summary);
    // Strings that YAML could coerce to null, booleans, or numbers stay strings.
    expect(reparsed.intent.non_goals).toEqual(awkward.intent.non_goals);
  });

  it("does not mutate the input document while validating", async () => {
    const text = await readAtlasFixtureText();
    const before = JSON.parse(JSON.stringify(baseDocument())) as unknown;
    const document = baseDocument();

    validateProjectContract(document);

    expect(document).toEqual(before);
    // The source text is untouched too.
    expect(await readAtlasFixtureText()).toBe(text);
  });

  it("returns no contract at all when the input is invalid", () => {
    const document = baseDocument();
    (document.project as Record<string, unknown>).state = "not-a-state";

    const result = validateProjectContract(document);

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("value");
  });
});

describe("syntax errors", () => {
  it("reports a YAML syntax error with a location", () => {
    const result = parseProjectContract("project:\n  id: x\n :\tbad\n", "yaml");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("yaml_syntax_error");
    expect(result.issues[0]?.details).toHaveProperty("line");
  });

  it("reports a JSON syntax error", () => {
    const result = parseProjectContract('{"project": }', "json");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("json_syntax_error");
  });

  it("rejects a document that is not a mapping", () => {
    const result = parseProjectContract("- one\n- two\n", "yaml");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("document_not_an_object");
  });
});
