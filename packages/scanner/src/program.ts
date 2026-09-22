import { join, posix } from "node:path";

import ts from "typescript";

import type { RepositoryReader } from "./boundary.js";
import type { ScanConfig } from "./config.js";
import { absoluteIn } from "./inventory.js";
import type { Inventory } from "./inventory.js";
import type { Span } from "./model.js";
import { compareStrings } from "./model.js";

/**
 * Resolution stage, part 1: one TypeScript Program with a real type checker.
 *
 * - The compiler host reads only through `RepositoryReader`.
 * - A tsconfig/jsconfig contributes compiler options; the files analysed are
 *   the inventory's (scan `include`/`exclude` and default exclusions), so a
 *   tsconfig cannot widen the scan. `allowJs` is forced on.
 * - Nothing is emitted, no build runs, and tsconfig `plugins` are never loaded
 *   (the compiler API does not load them; they are reported as not run).
 *   Project `references` are not followed.
 */

export type ConfigProblemKind =
  | "tsconfig_missing"
  | "tsconfig_invalid"
  | "tsconfig_plugins_not_run"
  | "project_references_not_followed"
  | "compiler_option_error";

export interface ConfigProblem {
  readonly kind: ConfigProblemKind;
  readonly path: string | null;
  /** A TypeScript diagnostic code such as `TS5083`; never message text. */
  readonly code: string | null;
}

export interface ParseProblem {
  readonly kind: "parse_error";
  readonly span: Span;
  readonly code: string;
}

export interface CompilerSummary {
  readonly tsconfig: string | null;
  readonly root_files: "scan_inventory";
  readonly options: {
    readonly target: string | null;
    readonly module: string | null;
    readonly module_resolution: string | null;
    readonly jsx: string | null;
    readonly strict: boolean;
    readonly paths_configured: boolean;
  };
  readonly forced: readonly string[];
}

export interface CompilerSetup {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly options: ts.CompilerOptions;
  readonly host: ts.CompilerHost;
  readonly summary: CompilerSummary;
  readonly configProblems: readonly ConfigProblem[];
  readonly parseProblems: readonly ParseProblem[];
  /** Absolute file names the analysis treats as repository source. */
  readonly analysable: ReadonlySet<string>;
}

const FORCED: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  noEmit: true,
  skipLibCheck: true,
  maxNodeModuleJsDepth: 0,
  declaration: false,
  emitDeclarationOnly: false,
  composite: false,
  incremental: false,
};

const DEFAULTS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  esModuleInterop: true,
  resolveJsonModule: true,
  allowImportingTsExtensions: true,
};

function enumName(
  table: Record<string, string | number>,
  value: number | undefined,
): string | null {
  if (value === undefined) return null;
  const name = table[value];
  return typeof name === "string" ? name : null;
}

export function spanOf(node: ts.Node, file: ts.SourceFile, path: string): Span {
  const start = file.getLineAndCharacterOfPosition(node.getStart(file));
  const end = file.getLineAndCharacterOfPosition(node.getEnd());
  return {
    path,
    start: { line: start.line + 1, column: start.character + 1 },
    end: { line: end.line + 1, column: end.character + 1 },
  };
}

function roleFor(reader: RepositoryReader, fileName: string) {
  const relative = reader.relative(fileName);
  if (relative.split("/").includes("node_modules")) return "resolution_input";
  if (/\.d\.[cm]?ts$/.test(fileName)) return "declaration";
  return "source";
}

export function createCompilerSetup(
  reader: RepositoryReader,
  config: ScanConfig,
  inventory: Inventory,
): CompilerSetup {
  const configProblems: ConfigProblem[] = [];
  let tsconfigPath: string | null = null;
  let parsedOptions: ts.CompilerOptions = { ...DEFAULTS };

  if (config.tsconfig !== null) {
    if (reader.fileExists(absoluteIn(reader.root, config.tsconfig))) {
      tsconfigPath = config.tsconfig;
    } else {
      configProblems.push({
        kind: "tsconfig_missing",
        path: config.tsconfig,
        code: null,
      });
    }
  } else {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      if (reader.fileExists(join(reader.root, name))) {
        tsconfigPath = name;
        break;
      }
    }
  }

  if (tsconfigPath !== null) {
    const absolute = absoluteIn(reader.root, tsconfigPath);
    const text = reader.readText(absolute, "compiler_config");
    const json =
      text === undefined
        ? { error: undefined, config: undefined }
        : ts.parseConfigFileTextToJson(absolute, text);
    if (text === undefined || json.error !== undefined) {
      configProblems.push({
        kind: "tsconfig_invalid",
        path: tsconfigPath,
        code: json.error === undefined ? null : `TS${json.error.code}`,
      });
    } else {
      const raw = (json.config ?? {}) as {
        compilerOptions?: { plugins?: unknown };
        references?: unknown;
      };
      if (raw.compilerOptions?.plugins !== undefined) {
        configProblems.push({
          kind: "tsconfig_plugins_not_run",
          path: tsconfigPath,
          code: null,
        });
      }
      if (Array.isArray(raw.references) && raw.references.length > 0) {
        configProblems.push({
          kind: "project_references_not_followed",
          path: tsconfigPath,
          code: null,
        });
      }
      const parsed = ts.parseJsonConfigFileContent(
        json.config,
        {
          useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
          // File selection comes from the inventory, never from a directory
          // walk the compiler would perform.
          readDirectory: () => [],
          fileExists: (path) => reader.fileExists(path),
          readFile: (path) => reader.readText(path, "compiler_config"),
        },
        posix.dirname(absolute.split("\\").join("/")),
        undefined,
        absolute,
      );
      const codes = [
        ...new Set(
          parsed.errors
            .map((error) => error.code)
            .filter((code) => code !== 18003),
        ),
      ].sort((left, right) => left - right);
      for (const code of codes) {
        configProblems.push({
          kind: "tsconfig_invalid",
          path: tsconfigPath,
          code: `TS${code}`,
        });
      }
      parsedOptions = { ...parsed.options };
      delete parsedOptions.plugins;
      delete parsedOptions.outDir;
      delete parsedOptions.outFile;
      delete parsedOptions.declarationDir;
      delete parsedOptions.tsBuildInfoFile;
      delete parsedOptions.configFilePath;
    }
  }

  const forced = Object.entries(FORCED)
    .filter(
      ([name, value]) =>
        (parsedOptions as Record<string, unknown>)[name] !== undefined &&
        (parsedOptions as Record<string, unknown>)[name] !== value,
    )
    .map(([name]) => name)
    .sort(compareStrings);
  const options: ts.CompilerOptions = { ...parsedOptions, ...FORCED };

  const host = ts.createCompilerHost(options, true);
  host.readFile = (path) => reader.readText(path, roleFor(reader, path));
  host.fileExists = (path) => reader.fileExists(path);
  host.directoryExists = (path) => reader.directoryExists(path);
  host.getDirectories = (path) => reader.getDirectories(path);
  host.realpath = (path) => reader.realpath(path);
  host.getCurrentDirectory = () => reader.root;
  host.getDefaultLibLocation = () => reader.libDirectory;
  host.getDefaultLibFileName = (compilerOptions) =>
    join(reader.libDirectory, ts.getDefaultLibFileName(compilerOptions));
  host.getEnvironmentVariable = () => undefined;
  host.writeFile = () => {
    throw new Error("the repository scanner never writes compiler output");
  };
  host.getSourceFile = (fileName, languageVersion) => {
    const text = host.readFile(fileName);
    return text === undefined
      ? undefined
      : ts.createSourceFile(fileName, text, languageVersion, true);
  };
  delete host.trace;

  const rootNames = [...inventory.sourceFiles, ...inventory.declarationFiles]
    .map((path) => absoluteIn(reader.root, path))
    .sort(compareStrings);
  const program = ts.createProgram({ rootNames, options, host });
  const checker = program.getTypeChecker();

  for (const diagnostic of [
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
  ]) {
    configProblems.push({
      kind: "compiler_option_error",
      path: tsconfigPath,
      code: `TS${diagnostic.code}`,
    });
  }

  const analysable = new Set<string>();
  const parseProblems: ParseProblem[] = [];
  for (const path of inventory.sourceFiles) {
    const file = program.getSourceFile(absoluteIn(reader.root, path));
    if (file === undefined) continue;
    analysable.add(file.fileName);
    for (const diagnostic of program.getSyntacticDiagnostics(file)) {
      const start = diagnostic.start ?? 0;
      const from = file.getLineAndCharacterOfPosition(start);
      const to = file.getLineAndCharacterOfPosition(
        start + (diagnostic.length ?? 0),
      );
      parseProblems.push({
        kind: "parse_error",
        code: `TS${diagnostic.code}`,
        span: {
          path,
          start: { line: from.line + 1, column: from.character + 1 },
          end: { line: to.line + 1, column: to.character + 1 },
        },
      });
    }
  }

  return {
    program,
    checker,
    options,
    host,
    analysable,
    configProblems: dedupeProblems(configProblems),
    parseProblems,
    summary: {
      tsconfig: tsconfigPath,
      root_files: "scan_inventory",
      options: {
        target: enumName(
          ts.ScriptTarget as unknown as Record<string, string>,
          options.target,
        ),
        module: enumName(
          ts.ModuleKind as unknown as Record<string, string>,
          options.module,
        ),
        module_resolution: enumName(
          ts.ModuleResolutionKind as unknown as Record<string, string>,
          options.moduleResolution,
        ),
        jsx: enumName(
          ts.JsxEmit as unknown as Record<string, string>,
          options.jsx,
        ),
        strict: options.strict === true,
        paths_configured:
          options.paths !== undefined && Object.keys(options.paths).length > 0,
      },
      forced,
    },
  };
}

function dedupeProblems(problems: ConfigProblem[]): ConfigProblem[] {
  const unique = new Map(
    problems.map((problem) => [
      `${problem.kind}:${problem.path ?? ""}:${problem.code ?? ""}`,
      problem,
    ]),
  );
  return [...unique.values()].sort(
    (left, right) =>
      compareStrings(left.kind, right.kind) ||
      compareStrings(left.code ?? "", right.code ?? ""),
  );
}
