import { describe, expect, it } from "vitest";

import {
  EXPLICITLY_UNSUPPORTED,
  SUPPORTED_ASSERTION_TYPES,
  deriveSpecIdentities,
  generatePromptfooConfig,
  renderPromptfooConfig,
  validateEvaluationSpec,
} from "../src/index.js";
import { evaluationSpec, specIdentity } from "./promptfoo-inputs.js";

/**
 * The four configurations independent review found were accepted while their
 * referenced bytes were never discovered, staged, or hashed. Each is now
 * refused before anything executes, for its own stated reason.
 */
function reasonsFor(mutate: (spec: Record<string, unknown>) => void): string[] {
  const spec = JSON.parse(JSON.stringify(evaluationSpec())) as Record<
    string,
    unknown
  >;
  mutate(spec);
  const result = validateEvaluationSpec(spec);
  if ("spec" in result) {
    throw new Error("expected the spec to be refused");
  }
  return [...result.reasons];
}

describe("inputs whose bytes are not in the spec are refused", () => {
  it("refuses an assertion value that points at an absolute file", () => {
    const reasons = reasonsFor((spec) => {
      spec.default_assertions = [
        { type: "equals", value: "file:///absolute/expected.txt" },
      ];
    });

    expect(reasons.join(" ")).toContain("literal expected value");
  });

  it("refuses a test variable that points at a file", () => {
    const reasons = reasonsFor((spec) => {
      const dataset = spec.dataset as {
        rows: { vars: Record<string, unknown> }[];
      };
      dataset.rows[0]!.vars.ticket = "file://vars.txt";
    });

    expect(reasons.join(" ")).toContain("must be a literal value");
  });

  it("refuses a scenarios key outright", () => {
    const reasons = reasonsFor((spec) => {
      spec.scenarios = ["file://scenario.yaml"];
    });

    // Unknown top-level keys are rejected; nothing generates `scenarios`.
    expect(reasons.join(" ")).toMatch(/scenarios|unrecognized/i);
  });

  it("refuses a python provider for being executable, not for a missing evaluator", () => {
    const reasons = reasonsFor((spec) => {
      const provider = spec.provider as Record<string, unknown>;
      provider.id = "file://provider.py";
    });

    // The earlier fixture was refused for lacking an evaluator, which made the
    // test pass for the wrong reason. This asserts the actual cause: a
    // file-backed provider is not a well-formed provider id at all.
    expect(reasons.join(" ")).toContain("not a provider id");
    expect(reasons.join(" ")).not.toMatch(/evaluator/i);
  });

  it("refuses a prompt that is a reference rather than content", () => {
    const reasons = reasonsFor((spec) => {
      spec.prompts = ["file://prompt.txt"];
    });

    expect(reasons.join(" ")).toContain("must be its content");
  });

  it("refuses an exec: provider", () => {
    const reasons = reasonsFor((spec) => {
      (spec.provider as Record<string, unknown>).id = "exec:./run.sh";
    });

    expect(reasons.join(" ")).toContain("not a provider id");
  });

  it("refuses a transform, filter or extension key", () => {
    for (const key of ["transform", "filters", "extensions", "env"]) {
      const reasons = reasonsFor((spec) => {
        spec[key] = "anything";
      });
      expect(reasons.length).toBeGreaterThan(0);
    }
  });

  it("refuses an unknown nested key", () => {
    const reasons = reasonsFor((spec) => {
      const dataset = spec.dataset as { rows: Record<string, unknown>[] };
      dataset.rows[0]!.transform = "output.trim()";
    });

    expect(reasons.length).toBeGreaterThan(0);
  });
});

describe("assertion types are a deliberate allowlist", () => {
  it("refuses a model-graded assertion and says why", () => {
    const reasons = reasonsFor((spec) => {
      spec.default_assertions = [
        { type: "llm-rubric", value: "is it polite?" },
      ];
    });

    expect(reasons.join(" ")).toContain("decided by another model");
  });

  it("refuses a javascript assertion and says why", () => {
    const reasons = reasonsFor((spec) => {
      spec.default_assertions = [
        { type: "javascript", value: "output.length" },
      ];
    });

    expect(reasons.join(" ")).toContain("executes code");
  });

  it("refuses a python assertion", () => {
    const reasons = reasonsFor((spec) => {
      spec.default_assertions = [{ type: "python", value: "len(output)" }];
    });

    expect(reasons.join(" ")).toContain("executes code");
  });

  it("accepts every allowlisted type in its own well-formed shape", () => {
    // This used to give every type `value: "x"`, which accepted shapes promptfoo
    // cannot evaluate -- `is-json` with a schema string, `levenshtein` with no
    // threshold, a list type with a comma string. Each type now has its shape.
    const shapes: Record<string, Record<string, unknown>> = {
      contains: { value: "x" },
      icontains: { value: "x" },
      "starts-with": { value: "x" },
      regex: { value: "^x" },
      equals: { value: "x" },
      "contains-all": { value: ["x"] },
      "contains-any": { value: ["x"] },
      "icontains-all": { value: ["x"] },
      "icontains-any": { value: ["x"] },
      "is-json": {},
      "contains-json": {},
      levenshtein: { value: "x", threshold: 1 },
    };
    for (const type of SUPPORTED_ASSERTION_TYPES) {
      const spec = evaluationSpec();
      const result = validateEvaluationSpec({
        ...spec,
        default_assertions: [{ type, ...shapes[type.replace(/^not-/, "")] }],
      });
      expect("spec" in result, type).toBe(true);
    }
  });
});

describe("credentials are named, never carried", () => {
  it("refuses a literal key in provider configuration", () => {
    const reasons = reasonsFor((spec) => {
      (spec.provider as Record<string, unknown>).config = {
        apiKey: "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      };
    });

    // `apiKey` is not a sampling parameter, so it never reaches the secret
    // scan: the allowlist refuses the key itself.
    expect(reasons.join(" ")).toContain("apiKey");
  });

  it("accepts an environment-variable name", () => {
    const spec = evaluationSpec();
    const result = validateEvaluationSpec({
      ...spec,
      provider: { ...spec.provider, credential_env_names: ["EXAMPLE_API_KEY"] },
    });

    expect("spec" in result).toBe(true);
  });
});

describe("the generated config is the whole evaluation", () => {
  it("emits only keys ANVILMARK generates", () => {
    const config = generatePromptfooConfig(evaluationSpec());

    expect(Object.keys(config).sort()).toEqual([
      "description",
      "prompts",
      "providers",
      "tests",
    ]);
  });

  it("renders deterministically", () => {
    expect(renderPromptfooConfig(evaluationSpec())).toBe(
      renderPromptfooConfig(evaluationSpec()),
    );
  });

  it("carries the dataset rows and assertions into the config", () => {
    const config = generatePromptfooConfig(evaluationSpec()) as {
      tests: { vars: Record<string, unknown>; assert: unknown[] }[];
      prompts: string[];
      providers: unknown[];
    };

    expect(config.tests[0]?.vars).toEqual({ ticket: "billing question" });
    expect(config.tests[0]?.assert).toHaveLength(1);
    expect(config.prompts[0]).toContain("{{ticket}}");
    expect(config.providers[0]).toBe("echo");
  });

  it("documents what it refuses", () => {
    expect(EXPLICITLY_UNSUPPORTED.join(" ")).toContain("configPath");
    expect(EXPLICITLY_UNSUPPORTED.join(" ")).toContain("scenarios");
  });
});

describe("each identity covers exactly its own data", () => {
  it("changes only dataset_hash when a row changes", () => {
    const before = specIdentity();
    const after = specIdentity({ ticket: "refund request" });

    expect(after.dataset_hash).not.toBe(before.dataset_hash);
    expect(after.prompt_hash).toBe(before.prompt_hash);
    expect(after.evaluator_hash).toBe(before.evaluator_hash);
    expect(after.model_configuration_hash).toBe(
      before.model_configuration_hash,
    );
    // The generated config changes, because the rows are in it.
    expect(after.config_digest).not.toBe(before.config_digest);
  });

  it("changes only prompt_hash when the prompt changes", () => {
    const before = specIdentity();
    const after = specIdentity({ prompt: "A different prompt" });

    expect(after.prompt_hash).not.toBe(before.prompt_hash);
    expect(after.dataset_hash).toBe(before.dataset_hash);
    expect(after.evaluator_hash).toBe(before.evaluator_hash);
    expect(after.model_configuration_hash).toBe(
      before.model_configuration_hash,
    );
  });

  it("changes only evaluator_hash when an assertion changes", () => {
    const before = specIdentity();
    const after = specIdentity({ assertValue: "refund" });

    expect(after.evaluator_hash).not.toBe(before.evaluator_hash);
    expect(after.dataset_hash).toBe(before.dataset_hash);
    expect(after.prompt_hash).toBe(before.prompt_hash);
  });

  it("changes only model_configuration_hash when the provider changes", () => {
    const before = specIdentity();
    const after = specIdentity({ provider: "example:model-z" });

    expect(after.model_configuration_hash).not.toBe(
      before.model_configuration_hash,
    );
    expect(after.dataset_hash).toBe(before.dataset_hash);
    expect(after.prompt_hash).toBe(before.prompt_hash);
    expect(after.evaluator_hash).toBe(before.evaluator_hash);
  });

  it("gives the same identity to the same spec regardless of where it is used", () => {
    // Nothing in the identity derives from a path, so there is no location to
    // depend on in the first place.
    expect(deriveSpecIdentities(evaluationSpec())).toEqual(
      deriveSpecIdentities(evaluationSpec()),
    );
  });
});
