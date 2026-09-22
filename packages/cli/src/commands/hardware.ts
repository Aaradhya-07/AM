import {
  hardwareActionCommand,
  HARDWARE_ACTION_USAGE,
} from "./hardware-actions.js";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { sanitizeErrorMessage } from "@anvilmark/adapters";
import {
  CATALOG_VERSION,
  MAX_ARTIFACT_BYTES,
  SIZING_FORMAT,
  SizingInputSchema,
  createPlanningInput,
  createSizingArtifact,
  listModelProfiles,
  verifySizingArtifact,
} from "@anvilmark/hardware-sizing";
import type { SizingArtifact } from "@anvilmark/hardware-sizing";
import { EXIT } from "../io.js";
import type { ExitCode } from "../io.js";
import {
  HARDWARE_USAGE as ADD_USAGE,
  hardwareCommand as addHardwareCommand,
} from "./edit.js";
import type { CommandContext } from "./common.js";
import {
  Cancelled,
  UsageError,
  flag,
  parse,
  requiredOption,
  stringOption,
} from "./common.js";

export const HARDWARE_USAGE = `${ADD_USAGE}

Read-only sizing (no project required):
  anvilmark hardware catalog [--json]
  anvilmark hardware example [--model PUBLISHER/MODEL] [--json]
  anvilmark hardware estimate --file SCENARIO_OR_ARTIFACT.json [--json]

example prints a planning input as JSON; choose allocation and overhead assumptions.
estimate recomputes inputs locally; --json returns a portable sizing artifact.
${HARDWARE_ACTION_USAGE}`;

export const hashText = (text: string): string =>
  `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

export async function readBoundedJson(
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted)
    throw new Cancelled("Hardware sizing was cancelled; nothing was written.");
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES)
      throw new UsageError(
        "Sizing input must be a regular JSON file no larger than 1 MiB.",
        HARDWARE_USAGE,
      );
    const bytes = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
    let used = 0;
    while (used < bytes.length) {
      if (signal.aborted)
        throw new Cancelled(
          "Hardware sizing was cancelled; nothing was written.",
        );
      const { bytesRead } = await file.read(
        bytes,
        used,
        bytes.length - used,
        used,
      );
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used > MAX_ARTIFACT_BYTES)
      throw new UsageError(
        "Sizing input exceeded 1 MiB while reading.",
        HARDWARE_USAGE,
      );
    try {
      return JSON.parse(bytes.subarray(0, used).toString("utf8"));
    } catch {
      throw new UsageError("Sizing input is not valid JSON.", HARDWARE_USAGE);
    }
  } finally {
    await file.close();
  }
}

function bytesText(value: number | null): string {
  return value === null
    ? "unknown"
    : `${(value / 2 ** 30).toFixed(2)} GiB (${value} bytes)`;
}

function render(artifact: SizingArtifact): string {
  const result = artifact.result;
  const memory = result.memory;
  return [
    `Hardware sizing: ${result.model_profile?.label ?? artifact.input.model.id}`,
    `Planning estimate: ${result.status}; ${memory.assessment}`,
    `Weights: ${bytesText(memory.weights_bytes)}`,
    `KV cache: ${bytesText(memory.kv_cache_bytes)}`,
    `Runtime overhead: ${bytesText(memory.runtime_overhead_bytes)}`,
    `Allocator allowance: ${bytesText(memory.allocator_allowance_bytes)}`,
    `Known lower bound: ${bytesText(memory.known_lower_bound_bytes)}`,
    `Estimated total: ${bytesText(memory.required_bytes)}`,
    `Selected usable budget: ${bytesText(memory.usable_budget_bytes)}`,
    `Estimated headroom: ${bytesText(memory.headroom_bytes)}`,
    "Runtime compatibility: unknown. Contract evidence: unattached.",
    `Performance: ${result.performance.status}. ${result.performance.reason}`,
    ...result.issues.map((issue) => `Gap [${issue.code}]: ${issue.message}`),
    ...result.assumptions.map((assumption) => `Assumption: ${assumption}`),
    `Input digest: ${artifact.input_digest}`,
    "Use --json to export this planning artifact. No project state was changed.",
    "",
  ].join("\n");
}

export async function hardwareCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  if (sub === "add") return addHardwareCommand(context, sub);
  let json = context.args.includes("--json");
  try {
    if (sub && ["probe", "discover", "recommend", "apply"].includes(sub))
      return await hardwareActionCommand(context, sub);
    const parsed = parse(
      context.args,
      { file: { type: "string" }, model: { type: "string" } },
      HARDWARE_USAGE,
    );
    json = flag(parsed, "json");
    if (flag(parsed, "help") || sub === undefined) {
      context.io.stdout(`${HARDWARE_USAGE}\n`);
      return sub === undefined && !flag(parsed, "help") ? EXIT.usage : EXIT.ok;
    }
    if (parsed.positionals.length > 0)
      throw new UsageError("Unexpected positional arguments.", HARDWARE_USAGE);
    if (context.io.signal.aborted)
      throw new Cancelled(
        "Hardware sizing was cancelled; nothing was written.",
      );
    if (sub !== "catalog" && sub !== "example" && sub !== "estimate")
      throw new UsageError(
        `Unsupported hardware subcommand: ${sub}.`,
        HARDWARE_USAGE,
      );
    if (
      (sub !== "estimate" && stringOption(parsed, "file") !== undefined) ||
      (sub !== "example" && stringOption(parsed, "model") !== undefined)
    )
      throw new UsageError(
        "This option does not apply to the selected sizing subcommand.",
        HARDWARE_USAGE,
      );
    if (sub === "catalog") {
      const models = listModelProfiles();
      context.io.stdout(
        json
          ? `${JSON.stringify({ catalog_version: CATALOG_VERSION, models }, null, 2)}\n`
          : `${models.map((model) => `${model.id}\n  ${model.revision}; ${model.parameter_count} total parameters; ${model.max_context_tokens} token profile`).join("\n")}\n`,
      );
      return EXIT.ok;
    }
    if (sub === "example") {
      const modelId = stringOption(parsed, "model");
      if (
        modelId !== undefined &&
        !listModelProfiles().some((model) => model.id === modelId)
      )
        throw new UsageError(
          "Unknown model id; use hardware catalog to list supported models.",
          HARDWARE_USAGE,
        );
      context.io.stdout(
        `${JSON.stringify(createPlanningInput(modelId), null, 2)}\n`,
      );
      return EXIT.ok;
    }
    const path = resolve(
      context.io.cwd,
      requiredOption(parsed, "file", HARDWARE_USAGE),
    );
    const raw = await readBoundedJson(path, context.io.signal);
    let input: unknown = raw;
    if (typeof raw === "object" && raw !== null && "format" in raw) {
      if (raw.format !== SIZING_FORMAT)
        throw new UsageError(
          "Unsupported sizing artifact format.",
          HARDWARE_USAGE,
        );
      const checked = await verifySizingArtifact(raw, hashText);
      if (!checked.ok)
        throw new UsageError(
          `Sizing artifact failed verification: ${checked.issues.join("; ")}`,
          HARDWARE_USAGE,
        );
      input = checked.artifact.input;
    }
    const parsedInput = SizingInputSchema.safeParse(input);
    if (!parsedInput.success)
      throw new UsageError(
        `Invalid sizing input: ${parsedInput.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
        HARDWARE_USAGE,
      );
    const artifact = await createSizingArtifact(parsedInput.data, {
      evaluatedAt: context.io.clock(),
      hashText,
    });
    if (context.io.signal.aborted)
      throw new Cancelled(
        "Hardware sizing was cancelled; nothing was written.",
      );
    context.io.stdout(
      json ? `${JSON.stringify(artifact, null, 2)}\n` : render(artifact),
    );
    return EXIT.ok;
  } catch (error) {
    const code =
      error instanceof Cancelled
        ? EXIT.cancelled
        : error instanceof UsageError
          ? EXIT.usage
          : EXIT.failed;
    const message = sanitizeErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    if (json)
      context.io.stdout(
        `${JSON.stringify({ format: "anvilmark-hardware-sizing-error/1", error: { code, message } })}\n`,
      );
    context.io.stderr(`${message}\n`);
    return code;
  }
}
