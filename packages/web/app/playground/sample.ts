// Server-only loader for the committed synthetic playground sample.
// Reads the canonical committed JSON from the repository and narrows it.
// This module must never be imported into a client bundle.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PlaygroundDataError, type PlaygroundModel } from "./types";
import { buildPlaygroundModel } from "./view-models";

// `next` runs with cwd at packages/web for dev, build and start.
const SAMPLE_PATH = join(
  process.cwd(),
  "..",
  "..",
  "docs",
  "handoffs",
  "emergent-playground",
  "samples",
  "atlas.json",
);

export type LoadResult =
  { ok: true; model: PlaygroundModel } | { ok: false; error: string };

export function loadPlaygroundModel(): LoadResult {
  let raw: string;
  try {
    raw = readFileSync(SAMPLE_PATH, "utf8");
  } catch {
    return {
      ok: false,
      error: "Could not read the committed synthetic sample bundle.",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The sample bundle is not valid JSON." };
  }
  try {
    return { ok: true, model: buildPlaygroundModel(parsed) };
  } catch (error) {
    if (error instanceof PlaygroundDataError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "The sample bundle failed validation." };
  }
}
