import { join } from "node:path";

import { parseProjectContract } from "@anvilmark/project-contract";
import type { ProjectContract } from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  FAKE_KEY,
  cleanup,
  cli,
  projectText,
  readTree,
  scriptedIo,
  spawnCli,
  tempDir,
} from "./helpers.js";

afterEach(cleanup);

async function contractAt(root: string): Promise<ProjectContract> {
  const parsed = parseProjectContract(await projectText(root), "yaml");
  if (!parsed.ok) throw new Error("invalid project");
  return parsed.value;
}

async function freshProject(): Promise<string> {
  const root = await tempDir();
  const io = scriptedIo({ cwd: root });
  expect(
    await cli(
      ["init", "--idea", "Triage support tickets", "--name", "Desk"],
      io,
    ),
  ).toBe(0);
  return root;
}

describe("incomplete drafts keep unknowns explicit", () => {
  it("records an unknown as an unresolved question and resolves it later", async () => {
    const root = await freshProject();
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["intent", "add-question", "Which regions may process tickets?"],
        io,
      ),
    ).toBe(0);
    expect((await contractAt(root)).intent.unresolved_questions).toEqual([
      "Which regions may process tickets?",
    ]);
    const status = scriptedIo({ cwd: root });
    await cli(["status"], status);
    expect(status.out()).toContain("1. Which regions may process tickets?");

    expect(
      await cli(["intent", "resolve-question", "1"], scriptedIo({ cwd: root })),
    ).toBe(0);
    expect((await contractAt(root)).intent.unresolved_questions).toEqual([]);
  });

  it("keeps a workload whose usage is unknown, as unknown and never as zero", async () => {
    const root = await freshProject();
    const add = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "workload",
          "add",
          "--id",
          "classification",
          "--name",
          "Classify",
          "--input",
          "redacted_ticket",
          "--output",
          "plain_text",
          "--input-tokens",
          "900",
        ],
        add,
      ),
    ).toBe(0);
    expect(add.out()).toContain(
      "monthly usage of classification is recorded as unknown",
    );
    expect(add.out()).toContain(
      "output data classification of classification is not declared",
    );
    const workload = (await contractAt(root)).workloads[0];
    expect(workload?.expected_usage).toEqual({
      basis: "unknown",
      calls_per_month: null,
      input_tokens_per_call: 900,
      output_tokens_per_call: null,
      reasoning_tokens_per_call: null,
    });
    expect(workload?.output_classification).toBeNull();
    expect(await projectText(root)).toContain("calls_per_month: null");

    const status = scriptedIo({ cwd: root });
    await cli(["status"], status);
    expect(status.out()).toContain("monthly usage unknown: classification");
    expect(status.out()).toContain(
      "output classification not declared: classification",
    );

    const compare = scriptedIo({ cwd: root });
    await cli(["compare", "--json"], compare);
    const report = JSON.parse(compare.out()) as {
      workloads: { usage: string; workload_gaps: { code: string }[] }[];
    };
    expect(report.workloads[0]?.usage).toBe("monthly usage unknown");
    expect(report.workloads[0]?.workload_gaps.map((gap) => gap.code)).toContain(
      "missing_usage",
    );
    expect(compare.out()).not.toMatch(/"calls_per_month": 0|0 calls\/month/);

    // A basis without a volume, or a volume with basis unknown, is refused.
    const before = await projectText(root);
    for (const argv of [
      [
        "workload",
        "usage",
        "classification",
        "--usage-basis",
        "measured",
        "--unknown",
      ],
      [
        "workload",
        "usage",
        "classification",
        "--calls-per-month",
        "10",
        "--usage-basis",
        "unknown",
      ],
      ["workload", "usage", "classification"],
    ]) {
      expect(await cli(argv, scriptedIo({ cwd: root }))).toBe(2);
    }
    const noVolume = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "workload",
          "add",
          "--id",
          "drafting",
          "--name",
          "Draft",
          "--input",
          "redacted_ticket",
          "--output",
          "cited_text",
          "--usage-basis",
          "user_assumption",
        ],
        noVolume,
      ),
    ).toBe(2);
    expect(noVolume.err()).toContain("needs --calls-per-month");
    expect(await projectText(root)).toBe(before);

    // Supplying it later keeps the token figure recorded earlier.
    await cli(
      ["workload", "usage", "classification", "--calls-per-month", "40000"],
      scriptedIo({ cwd: root }),
    );
    await cli(
      ["workload", "output-classification", "classification", "ticket_route"],
      scriptedIo({ cwd: root }),
    );
    const updated = (await contractAt(root)).workloads[0];
    expect(updated?.expected_usage).toMatchObject({
      basis: "user_assumption",
      calls_per_month: 40000,
      input_tokens_per_call: 900,
    });
    expect(updated?.output_classification).toBe("ticket_route");
    await cli(
      ["workload", "usage", "classification", "--unknown"],
      scriptedIo({ cwd: root }),
    );
    expect((await contractAt(root)).workloads[0]?.expected_usage).toMatchObject(
      {
        basis: "unknown",
        calls_per_month: null,
      },
    );
  });

  it("lets constraints name a declared output classification", async () => {
    const root = await freshProject();
    const add = (argv: string[]) => cli(argv, scriptedIo({ cwd: root }));
    expect(
      await add([
        "workload",
        "add",
        "--id",
        "drafting",
        "--name",
        "Draft",
        "--input",
        "redacted_ticket",
        "--output",
        "cited_text",
        "--output-classification",
        "customer_reply_draft",
        "--calls-per-month",
        "100",
      ]),
    ).toBe(0);
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "constraint",
          "add",
          "--id",
          "privacy.reply_draft",
          "--domain",
          "privacy",
          "--severity",
          "hard",
          "--subject",
          "data.customer_reply_draft",
          "--operator",
          "must_not_leave",
          "--value",
          "local_trust_boundary",
        ],
        io,
      ),
    ).toBe(0);
    const undeclared = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "constraint",
          "add",
          "--id",
          "privacy.other",
          "--domain",
          "privacy",
          "--severity",
          "hard",
          "--subject",
          "data.never_declared",
          "--operator",
          "must_not_leave",
          "--value",
          "local_trust_boundary",
        ],
        undeclared,
      ),
    ).toBe(1);
    expect(undeclared.err()).toContain(
      "which no workload declares as an input or output",
    );
  });

  it("keeps workloads, assumptions, constraints, resources and priorities separate", async () => {
    const root = await freshProject();
    const steps: string[][] = [
      ["intent", "add-user", "support_agent"],
      ["intent", "add-non-goal", "autonomous_response_sending"],
      [
        "intent",
        "add-outcome",
        "--measure",
        "median_handle_time",
        "--target",
        "<= 8 minutes",
      ],
      [
        "workload",
        "add",
        "--id",
        "pii_redaction",
        "--name",
        "Redaction",
        "--input",
        "raw_customer_ticket",
        "--output",
        "plain_text",
        "--calls-per-month",
        "40000",
      ],
      [
        "workload",
        "add",
        "--id",
        "classification",
        "--name",
        "Classification",
        "--input",
        "redacted_customer_ticket",
        "--output",
        "json_schema",
        "--output-schema",
        "./schemas/c.json",
        "--calls-per-month",
        "40000",
        "--input-tokens",
        "900",
        "--latency-percentile",
        "p95",
        "--latency-max-ms",
        "1000",
        "--quality-gate",
        "macro_f1:0.9:eval.classification.v1",
      ],
      [
        "workload",
        "burst",
        "--workload",
        "classification",
        "--peak-calls-per-minute",
        "120",
      ],
      [
        "constraint",
        "add",
        "--id",
        "privacy.raw_ticket_remote",
        "--domain",
        "privacy",
        "--severity",
        "hard",
        "--subject",
        "data.raw_customer_ticket",
        "--operator",
        "must_not_leave",
        "--value",
        "local_trust_boundary",
      ],
      [
        "constraint",
        "add",
        "--id",
        "budget.monthly",
        "--domain",
        "cost",
        "--severity",
        "soft",
        "--direction",
        "minimize",
        "--subject",
        "project.ai_effective_cost_monthly_usd",
        "--operator",
        "lte",
        "--value",
        "750",
      ],
      [
        "constraint",
        "add",
        "--id",
        "licence.note",
        "--domain",
        "licensing",
        "--severity",
        "informational",
        "--subject",
        "project.model_licences",
        "--operator",
        "in",
        "--value",
        "apache-2.0,mit",
      ],
      ["priority", "set", "privacy,quality,cost"],
      [
        "hardware",
        "add",
        "--id",
        "hardware.gpu",
        "--cpu-cores",
        "16",
        "--ram-gb",
        "64",
        "--os",
        "linux",
        "--backend",
        "cuda",
        "--accelerator",
        "nvidia:RTX 4090:24",
      ],
      [
        "budget",
        "add",
        "--currency",
        "USD",
        "--period",
        "month",
        "--amount",
        "750",
        "--scope",
        "ai_inference",
      ],
      [
        "candidate",
        "add",
        "--id",
        "candidate.classification.local",
        "--workload",
        "classification",
        "--component-kind",
        "model_runtime",
        "--mode",
        "local",
        "--runtime",
        "ollama",
        "--hardware",
        "hardware.gpu",
      ],
      [
        "candidate",
        "assume",
        "candidate.classification.local",
        "The GPU host is dedicated to inference",
      ],
    ];
    for (const step of steps) {
      const io = scriptedIo({ cwd: root });
      const code = await cli(step, io);
      expect({ step, code, err: io.err() }).toEqual({ step, code: 0, err: "" });
    }
    const contract = await contractAt(root);
    expect(contract.workloads.map((entry) => entry.id)).toEqual([
      "pii_redaction",
      "classification",
    ]);
    expect(contract.workloads[1]?.expected_usage.basis).toBe("user_assumption");
    expect(
      contract.constraints.map((entry) => [
        entry.id,
        entry.severity,
        entry.source,
      ]),
    ).toEqual([
      ["throughput.classification.burst", "informational", "user"],
      ["privacy.raw_ticket_remote", "hard", "user"],
      ["budget.monthly", "soft", "user"],
      ["licence.note", "informational", "user"],
    ]);
    expect(contract.constraints[3]?.value).toEqual(["apache-2.0", "mit"]);
    expect(contract.project.priority_order).toEqual([
      "privacy",
      "quality",
      "cost",
    ]);
    expect(contract.resources.hardware[0]?.evidence_kind).toBe("user_declared");
    expect(contract.candidates[0]?.status).toBe("discovered");
    expect(contract.candidates[0]?.estimates.assumptions).toEqual([
      "The GPU host is dedicated to inference",
    ]);
  });

  it("refuses a soft constraint without direction and a hard one with direction", async () => {
    const root = await freshProject();
    const soft = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "constraint",
          "add",
          "--id",
          "a",
          "--domain",
          "cost",
          "--severity",
          "soft",
          "--subject",
          "project.x",
          "--operator",
          "lte",
          "--value",
          "1",
        ],
        soft,
      ),
    ).toBe(2);
    const hard = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "constraint",
          "add",
          "--id",
          "b",
          "--domain",
          "cost",
          "--severity",
          "hard",
          "--direction",
          "minimize",
          "--subject",
          "project.x",
          "--operator",
          "lte",
          "--value",
          "1",
        ],
        hard,
      ),
    ).toBe(2);
    expect(hard.err()).toContain("only to soft constraints");
  });

  it("removes a hard constraint only after interactive confirmation", async () => {
    const root = await freshProject();
    await cli(
      [
        "constraint",
        "add",
        "--id",
        "privacy.gate",
        "--domain",
        "privacy",
        "--severity",
        "hard",
        "--subject",
        "project.prompt_logs",
        "--operator",
        "must_not_leave",
        "--value",
        "local_trust_boundary",
      ],
      scriptedIo({ cwd: root }),
    );
    const before = await projectText(root);
    expect(
      await cli(
        ["constraint", "remove", "privacy.gate"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(1);
    expect(
      await cli(
        ["constraint", "remove", "privacy.gate"],
        scriptedIo({ cwd: root, interactive: true, answers: [""] }),
      ),
    ).toBe(3);
    expect(await projectText(root)).toBe(before);
    expect(
      await cli(
        ["constraint", "remove", "privacy.gate"],
        scriptedIo({ cwd: root, interactive: true, answers: ["y"] }),
      ),
    ).toBe(0);
    expect((await contractAt(root)).constraints).toEqual([]);
  });

  it("never persists a secret typed into a field, and does not echo it", async () => {
    const root = await freshProject();
    const before = await readTree(join(root, ".anvilmark"));
    const io = scriptedIo({ cwd: root });
    expect(await cli(["intent", "add-user", FAKE_KEY], io)).toBe(1);
    expect(io.err()).toContain("secret_value_detected");
    expect(io.out() + io.err()).not.toContain(FAKE_KEY);
    expect(await readTree(join(root, ".anvilmark"))).toEqual(before);
  });
});

describe("progressive elicitation", () => {
  it("saves each section, records unknowns, and keeps unknown usage unknown", async () => {
    const root = await freshProject();
    const io = scriptedIo({
      cwd: root,
      answers: [
        // purpose: keep
        "",
        // users
        "support_agent, support_manager",
        // outcomes
        "median_handle_time",
        "<= 8 minutes",
        "",
        // non-goals: unknown
        "?",
        // workloads: one fully known; one with unknown usage and output label
        "Classification",
        "",
        "redacted_customer_ticket",
        "plain_text",
        "ticket_route",
        "40000",
        "",
        "900",
        "",
        "p95 1000",
        "?",
        "Drafting",
        "",
        "redacted_ticket_with_context",
        "cited_text",
        "?",
        "?",
        "",
        "",
        "",
        "",
        "",
        // constraints: the first names a classification no workload declares
        "privacy",
        "hard",
        "data.raw_customer_ticket",
        "must_not_leave",
        "local_trust_boundary",
        "Raw tickets carry personal data",
        "privacy",
        "hard",
        "data.redacted_customer_ticket",
        "must_not_leave",
        "local_trust_boundary",
        "",
        "",
        // priority
        "privacy, quality",
        // hardware, budgets, decisions: skip
        "",
        "",
        "",
        // questions
        "Which providers are acceptable?",
        "",
      ],
    });
    expect(await cli(["elicit"], io)).toBe(0);
    const contract = await contractAt(root);
    expect(contract.intent.users).toEqual(["support_agent", "support_manager"]);
    expect(contract.intent.outcomes).toEqual([
      {
        id: "median_handle_time",
        measure: "median_handle_time",
        target: "<= 8 minutes",
      },
    ]);
    expect(contract.workloads.map((entry) => entry.id)).toEqual([
      "classification",
      "drafting",
    ]);
    expect(contract.workloads[0]?.output_classification).toBe("ticket_route");
    // Amendment 6: the workload is kept with its volume explicitly unknown.
    expect(contract.workloads[1]?.expected_usage).toMatchObject({
      basis: "unknown",
      calls_per_month: null,
    });
    expect(contract.workloads[1]?.output_classification).toBeNull();
    expect(io.out()).toContain("monthly usage is recorded as unknown");
    expect(contract.workloads[0]?.latency).toEqual({
      percentile: "p95",
      maximum_ms: 1000,
    });
    expect(
      contract.workloads[0]?.expected_usage.output_tokens_per_call,
    ).toBeNull();
    expect(contract.constraints.map((entry) => entry.id)).toEqual([
      "privacy.data_redacted_customer_ticket",
    ]);
    expect(io.out()).toContain(
      "not recorded (privacy.data_raw_customer_ticket)",
    );
    expect(io.out()).toContain("constraint_subject_unresolved");
    expect(contract.project.priority_order).toEqual(["privacy", "quality"]);
    expect(contract.intent.unresolved_questions).toEqual([
      "What is explicitly out of scope for this application?",
      'What burst load must workload "classification" handle?',
      'What data classification does the output of workload "Drafting" have?',
      "Which providers are acceptable?",
    ]);

    const history = scriptedIo({ cwd: root });
    await cli(["history"], history);
    expect(history.out()).toContain("elicit: elicited users");
    expect(history.out()).toContain(
      "elicit: elicited workloads (2 unknown(s) recorded)",
    );
  });

  it("keeps completed sections when stopped and discards the section in progress", async () => {
    const root = await freshProject();
    const io = scriptedIo({
      cwd: root,
      answers: ["", "support_agent", "median_handle_time", null],
    });
    expect(await cli(["elicit"], io)).toBe(3);
    expect(io.out()).toContain('the "outcomes" section in progress was not');
    const contract = await contractAt(root);
    expect(contract.intent.users).toEqual(["support_agent"]);
    expect(contract.intent.outcomes).toEqual([]);
  });

  it("works through the built binary with piped answers", async () => {
    const root = await tempDir();
    expect(
      (await spawnCli(["init", "--idea", "Piped idea"], { cwd: root })).code,
    ).toBe(0);
    const result = await spawnCli(["elicit", "--section", "users"], {
      cwd: root,
      input: "operator, reviewer\n",
    });
    expect(result.code).toBe(0);
    expect((await contractAt(root)).intent.users).toEqual([
      "operator",
      "reviewer",
    ]);
  });
});
