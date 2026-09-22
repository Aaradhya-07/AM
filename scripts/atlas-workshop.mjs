#!/usr/bin/env node
// Guided local training workspace. Preparation never supplies an approval.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(checkout, "packages/cli/bin/anvilmark.mjs");
const mcp = join(checkout, "packages/mcp/bin/anvilmark-project-mcp.mjs");
const fixtures = join(checkout, "packages/scanner/test/fixtures");
const decision = "decision.classification";
const candidate = "candidate.classification.remote_unselected";
const marker = ".atlas-workshop.json";
const format = "anvilmark-atlas-workshop/1";
const MODEL = "gpt-4o-mini-2024-07-18";
const USAGE = `Usage (from the ANVILMARK checkout):
  pnpm run workshop prepare NEW_DIRECTORY
  pnpm run workshop instructions DIRECTORY
  pnpm run workshop check DIRECTORY
  pnpm run workshop variant DIRECTORY violating|corrected|ambiguous

Creates an isolated, synthetic training project with a PROPOSED decision.
Review and approve that exact decision yourself in a terminal if you accept it.
Check never approves: it generates context and runs conformance only after approval.
Check exits 0 for compliance, 1 for violations, 2 for unknown or an unmet prerequisite.
Variants replace only the known training classify.ts template; manual edits are preserved.
No provider calls, agent launches, automatic model installs or real-project approvals.`;
const quote = (s) => `'${s.replaceAll("'", `'"'"'`)}'`;
const command = (entry, args) =>
  ["node", quote(entry), ...args.map(quote)].join(" ");
const corrected = readFileSync(
  join(fixtures, "repositories/handoff-approved-sanitized/src/classify.ts"),
  "utf8",
).replaceAll('"gpt-4o-mini"', JSON.stringify(MODEL));
const templates = {
  corrected,
  violating: corrected
    .replace(JSON.stringify(MODEL), '"synthetic-unapproved-model"')
    .replace("content: redacted", "content: ticket"),
  ambiguous: readFileSync(
    join(fixtures, "repositories/handoff-ambiguous-runtime/src/classify.ts"),
    "utf8",
  ),
};
function run(root, args, { expected = 0, show = true } = {}) {
  const result = spawnSync(
    process.execPath,
    [cli, ...args, "--project-dir", root],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        ANVILMARK_CONFIG_HOME: join(root, "empty-host-config"),
        FORCE_COLOR: "0",
      },
    },
  );
  if (show && result.stdout) process.stdout.write(result.stdout);
  if (result.status !== expected)
    throw new Error(
      `${args.join(" ")} exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  return result.stdout;
}
function assertPlain(root, path) {
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error(`Refusing a symlink in workshop path: ${path}`);
  }
  return current;
}
function existing(directory) {
  const root = realpathSync(directory);
  const saved = JSON.parse(readFileSync(assertPlain(root, marker), "utf8"));
  if (saved.format !== format)
    throw new Error(
      "This directory is not an Atlas workshop created by this runner.",
    );
  assertPlain(root, ".anvilmark/project.yaml");
  assertPlain(root, "app/src/classify.ts");
  return root;
}
function instructions(root) {
  return `Training workspace: ${root}\n\n1. Inspect the intent, constraints, comparison and exact decision:\n${command(cli, ["status", "--project-dir", root])}\n${command(cli, ["compare", "--workload", "classification", "--project-dir", root])}\n${command(cli, ["review", decision, "--project-dir", root])}\n\n2. If you accept this training decision and its unresolved evidence gaps, approve interactively:\n${command(cli, ["approve", decision, "--project-dir", root])}\n\n3. Generate context and check the initial deliberate violation:\n${command(join(checkout, "scripts/atlas-workshop.mjs"), ["check", root])}\n\n4. Apply the supplied corrected template and recheck:\n${command(join(checkout, "scripts/atlas-workshop.mjs"), ["variant", root, "corrected"])}\n${command(join(checkout, "scripts/atlas-workshop.mjs"), ["check", root])}\n\n5. Inspect the ambiguous template the same way:\n${command(join(checkout, "scripts/atlas-workshop.mjs"), ["variant", root, "ambiguous"])}\n${command(join(checkout, "scripts/atlas-workshop.mjs"), ["check", root])}\n\nOptional MCP server command for your client configuration (not launched here):\n${command(mcp, ["--project-dir", root])}\n\nThe redactor is a synthetic example; effectiveness remains a declared assumption.\nA bounded pass does not prove runtime privacy or empirical model quality.\n`;
}
async function main() {
  const [action, directory, variant, ...extra] = process.argv.slice(2);
  if (action === "--help" || action === undefined) {
    console.log(USAGE);
    return;
  }
  if (
    !["prepare", "instructions", "check", "variant"].includes(action) ||
    !directory ||
    extra.length ||
    (action !== "variant" && variant !== undefined) ||
    (action === "variant" && !Object.hasOwn(templates, variant))
  )
    throw new Error(USAGE);
  const ready = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
    timeout: 10000,
  });
  if (ready.status !== 0)
    throw new Error(
      "Run node scripts/setup.mjs from the checkout before preparing or checking a workshop.",
    );
  const { parseProjectContract, toNormalizedYaml, unwrap, approvalState } =
    await import("../packages/project-contract/dist/index.js");
  if (action === "prepare") {
    const root = resolve(directory);
    mkdirSync(root); // Never reuse an existing directory, even an empty one.
    writeFileSync(
      join(root, marker),
      JSON.stringify({ format }, null, 2) + "\n",
      { flag: "wx" },
    );
    const contract = unwrap(
      parseProjectContract(
        readFileSync(
          join(checkout, "docs/vnext/fixtures/atlas-project.draft.yaml"),
          "utf8",
        ),
        "yaml",
      ),
    );
    if (contract.approvals.length || contract.decisions.length)
      throw new Error(
        "Workshop seed must be unapproved and contain no decision.",
      );
    contract.project.repository_roots = ["app"];
    const input = join(root, "atlas-input.yaml");
    writeFileSync(input, toNormalizedYaml(contract), { flag: "wx" });
    run(root, ["init", "--from-contract", input, "--intelligence", "handoff"]);
    run(root, [
      "intent",
      "add-question",
      "Training exercise: source completeness and redactor effectiveness are assumptions, not measured guarantees.",
    ]);
    run(root, ["propose", "preview", "--task", "propose_candidates"]);
    run(root, ["propose", "export", "--task", "propose_candidates"]);
    const requests = readdirSync(
      join(root, ".anvilmark/intelligence/requests"),
    ).filter((name) => name.endsWith(".json"));
    if (requests.length !== 1)
      throw new Error("Expected exactly one workshop handoff request.");
    const request = requests[0].slice(0, -5);
    // Explicit offline proposal replay. Imported T0 inferences remain T0.
    cpSync(
      join(checkout, "docs/vnext/fixtures/atlas-intelligence-proposal.json"),
      join(root, `.anvilmark/intelligence/handoff/${request}.response.json`),
    );
    run(root, ["propose", "import", request]);
    run(root, [
      "candidate",
      "deploy",
      candidate,
      "--provider",
      "openai",
      "--region",
      "synthetic-training-region",
    ]);
    run(root, [
      "candidate",
      "model",
      candidate,
      "--model",
      "gpt-4o-mini",
      "--model-version",
      MODEL,
      "--model-mutability",
      "pinned",
    ]);
    run(root, ["compare", "--workload", "classification"]);
    run(root, [
      "decision",
      "draft",
      "--id",
      decision,
      "--workload",
      "classification",
      "--select",
      candidate,
      "--alternative",
      "candidate.classification.local_unselected",
      "--unresolved",
      "privacy.raw_ticket_remote,availability.classification_provider,quality.classification_f1,quality.schema_validity",
      "--rationale",
      "Synthetic onboarding exercise for static conformance. Quality, availability and privacy evidence remain unresolved; no live provider or price is validated.",
    ]);
    run(root, ["decision", "propose", decision]);
    run(root, ["review", decision]);
    const app = join(root, "app");
    cpSync(join(fixtures, "repositories/handoff-approved-sanitized"), app, {
      recursive: true,
    });
    // This is an analysis fixture, not an installable/executable inference app.
    writeFileSync(
      join(app, "package.json"),
      JSON.stringify(
        {
          name: "atlas-training-source",
          private: true,
          description:
            "Synthetic static-analysis fixture; do not run inference or install SDKs here.",
        },
        null,
        2,
      ) + "\n",
    );
    cpSync(
      join(fixtures, "synthetic-sdks/openai"),
      join(app, "node_modules/openai"),
      { recursive: true },
    );
    writeFileSync(join(app, "src/classify.ts"), templates.violating);
    writeFileSync(
      join(root, ".anvilmark/scanner.yaml"),
      `format: anvilmark-scan-config/0.1.0-draft.1
repository_root: app
sources:
  - id: source.raw_ticket
    data_classification: raw_customer_ticket
    function: {path: src/tickets.ts, export: readTicket}
    architecture_node_ref: ticket-intake
sanitizers:
  - id: sanitizer.pii
    function: {path: src/redact.ts, export: redactTicket}
    clears: [raw_customer_ticket]
    produces: redacted_customer_ticket
    architecture_node_ref: pii-redactor
sinks:
  - id: sink.openai
    recognizer: openai
    architecture_node_ref: remote-model-provider
    candidate_ref: ${candidate}
components:
  - id: component.classifier
    path: src/classify.ts
    architecture_node_ref: ticket-classifier
    workload_ref: classification
`,
    );
    writeFileSync(join(root, "NEXT-STEPS.txt"), instructions(root));
    console.log(
      "\nPREPARED — awaiting your decision. No approval was recorded.\n" +
        instructions(root),
    );
    return;
  }
  const root = existing(directory);
  if (action === "instructions") {
    console.log(instructions(root));
    return;
  }
  if (action === "variant") {
    const path = assertPlain(root, "app/src/classify.ts");
    if (!Object.values(templates).includes(readFileSync(path, "utf8")))
      throw new Error(
        "classify.ts has manual edits; keep them or save them elsewhere before using a training variant. Nothing was replaced.",
      );
    writeFileSync(path, templates[variant]);
    console.log(
      `Training source set to ${variant}. Run workshop check to evaluate the actual source.`,
    );
    return;
  }
  const { loadProject } = await import("../packages/cli/dist/index.js");
  const loaded = await loadProject(root);
  if (approvalState(loaded.contract, decision).state !== "current")
    throw new Error(
      "The training decision is not currently approved. Run workshop instructions, review the exact decision and approve it yourself if you accept it. No generated files or report were written.",
    );
  run(root, ["generate"]);
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "conformance",
      "--project-dir",
      root,
      "--repository",
      join(root, "app"),
      "--config",
      join(root, ".anvilmark/scanner.yaml"),
    ],
    { cwd: root, encoding: "utf8", timeout: 30000 },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.status === null)
    throw new Error(
      "Conformance did not finish; retry after checking the source and dependencies.",
    );
  console.log(
    `Local evidence: ${join(root, ".anvilmark/conformance/conformance.json")}`,
  );
  process.exitCode = result.status;
}
main().catch((error) => {
  console.error(`Atlas workshop: ${error.message}`);
  process.exitCode = 2;
});
