import { describe, expect, it } from "vitest";

import {
  FIXTURE_NAMES,
  SCHEMA_VERSION,
  loadAllFixtures,
} from "../src/index.js";

describe("the frozen contract", () => {
  it("validates every shared fixture", async () => {
    const fixtures = await loadAllFixtures();

    expect(fixtures).toHaveLength(FIXTURE_NAMES.length);
    expect(
      fixtures.every((fixture) => fixture.schemaVersion === SCHEMA_VERSION),
    ).toBe(true);
  });
});
