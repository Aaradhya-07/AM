#!/usr/bin/env node
/**
 * Real-repository benchmark for the scanner and conformance engine.
 *
 * Runs the BUILT `anvilmark` CLI against pinned public repositories and
 * compares the results with hand-labelled ground truth in
 * `benchmarks/real-repos/repos/*.json`:
 *
 * - detection: every labelled AI call site is `detected` (a provider-call
 *   observation), `flagged` (an AI-related unknown at that site) or `missed`;
 * - noise: total unknowns and unknowns related to AI calls or declared data;
 * - verdicts: each scenario builds a small contract with a SYNTHETIC approval
 *   (actor `benchmark-synthetic-approver`) and scanner declarations, runs
 *   `anvilmark conformance`, and checks the verdict and its evidence.
 *
 * The corpus is never part of `pnpm test`. With `--fetch`, missing
 * repositories are cloned at their pinned commit and their dependencies are
 * installed with `--ignore-scripts`; no repository code is ever executed.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { format, resolveConfig } from "prettier";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const benchmark = join(checkout, "benchmarks", "real-repos");
const cliBin = join(checkout, "packages", "cli", "bin", "anvilmark.mjs");

const USAGE = `Usage:
  node scripts/real-repo-benchmark.mjs --corpus DIR [--fetch] [--repo NAME]...
        [--json FILE] [--markdown FILE] [--keep]

--corpus DIR   directory holding one clone per repository, named as in
               benchmarks/real-repos/repos/NAME.json (or ANVILMARK_REAL_REPO_CORPUS)
--fetch        clone missing repositories at their pinned commit and install
               dependencies with --ignore-scripts (uses the network)
--repo NAME    limit to these repositories
--json FILE    write the full result as JSON
--markdown FILE  write the summary as Markdown
--baseline FILE  compare with a recorded JSON result and exit 1 on a
        regression: fewer calls detected, fewer providers identified, fewer
        scenarios correct, any false pass or false fail, fewer labelled calls
        or scenarios, or a repository the baseline measured being skipped
--keep         keep the temporary projects`;

const AI_PACKAGES = [
  "openai",
  "ollama",
  "ai",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "@google/genai",
  "@mistralai/mistralai",
  "ollama-ai-provider",
  "langchain",
  "together-ai",
  "groq-sdk",
];
const AI_SCOPES = ["@ai-sdk/", "@langchain/", "@openai/"];
const AI_REASONS = new Set([
  "unsupported_provider_sdk",
  "possible_provider_operation_unresolved",
  "runtime_selected_provider",
  "unmodelled_network_hop",
]);

function isAiPackage(detail) {
  return (
    AI_PACKAGES.includes(detail) ||
    AI_SCOPES.some((scope) => detail.startsWith(scope))
  );
}

function aiRelated(unknown) {
  return (
    AI_REASONS.has(unknown.reason) ||
    unknown.classifications.length > 0 ||
    unknown.observation_ref !== null ||
    unknown.detail.some(isAiPackage)
  );
}

function run(command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    seconds: (Date.now() - started) / 1000,
  };
}

function anvilmark(args, cwd, environment) {
  return run(process.execPath, [cliBin, ...args], {
    cwd,
    env: environment,
  });
}

async function loadLibraries() {
  const contract = await import(
    pathToFileURL(
      join(checkout, "packages", "project-contract", "dist", "index.js"),
    ).href
  );
  return { contract };
}

function fetchRepository(corpus, repo) {
  const target = join(corpus, repo.name);
  if (existsSync(join(target, ".git"))) return;
  mkdirSync(target, { recursive: true });
  const git = (args) => {
    const result = run("git", args, { cwd: target });
    if (result.status !== 0)
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  };
  git(["init", "-q"]);
  git(["remote", "add", "origin", repo.url]);
  git(["fetch", "-q", "--depth", "1", "origin", repo.commit]);
  git(["checkout", "-q", "FETCH_HEAD"]);
  const [command, ...args] = repo.install;
  const install = run(command, args, { cwd: target });
  if (install.status !== 0)
    throw new Error(
      `${repo.install.join(" ")} failed in ${repo.name}: ${install.stderr.trim().slice(-500)}`,
    );
}

function repositoryState(corpus, repo) {
  const target = join(corpus, repo.name);
  if (!existsSync(join(target, ".git"))) return { ok: false, reason: "absent" };
  const head = run("git", ["rev-parse", "HEAD"], { cwd: target }).stdout.trim();
  if (head !== repo.commit)
    return {
      ok: false,
      reason: `at ${head.slice(0, 12)}, expected ${repo.commit.slice(0, 12)}`,
    };
  if (!existsSync(join(target, "node_modules")))
    return { ok: false, reason: "dependencies not installed" };
  return { ok: true, path: target };
}

function near(location, path, line) {
  return location.path === path && Math.abs(location.start.line - line) <= 1;
}

function detection(repo, artifact) {
  const calls = artifact.observations.filter((o) => o.kind === "provider_call");
  return repo.ai_calls.map((label) => {
    const observed = calls.find((call) =>
      near(call.location, label.path, label.line),
    );
    if (observed !== undefined) {
      const provider = observed.endpoint?.provider ?? observed.provider;
      const literalProvider =
        label.provider.includes(":") || label.provider === "runtime"
          ? null
          : label.provider;
      return {
        ...label,
        status: "detected",
        observed_provider: provider,
        observed_operation: observed.operation,
        provider_correct:
          literalProvider === null ? null : provider === literalProvider,
      };
    }
    const flagged = artifact.unknowns.find(
      (unknown) =>
        near(unknown.location, label.path, label.line) && aiRelated(unknown),
    );
    return flagged === undefined
      ? { ...label, status: "missed" }
      : { ...label, status: "flagged", flagged_reason: flagged.reason };
  });
}

function scenarioContract(libraries, repo, scenario, repositoryRoot) {
  const { contract: lib } = libraries;
  const now = "2026-09-17T00:00:00.000Z";
  const workload = scenario.workload;
  const candidate = scenario.candidate;
  const candidateId = `candidate.${workload.id}.approved`;
  const decisionId = `decision.${workload.id}`;
  const deployment =
    candidate.mode === "local"
      ? {
          mode: "local",
          runtime: candidate.runtime ?? null,
          hardware_ref: null,
        }
      : { mode: candidate.mode, provider: candidate.provider, region: null };
  const rule =
    scenario.rule.kind === "forbid_dataflow"
      ? {
          id: `rule.${workload.id}.data_stays_local`,
          kind: "forbid_dataflow",
          severity: "error",
          constraint_ref: `privacy.${workload.id}.local`,
          from: { data_classification: scenario.rule.classification },
          to: { trust_boundary: "remote_provider" },
          unless: null,
        }
      : {
          id: `rule.${workload.id}.approved_candidate`,
          kind: "approved_candidate_only",
          severity: "error",
          workload_ref: workload.id,
          approved_decision_ref: decisionId,
        };
  const document = {
    schema: lib.PROJECT_SCHEMA_ID,
    schema_version: lib.PROJECT_SCHEMA_VERSION,
    project: {
      id: `benchmark-${scenario.id}`,
      name: `Benchmark ${scenario.id}`,
      created_at: now,
      updated_at: now,
      contract_revision: 1,
      state: "draft",
      repository_roots: [repositoryRoot],
      owners: [],
      priority_order: [],
    },
    intent: {
      summary: `Real-repository benchmark scenario for ${repo.name}: ${scenario.description}`,
    },
    workloads: [
      {
        id: workload.id,
        name: workload.id,
        input_classification: workload.input,
        output_contract: { kind: "plain_text" },
        expected_usage: { basis: "unknown", calls_per_month: null },
        current_decision_ref: decisionId,
      },
    ],
    constraints:
      scenario.rule.kind === "forbid_dataflow"
        ? [
            {
              id: `privacy.${workload.id}.local`,
              domain: "privacy",
              severity: "hard",
              subject: `data.${scenario.rule.classification}`,
              operator: "must_not_leave",
              value: "local_trust_boundary",
              source: "user",
            },
          ]
        : [],
    candidates: [
      {
        id: candidateId,
        workload_ref: workload.id,
        component_kind: candidate.component_kind,
        model: {
          family: candidate.model,
          version: candidate.version,
          version_mutability: candidate.mutability,
        },
        deployment,
        status: "selected",
      },
    ],
    decisions: [
      {
        id: decisionId,
        scope: { kind: "workload", workload_ref: workload.id },
        status: "proposed",
        revision: 1,
        selected_candidate_ref: candidateId,
        alternatives: [],
        rationale: {
          summary: "Synthetic benchmark decision; not a real project decision.",
          generated_by: null,
          reviewed_by_user: true,
        },
        created_at: now,
        updated_at: now,
      },
    ],
    architecture: {
      authority: "anvilmark",
      nodes: [
        {
          id: "app",
          kind: "service",
          name: "Application",
          trust_boundary: "local",
        },
        {
          id: "ai-provider",
          kind: "external_system",
          name: "AI provider",
          trust_boundary: "remote_provider",
        },
      ],
      relationships: [
        {
          id: "app-to-ai-provider",
          kind: "connects",
          source: "app",
          destination: "ai-provider",
          workload_ref: workload.id,
          data_classification: workload.input,
        },
      ],
      decision_bindings: [],
    },
    conformance_rules: [rule],
  };
  const parsed = lib.parseProjectContract(JSON.stringify(document), "json");
  if (!parsed.ok)
    throw new Error(
      `scenario ${scenario.id} contract is invalid: ${JSON.stringify(parsed.issues.slice(0, 3))}`,
    );
  const approved = lib.appendApproval(parsed.value, {
    decisionId,
    actorRef: "benchmark-synthetic-approver",
    approvedAt: now,
    note: "Synthetic benchmark approval; not a human decision.",
  });
  if (!approved.ok)
    throw new Error(
      `scenario ${scenario.id} approval failed: ${JSON.stringify(approved.issues)}`,
    );
  const final = lib.parseProjectContract(
    JSON.stringify({
      ...approved.value,
      decisions: approved.value.decisions.map((decision) =>
        decision.id === decisionId
          ? { ...decision, status: "approved" }
          : decision,
      ),
    }),
    "json",
  );
  if (!final.ok)
    throw new Error(
      `scenario ${scenario.id} approved contract is invalid: ${JSON.stringify(final.issues.slice(0, 3))}`,
    );
  return lib.toNormalizedYaml(final.value);
}

function scanDeclarations(scenario, repositoryRoot) {
  const node = (entry, fallback) => ({
    architecture_node_ref: fallback,
    ...entry,
  });
  return {
    format: "anvilmark-scan-config/0.1.0-draft.1",
    repository_root: repositoryRoot,
    ...(scenario.scanner.include ? { include: scenario.scanner.include } : {}),
    ...(scenario.scanner.exclude ? { exclude: scenario.scanner.exclude } : {}),
    sources: (scenario.scanner.sources ?? []).map((entry) =>
      node(entry, "app"),
    ),
    sanitizers: scenario.scanner.sanitizers ?? [],
    sinks: (scenario.scanner.sinks ?? []).map((entry) => ({
      architecture_node_ref: "ai-provider",
      candidate_ref: `candidate.${scenario.workload.id}.approved`,
      ...entry,
    })),
    components: (scenario.scanner.components ?? []).map((entry, index) => ({
      id: `component.${index + 1}`,
      architecture_node_ref: "app",
      workload_ref: scenario.workload.id,
      ...entry,
    })),
  };
}

function judge(scenario, result) {
  const expected = scenario.expected;
  if (result === null) return { correct: false, note: "no result" };
  if (!expected.acceptable.includes(result.verdict))
    return {
      correct: false,
      note: `expected ${expected.acceptable.join("|")}`,
    };
  if (result.verdict === "fail") {
    const wanted =
      expected.evidence_any ??
      (expected.evidence_path ? [expected.evidence_path] : []);
    const first = result.locations[0]?.path ?? null;
    if (wanted.length > 0 && !wanted.includes(first))
      return {
        correct: false,
        note: `failure evidence starts at ${first ?? "nothing"}`,
      };
  }
  return { correct: true, note: "" };
}

function markdown(report) {
  const lines = [
    `# Real-repository benchmark`,
    "",
    `- ANVILMARK: \`${report.anvilmark_commit}\`${report.dirty ? " (uncommitted changes)" : ""}`,
    `- Scanner: ${report.scanner_version ?? "unknown"}; conformance engine: ${report.engine_version ?? "unknown"}`,
    `- Detection recall: **${report.totals.detected}/${report.totals.labelled}** detected, ${report.totals.flagged} flagged, ${report.totals.missed} missed`,
    `- Provider identity: ${report.totals.provider_correct}/${report.totals.provider_checked} detected calls with a literal provider label report that provider`,
    `- Scenarios: **${report.totals.scenarios_correct}/${report.totals.scenarios}** correct; ${report.totals.false_pass} false pass/compliant, ${report.totals.false_fail} false fail`,
    "",
    "| Repository | Files | Scan | Detected | Flagged | Missed | Unknowns (AI-related) | Limits |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const repo of report.repositories) {
    if (repo.skipped) {
      lines.push(`| ${repo.name} | skipped: ${repo.skipped} | | | | | | |`);
      continue;
    }
    lines.push(
      `| ${repo.name} | ${repo.files} | ${repo.scan_seconds.toFixed(1)}s | ${repo.detected} | ${repo.flagged} | ${repo.missed} | ${repo.unknowns} (${repo.ai_unknowns}) | ${repo.limits} |`,
    );
  }
  lines.push(
    "",
    "| Scenario | Expected | Verdict | Correct | Notes |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const repo of report.repositories)
    for (const scenario of repo.scenarios ?? [])
      lines.push(
        `| ${scenario.id} | ${scenario.expected} | ${scenario.verdict ?? "error"} | ${scenario.correct ? "yes" : "**no**"} | ${[scenario.note, scenario.reasons?.slice(0, 6).join(", ")].filter(Boolean).join("; ")} |`,
      );
  lines.push("", "## Missed or flagged call sites", "");
  for (const repo of report.repositories)
    for (const call of repo.calls ?? [])
      if (call.status !== "detected" || call.provider_correct === false)
        lines.push(
          `- ${repo.name} \`${call.path}:${call.line}\` ${call.sdk} ${call.operation} (${call.provider}): **${call.status}**${call.flagged_reason ? ` as ${call.flagged_reason}` : ""}${call.provider_correct === false ? `, provider reported as ${call.observed_provider}` : ""}`,
        );
  return `${lines.join("\n")}\n`;
}

/** Format a file the way `pnpm format` would, so a recorded run stays clean. */
async function formatted(text, target) {
  const resolved = resolve(target);
  return format(text, {
    ...(await resolveConfig(resolved)),
    filepath: resolved,
  });
}

/**
 * Compare a run with a recorded one. A measure may only improve: fewer calls
 * detected or scenarios correct is a regression, and so is measuring less
 * (a skipped repository, a removed label) — otherwise a corpus that failed to
 * clone would report a clean run.
 */
function compare(baseline, report) {
  const before = baseline.totals;
  const now = report.totals;
  const rows = [
    ["Labelled calls", before.labelled, now.labelled, "up"],
    ["Detected", before.detected, now.detected, "up"],
    ["Provider identity", before.provider_correct, now.provider_correct, "up"],
    ["Scenarios", before.scenarios, now.scenarios, "up"],
    [
      "Scenarios correct",
      before.scenarios_correct,
      now.scenarios_correct,
      "up",
    ],
    ["False pass", before.false_pass, now.false_pass, "down"],
    ["False fail", before.false_fail, now.false_fail, "down"],
  ];
  const skippedCount = (totals) => (totals.skipped ?? []).length;
  const newlySkipped = (now.skipped ?? []).filter(
    (name) => !(before.skipped ?? []).includes(name),
  );
  const lines = [
    "",
    `## Compared with \`${baseline.anvilmark_commit}\``,
    "",
    "| Measure | Baseline | This run | |",
    "| --- | ---: | ---: | --- |",
  ];
  let regressed = newlySkipped.length > 0;
  for (const [name, was, is, direction] of rows) {
    const worse = direction === "up" ? is < was : is > was;
    const better = direction === "up" ? is > was : is < was;
    if (worse) regressed = true;
    lines.push(
      `| ${name} | ${was} | ${is} | ${worse ? "**regressed**" : better ? "improved" : "same"} |`,
    );
  }
  if (newlySkipped.length > 0)
    lines.push(
      "",
      `**Skipped repositories the baseline measured: ${newlySkipped.join(", ")}.** A repository that is absent, at another commit or not installed is not a clean run.`,
    );
  else if (skippedCount(now) > 0)
    lines.push("", `Skipped in both runs: ${(now.skipped ?? []).join(", ")}.`);
  lines.push(
    "",
    regressed
      ? "**Regression against the baseline.** Judge the change against it before recording a new result."
      : "No regression against the baseline.",
    "",
  );
  return { regressed, summary: lines.join("\n") };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        corpus: { type: "string" },
        fetch: { type: "boolean" },
        repo: { type: "string", multiple: true },
        json: { type: "string" },
        markdown: { type: "string" },
        baseline: { type: "string" },
        keep: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.values.help) {
    console.log(USAGE);
    return 0;
  }
  const corpusOption =
    parsed.values.corpus ?? process.env.ANVILMARK_REAL_REPO_CORPUS;
  if (corpusOption === undefined) {
    console.error(`--corpus is required\n\n${USAGE}`);
    return 2;
  }
  if (!existsSync(join(checkout, "packages", "cli", "dist", "bin.js"))) {
    console.error("Build ANVILMARK first (pnpm build).");
    return 2;
  }
  mkdirSync(resolve(corpusOption), { recursive: true });
  const corpus = realpathSync(resolve(corpusOption));
  const libraries = await loadLibraries();
  const wanted = parsed.values.repo ?? null;
  if (parsed.values.baseline !== undefined && wanted !== null) {
    console.error(
      `--baseline compares whole runs; drop --repo (a filtered run measures less than the baseline, which is not a regression)\n\n${USAGE}`,
    );
    return 2;
  }
  const repos = readdirSync(join(benchmark, "repos"))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) =>
      JSON.parse(readFileSync(join(benchmark, "repos", name), "utf8")),
    )
    .filter((repo) => wanted === null || wanted.includes(repo.name));

  const work = realpathSync(
    mkdtempSync(join(tmpdir(), "anvilmark-real-repo-benchmark-")),
  );
  const environment = {
    ...process.env,
    ANVILMARK_CONFIG_HOME: join(work, "host-config"),
  };
  const report = {
    anvilmark_commit: run("git", ["rev-parse", "--short", "HEAD"], {
      cwd: checkout,
    }).stdout.trim(),
    dirty:
      run("git", ["status", "--porcelain"], { cwd: checkout }).stdout.trim() !==
      "",
    scanner_version: null,
    engine_version: null,
    repositories: [],
    totals: {},
  };

  for (const repo of repos) {
    if (parsed.values.fetch) fetchRepository(corpus, repo);
    const state = repositoryState(corpus, repo);
    if (!state.ok) {
      report.repositories.push({ name: repo.name, skipped: state.reason });
      continue;
    }
    const projects = join(work, repo.name);
    const zero = join(projects, "zero-config");
    mkdirSync(zero, { recursive: true });
    const root = relative(zero, state.path);
    const init = anvilmark(
      [
        "init",
        "--idea",
        `Benchmark ${repo.name}`,
        "--name",
        repo.name,
        "--repo",
        root,
      ],
      zero,
      environment,
    );
    if (init.status !== 0)
      throw new Error(`init failed for ${repo.name}: ${init.stderr}`);
    const scan = anvilmark(
      ["scan", "--repository", state.path],
      zero,
      environment,
    );
    if (scan.status !== 0)
      throw new Error(`scan failed for ${repo.name}: ${scan.stderr}`);
    const artifact = JSON.parse(
      readFileSync(
        join(zero, ".anvilmark", "scans", "repository-scan.json"),
        "utf8",
      ),
    );
    report.scanner_version = artifact.scanner.version;
    const calls = detection(repo, artifact);
    const entry = {
      name: repo.name,
      commit: repo.commit,
      files: artifact.inventory.source_file_count,
      scan_seconds: scan.seconds,
      detected: calls.filter((c) => c.status === "detected").length,
      flagged: calls.filter((c) => c.status === "flagged").length,
      missed: calls.filter((c) => c.status === "missed").length,
      provider_calls_observed: artifact.observations.filter(
        (o) => o.kind === "provider_call",
      ).length,
      unknowns: artifact.unknowns.length,
      ai_unknowns: artifact.unknowns.filter(aiRelated).length,
      limits: artifact.limits.length,
      calls,
      scenarios: [],
    };

    for (const scenario of repo.scenarios) {
      const directory = join(projects, scenario.id);
      mkdirSync(directory, { recursive: true });
      const repositoryRoot = relative(directory, state.path);
      const contractFile = join(projects, `${scenario.id}.contract.yaml`);
      writeFileSync(
        contractFile,
        scenarioContract(libraries, repo, scenario, repositoryRoot),
      );
      const imported = anvilmark(
        ["init", "--from-contract", contractFile],
        directory,
        environment,
      );
      if (imported.status !== 0)
        throw new Error(
          `init --from-contract failed for ${scenario.id}: ${imported.stderr}`,
        );
      writeFileSync(
        join(directory, ".anvilmark", "scanner.yaml"),
        `${JSON.stringify(scanDeclarations(scenario, repositoryRoot), null, 2)}\n`,
      );
      const conformance = anvilmark(
        ["conformance", "--json"],
        directory,
        environment,
      );
      let result = null;
      let problem = "";
      try {
        const document = JSON.parse(conformance.stdout);
        report.engine_version =
          document.engine?.version ?? report.engine_version;
        result = document.results?.[0] ?? null;
        if (result === null)
          problem = `no result; analysis errors: ${JSON.stringify(document.analysis_errors ?? []).slice(0, 200)}`;
      } catch {
        problem = `exit ${conformance.status}: ${conformance.stderr.trim().slice(0, 300)}`;
      }
      const judgement = judge(scenario, result);
      entry.scenarios.push({
        id: scenario.id,
        expected: scenario.expected.verdict,
        verdict: result?.verdict ?? null,
        correct: judgement.correct,
        note: [judgement.note, problem].filter(Boolean).join("; "),
        reasons: result?.unknown_reasons ?? [],
        locations: (result?.locations ?? [])
          .slice(0, 5)
          .map((l) => `${l.path}:${l.start.line}`),
        explanation: result?.explanation ?? null,
        seconds: conformance.seconds,
      });
    }
    report.repositories.push(entry);
  }

  const active = report.repositories.filter((r) => !r.skipped);
  const allCalls = active.flatMap((r) => r.calls);
  const allScenarios = active.flatMap((r) => r.scenarios);
  report.totals = {
    labelled: allCalls.length,
    detected: allCalls.filter((c) => c.status === "detected").length,
    flagged: allCalls.filter((c) => c.status === "flagged").length,
    missed: allCalls.filter((c) => c.status === "missed").length,
    provider_checked: allCalls.filter(
      (c) => c.provider_correct !== null && c.provider_correct !== undefined,
    ).length,
    provider_correct: allCalls.filter((c) => c.provider_correct === true)
      .length,
    scenarios: allScenarios.length,
    scenarios_correct: allScenarios.filter((s) => s.correct).length,
    false_pass: allScenarios.filter(
      (s) => s.verdict === "pass" && s.expected !== "pass",
    ).length,
    false_fail: allScenarios.filter(
      (s) => s.verdict === "fail" && s.expected !== "fail",
    ).length,
    skipped: report.repositories.filter((r) => r.skipped).map((r) => r.name),
  };

  let summary = markdown(report);
  let regressed = false;
  if (parsed.values.baseline !== undefined) {
    const comparison = compare(
      JSON.parse(readFileSync(parsed.values.baseline, "utf8")),
      report,
    );
    regressed = comparison.regressed;
    summary += comparison.summary;
  }
  process.stdout.write(summary);
  // Recorded results are committed, so they are written the way the
  // repository's formatter would write them.
  if (parsed.values.json)
    writeFileSync(
      parsed.values.json,
      await formatted(JSON.stringify(report), parsed.values.json),
    );
  if (parsed.values.markdown)
    writeFileSync(
      parsed.values.markdown,
      await formatted(summary, parsed.values.markdown),
    );
  if (!parsed.values.keep) rmSync(work, { recursive: true, force: true });
  else console.error(`Kept temporary projects in ${work}`);
  return regressed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  },
);
