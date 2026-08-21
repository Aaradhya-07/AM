/**
 * Project-contract schema line.
 *
 * This is an INDEPENDENT schema line from the historical `@anvilmark/contract`
 * package, whose `SCHEMA_VERSION = "0.1.0"` is frozen and must not change.
 * The identical numeric prefix in two differently named packages is not a
 * collision: package/schema identity supplies the namespace.
 *
 * Ratified in docs/vnext/06-contract-ratification-decision.md section 3.
 */

export const PROJECT_SCHEMA_VERSION = "0.1.0-draft.1" as const;

export const PROJECT_SCHEMA_ID =
  "https://anvilmark.dev/schemas/project/0.1.0-draft.1" as const;

export type ProjectSchemaVersion = typeof PROJECT_SCHEMA_VERSION;
