import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWebReviewBundle } from "@anvilmark/conformance";
import type { WebReviewEnvelope } from "@anvilmark/conformance";
import { parseProjectContract, unwrap } from "@anvilmark/project-contract";
import { cleanup, cli, scriptedIo } from "./helpers.js";
import {
  approvedRemoteContract,
  setupWorkspace,
} from "./conformance-helpers.js";

afterEach(cleanup);

/** A workspace with a stored scan and conformance report. */
async function checkedWorkspace(fixture = "handoff-approved-sanitized") {
  const contractYaml = await approvedRemoteContract();
  const workspace = await setupWorkspace(fixture, contractYaml);
  const { projectDir, appDir } = workspace;

  const scanCode = await cli(
    ["scan", "--repository", appDir],
    scriptedIo({ cwd: projectDir }),
  );
  expect(scanCode).toBe(0);

  const confCode = await cli(
    [
      "conformance",
      "--repository",
      appDir,
      "--evaluated-at",
      "2026-09-15T12:00:00Z",
    ],
    scriptedIo({ cwd: projectDir }),
  );
  expect(confCode).toBe(0);

  return { ...workspace, contractYaml };
}

async function exported(
  projectDir: string,
  args: readonly string[],
): Promise<WebReviewEnvelope> {
  const io = scriptedIo({ cwd: projectDir });
  const code = await cli(["export", ...args], io);
  expect({ code, err: io.err() }).toEqual({ code: 0, err: "" });
  const raw = JSON.parse(
    await readFile(
      join(projectDir, ".anvilmark", "review-bundle.json"),
      "utf8",
    ),
  );
  const reading = readWebReviewBundle(raw);
  if (reading.status === "invalid") throw new Error(reading.errors.join("\n"));
  return reading.bundle;
}

describe("CLI Export Command", () => {
  it("prints help on --help", async () => {
    const io = scriptedIo({ cwd: process.cwd() });
    const code = await cli(["export", "--help"], io);
    expect(code).toBe(0);
    expect(io.out()).toContain("Usage:\n  anvilmark export");
  });

  it("exports a review bundle for an initialized project with conformance scan", async () => {
    const { projectDir, contractYaml } = await checkedWorkspace();
    const contract = unwrap(parseProjectContract(contractYaml, "yaml"));

    const bundle = await exported(projectDir, ["--include-source"]);
    expect(bundle.project.id).toBe(contract.project.id);
    expect(bundle.projection).toBe("local");
    expect(bundle.scan).toMatchObject({
      status: "available",
      freshness: "current",
      problems: [],
    });
    expect(bundle.report).toMatchObject({
      status: "available",
      freshness: "current",
      problems: [],
    });
    expect(bundle.manifest.has_source).toBe(true);
    expect(Object.keys(bundle.sources ?? {})).toContain("src/classify.ts");
    expect(bundle.manifest.sources_omitted).toEqual([]);
  });

  it("exports bundle as JSON to stdout with --json", async () => {
    const contract = await approvedRemoteContract();
    const { projectDir } = await setupWorkspace(
      "handoff-approved-sanitized",
      contract,
    );

    const io = scriptedIo({ cwd: projectDir });
    const code = await cli(["export", "--json"], io);
    expect(code).toBe(0);

    const parsed = JSON.parse(io.out());
    const reading = readWebReviewBundle(parsed);
    expect(reading.status).toBe("valid");
    if (reading.status === "valid") {
      expect(reading.bundle.report.status).toBe("missing");
    }
  });

  it("refuses to combine --json with --out", async () => {
    const io = scriptedIo({ cwd: process.cwd() });
    expect(await cli(["export", "--json", "--out", "bundle.json"], io)).toBe(2);
    expect(io.err()).toContain("do not combine it with --out");
  });

  it("refuses a stale report unless --allow-stale marks it", async () => {
    const { projectDir, appDir } = await checkedWorkspace();
    await appendFile(
      join(appDir, "src", "classify.ts"),
      "\n// edited after the check\n",
    );

    const refused = scriptedIo({ cwd: projectDir });
    expect(await cli(["export"], refused)).toBe(1);
    expect(refused.err()).toContain("conformance report is stale");
    expect(refused.err()).toContain("--allow-stale");

    const bundle = await exported(projectDir, [
      "--allow-stale",
      "--include-source",
    ]);
    expect(bundle.report.freshness).toBe("stale");
    expect(bundle.report.problems.length).toBeGreaterThan(0);
    expect(bundle.scan.freshness).toBe("stale");
    // The edited file no longer matches what was scanned.
    expect(bundle.sources?.["src/classify.ts"]).toBeUndefined();
    expect(bundle.manifest.sources_omitted).toContainEqual({
      path: "src/classify.ts",
      reason: "modified_since_scan",
    });
  });

  it("leaves out a stale scan when the report is current", async () => {
    const { projectDir, appDir } = await checkedWorkspace();
    // Re-check after editing, so only the stored scan is out of date.
    await appendFile(join(appDir, "src", "classify.ts"), "\n// edited\n");
    expect(
      await cli(
        ["conformance", "--repository", appDir],
        scriptedIo({ cwd: projectDir }),
      ),
    ).toBe(0);

    const bundle = await exported(projectDir, []);
    expect(bundle.report.freshness).toBe("current");
    expect(bundle.scan).toMatchObject({ status: "missing", artifact: null });
    expect(bundle.scan.problems.join("\n")).toContain("stored scan is stale");
  });

  it("fails with --require-report when there is no current report", async () => {
    const { projectDir } = await setupWorkspace(
      "handoff-approved-sanitized",
      await approvedRemoteContract(),
    );
    const io = scriptedIo({ cwd: projectDir });
    expect(await cli(["export", "--require-report"], io)).toBe(1);
    expect(io.err()).toContain("no conformance report");
  });

  it("redacts the contract with --shareable", async () => {
    const { projectDir } = await checkedWorkspace();
    const bundle = await exported(projectDir, ["--shareable"]);
    expect(bundle.projection).toBe("shareable");
    expect(bundle.contract.redactions).toContain("project.repository_roots");
    expect(bundle.contract.canonical.project.repository_roots).toEqual([]);
    expect(bundle.report.freshness).toBe("current");
  });
});
