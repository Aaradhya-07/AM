import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFORMANCE_OUTPUT_PATH, runConformance } from "@anvilmark/cli";
import {
  approvedRemoteContract,
  setupWorkspace,
} from "../../cli/test/conformance-helpers.js";
import { cleanup, REPO_ROOT, tempDir } from "../../cli/test/helpers.js";
// @ts-expect-error -- shared plain ESM protocol test client.
import { startStdioServer } from "../scripts/stdio-client.mjs";

afterEach(cleanup);
// Each test below starts a real MCP server over stdio and runs a full scan and
// conformance evaluation. Vitest's 5s default is not a budget for that work: it
// passed locally in ~1.4s but timed out on a loaded CI runner. The timeout
// matches the convention for process-spawning tests elsewhere in the repository.
const clock = () => "2026-09-15T12:00:00Z";
type Client = ReturnType<typeof startStdioServer>;
type Reply = {
  isError?: boolean;
  content: { text: string }[];
  structuredContent: {
    ok: boolean;
    error?: { code: string };
    data?: {
      summary?: { compliant: boolean; fail: number };
      compliant?: boolean;
      results?: { id: string; verdict: string }[];
    };
  };
};
async function connect(root: string, local = false): Promise<Client> {
  const client = startStdioServer(
    process.execPath,
    [
      join(REPO_ROOT, "packages/mcp/bin/anvilmark-project-mcp.mjs"),
      "--project-dir",
      root,
      "--as-of",
      clock(),
      ...(local ? ["--projection", "local-disclosed"] : []),
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: root,
        ANVILMARK_CONFIG_HOME: join(root, "empty-host-config"),
      },
    },
  );
  await client.initialize({ name: "codex-regression-probe", version: "1" });
  return client;
}
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Reply> {
  const response = await client.request("tools/call", {
    name,
    arguments: args,
  });
  const result = response.result as Reply;
  expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  return result;
}
async function tree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else
        files[file.slice(root.length)] = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
    }
  }
  await visit(root);
  return files;
}
async function setup() {
  const value = await setupWorkspace(
    "handoff-approved-sanitized",
    await approvedRemoteContract(),
  );
  await runConformance({
    root: value.projectDir,
    repository: value.appDir,
    clock,
  });
  return value;
}
async function raw(root: string) {
  const file = join(root, "src/classify.ts");
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace(
      "content: redacted",
      "content: ticket",
    ),
  );
}

describe("M6 conformance over actual MCP stdio", () => {
  it("checks current source without writing and projects results/details consistently", async () => {
    const { projectDir: root, appDir } = await setup();
    const remote = await connect(root),
      local = await connect(root, true);
    try {
      expect(
        (await call(remote, "run_conformance")).structuredContent.data?.summary
          ?.compliant,
      ).toBe(true);
      await raw(appDir);
      const before = await tree(root);
      const sourceBefore = await tree(appDir);
      const response = await call(remote, "run_conformance");
      expect(response.structuredContent.data?.summary).toMatchObject({
        compliant: false,
        fail: 1,
      });
      expect(JSON.stringify(response)).not.toContain("src/classify.ts");
      expect(JSON.stringify(response)).not.toContain('"trace"');
      const resultId = response.structuredContent.data!.results!.find(
        (r) => r.verdict === "fail",
      )!.id;
      expect(
        JSON.stringify(
          await call(remote, "get_conformance_result", { result_id: resultId }),
        ),
      ).not.toContain("src/classify.ts");
      expect(
        JSON.stringify(
          await call(local, "get_conformance_result", { result_id: resultId }),
        ),
      ).toContain("src/classify.ts");
      expect(await tree(root)).toEqual(before);
      expect(await tree(appDir)).toEqual(sourceBefore);
      expect(remote.nonProtocol()).toEqual([]);
      expect(local.nonProtocol()).toEqual([]);
    } finally {
      await remote.close();
      await local.close();
    }
  }, 60000);
  it("checks selected files through fresh repository analysis and rejects nonexistent paths and mistyped arguments", async () => {
    const { projectDir: root, appDir } = await setup();
    await raw(appDir);
    const client = await connect(root);
    try {
      const before = await tree(root);
      const result = await call(client, "check_proposed_change", {
        files: ["src/classify.ts"],
      });
      expect(result.structuredContent.data?.compliant).toBe(false);
      expect(JSON.stringify(result)).not.toContain("src/classify.ts");
      for (const [name, args] of [
        ["run_conformance", { workload: 17 }],
        ["run_conformance", { workload: "missing" }],
        ["check_proposed_change", { files: ["missing.ts"] }],
        ["check_proposed_change", { files: ["../outside.ts"] }],
        ["check_proposed_change", { files: [12] }],
        ["check_proposed_change", { files: [] }],
        [
          "check_proposed_change",
          { workload: "missing", candidate_ref: "missing" },
        ],
        ["check_proposed_change", {}],
        ["get_conformance_result", { result_id: 12 }],
      ] as const) {
        const reply = await call(client, name, args);
        expect(reply.isError).toBe(true);
        expect(reply.structuredContent.error?.code).toBe("invalid_arguments");
      }
      expect(await tree(root)).toEqual(before);
    } finally {
      await client.close();
    }
  }, 60000);
  it("keeps conformance read errors out of remote tool payloads", async () => {
    const { projectDir: root } = await setup();
    const outside = join(await tempDir("m6-private-path-"), "private.txt");
    await writeFile(outside, "PRIVATE_SENTINEL");
    await mkdir(join(root, ".anvilmark/scans"));
    await symlink(outside, join(root, ".anvilmark/scans/repository-scan.json"));
    const client = await connect(root);
    try {
      const response = await call(client, "run_conformance");
      expect(response.isError).toBe(true);
      expect(response.structuredContent.error?.code).toBe("internal_error");
      expect(JSON.stringify(response)).not.toContain(root);
      expect(JSON.stringify(response)).not.toContain(outside);
      expect(JSON.stringify(response)).not.toContain("PRIVATE_SENTINEL");
      expect(await readFile(outside, "utf8")).toBe("PRIVATE_SENTINEL");
    } finally {
      await client.close();
    }
  }, 60000);
  it("reports unavailable evidence without claiming compliance", async () => {
    const { projectDir: root } = await setup();
    await writeFile(
      join(root, CONFORMANCE_OUTPUT_PATH),
      '{"format":"obsolete"}',
    );
    const client = await connect(root);
    try {
      expect(
        (await call(client, "run_conformance")).structuredContent.data?.summary
          ?.compliant,
      ).toBe(false);
    } finally {
      await client.close();
    }
  }, 60000);
});
