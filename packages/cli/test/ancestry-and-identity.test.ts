import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseProjectContract } from "@anvilmark/project-contract";
import type { ProjectContract } from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import { candidateOrigins, committedProposals } from "../src/provenance.js";
import type { HistoryEntry, HistoryRecord, StoreFs } from "../src/store.js";
import { classifyHistory, loadProject, nodeStoreFs } from "../src/store.js";
import { setCandidateModel } from "../src/workflow/edit.js";
import { cleanup, cli, projectText, scriptedIo, tempDir } from "./helpers.js";

/**
 * Regressions for the review of f66bae6:
 *   A. a failed proposal must never become accepted because project.yaml was
 *      edited outside the CLI and another command then saved;
 *   B. a pinning claim must not carry over to a different model identity.
 */

afterEach(cleanup);

const QUESTION = "This failed proposal question must never be applied.";
const PROPOSAL = {
  protocol_version: "0.1.0-draft.1",
  questions: [QUESTION],
  proposed_candidates: [
    {
      id: "candidate.suggested",
      workload_ref: null,
      component_kind: "model_runtime",
      model_family: null,
      model_version: null,
      deployment_mode: "local",
      provider: null,
      rationale: "Uncommitted candidate rationale",
    },
  ],
  rationale: {
    summary: "RATIONALE FROM FAILED IMPORT",
    generated_by: "review-fixture",
  },
};

async function ok(root: string, argv: readonly string[]) {
  const io = scriptedIo({ cwd: root });
  const code = await cli(argv, io);
  expect({ argv, code, err: io.err() }).toEqual({ argv, code: 0, err: "" });
  return io;
}

async function contractAt(root: string): Promise<ProjectContract> {
  const parsed = parseProjectContract(await projectText(root), "yaml");
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

async function meta(root: string, revision: number): Promise<HistoryEntry> {
  return JSON.parse(
    await readFile(
      join(
        root,
        ".anvilmark",
        "history",
        `r${String(revision).padStart(6, "0")}.json`,
      ),
      "utf8",
    ),
  ) as HistoryEntry;
}

/** Initialize, export a handoff request and write PROPOSAL as its response. */
async function exported(): Promise<{ root: string; requestId: string }> {
  const root = await tempDir();
  await ok(root, [
    "init",
    "--idea",
    "Synthetic review fixture",
    "--intelligence",
    "handoff",
  ]);
  const out = (
    await ok(root, ["propose", "export", "--task", "clarify_intent"])
  ).out();
  const requestId = /propose import (req-[A-Za-z0-9-]+)/.exec(out)?.[1] ?? "";
  await writeFile(
    join(
      root,
      ".anvilmark",
      "intelligence",
      "handoff",
      `${requestId}.response.json`,
    ),
    JSON.stringify(PROPOSAL),
  );
  return { root, requestId };
}

const failingReplace = (alsoFail?: (path: string) => boolean): StoreFs => ({
  writeExclusive: async (path, text) => {
    if (alsoFail?.(path) === true) {
      throw new Error(`simulated failure writing ${path}`);
    }
    await nodeStoreFs.writeExclusive(path, text);
  },
  replace: async () => {
    throw new Error("simulated rename failure");
  },
});

async function failedImport(storeFs: StoreFs) {
  const { root, requestId } = await exported();
  const before = await projectText(root);
  const io = scriptedIo({ cwd: root });
  expect(await cli(["propose", "import", requestId], io, { storeFs })).toBe(1);
  expect(await projectText(root)).toBe(before);
  const directory = join(root, ".anvilmark", "intelligence", "proposals");
  const attempt = JSON.parse(
    await readFile(
      join(directory, (await readdir(directory))[0] ?? ""),
      "utf8",
    ),
  ) as { outcome: string; proposal_id: string };
  expect(attempt.outcome).toBe("not_committed");
  return { root, proposalId: attempt.proposal_id, before };
}

const MANUAL_NOTE = "\n# Manual note after the failed import\n";

describe("A: a failed proposal never becomes accepted after a manual edit", () => {
  it("excludes it during the edit, after an ordinary save, from origins and from rationale reuse", async () => {
    const { root, proposalId } = await failedImport(failingReplace());
    await appendFile(join(root, ".anvilmark", "project.yaml"), MANUAL_NOTE);

    const duringEdit = await loadProject(root);
    expect(
      (await committedProposals(duringEdit)).map(
        (entry) => entry.record.proposal_id,
      ),
    ).toEqual([]);
    expect([...(await candidateOrigins(duringEdit))]).toEqual([]);

    // The user adds a candidate that happens to reuse the failed proposal's id.
    const added = await ok(root, [
      "candidate",
      "add",
      "--id",
      "candidate.suggested",
      "--component-kind",
      "model_runtime",
      "--mode",
      "local",
    ]);
    const afterSave = await loadProject(root);
    expect(
      (await committedProposals(afterSave)).map(
        (entry) => entry.record.proposal_id,
      ),
    ).toEqual([]);
    expect([...(await candidateOrigins(afterSave))]).toEqual([]);

    const reuse = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "decision",
          "draft",
          "--id",
          "decision.user",
          "--project",
          "--select",
          "candidate.suggested",
          "--rationale-from-proposal",
          proposalId,
        ],
        reuse,
      ),
    ).toBe(1);
    expect(reuse.err()).toContain(
      "is not an accepted proposal in this project's committed history",
    );

    // Truthful ancestry: the save builds on r1, never on the failed r2.
    const saved = afterSave.history.head;
    expect(saved?.revision).toBe(3);
    expect((await meta(root, 3)).parent).toBe(1);
    expect(added.out()).toContain(
      "edited outside the CLI since committed revision r1",
    );
    expect((await contractAt(root)).intent.unresolved_questions).not.toContain(
      QUESTION,
    );

    // The review shows the user's candidate as the user's, not the proposal's.
    await ok(root, [
      "decision",
      "draft",
      "--id",
      "decision.user",
      "--project",
      "--select",
      "candidate.suggested",
      "--rationale",
      "Chosen by the user.",
    ]);
    await ok(root, ["decision", "propose", "decision.user"]);
    const review = (await ok(root, ["review", "decision.user"])).out();
    expect(review).toContain("origin: not added by an intelligence proposal");
    expect(review).not.toContain("Uncommitted candidate rationale");

    const history = (await ok(root, ["history"])).out();
    expect(history).toMatch(/r2 abandoned: propose import/);
  });

  it("keeps genuinely committed provenance usable after a manual edit", async () => {
    const { root, requestId } = await exported();
    await ok(root, ["propose", "import", requestId]);
    const proposalId =
      (await committedProposals(await loadProject(root)))[0]?.record
        .proposal_id ?? "";
    expect(proposalId).toMatch(/^prop-/);
    await appendFile(join(root, ".anvilmark", "project.yaml"), MANUAL_NOTE);

    const duringEdit = await loadProject(root);
    expect(duringEdit.editedOutsideCli).toBe(true);
    expect(
      (await committedProposals(duringEdit)).map(
        (entry) => entry.record.proposal_id,
      ),
    ).toEqual([proposalId]);
    expect(
      (await candidateOrigins(duringEdit)).get("candidate.suggested")
        ?.proposal_id,
    ).toBe(proposalId);

    await ok(root, [
      "decision",
      "draft",
      "--id",
      "decision.suggested",
      "--project",
      "--select",
      "candidate.suggested",
      "--rationale-from-proposal",
      proposalId,
    ]);
    expect(
      (await contractAt(root)).decisions[0]?.rationale.generated_by,
    ).toContain(proposalId);
    expect((await meta(root, 3)).parent).toBe(2);
  });

  it("classifies an unmarked failed revision from project.yaml and marks it at the next save", async () => {
    // Both the replacement and the abandoned marker fail: nothing on disk says
    // what happened, but project.yaml still matches r1.
    const { root } = await failedImport(
      failingReplace((path) => path.endsWith(".abandoned.json")),
    );
    const loaded = await loadProject(root);
    expect(
      loaded.history.revisions.map((entry) => [
        entry.entry.revision,
        entry.standing,
      ]),
    ).toEqual([
      [1, "committed"],
      [2, "uncommitted"],
    ]);
    await ok(root, [
      "candidate",
      "add",
      "--id",
      "candidate.user",
      "--component-kind",
      "model_runtime",
      "--mode",
      "local",
    ]);
    expect((await meta(root, 3)).parent).toBe(1);
    expect(await readdir(join(root, ".anvilmark", "history"))).toContain(
      "r000002.abandoned.json",
    );
    expect(await committedProposals(await loadProject(root))).toEqual([]);
  });

  it("refuses to save over an ambiguous revision until the user resolves it", async () => {
    const { root, proposalId } = await failedImport(
      failingReplace((path) => path.endsWith(".abandoned.json")),
    );
    await appendFile(join(root, ".anvilmark", "project.yaml"), MANUAL_NOTE);
    const edited = await projectText(root);

    const loaded = await loadProject(root);
    expect(loaded.history.ambiguous.map((entry) => entry.revision)).toEqual([
      2,
    ]);
    expect(await committedProposals(loaded)).toEqual([]);

    const save = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "candidate",
          "add",
          "--id",
          "candidate.suggested",
          "--component-kind",
          "model_runtime",
          "--mode",
          "local",
        ],
        save,
      ),
    ).toBe(1);
    expect(save.err()).toContain("the project history is ambiguous");
    expect(save.err()).toContain('"anvilmark history resolve r2 --adopt"');
    expect(save.err()).toContain('"anvilmark history resolve r2 --abandon"');
    expect(await projectText(root)).toBe(edited);

    const reuse = scriptedIo({ cwd: root });
    await ok(root, ["history"]);
    expect(
      await cli(
        [
          "decision",
          "draft",
          "--id",
          "d",
          "--project",
          "--select",
          "x",
          "--rationale-from-proposal",
          proposalId,
        ],
        reuse,
      ),
    ).toBe(1);
    expect(reuse.err()).toContain("whose commit is ambiguous");

    const wrong = scriptedIo({ cwd: root });
    expect(await cli(["history", "resolve", "r1", "--adopt"], wrong)).toBe(1);
    expect(wrong.err()).toContain("only an ambiguous revision can be resolved");

    await ok(root, ["history", "resolve", "r2", "--abandon"]);
    await ok(root, [
      "candidate",
      "add",
      "--id",
      "candidate.suggested",
      "--component-kind",
      "model_runtime",
      "--mode",
      "local",
    ]);
    expect((await meta(root, 3)).parent).toBe(1);
    expect(await committedProposals(await loadProject(root))).toEqual([]);
  });

  it("recovers a commit whose completion marker could not be written", async () => {
    const { root, requestId } = await exported();
    const markerFails: StoreFs = {
      writeExclusive: async (path, text) => {
        if (path.endsWith(".committed.json") && path.includes("r000002")) {
          throw new Error("simulated marker failure");
        }
        await nodeStoreFs.writeExclusive(path, text);
      },
      replace: nodeStoreFs.replace,
    };
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(["propose", "import", requestId], io, { storeFs: markerFails }),
    ).toBe(0);
    expect(io.out()).toContain(
      "warning: the commit succeeded, but its completion marker could not be written",
    );
    // project.yaml holds r2 byte for byte, so r2 is committed without its marker.
    const loaded = await loadProject(root);
    expect(loaded.history.head?.revision).toBe(2);
    expect((await committedProposals(loaded)).length).toBe(1);

    // Hand-edited before any command restores the marker: now genuinely
    // ambiguous, and the user's statement settles it.
    await appendFile(join(root, ".anvilmark", "project.yaml"), MANUAL_NOTE);
    expect(
      (await loadProject(root)).history.ambiguous.map(
        (entry) => entry.revision,
      ),
    ).toEqual([2]);
    await ok(root, ["history", "resolve", "r2", "--adopt"]);
    const adopted = await loadProject(root);
    expect((await committedProposals(adopted)).length).toBe(1);
    await ok(root, ["intent", "add-user", "operator"]);
    expect((await meta(root, 3)).parent).toBe(2);
  });

  it("restores a missing completion marker at the next save when nothing was edited", async () => {
    const { root, requestId } = await exported();
    const markerFails: StoreFs = {
      writeExclusive: async (path, text) => {
        if (path.endsWith("r000002.committed.json"))
          throw new Error("simulated marker failure");
        await nodeStoreFs.writeExclusive(path, text);
      },
      replace: nodeStoreFs.replace,
    };
    expect(
      await cli(["propose", "import", requestId], scriptedIo({ cwd: root }), {
        storeFs: markerFails,
      }),
    ).toBe(0);
    await ok(root, ["intent", "add-user", "operator"]);
    expect(await readdir(join(root, ".anvilmark", "history"))).toContain(
      "r000002.committed.json",
    );
    expect((await meta(root, 3)).parent).toBe(2);
  });
});

describe("history classification rules", () => {
  const entry = (
    revision: number,
    parent: number | null,
    legacy = true,
  ): HistoryRecord => ({
    entry: {
      format: legacy
        ? "anvilmark-state-revision/0.1"
        : "anvilmark-state-revision/0.2",
      revision,
      parent,
      created_at: "2026-09-14T00:00:00Z",
      command: "test",
      summary: `r${revision}`,
      notices: [],
      provenance: null,
      content_digest: `sha256:${String(revision).repeat(64).slice(0, 64)}`,
    },
    legacy,
    committedMarker: false,
    abandonedMarker: false,
  });
  const digest = (revision: number) =>
    `sha256:${String(revision).repeat(64).slice(0, 64)}`;
  const standings = (state: ReturnType<typeof classifyHistory>) =>
    state.revisions.map(
      (revision) => `r${revision.entry.revision}:${revision.standing}`,
    );

  it("anchors pre-marker history at the snapshot project.yaml matches", () => {
    const records = [entry(1, null), entry(2, 1), entry(3, 2)];
    expect(standings(classifyHistory(records, digest(3)))).toEqual([
      "r1:committed",
      "r2:committed",
      "r3:committed",
    ]);
    // project.yaml still holds r2: r3's commit never replaced it.
    const orphan = classifyHistory(records, digest(2));
    expect(standings(orphan)).toEqual([
      "r1:committed",
      "r2:committed",
      "r3:uncommitted",
    ]);
    expect(orphan.latest?.revision).toBe(2);
  });

  it("never promotes the newest pre-marker snapshot when project.yaml matches nothing", () => {
    const state = classifyHistory(
      [entry(1, null), entry(2, 1), entry(3, 2)],
      "sha256:edited",
    );
    expect(standings(state)).toEqual([
      "r1:committed",
      "r2:committed",
      "r3:ambiguous",
    ]);
    expect(state.latest?.revision).toBe(2);
  });

  it("treats marked revisions as committed and an abandoned marker as final", () => {
    const committed = { ...entry(1, null, false), committedMarker: true };
    const abandoned = { ...entry(2, 1, false), abandonedMarker: true };
    const state = classifyHistory([committed, abandoned], "sha256:edited");
    expect(standings(state)).toEqual(["r1:committed", "r2:abandoned"]);
    expect(state.ambiguous).toEqual([]);
    expect(state.latest?.revision).toBe(1);
  });
});

describe("B: a pinning claim does not carry over to a different model identity", () => {
  async function pinnedProject(): Promise<string> {
    const root = await tempDir();
    await ok(root, ["init", "--idea", "Synthetic model identity fixture"]);
    await ok(root, [
      "candidate",
      "add",
      "--id",
      "candidate.model",
      "--component-kind",
      "model_runtime",
      "--mode",
      "local",
      "--model",
      "model-a",
      "--model-version",
      "release-1",
      "--model-mutability",
      "pinned",
      "--quantization",
      "Q4_K_M",
    ]);
    return root;
  }
  const modelOf = async (root: string) =>
    (await contractAt(root)).candidates[0]?.model;

  it("refuses a family change that keeps the version without a fresh choice", async () => {
    const root = await pinnedProject();
    const before = await projectText(root);
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["candidate", "model", "candidate.model", "--model", "model-b"],
        io,
      ),
    ).toBe(1);
    expect(io.err()).toContain(
      'the model family changes to "model-b" from "model-a"',
    );
    expect(io.err()).toContain(
      "--model-mutability pinned|floating must be stated again for model-b@release-1",
    );
    expect(await projectText(root)).toBe(before);
  });

  it.each(["pinned", "floating"] as const)(
    "records a family change with an explicit %s choice",
    async (choice) => {
      const root = await pinnedProject();
      const out = (
        await ok(root, [
          "candidate",
          "model",
          "candidate.model",
          "--model",
          "model-b",
          "--model-mutability",
          choice,
        ])
      ).out();
      expect(await modelOf(root)).toMatchObject({
        family: "model-b",
        version: "release-1",
        version_mutability: choice,
      });
      expect(out).toContain(`model-b@release-1 [${choice}]`);
    },
  );

  it("refuses a version change without a fresh choice", async () => {
    const root = await pinnedProject();
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "candidate",
          "model",
          "candidate.model",
          "--model-version",
          "release-2",
        ],
        io,
      ),
    ).toBe(1);
    expect(io.err()).toContain('the model version changes to "release-2"');
    expect((await modelOf(root))?.version).toBe("release-1");
  });

  it("keeps the pin for a no-op restatement and a quantization-only change", async () => {
    const root = await pinnedProject();
    await ok(root, [
      "candidate",
      "model",
      "candidate.model",
      "--model",
      "model-a",
      "--model-version",
      "release-1",
    ]);
    expect(await modelOf(root)).toMatchObject({
      family: "model-a",
      version: "release-1",
      version_mutability: "pinned",
    });
    await ok(root, [
      "candidate",
      "model",
      "candidate.model",
      "--quantization",
      "Q8_0",
    ]);
    expect(await modelOf(root)).toMatchObject({
      version_mutability: "pinned",
      quantization: "Q8_0",
    });
  });

  it("clears licence evidence that described the previous family", () => {
    const contract = {
      project: { updated_at: "2026-09-14T00:00:00Z" },
      candidates: [
        {
          id: "candidate.model",
          model: {
            family: "model-a",
            version: "release-1",
            version_mutability: "pinned",
            quantization: null,
            license_evidence_ref: "evidence.licence.model_a",
          },
        },
      ],
    } as unknown as ProjectContract;
    const result = setCandidateModel(
      contract,
      "candidate.model",
      { family: "model-b", mutability: "pinned" },
      "2026-09-14T01:00:00Z",
    );
    expect(
      result.contract.candidates[0]?.model?.license_evidence_ref,
    ).toBeNull();
    expect(result.notices.join(" ")).toContain(
      'described "model-a", not "model-b"',
    );
  });

  it("documents the rule in the command help", async () => {
    const root = await tempDir();
    const io = scriptedIo({ cwd: root });
    expect(await cli(["candidate", "--help"], io)).toBe(0);
    expect(io.out()).toContain("whenever the family or the");
    expect(io.out()).toContain(
      "version changes, because a pin describes one exact family@version",
    );
  });
});
