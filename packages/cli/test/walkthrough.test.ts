import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseProjectContract } from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  ATLAS,
  ATLAS_PROPOSAL,
  cleanup,
  projectText,
  spawnCli,
  tempDir,
} from "./helpers.js";

afterEach(cleanup);

/**
 * The documented Atlas walkthrough, run command by command through the BUILT
 * binary in an isolated project. Approval is the one step it cannot complete:
 * it has no terminal, which is the point.
 */
describe("Atlas walkthrough through the anvilmark binary", () => {
  it("goes from an imported draft to a reviewed, proposed decision", async () => {
    const parent = await tempDir();
    const root = join(parent, "atlas");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(root));
    const run = async (args: string[], expected = 0) => {
      const result = await spawnCli(args, { cwd: root });
      expect({ args, code: result.code, stderr: result.stderr }).toEqual({
        args,
        code: expected,
        stderr: expected === 0 ? "" : result.stderr,
      });
      return result;
    };

    await run(["init", "--from-contract", ATLAS, "--intelligence", "handoff"]);
    const list = await run(["intelligence", "list"]);
    expect(list.stdout).toContain("Selected: handoff");
    expect(list.stdout).toContain(
      "no providers registered, nothing remote can run",
    );

    const preview = await run([
      "propose",
      "preview",
      "--task",
      "propose_candidates",
    ]);
    expect(preview.stdout).toContain(
      "Preview only: nothing was sent or written.",
    );

    const exported = await run([
      "propose",
      "export",
      "--task",
      "propose_candidates",
    ]);
    const requestId = /propose import (req-[A-Za-z0-9-]+)/.exec(
      exported.stdout,
    )?.[1];
    expect(requestId).toBeDefined();
    const requestFile = join(
      root,
      ".anvilmark",
      "intelligence",
      "handoff",
      `${requestId}.request.json`,
    );
    const handoff = JSON.parse(await readFile(requestFile, "utf8")) as {
      response_file: string;
    };
    await writeFile(
      join(root, handoff.response_file),
      await readFile(ATLAS_PROPOSAL, "utf8"),
    );

    const imported = await run(["propose", "import", requestId ?? ""]);
    expect(imported.stdout).toContain("2 candidate(s)");

    const compare = await run(["compare", "--workload", "response_drafting"]);
    expect(compare.stdout).toContain(
      "candidate.response_drafting.local_first [discovered]",
    );
    expect(compare.stdout).toContain(
      "candidate.response_drafting.hybrid_managed [discovered]",
    );
    expect(compare.stdout).toContain("Satisfied: none");
    expect(compare.stdout).toContain("missing_provider_region");

    await run([
      "candidate",
      "deploy",
      "candidate.classification.local_unselected",
      "--runtime",
      "ollama",
    ]);
    await run([
      "decision",
      "draft",
      "--id",
      "decision.classification",
      "--workload",
      "classification",
      "--select",
      "candidate.classification.local_unselected",
      "--alternative",
      "candidate.classification.remote_unselected",
      "--rationale",
      "Keep classification local first; revisit after evaluation.",
    ]);
    const refused = await run(
      ["decision", "propose", "decision.classification"],
      1,
    );
    expect(refused.stderr).toContain("list it with --unresolved");
    await run([
      "decision",
      "revise",
      "decision.classification",
      "--unresolved",
      "privacy.raw_ticket_remote,availability.classification_provider,quality.classification_f1,quality.schema_validity",
    ]);
    await run(["decision", "propose", "decision.classification"]);

    const review = await run(["review", "decision.classification"]);
    expect(review.stdout).toMatch(/Approval hash[^\n]*\n\s+[0-9a-f]{64}/);
    const approve = await run(["approve", "decision.classification"], 1);
    expect(approve.stderr).toContain("needs an interactive terminal");

    await run(["validate"]);
    const history = await run(["history"]);
    expect(history.stdout).toContain(
      "provenance: intelligence_proposal via handoff",
    );

    const final = parseProjectContract(await projectText(root), "yaml");
    expect(final.ok).toBe(true);
    if (!final.ok) return;
    expect(final.value.decisions[0]).toMatchObject({
      status: "proposed",
      revision: 2,
    });
    expect(final.value.approvals).toEqual([]);
  });
});
