import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { ValidatedRegistration } from "@anvilmark/adapters";
import { validateRegistration } from "@anvilmark/adapters";

/**
 * Trusted host configuration.
 *
 * The intelligence providers a machine may call are registered here, by the
 * person who owns the machine, in a file OUTSIDE every project. Project files,
 * intelligence requests and proposals are never consulted for a provider's
 * destination, reach, model or credential name. With no file, nothing is
 * registered and nothing remote can run.
 *
 * This is ordinary local configuration, not a security boundary against a
 * process that can already edit files in your home directory.
 */
export const HOST_CONFIG_FORMAT = "anvilmark-host/0.1";

/** Mechanism ids that are built in and can never be registered. */
export const RESERVED_MECHANISM_IDS = ["none", "handoff"] as const;

export interface HostConfig {
  readonly path: string;
  readonly exists: boolean;
  readonly providers: ReadonlyMap<string, ValidatedRegistration>;
  /** Problems that make the file, or one registration in it, unusable. */
  readonly problems: readonly string[];
}

export function hostConfigPath(
  env: Readonly<Record<string, string | undefined>>,
  homedir: string,
): string {
  const explicit = env.ANVILMARK_CONFIG_HOME;
  if (explicit !== undefined && explicit !== "") {
    return join(resolve(explicit), "host.json");
  }
  const xdg = env.XDG_CONFIG_HOME;
  const base =
    xdg !== undefined && xdg !== "" && isAbsolute(xdg)
      ? xdg
      : join(homedir, ".config");
  return join(base, "anvilmark", "host.json");
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

export async function loadHostConfig(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homedir: string;
  /** The project the command runs in; configuration inside it is refused. */
  readonly projectRoot: string | null;
}): Promise<HostConfig> {
  const path = hostConfigPath(input.env, input.homedir);
  const empty = (exists: boolean, problems: readonly string[]): HostConfig => ({
    path,
    exists,
    providers: new Map(),
    problems,
  });

  if (input.projectRoot !== null && (await isInside(path, input.projectRoot))) {
    return empty(false, [
      `host configuration ${path} is inside the project; it must live outside every project so project files and agent proposals cannot register providers`,
    ]);
  }

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return empty(false, []);
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return empty(true, [`${path} is not valid JSON`]);
  }
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  ) {
    return empty(true, [`${path} must hold a JSON object`]);
  }
  const record = document as Record<string, unknown>;
  const unknown = Object.keys(record).filter(
    (key) => key !== "format" && key !== "intelligence_providers",
  );
  if (record.format !== HOST_CONFIG_FORMAT || unknown.length > 0) {
    return empty(true, [
      `${path} must have "format": "${HOST_CONFIG_FORMAT}" and only "intelligence_providers"${unknown.length > 0 ? `; unknown: ${unknown.join(", ")}` : ""}`,
    ]);
  }
  const listed = record.intelligence_providers ?? [];
  if (!Array.isArray(listed)) {
    return empty(true, [`${path}: intelligence_providers must be an array`]);
  }

  const providers = new Map<string, ValidatedRegistration>();
  const duplicated = new Set<string>();
  const problems: string[] = [];
  listed.forEach((raw, index) => {
    const result = validateRegistration(raw);
    if (!result.ok) {
      problems.push(
        `intelligence_providers[${index}]: ${result.problems.join("; ")}`,
      );
      return;
    }
    const id = result.value.registration.id;
    if ((RESERVED_MECHANISM_IDS as readonly string[]).includes(id)) {
      problems.push(
        `intelligence_providers[${index}]: "${id}" is a built-in mechanism id`,
      );
      return;
    }
    if (providers.has(id) || duplicated.has(id)) {
      duplicated.add(id);
      problems.push(
        `intelligence_providers[${index}]: "${id}" is registered more than once, so neither registration is used`,
      );
      providers.delete(id);
      return;
    }
    providers.set(id, result.value);
  });
  return { path, exists: true, providers, problems };
}
