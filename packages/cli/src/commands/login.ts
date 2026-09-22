import { mkdir, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { lines } from "../render.js";
import { findProjectRoot } from "../store.js";
import type { CommandContext, OptionSpec } from "./common.js";
import { UsageError, flag, parse, stringOption } from "./common.js";

export const CREDENTIALS_FORMAT = "anvilmark-credentials/0.1";
export const DEFAULT_ENDPOINT = "https://anvilmark.vercel.app";

export interface StoredCredentials {
  readonly format: string;
  readonly endpoint: string;
  readonly token: string;
  readonly logged_in_at: string;
}

export function credentialsPath(
  env: Readonly<Record<string, string | undefined>>,
  homedir: string,
): string {
  const explicit = env.ANVILMARK_CONFIG_HOME;
  if (explicit !== undefined && explicit !== "") {
    return join(resolve(explicit), "credentials.json");
  }
  const xdg = env.XDG_CONFIG_HOME;
  const base =
    xdg !== undefined && xdg !== "" && isAbsolute(xdg)
      ? xdg
      : join(homedir, ".config");
  return join(base, "anvilmark", "credentials.json");
}

async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path
      ? path
      : join(await canonical(parent), relative(parent, path));
  }
}

async function isInside(child: string, parent: string): Promise<boolean> {
  const rel = relative(await canonical(parent), await canonical(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function loadCredentials(
  env: Readonly<Record<string, string | undefined>>,
  homedir: string,
  projectRoot: string | null,
): Promise<StoredCredentials | null> {
  const path = credentialsPath(env, homedir);
  if (projectRoot !== null && (await isInside(path, projectRoot))) {
    return null;
  }
  try {
    const text = await readFile(path, "utf8");
    const doc = JSON.parse(text);
    if (
      doc &&
      typeof doc === "object" &&
      doc.format === CREDENTIALS_FORMAT &&
      typeof doc.token === "string" &&
      typeof doc.endpoint === "string"
    ) {
      return doc as StoredCredentials;
    }
  } catch {
    return null;
  }
  return null;
}

export const LOGIN_USAGE = `Usage:
  anvilmark login --token TOKEN [--endpoint URL]
  anvilmark login --logout
  anvilmark login --whoami

Authenticates the local machine with the ANVILMARK Cloud Console:
  --token TOKEN   platform sync token generated in your dashboard
  --endpoint URL  web console endpoint (default: ${DEFAULT_ENDPOINT})
  --logout        remove local credentials
  --whoami        display current authenticated status

Stored outside project in ~/.config/anvilmark/credentials.json. Never stored inside repositories.`;

const LOGIN_OPTIONS: OptionSpec = {
  token: { type: "string" },
  endpoint: { type: "string" },
  logout: { type: "boolean" },
  whoami: { type: "boolean" },
};

export async function loginCommand(
  ctx: CommandContext,
  sub?: string,
): Promise<ExitCode> {
  const parsed = parse(ctx.args, LOGIN_OPTIONS, LOGIN_USAGE);
  if (flag(parsed, "help") || sub === "help") {
    ctx.io.stdout(`${LOGIN_USAGE}\n`);
    return EXIT.ok;
  }

  const root = await findProjectRoot(ctx.io.cwd);
  const path = credentialsPath(ctx.io.env, ctx.io.homedir);

  if (root !== null && (await isInside(path, root))) {
    ctx.io.stderr(
      `error: credentials path ${path} is inside the project; credentials must live outside repositories.\n`,
    );
    return EXIT.failed;
  }

  const isLogout = flag(parsed, "logout") || sub === "logout";
  const isWhoami = flag(parsed, "whoami") || sub === "whoami";

  if (isLogout) {
    try {
      await rm(path, { force: true });
      ctx.io.stdout(
        lines("Logged out from ANVILMARK console.", `Removed ${path}`),
      );
      return EXIT.ok;
    } catch (err) {
      ctx.io.stderr(`Failed to remove credentials: ${String(err)}\n`);
      return EXIT.failed;
    }
  }

  if (isWhoami) {
    const creds = await loadCredentials(ctx.io.env, ctx.io.homedir, root);
    if (!creds) {
      ctx.io.stdout(
        "Not logged in to ANVILMARK console.\nRun: anvilmark login --token <TOKEN>\n",
      );
      return EXIT.ok;
    }
    const masked =
      creds.token.length > 8
        ? `${creds.token.slice(0, 6)}...${creds.token.slice(-4)}`
        : "******";
    ctx.io.stdout(
      lines(
        "ANVILMARK Authentication Status:",
        `  Endpoint:     ${creds.endpoint}`,
        `  Token:        ${masked}`,
        `  Logged in:    ${creds.logged_in_at}`,
        `  File:         ${path}`,
      ),
    );
    return EXIT.ok;
  }

  let token = stringOption(parsed, "token") || ctx.io.env.ANVILMARK_API_TOKEN;
  if (!token && parsed.positionals.length > 0) {
    token = parsed.positionals[0];
  }

  if (!token || token.trim() === "") {
    throw new UsageError("missing --token argument", LOGIN_USAGE);
  }

  const rawEndpoint =
    stringOption(parsed, "endpoint") ||
    ctx.io.env.ANVILMARK_API_URL ||
    DEFAULT_ENDPOINT;
  const endpoint = rawEndpoint.replace(/\/+$/, "");

  const creds: StoredCredentials = {
    format: CREDENTIALS_FORMAT,
    endpoint,
    token: token.trim(),
    logged_in_at: ctx.io.clock(),
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(creds, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });

  const masked =
    token.length > 8 ? `${token.slice(0, 6)}...${token.slice(-4)}` : "******";

  ctx.io.stdout(
    lines(
      "✔ Logged in to ANVILMARK console",
      `  Endpoint:     ${endpoint}`,
      `  Token:        ${masked}`,
      `  Credentials:  ${path}`,
      "",
      "Next steps:",
      "  Run: anvilmark check            (evaluate local boundaries)",
      "  Run: anvilmark push             (transmit telemetry to console)",
    ),
  );

  return EXIT.ok;
}
