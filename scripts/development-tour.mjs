#!/usr/bin/env node
// Guided, offline development workflow tour. The stand-in agent is test-only.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(checkout, "packages/cli/bin/anvilmark.mjs");
const fixture = join(checkout, "examples/development-pilot");
const args = new Set(process.argv.slice(2));
const help = `Usage: bash scripts/development-tour.sh [--auto] [--keep] [--help]

Enter advances through each explained command; q quits. --auto runs without
pauses for a rehearsal. --keep preserves the temporary demo repository.
The offline run uses a stand-in agent and agent-test records. It does not
consume a model, spend API money, or create human approval evidence.`;

if (args.has("--help")) {
  console.log(help);
  process.exit(0);
}
if ([...args].some((arg) => !["--auto", "--keep"].includes(arg))) {
  console.error(help);
  process.exit(2);
}
const auto = args.has("--auto");
const keep = args.has("--keep");
if (!auto && !process.stdin.isTTY) {
  console.error("Open this tour in a terminal, or use --auto for a rehearsal.");
  process.exit(2);
}
if (!existsSync(join(checkout, "packages/cli/dist/bin.js"))) {
  console.error(
    "Build Anvilmark first: run node scripts/setup.mjs from the checkout.",
  );
  process.exit(2);
}

const quote = (value) =>
  /^[a-zA-Z0-9_./:=+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
const short = (path) => relative(checkout, path) || ".";
const heading = (index, title, explanation) => {
  console.log(`\n${"=".repeat(72)}\n${index}. ${title}\n${"=".repeat(72)}`);
  console.log(explanation);
};

let scratch;
let input;
try {
  scratch = mkdtempSync(join(tmpdir(), "anvilmark-development-tour-"));
  const project = join(scratch, "project");
  const standIn = join(scratch, "stand-in-agent.mjs");
  input = auto
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });
  let stepNumber = 0;

  async function next(title, explanation) {
    heading(++stepNumber, title, explanation);
    if (auto) return;
    const answer = await input.question("\n[Enter: run this step | q: quit] ");
    if (answer.trim().toLowerCase() === "q") throw new Error("tour_quit");
  }

  function command(binary, commandArgs, options = {}) {
    const shownBinary = binary === process.execPath ? "node" : binary;
    const environment = Object.entries(options.env ?? {}).map(
      ([key, value]) => `${key}=${quote(value)}`,
    );
    console.log(
      `\n$ ${[...environment, ...[shownBinary, ...commandArgs].map(quote)].join(" ")}`,
    );
    const result = spawnSync(binary, commandArgs, {
      cwd: options.cwd ?? checkout,
      env: { ...process.env, FORCE_COLOR: "0", ...options.env },
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeout ?? 120_000,
    });
    if (result.error) throw result.error;
    if (options.render) options.render(result.stdout);
    else if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stdout.write(result.stderr);
    const expected = options.expected ?? 0;
    if (
      expected === "nonzero" ? result.status === 0 : result.status !== expected
    )
      throw new Error(`Command exited ${result.status}; expected ${expected}.`);
    if (expected === "nonzero")
      console.log(`(Expected nonzero exit: ${result.status})`);
    return result.stdout;
  }

  const dev = (subcommand, extra = [], options = {}) =>
    command(
      process.execPath,
      [
        short(cli),
        "development",
        subcommand,
        ...extra,
        "--project-dir",
        project,
      ],
      { ...options, cwd: checkout },
    );

  console.log("ANVILMARK: guided development workflow tour");
  console.log(
    "This is a disposable, offline coding example. No model is called.",
  );
  console.log(`Demo workspace: ${project}`);

  await next(
    "Understand the current repository",
    "The first report maps declared components, source areas, working style, goal-related file leads, and recorded coding-agent provenance. Historical model authorship stays unknown when there is no session evidence. This is a focused view of the CLI's JSON output.",
  );
  command(
    process.execPath,
    [
      short(cli),
      "development",
      "landscape",
      "--goal",
      "Improve development model selection",
      "--json",
    ],
    {
      render: (output) => {
        const report = JSON.parse(output);
        console.log(
          `Commit: ${report.repository.commit.slice(0, 12)}; tracked files: ${report.repository.tracked_file_count}`,
        );
        console.log(
          "Languages:",
          JSON.stringify(report.working_style.languages_by_tracked_extension),
        );
        console.log("Components and stated purposes:");
        for (const component of report.design.components.filter((item) =>
          [
            "anvilmark",
            "@anvilmark/cli",
            "@anvilmark/project-contract",
            "@anvilmark/model-catalog",
            "@anvilmark/scanner",
            "@anvilmark/conformance",
          ].includes(item.name),
        )) {
          console.log(
            `- ${component.name} (${component.source}): ${component.declared_purpose?.text ?? "purpose not documented"}`,
          );
        }
        console.log(
          `Declared component links: ${report.design.declared_dependencies.length}`,
        );
        for (const edge of report.design.declared_dependencies
          .filter((item) => item.from === "@anvilmark/cli")
          .slice(0, 6))
          console.log(`- ${edge.from} → ${edge.to} (${edge.source})`);
        console.log("Goal-related file leads:");
        for (const lead of report.change_readiness.file_leads)
          console.log(`- ${lead.path} (${lead.reason})`);
        console.log(
          `Test examples: ${report.working_style.test_file_examples.slice(0, 3).join(", ")}`,
        );
        console.log(
          `Config examples: ${report.working_style.configuration_files.slice(0, 3).join(", ")}`,
        );
        console.log(
          `Root scripts: ${report.working_style.package_scripts.find((item) => item.source === "package.json")?.names.join(", ") ?? "none"}`,
        );
        console.log(
          `Recorded Anvilmark coding runs: ${report.development_provenance.recorded_runs}`,
        );
        for (const run of report.development_provenance.recent_runs.slice(0, 3))
          console.log(`- Recent captured run: ${JSON.stringify(run)}`);
        console.log(
          `Historical authoring model: ${report.development_provenance.historical_authoring_model}`,
        );
        console.log(
          "The full report is available by removing --json from the command above.",
        );
      },
    },
  );

  await next(
    "Prepare a tiny coding task",
    "We copy a three-file example into a new Git repository. Its check fails at the baseline, so later output can show exactly what changed. The source checkout stays untouched.",
  );
  mkdirSync(project);
  for (const name of ["label.mjs", "check.mjs", "prompt.txt"])
    copyFileSync(join(fixture, name), join(project, name));
  const plan = JSON.parse(readFileSync(join(fixture, "plan.json"), "utf8"));
  plan.phase = {
    id: "phase.label-normalization",
    outcome: "Repeated punctuation is normalized correctly",
    required_inputs: ["Current label behavior and the frozen failing check"],
    interface_commitments: ["Keep the normalizeLabel(input) export"],
    non_goals: ["No UI or storage changes"],
    depends_on: [],
    integration_checks: [
      { name: "syntax-check", argv: ["node", "--check", "label.mjs"] },
    ],
    max_attempts: 1,
    escalation:
      "Stop and ask a person to revise the plan after a failed attempt",
  };
  writeFileSync(
    join(project, "plan.json"),
    `${JSON.stringify(plan, null, 2)}\n`,
  );
  command("git", ["init", "-q", project]);
  command("git", ["-C", project, "config", "user.name", "Anvilmark Tour"]);
  command("git", [
    "-C",
    project,
    "config",
    "user.email",
    "tour@example.invalid",
  ]);
  command("git", [
    "-C",
    project,
    "add",
    "label.mjs",
    "check.mjs",
    "prompt.txt",
    "plan.json",
  ]);
  command("git", ["-C", project, "commit", "-qm", "Freeze demo baseline"]);
  command("node", ["check.mjs"], { cwd: project, expected: "nonzero" });

  await next(
    "Review the proposed phase contract",
    "The plan freezes the task, accepted model choices, checks, and a bounded phase. Its attempt limit prevents endless automatic correction cycles; a failed attempt requires a new approved plan.",
  );
  command("cat", ["plan.json"], { cwd: project });
  await next(
    "Save the exact plan",
    "Anvilmark validates the plan and stores it with a content hash. Changing the plan later invalidates its approval.",
  );
  dev("plan", ["--file", "plan.json"]);

  await next(
    "Compare eligible setups",
    "The recommendation checks restrictions and comparable reviewed outcomes. These example models have no quality evidence, so the declared strong baseline remains the starting point; token guesses do not pick a cheap winner.",
  );
  dev("recommend");

  await next(
    "Verify the agent handoff",
    "The scout fixes the Git base commit, hashes file leads, and runs the baseline check in a separate checkout. A failed check is an observation, not a diagnosis.",
  );
  const scout = dev("scout", ["--prompt-file", "prompt.txt"]);
  const handoff = scout.match(/Saved verified handoff ([a-f0-9]{64})\./)?.[1];
  if (!handoff) throw new Error("Could not read the handoff ID.");

  await next(
    "Mark a test-only approval",
    "This offline tour uses agent-test approval. Real work instead pauses for a person to inspect the exact plan and type its hash in a local terminal.",
  );
  dev("approve", ["--agent-test"]);

  writeFileSync(
    standIn,
    `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync("label.mjs", 'export function normalizeLabel(input) {\\n  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");\\n}\\n');\nconsole.log(JSON.stringify({ type: "turn.completed" }));\n`,
  );
  chmodSync(standIn, 0o755);
  await next(
    "Run the handed-off task and checks",
    "A clearly labeled stand-in agent makes the small edit. Anvilmark verifies the handoff before running it, then runs both the task check and phase integration check. No real model or token usage is claimed.",
  );
  const runOutput = dev(
    "run",
    [
      "--candidate",
      "strong",
      "--prompt-file",
      "prompt.txt",
      "--handoff",
      handoff,
    ],
    { env: { ANVILMARK_CODEX_EXECUTABLE: standIn } },
  );
  const runId = runOutput.match(/Recorded run ([A-Za-z0-9._-]+):/)?.[1];
  if (!runId) throw new Error("Could not read the run ID.");

  await next(
    "Inspect the observed change",
    "The file diff and recorded checks are what a person reviews. A passing check does not itself establish that the change is a good architecture choice.",
  );
  command("git", ["-C", project, "diff", "--", "label.mjs"]);
  dev("report");

  await next(
    "Record a test-only review",
    "This confirms the mechanical review path. It is labeled agent-test and is excluded from model-quality comparisons. Real acceptance requires a person to inspect the exact run and type its run hash.",
  );
  dev("review", ["--run", runId, "--agent-test"]);
  dev("report");

  await next(
    "Show the closure gate",
    "We deliberately try to close the phase. Anvilmark rejects a test-only review; only a human-accepted, fully checked, committed result can close a phase and unlock dependent work.",
  );
  dev("close", ["--run", runId], { expected: "nonzero" });

  await next(
    "Check what the comparison learned",
    "A simulated run cannot improve a model ranking. The report continues to state the evidence gap instead of treating this one toy success as a proven winner.",
  );
  dev("recommend");

  console.log(
    "\nTour complete. For real work, replace the test approval and stand-in run with:",
  );
  console.log(
    "  anvilmark development approve                 # person types plan hash",
  );
  console.log(
    "  anvilmark development run --candidate ID --prompt-file FILE --handoff ID",
  );
  console.log(
    "  anvilmark development review --run ID          # person reviews exact result",
  );
  console.log("  git add ... && git commit -m 'Complete phase'");
  console.log(
    "  anvilmark development close --run ID           # verifies committed result",
  );
  console.log(
    "This test run reports configured-only model identity and unknown cash cost.",
  );
  if (keep) console.log(`Preserved demo repository: ${project}`);
} catch (error) {
  if (error.message === "tour_quit") console.log("\nTour stopped.");
  else {
    console.error(`\nTour failed: ${error.message}`);
    process.exitCode = 1;
  }
} finally {
  input?.close();
  if (scratch && !keep) rmSync(scratch, { recursive: true, force: true });
}
