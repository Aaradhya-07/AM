import { z } from "zod/v4";

import type { ContractIssue } from "@anvilmark/project-contract";
import {
  DataClassificationSchema,
  IdSchema,
  RefSchema,
  RelativePathSchema,
  parseYamlDocument,
} from "@anvilmark/project-contract";

import { ACCEPTED_SCAN_CONFIG_FORMATS, SCAN_CONFIG_FORMAT } from "./version.js";

/**
 * The local scan declaration file (`.anvilmark/scanner.yaml` by default).
 *
 * Declarations are the user's statements about their own code: which exported
 * function returns raw tickets, which one redacts them, which recognized
 * provider operations correspond to which architecture node and candidate.
 * Every declaration names a repository file and an exported symbol, and the
 * scanner binds it to what the compiler resolves there — never to a name that
 * merely looks the same elsewhere. A declared sanitizer is an assumption about
 * that function, not proof that its implementation is effective.
 *
 * This file is not part of the project contract and is never sent anywhere.
 */

/** A repository-relative path that stays inside the repository. */
export const RepositoryPathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/.test(value) &&
      !value.includes("\\") &&
      value.split("/").every((part) => part !== "" && part !== ".."),
    {
      message:
        "must be a normalized repository-relative path using '/', without '..' or empty segments",
    },
  );

const IncludePathSchema = z.union([z.literal("."), RepositoryPathSchema]);

export const DeclaredSymbolSchema = z.strictObject({
  path: RepositoryPathSchema,
  /** An exported name of that module; `default` for the default export. */
  export: z.string().min(1),
});

export type DeclaredSymbol = z.infer<typeof DeclaredSymbolSchema>;

export const SourceDeclarationSchema = z.strictObject({
  id: IdSchema,
  data_classification: DataClassificationSchema,
  function: DeclaredSymbolSchema,
  /** `return`: the call's result carries the classification. `parameter`: one parameter does. */
  from: z.enum(["return", "parameter"]).default("return"),
  parameter: z.int().min(0).nullable().default(null),
  architecture_node_ref: RefSchema.nullable().default(null),
});

export const SanitizerDeclarationSchema = z.strictObject({
  id: IdSchema,
  function: DeclaredSymbolSchema,
  /** The argument position whose declared classifications the return value no longer carries. */
  argument: z.int().min(0).default(0),
  clears: z.array(DataClassificationSchema).min(1),
  /** The classification of the return value; null keeps the cleared label, marked sanitized. */
  produces: DataClassificationSchema.nullable().default(null),
  architecture_node_ref: RefSchema.nullable().default(null),
});

export const SinkDeclarationSchema = z.strictObject({
  id: IdSchema,
  recognizer: z.string().min(1),
  /** Recognizer operation ids, e.g. `chat.completions.create`; empty means all. */
  operations: z.array(z.string().min(1)).default([]),
  /**
   * Repository-relative files or directories the sink applies to; empty
   * means every call the recognizer observes.
   */
  paths: z.array(IncludePathSchema).default([]),
  architecture_node_ref: RefSchema.nullable().default(null),
  candidate_ref: RefSchema.nullable().default(null),
  /**
   * Your statement that, where the model is chosen at run time at these
   * call sites, it is always one of these values. Recorded as a T1
   * declaration; never inferred.
   */
  models: z.array(z.string().min(1)).min(1).nullable().default(null),
  /**
   * Your statement that, where the endpoint is chosen at run time at these
   * call sites, it always belongs to one of these providers (T1).
   */
  providers: z.array(z.string().min(1)).min(1).nullable().default(null),
});

export const ComponentDeclarationSchema = z.strictObject({
  id: IdSchema,
  path: RepositoryPathSchema,
  /** Restrict to calls inside this exported function; null means the whole file. */
  export: z.string().min(1).nullable().default(null),
  architecture_node_ref: RefSchema,
  workload_ref: RefSchema.nullable().default(null),
});

export const ScanConfigSchema = z
  .strictObject({
    format: z.enum(ACCEPTED_SCAN_CONFIG_FORMATS),
    /** Project-relative; may leave the project directory (e.g. `../app`). */
    repository_root: RelativePathSchema.nullable().default(null),
    include: z.array(IncludePathSchema).min(1).default(["."]),
    exclude: z.array(RepositoryPathSchema).default([]),
    /** Repository-relative tsconfig/jsconfig; null discovers `tsconfig.json`, then `jsconfig.json`. */
    tsconfig: RepositoryPathSchema.nullable().default(null),
    recognizers: z.array(z.string().min(1)).nullable().default(null),
    sources: z.array(SourceDeclarationSchema).default([]),
    sanitizers: z.array(SanitizerDeclarationSchema).default([]),
    sinks: z.array(SinkDeclarationSchema).default([]),
    components: z.array(ComponentDeclarationSchema).default([]),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [group, entries] of [
      ["sources", value.sources],
      ["sanitizers", value.sanitizers],
      ["sinks", value.sinks],
      ["components", value.components],
    ] as const) {
      for (const [index, entry] of entries.entries()) {
        if (seen.has(entry.id)) {
          context.addIssue({
            code: "custom",
            path: [group, index, "id"],
            message: `declaration id "${entry.id}" is used more than once`,
          });
        }
        seen.add(entry.id);
      }
    }
    for (const [index, source] of value.sources.entries()) {
      if ((source.from === "parameter") !== (source.parameter !== null)) {
        context.addIssue({
          code: "custom",
          path: ["sources", index, "parameter"],
          message:
            "a parameter source needs a parameter index, and a return source must not have one",
        });
      }
    }
  });

export type ScanConfig = z.infer<typeof ScanConfigSchema>;
export type SourceDeclaration = z.infer<typeof SourceDeclarationSchema>;
export type SanitizerDeclaration = z.infer<typeof SanitizerDeclarationSchema>;
export type SinkDeclaration = z.infer<typeof SinkDeclarationSchema>;
export type ComponentDeclaration = z.infer<typeof ComponentDeclarationSchema>;

/** The configuration used when no declaration file exists. */
export function defaultScanConfig(): ScanConfig {
  return ScanConfigSchema.parse({ format: SCAN_CONFIG_FORMAT });
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ScanConfig }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] };

/** Parse a YAML or JSON declaration file. Issues name fields, never file contents. */
export function parseScanConfig(text: string): ConfigResult {
  const document = parseYamlDocument(text);
  if (!document.ok) {
    return { ok: false, issues: document.issues };
  }
  const parsed = ScanConfigSchema.safeParse(document.value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((entry) => ({
        code: "schema_violation" as const,
        path: entry.path.map(String).join(".") || "<document>",
        message: entry.message,
      })),
    };
  }
  return { ok: true, config: parsed.data };
}
