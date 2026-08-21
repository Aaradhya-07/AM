import { readFile } from "node:fs/promises";
import { unwrap } from "./errors.js";
import { parseProjectContract } from "./parse.js";
/**
 * The Atlas Support Desk draft contract.
 *
 * The package reads the ratified document in `docs/vnext/fixtures/` directly
 * rather than keeping a copy. A duplicated fixture would drift from the
 * document the team ratified, and the point of this milestone is that the
 * authored Atlas contract is executable exactly as written.
 */
export const ATLAS_FIXTURE_PATH = "docs/vnext/fixtures/atlas-project.draft.yaml";
function atlasFixtureUrl() {
    return new URL(`../../../${ATLAS_FIXTURE_PATH}`, import.meta.url);
}
/** Read the Atlas fixture as raw YAML text. */
export async function readAtlasFixtureText() {
    return readFile(atlasFixtureUrl(), "utf8");
}
/** Read, parse, and fully validate the Atlas fixture. Throws on any issue. */
export async function loadAtlasFixture() {
    return unwrap(parseProjectContract(await readAtlasFixtureText(), "yaml"));
}
