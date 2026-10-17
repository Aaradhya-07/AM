import { stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import { pathsFor, StoreError } from "../store.js";
import type { CommandContext } from "./common.js";
import { UsageError, flag, parse, stringOption } from "./common.js";
import {
  connectCodexProject,
  currentProjectServerEntry,
} from "./codex-connect.js";
import { inventoryCommand } from "./inventory.js";
import { initCommand, statusCommand } from "./project.js";

export const START_USAGE = `Usage:
  anvilmark start [PATH] [--idea "TEXT"] [--name NAME] [--id ID] [--connect-codex]
  anvilmark start --project-dir DIR [--idea "TEXT"] [--name NAME] [--id ID] [--connect-codex]

Start in an existing TypeScript/JavaScript repository. First show a read-only,
source-linked AI inventory. If no ANVILMARK project exists, record only the
application description you provide and a reference to this repository.
In a terminal, you can enter the description when asked. Without a terminal
or --idea, plain start only shows the inventory and writes nothing.

From a subdirectory, the command finds the Git repository root (or an existing
project inside it). Without Git, it uses the nearest package.json directory.
Rerunning in an initialized repository shows the current project status.
No account, GitHub grant, model key, or network connection is required.
--connect-codex adds this repository's MCP server to .codex/config.toml.
It can connect before a project draft exists so the agent can propose one.
Codex must trust the project and reload its configuration to use the server.
The agent can propose cited drafts; Codex prompts before writing tools run.
The inventory is an observation, not an approved decision or compliance result.`;

async function connectCodex(
  context: CommandContext,
  root: string,
): Promise<void> {
  const serverEntry = await currentProjectServerEntry();
  const result = await connectCodexProject(root, serverEntry);
  context.io.stdout(
    result === "created"
      ? "\nConnected Codex in .codex/config.toml. Trust this project and restart Codex to load the server. Draft-writing tools require approval.\n"
      : "\nCodex connection is already current in .codex/config.toml.\n",
  );
}

async function isGitRoot(path: string): Promise<boolean> {
  const marker = await stat(join(path, ".git")).catch(() => null);
  if (marker === null) return false;
  if (marker.isFile()) return true; // Git worktree pointer.
  if (!marker.isDirectory()) return false;
  return stat(join(path, ".git", "HEAD")).then(
    (entry) => entry.isFile(),
    () => false,
  );
}

async function defaultStartRoot(cwd: string): Promise<string> {
  let current = resolve(cwd);
  let nearestProject: string | null = null;
  let nearestPackage: string | null = null;
  while (true) {
    if (
      await stat(pathsFor(current).projectFile).then(
        () => true,
        () => false,
      )
    )
      nearestProject ??= current;
    if (
      nearestPackage === null &&
      (await stat(join(current, "package.json")).then(
        (entry) => entry.isFile(),
        () => false,
      ))
    )
      nearestPackage = current;
    if (await isGitRoot(current)) return nearestProject ?? current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (nearestPackage === null) return resolve(cwd);
  if (nearestProject !== null) {
    const insidePackage = relative(nearestPackage, nearestProject);
    if (
      insidePackage === "" ||
      (insidePackage !== ".." &&
        !insidePackage.startsWith(`..${sep}`) &&
        !isAbsolute(insidePackage))
    )
      return nearestProject;
  }
  return nearestPackage;
}

export async function startCommand(context: CommandContext): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      idea: { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      "connect-codex": { type: "boolean" },
    },
    START_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${START_USAGE}\n`);
    return EXIT.ok;
  }
  if (flag(parsed, "json"))
    throw new UsageError(
      "--json is not supported by start; use inventory --json and status --json",
      START_USAGE,
    );
  if (parsed.positionals.length > 1)
    throw new UsageError("give at most one repository PATH", START_USAGE);
  if (parsed.positionals.length > 0 && stringOption(parsed, "project-dir"))
    throw new UsageError(
      "use either PATH or --project-dir, not both",
      START_USAGE,
    );

  const explicit = parsed.positionals[0] ?? stringOption(parsed, "project-dir");
  const label = explicit ?? ".";
  const root =
    explicit === undefined
      ? await defaultStartRoot(context.io.cwd)
      : resolve(context.io.cwd, explicit);
  const directory = await stat(root).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
  if (!directory)
    throw new StoreError(
      `${label} is not a directory; nothing was scanned or created`,
    );

  const paths = pathsFor(root);
  const exists = await stat(paths.projectFile).then(
    (entry) => entry.isFile(),
    () => false,
  );
  if (
    exists &&
    ["idea", "name", "id"].some((key) => parsed.values[key] !== undefined)
  )
    throw new UsageError(
      "this repository already has an ANVILMARK project; edit it with the project commands",
      START_USAGE,
    );

  const inventoryCode = await inventoryCommand({
    ...context,
    args: [root],
  });
  if (inventoryCode !== EXIT.ok) return inventoryCode;

  if (exists) {
    context.io.stdout("\nExisting ANVILMARK project:\n");
    const statusCode = await statusCommand({
      ...context,
      args: ["--project-dir", root],
    });
    if (statusCode === EXIT.ok && flag(parsed, "connect-codex"))
      await connectCodex(context, root);
    return statusCode;
  }

  const idea = stringOption(parsed, "idea");
  if (idea === undefined && !context.io.interactive) {
    context.io.stdout("\nNo project was created.\n");
    if (flag(parsed, "connect-codex")) await connectCodex(context, root);
    else
      context.io.stdout(
        'To record your application description, run anvilmark start --idea "What this app does".\n',
      );
    return EXIT.ok;
  }

  context.io.stdout("\nCreate a local draft from your description:\n");
  const initArgs = ["--project-dir", root, "--repo", "."];
  for (const key of ["idea", "name", "id"] as const) {
    const value = stringOption(parsed, key);
    if (value !== undefined) initArgs.push(`--${key}`, value);
  }
  const initCode = await initCommand({ ...context, args: initArgs });
  if (initCode === EXIT.ok && flag(parsed, "connect-codex"))
    await connectCodex(context, root);
  return initCode;
}
