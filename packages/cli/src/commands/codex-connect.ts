import {
  lstat,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { StoreError } from "../store.js";

const SERVER_NAME = "anvilmark-project";
const START = "# BEGIN ANVILMARK PROJECT MCP";
const END = "# END ANVILMARK PROJECT MCP";

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(
    (entry) => entry.isFile(),
    () => false,
  );
}

export async function currentProjectServerEntry(): Promise<string> {
  const invoked = process.argv[1];
  if (invoked === undefined)
    throw new StoreError("Cannot locate the ANVILMARK command entry point.");
  const cliEntry = await realpath(invoked);
  const candidates = [
    join(dirname(cliEntry), "anvilmark-project-mcp.mjs"),
    resolve(dirname(cliEntry), "../../mcp/bin/anvilmark-project-mcp.mjs"),
  ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return realpath(candidate);
  }
  throw new StoreError(
    "Cannot locate anvilmark-project-mcp beside this ANVILMARK installation; reinstall the complete package and retry.",
  );
}

function section(root: string, serverEntry: string): string {
  return `${START}
[mcp_servers.${SERVER_NAME}]
command = "node"
args = [${[serverEntry, "--project-dir", root, "--agent-assessment"].map((value) => JSON.stringify(value)).join(", ")}]
cwd = ${JSON.stringify(root)}
default_tools_approval_mode = "writes"
${END}
`;
}

export type CodexConnection = "created" | "unchanged";

export async function connectCodexProject(
  root: string,
  serverEntry: string,
): Promise<CodexConnection> {
  const configPath = join(root, ".codex", "config.toml");
  for (const path of [dirname(configPath), configPath]) {
    if ((await lstat(path).catch(() => null))?.isSymbolicLink())
      throw new StoreError(
        `${path} is a symbolic link; ANVILMARK will not modify configuration outside this project.`,
      );
  }
  const block = section(root, serverEntry);
  const current = await readFile(configPath, "utf8").catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  });
  if (current !== null) {
    if (current.includes(START) || current.includes(END)) {
      if (current.includes(block)) return "unchanged";
      throw new StoreError(
        `ANVILMARK's block in ${configPath} was changed or belongs to another installation; review it before reconnecting.`,
      );
    }
    if (
      /^\s*\[\s*mcp_servers\.(?:anvilmark-project|"anvilmark-project"|'anvilmark-project')(?:\.|\s*\])/m.test(
        current,
      )
    )
      throw new StoreError(
        `${configPath} already configures ${SERVER_NAME}; review that entry before reconnecting.`,
      );
  }
  const next = `${current === null || current.length === 0 ? "" : `${current.replace(/\s*$/, "")}\n\n`}${block}`;
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, next, "utf8");
  return "created";
}
