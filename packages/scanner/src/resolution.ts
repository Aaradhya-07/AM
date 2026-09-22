import { builtinModules } from "node:module";
import { dirname, join } from "node:path";

import ts from "typescript";

import type { RepositoryReader } from "./boundary.js";
import type { Span } from "./model.js";
import { compareSpans } from "./model.js";
import { spanOf } from "./program.js";
import type { CompilerSetup } from "./program.js";
import type { RecognizerSet } from "./recognizers/index.js";
import {
  boundaryFor,
  isUnsupportedSdk,
  modelFactoryFor,
  providerForPackage,
} from "./recognizers/index.js";
import { enclosingSymbol, packageOfFile } from "./symbols.js";

/** Stylesheets, images and other assets imported for a bundler, not modules to analyse. */
const ASSET_SPECIFIER =
  /\.(?:css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg|pdf|txt|md|mdx|html?)(?:\?.*)?$/i;

/** Data files: a dynamic import of one loads data, never code. */
export const DATA_SPECIFIER =
  /\.(?:json|css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|txt|md|ya?ml)(?:\?.*)?$/i;

/** Build output directories whose sources are scanned from their package. */
const BUILD_OUTPUT = new Set(["dist", "build", "out"]);

/** `import(\`./locales/${lang}.json\`)`: the specifier's literal tail names a data file. */
export function dataImportSpecifier(
  expression: ts.Expression | undefined,
): boolean {
  if (expression === undefined) return false;
  if (ts.isTemplateExpression(expression)) {
    const tail = expression.templateSpans.at(-1)?.literal.text ?? "";
    return DATA_SPECIFIER.test(tail);
  }
  return false;
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? specifier);
}

/**
 * Resolution stage, part 2: module specifiers resolved exactly as the
 * compiler resolves them, with the same bounded host. Only facts that matter
 * downstream are kept: imports of recognized or known AI/boundary packages,
 * and every import the scanner could not resolve or whose specifier is chosen
 * at run time.
 */

export type ImportKind =
  "static" | "re_export" | "import_equals" | "require" | "dynamic";

export interface ImportFact {
  readonly span: Span;
  readonly symbol: string | null;
  readonly kind: ImportKind;
  readonly specifier: string | null;
  readonly resolution:
    | {
        readonly status: "package";
        readonly package: string;
        readonly category: "provider_sdk" | "unsupported_ai_sdk" | "boundary";
        readonly recognizer: string | null;
      }
    | { readonly status: "unresolved" }
    | { readonly status: "runtime_selected" };
}

const SAFE_SPECIFIER = /^[@\w][\w@./-]{0,127}$|^\.{1,2}\/[\w@./-]{0,126}$/;
const BUILTINS = new Set(builtinModules);

function isBuiltin(specifier: string): boolean {
  return (
    specifier.startsWith("node:") || BUILTINS.has(specifier.split("/")[0] ?? "")
  );
}

export function resolveImports(
  setup: CompilerSetup,
  reader: RepositoryReader,
  recognizers: RecognizerSet,
): ImportFact[] {
  const facts: ImportFact[] = [];
  const cache = ts.createModuleResolutionCache(
    reader.root,
    (name) => name,
    setup.options,
  );

  for (const file of setup.program.getSourceFiles()) {
    if (!setup.analysable.has(file.fileName)) continue;
    const path = reader.relative(file.fileName);

    const record = (
      node: ts.Node,
      kind: ImportKind,
      specifierNode: ts.Expression | undefined,
    ) => {
      const span = spanOf(node, file, path);
      const symbol = enclosingSymbol(node);
      if (
        specifierNode === undefined ||
        !ts.isStringLiteralLike(specifierNode)
      ) {
        if (dataImportSpecifier(specifierNode)) return;
        facts.push({
          span,
          symbol,
          kind,
          specifier: null,
          resolution: { status: "runtime_selected" },
        });
        return;
      }
      const specifier = specifierNode.text;
      if (isBuiltin(specifier)) return;
      const mode = ts.getModeForUsageLocation(
        file,
        specifierNode,
        setup.options,
      );
      const resolved = ts.resolveModuleName(
        specifier,
        file.fileName,
        setup.options,
        setup.host,
        cache,
        undefined,
        mode,
      ).resolvedModule;
      const shown = SAFE_SPECIFIER.test(specifier)
        ? specifier
        : "<unrepresentable specifier>";
      if (resolved === undefined) {
        if (ASSET_SPECIFIER.test(specifier)) return;
        if (specifier.startsWith(".")) {
          // Built output of a package whose sources are scanned (`../dist/cli.js`).
          const target = reader.relative(
            join(dirname(file.fileName), ...specifier.split("/")),
          );
          if (
            !target.startsWith("..") &&
            target.split("/").some((part) => BUILD_OUTPUT.has(part))
          )
            return;
        } else {
          // A workspace package linked into node_modules from this repository
          // but not built: its sources are scanned where they live.
          const link = join(
            reader.root,
            "node_modules",
            ...packageNameOf(specifier).split("/"),
          );
          const physical = reader.realpath(link);
          if (
            physical !== link &&
            reader.isInsideRoot(physical) &&
            !reader.relative(physical).split("/").includes("node_modules")
          )
            return;
        }
        facts.push({
          span,
          symbol,
          kind,
          specifier: shown,
          resolution: { status: "unresolved" },
        });
        return;
      }
      const packageName =
        resolved.packageId?.name ?? packageOfFile(resolved.resolvedFileName);
      const provider =
        providerForPackage(recognizers, packageName) ??
        modelFactoryFor(recognizers, packageName)?.recognizer ??
        null;
      const boundary = boundaryFor(recognizers, {
        packageName,
        ambientModule: null,
        global: null,
      });
      const category =
        provider !== null
          ? ("provider_sdk" as const)
          : isUnsupportedSdk(recognizers, packageName)
            ? ("unsupported_ai_sdk" as const)
            : boundary !== null
              ? ("boundary" as const)
              : null;
      if (category === null || packageName === null) return;
      facts.push({
        span,
        symbol,
        kind,
        specifier: shown,
        resolution: {
          status: "package",
          package: packageName,
          category,
          recognizer: provider?.id ?? boundary?.id ?? null,
        },
      });
    };

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        record(node, "static", node.moduleSpecifier);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        record(node, "re_export", node.moduleSpecifier);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        record(node, "import_equals", node.moduleReference.expression);
      } else if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          record(node, "dynamic", node.arguments[0]);
        } else if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require" &&
          node.arguments.length === 1 &&
          setup.checker
            .getSymbolAtLocation(node.expression)
            ?.valueDeclaration?.getSourceFile().fileName !== file.fileName
        ) {
          record(node, "require", node.arguments[0]);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return facts.sort((left, right) => compareSpans(left.span, right.span));
}
