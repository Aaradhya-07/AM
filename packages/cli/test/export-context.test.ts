import { execFileSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isSensitivePath,
  type RepoContext,
} from "../src/commands/export-context.js";
import { FAKE_KEY, cleanup, cli, scriptedIo, tempDir } from "./helpers.js";

afterEach(cleanup);

function git(root: string, ...args: string[]): void {
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

async function project(options: { git: boolean }): Promise<string> {
  const parent = await tempDir();
  const root = join(parent, "shop");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs", "adr"), { recursive: true });
  await mkdir(join(root, "node_modules", "left-pad"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, ".anvilmark"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "shop-app",
      packageManager: "pnpm@11.0.0",
      scripts: {
        build: "next build",
        test: "vitest run",
        lint: "eslint .",
        deploy: `DEPLOY_TOKEN=${FAKE_KEY} ./deploy.sh`,
      },
      dependencies: { next: "15.0.0", react: "19.0.0" },
      devDependencies: { vitest: "4.0.0" },
    }),
  );
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeFile(
    join(root, "src", "index.ts"),
    "export const SECRET_SOURCE_MARKER = 1;\n",
  );
  await writeFile(join(root, "src", "page.tsx"), "export default 1;\n");
  await writeFile(join(root, "docs", "adr", "0001-use-next.md"), "# ADR\n");
  await writeFile(join(root, "docs", "guide.md"), "# Guide\n");
  await writeFile(join(root, ".env"), `OPENAI_API_KEY=${FAKE_KEY}\n`);
  await writeFile(join(root, ".env.local"), `TOKEN=${FAKE_KEY}\n`);
  await writeFile(join(root, "server.pem"), "-----BEGIN PRIVATE KEY-----\n");
  await writeFile(join(root, "credentials.json"), "{}\n");
  await writeFile(join(root, "node_modules", "left-pad", "index.js"), "1\n");
  await writeFile(join(root, "dist", "index.js"), "1\n");
  if (options.git) {
    git(root, "init", "-q");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    // Force-add secrets to prove tracked secrets are still excluded.
    git(root, "add", "-f", ".");
    git(root, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
  }
  return root;
}

async function exportContext(
  cwd: string,
  args: readonly string[],
): Promise<{ code: number; out: string; err: string }> {
  const io = scriptedIo({ cwd });
  const code = await cli(["export-context", ...args], io);
  return { code, out: io.out(), err: io.err() };
}

function expectNoSecrets(raw: string): void {
  expect(raw).not.toContain(FAKE_KEY);
  expect(raw).not.toContain("SECRET_SOURCE_MARKER");
  expect(raw).not.toContain("PRIVATE KEY");
  expect(raw).not.toMatch(/"\.env/);
  expect(raw).not.toContain("server.pem");
  expect(raw).not.toContain("credentials.json");
  expect(raw).not.toContain("node_modules");
  expect(raw).not.toContain("dist/");
}

describe("anvilmark export-context", () => {
  it("exports structural metadata of a Git repository to stdout", async () => {
    const root = await project({ git: true });
    const result = await exportContext(root, ["--goal", "Add gift cards"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expectNoSecrets(result.out);

    const report = JSON.parse(result.out) as RepoContext;
    expect(report).toMatchObject({
      version: "anvilmark.repo-context.v1",
      exportedAt: "2026-09-13T10:00:00.000Z",
      repoName: "shop-app",
      goal: "Add gift cards",
      packageManager: "pnpm",
      hasAnvilmarkDir: true,
      adrPaths: ["docs/adr/0001-use-next.md"],
    });
    expect(report.languages).toEqual(["TypeScript"]);
    expect(report.frameworks).toEqual(
      expect.arrayContaining(["Next.js", "React", "Vitest"]),
    );
    expect(report.scripts).toMatchObject({
      build: "next build",
      test: "vitest run",
      lint: "eslint .",
    });
    expect(report.scripts.deploy).toContain("./deploy.sh");
    expect(report.checkCommands).toEqual([
      "pnpm run lint",
      "pnpm test",
      "pnpm run build",
    ]);
    expect(report.sampleFiles).toEqual([
      "docs/adr/0001-use-next.md",
      "docs/guide.md",
      "package.json",
      "pnpm-lock.yaml",
      "src/index.ts",
      "src/page.tsx",
    ]);
    expect(report.totalTrackedFiles).toBe(6);
    expect(report.summary).toContain("shop-app: 6 tracked file(s)");
  });

  it("walks a non-Git directory safely and writes --out atomically", async () => {
    const root = await project({ git: false });
    const outside = await tempDir();
    await writeFile(join(outside, "leak.ts"), "export {};\n");
    await symlink(outside, join(root, "linked"));
    const result = await exportContext(root, ["--out", "context.json"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe(join(root, "context.json"));

    const raw = await readFile(join(root, "context.json"), "utf8");
    expectNoSecrets(raw);
    expect(raw).not.toContain("leak.ts");
    const report = JSON.parse(raw) as RepoContext;
    expect(report.goal).toBeUndefined();
    expect(report.sampleFiles).toContain("src/index.ts");
    expect(report.sampleFiles).not.toContain(".anvilmark");
    expect(report.scripts.test).toBe("vitest run");
  });

  it("caps sample files at 150 and honours -C", async () => {
    const parent = await tempDir();
    const root = join(parent, "big");
    await mkdir(join(root, "lib"), { recursive: true });
    for (let index = 0; index < 160; index += 1) {
      await writeFile(
        join(root, "lib", `file-${String(index).padStart(3, "0")}.py`),
        "",
      );
    }
    const result = await exportContext(parent, ["-C", "big", "--json"]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.out) as RepoContext;
    expect(report.repoName).toBe("big");
    expect(report.sampleFiles).toHaveLength(150);
    expect(report.totalTrackedFiles).toBe(160);
    expect(report.languages).toEqual(["Python"]);
    expect(report.packageManager).toBeNull();
    expect(report.scripts).toEqual({});
    expect(report.hasAnvilmarkDir).toBe(false);
  });

  it("refuses to replace a symbolic link with --out", async () => {
    const root = await project({ git: false });
    const outside = await tempDir();
    await writeFile(join(outside, "target.json"), "keep\n");
    await symlink(join(outside, "target.json"), join(root, "out.json"));
    const result = await exportContext(root, ["--out", "out.json"]);
    expect(result.code).toBe(1);
    expect(await readFile(join(outside, "target.json"), "utf8")).toBe("keep\n");
  });

  it("classifies sensitive paths", () => {
    for (const path of [
      ".env",
      ".env.production",
      "apps/web/.env.local",
      "deploy/server.key",
      "certs/tls.pem",
      "id_rsa",
      ".npmrc",
      "gcp-service-account.json",
      "config/credentials.json",
      "secrets.yaml",
    ]) {
      expect({ path, sensitive: isSensitivePath(path) }).toEqual({
        path,
        sensitive: true,
      });
    }
    for (const path of ["src/env.ts", "README.md", "src/keyboard.ts"]) {
      expect({ path, sensitive: isSensitivePath(path) }).toEqual({
        path,
        sensitive: false,
      });
    }
  });
});
