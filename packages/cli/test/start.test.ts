import {
  cp,
  mkdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { parseProjectContract, unwrap } from "@anvilmark/project-contract";
import { afterEach, describe, expect, it } from "vitest";

import { REPO_ROOT, cleanup, cli, scriptedIo, tempDir } from "./helpers.js";
import { connectCodexProject } from "../src/commands/codex-connect.js";

afterEach(cleanup);

async function appRepository(): Promise<string> {
  const root = join(await tempDir(), "support-app");
  await cp(
    join(
      REPO_ROOT,
      "packages/scanner/test/fixtures/repositories/atlas-support",
    ),
    root,
    { recursive: true },
  );
  for (const sdk of ["openai", "ollama"]) {
    await cp(
      join(REPO_ROOT, "packages/scanner/test/fixtures/synthetic-sdks", sdk),
      join(root, "node_modules", sdk),
      { recursive: true },
    );
  }
  return root;
}

describe("anvilmark start", () => {
  it("shows source-linked usage and creates only a user-described local draft, then resumes it", async () => {
    const root = await appRepository();
    const first = scriptedIo({
      cwd: root,
      interactive: true,
      answers: ["Help agents classify support tickets"],
    });
    expect(await cli(["start"], first), first.err()).toBe(0);
    expect(first.out()).toContain("Call sites");
    expect(first.out()).toContain("chat.completions.create");
    expect(first.prompts).toEqual([
      "Describe the application idea in a sentence or two: ",
    ]);

    const file = join(root, ".anvilmark/project.yaml");
    const before = await readFile(file, "utf8");
    const draft = unwrap(parseProjectContract(before, "yaml"));
    expect(draft.project.repository_roots).toEqual(["."]);
    expect(draft.intent.summary).toBe("Help agents classify support tickets");
    expect(draft.workloads).toEqual([]);
    expect(draft.constraints).toEqual([]);
    expect(draft.approvals).toEqual([]);

    const second = scriptedIo({ cwd: join(root, "src") });
    expect(await cli(["start"], second), second.err()).toBe(0);
    expect(second.out()).toContain("Existing ANVILMARK project:");
    expect(second.out()).toContain("Call sites");
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("remains read-only without an idea in a noninteractive session", async () => {
    const root = await appRepository();
    const readOnly = scriptedIo({ cwd: root });
    expect(await cli(["start"], readOnly), readOnly.err()).toBe(0);
    expect(readOnly.out()).toContain("No project was created");
    expect(
      await stat(join(root, ".anvilmark")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);

    const withIdea = scriptedIo({ cwd: root });
    expect(
      await cli(["start", "--idea", "Support ticket classification"], withIdea),
      withIdea.err(),
    ).toBe(0);
    expect(withIdea.out()).toContain("Initialized ANVILMARK project");
  });

  it("starts at the Git root when invoked from a subdirectory", async () => {
    const root = await appRepository();
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git/HEAD"), "ref: refs/heads/main\n");
    const io = scriptedIo({ cwd: join(root, "src") });
    expect(
      await cli(["start", "--idea", "Support ticket classification"], io),
      io.err(),
    ).toBe(0);
    expect(
      await stat(join(root, ".anvilmark/project.yaml")).then(
        () => true,
        () => false,
      ),
    ).toBe(true);
    expect(
      await stat(join(root, "src/.anvilmark")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  it("does not attach a nested Git repository to an ancestor project", async () => {
    const parent = await tempDir();
    const parentIo = scriptedIo({ cwd: parent });
    expect(await cli(["init", "--idea", "Parent project"], parentIo)).toBe(0);
    const parentFile = join(parent, ".anvilmark/project.yaml");
    const parentBefore = await readFile(parentFile, "utf8");
    const child = join(parent, "new-app");
    await mkdir(child);
    await writeFile(join(child, "package.json"), '{"name":"new-app"}\n');
    await mkdir(join(child, ".git"));
    await writeFile(join(child, ".git/HEAD"), "ref: refs/heads/main\n");

    const childIo = scriptedIo({ cwd: child });
    expect(
      await cli(["start", "--idea", "Separate application"], childIo),
      childIo.err(),
    ).toBe(0);
    expect(await readFile(parentFile, "utf8")).toBe(parentBefore);
    const childDraft = unwrap(
      parseProjectContract(
        await readFile(join(child, ".anvilmark/project.yaml"), "utf8"),
        "yaml",
      ),
    );
    expect(childDraft.intent.summary).toBe("Separate application");
  });
});

describe("Codex project connection", () => {
  it("adds an approval-aware MCP entry and preserves other settings on rerun", async () => {
    const root = await tempDir();
    const config = join(root, ".codex/config.toml");
    await mkdir(join(root, ".codex"));
    await writeFile(config, 'model = "existing"\n');
    const serverEntry = "/tmp/anvilmark/bin/anvilmark-project-mcp.mjs";

    expect(await connectCodexProject(root, serverEntry)).toBe("created");
    const first = await readFile(config, "utf8");
    expect(first).toContain('model = "existing"');
    expect(first).toContain("[mcp_servers.anvilmark-project]");
    expect(first).toContain('default_tools_approval_mode = "writes"');
    expect(first).toContain('"--agent-assessment"');
    expect(first).toContain(JSON.stringify(root));
    expect(await connectCodexProject(root, serverEntry)).toBe("unchanged");
    expect(await readFile(config, "utf8")).toBe(first);
  });

  it("refuses to overwrite an existing or edited Anvilmark entry", async () => {
    const root = await tempDir();
    const config = join(root, ".codex/config.toml");
    await mkdir(join(root, ".codex"));
    await writeFile(
      config,
      '[mcp_servers.anvilmark-project]\ncommand = "other"\n',
    );
    await expect(connectCodexProject(root, "/tmp/server.mjs")).rejects.toThrow(
      "already configures",
    );
    expect(await readFile(config, "utf8")).toBe(
      '[mcp_servers.anvilmark-project]\ncommand = "other"\n',
    );
  });

  it("refuses to follow a project config symlink", async () => {
    const root = await tempDir();
    const outside = join(await tempDir(), "shared.toml");
    await writeFile(outside, 'model = "unchanged"\n');
    await mkdir(join(root, ".codex"));
    await symlink(outside, join(root, ".codex/config.toml"));
    await expect(connectCodexProject(root, "/tmp/server.mjs")).rejects.toThrow(
      "symbolic link",
    );
    expect(await readFile(outside, "utf8")).toBe('model = "unchanged"\n');
  });
});
