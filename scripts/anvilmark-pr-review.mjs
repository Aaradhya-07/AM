#!/usr/bin/env node
// Review a pull request against the base branch's ANVILMARK contract.
//
// The head is evaluated with the BASE branch's contract, rules and scanner
// declarations, so a pull request cannot pass its own checks by weakening the
// policy. What the pull request changes about the policy is reported
// separately, from the head's own contract.
//
// Environment:
//   ANVILMARK_WORKSPACE       git checkout with the head commit (default: cwd)
//   ANVILMARK_BASE_REF        base commit or ref to compare against (required)
//   ANVILMARK_PROJECT_DIR     project directory inside the workspace (default: .)
//   ANVILMARK_OUTPUT_DIR      where to write the review (default: anvilmark-review)
//   ANVILMARK_FAIL_ON         comma list: fail, unknown, regressed, policy, stale
//   ANVILMARK_INCLUDE_SOURCE  "true" to include source in the bundles
//   GITHUB_STEP_SUMMARY       appended with the review when set

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAgentBrief,
  collectEvidenceGaps,
  diffPolicy,
  diffReviewBundles,
  openEvidenceGaps,
  policyChanged,
  renderReviewMarkdown,
} from "../packages/conformance/dist/review/index.js";

const anvilmarkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(anvilmarkRoot, "packages/cli/bin/anvilmark.mjs");

const env = (name, fallback) => process.env[name]?.trim() || fallback;
const workspace = resolve(env("ANVILMARK_WORKSPACE", process.cwd()));
const baseRef = env("ANVILMARK_BASE_REF", "");
const projectDir = env("ANVILMARK_PROJECT_DIR", ".");
const outputDir = resolve(
  workspace,
  env("ANVILMARK_OUTPUT_DIR", "anvilmark-review"),
);
const failOn = new Set(
  env("ANVILMARK_FAIL_ON", "fail,stale")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);
const includeSource = env("ANVILMARK_INCLUDE_SOURCE", "false") === "true";

if (baseRef === "") {
  console.error(
    "ANVILMARK_BASE_REF is required (the base commit to compare against).",
  );
  process.exit(2);
}

function git(args, cwd = workspace) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Check and export one worktree; never throws, so the summary can explain. */
function reviewWorktree(worktree, label, notices) {
  const project = join(worktree, projectDir);
  const bundlePath = join(worktree, "anvilmark-review-bundle.json");

  const check = runCli(["check"], project);
  // 0 compliant, 1 violations, 2 unknown or analysis error: all are results.
  if (![0, 1, 2].includes(check.code)) {
    notices.push(`The ${label} check could not run: ${check.stderr.trim()}`);
    return null;
  }

  const exported = runCli(
    [
      "export",
      "--shareable",
      "--require-report",
      "--out",
      bundlePath,
      ...(includeSource ? ["--include-source"] : []),
    ],
    project,
  );
  if (exported.code !== 0) {
    notices.push(`The ${label} export failed: ${exported.stderr.trim()}`);
    return null;
  }
  return JSON.parse(readFileSync(bundlePath, "utf8"));
}

function annotation(bundle, result) {
  const location = result.locations[0];
  if (!location) return null;
  const root = bundle.report?.artifact?.scan?.repository_root ?? ".";
  const file = normalize(join(projectDir, root, location.path));
  const level = result.verdict === "fail" ? "error" : "warning";
  const message = result.explanation
    .replaceAll("%", "%25")
    .replaceAll("\n", "%0A");
  const end = location.end?.line ? `,endLine=${location.end.line}` : "";
  return `::${level} file=${file},line=${location.start.line}${end},title=ANVILMARK ${result.rule_ref}::${message}`;
}

const scratch = mkdtempSync(join(tmpdir(), "anvilmark-pr-review-"));
const worktrees = [];
let exitCode = 0;

try {
  if (git(["cat-file", "-e", `${baseRef}^{commit}`]).status !== 0) {
    const fetched = git(["fetch", "--no-tags", "--depth=1", "origin", baseRef]);
    if (fetched.status !== 0) {
      console.error(
        `Cannot find base commit ${baseRef}. Check out with fetch-depth: 0, or fetch it first.\n${fetched.stderr}`,
      );
      process.exit(2);
    }
  }

  const add = (name, ref) => {
    const path = join(scratch, name);
    const added = git(["worktree", "add", "--detach", path, ref]);
    if (added.status !== 0) {
      throw new Error(`git worktree add ${ref} failed: ${added.stderr}`);
    }
    worktrees.push(path);
    return path;
  };

  const baseTree = add("base", baseRef);
  const headTree = add("head", "HEAD");
  const headPolicyTree = add("head-policy", "HEAD");

  // The head is judged by the base branch's policy.
  const basePolicy = join(baseTree, projectDir, ".anvilmark");
  const headPolicy = join(headTree, projectDir, ".anvilmark");
  if (!existsSync(basePolicy)) {
    console.error(`No ANVILMARK project at ${projectDir} in the base commit.`);
    process.exit(2);
  }
  rmSync(headPolicy, { recursive: true, force: true });
  cpSync(basePolicy, headPolicy, { recursive: true });

  const notices = [];
  const base = reviewWorktree(baseTree, "base", notices);
  const head = reviewWorktree(headTree, "head", notices);
  const headOwnPolicy = reviewWorktree(headPolicyTree, "head policy", notices);

  if (!base || !head) {
    const markdown = [
      "### ANVILMARK review",
      "",
      ...notices.map((notice) => `> [!WARNING]\n> ${notice}\n`),
      "The review could not run. Nothing about this pull request's conformance is claimed.",
      "",
    ].join("\n");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, "review.md"), markdown);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
    }
    console.error(markdown);
    process.exit(2);
  }

  const diff = diffReviewBundles(base, head);
  const policy = headOwnPolicy ? diffPolicy(base, headOwnPolicy) : diff.policy;
  const headResults = head.report.artifact?.results ?? [];
  const gaps = openEvidenceGaps(headResults, collectEvidenceGaps(head.facts));
  const brief = buildAgentBrief({
    project: head.project,
    results: headResults,
    evidenceGaps: collectEvidenceGaps(head.facts),
    reportFreshness: head.report.freshness,
  });
  const markdown = renderReviewMarkdown({
    diff,
    policy,
    evidenceGaps: gaps,
    brief,
    notices,
  });

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "review.md"), markdown);
  writeFileSync(
    join(outputDir, "review.json"),
    `${JSON.stringify({ diff, policy, notices }, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDir, "base-review-bundle.json"),
    `${JSON.stringify(base, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDir, "head-review-bundle.json"),
    `${JSON.stringify(head, null, 2)}\n`,
  );

  for (const result of headResults) {
    if (result.verdict !== "fail" && result.verdict !== "unknown") continue;
    const line = annotation(head, result);
    if (line) console.log(line);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
  console.log(markdown);

  const failing = headResults.some((result) => result.verdict === "fail");
  const unresolved = headResults.some((result) => result.verdict === "unknown");
  const regressed = diff.findings.some(
    (finding) => finding.change === "regressed" || finding.change === "added",
  );
  const stale = head.report.freshness !== "current";
  const reasons = [
    failOn.has("fail") && failing ? "a failing code check" : null,
    failOn.has("unknown") && unresolved ? "an unresolved code check" : null,
    failOn.has("regressed") && regressed ? "a new or regressed finding" : null,
    failOn.has("policy") && policyChanged(policy) ? "a policy change" : null,
    failOn.has("stale") && stale ? "a report that is not current" : null,
  ].filter(Boolean);
  if (reasons.length > 0) {
    console.error(`ANVILMARK review failed on ${reasons.join(", ")}.`);
    exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 2;
} finally {
  for (const path of worktrees) {
    git(["worktree", "remove", "--force", path]);
  }
  rmSync(scratch, { recursive: true, force: true });
}

process.exit(exitCode);

export {};
