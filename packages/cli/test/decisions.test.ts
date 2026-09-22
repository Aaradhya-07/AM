import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  approvalState,
  computeApprovalHash,
  parseProjectContract,
} from "@anvilmark/project-contract";
import type { ProjectContract } from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  ATLAS,
  ATLAS_PROPOSAL,
  REPO_ROOT,
  cleanup,
  cli,
  projectText,
  readTree,
  scriptedIo,
  spawnCli,
  tempDir,
} from "./helpers.js";

afterEach(cleanup);

const DECISION = "decision.classification";
const LOCAL = "candidate.classification.local_unselected";
const REMOTE = "candidate.classification.remote_unselected";
const OPEN_HARD = [
  "privacy.raw_ticket_remote",
  "availability.classification_provider",
  "quality.classification_f1",
  "quality.schema_validity",
];

async function contractAt(root: string): Promise<ProjectContract> {
  const parsed = parseProjectContract(await projectText(root), "yaml");
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

async function step(root: string, argv: readonly string[]): Promise<void> {
  const io = scriptedIo({ cwd: root });
  const code = await cli(argv, io);
  expect({ argv, code, err: io.err() }).toEqual({ argv, code: 0, err: "" });
}

/** Atlas with the walkthrough proposal applied and a proposed decision. */
async function proposedAtlas(): Promise<string> {
  const root = await tempDir();
  await step(root, [
    "init",
    "--from-contract",
    ATLAS,
    "--intelligence",
    "handoff",
  ]);
  const exporting = scriptedIo({ cwd: root });
  await cli(["propose", "export", "--task", "propose_candidates"], exporting);
  const requestId =
    /propose import (req-[A-Za-z0-9-]+)/.exec(exporting.out())?.[1] ?? "";
  await writeFile(
    join(
      root,
      ".anvilmark",
      "intelligence",
      "handoff",
      `${requestId}.response.json`,
    ),
    await readFile(ATLAS_PROPOSAL, "utf8"),
  );
  await step(root, ["propose", "import", requestId]);
  await step(root, [
    "decision",
    "draft",
    "--id",
    DECISION,
    "--workload",
    "classification",
    "--select",
    LOCAL,
    "--alternative",
    REMOTE,
    "--unresolved",
    OPEN_HARD.join(","),
    "--rationale",
    "Keep classification local first; revisit after evaluation.",
  ]);
  await step(root, ["decision", "propose", DECISION]);
  return root;
}

function hashOf(contract: ProjectContract, id = DECISION): string {
  const hash = computeApprovalHash(contract, id);
  if (!hash.ok) throw new Error("unresolvable");
  return hash.value;
}

async function approve(
  root: string,
  answers: (string | null)[],
  extra: string[] = [],
) {
  const io = scriptedIo({ cwd: root, interactive: true, answers });
  const code = await cli(["approve", DECISION, ...extra], io);
  return { code, io };
}

describe("alternatives with incomplete evidence", () => {
  it("shows two discovered alternatives per workload, their gaps, and no score", async () => {
    const root = await proposedAtlas();
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(["compare", "--json", "--as-of", "2026-09-14T00:00:00Z"], io),
    ).toBe(0);
    const comparison = JSON.parse(io.out()) as {
      workloads: {
        workload_ref: string;
        candidates: {
          candidate_ref: string;
          status: string;
          satisfied: unknown[];
          failed: unknown[];
          unknown: { constraint_ref: string; severity: string }[];
          evidence_required: { code: string }[];
          evidence_on_record: {
            kind: string;
            tier: string;
            cited_for: string[];
          }[];
        }[];
      }[];
    };
    const drafting = comparison.workloads.find(
      (entry) => entry.workload_ref === "response_drafting",
    );
    expect(
      drafting?.candidates.map((entry) => [entry.candidate_ref, entry.status]),
    ).toEqual([
      ["candidate.response_drafting.hybrid_managed", "discovered"],
      ["candidate.response_drafting.local_first", "discovered"],
    ]);
    for (const candidate of drafting?.candidates ?? []) {
      expect(candidate.satisfied).toEqual([]);
      expect(candidate.failed).toEqual([]);
      expect(candidate.unknown.map((entry) => entry.constraint_ref)).toContain(
        "privacy.raw_ticket_remote",
      );
      expect(candidate.evidence_required.map((entry) => entry.code)).toContain(
        "missing_pricing",
      );
    }
    const managed = drafting?.candidates[0];
    expect(managed?.evidence_required.map((entry) => entry.code)).toContain(
      "missing_provider_region",
    );
    const local = drafting?.candidates[1];
    expect(local?.evidence_on_record).toEqual([
      expect.objectContaining({
        kind: "agent_inference",
        tier: "T0",
        cited_for: [],
      }),
    ]);
    const classification = comparison.workloads.find(
      (entry) => entry.workload_ref === "classification",
    );
    expect(classification?.candidates).toHaveLength(2);
    expect(io.out()).not.toMatch(/"score"|"rank"|"overall"/);

    const text = scriptedIo({ cwd: root });
    await cli(["compare", "--workload", "classification"], text);
    expect(text.out()).toContain("No overall score is computed");
  });

  it("shows imported evidence with its tier and freshness, and reopens the gap when it expires", async () => {
    const root = await proposedAtlas();
    const MANAGED = "candidate.response_drafting.hybrid_managed";
    const request = (id: string, expiresAt: string | null) => ({
      id,
      subject: "pricing",
      claim: "Published per-token price for the managed drafting option",
      exact_subject: "example-managed-model",
      exact_version: null,
      source: {
        publisher: "Example Provider",
        locator: "https://provider.example/pricing",
        retrieved_at: "2026-09-01T00:00:00Z",
      },
      applies_to: {
        candidate_ref: MANAGED,
        workload_ref: "response_drafting",
        hardware_ref: null,
        constraint_refs: ["budget.ai_monthly"],
      },
      currency: "USD",
      unit: "1M input tokens",
      amount: 1.5,
      expires_at: expiresAt,
    });
    const file = join(root, "pricing.json");
    await writeFile(
      file,
      JSON.stringify(
        request("evidence.pricing.managed", "2026-10-01T00:00:00Z"),
      ),
    );
    await step(root, ["evidence", "import", file]);

    const compare = async (asOf: string) => {
      const io = scriptedIo({ cwd: root });
      expect(
        await cli(
          [
            "compare",
            "--json",
            "--as-of",
            asOf,
            "--workload",
            "response_drafting",
          ],
          io,
        ),
      ).toBe(0);
      const parsed = JSON.parse(io.out()) as {
        workloads: {
          candidates: {
            candidate_ref: string;
            evidence_on_record: {
              id: string;
              kind: string;
              tier: string;
              freshness: string;
            }[];
            evidence_required: { code: string }[];
          }[];
        }[];
      };
      return parsed.workloads[0]?.candidates.find(
        (entry) => entry.candidate_ref === MANAGED,
      );
    };

    const current = await compare("2026-09-14T00:00:00Z");
    expect(current?.evidence_on_record).toEqual([
      expect.objectContaining({
        id: "evidence.pricing.managed",
        kind: "official_pricing",
        tier: "T2",
        freshness: "current",
      }),
    ]);
    expect(current?.evidence_required.map((entry) => entry.code)).not.toContain(
      "missing_pricing",
    );

    const later = await compare("2026-10-02T00:00:00Z");
    expect(later?.evidence_on_record[0]?.freshness).toBe("expired");
    expect(later?.evidence_required.map((entry) => entry.code)).toContain(
      "stale_evidence",
    );
  });

  it("refuses to mark an unevaluated alternative viable", async () => {
    const root = await proposedAtlas();
    const before = await projectText(root);
    const io = scriptedIo({ cwd: root });
    expect(await cli(["candidate", "status", REMOTE, "viable"], io)).toBe(1);
    expect(io.err()).toContain(
      "cannot be marked viable while hard constraints are not satisfied",
    );
    expect(await projectText(root)).toBe(before);
  });

  it("reports a missing optional tool as a gap without failing", async () => {
    const root = await proposedAtlas();
    const result = await spawnCli(
      ["compare", "--probe-tools", "--workload", "classification"],
      {
        cwd: root,
        env: { PATH: join(root, "no-tools-here") },
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/llmfit: unavailable/);
    expect(result.stdout).toMatch(/promptfoo: unavailable/);
  });
});

describe("decision review and state transitions", () => {
  it("will not propose a decision that hides unknown hard constraints or claims an unbacked pass", async () => {
    const root = await tempDir();
    await step(root, ["init", "--from-contract", ATLAS]);
    await step(root, [
      "decision",
      "draft",
      "--id",
      DECISION,
      "--workload",
      "classification",
      "--select",
      LOCAL,
      "--satisfies",
      "quality.classification_f1",
      "--rationale",
      "Looks fine",
    ]);
    const io = scriptedIo({ cwd: root });
    expect(await cli(["decision", "propose", DECISION], io)).toBe(1);
    expect(io.err()).toContain(
      'claims "quality.classification_f1" is satisfied',
    );
    expect(io.err()).toContain(
      'hard constraint "privacy.raw_ticket_remote" is unknown',
    );
    expect((await contractAt(root)).decisions[0]?.status).toBe("draft");
  });

  it("shows exactly what an approval covers", async () => {
    const root = await proposedAtlas();
    const io = scriptedIo({ cwd: root });
    expect(await cli(["review", DECISION], io)).toBe(0);
    const contract = await contractAt(root);
    const out = io.out();
    expect(out).toContain(`selected candidate: ${LOCAL}`);
    expect(out).toContain(`alternatives: ${REMOTE}`);
    expect(out).toContain("rationale (written by the user)");
    expect(out).toContain(hashOf(contract));
    expect(out).toContain("Approvable: yes");
    expect(out).toContain("does not prove a human is present");
    for (const constraint of OPEN_HARD) expect(out).toContain(constraint);
  });

  it("rejects a proposed decision, and refuses to revive it", async () => {
    const root = await proposedAtlas();
    await step(root, ["decision", "reject", DECISION]);
    expect((await contractAt(root)).decisions[0]?.status).toBe("rejected");
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(["decision", "revise", DECISION, "--select", REMOTE], io),
    ).toBe(1);
    const approving = await approve(root, ["me", "anything"]);
    expect(approving.code).toBe(1);
    expect((await contractAt(root)).approvals).toEqual([]);
  });

  it("revises a proposed decision back to a new draft revision", async () => {
    const root = await proposedAtlas();
    await step(root, [
      "decision",
      "revise",
      DECISION,
      "--alternative",
      "",
      "--rationale",
      "Reconsidered",
    ]);
    const decision = (await contractAt(root)).decisions[0];
    expect(decision).toMatchObject({
      status: "draft",
      revision: 2,
      alternatives: [],
    });
  });
});

describe("interactive approval", () => {
  it("is refused without a terminal, with --yes, or with any approval subcommand", async () => {
    const root = await proposedAtlas();
    const before = await readTree(join(root, ".anvilmark"));
    const plain = scriptedIo({
      cwd: root,
      env: { ANVILMARK_APPROVE: "yes", CI: "true" },
    });
    expect(await cli(["approve", DECISION, "--as", "me"], plain)).toBe(1);
    expect(plain.err()).toContain("needs an interactive terminal");
    for (const bypass of [
      "--yes",
      "-y",
      "--force",
      "--non-interactive",
      "--yes=true",
    ]) {
      const io = scriptedIo({
        cwd: root,
        interactive: true,
        answers: ["me", "x"],
      });
      expect(await cli(["approve", DECISION, bypass], io)).toBe(2);
    }
    expect(
      await cli(["approval", "grant", DECISION], scriptedIo({ cwd: root })),
    ).toBe(2);
    expect(await readTree(join(root, ".anvilmark"))).toEqual(before);

    const binary = await spawnCli(["approve", DECISION, "--as", "me"], {
      cwd: root,
      input: "anything\n",
      env: { ANVILMARK_APPROVE: "yes" },
    });
    expect(binary.code).toBe(1);
    expect(binary.stderr).toContain("needs an interactive terminal");
    expect(await readTree(join(root, ".anvilmark"))).toEqual(before);
  });

  it("defaults to no: an empty answer, a wrong hash or ended input approve nothing", async () => {
    const root = await proposedAtlas();
    const before = await readTree(join(root, ".anvilmark"));
    const hash = hashOf(await contractAt(root));
    for (const answers of [
      ["me", ""],
      ["me", "y"],
      ["me", "yes"],
      ["me", hash.slice(0, 11)],
      ["me", null],
      [null],
      [""],
    ]) {
      const { code, io } = await approve(root, answers);
      expect({ answers, code }).toEqual({ answers, code: 3 });
      expect(io.err()).toMatch(/nothing was (approved|written)/);
    }
    expect(await readTree(join(root, ".anvilmark"))).toEqual(before);
  });

  it("approves the exact displayed content and appends one approval record", async () => {
    const root = await proposedAtlas();
    const hash = hashOf(await contractAt(root));
    const { code, io } = await approve(
      root,
      ["Anvil Tester", hash.slice(0, 12)],
      ["--note", "idea-stage direction"],
    );
    expect(io.err()).toBe("");
    expect(code).toBe(0);
    expect(io.out()).toContain(hash);
    const contract = await contractAt(root);
    expect(contract.decisions[0]).toMatchObject({
      status: "approved",
      revision: 1,
    });
    expect(contract.decisions[0]?.rationale.reviewed_by_user).toBe(true);
    expect(
      contract.workloads.find((entry) => entry.id === "classification")
        ?.current_decision_ref,
    ).toBe(DECISION);
    expect(contract.approvals).toEqual([
      {
        decision_ref: DECISION,
        decision_revision: 1,
        actor: { kind: "local_user", ref: "Anvil Tester" },
        approved_at: expect.any(String),
        note: "idea-stage direction",
        hash_algorithm: "sha-256",
        content_hash: hash,
      },
    ]);
    expect(approvalState(contract, DECISION).state).toBe("current");
  });

  it("refuses when the content changes between display and confirmation", async () => {
    const root = await proposedAtlas();
    const hash = hashOf(await contractAt(root));
    const io = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [
        "me",
        async () => {
          // Someone else changes the selected candidate while the user reads.
          await cli(
            ["candidate", "assume", LOCAL, "changed during review"],
            scriptedIo({ cwd: root }),
          );
          return hash.slice(0, 12);
        },
      ],
    });
    expect(await cli(["approve", DECISION], io)).toBe(1);
    expect(io.err()).toContain("changed while you were reviewing");
    expect((await contractAt(root)).approvals).toEqual([]);
  });

  it("makes the approval non-current when resolved content changes, and keeps history append-only", async () => {
    const root = await proposedAtlas();
    const firstHash = hashOf(await contractAt(root));
    expect((await approve(root, ["me", firstHash.slice(0, 12)])).code).toBe(0);

    const change = scriptedIo({ cwd: root });
    expect(
      await cli(["candidate", "deploy", LOCAL, "--runtime", "vllm"], change),
    ).toBe(0);
    expect(change.out()).toContain("needs a new interactive approval");

    const changed = await contractAt(root);
    expect(changed.decisions[0]).toMatchObject({
      status: "proposed",
      revision: 2,
    });
    expect(changed.decisions[0]?.rationale.reviewed_by_user).toBe(false);
    expect(changed.project.contract_revision).toBe(2);
    expect(approvalState(changed, DECISION).state).toBe("stale");
    expect(changed.approvals).toHaveLength(1);

    const status = scriptedIo({ cwd: root });
    await cli(["approval", "status", DECISION], status);
    expect(status.out()).toContain("approval stale");

    const secondHash = hashOf(changed);
    expect(secondHash).not.toBe(firstHash);
    expect((await approve(root, ["me", secondHash.slice(0, 12)])).code).toBe(0);
    const reapproved = await contractAt(root);
    expect(
      reapproved.approvals.map((entry) => [
        entry.decision_revision,
        entry.content_hash,
      ]),
    ).toEqual([
      [1, firstHash],
      [2, secondHash],
    ]);
    expect(approvalState(reapproved, DECISION).state).toBe("current");

    // The first approved state is still in the history, byte for byte.
    const history = join(root, ".anvilmark", "history");
    const snapshots = (await readdir(history)).filter((name) =>
      name.endsWith(".yaml"),
    );
    const texts = await Promise.all(
      snapshots.map((name) => readFile(join(history, name), "utf8")),
    );
    expect(
      texts.some(
        (text) => text.includes(firstHash) && !text.includes(secondHash),
      ),
    ).toBe(true);
  });

  it("supersedes the earlier approved decision for the same scope", async () => {
    const root = await proposedAtlas();
    expect(
      (await approve(root, ["me", hashOf(await contractAt(root)).slice(0, 12)]))
        .code,
    ).toBe(0);
    await step(root, [
      "decision",
      "draft",
      "--id",
      "decision.classification.v2",
      "--workload",
      "classification",
      "--select",
      REMOTE,
      "--unresolved",
      OPEN_HARD.join(","),
      "--rationale",
      "Managed instead",
    ]);
    await step(root, ["decision", "propose", "decision.classification.v2"]);
    const hash = hashOf(await contractAt(root), "decision.classification.v2");
    const io = scriptedIo({
      cwd: root,
      interactive: true,
      answers: ["me", hash.slice(0, 12)],
    });
    expect(await cli(["approve", "decision.classification.v2"], io)).toBe(0);
    const contract = await contractAt(root);
    expect(contract.decisions.map((entry) => [entry.id, entry.status])).toEqual(
      [
        [DECISION, "superseded"],
        ["decision.classification.v2", "approved"],
      ],
    );
    expect(contract.approvals).toHaveLength(2);
  });

  it("lets a later proposal add alternatives without touching approved content", async () => {
    const root = await proposedAtlas();
    const hash = hashOf(await contractAt(root));
    expect((await approve(root, ["me", hash.slice(0, 12)])).code).toBe(0);
    const exporting = scriptedIo({ cwd: root });
    await cli(["propose", "export", "--task", "propose_candidates"], exporting);
    const requestId =
      /propose import (req-[A-Za-z0-9-]+)/.exec(exporting.out())?.[1] ?? "";
    await writeFile(
      join(
        root,
        ".anvilmark",
        "intelligence",
        "handoff",
        `${requestId}.response.json`,
      ),
      JSON.stringify({
        protocol_version: "0.1.0-draft.1",
        proposed_candidates: [
          {
            id: "candidate.classification.self_hosted",
            workload_ref: "classification",
            component_kind: "model_runtime",
            model_family: null,
            model_version: null,
            deployment_mode: "self_hosted",
            provider: null,
            rationale: null,
          },
        ],
      }),
    );
    await step(root, ["propose", "import", requestId]);
    const contract = await contractAt(root);
    expect(contract.candidates.map((entry) => entry.id)).toContain(
      "candidate.classification.self_hosted",
    );
    expect(approvalState(contract, DECISION).state).toBe("current");
    expect(contract.decisions[0]?.status).toBe("approved");
  });

  it("stays out of MCP and the web package", async () => {
    const sources = [
      ...Object.entries(
        await readTree(join(REPO_ROOT, "packages", "mcp", "src")),
      ),
      ...Object.entries(
        await readTree(join(REPO_ROOT, "packages", "web", "app")),
      ),
    ];
    expect(sources.length).toBeGreaterThan(0);
    for (const [path, text] of sources) {
      expect({ path, approval: /approv/i.test(text) }).toEqual({
        path,
        approval: false,
      });
    }
  });
});
