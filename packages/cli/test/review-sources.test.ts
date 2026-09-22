import { createHash } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectReviewSources } from "../src/review-sources.js";
import { cleanup, tempDir } from "./helpers.js";

afterEach(cleanup);

function digest(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

async function repository(files: Record<string, string>) {
  const base = await tempDir("review-sources-");
  const root = join(base, "repo");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return { base, root };
}

describe("collectReviewSources", () => {
  it("includes scanned files that are unchanged", async () => {
    const text = "export const a = 1;\n";
    const { root } = await repository({ "src/a.ts": text });
    const result = await collectReviewSources({
      repositoryRoot: root,
      paths: ["src/a.ts"],
      expectedHashes: new Map([["src/a.ts", digest(text)]]),
    });
    expect(result).toEqual({ sources: { "src/a.ts": text }, omitted: [] });
  });

  it("omits paths that leave the repository, including through symlinks", async () => {
    const { base, root } = await repository({ "src/a.ts": "a" });
    await writeFile(join(base, "outside.ts"), "outside");
    await symlink(join(base, "outside.ts"), join(root, "src", "link.ts"));

    const result = await collectReviewSources({
      repositoryRoot: root,
      paths: ["../outside.ts", join(base, "outside.ts"), "src/link.ts"],
      expectedHashes: new Map([
        ["../outside.ts", digest("outside")],
        ["src/link.ts", digest("outside")],
      ]),
    });
    expect(result.sources).toEqual({});
    expect(result.omitted.map((entry) => entry.reason)).toEqual([
      "outside_repository",
      "outside_repository",
      "outside_repository",
    ]);
  });

  it("omits files that changed since the scan or were never scanned", async () => {
    const { root } = await repository({
      "src/changed.ts": "after",
      "src/unscanned.ts": "x",
    });
    const result = await collectReviewSources({
      repositoryRoot: root,
      paths: ["src/changed.ts", "src/unscanned.ts", "src/deleted.ts"],
      expectedHashes: new Map([["src/changed.ts", digest("before")]]),
    });
    expect(result.sources).toEqual({});
    expect(result.omitted).toEqual([
      { path: "src/changed.ts", reason: "modified_since_scan" },
      { path: "src/deleted.ts", reason: "unreadable" },
      { path: "src/unscanned.ts", reason: "not_in_scan" },
    ]);
  });

  it("omits files that contain a recognisable credential", async () => {
    // Assembled at runtime so this test file does not itself hold a key shape.
    const text = `const client = new OpenAI({ apiKey: "${"sk-" + "a1".repeat(12)}" });\n`;
    const { root } = await repository({ "src/client.ts": text });
    const result = await collectReviewSources({
      repositoryRoot: root,
      paths: ["src/client.ts"],
      expectedHashes: new Map([["src/client.ts", digest(text)]]),
    });
    expect(result.sources).toEqual({});
    expect(result.omitted).toEqual([
      { path: "src/client.ts", reason: "possible_secret" },
    ]);
  });

  it("enforces per-file and total size limits", async () => {
    const files = {
      "a.ts": "a".repeat(40),
      "b.ts": "b".repeat(40),
      "c.ts": "c".repeat(80),
    };
    const { root } = await repository(files);
    const result = await collectReviewSources({
      repositoryRoot: root,
      paths: Object.keys(files),
      expectedHashes: new Map(
        Object.entries(files).map(([path, text]) => [path, digest(text)]),
      ),
      limits: { maxFileBytes: 60, maxTotalBytes: 50 },
    });
    expect(Object.keys(result.sources)).toEqual(["a.ts"]);
    expect(result.omitted).toEqual([
      { path: "b.ts", reason: "total_limit" },
      { path: "c.ts", reason: "too_large" },
    ]);
  });
});
