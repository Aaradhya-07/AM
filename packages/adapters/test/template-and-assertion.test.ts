/**
 * Template grammar and assertion shape regressions.
 *
 * Written against 483d1cb and run there before the fix. Tests that are
 * deliberate guards -- behaviour already correct that must stay correct -- say
 * so in their name.
 *
 * Facts these rest on, each checked directly:
 * - Nunjucks 3.2.4 (the version installed with promptfoo 0.122.0) renders
 *   `{{ range.constructor("return 6*7")() }}` as `42`: expressions execute
 *   JavaScript.
 * - promptfoo 0.122.0 renders assertion string values and array elements with
 *   Nunjucks (`src/assertions/index.ts:548,557`), and renders `metric` too
 *   (line 337). At config load `renderEnvOnlyInObject` renders any
 *   `{{ env.<name> ... }}` in ANY string, and `"constructor" in {}` is true, so
 *   `{{ env.constructor.constructor("return 42")() }}` executed in a
 *   description and a variable even with the environment hidden.
 * - In Nunjucks 3.2.4 plain text, `}}` and `%}` render literally; `{{`, `{%` and
 *   `{#` open a tag, and a bare `#}` throws.
 * - A row variable named `range` or `env` shadows the global of that name.
 */
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BASE_ASSERTION_TYPES,
  createPromptfooAdapter,
  fixedClock,
  planEvaluation,
  validateEvaluationSpec,
} from "../src/index.js";
import { FIXED_TIMES } from "./helpers.js";
import { artifactFor } from "./promptfoo-artifacts.js";
import { evaluationSpec } from "./promptfoo-inputs.js";

let workspace = "";

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "anvilmark-template-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

type Mutable = Record<string, unknown> & {
  prompts: string[];
  description?: string;
  candidate_ref: string;
  dataset: { id: string; version: string; rows: Record<string, unknown>[] };
  provider: { id: string; config: Record<string, unknown> };
  default_assertions: Record<string, unknown>[];
};

function specWith(mutate: (spec: Mutable) => void): Mutable {
  const spec = JSON.parse(JSON.stringify(evaluationSpec())) as Mutable;
  mutate(spec);
  return spec;
}

function reasonsFor(spec: unknown): string[] {
  const result = validateEvaluationSpec(spec);
  return "reasons" in result ? [...result.reasons] : [];
}

// =============================================================================

describe("prompts use only {{ variable }} interpolation", () => {
  it.each([
    ["constructor access", '{{ range.constructor("return 42")() }}'],
    [
      "the exact reported expression",
      '{{ range.constructor("return 6*7")() }}',
    ],
    ["a function call", "Ticket: {{ ticket() }}"],
    ["property access", "Ticket: {{ ticket.length }}"],
    ["bracket access", 'Ticket: {{ ticket["length"] }}'],
    ["a filter", "Ticket: {{ ticket | upper }}"],
    ["an operator", "Ticket: {{ ticket + 1 }}"],
    ["a string literal", 'Ticket: {{ "literal" }}'],
    ["environment access", "Home: {{ env.HOME }}"],
    [
      "environment constructor access",
      '{{ env.constructor.constructor("return 42")() }}',
    ],
    ["whitespace control", "Ticket: {{- ticket -}}"],
    ["a triple brace", "Ticket: {{{ ticket }}}"],
    ["an unclosed interpolation", "Ticket: {{ ticket"],
    ["a comment", "Ticket {# hidden #} {{ ticket }}"],
    ["a stray comment close", "Ticket #} {{ ticket }}"],
  ])("refuses %s", (_label, prompt) => {
    const reasons = reasonsFor(
      specWith((spec) => {
        spec.prompts = [prompt];
      }),
    );
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(" ")).toContain("template");
  });

  it.each([
    ["a statement", "{% if ticket %}yes{% endif %}"],
    ["a multi-line statement", "Line one\n{% raw %}x{% endraw %}"],
  ])("guard: refuses %s (already refused at 483d1cb)", (_label, prompt) => {
    const reasons = reasonsFor(
      specWith((spec) => {
        spec.prompts = [prompt];
      }),
    );
    expect(reasons.join(" ")).toContain("template");
  });

  it("refuses a variable that no row defines", () => {
    const reasons = reasonsFor(
      specWith((spec) => {
        spec.prompts = ["Ticket: {{ missing }}"];
      }),
    );
    expect(reasons.join(" ")).toContain("missing");
  });

  it("refuses a variable that only some rows define", () => {
    const reasons = reasonsFor(
      specWith((spec) => {
        spec.dataset.rows = [
          { vars: { ticket: "a" }, assert: [] },
          { vars: { other: "b" }, assert: [] },
        ];
      }),
    );
    expect(reasons.join(" ")).toContain("ticket");
  });

  it.each([
    ["spaced interpolation", "Classify: {{ ticket }}"],
    ["compact interpolation", "Classify: {{ticket}}"],
    ["tabbed interpolation", "Classify: {{\tticket\t}}"],
    ["two interpolations", "{{ ticket }} / again {{ ticket }}\n(two lines)"],
    ["literal closers", "Braces }} and %} are literal: {{ ticket }}"],
    ["no template at all", "A fixed prompt\nwith no variables"],
    ["a variable named like a global", "Value: {{ range }}"],
  ])("guard: accepts %s", (label, prompt) => {
    const spec = specWith((s) => {
      s.prompts = [prompt];
      if (label === "a variable named like a global") {
        s.dataset.rows = [{ vars: { range: "x" }, assert: [] }];
      }
    });
    expect(reasonsFor(spec)).toEqual([]);
  });
});

describe("literal fields contain no template syntax", () => {
  it.each([
    [
      "an assertion value",
      (s: Mutable) => {
        s.default_assertions = [
          { type: "equals", value: '{{ range.constructor("return 42")() }}' },
        ];
      },
    ],
    [
      "an assertion value holding a plain interpolation",
      (s: Mutable) => {
        s.default_assertions = [{ type: "contains", value: "{{ ticket }}" }];
      },
    ],
    [
      "an assertion array element",
      (s: Mutable) => {
        s.default_assertions = [
          { type: "contains-any", value: ["ok", "{# c #}"] },
        ];
      },
    ],
    [
      "a variable value",
      (s: Mutable) => {
        s.dataset.rows = [
          {
            vars: {
              ticket: '{{ env.constructor.constructor("return 42")() }}',
            },
            assert: [],
          },
        ];
      },
    ],
    [
      "a variable name",
      (s: Mutable) => {
        s.prompts = ["fixed"];
        s.dataset.rows = [{ vars: { "{{x}}": "a" }, assert: [] }];
      },
    ],
    [
      "a row description",
      (s: Mutable) => {
        s.dataset.rows = [
          { description: "{{ ticket }}", vars: { ticket: "a" }, assert: [] },
        ];
      },
    ],
    [
      "the evaluation description",
      (s: Mutable) => {
        s.description = '{{ env.constructor.constructor("return 42")() }}';
      },
    ],
    [
      "a candidate reference that reaches the generated description",
      (s: Mutable) => {
        s.candidate_ref = "candidate.{{ env.x }}";
      },
    ],
    [
      "a stop sequence",
      (s: Mutable) => {
        s.provider.config = { stop: ["{{ ticket }}"] };
      },
    ],
    [
      "a metric name",
      (s: Mutable) => {
        s.default_assertions = [
          { type: "contains", value: "ok", metric: "{{ ticket }}" },
        ];
      },
    ],
    [
      "a stray comment close in a value",
      (s: Mutable) => {
        s.dataset.rows = [{ vars: { ticket: "a #} b" }, assert: [] }];
      },
    ],
  ])("refuses template syntax in %s", (_label, mutate) => {
    const reasons = reasonsFor(specWith(mutate));
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(" ")).toContain("template");
  });

  it("guard: accepts literal closing braces, which Nunjucks renders as text", () => {
    const spec = specWith((s) => {
      s.dataset.rows = [
        { vars: { ticket: 'nested {"a":{"b":1}} and 50%}' }, assert: [] },
      ];
    });
    expect(reasonsFor(spec)).toEqual([]);
  });
});

/**
 * Names Nunjucks 3.2.4 does not treat as variables inside `{{ ... }}`, checked
 * against the installed version: the lexer turns `true` and `false` into boolean
 * tokens and `none` and `null` into null tokens (`src/lexer.js:211-223`), and the
 * parser consumes `not` as an operator (`parseNot`). With a row variable of the
 * same name defined, `{{ true }}` still renders "true", `{{ none }}` and
 * `{{ null }}` render "", and `{{ not }}` throws. Against dd5ecfc all five were
 * accepted, the real promptfoo 0.122.0 ran, and the result was available
 * evidence about a prompt other than the one planned. The match is
 * case-sensitive: `True`, `None`, `and`, `or`, `in`, `is` and `if` all
 * substitute in this form and stay valid.
 */
describe("keyword names are not variables inside {{ ... }}", () => {
  const RESERVED = ["true", "false", "none", "null", "not"] as const;

  function withVariable(name: string, prompt = `v={{ ${name} }}`): Mutable {
    return specWith((s) => {
      s.prompts = [prompt];
      s.dataset.rows = [{ vars: { [name]: "SENTINEL" }, assert: [] }];
    });
  }

  it.each(RESERVED)(
    "refuses {{ %s }} even when a row defines that variable",
    (name) => {
      const reasons = reasonsFor(withVariable(name));
      expect(reasons.length).toBeGreaterThan(0);
      expect(reasons.join(" ")).toContain("template");
      expect(reasons.join(" ")).toContain(`"${name}"`);
    },
  );

  it.each(RESERVED)("refuses {{%s}} without surrounding spaces", (name) => {
    expect(
      reasonsFor(withVariable(name, `v={{${name}}}`)).length,
    ).toBeGreaterThan(0);
  });

  it.each(RESERVED)(
    "refuses {{ %s }} before the program is invoked",
    async (name) => {
      const directory = join(workspace, `program-${name}`);
      const program = join(directory, "fake-promptfoo");
      await mkdir(directory, { recursive: true });
      await writeFile(
        program,
        [
          "#!/usr/bin/env node",
          'require("node:fs").appendFileSync(require("node:path").join(__dirname, "invocations.log"), process.argv[2] + "\\n");',
          'process.stdout.write("0.122.0");',
        ].join("\n"),
        "utf8",
      );
      await chmod(program, 0o755);
      await mkdir(join(workspace, "data"), { recursive: true });

      const outcome = await createPromptfooAdapter({
        clock: fixedClock(...FIXED_TIMES),
        executable: program,
        providers: [
          {
            id: "echo",
            reach: "local",
            destination: "local",
            credentialEnvNames: [],
          },
        ],
      }).collect({
        evidenceId: "evidence.eval",
        spec: withVariable(name),
        dataDirectory: join(workspace, "data"),
        constraintRefs: ["quality.classification_f1"],
      });

      expect(outcome.standing).toBe("unknown");
      expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
      expect(outcome.adapter.version).toBeNull();
      const log = await readFile(
        join(directory, "invocations.log"),
        "utf8",
      ).catch(() => "");
      expect(log).toBe("");
    },
  );

  it.each([
    "ticket",
    "range",
    "env",
    "True",
    "False",
    "None",
    "Null",
    "NOT",
    "and",
    "in",
    "is",
    "if",
  ])("guard: accepts {{ %s }} as a variable", (name) => {
    expect(reasonsFor(withVariable(name))).toEqual([]);
  });

  it("guard: accepts a prompt mixing legitimate variables", () => {
    const spec = specWith((s) => {
      s.prompts = ["{{ ticket }}|{{ range }}|{{ env }}|{{ True }}|{{ None }}"];
      s.dataset.rows = [
        {
          vars: { ticket: "a", range: "b", env: "c", True: "d", None: "e" },
          assert: [],
        },
      ];
    });
    expect(reasonsFor(spec)).toEqual([]);
  });
});

describe("a template refusal happens before anything is spawned", () => {
  it("never invokes the program for the constructor expression", async () => {
    const program = join(workspace, "program", "fake-promptfoo");
    await mkdir(join(workspace, "program"), { recursive: true });
    await writeFile(
      program,
      [
        "#!/usr/bin/env node",
        'require("node:fs").appendFileSync(require("node:path").join(__dirname, "invocations.log"), process.argv[2] + "\\n");',
        'process.stdout.write("0.122.0");',
      ].join("\n"),
      "utf8",
    );
    await chmod(program, 0o755);
    await mkdir(join(workspace, "data"), { recursive: true });

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: program,
      providers: [
        {
          id: "echo",
          reach: "local",
          destination: "local",
          credentialEnvNames: [],
        },
      ],
    }).collect({
      evidenceId: "evidence.eval",
      spec: specWith((s) => {
        s.prompts = ['{{ range.constructor("return 42")() }}'];
      }),
      dataDirectory: join(workspace, "data"),
      constraintRefs: ["quality.classification_f1"],
    });

    expect(outcome.standing).toBe("unknown");
    expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
    const log = await readFile(
      join(workspace, "program", "invocations.log"),
      "utf8",
    ).catch(() => "");
    expect(log).toBe("");
  });
});

// =============================================================================

describe("assertions have the shape promptfoo 0.122.0 can evaluate", () => {
  const STRING_TYPES = [
    "contains",
    "icontains",
    "starts-with",
    "regex",
  ] as const;
  const LIST_TYPES = [
    "contains-all",
    "contains-any",
    "icontains-all",
    "icontains-any",
  ] as const;
  const JSON_TYPES = ["contains-json", "is-json"] as const;

  const both = (types: readonly string[]) =>
    types.flatMap((t) => [t, `not-${t}`]);

  function accepts(assertion: Record<string, unknown>): boolean {
    return (
      reasonsFor(
        specWith((s) => {
          s.default_assertions = [assertion];
        }),
      ).length === 0
    );
  }

  const valid: Record<string, Record<string, unknown>> = {
    contains: { value: "ok" },
    icontains: { value: "OK" },
    "starts-with": { value: "Classify" },
    regex: { value: "^Classify" },
    equals: { value: "Classify the ticket: billing question" },
    "contains-all": { value: ["Classify", "ticket"] },
    "contains-any": { value: ["Classify", "absent"] },
    "icontains-all": { value: ["classify", "TICKET"] },
    "icontains-any": { value: ["CLASSIFY", "absent"] },
    "contains-json": {},
    "is-json": {},
    levenshtein: { value: "Classify the ticket", threshold: 20 },
  };

  it("guard: the valid-shape table covers every supported base type", () => {
    expect(Object.keys(valid).sort()).toEqual([...BASE_ASSERTION_TYPES].sort());
  });

  it.each(both(BASE_ASSERTION_TYPES))(
    "guard: accepts a well-formed %s",
    (type) => {
      const base = type.replace(/^not-/, "");
      expect(accepts({ type, ...valid[base] })).toBe(true);
      expect(accepts({ type, ...valid[base], metric: "named_score" })).toBe(
        true,
      );
    },
  );

  it.each(both(STRING_TYPES))(
    "refuses %s with a missing, empty, list, number or boolean value",
    (type) => {
      for (const value of [undefined, "", ["ok"], 5, true]) {
        expect(
          accepts({ type, ...(value === undefined ? {} : { value }) }),
          JSON.stringify(value),
        ).toBe(false);
      }
    },
  );

  it.each(both(["equals"]))(
    "refuses %s with a missing, list, number or boolean value",
    (type) => {
      for (const value of [undefined, ["ok"], 5, true]) {
        expect(
          accepts({ type, ...(value === undefined ? {} : { value }) }),
          JSON.stringify(value),
        ).toBe(false);
      }
    },
  );

  it.each(both(["equals"]))(
    "guard: accepts %s against an empty expected output",
    (type) => {
      expect(accepts({ type, value: "" })).toBe(true);
    },
  );

  it.each(both(LIST_TYPES))(
    "refuses %s with a missing value, a comma string, an empty list, an empty entry or a number",
    (type) => {
      for (const value of [undefined, "a, b", [], ["ok", ""], 5, [1, 2]]) {
        expect(
          accepts({ type, ...(value === undefined ? {} : { value }) }),
          JSON.stringify(value),
        ).toBe(false);
      }
    },
  );

  it.each(both(JSON_TYPES))(
    "refuses %s with a value, since schema validation is not supported",
    (type) => {
      expect(accepts({ type, value: '{"type":"object"}' })).toBe(false);
      expect(accepts({ type, value: ["x"] })).toBe(false);
    },
  );

  it.each(both(["levenshtein"]))(
    "refuses %s without a valid threshold or string value",
    (type) => {
      expect(accepts({ type, value: "x" })).toBe(false);
      for (const threshold of [
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "2",
      ]) {
        expect(
          accepts({ type, value: "x", threshold }),
          String(threshold),
        ).toBe(false);
      }
      expect(accepts({ type, threshold: 2 })).toBe(false);
      expect(accepts({ type, value: ["x"], threshold: 2 })).toBe(false);
    },
  );

  it.each(both([...STRING_TYPES, "equals", ...LIST_TYPES, ...JSON_TYPES]))(
    "refuses a threshold on %s, which does not use one",
    (type) => {
      const base = type.replace(/^not-/, "");
      expect(accepts({ type, ...valid[base], threshold: 1 })).toBe(false);
    },
  );

  it.each(both(BASE_ASSERTION_TYPES))(
    "guard: refuses unknown fields on %s (already refused at 483d1cb)",
    (type) => {
      const base = type.replace(/^not-/, "");
      expect(accepts({ type, ...valid[base], weight: 2 })).toBe(false);
      expect(accepts({ type, ...valid[base], transform: "output" })).toBe(
        false,
      );
    },
  );

  it.each(both(["regex"]))(
    "refuses %s with a pattern that does not compile",
    (type) => {
      // promptfoo turns an invalid pattern into an ordinary FAILED case, which
      // would be recorded as a result about the candidate.
      expect(accepts({ type, value: "(unclosed" })).toBe(false);
    },
  );

  it("refuses a malformed assertion during planning, before the program runs", async () => {
    const planned = planEvaluation(
      specWith((s) => {
        s.default_assertions = [{ type: "contains" }];
      }),
    );
    expect("reasons" in planned).toBe(true);

    const outcome = await createPromptfooAdapter({
      clock: fixedClock(...FIXED_TIMES),
      executable: join(workspace, "no-such-promptfoo"),
      providers: [
        {
          id: "echo",
          reach: "local",
          destination: "local",
          credentialEnvNames: [],
        },
      ],
    }).collect({
      evidenceId: "evidence.eval",
      spec: specWith((s) => {
        s.default_assertions = [{ type: "contains" }];
      }),
      dataDirectory: workspace,
      constraintRefs: ["quality.classification_f1"],
    });

    // Refused as configuration, not reported as a missing executable: the plan
    // is checked before the launcher is even consulted.
    expect(outcome.errors[0]?.code).toBe("unsupported_configuration");
  });

  it("guard: a faithful artifact with a genuine error row is still counted as an error", () => {
    // No valid local `echo` evaluation produces a runtime error, so error-row
    // reconciliation is covered by a faithful artifact, not by configuring an
    // assertion promptfoo cannot evaluate.
    const artifact = artifactFor(evaluationSpec(), {
      outcome: () => [false, 2],
    });
    expect(artifact.results.stats).toEqual({
      successes: 0,
      failures: 0,
      errors: 1,
    });
  });
});
