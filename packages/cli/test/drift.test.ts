import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ACTIVE_PLAN } from "../src/commands/slice-storage.js";
import {
  ArchitectureDriftReportSchema,
  measureDrift,
} from "../src/commands/drift.js";
import { cleanup, cli, scriptedIo } from "./helpers.js";
import { fixture, now, put, repo } from "./slice-fixture.js";

afterEach(cleanup);

it("returns the exact v1 schema without an active plan and refuses a linked plan", async () => {
  const root = await repo(null);
  const io = scriptedIo({ cwd: root, clock: () => now });
  expect(await cli(["drift", "--json"], io)).toBe(0);
  expect(ArchitectureDriftReportSchema.parse(JSON.parse(io.out()))).toEqual({
    schemaVersion: "anvilmark.drift-report.v1",
    scannedAt: now,
    planTitle: "",
    status: "no_active_plan",
    plannedFlowsCount: 0,
    observedEdgesCount: 0,
    items: [],
  });
  await put(root, ".anvilmark/development/keep.json", {});
  await symlink("/etc/passwd", join(root, ACTIVE_PLAN));
  await expect(measureDrift(root)).rejects.toThrow(/symlink/);
});

it("matches declared local imports and flags missing edges, bypasses and unapproved AI SDKs", async () => {
  const bundle = fixture();
  bundle.plan.flows.push({
    from: "src/index.ts",
    to: "src/private.ts",
    data: "orders",
    boundary: "internal",
  });
  const root = await repo(bundle);
  await put(
    root,
    "src/index.ts",
    "import { value } from './private.js'; export { value };",
  );
  await put(root, "src/private.ts", "export const value = 1;");
  expect(await measureDrift(root, now)).toMatchObject({
    status: "aligned",
    plannedFlowsCount: 1,
    observedEdgesCount: 1,
    items: [],
  });
  await put(root, "src/index.ts", "export const greeting = 1;");
  await put(
    root,
    "src/other.ts",
    "import { value } from './private.js'; export { value };",
  );
  await put(root, "package.json", {
    name: "test",
    dependencies: { openai: "^4" },
  });
  const report = ArchitectureDriftReportSchema.parse(
    await measureDrift(root, now),
  );
  expect(report.status).toBe("drifted");
  expect(report.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "missing_planned_flow",
        boundary: "internal",
      }),
      expect.objectContaining({
        kind: "boundary_bypass",
        evidencePaths: ["src/other.ts"],
      }),
      expect.objectContaining({
        kind: "unapproved_ai_sdk",
        to: "openai",
        evidencePaths: ["package.json"],
      }),
    ]),
  );
});
