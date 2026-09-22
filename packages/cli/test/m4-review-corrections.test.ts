import {
  cp,
  link,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  computeApprovalHash,
  parseProjectContract,
  toNormalizedYaml,
} from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  PACKAGE_ROOT,
  approvedProject,
  atlasProject,
  cleanup,
  cli,
  exists,
  projectText,
  scriptedIo,
  steppingClock,
  tempDir,
} from "./helpers.js";

/**
 * Regressions for the independent review of efb5539 (R1 and R3). Each asserts
 * the corrected behaviour; the reviewer's probes asserted the defects.
 */

afterEach(cleanup);

const VIEW = ".anvilmark/architecture/view.mmd";
const CALM = ".anvilmark/architecture/calm.json";
const CONTEXT = ".anvilmark/generated/agent-context.md";
const MANIFEST = ".anvilmark/generated/manifest.json";

async function run(
  root: string,
  argv: string[],
  at = "2026-09-14T12:00:00.000Z",
) {
  const io = scriptedIo({ cwd: root, clock: steppingClock(at) });
  const code = await cli(argv, io);
  return { code, out: io.out(), err: io.err() };
}

async function snapshot(root: string, paths: readonly string[]) {
  const result: Record<string, string | null> = {};
  for (const path of paths) {
    result[path] = (await exists(join(root, path)))
      ? await readFile(join(root, path), "utf8")
      : null;
  }
  return result;
}

describe("R1: generated output never crosses the physical output boundary", () => {
  async function generated(): Promise<{
    root: string;
    before: Record<string, string | null>;
    contract: string;
  }> {
    const root = await atlasProject();
    expect(
      (await run(root, ["generate", "--as-of", "2026-09-14T00:00:00Z"])).code,
    ).toBe(0);
    return {
      root,
      before: await snapshot(root, [VIEW, CALM, CONTEXT, MANIFEST]),
      contract: await projectText(root),
    };
  }

  async function refusedWithoutDamage(
    setup: Awaited<ReturnType<typeof generated>>,
    message: RegExp,
    argv: string[] = ["generate"],
  ) {
    const result = await run(setup.root, argv);
    expect(result.code, result.out).toBe(1);
    expect(result.err).toMatch(message);
    expect(result.err).toContain("no generated output was read or changed");
    const after = await projectText(setup.root);
    expect(after).toBe(setup.contract);
    expect(parseProjectContract(after, "yaml").ok).toBe(true);
    expect(await snapshot(setup.root, [VIEW, CALM, CONTEXT, MANIFEST])).toEqual(
      setup.before,
    );
  }

  it("refuses the reproduced directory symlink that aliases project.yaml, keeping the contract and prior output", async () => {
    const setup = await generated();
    expect(
      (
        await run(setup.root, [
          "architecture",
          "views",
          "--mermaid",
          "./exports/project.yaml",
        ])
      ).code,
    ).toBe(0);
    setup.contract = await projectText(setup.root);
    await symlink(".", join(setup.root, ".anvilmark", "exports"));
    await refusedWithoutDamage(
      setup,
      /passes through a symbolic link at \.anvilmark\/exports/,
    );
    await refusedWithoutDamage(setup, /symbolic link/, ["generate", "--check"]);
    await refusedWithoutDamage(setup, /symbolic link/, [
      "generate",
      "--refresh",
    ]);
  });

  it("refuses a directory symlink to a location outside the project", async () => {
    const setup = await generated();
    const outside = await tempDir("anvilmark-outside-");
    await writeFile(join(outside, "calm.json"), "outside file\n", "utf8");
    expect(
      (
        await run(setup.root, [
          "architecture",
          "views",
          "--calm",
          "external/calm.json",
        ])
      ).code,
    ).toBe(0);
    setup.contract = await projectText(setup.root);
    await symlink(outside, join(setup.root, ".anvilmark", "external"));
    await refusedWithoutDamage(setup, /symbolic link at \.anvilmark\/external/);
    expect(await readFile(join(outside, "calm.json"), "utf8")).toBe(
      "outside file\n",
    );
    expect(await readdir(outside)).toEqual(["calm.json"]);
  });

  it("refuses an output file that is a symlink or a hard link to project.yaml", async () => {
    const setup = await generated();
    await rm(join(setup.root, VIEW));
    await symlink("../project.yaml", join(setup.root, VIEW));
    delete setup.before[VIEW];
    const symlinked = await run(setup.root, ["generate"]);
    expect(symlinked.code).toBe(1);
    expect(symlinked.err).toMatch(/view\.mmd" is a symbolic link/);
    expect(await projectText(setup.root)).toBe(setup.contract);

    await rm(join(setup.root, VIEW));
    await link(
      join(setup.root, ".anvilmark", "project.yaml"),
      join(setup.root, VIEW),
    );
    const hardLinked = await run(setup.root, ["generate"]);
    expect(hardLinked.code).toBe(1);
    expect(hardLinked.err).toMatch(
      /is the same file as \.anvilmark\/project\.yaml/,
    );
    expect(await projectText(setup.root)).toBe(setup.contract);
  });

  it("refuses a case-folded alias of protected state and colliding outputs", async () => {
    const setup = await generated();
    expect(
      (
        await run(setup.root, [
          "architecture",
          "views",
          "--mermaid",
          "Project.YAML",
        ])
      ).code,
    ).toBe(0);
    setup.contract = await projectText(setup.root);
    await refusedWithoutDamage(setup, /resolves to protected project state/);

    expect(
      (
        await run(setup.root, [
          "architecture",
          "views",
          "--mermaid",
          "History/view.mmd",
        ])
      ).code,
    ).toBe(0);
    setup.contract = await projectText(setup.root);
    await refusedWithoutDamage(setup, /resolves to protected project state/);

    expect(
      (
        await run(setup.root, [
          "architecture",
          "views",
          "--mermaid",
          "architecture/CALM.json",
          "--default-calm",
        ])
      ).code,
    ).toBe(0);
    setup.contract = await projectText(setup.root);
    // On a case-insensitive filesystem the existing file's identity matches
    // first; on a case-sensitive one the folded path does. Both refuse.
    await refusedWithoutDamage(
      setup,
      /are the same file|resolve to the same physical path/,
    );
  });

  it("refuses an output parent that is a file, and still generates through real directories", async () => {
    const setup = await generated();
    expect(
      (
        await run(setup.root, [
          "architecture",
          "views",
          "--mermaid",
          "views/nested/view.mmd",
        ])
      ).code,
    ).toBe(0);
    setup.contract = await projectText(setup.root);
    await writeFile(
      join(setup.root, ".anvilmark", "views"),
      "not a directory",
      "utf8",
    );
    await refusedWithoutDamage(
      setup,
      /needs \.anvilmark\/views to be a directory/,
    );

    await rm(join(setup.root, ".anvilmark", "views"));
    const ok = await run(setup.root, ["generate"]);
    expect(ok.code, ok.err).toBe(0);
    expect(
      await exists(join(setup.root, ".anvilmark/views/nested/view.mmd")),
    ).toBe(true);
  });
});

describe("R3: byte-stable snapshots are not called current after time moves", () => {
  async function expiringProject(): Promise<string> {
    const root = await approvedProject();
    const file = join(root, ".anvilmark", "project.yaml");
    const parsed = parseProjectContract(await readFile(file, "utf8"), "yaml");
    if (!parsed.ok) throw new Error("fixture invalid");
    const next = structuredClone(parsed.value);
    next.evidence_refs[0]!.refresh.expires_at = "2026-09-15T00:00:00Z";
    // Synthetic fixture approval re-hashed for the test; not a real decision.
    const hash = computeApprovalHash(next, "decision.classification");
    if (!hash.ok) throw new Error("unresolvable");
    next.approvals[0]!.content_hash = hash.value;
    await writeFile(file, toNormalizedYaml(next), "utf8");
    return root;
  }

  it("is current on the day of generation and a genuine no-op later that day", async () => {
    const root = await expiringProject();
    const first = await run(root, ["generate"], "2026-09-14T00:00:00.000Z");
    expect(first.code, first.err).toBe(0);
    expect(first.out).toContain("freshness: current at");
    const later = await run(
      root,
      ["generate", "--json"],
      "2026-09-14T20:00:00.000Z",
    );
    expect(later.code).toBe(0);
    expect(JSON.parse(later.out)).toMatchObject({
      status: "current",
      unchanged: true,
      as_of_basis: "reused",
      freshness: { status: "current", differences: [] },
      remediation: null,
    });
  });

  it("reports stale_time with a non-success result after expiry, keeps the bytes, and points to --refresh", async () => {
    const root = await expiringProject();
    expect(
      (await run(root, ["generate"], "2026-09-14T00:00:00.000Z")).code,
    ).toBe(0);
    const before = await snapshot(root, [VIEW, CALM, CONTEXT, MANIFEST]);

    const stale = await run(root, ["generate"], "2026-09-16T00:00:00.000Z");
    expect(stale.code).toBe(1);
    expect(stale.out).not.toContain("already current");
    expect(stale.out).toMatch(
      /^STALE: the generated snapshot as of 2026-09-14T00:00:0\d\.000Z is not current at 2026-09-16T00:00:0\d\.000Z \(stale_time\)\./,
    );
    expect(stale.out).toContain(
      "evidence evidence.pricing.remote was current at",
    );
    expect(stale.out).toContain('"anvilmark generate --refresh"');
    expect(await snapshot(root, [VIEW, CALM, CONTEXT, MANIFEST])).toEqual(
      before,
    );

    const json = await run(
      root,
      ["generate", "--json"],
      "2026-09-16T00:00:00.000Z",
    );
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out)).toMatchObject({
      status: "stale_time",
      unchanged: true,
      freshness: { status: "stale_time" },
      remediation: "anvilmark generate --refresh",
    });

    const check = await run(
      root,
      ["generate", "--check"],
      "2026-09-16T00:00:00.000Z",
    );
    expect(check.code).toBe(1);
    expect(check.out).toContain("Generated output: stale_time");
    expect(check.out).toContain('"anvilmark generate --refresh"');
    const checkJson = await run(
      root,
      ["generate", "--check", "--json"],
      "2026-09-16T00:00:00.000Z",
    );
    expect(JSON.parse(checkJson.out).status).toBe("stale_time");
  });

  it("succeeds for an explicit historical --as-of, labelled as a historical snapshot", async () => {
    const root = await expiringProject();
    const historical = await run(
      root,
      ["generate", "--as-of", "2026-09-14T00:00:00Z"],
      "2026-09-16T00:00:00.000Z",
    );
    expect(historical.code, historical.err).toBe(0);
    expect(historical.out).toContain(
      "HISTORICAL SNAPSHOT: standings as of 2026-09-14T00:00:00Z; at 2026-09-16T00:00:0",
    );
    const json = await run(
      root,
      ["generate", "--as-of", "2026-09-14T00:00:00Z", "--json"],
      "2026-09-16T00:00:00.000Z",
    );
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out)).toMatchObject({
      status: "historical_snapshot",
      as_of_basis: "explicit",
      freshness: { status: "stale_time" },
      remediation: null,
    });
    // The snapshot itself still says what its as_of is.
    expect(await readFile(join(root, CONTEXT), "utf8")).toContain(
      "| As of | `2026-09-14T00:00:00Z`",
    );
  });

  it("is resolved by --refresh", async () => {
    const root = await expiringProject();
    expect(
      (await run(root, ["generate"], "2026-09-14T00:00:00.000Z")).code,
    ).toBe(0);
    const refreshed = await run(
      root,
      ["generate", "--refresh"],
      "2026-09-16T00:00:00.000Z",
    );
    expect(refreshed.code, refreshed.out).toBe(0);
    expect(refreshed.out).toContain("freshness: current at 2026-09-16");
    expect(await readFile(join(root, CONTEXT), "utf8")).toContain(
      "freshness `expired`",
    );
    const check = await run(
      root,
      ["generate", "--check"],
      "2026-09-16T00:00:05.000Z",
    );
    expect(check.code, check.out).toBe(0);
    expect(
      (await run(root, ["generate"], "2026-09-16T01:00:00.000Z")).code,
    ).toBe(0);
  });
});

describe("output generated by the draft.4 build", () => {
  it("is reported stale after the version-line migration and replaced by regeneration", async () => {
    const root = await tempDir();
    const fixture = join(PACKAGE_ROOT, "test", "fixtures", "draft4-generated");
    await mkdir(join(root, ".anvilmark"), { recursive: true });
    await cp(
      join(fixture, "architecture"),
      join(root, ".anvilmark", "architecture"),
      {
        recursive: true,
      },
    );
    await cp(
      join(fixture, "generated"),
      join(root, ".anvilmark", "generated"),
      {
        recursive: true,
      },
    );
    const draft4 = await readFile(join(fixture, "project.yaml"), "utf8");
    expect(draft4).toContain("schema_version: 0.1.0-draft.4");
    await writeFile(
      join(root, ".anvilmark", "project.yaml"),
      draft4
        .replace(/^schema: .+$/m, `schema: ${PROJECT_SCHEMA_ID}`)
        .replace(
          /^schema_version: .+$/m,
          `schema_version: ${PROJECT_SCHEMA_VERSION}`,
        ),
      "utf8",
    );
    const oldManifest = JSON.parse(
      await readFile(join(root, MANIFEST), "utf8"),
    );
    expect(oldManifest.generator).toBe("anvilmark-context/0.1.0-draft.1");

    const check = await run(root, ["generate", "--check", "--json"]);
    expect(check.code).toBe(1);
    const report = JSON.parse(check.out);
    expect(report.status).toBe("stale_generator");
    expect(report.problems.join(" ")).toContain(
      "generated by anvilmark-context/0.1.0-draft.1",
    );
    expect(report.problems.join(" ")).toContain(
      "project.yaml is now state revision none",
    );

    const regenerated = await run(root, ["generate"]);
    expect(regenerated.code, regenerated.err).toBe(0);
    expect(
      JSON.parse(await readFile(join(root, MANIFEST), "utf8")).generator,
    ).toBe("anvilmark-context/0.1.0-draft.2");
    expect(
      (await run(root, ["generate", "--check"], "2026-09-14T12:00:10.000Z"))
        .code,
    ).toBe(0);
  });
});
