import type { ProjectContract } from "./schema/contract.js";
/**
 * The Atlas Support Desk draft contract.
 *
 * The package reads the ratified document in `docs/vnext/fixtures/` directly
 * rather than keeping a copy. A duplicated fixture would drift from the
 * document the team ratified, and the point of this milestone is that the
 * authored Atlas contract is executable exactly as written.
 */
export declare const ATLAS_FIXTURE_PATH: "docs/vnext/fixtures/atlas-project.draft.yaml";
/** Read the Atlas fixture as raw YAML text. */
export declare function readAtlasFixtureText(): Promise<string>;
/** Read, parse, and fully validate the Atlas fixture. Throws on any issue. */
export declare function loadAtlasFixture(): Promise<ProjectContract>;
//# sourceMappingURL=fixtures.d.ts.map