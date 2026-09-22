import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPlanningInput,
  MAX_ARTIFACT_BYTES,
} from "@anvilmark/hardware-sizing";
import { cleanup, cli, scriptedIo, spawnCli, tempDir } from "./helpers.js";

afterEach(cleanup);

describe("read-only hardware sizing commands", () => {
  it("shows sizing help and retains hardware add help", async () => {
    const root = await tempDir();
    const io = scriptedIo({ cwd: root });
    expect(await cli(["hardware", "--help"], io)).toBe(0);
    expect(io.out()).toContain("hardware estimate");
    expect(io.out()).toContain("hardware add");
    const add = scriptedIo({ cwd: root });
    expect(await cli(["hardware", "add", "--help"], add)).toBe(0);
    expect(add.out()).toContain("user_declared");
  });

  it("lists the pinned catalog and emits a machine-readable example", async () => {
    const root = await tempDir();
    const catalog = scriptedIo({ cwd: root });
    expect(await cli(["hardware", "catalog", "--json"], catalog)).toBe(0);
    expect(JSON.parse(catalog.out()).models).toHaveLength(2);
    const example = scriptedIo({ cwd: root });
    expect(await cli(["hardware", "example", "--json"], example)).toBe(0);
    expect(JSON.parse(example.out()).hardware.evidence_kind).toBe(
      "user_declared",
    );
    expect(await readdir(root)).toEqual([]);
  });

  it("recomputes a scenario without a project or any filesystem writes", async () => {
    const root = await tempDir();
    const path = join(root, "scenario.json");
    const content = JSON.stringify(createPlanningInput());
    await writeFile(path, content);
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(["hardware", "estimate", "--file", path, "--json"], io),
    ).toBe(0);
    const artifact = JSON.parse(io.out());
    expect(artifact.format).toBe("anvilmark-hardware-sizing/1");
    expect(artifact.result.status).toBe("incomplete");
    expect(artifact.result.memory.assessment).toBe("unknown");
    expect(artifact.result.performance.status).toBe("unverified");
    expect(io.err()).toBe("");
    expect(await readFile(path, "utf8")).toBe(content);
    expect(await readdir(root)).toEqual(["scenario.json"]);
  });

  it("round-trips an exported artifact through the built binary", async () => {
    const root = await tempDir();
    await writeFile(
      join(root, "input.json"),
      JSON.stringify(createPlanningInput()),
    );
    const io = scriptedIo({ cwd: root });
    expect(
      await cli(["hardware", "estimate", "--file", "input.json", "--json"], io),
    ).toBe(0);
    await writeFile(join(root, "artifact.json"), io.out());
    const result = await spawnCli(
      ["hardware", "estimate", "--file", "artifact.json", "--json"],
      { cwd: root },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).input_digest).toBe(
      JSON.parse(io.out()).input_digest,
    );
    expect(result.stderr).toBe("");
  });

  it("refuses a tampered result instead of repeating its claimed fit", async () => {
    const root = await tempDir();
    await writeFile(
      join(root, "input.json"),
      JSON.stringify(createPlanningInput()),
    );
    const io = scriptedIo({ cwd: root });
    await cli(["hardware", "estimate", "--file", "input.json", "--json"], io);
    const artifact = JSON.parse(io.out());
    artifact.result.memory.assessment = "estimated_within_budget";
    await writeFile(join(root, "bad.json"), JSON.stringify(artifact));
    const checked = scriptedIo({ cwd: root });
    expect(
      await cli(
        ["hardware", "estimate", "--file", "bad.json", "--json"],
        checked,
      ),
    ).toBe(2);
    expect(JSON.parse(checked.out()).error.message).toContain(
      "failed verification",
    );
  });

  it.each(["bad-json", "too-large", "directory", "invalid-schema"])(
    "bounds and rejects %s input with a JSON error",
    async (kind) => {
      const root = await tempDir();
      let path = join(root, "input.json");
      if (kind === "directory") path = root;
      else
        await writeFile(
          path,
          kind === "bad-json"
            ? "{"
            : kind === "too-large"
              ? " ".repeat(MAX_ARTIFACT_BYTES + 1)
              : "{}",
        );
      const io = scriptedIo({ cwd: root });
      expect(
        await cli(["hardware", "estimate", "--file", path, "--json"], io),
      ).toBe(2);
      expect(JSON.parse(io.out()).format).toBe(
        "anvilmark-hardware-sizing-error/1",
      );
      expect(io.err()).not.toBe("");
    },
  );

  it("rejects implicit writes, unknown options, and cancellation", async () => {
    const root = await tempDir();
    for (const args of [
      ["probe", "--write"],
      ["estimate", "--write"],
      ["estimate", "--host", "server"],
      ["catalog", "--file", "x"],
    ]) {
      const io = scriptedIo({ cwd: root });
      expect(await cli(["hardware", ...args, "--json"], io)).toBe(2);
      expect(JSON.parse(io.out()).error).toBeDefined();
    }
    const controller = new AbortController();
    controller.abort();
    const io = scriptedIo({ cwd: root, signal: controller.signal });
    expect(await cli(["hardware", "catalog", "--json"], io)).toBe(3);
    expect(JSON.parse(io.out()).error.code).toBe(3);
  });
});
