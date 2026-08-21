import type { ContractResult } from "./errors.js";
import type { ProjectContract } from "./schema/contract.js";
export type ContractFormat = "yaml" | "json";
/**
 * Parse YAML text into an untyped document, reporting syntax errors precisely.
 *
 * `JSON_SCHEMA` is used rather than js-yaml's default YAML 1.1 schema on
 * purpose. The default schema converts an unquoted `2026-08-17T00:00:00Z`
 * into a JavaScript `Date` and applies other YAML 1.1 coercions; a `Date`
 * cannot be canonically serialized and would make timestamps depend on the
 * host's clock formatting. Restricting scalars to the JSON set keeps every
 * value a string, number, boolean, or null, which is what a portable contract
 * format needs.
 */
export declare function parseYamlDocument(text: string): ContractResult<unknown>;
/** Parse JSON text into an untyped document, reporting syntax errors precisely. */
export declare function parseJsonDocument(text: string): ContractResult<unknown>;
/**
 * Validate an already-parsed document.
 *
 * Stages follow the ratified pipeline in milestone 01: schema, then reference
 * integrity, then secret rejection, then evidence-floor invariants. Integrity
 * and secret findings are merged so that a caller sees every problem at once
 * rather than fixing them one round-trip at a time.
 *
 * Invalid input is never repaired or partially applied: on failure the caller
 * receives issues and no contract.
 */
export declare function validateProjectContract(document: unknown): ContractResult<ProjectContract>;
/** Parse and fully validate a contract from YAML or JSON text. */
export declare function parseProjectContract(text: string, format?: ContractFormat): ContractResult<ProjectContract>;
//# sourceMappingURL=parse.d.ts.map