import { readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { orchestrate, planOrchestration } from "../src/commands/orchestrate.js";
import { SLICE_PROMPT, WORKTREE_META } from "../src/commands/slice-worktree.js";
import { verifySlice } from "../src/commands/verify-slice.js";
import { cleanup, cli, exists, scriptedIo } from "./helpers.js";
import { contract, fixture, git, put, repo } from "./slice-fixture.js";

afterEach(cleanup);

it("plans deterministic parallel waves from an unordered DAG and uses a different reviewer vendor", async () => {
  const plan = fixture();
  const first = plan.plan.tasks[0]!;
  first.contract = { ...contract, reviewerFamily: "openai" };
  plan.plan.tasks.unshift(
    { ...first, id: "docs", dependsOn: ["labels"] },
    { ...first, id: "types", dependsOn: [], model: "claude" },
  );
  const root = await repo(plan);
  const initial = git(root, "worktree", "list", "--porcelain");
  const io = scriptedIo({ cwd: root });
  expect(
    await cli(
      [
        "orchestrate",
        "--prepare-worktrees",
        "--dry-run",
        "--max-parallel",
        "2",
        "--json",
      ],
      io,
    ),
  ).toBe(0);
  const output = JSON.parse(io.out());
  expect(output.waves).toEqual([["labels", "types"], ["docs"]]);
  expect(output.slices[0]).toMatchObject({
    reviewerFamily: "anthropic",
    authorFamily: "openai",
    branch: "anvilmark/slice/labels",
  });
  expect(output.slices[1]).toMatchObject({
    reviewerFamily: "openai",
    authorFamily: "anthropic",
  });
  expect(await orchestrate(root, { dryRun: true, maxParallel: 2 })).toEqual(
    output,
  );
  expect(git(root, "worktree", "list", "--porcelain")).toBe(initial);
  expect(await exists(join(root, ".anvilmark/worktrees"))).toBe(false);
});

it("detects dependency cycles, duplicates and unknown prerequisites before creating worktrees", async () => {
  const plan = fixture();
  const task = plan.plan.tasks[0]!;
  task.dependsOn = ["two"];
  plan.plan.tasks.push({ ...task, id: "two", dependsOn: ["labels"] });
  const root = await repo(plan);
  await expect(orchestrate(root, { prepareWorktrees: true })).rejects.toThrow(
    /cycle/,
  );
  expect(await exists(join(root, ".anvilmark/worktrees"))).toBe(false);
  task.dependsOn = ["unknown"];
  expect(() => planOrchestration(plan, "base", 1)).toThrow(
    /Unknown dependency/,
  );
  task.dependsOn = ["two", "two"];
  expect(() => planOrchestration(plan, "base", 1)).toThrow(
    /Duplicate dependency/,
  );
});

it("prepares an isolated worktree and verifies committed changes from the creation baseline", async () => {
  const root = await repo();
  const result = await orchestrate(root, { prepareWorktrees: true });
  expect(result.prepared).toEqual(["labels"]);
  const slice = join(root, result.slices[0]!.worktree);
  expect(await readFile(join(slice, SLICE_PROMPT), "utf8")).toContain(
    "Reviewer family: anthropic",
  );
  expect(
    JSON.parse(await readFile(join(slice, WORKTREE_META), "utf8")),
  ).toMatchObject({
    sliceId: "labels",
    baseCommit: result.baseCommit,
    reviewerFamily: "anthropic",
  });
  expect(git(slice, "branch", "--show-current").trim()).toBe(
    "anvilmark/slice/labels",
  );
  expect(
    (await orchestrate(root, { prepareWorktrees: true })).prepared,
  ).toEqual([]);
  expect(
    (await verifySlice({ root: slice, sliceId: "labels", runChecks: false }))
      .changedFiles,
  ).toEqual([]);
  await put(slice, "outside.ts", "export const outside = 1;");
  git(slice, "add", "outside.ts");
  git(
    slice,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "Outside contract",
  );
  const completed = await orchestrate(root);
  expect(completed.verification[0]).toMatchObject({
    changedFiles: ["outside.ts"],
    passed: false,
    violations: [{ kind: "out_of_scope_file", path: "outside.ts" }],
  });
  expect(await exists(join(root, "outside.ts"))).toBe(false);
});

it("refuses a symbolic worktree parent and a slice path with no matching git registration", async () => {
  const root = await repo();
  const other = await repo();
  await symlink(other, join(root, ".anvilmark/worktrees"));
  await expect(orchestrate(root, { prepareWorktrees: true })).rejects.toThrow(
    /symlink/,
  );
  expect(git(root, "worktree", "list", "--porcelain")).not.toContain(
    "anvilmark/slice/labels",
  );
  const second = await repo();
  await put(second, ".anvilmark/worktrees/labels/existing", "keep");
  await expect(orchestrate(second, { prepareWorktrees: true })).rejects.toThrow(
    /in use/,
  );
});

it("rejects edits to the worktree's recorded baseline", async () => {
  const root = await repo();
  const result = await orchestrate(root, { prepareWorktrees: true });
  const slice = join(root, result.slices[0]!.worktree);
  await put(slice, "src/index.ts", "export const changed = 1;");
  git(slice, "add", "src/index.ts");
  git(
    slice,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "New baseline",
  );
  const metadata = JSON.parse(
    await readFile(join(slice, WORKTREE_META), "utf8"),
  );
  await put(slice, WORKTREE_META, {
    ...metadata,
    baseCommit: git(slice, "rev-parse", "HEAD").trim(),
  });
  await expect(
    verifySlice({ root: slice, sliceId: "labels", runChecks: false }),
  ).rejects.toThrow(/creation record/);
});
