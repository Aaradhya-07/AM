import { readFile } from "node:fs/promises";

import type { AuditResult } from "./schemas.js";
import { AuditResultSchema } from "./schemas.js";

export const FIXTURE_NAMES = [
  "saas-support",
  "document-review",
  "research-agent",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

function fixtureUrl(name: FixtureName): URL {
  return new URL(`../../../fixtures/${name}.json`, import.meta.url);
}

export async function loadFixture(name: FixtureName): Promise<AuditResult> {
  const source = await readFile(fixtureUrl(name), "utf8");
  return AuditResultSchema.parse(JSON.parse(source));
}

export async function loadAllFixtures(): Promise<AuditResult[]> {
  return Promise.all(FIXTURE_NAMES.map(loadFixture));
}
