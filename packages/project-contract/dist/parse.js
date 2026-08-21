import { JSON_SCHEMA, load as loadYaml, YAMLException } from "js-yaml";
import { fail, issue, ok, sortIssues } from "./errors.js";
import { ProjectContractSchema } from "./schema/contract.js";
import { findSecrets } from "./secrets.js";
import { checkIntegrity } from "./validate/integrity.js";
/**
 * Read the value at a Zod issue path, or `undefined` when the key is absent.
 *
 * Zod 4 reports a missing required key and a wrong-typed key with the same
 * `invalid_type` code and does not carry the received value on the issue, so
 * the document itself is the only reliable way to tell "you forgot this" from
 * "this is the wrong type".
 */
function valueAtPath(root, segments) {
    let current = root;
    for (const segment of segments) {
        if (current === null || typeof current !== "object") {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
function formatPath(segments) {
    let path = "";
    for (const segment of segments) {
        if (typeof segment === "number") {
            path += `[${segment}]`;
        }
        else {
            path = path === "" ? String(segment) : `${path}.${String(segment)}`;
        }
    }
    return path;
}
/** Translate Zod issues into the package's structured error envelope. */
function fromZod(error, document) {
    return error.issues.flatMap((entry) => {
        const path = formatPath(entry.path);
        if (entry.code === "unrecognized_keys") {
            return entry.keys.map((key) => issue("unknown_field", path === "" ? key : `${path}.${key}`, `unknown field "${key}"; the draft schema rejects unrecognized fields so that typos and invented fields surface immediately`, { field: key }));
        }
        if (entry.code === "invalid_type" &&
            valueAtPath(document, entry.path) === undefined) {
            return [
                issue("missing_field", path, `required field is missing; expected ${entry.expected}`, { expected: entry.expected }),
            ];
        }
        return [
            issue("schema_violation", path, entry.message, { zod_code: entry.code }),
        ];
    });
}
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
export function parseYamlDocument(text) {
    try {
        return ok(loadYaml(text, { schema: JSON_SCHEMA }));
    }
    catch (error) {
        if (error instanceof YAMLException) {
            const mark = error.mark;
            const where = mark === undefined || mark.line === undefined
                ? ""
                : ` at line ${mark.line + 1}, column ${(mark.column ?? 0) + 1}`;
            return fail([
                issue("yaml_syntax_error", "<document>", `${error.reason}${where}`, {
                    line: mark?.line === undefined ? null : mark.line + 1,
                    column: mark?.column === undefined ? null : mark.column + 1,
                }),
            ]);
        }
        return fail([
            issue("yaml_syntax_error", "<document>", error instanceof Error ? error.message : String(error)),
        ]);
    }
}
/** Parse JSON text into an untyped document, reporting syntax errors precisely. */
export function parseJsonDocument(text) {
    try {
        return ok(JSON.parse(text));
    }
    catch (error) {
        return fail([
            issue("json_syntax_error", "<document>", error instanceof Error ? error.message : String(error)),
        ]);
    }
}
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
export function validateProjectContract(document) {
    if (document === null ||
        typeof document !== "object" ||
        Array.isArray(document)) {
        return fail([
            issue("document_not_an_object", "<document>", "a project contract must be a mapping at the top level"),
        ]);
    }
    const parsed = ProjectContractSchema.safeParse(document);
    if (!parsed.success) {
        return fail(sortIssues(fromZod(parsed.error, document)));
    }
    const contract = parsed.data;
    const issues = [...checkIntegrity(contract)];
    for (const finding of findSecrets(contract)) {
        issues.push(issue("secret_value_detected", finding.path, finding.explanation, {
            detector: finding.detector,
        }));
    }
    if (issues.length > 0) {
        return fail(sortIssues(issues));
    }
    return ok(contract);
}
function detectFormat(text, hint) {
    if (hint !== undefined) {
        return hint;
    }
    return text.trimStart().startsWith("{") ? "json" : "yaml";
}
/** Parse and fully validate a contract from YAML or JSON text. */
export function parseProjectContract(text, format) {
    const chosen = detectFormat(text, format);
    const document = chosen === "json" ? parseJsonDocument(text) : parseYamlDocument(text);
    if (!document.ok) {
        return fail(document.issues);
    }
    return validateProjectContract(document.value);
}
