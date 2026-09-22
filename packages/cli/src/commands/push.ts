import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines } from "../render.js";
import * as conformance from "../conformance.js";
import { StoreError, findProjectRoot, loadProject } from "../store.js";
import type { CommandContext, OptionSpec } from "./common.js";
import { confirm, flag, parse, stringOption, writeJson } from "./common.js";
import { DEFAULT_ENDPOINT, loadCredentials } from "./login.js";

export const PUSH_USAGE = `Usage:
  anvilmark push [--project-dir DIR] [--endpoint URL] [--token TOKEN] [--yes] [--dry-run] [--json]

Transmits local contract verification hashes and conformance telemetry
to the ANVILMARK Cloud Console:
  --project-dir DIR  project directory (default: current directory or nearest ancestor)
  --endpoint URL     web console endpoint (default: authenticated or ${DEFAULT_ENDPOINT})
  --token TOKEN      explicit authentication token (default: saved login or ANVILMARK_API_TOKEN)
  -y, --yes          skip interactive confirmation prompt
  --dry-run          print the payload and destination URL without sending
  --json             output raw server response as JSON

Source code is never uploaded. Only cryptographic hashes, rule counts, and verdicts are transmitted.`;

const PUSH_OPTIONS: OptionSpec = {
  endpoint: { type: "string" },
  token: { type: "string" },
  yes: { type: "boolean", short: "y" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
};

function gitRevParse(repository: string): string | null {
  try {
    const result = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Constrain telemetry details to policy:
 * - May contain only letters, digits, spaces and the characters . , : ; / % ( ) - _
 * - Must be <= 500 chars
 * - Must NOT contain a path separator followed by a filename extension (e.g. "src/app.ts"),
 *   a backslash, or a newline.
 */
export function isValidTelemetryDetails(details: unknown): boolean {
  if (typeof details !== "string") {
    return false;
  }
  if (details.length > 500) {
    return false;
  }
  if (
    details.includes("\\") ||
    details.includes("\n") ||
    details.includes("\r")
  ) {
    return false;
  }
  if (!/^[a-zA-Z0-9 .,:;/%()_-]*$/.test(details)) {
    return false;
  }
  if (/[/\\][a-zA-Z0-9_.-]*\.[a-zA-Z0-9]+/.test(details)) {
    return false;
  }
  return true;
}

export const validateTelemetryDetails = isValidTelemetryDetails;

export async function pushCommand(ctx: CommandContext): Promise<ExitCode> {
  const parsed = parse(ctx.args, PUSH_OPTIONS, PUSH_USAGE);
  if (flag(parsed, "help")) {
    ctx.io.stdout(`${PUSH_USAGE}\n`);
    return EXIT.ok;
  }

  const explicitDir = stringOption(parsed, "project-dir");
  const root = explicitDir
    ? resolve(ctx.io.cwd, explicitDir)
    : await findProjectRoot(ctx.io.cwd);

  if (root === null) {
    throw new StoreError(
      `no ANVILMARK project found in ${ctx.io.cwd} or any parent directory; run "anvilmark init" first`,
    );
  }

  const loaded = await loadProject(root);
  const contract = loaded.contract;

  // Resolve credentials & endpoint - require authenticated credentials
  const creds = await loadCredentials(ctx.io.env, ctx.io.homedir, root);
  const token =
    stringOption(parsed, "token") ||
    ctx.io.env.ANVILMARK_API_TOKEN ||
    creds?.token;

  if (!token) {
    throw new StoreError(
      "Not logged in to ANVILMARK console. Run 'anvilmark login --token <TOKEN>' first, or pass --token.",
    );
  }

  const rawEndpoint =
    stringOption(parsed, "endpoint") ||
    ctx.io.env.ANVILMARK_API_URL ||
    creds?.endpoint ||
    DEFAULT_ENDPOINT;
  const endpoint = rawEndpoint.replace(/\/+$/, "");

  // Resolve commit sha
  const commitSha = gitRevParse(root) || "0000000000000000";

  // Check stored conformance report
  const stored = await conformance.readStoredConformance(root);
  let status: "pass" | "fail" | "warn" = "warn";
  let details = `Synchronized contract schema ${contract.schema_version} (${contract.decisions.length} decisions, ${contract.constraints.length} constraints)`;

  if (stored.status === "valid") {
    status = stored.report.summary.compliant ? "pass" : "fail";
    details = `${stored.report.summary.pass}/${stored.report.summary.total} rules verified compliant. Conformance hash: ${stored.report.conformance_hash.slice(0, 12)}`;
  }

  if (!isValidTelemetryDetails(details)) {
    throw new StoreError(
      `telemetry details violates policy: "${details}" may contain only letters, digits, spaces and . , : ; / % ( ) - _, must be <= 500 characters, and cannot contain a path separator followed by a filename extension, a backslash, or a newline; nothing was sent.`,
    );
  }

  const payload = {
    projectId: contract.project.id,
    commitSha: commitSha.slice(0, 7),
    agentTrigger: "Local CLI (anvilmark push)",
    status,
    details,
  };

  const asJson = flag(parsed, "json");
  const dryRun = flag(parsed, "dry-run");

  if (dryRun) {
    if (asJson) {
      writeJson(ctx.io, {
        dryRun: true,
        destination: `${endpoint}/api/runs`,
        payload,
      });
    } else {
      ctx.io.stdout(
        lines(
          `Dry run: push to ${endpoint}/api/runs`,
          `Destination: ${endpoint}/api/runs`,
          "Exact payload:",
          JSON.stringify(payload, null, 2),
        ),
      );
    }
    return EXIT.ok;
  }

  // Outbound policy consent and preview check
  const showPreview =
    contract.remote_intelligence_policy.show_payload_before_remote_send ?? true;

  if (showPreview && !asJson) {
    ctx.io.stdout(
      lines(
        "Outbound Conformance Telemetry Preview:",
        `  Destination: ${endpoint}/api/runs`,
        `  Project ID:  ${payload.projectId}`,
        `  Commit SHA:  ${payload.commitSha}`,
        `  Trigger:     ${payload.agentTrigger}`,
        `  Status:      ${payload.status.toUpperCase()}`,
        `  Details:     ${payload.details}`,
        "",
        "No source code or repository contents are included in this payload.",
      ) + "\n\n",
    );
  }

  const skipConfirm = flag(parsed, "yes");
  if (!skipConfirm) {
    if (!ctx.io.interactive) {
      throw new StoreError(
        "push to remote console requires interactive confirmation or the --yes flag; nothing was sent.",
      );
    }
    const proceed = await confirm(
      ctx.io,
      `Transmit this conformance record to ${endpoint}?`,
    );
    if (!proceed) {
      ctx.io.stdout("Push cancelled. Nothing was transmitted.\n");
      return EXIT.ok;
    }
  }

  try {
    const res = await fetch(`${endpoint}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await res.json().catch(() => null);

    if (!res.ok) {
      const errMsg =
        responseBody?.error || `HTTP ${res.status}: ${res.statusText}`;
      if (asJson) {
        writeJson(ctx.io, { error: errMsg, payload });
      } else {
        ctx.io.stderr(
          `error: Failed to transmit telemetry to ${endpoint}: ${errMsg}\n`,
        );
      }
      return EXIT.failed;
    }

    if (asJson) {
      writeJson(ctx.io, {
        ok: true,
        result: responseBody,
        transmitted: payload,
      });
      return EXIT.ok;
    }

    ctx.io.stdout(
      lines(
        "✔ Conformance telemetry transmitted to ANVILMARK console",
        `  Project:    ${contract.project.name} (${contract.project.id})`,
        `  Commit:     ${commitSha.slice(0, 7)}`,
        `  Status:     ${status.toUpperCase()}`,
        `  Details:    ${details}`,
        `  Endpoint:   ${endpoint}`,
        `  Dashboard:  ${endpoint}/dashboard`,
      ),
    );

    return EXIT.ok;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (asJson) {
      writeJson(ctx.io, { error: message, payload });
    } else {
      ctx.io.stderr(
        lines(
          `error: Connection failed to ${endpoint}`,
          `  ${message}`,
          "Telemetry could not be transmitted to the cloud console.",
        ),
      );
    }
    return EXIT.failed;
  }
}
