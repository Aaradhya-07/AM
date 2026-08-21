import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AuditResultSchema } from "./schemas.js";
export const FIXTURE_NAMES = [
    "saas-support",
    "document-review",
    "research-agent",
];
function fixtureUrl(name) {
    return new URL(`../../../fixtures/${name}.json`, import.meta.url);
}
export async function loadFixture(name) {
    const filePath = fileURLToPath(fixtureUrl(name).href);
    const source = await readFile(filePath, "utf8");
    return AuditResultSchema.parse(JSON.parse(source));
}
export async function loadAllFixtures() {
    return Promise.all(FIXTURE_NAMES.map(loadFixture));
}
