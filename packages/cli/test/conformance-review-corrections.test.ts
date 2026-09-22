import {
  mkdir,
  readFile,
  writeFile,
  symlink,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReport } from "@anvilmark/conformance";
import {
  runConformance,
  checkConformance,
  nodeGenerateFs,
  CONFORMANCE_OUTPUT_PATH,
  scanProject,
} from "../src/index.js";
import {
  approvedRemoteContract,
  setupWorkspace,
} from "./conformance-helpers.js";
import { cleanup, cli, scriptedIo, tempDir } from "./helpers.js";

afterEach(cleanup);
const clock = () => "2026-09-15T12:00:00Z";
async function setup() {
  return setupWorkspace(
    "handoff-approved-sanitized",
    await approvedRemoteContract(),
  );
}
async function makeRaw(appDir: string) {
  const file = join(appDir, "src/classify.ts");
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace(
      "content: redacted",
      "content: ticket",
    ),
  );
}

describe("M6 CLI review corrections", () => {
  it("re-reads the selected configuration symlink after it is retargeted", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    const config = join(root, ".anvilmark/scanner.yaml");
    const first = join(root, ".anvilmark/first.yaml");
    const second = join(root, ".anvilmark/second.yaml");
    const original = await readFile(config, "utf8");
    await writeFile(first, original);
    await writeFile(
      second,
      original.replace("export: readTicket", "export: missingTicket"),
    );
    await unlink(config);
    await symlink(first, config);
    expect(
      (await runConformance({ root, repository, clock })).report.summary
        .compliant,
    ).toBe(true);
    await unlink(config);
    await symlink(second, config);
    expect((await checkConformance({ root, clock })).status).toBe("stale");
    expect(
      (await runConformance({ root, clock })).report.summary.compliant,
    ).toBe(false);
  });
  it("detects a source edit in both freshness checks and a new conformance run", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    const first = await runConformance({ root, repository, clock });
    expect(first.report.summary.compliant).toBe(true);
    await makeRaw(repository);
    expect((await checkConformance({ root, clock })).status).toBe("stale");
    const second = await runConformance({ root, clock });
    expect(second.report.summary.fail).toBe(1);
    expect(second.unchanged).toBe(false);
    const io = scriptedIo({ cwd: root, clock });
    expect(await cli(["conformance"], io)).toBe(1);
  });
  it("detects added inputs and configuration changes rather than trusting old scan hashes", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    await runConformance({ root, repository, clock });
    await writeFile(
      join(repository, "src/added.ts"),
      "export const added = 1;",
    );
    expect((await checkConformance({ root, clock })).status).toBe("stale");
    await runConformance({ root, clock });
    const config = join(root, ".anvilmark/scanner.yaml");
    await writeFile(
      config,
      (await readFile(config, "utf8")).replace(
        "export: readTicket",
        "export: missingTicket",
      ),
    );
    expect((await checkConformance({ root, clock })).status).toBe("stale");
    const io = scriptedIo({ cwd: root, clock });
    expect(await cli(["conformance", "--json"], io)).toBe(2);
    expect(JSON.parse(io.out()).summary.compliant).toBe(false);
  });
  it("honors an explicit replacement repository despite an existing artifact/report", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    await scanProject({ root, repository, clock });
    await runConformance({ root, repository, clock });
    const other = await setup();
    await makeRaw(other.appDir);
    const result = await runConformance({
      root,
      repository: other.appDir,
      clock,
    });
    expect(result.report.summary.fail).toBe(1);
    expect(result.report.scan.repository_root).not.toBe("../app");
  });
  it("preserves unchanged report bytes across changing evaluation times", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    const first = await runConformance({ root, repository, clock });
    const before = await readFile(join(root, CONFORMANCE_OUTPUT_PATH), "utf8");
    const second = await runConformance({
      root,
      clock: () => "2026-09-16T00:00:00Z",
    });
    expect(second.unchanged).toBe(true);
    expect(second.report.conformance_hash).toBe(first.report.conformance_hash);
    expect(await readFile(join(root, CONFORMANCE_OUTPUT_PATH), "utf8")).toBe(
      before,
    );
    expect((await checkConformance({ root, clock })).status).toBe("current");
  });
  it("requires explicit selection when stored scan and report describe different repositories", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    await scanProject({ root, repository, clock });
    await runConformance({ root, repository, clock });
    const other = await setup();
    await makeRaw(other.appDir);
    await scanProject({ root, repository: other.appDir, clock });
    await expect(runConformance({ root, clock })).rejects.toThrow(
      /describe different repositories/,
    );
    await expect(checkConformance({ root, clock })).rejects.toThrow(
      /describe different repositories/,
    );
    const result = await runConformance({
      root,
      repository: other.appDir,
      clock,
    });
    expect(result.report.summary.fail).toBe(1);
  });
  it("uses the current default declarations when only the stored declaration choices differ", async () => {
    const { projectDir: root } = await setup();
    const declarations = join(root, ".anvilmark", "scanner.yaml");
    const text = await readFile(declarations, "utf8");
    // A zero-configuration scan first, then declarations are added.
    await unlink(declarations);
    await scanProject({ root, clock });
    await writeFile(declarations, text);
    const first = await runConformance({ root, clock });
    expect(first.report.scan.configuration_source).toBe("file");
    // The stored scan (defaults) and report (the file) now disagree only on
    // declarations; the file is the current default, so no choice is needed.
    await writeFile(declarations, `${text}\n# edited\n`);
    const second = await runConformance({ root, clock });
    expect(second.report.scan.configuration_path).toBe(
      ".anvilmark/scanner.yaml",
    );
    expect((await checkConformance({ root, clock })).status).toBe("current");
  });
  it("recognizes a declared repository through a filesystem alias", async () => {
    const { projectDir, appDir } = await setup();
    const root = await realpath(projectDir);
    const alias = join(await tempDir(), "repository-alias");
    await symlink(appDir, alias);
    const first = await runConformance({ root, repository: alias, clock });
    expect(first.report.summary.compliant).toBe(true);
    expect(first.report.scan.repository_root).toBe("../app");
    expect(
      (await runConformance({ root, repository: appDir, clock })).unchanged,
    ).toBe(true);
  });
  it("reports parse errors separately and exits 2", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    await writeFile(join(repository, "src/broken.ts"), "export const bad = ;");
    const io = scriptedIo({ cwd: root, clock });
    expect(
      await cli(["conformance", "--repository", repository, "--json"], io),
    ).toBe(2);
    expect(JSON.parse(io.out())).toMatchObject({
      summary: { compliant: false },
      results: [],
    });
    expect(JSON.parse(io.out()).analysis_errors.length).toBeGreaterThan(0);
  });
  it.each(["source", "addition", "config", "contract"])(
    "refuses publication when %s changes during evaluation",
    async (kind) => {
      const { projectDir: root, appDir: repository } = await setup();
      await runConformance({ root, repository, clock });
      const before = await readFile(
        join(root, CONFORMANCE_OUTPUT_PATH),
        "utf8",
      );
      await expect(
        runConformance({
          root,
          clock,
          hooks: {
            afterEvaluation: async () => {
              if (kind === "source") await makeRaw(repository);
              if (kind === "addition")
                await writeFile(
                  join(repository, "src/new.ts"),
                  "export const newValue=1;",
                );
              if (kind === "config")
                await writeFile(
                  join(root, ".anvilmark/scanner.yaml"),
                  "invalid: config",
                );
              if (kind === "contract")
                await writeFile(
                  join(root, ".anvilmark/project.yaml"),
                  "invalid: contract",
                );
            },
          },
        }),
      ).rejects.toThrow(/changed while scanning/);
      expect(await readFile(join(root, CONFORMANCE_OUTPUT_PATH), "utf8")).toBe(
        before,
      );
    },
  );
  it("rechecks inputs after the temporary report has been written", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    const fs = {
      ...nodeGenerateFs,
      writeTemporary: async (path: string, text: string) => {
        await nodeGenerateFs.writeTemporary(path, text);
        await makeRaw(repository);
      },
    };
    await expect(
      runConformance({ root, repository, clock, fs }),
    ).rejects.toThrow(/changed while scanning/);
    expect(await readdir(join(root, ".anvilmark/conformance"))).toEqual([]);
  });
  it("does not replace a symlinked report or overwrite a custom scanner configuration", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    const outside = join(await tempDir(), "keep.txt");
    await writeFile(outside, "keep");
    await mkdir(join(root, ".anvilmark/conformance"));
    await symlink(outside, join(root, CONFORMANCE_OUTPUT_PATH));
    await expect(runConformance({ root, repository, clock })).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("keep");
    const fresh = await setup();
    const config = join(
      fresh.projectDir,
      ".anvilmark/conformance/conformance.json",
    );
    await mkdir(join(fresh.projectDir, ".anvilmark/conformance"));
    const text = await readFile(
      join(fresh.projectDir, ".anvilmark/scanner.yaml"),
      "utf8",
    );
    await writeFile(config, text);
    await expect(
      runConformance({
        root: fresh.projectDir,
        repository: fresh.appDir,
        config,
        clock,
      }),
    ).rejects.toThrow();
    expect(await readFile(config, "utf8")).toBe(text);
  });
  it("rejects an old report format and requires regeneration", async () => {
    const { projectDir: root, appDir: repository } = await setup();
    await runConformance({ root, repository, clock });
    const file = join(root, CONFORMANCE_OUTPUT_PATH);
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "anvilmark-conformance-report/0.1.0-draft.2",
        "anvilmark-conformance-report/0.1.0-draft.1",
      ),
    );
    expect((await checkConformance({ root, repository, clock })).status).toBe(
      "invalid",
    );
    await runConformance({ root, repository, clock });
    expect(readReport(await readFile(file, "utf8")).summary.compliant).toBe(
      true,
    );
  });
});
