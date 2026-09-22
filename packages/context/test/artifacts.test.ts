import { describe, expect, it } from "vitest";

import type { GenerationManifest } from "../src/index.js";
import {
  ArtifactPathError,
  DEFAULT_ARTIFACT_PATHS,
  artifactPaths,
  checkArtifactSet,
  digestText,
  renderArtifactSet,
} from "../src/index.js";
import {
  AS_OF,
  approvedAtlas,
  atlas,
  resignApproval,
  valid,
} from "./helpers.js";

type Files = Map<string, string>;

function written(set: ReturnType<typeof renderArtifactSet>): Files {
  return new Map([
    ...set.artifacts.map(
      (artifact) => [artifact.path, artifact.content] as const,
    ),
    [set.manifestPath, set.manifestText],
  ]);
}

function check(
  contract: Parameters<typeof checkArtifactSet>[0]["contract"],
  files: Files,
  extra: { now?: string; stateRevision?: number | null } = {},
) {
  return checkArtifactSet({
    contract,
    manifestText: files.get(DEFAULT_ARTIFACT_PATHS.manifest) ?? null,
    read: (path) => files.get(path) ?? null,
    ...extra,
  });
}

describe("artifact paths", () => {
  it("uses the documented defaults and honours contract paths inside .anvilmark/", async () => {
    const contract = await atlas();
    // Atlas declares ./architecture/calm.json and ./architecture/view.mmd.
    expect(artifactPaths(contract)).toEqual(DEFAULT_ARTIFACT_PATHS);
    const custom = structuredClone(contract);
    custom.architecture.generated = {
      calm_1_2: "exports/arch.calm.json",
      mermaid: null,
    };
    expect(artifactPaths(custom).calm_1_2).toBe(
      ".anvilmark/exports/arch.calm.json",
    );
    expect(artifactPaths(custom).mermaid).toBe(DEFAULT_ARTIFACT_PATHS.mermaid);
  });

  it.each([
    ["../outside.json", /outside \.anvilmark/],
    ["architecture/../../escape.json", /outside \.anvilmark/],
    ["project.yaml", /project contract/],
    ["./history/r000001.yaml", /history/],
    [".lock", /write lock/],
    ["generated/manifest.json", /distinct paths/],
    ["windows\\path.json", /POSIX path/],
    ["architecture/", /directory/],
  ])("refuses %j", async (path, message) => {
    const contract = structuredClone(await atlas());
    contract.architecture.generated.calm_1_2 = path;
    expect(() => artifactPaths(contract)).toThrow(ArtifactPathError);
    expect(() => artifactPaths(contract)).toThrow(message);
  });
});

describe("rendering the set", () => {
  it("is byte-stable and records no clock", async () => {
    const contract = await atlas();
    const first = renderArtifactSet(contract, {
      asOf: AS_OF,
      stateRevision: 1,
    });
    const second = renderArtifactSet(structuredClone(contract), {
      asOf: AS_OF,
      stateRevision: 1,
    });
    expect(second.manifestText).toBe(first.manifestText);
    expect(second.artifacts).toEqual(first.artifacts);
    const manifest = JSON.parse(first.manifestText) as GenerationManifest;
    expect(Object.keys(manifest).sort()).toEqual(
      [
        "artifacts",
        "as_of",
        "authority",
        "format",
        "generator",
        "projection",
        "source",
      ].sort(),
    );
    expect(manifest.as_of).toBe(AS_OF);
    for (const artifact of first.artifacts) {
      expect(artifact.digest).toBe(digestText(artifact.content));
      expect(artifact.content).toContain(manifest.source.contract_hash);
    }
  });

  it("changes every artifact when the source or as_of changes", async () => {
    const contract = await atlas();
    const base = renderArtifactSet(contract, { asOf: AS_OF });
    const edited = structuredClone(contract);
    edited.architecture.nodes[0]!.description = "Now described";
    const changed = renderArtifactSet(edited, { asOf: AS_OF });
    const later = renderArtifactSet(contract, { asOf: "2026-10-01T00:00:00Z" });
    for (const [index, artifact] of base.artifacts.entries()) {
      expect(changed.artifacts[index]?.digest).not.toBe(artifact.digest);
      expect(later.artifacts[index]?.digest).not.toBe(artifact.digest);
    }
  });
});

describe("checking generated output", () => {
  it("reports current for an untouched set", async () => {
    const contract = await atlas();
    const files = written(
      renderArtifactSet(contract, { asOf: AS_OF, stateRevision: 2 }),
    );
    const result = check(contract, files, { now: AS_OF, stateRevision: 2 });
    expect(result.status).toBe("current");
    expect(result.ok).toBe(true);
    expect(
      result.artifacts.every((artifact) => artifact.status === "current"),
    ).toBe(true);
  });

  it("reports missing when nothing was generated, and incomplete for a partial set", async () => {
    const contract = await atlas();
    expect(check(contract, new Map()).status).toBe("missing");

    const files = written(renderArtifactSet(contract, { asOf: AS_OF }));
    const noManifest = new Map(files);
    noManifest.delete(DEFAULT_ARTIFACT_PATHS.manifest);
    expect(check(contract, noManifest).status).toBe("incomplete");

    const partial = new Map(files);
    partial.delete(DEFAULT_ARTIFACT_PATHS.calm_1_2);
    const result = check(contract, partial);
    expect(result.status).toBe("incomplete");
    expect(
      result.artifacts.find((artifact) => artifact.kind === "calm_1_2")?.status,
    ).toBe("missing");
  });

  it("reports a hand-edited artifact as tampered, even when its manifest digest was edited to match", async () => {
    const contract = await atlas();
    const files = written(renderArtifactSet(contract, { asOf: AS_OF }));
    const edited = new Map(files);
    const calm = JSON.parse(edited.get(DEFAULT_ARTIFACT_PATHS.calm_1_2)!);
    calm.nodes.push({
      "unique-id": "injected",
      "node-type": "service",
      name: "Injected",
      description: "x",
    });
    const calmText = `${JSON.stringify(calm, null, 2)}\n`;
    edited.set(DEFAULT_ARTIFACT_PATHS.calm_1_2, calmText);
    expect(check(contract, edited).status).toBe("tampered");

    const manifest = JSON.parse(
      edited.get(DEFAULT_ARTIFACT_PATHS.manifest)!,
    ) as {
      artifacts: { kind: string; digest: string }[];
    };
    manifest.artifacts.find((entry) => entry.kind === "calm_1_2")!.digest =
      digestText(calmText);
    edited.set(DEFAULT_ARTIFACT_PATHS.manifest, JSON.stringify(manifest));
    const result = check(contract, edited);
    expect(result.status).toBe("tampered");
    expect(result.problems.join(" ")).toMatch(/not authoritative/);

    edited.set(DEFAULT_ARTIFACT_PATHS.manifest, "{not json");
    expect(check(contract, edited).status).toBe("tampered");
  });

  it("reports stale_source after any contract change, including a state revision change", async () => {
    const contract = await atlas();
    const files = written(
      renderArtifactSet(contract, { asOf: AS_OF, stateRevision: 1 }),
    );
    const edited = structuredClone(contract);
    edited.intent.non_goals.push("fully automated refunds");
    const result = check(edited, files, { stateRevision: 1 });
    expect(result.status).toBe("stale_source");
    expect(
      result.artifacts.every((artifact) => artifact.status === "stale_source"),
    ).toBe(true);
    expect(check(contract, files, { stateRevision: 2 }).status).toBe(
      "stale_source",
    );
  });

  it("reports stale_generator for another generator, format or projection", async () => {
    const contract = await atlas();
    const files = written(renderArtifactSet(contract, { asOf: AS_OF }));
    const manifest = JSON.parse(files.get(DEFAULT_ARTIFACT_PATHS.manifest)!);
    manifest.generator = "anvilmark-context/0.0.9";
    const older = new Map(files);
    older.set(DEFAULT_ARTIFACT_PATHS.manifest, JSON.stringify(manifest));
    expect(check(contract, older).status).toBe("stale_generator");

    expect(
      checkArtifactSet({
        contract,
        manifestText: files.get(DEFAULT_ARTIFACT_PATHS.manifest)!,
        read: (path) => files.get(path) ?? null,
        projection: "local-disclosed",
      }).status,
    ).toBe("stale_generator");
  });

  it("reports incomplete when the contract moved a view to another path", async () => {
    const contract = await atlas();
    const files = written(renderArtifactSet(contract, { asOf: AS_OF }));
    const moved = structuredClone(contract);
    moved.architecture.generated.mermaid = "views/current.mmd";
    const result = check(moved, files);
    expect(["incomplete", "stale_source"]).toContain(result.status);
    expect(
      result.artifacts.find((artifact) => artifact.kind === "mermaid")?.status,
    ).toBe("missing");
  });

  it("reports stale_time when evidence expires between as_of and now", () => {
    const contract = structuredClone(approvedAtlas());
    contract.evidence_refs[0]!.refresh.expires_at = "2026-09-10T00:00:00Z";
    const signed = valid(resignApproval(contract, "decision.classification"));
    const files = written(
      renderArtifactSet(signed, { asOf: "2026-09-05T00:00:00Z" }),
    );
    expect(check(signed, files, { now: "2026-09-06T00:00:00Z" }).status).toBe(
      "current",
    );
    const later = check(signed, files, { now: AS_OF });
    expect(later.status).toBe("stale_time");
    expect(later.problems.join(" ")).toMatch(
      /evidence evidence\.pricing\.remote was current at .* and is expired at .*anvilmark generate --refresh/,
    );
  });
});
