import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readArtifact } from "@anvilmark/scanner";

import {
  ATLAS,
  REPO_ROOT,
  cleanup,
  readTree,
  spawnCli,
  tempDir,
} from "./helpers.js";

afterEach(cleanup);

/**
 * docs/vnext/milestones/05-atlas-walkthrough.md, run step by step through the
 * BUILT binary in isolated directories.
 */
describe("Milestone 5 Atlas walkthrough through the anvilmark binary", () => {
  it("scans, inspects, repeats byte-identically, goes stale and shows a synthetic approval", async () => {
    const work = await tempDir("anvilmark-m5-walkthrough-");
    const fixtures = join(REPO_ROOT, "packages/scanner/test/fixtures");
    const app = join(work, "app");
    const project = join(work, "project");
    await cp(join(fixtures, "repositories/atlas-support"), app, {
      recursive: true,
    });
    for (const sdk of ["openai", "ollama"]) {
      await cp(
        join(fixtures, "synthetic-sdks", sdk),
        join(app, "node_modules", sdk),
        { recursive: true },
      );
    }
    await mkdir(project);
    const run = async (cwd: string, args: string[], expected = 0) => {
      const result = await spawnCli(args, { cwd });
      expect({ args, code: result.code, stderr: result.stderr }).toEqual({
        args,
        code: expected,
        stderr: expected === 0 ? "" : result.stderr,
      });
      return result;
    };

    // 0–1
    await run(project, [
      "init",
      "--from-contract",
      ATLAS,
      "--intelligence",
      "handoff",
    ]);
    expect((await run(project, ["architecture", "show"])).stdout).toContain(
      "remote-model-provider  external_system  [remote_provider]",
    );
    await run(project, ["generate"]);
    const appBefore = await readTree(app);

    // 2–3
    await cp(
      join(REPO_ROOT, "docs/vnext/fixtures/atlas-scanner.yaml"),
      join(project, ".anvilmark/scanner.yaml"),
    );
    const scanned = await run(project, ["scan"]);
    for (const line of [
      "Repository scan written: .anvilmark/scans/repository-scan.json",
      "repository:   ../app (not in the contract's repository_roots)",
      "observed:     2 client instantiation(s), 3 provider call(s)",
      "data reaching provider calls: 1 raw_reaches, 0 unresolved, 2 sanitized_only, 0 no_declared_data",
      "proposed bindings: 3 (3 declared_mapping, 0 heuristic_association, 0 unresolved)",
      "unknowns: 0 (0 about AI calls, declared data or imports)   analysis errors: 0   limits: 0",
      "completeness: complete_within_supported_scope",
      "These are observations and proposed bindings, not conformance results.",
    ]) {
      expect(scanned.stdout).toContain(line);
    }

    // 4
    const observations = (
      await run(project, ["scan", "show", "--section", "observations"])
    ).stdout;
    expect(observations).toContain(
      "provider_call openai chat.completions.create [inference] to default api.openai.com (openai) model gpt-4o-mini at src/classifier.ts:9:10 in classifyRemotely [deterministic_observation, T3]",
    );
    expect(observations).toContain(
      "provider_call ollama chat [inference] to default 127.0.0.1 (ollama) model llama3.2 at src/classifier.ts:17:23 in classifyTicket",
    );
    expect(observations).toContain(
      "provider_call openai responses.create [inference] to default api.openai.com (openai) model gpt-4o-mini at src/escalation.ts:8:10 in escalateTicket",
    );
    const flows = (await run(project, ["scan", "show", "--section", "flows"]))
      .stdout;
    expect(flows).toContain("raw_customer_ticket raw: source@8 -> sink@8");
    expect(flows).toContain(
      "redacted_customer_ticket sanitized on some paths: source@16 -> sanitizer@16 -> assignment@16 -> argument@22 -> assignment@8 -> sink@9",
    );
    expect(flows).toContain(
      "intraprocedural from classifyRemotely: unresolved (superseded by direct calls)",
    );
    const unknowns = (
      await run(project, ["scan", "show", "--section", "unknowns"])
    ).stdout;
    // server.ts -> classifyTicket -> classifyRemotely is within call depth 3.
    expect(unknowns).toContain(
      "Unknowns about AI calls, declared data or imports (0 location(s); 0 record(s) in total",
    );
    const bindings = (
      await run(project, ["scan", "show", "--section", "bindings"])
    ).stdout;
    expect(bindings).toContain(
      "Proposed bindings (not recorded in the contract)",
    );
    expect(bindings).toContain("unbound: no_decision_for_workload");
    const declarations = (
      await run(project, ["scan", "show", "--section", "declarations"])
    ).stdout;
    expect(declarations).toContain(
      "source source.raw_ticket: resolved at src/intake.ts:7:1 -> ticket-intake (user_declared)",
    );

    // 5
    const first = await readFile(
      join(project, ".anvilmark/scans/repository-scan.json"),
      "utf8",
    );
    expect((await run(project, ["scan"])).stdout).toContain(
      "Repository scan unchanged",
    );
    expect(
      await readFile(
        join(project, ".anvilmark/scans/repository-scan.json"),
        "utf8",
      ),
    ).toBe(first);
    expect((await run(project, ["scan", "--check"])).stdout).toContain(
      ": current",
    );

    // 6
    await writeFile(
      join(app, "src/escalation.ts"),
      `${await readFile(join(app, "src/escalation.ts"), "utf8")}\n// reviewed\n`,
    );
    const stale = await run(project, ["scan", "--check"], 1);
    expect(stale.stdout).toContain("stale\n  repository inputs changed");
    const rescan = JSON.parse((await run(project, ["scan", "--json"])).stdout);
    expect(rescan).toMatchObject({
      status: "written",
      observation: { basis: "clock" },
    });
    expect(
      await readFile(join(project, ".anvilmark/project.yaml"), "utf8"),
    ).toContain("repository_bindings: []");
    const appAfter = await readTree(app);
    expect(Object.keys(appAfter)).toEqual(Object.keys(appBefore));

    // 7
    const approved = join(work, "approved");
    await mkdir(approved);
    const approvedContract = join(work, "approved-atlas.yaml");
    await writeFile(
      approvedContract,
      (
        await readFile(
          join(
            REPO_ROOT,
            "packages/project-contract/test/fixtures/approved-atlas.draft3.yaml",
          ),
          "utf8",
        )
      )
        .replace(
          /^schema: .*$/m,
          "schema: https://anvilmark.dev/schemas/project/0.1.0-draft.5",
        )
        .replace(/^schema_version: .*$/m, "schema_version: 0.1.0-draft.5"),
    );
    await run(approved, ["init", "--from-contract", approvedContract]);
    await cp(
      join(REPO_ROOT, "docs/vnext/fixtures/atlas-scanner.yaml"),
      join(approved, ".anvilmark/scanner.yaml"),
    );
    await run(approved, ["scan", "--observed-at", "2026-09-15T00:00:00Z"]);
    const approvedBindings = (
      await run(approved, ["scan", "show", "--section", "bindings"])
    ).stdout;
    expect(approvedBindings).toContain(
      "decision decision.classification (approved, approval current, selected candidate.classification.remote_unselected)",
    );
    expect(approvedBindings).toContain(
      "provider node ticket-classifier (declared_mapping); workload classification; candidate candidate.classification.local_unselected",
    );
    const reading = readArtifact(
      await readFile(
        join(approved, ".anvilmark/scans/repository-scan.json"),
        "utf8",
      ),
    );
    expect(reading.status).toBe("valid");
    if (reading.status === "valid") {
      expect(
        reading.artifact.proposed_bindings.every(
          (binding) => binding.contract_projection.eligible,
        ),
      ).toBe(true);
      expect(reading.artifact.observation).toEqual({
        observed_at: "2026-09-15T00:00:00Z",
        basis: "explicit",
      });
    }
    expect(
      await readFile(join(approved, ".anvilmark/project.yaml"), "utf8"),
    ).toContain("repository_bindings: []");
  });
});
