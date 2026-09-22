/**
 * The CLI's own version, in one place.
 *
 * It is the version reported by `anvilmark --version` and stamped into exported
 * bundles as the generator. A test pins it to `package.json`, because the two
 * drifting apart makes an artifact claim it came from a build that never made
 * it. This is NOT an artifact format version: those live with their schemas and
 * move only when the format does.
 */
export const CLI_VERSION = "0.1.0-draft.2" as const;
