import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  REPO_ROOT,
  cleanup,
  cli,
  readTree,
  scriptedIo,
  tempDir,
} from "./helpers.js";

/**
 * `anvilmark inventory`: what a repository uses, with no project anywhere.
 * It writes nothing, needs no contract, and states no conformance result.
 */

afterEach(cleanup);

const FIXTURES = join(REPO_ROOT, "packages/scanner/test/fixtures");

/** `<tmp>/app`: a repository with no ANVILMARK project beside it. */
async function repository(): Promise<{ base: string; app: string }> {
  const base = await tempDir("anvilmark-inventory-");
  const app = join(base, "app");
  await cp(join(FIXTURES, "repositories", "atlas-support"), app, {
    recursive: true,
  });
  for (const sdk of ["openai", "ollama"]) {
    await cp(
      join(FIXTURES, "synthetic-sdks", sdk),
      join(app, "node_modules", sdk),
      { recursive: true },
    );
  }
  return { base, app };
}

describe("anvilmark inventory", () => {
  it("lists what a repository uses without a project, and writes nothing", async () => {
    const { base, app } = await repository();
    const before = await readTree(app);
    const io = scriptedIo({ cwd: base });
    expect(await cli(["inventory", "app"], io)).toBe(0);
    const out = io.out();

    expect(out).toContain("AI usage inventory: app");
    expect(out).toContain("Where requests go");
    expect(out).toContain("api.openai.com");
    expect(out).toContain("Call sites");
    expect(out).toContain("chat.completions.create [inference]");
    expect(out).toContain("AI dependencies");
    // No project was created, and the repository is untouched.
    expect(await readTree(app)).toEqual(before);
    expect(
      Object.keys(await readTree(base)).every((p) => p.startsWith("app/")),
    ).toBe(true);
    expect(out).toContain("not proof");
  });

  it("returns the whole inventory as JSON and as Markdown", async () => {
    const { base } = await repository();
    const json = scriptedIo({ cwd: base });
    expect(await cli(["inventory", "app", "--json"], json)).toBe(0);
    const parsed = JSON.parse(json.out()) as {
      format: string;
      calls: { path: string; destination: string }[];
      statement: string;
    };
    expect(parsed.format).toBe("anvilmark-ai-inventory/0.1.0-draft.1");
    expect(parsed.calls.length).toBeGreaterThan(0);
    expect(parsed.calls.every((call) => call.path.length > 0)).toBe(true);

    const markdown = scriptedIo({ cwd: base });
    expect(await cli(["inventory", "app", "--markdown"], markdown)).toBe(0);
    expect(markdown.out()).toContain("# AI usage inventory: app");
    expect(markdown.out()).toContain("| Destination | Calls |");
  });

  it("refuses a path that is not a directory, and refuses both output formats at once", async () => {
    const base = await tempDir("anvilmark-inventory-");
    await mkdir(join(base, "empty"));
    await writeFile(join(base, "file.txt"), "not a repository\n");

    const missing = scriptedIo({ cwd: base });
    expect(await cli(["inventory", "nowhere"], missing)).toBe(1);
    expect(missing.err()).toContain("not a directory");

    const file = scriptedIo({ cwd: base });
    expect(await cli(["inventory", "file.txt"], file)).toBe(1);

    const both = scriptedIo({ cwd: base });
    expect(
      await cli(["inventory", "empty", "--json", "--markdown"], both),
    ).toBe(2);

    // A repository with nothing recognized says so, and still exits 0.
    const empty = scriptedIo({ cwd: base });
    expect(await cli(["inventory", "empty"], empty)).toBe(0);
    expect(empty.out()).toContain("No AI provider calls were recognized.");
  });
});
