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
const help = `Usage: bash scripts/development-tour.sh [--auto] [--keep] [--human-review] [--help]

Enter advances through each explained command; q quits. --auto runs without
pauses for a rehearsal. --keep preserves the temporary demo repository.
--human-review lets a presenter review the patch and record a terminal sign-off.
The offline run uses a stand-in agent and agent-test records. It does not
consume a model, spend API money, or create human approval evidence.`;

if (args.has("--help")) {
  console.log(help);
  process.exit(0);
}
if (
  [...args].some((arg) => !["--auto", "--keep", "--human-review"].includes(arg))
) {
  console.error(help);
  process.exit(2);
}
const auto = args.has("--auto");
const keep = args.has("--keep");
const humanReview = args.has("--human-review");
if (humanReview && (auto || !process.stdout.isTTY)) {
  console.error("--human-review requires the guided terminal tour.");
  process.exit(2);
}
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
      ...(options.interactive ? { stdio: "inherit" } : {}),
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
    "Prepare a tiny coding task",
    "We copy a three-file example into a new Git repository. Its check fails at the baseline, so later output can show exactly what changed. The source checkout stays untouched.",
  );
  mkdirSync(project);
  for (const name of ["label.mjs", "check.mjs", "prompt.txt"])
    copyFileSync(join(fixture, name), join(project, name));
  const plan = JSON.parse(readFileSync(join(fixture, "plan.json"), "utf8"));
  plan.architecture.allowed_changed_paths = ["label.mjs"];
  plan.phase = {
    id: "phase.label-normalization",
    outcome: "Repeated punctuation is normalized correctly",
    required_inputs: ["Current label behavior and the frozen failing check"],
    interface_commitments: ["Keep the normalizeLabel(input) export"],
    non_goals: ["No UI or storage changes"],
    depends_on: [],
    integration_checks: [
      {
        name: "bundle",
        argv: [
          join(checkout, "node_modules/.bin/esbuild"),
          "label.mjs",
          "--bundle",
          "--platform=node",
          "--format=esm",
          "--outfile=.anvilmark/build/label.mjs",
        ],
        capture_output: true,
      },
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

  await next(
    "Freeze the plan",
    "The approved architecture permits changes only to label.mjs. The test and bundle commands are part of the frozen plan.",
  );
  dev("plan", ["--file", "plan.json"]);
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
    `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nwriteFileSync("label.mjs", 'export function normalizeLabel(input) {\\n  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");\\n}\\n');\n`,
  );
  chmodSync(standIn, 0o755);
  await next(
    "Run the handed-off task and checks",
    "A clearly labeled stand-in agent makes the small edit. Anvilmark verifies the handoff before running it, then runs both the task check and phase integration check. Node runs the actual tests and esbuild writes the actual bundle. The stand-in does not call a model.",
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
    "Review the patch independently",
    "Read the patch, check that the export is preserved, and compare it with the frozen tests. The timeline also includes a separately executed Git diff hygiene check.",
  );
  command("git", ["-C", project, "--no-pager", "diff", "--", "label.mjs"]);
  if (humanReview) {
    input.close();
    input = null;
    dev("review", ["--run", runId], { interactive: true });
  } else {
    dev("review", [
      "--run",
      runId,
      "--agent-test",
      "--reason",
      "Rehearsal only. The terminal review path is available with --human-review.",
    ]);
    await next(
      "Read the linked evidence",
      "The timeline links the isolated baseline, exact code change, real test and build results, architecture boundary, and review record.",
    );
  }
  dev("timeline", ["--run", runId]);
  const timeline = JSON.parse(
    dev("timeline", ["--run", runId, "--json"], { render: () => {} }),
  );
  for (const [stage, name, exit] of [
    ["baseline-check", "label-test", 1],
    ["run-check", "label-test", 0],
    ["run-check", "bundle", 0],
    ["independent-diff-check", "tracked-diff-hygiene", 0],
  ]) {
    if (
      !timeline.events.some(
        (event) =>
          event.stage === stage &&
          event.check?.name === name &&
          event.check.exit_code === exit,
      )
    )
      throw new Error(`Missing expected evidence for ${stage} / ${name}.`);
  }
  if (
    !timeline.events.some(
      (event) =>
        event.stage === "architecture-boundary" &&
        event.architecture.violations.length === 0,
    )
  )
    throw new Error("No passing architecture boundary was recorded.");
  console.log("\nTour complete.");
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
