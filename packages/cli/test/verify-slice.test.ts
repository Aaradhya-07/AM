import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { SliceVerificationReportSchema } from "@anvilmark/conformance";
import { afterEach, expect, it } from "vitest";

import { verifySlice } from "../src/commands/verify-slice.js";
import { cleanup, cli, scriptedIo } from "./helpers.js";
import { contract, fixture, git, now, put, repo } from "./slice-fixture.js";

afterEach(cleanup);

it("checks both sides of staged renames, forbidden paths and staged dependencies", async () => {
  const root = await repo();
  git(root, "mv", "src/index.ts", "out.ts");
  await put(root, "src/.env.local", "SECRET");
  await put(root, "package.json", { dependencies: { zod: "^5" } });
  git(root, "add", "package.json");
  await put(root, "package.json", {
    name: "label-service",
    dependencies: { zod: "^4" },
  });
  const io = scriptedIo({ cwd: root });
  const result = await cli(
    ["verify-slice", "-C", root, "--slice", "labels", "--no-checks", "--json"],
    io,
  );
  expect(result).toBe(1);
  const report = SliceVerificationReportSchema.parse(JSON.parse(io.out()));
  expect(report.changedFiles).toEqual([
    "out.ts",
    "package.json",
    "src/.env.local",
    "src/index.ts",
  ]);
  expect(report.violations.map(({ kind }) => kind)).toEqual([
    "out_of_scope_file",
    "out_of_scope_file",
    "forbidden_file",
    "unapproved_dependency_change",
  ]);
  expect(io.out()).not.toContain("SECRET");
});

it("rejects changed symlinks and a plan that escapes or links outside the repo", async () => {
  const root = await repo();
  await symlink("/etc/passwd", join(root, "src/link.ts"));
  const report = await verifySlice({
    root,
    sliceId: "labels",
    runChecks: false,
  });
  expect(report.violations).toContainEqual(
    expect.objectContaining({ kind: "forbidden_file", path: "src/link.ts" }),
  );
  expect(
    await cli(
      [
        "verify-slice",
        "-C",
        root,
        "--slice",
        "labels",
        "--plan",
        "../plan.json",
      ],
      scriptedIo({ cwd: root }),
    ),
  ).not.toBe(0);
  await symlink("/etc/passwd", join(root, "linked-plan.json"));
  await expect(
    verifySlice({ root, sliceId: "labels", planPath: "linked-plan.json" }),
  ).rejects.toThrow(/symlink/);
});

it("only treats dependency declarations as dependency changes", async () => {
  const root = await repo();
  await put(root, "package.json", {
    dependencies: { zod: "^4" },
    scripts: { test: "node --test" },
  });
  expect(
    await verifySlice({
      root,
      sliceId: "labels",
      runChecks: false,
      clock: () => now,
    }),
  ).toEqual({
    schemaVersion: "anvilmark.slice-verification.v1",
    verifiedAt: now,
    sliceId: "labels",
    passed: true,
    changedFiles: ["package.json"],
    violations: [],
    checkResults: [],
  });
});

it("bounds check execution and omits untrusted output", async () => {
  const bundle = fixture();
  bundle.plan.tasks[0]!.contract = {
    ...contract,
    verificationCommands: ["printf private-source; exit 2", "sleep 2"],
  };
  const root = await repo(bundle);
  const report = await verifySlice({
    root,
    sliceId: "labels",
    allowShell: true,
    timeoutMs: 100,
  });
  expect(report.checkResults.map(({ exitCode }) => exitCode)).toEqual([2, 124]);
  expect(report.checkResults[0]?.outputExcerpt).not.toContain("private-source");
  const readSafe = await verifySlice({
    root,
    sliceId: "labels",
    runChecks: false,
  });
  expect(readSafe).toMatchObject({ passed: true, checkResults: [] });
});

it("detects a changed local edge on a disallowed planned boundary", async () => {
  const plan = fixture();
  plan.plan.tasks[0]!.contract = {
    ...contract,
    expectedBoundaries: ["public"],
  };
  plan.plan.flows.push({
    from: "src/index.ts",
    to: "src/private.ts",
    data: "order",
    boundary: "private",
  });
  const root = await repo(plan);
  await put(
    root,
    "src/index.ts",
    "import { value } from './private.js'; export { value };",
  );
  await put(root, "src/private.ts", "export const value = 1;");
  const report = await verifySlice({
    root,
    sliceId: "labels",
    runChecks: false,
  });
  expect(report.violations).toContainEqual(
    expect.objectContaining({
      kind: "boundary_violation",
      path: "src/index.ts",
    }),
  );
});
