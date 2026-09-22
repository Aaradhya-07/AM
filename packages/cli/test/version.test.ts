import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CLI_VERSION } from "../src/version.js";
import { REPO_ROOT } from "./helpers.js";

describe("the CLI's reported version", () => {
  it("is the version the package publishes", async () => {
    // An exported bundle stamps this version as its generator. If it drifts
    // from the manifest, an artifact claims a build that was never published.
    const manifest = JSON.parse(
      await readFile(join(REPO_ROOT, "packages/cli/package.json"), "utf8"),
    ) as { version: string };
    expect(CLI_VERSION).toBe(manifest.version);
  });
});
