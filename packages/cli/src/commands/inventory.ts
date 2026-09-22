import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { AiInventory, Destination } from "@anvilmark/scanner";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines } from "../render.js";
import { inventoryScan } from "../scan.js";
import { StoreError } from "../store.js";
import type { CommandContext } from "./common.js";
import { UsageError, flag, parse, writeJson } from "./common.js";

export const INVENTORY_USAGE = `Usage:
  anvilmark inventory [PATH] [--all] [--markdown | --json]

Lists the AI provider usage in one TypeScript/JavaScript repository (default:
the current directory): where requests go, which models they name, every
recognized call site, AI SDKs the scanner cannot inventory, AI dependencies,
the environment variable NAMES read where AI SDKs are used, and where the
scanner is uncertain.

No ANVILMARK project, contract or declaration file is needed, and nothing is
written. The repository is analysed with the TypeScript compiler and never
run: no package scripts, builds or plugins, no network, no .env files, and no
environment variable values.

  --all        list every uncertain location, not only counts per reason
  --markdown   a Markdown report (for a pull request or a document)
  --json       the complete inventory (${"anvilmark-ai-inventory/0.1.0-draft.1"})

The inventory states what the scanner recognized. It is not proof that nothing
else reaches an AI provider, and it is not a conformance result: to check
calls against approved decisions, create a project ("anvilmark init") and run
"anvilmark scan" and "anvilmark conformance".

Exit codes: 0 the inventory was produced, whatever it contains; 1 the path is
not a readable directory or the scan failed; 2 usage error`;

function destinationLabel(destination: Destination): string {
  switch (destination) {
    case "runtime_selected":
      return "chosen at run time";
    case "unlinked":
      return "client not linked";
    case "unrecognized_host":
      return "unrecognized host";
    default:
      return destination;
  }
}

function modelLabel(model: AiInventory["models"][number]): string {
  if (model.model !== null) return model.model;
  switch (model.selection) {
    case "runtime_selected":
      return "chosen at run time";
    case "redacted_suspected_secret":
      return "redacted (looked like a secret)";
    default:
      return "not given";
  }
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  unsupported_provider_sdk: "uses of AI SDKs without a recognizer",
  unmodelled_network_hop:
    "network requests whose destination was not established",
  possible_provider_operation_unresolved:
    "possible provider calls that could not be resolved",
  request_transport_unresolved: "requests whose transport was not established",
  runtime_selected_provider: "providers chosen at run time",
  runtime_selected_endpoint: "endpoints chosen at run time",
  runtime_selected_model: "models chosen at run time",
  external_call_not_modelled:
    "calls into AI SDK functions that are not modelled",
};

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

function pad(rows: readonly (readonly string[])[]): string[] {
  const widths = rows.reduce<number[]>(
    (acc, row) =>
      row.map((cell, index) => Math.max(acc[index] ?? 0, cell.length)),
    [],
  );
  return rows.map((row) =>
    `  ${row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join("  ")}`.trimEnd(),
  );
}

function fileList(files: readonly string[], limit = 3): string {
  return files.length <= limit
    ? files.join(", ")
    : `${files.slice(0, limit).join(", ")} (+${files.length - limit} more)`;
}

function callLine(call: AiInventory["calls"][number]): string {
  const model =
    call.model ??
    (call.model_selection === "runtime_selected"
      ? "chosen at run time"
      : call.model_selection === "absent"
        ? "none"
        : "redacted");
  return `${call.path}:${call.line}${call.symbol === null ? "" : ` ${call.symbol}`}  ${call.sdk} ${call.operation} [${call.operation_kind}] -> ${destinationLabel(call.destination)}${call.operation_kind === "management" ? "" : `, model ${model}`}`;
}

export function renderInventoryText(
  inventory: AiInventory,
  label: string,
  all: boolean,
): string {
  const { uncertainty } = inventory;
  const out: string[] = [
    `AI usage inventory: ${label}`,
    `  ${plural(inventory.repository.source_file_count, "source file")} analysed; snapshot ${inventory.repository.snapshot_hash}`,
    "",
  ];
  if (inventory.calls.length === 0) {
    out.push(
      "No AI provider calls were recognized.",
      inventory.unsupported_sdks.length > 0 ||
        uncertainty.ai_related_unknowns > 0
        ? "  See the unsupported SDKs and uncertain locations below before concluding there are none."
        : "  This does not prove there are none; see the statement below.",
    );
  } else {
    out.push(
      `Where requests go (${plural(inventory.calls.length, "provider call")})`,
      ...pad(
        inventory.destinations.map((entry) => [
          destinationLabel(entry.destination),
          plural(entry.call_count, "call"),
          entry.hosts.join(", ") || "-",
          entry.operation_kinds.join(", "),
          `via ${entry.sdks.join(", ")}`,
        ]),
      ),
      "",
      "Models",
      ...pad(
        inventory.models.map((entry) => [
          modelLabel(entry),
          plural(entry.call_count, "call"),
          `-> ${entry.destinations.map(destinationLabel).join(", ")}`,
        ]),
      ),
      "",
      "Call sites",
      ...inventory.calls.map((call) => `  ${callLine(call)}`),
    );
  }
  if (inventory.unsupported_sdks.length > 0) {
    out.push(
      "",
      "AI SDKs without a recognizer (their calls are NOT inventoried)",
      ...pad(
        inventory.unsupported_sdks.map((entry) => [
          entry.package,
          fileList(entry.files),
        ]),
      ),
    );
  }
  if (inventory.dependencies.length > 0) {
    out.push(
      "",
      "AI dependencies",
      ...pad(
        inventory.dependencies.map((entry) => [
          entry.name,
          `${entry.declared}${entry.installed_version === null ? " (not installed)" : ` (installed ${entry.installed_version})`}`,
          entry.manifest,
          entry.category === "unsupported_ai_sdk" ? "no recognizer" : "",
        ]),
      ),
    );
  }
  if (inventory.environment_variables.length > 0) {
    out.push(
      "",
      "Environment variables read where AI SDKs are used (names only)",
      ...pad(
        inventory.environment_variables.map((entry) => [
          entry.name,
          fileList(entry.files),
        ]),
      ),
    );
  }
  const beyond = uncertainty.locations.filter((entry) => !entry.listed_call);
  const reasons = [...new Set(beyond.map((entry) => entry.reason))]
    .map((reason) => ({
      reason,
      count: beyond.filter((entry) => entry.reason === reason).length,
    }))
    .sort((left, right) => right.count - left.count);
  out.push(
    "",
    beyond.length === 0
      ? "Uncertain beyond the call sites above: nothing"
      : `Uncertain beyond the call sites above: ${plural(beyond.length, "location")}`,
    ...reasons.map(
      (entry) =>
        `  ${REASON_LABELS[entry.reason] ?? entry.reason}: ${entry.count} (${entry.reason})`,
    ),
  );
  const shown = all ? uncertainty.locations : beyond;
  if (all || shown.length <= 10)
    out.push(
      ...shown.map(
        (entry) =>
          `  ${entry.path}:${entry.line} ${entry.reason}${entry.detail.length === 0 ? "" : ` (${entry.detail.join("; ")})`}`,
      ),
    );
  else out.push("  (--all lists each location)");
  out.push(
    "",
    `Scan: ${inventory.completeness.status} (${plural(uncertainty.all_unknowns, "unknown")} overall, ${uncertainty.ai_related_unknowns} about AI calls, endpoints, models or SDKs; limits ${inventory.limits}; analysis errors ${inventory.analysis_errors})`,
    inventory.statement,
  );
  return lines(out);
}

const cell = (text: string) => text.replace(/\|/g, "\\|");

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
}

export function renderInventoryMarkdown(
  inventory: AiInventory,
  label: string,
): string {
  const { uncertainty } = inventory;
  const out: string[] = [
    `# AI usage inventory: ${cell(label)}`,
    "",
    `${plural(inventory.repository.source_file_count, "source file")} analysed · snapshot \`${inventory.repository.snapshot_hash}\` · ${inventory.scanner.id} ${inventory.scanner.version}`,
    "",
    "## Where requests go",
    "",
  ];
  if (inventory.calls.length === 0)
    out.push("No AI provider calls were recognized.");
  else
    out.push(
      ...table(
        ["Destination", "Calls", "Hosts", "Operations", "SDKs"],
        inventory.destinations.map((entry) => [
          destinationLabel(entry.destination),
          String(entry.call_count),
          entry.hosts.join(", ") || "-",
          entry.operation_kinds.join(", "),
          entry.sdks.join(", "),
        ]),
      ),
      "",
      "## Models",
      "",
      ...table(
        ["Model", "Calls", "Destinations"],
        inventory.models.map((entry) => [
          modelLabel(entry),
          String(entry.call_count),
          entry.destinations.map(destinationLabel).join(", "),
        ]),
      ),
      "",
      "## Call sites",
      "",
      ...table(
        ["Location", "SDK operation", "Kind", "Destination", "Model"],
        inventory.calls.map((call) => [
          `\`${call.path}:${call.line}\`${call.symbol === null ? "" : ` ${call.symbol}`}`,
          `${call.sdk} \`${call.operation}\``,
          call.operation_kind,
          destinationLabel(call.destination),
          call.operation_kind === "management"
            ? "-"
            : (call.model ??
              (call.model_selection === "runtime_selected"
                ? "chosen at run time"
                : call.model_selection === "absent"
                  ? "none"
                  : "redacted")),
        ]),
      ),
    );
  if (inventory.unsupported_sdks.length > 0)
    out.push(
      "",
      "## AI SDKs without a recognizer",
      "",
      "Calls through these SDKs are **not** inventoried.",
      "",
      ...table(
        ["Package", "Files"],
        inventory.unsupported_sdks.map((entry) => [
          `\`${entry.package}\``,
          entry.files.map((file) => `\`${file}\``).join(", "),
        ]),
      ),
    );
  if (inventory.dependencies.length > 0)
    out.push(
      "",
      "## AI dependencies",
      "",
      ...table(
        ["Package", "Declared", "Installed", "Manifest", "Recognizer"],
        inventory.dependencies.map((entry) => [
          `\`${entry.name}\``,
          entry.declared,
          entry.installed_version ?? "not installed",
          `\`${entry.manifest}\``,
          entry.category === "unsupported_ai_sdk" ? "none" : "yes",
        ]),
      ),
    );
  if (inventory.environment_variables.length > 0)
    out.push(
      "",
      "## Environment variables read where AI SDKs are used",
      "",
      "Names only; values are never read.",
      "",
      ...table(
        ["Name", "Files"],
        inventory.environment_variables.map((entry) => [
          `\`${entry.name}\``,
          entry.files.map((file) => `\`${file}\``).join(", "),
        ]),
      ),
    );
  out.push("", "## Uncertainty", "");
  if (uncertainty.locations.length === 0)
    out.push("Nothing uncertain about AI calls, endpoints, models or SDKs.");
  else
    out.push(
      ...table(
        ["Reason", "Locations"],
        uncertainty.by_reason.map((entry) => [
          `\`${entry.reason}\``,
          String(entry.count),
        ]),
      ),
      "",
      "<details><summary>Each location</summary>",
      "",
      ...uncertainty.locations.map(
        (entry) =>
          `- \`${entry.path}:${entry.line}\` ${entry.reason}${entry.detail.length === 0 ? "" : ` (${entry.detail.join("; ")})`}`,
      ),
      "",
      "</details>",
    );
  out.push(
    "",
    `Scan: ${inventory.completeness.status}; limits ${inventory.limits}; analysis errors ${inventory.analysis_errors}.`,
    "",
    `_${inventory.statement}_`,
  );
  return lines(out);
}

export async function inventoryCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    { all: { type: "boolean" }, markdown: { type: "boolean" } },
    INVENTORY_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${INVENTORY_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 1)
    throw new UsageError("give at most one PATH", INVENTORY_USAGE);
  if (flag(parsed, "json") && flag(parsed, "markdown"))
    throw new UsageError(
      "--json and --markdown cannot be combined",
      INVENTORY_USAGE,
    );
  const label = parsed.positionals[0] ?? ".";
  const path = resolve(context.io.cwd, label);
  const isDirectory = await stat(path).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
  if (!isDirectory)
    throw new StoreError(`${label} is not a directory; nothing was scanned`);
  const physical = await realpath(path);
  const isJson = flag(parsed, "json");
  const showProgress = !isJson && Boolean(process.stderr?.isTTY);
  const { inventory } = inventoryScan({
    repositoryPath: physical,
    deniedDirectories: [join(physical, ".anvilmark")],
    onProgress: showProgress
      ? (message) => context.io.stderr(`${message}\n`)
      : undefined,
  });
  if (isJson) writeJson(context.io, inventory);
  else if (flag(parsed, "markdown"))
    context.io.stdout(renderInventoryMarkdown(inventory, label));
  else
    context.io.stdout(
      renderInventoryText(inventory, label, flag(parsed, "all")),
    );
  return EXIT.ok;
}
