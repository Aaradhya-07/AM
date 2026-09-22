import { spawnSync } from "node:child_process";
import { copyFile, cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseProjectContract,
  toNormalizedYaml,
  unwrap,
} from "@anvilmark/project-contract";

import { cleanup } from "./helpers.js";
import {
  approvedRemoteContract,
  setupWorkspace,
} from "./conformance-helpers.js";

afterEach(cleanup);

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts/anvilmark-pr-review.mjs");
const FIXTURES = join(REPO_ROOT, "packages/scanner/test/fixtures/repositories");

function git(args: readonly string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function commitAll(repository: string, message: string): string {
  git(["add", "-A"], repository);
  git(
    [
      "-c",
      "user.name=ANVILMARK test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-q",
      "-m",
      message,
    ],
    repository,
  );
  return git(["rev-parse", "HEAD"], repository);
}

/** A repository whose base commit violates the data-flow rule. */
async function repositoryWithViolationAtBase() {
  const { base, appDir } = await setupWorkspace(
    "handoff-disallowed-raw",
    await approvedRemoteContract(),
  );
  git(["init", "-q", "-b", "main"], base);
  const baseSha = commitAll(base, "base: raw ticket reaches the model");
  return { repository: base, appDir, baseSha };
}

function runReview(
  repository: string,
  baseSha: string,
  env: Record<string, string> = {},
) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: repository,
    encoding: "utf8",
    env: {
      ...process.env,
      ANVILMARK_WORKSPACE: repository,
      ANVILMARK_BASE_REF: baseSha,
      ANVILMARK_PROJECT_DIR: "project",
      ANVILMARK_OUTPUT_DIR: "review-out",
      ...env,
    },
  });
  return { ...result, code: result.status ?? 1 };
}

async function readReview(repository: string) {
  const directory = join(repository, "review-out");
  return {
    markdown: await readFile(join(directory, "review.md"), "utf8"),
    json: JSON.parse(await readFile(join(directory, "review.json"), "utf8")),
  };
}

describe("pull-request review", () => {
  it("reports a fix as resolved and passes", async () => {
    const { repository, appDir, baseSha } =
      await repositoryWithViolationAtBase();
    // The head sanitizes the ticket before the model call.
    await copyFile(
      join(FIXTURES, "handoff-approved-sanitized/src/classify.ts"),
      join(appDir, "src/classify.ts"),
    );
    await writeFile(
      join(appDir, "src/classify.ts"),
      (await readFile(join(appDir, "src/classify.ts"), "utf8")).replaceAll(
        '"gpt-4o-mini"',
        '"gpt-4o-mini-2024-07-18"',
      ),
    );
    commitAll(repository, "head: route the ticket through the redactor");

    const run = runReview(repository, baseSha);
    expect({ code: run.code, stderr: run.stderr }).toEqual({
      code: 0,
      stderr: "",
    });

    const { markdown, json } = await readReview(repository);
    expect(markdown).toContain("1 resolved");
    expect(markdown).toContain("| resolved | `rule.raw_ticket_never_remote`");
    expect(markdown).toContain("**Policy changes in this pull request.**");
    expect(markdown).toContain("None.");
    expect(json.diff.counts.resolved).toBe(1);
    expect(json.diff.policy_changed).toBe(false);
  }, 180000);

  it("keeps the base policy when the head weakens its own rules", async () => {
    const { repository, baseSha } = await repositoryWithViolationAtBase();

    // The head deletes the data-flow rule instead of fixing the code. The
    // project state is built by the CLI, so the head's own contract stays
    // internally consistent.
    const weakened = unwrap(
      parseProjectContract(await approvedRemoteContract(), "yaml"),
    );
    weakened.conformance_rules = weakened.conformance_rules.filter(
      (rule) => rule.id !== "rule.raw_ticket_never_remote",
    );
    const other = await setupWorkspace(
      "handoff-disallowed-raw",
      toNormalizedYaml(weakened),
    );
    await rm(join(repository, "project/.anvilmark"), {
      recursive: true,
      force: true,
    });
    await cp(
      join(other.projectDir, ".anvilmark"),
      join(repository, "project/.anvilmark"),
      { recursive: true },
    );
    commitAll(repository, "head: drop the data-flow rule");

    const run = runReview(repository, baseSha, { ANVILMARK_FAIL_ON: "fail" });
    const { markdown, json } = await readReview(repository);

    // The finding still stands, because the base branch's rules were used.
    expect(markdown).toContain("rule.raw_ticket_never_remote");
    expect(markdown).toContain("still open");
    expect(json.policy.rules_removed).toContain("rule.raw_ticket_never_remote");
    expect(markdown).toContain(
      "- Rules removed: `rule.raw_ticket_never_remote`",
    );
    expect(run.code).toBe(1);
  }, 180000);
});
