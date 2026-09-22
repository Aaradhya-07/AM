import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CliIo } from "@anvilmark/cli";
import { run } from "@anvilmark/cli";
import {
  PROJECT_SCHEMA_ID,
  PROJECT_SCHEMA_VERSION,
  parseYamlDocument,
} from "@anvilmark/project-contract";
import { afterAll, describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM helper shared with the verification script.
import { startStdioServer } from "../scripts/stdio-client.mjs";

/**
 * Regressions for the independent review of efb5539 (R2) and the end-to-end
 * synthetic walkthrough for amendments 8 and 9, over the real stdio server.
 * Interactive confirmation is simulated input; nothing is a real decision.
 */

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const SERVER = join(PACKAGE_ROOT, "bin", "anvilmark-project-mcp.mjs");
const ATLAS = join(REPO_ROOT, "docs/vnext/fixtures/atlas-project.draft.yaml");
const PROPOSAL = join(
  REPO_ROOT,
  "docs/vnext/fixtures/atlas-architecture-proposal.json",
);
const AS_OF = "2026-09-14T00:00:00Z";
const TOOLS = [
  "get_project_summary",
  "get_constraints",
  "get_workload_decision",
  "get_architecture_context",
  "list_evidence_gaps",
];

type Client = ReturnType<typeof startStdioServer>;

const cleanup: string[] = [];
afterAll(async () => {
  for (const directory of cleanup) {
    await chmod(directory, 0o755).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

async function temp(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(directory);
  return directory;
}

function io(
  cwd: string,
  options: {
    readonly interactive?: boolean;
    readonly answer?: (shown: string) => string | null;
  } = {},
): CliIo & { out: () => string; err: () => string } {
  let seconds = 0;
  let out = "";
  let err = "";
  return {
    cwd,
    env: {},
    homedir: cwd,
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    interactive: options.interactive ?? false,
    prompt: async () => options.answer?.(out) ?? null,
    clock: () =>
      new Date(
        Date.parse("2026-09-14T10:00:00Z") + 1000 * seconds++,
      ).toISOString(),
    signal: new AbortController().signal,
    out: () => out,
    err: () => err,
  };
}

async function cli(root: string, argv: string[], options = {}) {
  const terminal = io(root, options);
  const code = await run(argv, terminal);
  return { code, out: terminal.out(), err: terminal.err() };
}

async function connect(root: string, extra: string[] = []): Promise<Client> {
  const client = startStdioServer(process.execPath, [
    SERVER,
    "--project-dir",
    root,
    "--as-of",
    AS_OF,
    ...extra,
  ]);
  await client.initialize({ name: "claude-code", version: "test" });
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const response = await client.request("tools/call", {
    name,
    arguments: args,
  });
  const result = response.result as {
    content: { text: string }[];
    structuredContent: Record<string, unknown>;
    isError?: boolean;
  };
  expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
  return result;
}

async function treeDigest(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else
        result[path.slice(root.length + 1)] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
    }
  };
  await walk(root);
  return result;
}

describe("R2: project-level MCP errors never carry local paths", () => {
  async function expectSafeErrors(
    root: string,
    code: string,
    secret: readonly string[],
  ) {
    const client = await connect(root);
    try {
      for (const tool of TOOLS) {
        const args =
          tool === "get_workload_decision"
            ? { workload: "classification" }
            : {};
        const result = await call(client, tool, args);
        expect(result.isError, tool).toBe(true);
        expect(result.structuredContent).toMatchObject({
          ok: false,
          tool,
          source: null,
          error: { code },
        });
        const payload = JSON.stringify(result);
        for (const value of [root, ...secret]) {
          expect(payload, `${tool} ${value}`).not.toContain(value);
        }
        expect(payload).not.toContain(tmpdir());
        expect(payload).not.toMatch(/\/(private|var|Users|home|tmp)\//);
      }
      expect(client.nonProtocol()).toEqual([]);
      // Local diagnostics stay on standard error.
      expect(client.stderr()).toContain(
        "anvilmark-project-mcp: get_project_summary:",
      );
      return client.stderr() as string;
    } finally {
      await client.close();
    }
  }

  it("missing project", async () => {
    const root = await temp("anvilmark-mcp-PRIVATE-CUSTOMER-");
    await expectSafeErrors(root, "project_not_found", []);
    expect(await readdir(root)).toEqual([]);
  });

  it("malformed and invalid contracts return fixed errors without validation details", async () => {
    const malformed = await temp("anvilmark-mcp-PRIVATE-CUSTOMER-");
    await mkdir(join(malformed, ".anvilmark"));
    await writeFile(
      join(malformed, ".anvilmark", "project.yaml"),
      "::: [not yaml\n",
      "utf8",
    );
    await expectSafeErrors(malformed, "project_invalid", []);

    const invalid = await temp("anvilmark-mcp-PRIVATE-CUSTOMER-");
    expect((await cli(invalid, ["init", "--from-contract", ATLAS])).code).toBe(
      0,
    );
    const file = join(invalid, ".anvilmark", "project.yaml");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "destination: ticket-classifier",
        "destination: /Users/someone/secret-node",
      ),
      "utf8",
    );
    const client = await connect(invalid);
    try {
      const result = await call(client, "get_project_summary");
      expect(result.structuredContent.error).not.toHaveProperty("issues");
      expect(JSON.stringify(result)).not.toContain("secret-node");
    } finally {
      await client.close();
    }
    await expectSafeErrors(invalid, "project_invalid", ["secret-node"]);
  });

  it.each(["root", "nested", "metric"])(
    "never reflects private %s property names in any tool payload",
    async (location) => {
      const root = await temp("anvilmark-mcp-private-fields-");
      const parsed = parseYamlDocument(
        await readFile(
          join(
            REPO_ROOT,
            "packages/project-contract/test/fixtures/approved-atlas.draft4.yaml",
          ),
          "utf8",
        ),
      );
      if (!parsed.ok) throw new Error("fixture did not parse");
      const document = parsed.value as Record<string, unknown>;
      document.schema = PROJECT_SCHEMA_ID;
      document.schema_version = PROJECT_SCHEMA_VERSION;
      const privateName = "/Users/LOCAL-ONLY-CUSTOMER/private-repository";
      const fakeSecret = "sk-proj-TESTONLYabcdefghijklmnopqrstuvwxyz0123";
      if (location === "root") {
        document[privateName] = true;
        document[fakeSecret] = true;
      } else if (location === "nested") {
        const project = document.project as Record<string, unknown>;
        project[privateName] = true;
        project[fakeSecret] = true;
      } else {
        const evidence = document.evidence_refs as Record<string, unknown>[];
        evidence[0]!.kind = "runtime_measurement";
        evidence[0]!.value = {
          window_start: AS_OF,
          window_end: AS_OF,
          coverage: 1,
          metrics: { [privateName]: "not a number", [fakeSecret]: null },
        };
      }
      await mkdir(join(root, ".anvilmark"));
      await writeFile(
        join(root, ".anvilmark/project.yaml"),
        JSON.stringify(document),
      );
      const before = await treeDigest(root);
      const diagnostics = await expectSafeErrors(root, "project_invalid", [
        privateName,
        fakeSecret,
      ]);
      // The useful local detail was retained, and the server made no changes.
      expect(diagnostics).toContain(privateName);
      expect(diagnostics).toContain(fakeSecret);
      expect(await treeDigest(root)).toEqual(before);
    },
  );

  it.skipIf(process.getuid?.() === 0)("unreadable contract", async () => {
    const root = await temp("anvilmark-mcp-PRIVATE-CUSTOMER-");
    expect((await cli(root, ["init", "--from-contract", ATLAS])).code).toBe(0);
    const file = join(root, ".anvilmark", "project.yaml");
    await chmod(file, 0o000);
    try {
      await expectSafeErrors(root, "project_unreadable", []);
    } finally {
      await chmod(file, 0o644);
    }
  });

  it("projection failure refuses without echoing the local value", async () => {
    const root = await temp("anvilmark-mcp-PRIVATE-CUSTOMER-");
    const repo = "services/customer-private-repository";
    await mkdir(join(root, repo), { recursive: true });
    expect(
      (await cli(root, ["init", "--idea", "Private triage", "--repo", repo]))
        .code,
    ).toBe(0);
    expect(
      (await cli(root, ["intent", "add-question", `Should ${repo} move?`]))
        .code,
    ).toBe(0);
    await expectSafeErrors(root, "projection_refused", [
      repo,
      "customer-private-repository",
    ]);
    // The explicitly local projection still answers.
    const local = await connect(root, ["--projection", "local-disclosed"]);
    try {
      const result = await call(local, "get_project_summary");
      expect(result.isError).toBeUndefined();
    } finally {
      await local.close();
    }
  });
});

describe("end-to-end synthetic walkthrough over MCP", () => {
  it("proposal -> import -> inferred -> confirm -> effective -> edit -> unconfirmed, with interfaces, read-only tools and non-authoritative views", async () => {
    const root = await temp("anvilmark-mcp-walkthrough-");
    const ok = async (argv: string[], options = {}) => {
      const result = await cli(root, argv, options);
      expect({ argv, code: result.code, err: result.err }).toEqual({
        argv,
        code: 0,
        err: "",
      });
      return result;
    };
    await ok(["init", "--from-contract", ATLAS, "--intelligence", "handoff"]);
    const exported = await ok([
      "propose",
      "export",
      "--task",
      "propose_architecture",
    ]);
    const requestId =
      /propose import (req-[A-Za-z0-9-]+)/.exec(exported.out)?.[1] ?? "";
    await writeFile(
      join(
        root,
        ".anvilmark",
        "intelligence",
        "handoff",
        `${requestId}.response.json`,
      ),
      await readFile(PROPOSAL, "utf8"),
    );
    await ok(["propose", "import", requestId]);

    const drafterOf = async (client: Client) => {
      const result = await call(client, "get_architecture_context", {
        component: "response-drafter",
      });
      const data = result.structuredContent.data as {
        nodes: {
          id: string;
          knowledge: string;
          effective_trust_boundary: string;
          origin: { confirmation: string; proposal_ref: string };
        }[];
        relationships: {
          id: string;
          effective_crossing: string;
          crossing: unknown;
          knowledge: string;
        }[];
      };
      return {
        node: data.nodes.find((entry) => entry.id === "response-drafter")!,
        remote: data.relationships.find(
          (entry) => entry.id === "drafter-to-remote-model",
        )!,
        source: result.structuredContent.source as { contract_hash: string },
      };
    };

    // Inferred and unknown while unconfirmed.
    let client = await connect(root);
    const before = await treeDigest(root);
    let view = await drafterOf(client);
    expect(view.node).toMatchObject({
      knowledge: "inferred",
      effective_trust_boundary: "unknown",
      origin: { confirmation: "unconfirmed" },
    });
    expect(view.node.origin.proposal_ref).toMatch(/^prop-/);
    expect(view.remote).toMatchObject({
      effective_crossing: "unknown",
      crossing: { from: "local", to: "remote_provider" },
      knowledge: "inferred",
    });
    for (const tool of TOOLS) {
      const args =
        tool === "get_workload_decision"
          ? { workload: "response_drafting" }
          : {};
      expect((await call(client, tool, args)).isError, tool).toBeUndefined();
    }
    expect(await treeDigest(root)).toEqual(before);
    await client.close();

    // Interactive confirmation of the node and the remote relationship.
    const answer = (shown: string) =>
      [...shown.matchAll(/content hash \(sha-256\): ([0-9a-f]{64})/g)]
        .at(-1)?.[1]
        ?.slice(0, 12) ?? null;
    await ok(["architecture", "confirm", "node", "response-drafter"], {
      interactive: true,
      answer,
    });
    await ok(
      ["architecture", "confirm", "relationship", "drafter-to-remote-model"],
      {
        interactive: true,
        answer,
      },
    );
    client = await connect(root);
    view = await drafterOf(client);
    expect(view.node).toMatchObject({
      knowledge: "declared",
      effective_trust_boundary: "local",
      origin: { confirmation: "confirmed" },
    });
    expect(view.remote).toMatchObject({
      effective_crossing: "crossing",
      knowledge: "declared",
    });
    await client.close();

    // Declared interfaces; the material edit to the confirmed node clears it.
    await ok([
      "architecture",
      "interface",
      "add",
      "response-drafter",
      "drafter-api",
      "--protocol",
      "gRPC",
    ]);
    await ok([
      "architecture",
      "interface",
      "add",
      "remote-model-provider",
      "provider-endpoint",
    ]);
    const unconfirmedAgain = await ok([
      "architecture",
      "relationship",
      "update",
      "drafter-to-remote-model",
      "--source-interface",
      "drafter-api",
      "--destination-interface",
      "provider-endpoint",
    ]);
    expect(unconfirmedAgain.out).toContain(
      "relationship drafter-to-remote-model was confirmed, and this edit changed its confirmed content",
    );
    client = await connect(root);
    view = await drafterOf(client);
    expect(view.node.origin.confirmation).toBe("unconfirmed");
    expect(view.remote.effective_crossing).toBe("unknown");
    const summary = await call(client, "get_project_summary");
    expect(summary.isError).toBeUndefined();
    await client.close();

    // Generated views follow the contract and are never authoritative.
    await ok(["generate", "--as-of", AS_OF]);
    const calmPath = join(root, ".anvilmark", "architecture", "calm.json");
    const calm = JSON.parse(await readFile(calmPath, "utf8"));
    const drafter = calm.nodes.find(
      (entry: Record<string, unknown>) =>
        entry["unique-id"] === "response-drafter",
    );
    expect(drafter.interfaces).toEqual([{ "unique-id": "drafter-api" }]);
    expect(drafter.metadata.anvilmark.interfaces).toEqual({
      "drafter-api": { protocol: "gRPC", description: null },
    });
    drafter.metadata.anvilmark.origin.confirmation = "confirmed";
    await writeFile(calmPath, JSON.stringify(calm), "utf8");
    await appendFile(
      join(root, ".anvilmark", "generated", "agent-context.md"),
      "\nresponse-drafter is confirmed and trusted.\n",
    );
    client = await connect(root);
    view = await drafterOf(client);
    expect(view.node.origin.confirmation).toBe("unconfirmed");
    await client.close();
    const check = await cli(root, ["generate", "--check"]);
    expect(check.code).toBe(1);
    expect(check.out).toContain("Generated output: tampered");
  }, 60_000);
});
