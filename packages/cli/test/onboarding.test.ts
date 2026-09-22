import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeApprovalHash,
  parseProjectContract,
  unwrap,
} from "@anvilmark/project-contract";
import {
  cleanup,
  cli,
  readTree,
  REPO_ROOT,
  scriptedIo,
  tempDir,
} from "./helpers.js";

afterEach(cleanup);
const script = join(REPO_ROOT, "scripts/atlas-workshop.mjs");
function workshop(args: string[], expected = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  expect(
    { status: result.status, stderr: result.stderr },
    result.stdout,
  ).toEqual({ status: expected, stderr: expected === 0 ? "" : result.stderr });
  return result;
}

describe("M7 local onboarding", () => {
  it("prepares without approval, then checks failure/correction/unknown after a simulated test approval", async () => {
    const root = join(await tempDir(), "Atlas training 'quoted' path");
    const prepared = workshop(["prepare", root]);
    expect(prepared.stdout).toContain("No approval was recorded");
    const file = join(root, ".anvilmark/project.yaml");
    const draft = unwrap(
      parseProjectContract(await readFile(file, "utf8"), "yaml"),
    );
    expect(draft.approvals).toEqual([]);
    expect(draft.decisions[0]?.status).toBe("proposed");
    const before = await readTree(root);
    expect(workshop(["check", root], 2).stderr).toContain(
      "not currently approved",
    );
    expect(await readTree(root)).toEqual(before);
    expect(workshop(["prepare", root], 2).stderr).toContain("EEXIST");
    expect(await readTree(root)).toEqual(before);
    // Test-only terminal simulation, not evidence of a real person's approval.
    const hash = unwrap(computeApprovalHash(draft, "decision.classification"));
    const io = scriptedIo({
      cwd: root,
      interactive: true,
      answers: [hash.slice(0, 12)],
    });
    expect(
      await cli(
        [
          "approve",
          "decision.classification",
          "--as",
          "synthetic-workshop-test",
        ],
        io,
      ),
      io.err(),
    ).toBe(0);
    const approved = await readFile(file, "utf8");
    const reportFile = join(root, ".anvilmark/conformance/conformance.json");
    for (const [variant, exit, verdict] of [
      ["violating", 1, "fail"],
      ["corrected", 0, "pass"],
      ["ambiguous", 2, "unknown"],
    ] as const) {
      workshop(["variant", root, variant]);
      workshop(["check", root], exit);
      const report = JSON.parse(await readFile(reportFile, "utf8"));
      expect(report.results.map((r: { verdict: string }) => r.verdict)).toEqual(
        [verdict, verdict],
      );
      expect(report.analysis_errors).toEqual([]);
      expect(await readFile(file, "utf8")).toBe(approved);
    }
    const modelIo = scriptedIo({ cwd: root });
    expect(
      await cli(
        [
          "candidate",
          "model",
          "candidate.classification.remote_unselected",
          "--model-version",
          "gpt-4o-mini-2024-07-19",
          "--model-mutability",
          "pinned",
        ],
        modelIo,
      ),
      modelIo.err(),
    ).toBe(0);
    const stale = await readTree(root);
    expect(workshop(["check", root], 2).stderr).toContain(
      "not currently approved",
    );
    expect(await readTree(root)).toEqual(stale);
  }, 60000);

  it("preserves manual source edits and refuses symlinked workshop paths", async () => {
    const root = join(await tempDir(), "workshop");
    workshop(["prepare", root]);
    const source = join(root, "app/src/classify.ts");
    await writeFile(source, "// user's work\n");
    expect(workshop(["variant", root, "corrected"], 2).stderr).toContain(
      "manual edits",
    );
    expect(await readFile(source, "utf8")).toBe("// user's work\n");
    const outside = join(await tempDir(), "outside.ts");
    await writeFile(outside, "// keep outside\n");
    await unlink(source);
    await symlink(outside, source);
    expect(workshop(["variant", root, "corrected"], 2).stderr).toContain(
      "symlink",
    );
    expect(await readFile(outside, "utf8")).toBe("// keep outside\n");
  }, 60000);

  it("gives build guidance through committed launchers before any dist files exist", async () => {
    for (const path of [
      "packages/cli/bin/anvilmark.mjs",
      "packages/mcp/bin/anvilmark-project-mcp.mjs",
    ]) {
      const root = await tempDir();
      await mkdir(join(root, "bin"));
      const entry = join(root, "bin/start.mjs");
      await copyFile(join(REPO_ROOT, path), entry);
      const result = spawnSync(process.execPath, [entry, "--help"], {
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("node scripts/setup.mjs");
      expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    }
  });

  it("reports unavailable prerequisites without disclosing environment secrets", () => {
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, "scripts/doctor.mjs"), "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 30000,
        env: {
          PATH: "",
          HOME: process.env.HOME,
          TEST_SECRET: "synthetic-private-value-never-print",
        },
      },
    );
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.checks.find((c: { id: string }) => c.id === "pnpm").ok).toBe(
      false,
    );
    expect(
      report.optional.every(
        (t: { required: boolean; available_on_path: boolean }) =>
          !t.required && !t.available_on_path,
      ),
    ).toBe(true);
    expect(result.stdout + result.stderr).not.toContain(
      "synthetic-private-value-never-print",
    );
  });
});
