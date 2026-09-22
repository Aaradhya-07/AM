import { readFile, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";

import type { ProjectContract } from "@anvilmark/project-contract";
import {
  approvalState,
  parseProjectContract,
} from "@anvilmark/project-contract";

import { loadHostConfig } from "../host.js";
import type { ExitCode } from "../io.js";
import { EXIT } from "../io.js";
import {
  lines,
  notYetProvided,
  renderIssues,
  renderStatus,
} from "../render.js";
import {
  StoreError,
  commitRevision,
  pathsFor,
  ambiguityGuidance,
  resolveAmbiguousRevision,
} from "../store.js";
import type { RemoteIntelligencePosture } from "../workflow/edit.js";
import {
  WorkflowError,
  newProjectContract,
  selectIntelligence,
  slugId,
} from "../workflow/edit.js";
import type { CommandContext } from "./common.js";
import {
  UsageError,
  flag,
  listOption,
  openProject,
  parse,
  projectDirectory,
  stringOption,
  writeJson,
} from "./common.js";

export const INIT_USAGE = `Usage:
  anvilmark init --idea "TEXT" [--name NAME] [--id ID] [--repo PATH]...
                 [--intelligence none|handoff|PROVIDER_ID]
                 [--remote-intelligence public-projection|nothing]
  anvilmark init --from-contract FILE [--intelligence ...]
  anvilmark init                      (asks for the idea when run in a terminal)

Creates .anvilmark/ in the project directory (--project-dir, default: current).
  --idea                 the application idea in your own words (intent.summary)
  --name, --id           project name (default: directory name) and id (default: from name)
  --repo PATH            reference an existing repository; repeatable. Its path is
                         recorded; its contents are not read or sent anywhere
  --intelligence         none (default), handoff, or a provider registered in host configuration
  --remote-intelligence  public-projection (default): remote intelligence may receive the
                         ratified public decision-layer projection, after consent;
                         nothing: remote intelligence may receive nothing
  --from-contract FILE   import an existing contract you have reviewed; it must validate
No credential is ever stored in the project.`;

async function mechanismProblem(
  context: CommandContext,
  mechanism: string,
  root: string,
): Promise<string | null> {
  if (mechanism === "none" || mechanism === "handoff") {
    return null;
  }
  const host = await loadHostConfig({
    env: context.io.env,
    homedir: context.io.homedir,
    projectRoot: root,
  });
  if (host.providers.has(mechanism)) {
    return null;
  }
  const known = [...host.providers.keys()];
  return `"${mechanism}" is not registered in host configuration ${host.path}${known.length === 0 ? " (no providers are registered)" : `; registered: ${known.join(", ")}`}. Use none, handoff, or register the provider first (see "anvilmark help intelligence")`;
}

async function repositoryReference(
  root: string,
  path: string,
): Promise<string> {
  const absolute = resolve(root, path);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw new WorkflowError(`repository path "${path}" does not exist`);
  }
  if (!info.isDirectory()) {
    throw new WorkflowError(`repository path "${path}" is not a directory`);
  }
  const rel = relative(root, absolute).split(sep).join("/");
  return rel === "" ? "." : rel;
}

export async function initCommand(context: CommandContext): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    {
      idea: { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      repo: { type: "string", multiple: true },
      intelligence: { type: "string" },
      "remote-intelligence": { type: "string" },
      "from-contract": { type: "string" },
    },
    INIT_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${INIT_USAGE}\n`);
    return EXIT.ok;
  }
  if (parsed.positionals.length > 0) {
    throw new UsageError(
      `unexpected argument "${parsed.positionals[0]}"; quote the idea and pass it with --idea`,
      INIT_USAGE,
    );
  }
  const io = context.io;
  const root = projectDirectory(io, parsed);
  const paths = pathsFor(root);
  try {
    await stat(paths.projectFile);
    throw new WorkflowError(
      `${paths.projectFile} already exists; this directory is already an ANVILMARK project`,
    );
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
  }

  const now = io.clock();
  const mechanism = stringOption(parsed, "intelligence") ?? "none";
  const problem = await mechanismProblem(context, mechanism, root);
  if (problem !== null) {
    throw new WorkflowError(problem);
  }

  const fromContract = stringOption(parsed, "from-contract");
  let contract: ProjectContract;
  let summary: string;

  if (fromContract !== undefined) {
    for (const conflicting of [
      "idea",
      "name",
      "id",
      "repo",
      "remote-intelligence",
    ]) {
      if (parsed.values[conflicting] !== undefined) {
        throw new UsageError(
          `--${conflicting} cannot be combined with --from-contract; the imported contract is used as written`,
          INIT_USAGE,
        );
      }
    }
    let text: string;
    try {
      text = await readFile(resolve(io.cwd, fromContract), "utf8");
    } catch {
      throw new WorkflowError(`cannot read contract file "${fromContract}"`);
    }
    const imported = parseProjectContract(text);
    if (!imported.ok) {
      throw new StoreError(
        `"${fromContract}" is not a valid project contract; nothing was created`,
        imported.issues,
      );
    }
    contract =
      stringOption(parsed, "intelligence") === undefined
        ? imported.value
        : selectIntelligence(imported.value, mechanism, now);
    summary = `imported contract from ${basename(fromContract)}`;
  } else {
    let idea = stringOption(parsed, "idea");
    if (idea === undefined) {
      if (!io.interactive) {
        throw new UsageError(
          "--idea is required when not running in a terminal; ANVILMARK does not infer intent from a repository",
          INIT_USAGE,
        );
      }
      const answer = await io.prompt(
        "Describe the application idea in a sentence or two: ",
      );
      if (answer === null) {
        io.stderr("Cancelled; nothing was created.\n");
        return EXIT.cancelled;
      }
      idea = answer;
    }
    if (idea.trim() === "") {
      throw new UsageError("the idea must not be empty", INIT_USAGE);
    }
    const name = stringOption(parsed, "name") ?? basename(root);
    const id = stringOption(parsed, "id") ?? slugId(name);
    if (id === null) {
      throw new UsageError(
        `cannot derive a project id from "${name}"; pass --id`,
        INIT_USAGE,
      );
    }
    const posture =
      stringOption(parsed, "remote-intelligence") ?? "public-projection";
    if (posture !== "public-projection" && posture !== "nothing") {
      throw new UsageError(
        `--remote-intelligence must be public-projection or nothing, got "${posture}"`,
        INIT_USAGE,
      );
    }
    const repositories: string[] = [];
    for (const repo of listOption(parsed, "repo")) {
      repositories.push(await repositoryReference(root, repo));
    }
    contract = newProjectContract({
      id,
      name,
      idea: idea.trim(),
      repositoryRoots: repositories,
      intelligence: mechanism,
      remoteIntelligence: (posture === "nothing"
        ? "nothing"
        : "public_projection") as RemoteIntelligencePosture,
      now,
    });
    summary =
      repositories.length === 0
        ? "initialized from an idea"
        : `initialized from an idea with repository reference(s) ${repositories.join(", ")}`;
  }

  const result = await commitRevision({
    paths,
    expectedDigest: null,
    contract,
    command: "init",
    summary,
    clock: io.clock,
    ...(context.storeFs === undefined ? {} : { fs: context.storeFs }),
  });
  const missing = notYetProvided(result.contract);
  io.stdout(
    lines(
      `Initialized ANVILMARK project "${result.contract.project.name}" (${result.contract.project.id}) in ${paths.directory}`,
      `Saved state revision r${result.entry.revision}: ${summary}`,
      `Intelligence: ${mechanism}. No credential is stored in the project.`,
      missing.length === 0 ? [] : `Not yet provided: ${missing.join(", ")}`,
      "Next: anvilmark status, then anvilmark elicit (or the add commands in anvilmark help)",
    ),
  );
  return EXIT.ok;
}

export const STATUS_USAGE = `Usage: anvilmark status [--json] [--project-dir DIR]`;

export async function statusCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const parsed = parse(context.args, {}, STATUS_USAGE);
  if (flag(parsed, "help")) {
    context.io.stdout(`${STATUS_USAGE}\n`);
    return EXIT.ok;
  }
  const loaded = await openProject(context.io, parsed);
  if (flag(parsed, "json")) {
    writeJson(context.io, {
      root: loaded.paths.root,
      state_revision: loaded.head?.revision ?? null,
      edited_outside_cli: loaded.editedOutsideCli,
      not_yet_provided: notYetProvided(loaded.contract),
      decisions: loaded.contract.decisions.map((decision) => ({
        id: decision.id,
        revision: decision.revision,
        status: decision.status,
        approval: approvalState(loaded.contract, decision.id).state,
      })),
      contract: loaded.contract,
    });
    return EXIT.ok;
  }
  context.io.stdout(
    renderStatus({
      contract: loaded.contract,
      root: loaded.paths.root,
      stateRevision: loaded.head?.revision ?? null,
      editedOutsideCli: loaded.editedOutsideCli,
    }),
  );
  return EXIT.ok;
}

export const VALIDATE_USAGE = `Usage:
  anvilmark validate [--project-dir DIR]     validate the project's contract
  anvilmark validate --file FILE              validate any contract file, without a project`;

export async function validateCommand(
  context: CommandContext,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    { file: { type: "string" } },
    VALIDATE_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${VALIDATE_USAGE}\n`);
    return EXIT.ok;
  }
  const file = stringOption(parsed, "file");
  if (file !== undefined) {
    let text: string;
    try {
      text = await readFile(resolve(context.io.cwd, file), "utf8");
    } catch {
      throw new WorkflowError(`cannot read "${file}"`);
    }
    const result = parseProjectContract(text);
    if (!result.ok) {
      context.io.stderr(
        lines(`${file} is invalid:`, renderIssues(result.issues)),
      );
      return EXIT.failed;
    }
    context.io.stdout(
      `${file} is a valid ${result.value.schema_version} project contract.\n`,
    );
    return EXIT.ok;
  }
  const loaded = await openProject(context.io, parsed);
  context.io.stdout(
    lines(
      `${loaded.paths.projectFile} is a valid ${loaded.contract.schema_version} project contract.`,
      loaded.editedOutsideCli
        ? "It has been edited outside the CLI since the last committed state revision."
        : `It matches committed state revision r${loaded.head?.revision ?? "?"}.`,
    ),
  );
  return EXIT.ok;
}

export const HISTORY_USAGE = `Usage:
  anvilmark history [--json] [--project-dir DIR]
  anvilmark history resolve rN --adopt|--abandon

A revision is committed only when its commit replaced project.yaml. A revision
whose commit failed is shown as abandoned or uncommitted and never counts as
accepted. If project.yaml was edited outside the CLI after an interrupted commit,
that revision is ambiguous and no commit proceeds until you resolve it: compare
.anvilmark/history/rNNNNNN.yaml with .anvilmark/project.yaml, then run
"history resolve rN --adopt" if project.yaml contains its change, or
"--abandon" if it does not.`;

export async function historyCommand(
  context: CommandContext,
  sub: string | undefined,
): Promise<ExitCode> {
  const parsed = parse(
    context.args,
    { adopt: { type: "boolean" }, abandon: { type: "boolean" } },
    HISTORY_USAGE,
  );
  if (flag(parsed, "help")) {
    context.io.stdout(`${HISTORY_USAGE}\n`);
    return EXIT.ok;
  }
  if (sub === "resolve") {
    const target = parsed.positionals[0];
    const match = target === undefined ? null : /^r?(\d+)$/.exec(target);
    const adopt = flag(parsed, "adopt");
    const abandon = flag(parsed, "abandon");
    if (match === null || adopt === abandon) {
      throw new UsageError(
        "give one revision and exactly one of --adopt or --abandon",
        HISTORY_USAGE,
      );
    }
    const loaded = await openProject(context.io, parsed);
    const entry = await resolveAmbiguousRevision({
      paths: loaded.paths,
      revision: Number(match[1]),
      resolution: adopt ? "adopt" : "abandon",
      clock: context.io.clock,
      ...(context.storeFs === undefined ? {} : { fs: context.storeFs }),
    });
    context.io.stdout(
      lines(
        adopt
          ? `Revision r${entry.revision} is recorded as committed: project.yaml's current content is treated as building on it.`
          : `Revision r${entry.revision} is recorded as abandoned: its change, and any proposal it applied, is not part of the committed history.`,
      ),
    );
    return EXIT.ok;
  }
  if (sub !== undefined) {
    throw new UsageError(`unknown history subcommand "${sub}"`, HISTORY_USAGE);
  }
  if (
    parsed.values.adopt !== undefined ||
    parsed.values.abandon !== undefined
  ) {
    throw new UsageError(
      "--adopt and --abandon belong to history resolve",
      HISTORY_USAGE,
    );
  }
  const loaded = await openProject(context.io, parsed);
  const history = loaded.history;
  if (flag(parsed, "json")) {
    writeJson(context.io, {
      head: history.head?.revision ?? null,
      latest_committed: history.latest?.revision ?? null,
      edited_outside_cli: loaded.editedOutsideCli,
      entries: history.committed,
      revisions: history.revisions.map((revision) => ({
        revision: revision.entry.revision,
        standing: revision.standing,
        basis: revision.basis,
      })),
    });
    return EXIT.ok;
  }
  const out: string[] = [];
  for (const entry of history.committed) {
    out.push(
      `r${entry.revision}  ${entry.created_at}  ${entry.command}: ${entry.summary}`,
    );
    for (const notice of entry.notices) {
      out.push(`      notice: ${notice}`);
    }
    if (entry.provenance !== null) {
      const provenance = entry.provenance as Record<string, unknown>;
      out.push(
        `      provenance: ${String(provenance.kind ?? "recorded")} via ${String(provenance.adapter_id ?? "unknown")}`,
      );
    }
  }
  if (loaded.editedOutsideCli && history.latest !== null) {
    out.push(
      `project.yaml has been edited outside the CLI since committed revision r${history.latest.revision}.`,
    );
  }
  const others = history.revisions.filter(
    (revision) => revision.standing !== "committed",
  );
  if (others.length > 0) {
    out.push(
      "",
      `${others.length} snapshot(s) are not part of the committed history; they are kept, not deleted:`,
      ...others.map(
        (revision) =>
          `  r${revision.entry.revision} ${revision.standing}: ${revision.entry.command}: ${revision.entry.summary} (${revision.basis})`,
      ),
    );
  }
  if (history.ambiguous.length > 0) {
    out.push("", ambiguityGuidance(loaded.paths, history.ambiguous));
  }
  context.io.stdout(lines(out.length === 0 ? ["no committed states"] : out));
  return EXIT.ok;
}
