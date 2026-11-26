import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import { parseBundle } from "./apply-plan.js";

export const ACTIVE_PLAN = ".anvilmark/development/active-plan.json";
export const SLICE_OUTCOMES = ".anvilmark/development/slice-outcomes.jsonl";

export function repoPath(path: string): string[] {
  const segments = path.split("/");
  if (
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    isAbsolute(path) ||
    /^[a-z]:/i.test(path) ||
    segments.some(
      (part) =>
        !part || part === "." || part === ".." || part.toLowerCase() === ".git",
    )
  )
    throw new Error("Unsafe repository-relative path");
  return segments;
}

export async function inspectPath(
  root: string,
  path: string,
  directory = false,
  create = false,
) {
  const segments = repoPath(path);
  let full = root;
  for (const [index, part] of segments.entries()) {
    full = join(full, part);
    const expectDirectory = directory || index < segments.length - 1;
    if (expectDirectory && create) {
      await mkdir(full, { mode: 0o700 }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
        },
      );
    }
    const info = await lstat(full).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return null;
    if (
      info.isSymbolicLink() ||
      (expectDirectory ? !info.isDirectory() : !info.isFile())
    )
      throw new Error(
        "Repository path is a symlink or has an unexpected file type",
      );
  }
  return full;
}

export async function readRepoFile(
  root: string,
  path: string,
  maxBytes = 2 * 1024 * 1024,
) {
  const full = await inspectPath(root, path);
  if (full === null) return null;
  const handle = await open(
    full,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > maxBytes)
      throw new Error("Repository file is invalid or too large");
    const buffer = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > info.size)
      throw new Error("Repository file changed while being read");
    return buffer.toString("utf8", 0, offset);
  } finally {
    await handle.close();
  }
}

export async function writeRepoJson(
  root: string,
  path: string,
  value: unknown,
) {
  await inspectPath(root, dirname(path), true, true);
  await inspectPath(root, path);
  const destination = join(root, path);
  const temporary = destination + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await inspectPath(root, path);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function loadSlicePlan(root: string, path = ACTIVE_PLAN) {
  const raw = await readRepoFile(root, path, 4 * 1024 * 1024);
  return raw === null ? null : parseBundle(JSON.parse(raw));
}

export function fromRoot(root: string, absolute: string): string {
  const path = relative(root, absolute).split(sep).join("/");
  repoPath(path);
  return path;
}
