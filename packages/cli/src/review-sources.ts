import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";

import type { OmittedSource } from "@anvilmark/conformance";
import { classifyValue } from "@anvilmark/project-contract";

export interface SourceLimits {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_SOURCE_LIMITS: SourceLimits = {
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
};

export interface CollectSourcesInput {
  /** The scanned repository; every included file must resolve inside it. */
  readonly repositoryRoot: string;
  /** Repository-relative paths named by findings, traces or observations. */
  readonly paths: Iterable<string>;
  /** `sha256:` digests the scan recorded for each path. */
  readonly expectedHashes: ReadonlyMap<string, string>;
  readonly limits?: SourceLimits;
}

export interface CollectedSources {
  readonly sources: Record<string, string>;
  readonly omitted: readonly OmittedSource[];
}

function inside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + sep);
}

/**
 * Read the source files a review bundle may carry. A file is included only if
 * it is inside the repository, unchanged since the scan, within the size
 * limits and free of recognisable credential values; every other path is
 * reported with the reason it was left out.
 */
export async function collectReviewSources(
  input: CollectSourcesInput,
): Promise<CollectedSources> {
  const limits = input.limits ?? DEFAULT_SOURCE_LIMITS;
  const root = await realpath(input.repositoryRoot);
  const sources: Record<string, string> = {};
  const omitted: OmittedSource[] = [];
  let total = 0;

  for (const path of [...new Set(input.paths)].sort()) {
    const normalized = normalize(path);
    if (
      isAbsolute(path) ||
      normalized === ".." ||
      normalized.startsWith(`..${sep}`)
    ) {
      omitted.push({ path, reason: "outside_repository" });
      continue;
    }

    let physical: string;
    try {
      physical = await realpath(resolve(root, path));
    } catch {
      omitted.push({ path, reason: "unreadable" });
      continue;
    }
    if (!inside(physical, root)) {
      omitted.push({ path, reason: "outside_repository" });
      continue;
    }

    const size = await stat(physical).then(
      (info) => (info.isFile() ? info.size : null),
      () => null,
    );
    if (size === null) {
      omitted.push({ path, reason: "unreadable" });
      continue;
    }
    if (size > limits.maxFileBytes) {
      omitted.push({ path, reason: "too_large" });
      continue;
    }

    const expected = input.expectedHashes.get(path);
    if (expected === undefined) {
      omitted.push({ path, reason: "not_in_scan" });
      continue;
    }
    const bytes = await readFile(physical);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== expected) {
      omitted.push({ path, reason: "modified_since_scan" });
      continue;
    }

    const text = bytes.toString("utf8");
    if (classifyValue(text, "source").isSecret) {
      omitted.push({ path, reason: "possible_secret" });
      continue;
    }
    if (total + bytes.length > limits.maxTotalBytes) {
      omitted.push({ path, reason: "total_limit" });
      continue;
    }

    total += bytes.length;
    sources[path] = text;
  }

  return { sources, omitted };
}
