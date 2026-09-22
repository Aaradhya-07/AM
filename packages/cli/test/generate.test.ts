import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  approvalState,
  computeApprovalHash,
  parseProjectContract,
  toNormalizedYaml,
} from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import type { GenerateFs } from "../src/generate.js";
import {
  checkGenerated,
  generateArtifacts,
  nodeGenerateFs,
} from "../src/generate.js";
import {
  approvedProject,
  atlasProject,
  cleanup,
  cli,
  exists,
  projectText,
  readTree,
  scriptedIo,
  steppingClock,
} from "./helpers.js";

afterEach(cleanup);

const AS_OF = "2026-09-14T00:00:00Z";
const VIEW = ".anvilmark/architecture/view.mmd";
const CALM = ".anvilmark/architecture/calm.json";
const CONTEXT = ".anvilmark/generated/agent-context.md";
const MANIFEST = ".anvilmark/generated/manifest.json";
const OUTPUTS = [CONTEXT, CALM, VIEW, MANIFEST];

async function outputs(root: string): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  for (const path of OUTPUTS) {
    result[path] = (await exists(join(root, path)))
      ? await readFile(join(root, path), "utf8")
      : null;
  }
  return result;
}

/** Everything under .anvilmark/ except generated output. */
async function sourceState(root: string): Promise<Record<string, string>> {
  const tree = await readTree(join(root, ".anvilmark"));
  return Object.fromEntries(
    Object.entries(tree).filter(
      ([path]) =>
        !path.startsWith("generated/") && !path.startsWith("architecture/"),
    ),
  );
}

async function generate(
  root: string,
  args: string[] = [],
  clock = steppingClock(),
) {
  const io = scriptedIo({ cwd: root, clock });
  const code = await cli(["generate", ...args], io);
  return { code, out: io.out(), err: io.err() };
}

describe("anvilmark generate", () => {
  it("writes all four files from the contract, byte-stable on regeneration", async () => {
    const root = await atlasProject();
    const before = await sourceState(root);
    const first = await generate(root, ["--as-of", AS_OF]);
    expect(first.code, first.err).toBe(0);
    expect(first.out).toContain("Generated 4 file(s) from contract revision 1");
    const written = await outputs(root);
    expect(Object.values(written).every((text) => text !== null)).toBe(true);

    // Unchanged source: the manifest's as_of is reused and nothing is written,
    // whatever the clock says.
    const second = await generate(
      root,
      [],
      steppingClock("2030-01-01T00:00:00.000Z"),
    );
    expect(second.code).toBe(0);
    expect(second.out).toContain(
      "Generated output already matches this snapshot; nothing was written.",
    );
    expect(second.out).toContain("freshness: current at 2030-01-01T00:00:0");
    expect(second.out).toContain("reused from the manifest");
    expect(await outputs(root)).toEqual(written);

    // Generation never changes the contract, its history or approvals.
    expect(await sourceState(root)).toEqual(before);
    const manifest = JSON.parse(written[MANIFEST]!);
    expect(manifest).toMatchObject({
      as_of: AS_OF,
      projection: "remote-default",
      source: { state_revision: 1 },
    });
    expect(written[VIEW]).toContain("%% source.state_revision: r1");
    expect(written[CALM]).toContain('"as-of": "2026-09-14T00:00:00Z"');
    expect(written[CONTEXT]).toContain("| State revision | r1 |");
  });

  it("produces the same bytes in two projects built by the same CLI workflow", async () => {
    const steps = [
      [
        "architecture",
        "node",
        "add",
        "response-drafter",
        "--kind",
        "service",
        "--name",
        'Drafter "v2" <b>|</b>',
        "--trust-boundary",
        "local",
      ],
      [
        "architecture",
        "relationship",
        "add",
        "classifier-to-drafter",
        "--kind",
        "connects",
        "--from",
        "ticket-classifier",
        "--to",
        "response-drafter",
        "--workload",
        "response_drafting",
      ],
    ];
    const results: Record<string, string | null>[] = [];
    for (let index = 0; index < 2; index += 1) {
      const root = await atlasProject();
      for (const step of steps) {
        expect(
          await cli(step, scriptedIo({ cwd: root, clock: steppingClock() })),
        ).toBe(0);
      }
      expect((await generate(root, ["--as-of", AS_OF])).code).toBe(0);
      results.push(await outputs(root));
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]![VIEW]).toContain(
      "Drafter #34;v2#34; #60;b#62;#124;#60;/b#62; (service)",
    );
    expect(results[0]![CONTEXT]).toContain(
      '`response-drafter` Drafter "v2" &lt;b&gt;\\|&lt;/b&gt; · service',
    );
  });

  it("takes as_of from the clock once, and --refresh takes a new one", async () => {
    const root = await atlasProject();
    const first = await generate(
      root,
      [],
      steppingClock("2026-09-14T08:00:00.000Z"),
    );
    const recorded =
      /as_of: (2026-09-14T08:00:0\d\.000Z) \(taken from the clock and recorded\)/.exec(
        first.out,
      )?.[1];
    expect(recorded, first.out).toBeDefined();
    const again = await generate(
      root,
      [],
      steppingClock("2026-09-20T08:00:00.000Z"),
    );
    expect(again.out).toContain(`as_of: ${recorded} (reused`);
    const refreshed = await generate(
      root,
      ["--refresh"],
      steppingClock("2026-09-20T08:00:00.000Z"),
    );
    expect(refreshed.out).toMatch(
      /as_of: 2026-09-20T08:00:0\d\.000Z \(taken from the clock/,
    );
    expect(JSON.parse((await outputs(root))[MANIFEST]!).as_of).toMatch(
      /^2026-09-20T08:00:0\d\.000Z$/,
    );
  });

  it("refuses bad options", async () => {
    const root = await atlasProject();
    expect((await generate(root, ["--as-of", "last tuesday"])).err).toMatch(
      /RFC 3339/,
    );
    expect((await generate(root, ["--as-of", AS_OF, "--refresh"])).code).toBe(
      2,
    );
    expect((await generate(root, ["--projection", "public"])).code).toBe(2);
    expect((await generate(root, ["--check", "--refresh"])).code).toBe(2);
    expect(await outputs(root)).toEqual({
      [CONTEXT]: null,
      [CALM]: null,
      [VIEW]: null,
      [MANIFEST]: null,
    });
  });

  it("reports missing, current, tampered and stale output with --check", async () => {
    const root = await atlasProject();
    let check = await generate(root, ["--check"]);
    expect(check.code).toBe(1);
    expect(check.out).toContain("Generated output: missing");

    await generate(root, ["--as-of", AS_OF]);
    check = await generate(
      root,
      ["--check"],
      steppingClock("2026-09-15T00:00:00.000Z"),
    );
    expect(check.code, check.out).toBe(0);
    expect(check.out).toContain("Generated output: current");

    // An edited generated file is reported and never becomes authoritative.
    const calmPath = join(root, CALM);
    const calm = JSON.parse(await readFile(calmPath, "utf8"));
    calm.nodes.push({
      "unique-id": "shadow-service",
      "node-type": "service",
      name: "Shadow",
      description: "Added by hand",
    });
    await writeFile(calmPath, JSON.stringify(calm, null, 2), "utf8");
    const viewPath = join(root, VIEW);
    await writeFile(
      viewPath,
      `${await readFile(viewPath, "utf8")}  n_shadow["Shadow"]\n`,
      "utf8",
    );
    check = await generate(root, ["--check", "--json"]);
    expect(check.code).toBe(1);
    const report = JSON.parse(check.out);
    expect(report.status).toBe("tampered");
    expect(
      report.artifacts.map((entry: { status: string }) => entry.status),
    ).toEqual(["current", "tampered", "tampered"]);

    const show = scriptedIo({ cwd: root });
    expect(await cli(["architecture", "show", "--json"], show)).toBe(0);
    expect(show.out()).not.toContain("shadow");
    const contract = parseProjectContract(await projectText(root), "yaml");
    expect(
      contract.ok &&
        contract.value.architecture.nodes.some(
          (node) => node.id === "shadow-service",
        ),
    ).toBe(false);

    // Regeneration restores the views from the contract.
    expect((await generate(root)).out).toContain("Generated 2 file(s)");
    expect((await generate(root, ["--check"])).code).toBe(0);

    // A contract change makes every view stale.
    expect(
      await cli(
        ["intent", "add-non-goal", "automated refunds"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    check = await generate(root, ["--check"]);
    expect(check.code).toBe(1);
    expect(check.out).toContain("Generated output: stale_source");
    expect(check.out).toContain("generated from state revision r1");
    expect(check.out).toContain("project.yaml is now state revision r2");
  });

  it("reports stale_time when cited evidence expires after as_of, without touching the approval", async () => {
    const root = await approvedProject();
    const file = join(root, ".anvilmark", "project.yaml");
    // Give the cited pricing evidence an expiry. That is approved content, so
    // the synthetic fixture approval hash is recomputed for the test; no real
    // project decision is involved.
    const contract = parseProjectContract(await readFile(file, "utf8"), "yaml");
    if (!contract.ok) throw new Error("fixture invalid");
    const next = structuredClone(contract.value);
    next.evidence_refs[0]!.refresh.expires_at = "2026-09-10T00:00:00Z";
    const hash = computeApprovalHash(next, "decision.classification");
    if (!hash.ok) throw new Error("unresolvable");
    next.approvals[0]!.content_hash = hash.value;
    await writeFile(file, toNormalizedYaml(next), "utf8");

    expect(
      (await generate(root, ["--as-of", "2026-09-05T00:00:00Z"])).code,
    ).toBe(0);
    const early = await generate(
      root,
      ["--check"],
      steppingClock("2026-09-06T00:00:00.000Z"),
    );
    expect(early.code, early.out).toBe(0);
    const late = await generate(
      root,
      ["--check"],
      steppingClock("2026-09-14T00:00:00.000Z"),
    );
    expect(late.code).toBe(1);
    expect(late.out).toContain("Generated output: stale_time");
    const reparsed = parseProjectContract(await projectText(root), "yaml");
    expect(
      reparsed.ok &&
        approvalState(reparsed.value, "decision.classification").state,
    ).toBe("current");

    const context = (await outputs(root))[CONTEXT]!;
    expect(context).toContain("instruction: YES");
    expect(context).toContain("freshness `current`");
    await generate(
      root,
      ["--refresh"],
      steppingClock("2026-09-14T00:00:00.000Z"),
    );
    const refreshed = (await outputs(root))[CONTEXT]!;
    expect(refreshed).toContain("freshness `expired`");
    expect(refreshed).toContain("EVIDENCE NOT CURRENT at as_of");
  });

  it("preserves existing output when a replacement fails part way", async () => {
    const root = await atlasProject();
    await generate(root, ["--as-of", AS_OF]);
    const before = await outputs(root);
    let renames = 0;
    const failing: GenerateFs = {
      ...nodeGenerateFs,
      async rename(from, to) {
        renames += 1;
        if (renames === 3)
          throw Object.assign(new Error("simulated rename failure"), {
            code: "EIO",
          });
        await nodeGenerateFs.rename(from, to);
      },
    };
    await expect(
      generateArtifacts({
        root,
        clock: steppingClock(),
        asOf: "2026-10-01T00:00:00Z",
        fs: failing,
      }),
    ).rejects.toThrow(/previous generated output was restored/);
    expect(await outputs(root)).toEqual(before);
    const leftovers = [
      ...(await readdir(join(root, ".anvilmark", "architecture"))),
      ...(await readdir(join(root, ".anvilmark", "generated"))),
    ].filter((name) => name.includes(".tmp-") || name.includes(".restore-"));
    expect(leftovers).toEqual([]);
    expect(await exists(join(root, ".anvilmark", ".lock"))).toBe(false);
    expect((await checkGenerated({ root, now: AS_OF })).status).toBe("current");
  });

  it("writes nothing when a temporary file cannot be written", async () => {
    const root = await atlasProject();
    let writes = 0;
    const failing: GenerateFs = {
      ...nodeGenerateFs,
      async writeTemporary(path, text) {
        writes += 1;
        if (writes === 2) throw new Error("disk full");
        await nodeGenerateFs.writeTemporary(path, text);
      },
    };
    await expect(
      generateArtifacts({
        root,
        clock: steppingClock(),
        asOf: AS_OF,
        fs: failing,
      }),
    ).rejects.toThrow("disk full");
    expect(await outputs(root)).toEqual({
      [CONTEXT]: null,
      [CALM]: null,
      [VIEW]: null,
      [MANIFEST]: null,
    });
    const names = await readdir(join(root, ".anvilmark", "architecture")).catch(
      () => [],
    );
    expect(names.filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("replaces nothing when project.yaml changes during generation", async () => {
    const root = await atlasProject();
    await generate(root, ["--as-of", AS_OF]);
    const before = await outputs(root);
    const file = join(root, ".anvilmark", "project.yaml");
    await expect(
      generateArtifacts({
        root,
        clock: steppingClock(),
        asOf: "2026-10-01T00:00:00Z",
        hooks: {
          afterRender: async () => {
            await writeFile(
              file,
              (await readFile(file, "utf8")).replace(
                "Atlas Support Desk",
                "Atlas Support Desk (edited)",
              ),
              "utf8",
            );
          },
        },
      }),
    ).rejects.toThrow(
      /changed while generating; no generated output was changed/,
    );
    expect(await outputs(root)).toEqual(before);
    expect((await checkGenerated({ root, now: AS_OF })).status).toBe(
      "stale_source",
    );
  });

  it("refuses to run while a commit holds the project lock", async () => {
    const root = await atlasProject();
    await writeFile(
      join(root, ".anvilmark", ".lock"),
      JSON.stringify({ pid: process.pid, created_at: AS_OF }),
      "utf8",
    );
    const result = await generate(root, ["--as-of", AS_OF]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(
      /another anvilmark command is writing this project/,
    );
    expect((await outputs(root))[MANIFEST]).toBeNull();
  });

  it("writes views at contract paths and labels a local-disclosed projection", async () => {
    const root = await atlasProject();
    expect(
      await cli(
        ["architecture", "views", "--mermaid", "views/atlas.mmd"],
        scriptedIo({ cwd: root }),
      ),
    ).toBe(0);
    const result = await generate(root, [
      "--as-of",
      AS_OF,
      "--projection",
      "local-disclosed",
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toContain(".anvilmark/views/atlas.mmd");
    expect(result.out).toContain(
      "do not send it to a remote model unless you intend to",
    );
    expect(await exists(join(root, ".anvilmark/views/atlas.mmd"))).toBe(true);
    expect(await exists(join(root, VIEW))).toBe(false);
    const context = await readFile(join(root, CONTEXT), "utf8");
    expect(context).toContain("LOCAL-DISCLOSED projection");
    // A remote-default check of a local-disclosed set is not current.
    expect(
      (await generate(root, ["--check", "--projection", "remote-default"])).out,
    ).toContain("stale_generator");
    expect((await generate(root, ["--check"])).code).toBe(0);
  });
});
