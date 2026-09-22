import { afterEach, describe, expect, it } from "vitest";

import { parseProjectContract, unwrap } from "@anvilmark/project-contract";

import {
  atlasProject,
  cleanup,
  cli,
  projectText,
  scriptedIo,
} from "./helpers.js";

afterEach(cleanup);

const rules = async (root: string) =>
  unwrap(parseProjectContract(await projectText(root), "yaml"))
    .conformance_rules;

describe("anvilmark rule", () => {
  it("lists, adds and removes conformance rules through validated commits", async () => {
    const root = await atlasProject();
    const list = scriptedIo({ cwd: root });
    expect(await cli(["rule", "list"], list)).toBe(0);
    expect(list.out()).toContain("rule.raw_ticket_never_remote");

    const add = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "rule",
          "add",
          "provider-allowlist",
          "--id",
          "rule.classification_local_only",
          "--workload",
          "classification",
          "--allow",
          "candidate.classification.local_unselected",
        ],
        add,
      ),
    ).toBe(0);
    expect(add.out()).toContain(
      "added conformance rule rule.classification_local_only",
    );
    expect(
      (await rules(root)).find(
        (r) => r.id === "rule.classification_local_only",
      ),
    ).toMatchObject({
      kind: "provider_allowlist",
      severity: "error",
      allowed_candidate_refs: ["candidate.classification.local_unselected"],
    });

    const flow = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "rule",
          "add",
          "forbid-dataflow",
          "--id",
          "rule.redacted_stays_internal",
          "--constraint",
          "privacy.raw_ticket_remote",
          "--data",
          "redacted_customer_ticket",
          "--to",
          "third_party",
          "--unless-through",
          "pii-redactor",
          "--severity",
          "warning",
        ],
        flow,
      ),
    ).toBe(0);

    // Warnings can be removed without a terminal; errors cannot.
    expect(
      await cli(
        ["rule", "remove", "rule.redacted_stays_internal"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const refused = scriptedIo({ cwd: root });
    expect(
      await cli(["rule", "remove", "rule.classification_local_only"], refused),
    ).toBe(1);
    expect(refused.err()).toContain("interactive terminal");
    const confirmed = scriptedIo({
      cwd: root,
      interactive: true,
      answers: ["y"],
    });
    expect(
      await cli(
        ["rule", "remove", "rule.classification_local_only"],
        confirmed,
      ),
    ).toBe(0);
    expect((await rules(root)).map((r) => r.id)).toEqual([
      "rule.raw_ticket_never_remote",
      "rule.classification_approved_candidate",
    ]);
  });

  it("refuses rules whose references do not exist, writing nothing", async () => {
    const root = await atlasProject();
    const before = await projectText(root);
    for (const argv of [
      [
        "rule",
        "add",
        "approved-candidate",
        "--id",
        "rule.x",
        "--workload",
        "no_such_workload",
      ],
      [
        "rule",
        "add",
        "provider-allowlist",
        "--id",
        "rule.y",
        "--workload",
        "classification",
        "--allow",
        "candidate.missing",
      ],
      [
        "rule",
        "add",
        "forbid-dataflow",
        "--id",
        "rule.z",
        "--constraint",
        "privacy.raw_ticket_remote",
        "--data",
        "undeclared_label",
        "--to",
        "remote_provider",
      ],
      [
        "rule",
        "add",
        "forbid-dataflow",
        "--id",
        "rule.raw_ticket_never_remote",
        "--constraint",
        "privacy.raw_ticket_remote",
        "--data",
        "raw_customer_ticket",
        "--to",
        "remote_provider",
      ],
    ]) {
      const io = scriptedIo({ cwd: root });
      expect(await cli(argv, io), argv.join(" ")).toBe(1);
    }
    for (const argv of [
      ["rule", "add", "--id", "rule.a"],
      ["rule", "add", "sometimes", "--id", "rule.a"],
      [
        "rule",
        "add",
        "forbid-dataflow",
        "--id",
        "rule.a",
        "--constraint",
        "privacy.raw_ticket_remote",
        "--data",
        "raw_customer_ticket",
        "--to",
        "the_internet",
      ],
    ]) {
      const io = scriptedIo({ cwd: root });
      expect(await cli(argv, io), argv.join(" ")).not.toBe(0);
    }
    expect(await projectText(root)).toBe(before);
  });
});
