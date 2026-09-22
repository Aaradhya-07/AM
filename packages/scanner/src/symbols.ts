import ts from "typescript";

import type { RepositoryReader } from "./boundary.js";
import type { DeclaredSymbol } from "./config.js";
import { absoluteIn } from "./inventory.js";

/** Compiler-backed helpers shared by the semantic, flow and binding stages. */

export type FunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

export function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Follow import/export aliases to the symbol that declares the value. */
export function resolveAlias(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
): ts.Symbol | undefined {
  let current = symbol;
  for (let guard = 0; current !== undefined && guard < 16; guard += 1) {
    if ((current.flags & ts.SymbolFlags.Alias) === 0) return current;
    const next = checker.getAliasedSymbol(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * The function node a symbol names: a function declaration, or a variable or
 * property initialised with a function expression, or a method.
 */
export function functionOfSymbol(
  checker: ts.TypeChecker,
  symbol: ts.Symbol | undefined,
  depth = 0,
): FunctionNode | null {
  const resolved = resolveAlias(checker, symbol);
  for (const declaration of resolved?.declarations ?? []) {
    if (ts.isShorthandPropertyAssignment(declaration) && depth < 4) {
      // CommonJS `module.exports = { readTicket }`.
      const value = checker.getShorthandAssignmentValueSymbol(declaration);
      const found = functionOfSymbol(checker, value, depth + 1);
      if (found !== null) return found;
    }
    if (isFunctionNode(declaration) && declaration.body !== undefined) {
      return declaration;
    }
    if (
      (ts.isVariableDeclaration(declaration) ||
        ts.isPropertyAssignment(declaration) ||
        ts.isPropertyDeclaration(declaration)) &&
      declaration.initializer !== undefined
    ) {
      let initializer: ts.Expression = declaration.initializer;
      while (
        ts.isParenthesizedExpression(initializer) ||
        ts.isAsExpression(initializer) ||
        ts.isSatisfiesExpression(initializer)
      ) {
        initializer = initializer.expression;
      }
      if (
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer)
      ) {
        return initializer;
      }
    }
    if (
      ts.isExportAssignment(declaration) &&
      (ts.isArrowFunction(declaration.expression) ||
        ts.isFunctionExpression(declaration.expression))
    ) {
      return declaration.expression;
    }
  }
  return null;
}

/** The npm package a file belongs to, from its last `node_modules` segment. */
export function packageOfFile(fileName: string): string | null {
  const parts = fileName.split(/[\\/]/);
  const index = parts.lastIndexOf("node_modules");
  if (index === -1) return null;
  const first = parts[index + 1];
  if (first === undefined) return null;
  if (first.startsWith("@")) {
    const second = parts[index + 2];
    return second === undefined ? null : `${first}/${second}`;
  }
  return first;
}

/** The ambient module (`declare module "events"`) a declaration sits in. */
export function ambientModuleOf(node: ts.Node): string | null {
  for (
    let current: ts.Node | undefined = node;
    current;
    current = current.parent
  ) {
    if (ts.isModuleDeclaration(current) && ts.isStringLiteral(current.name)) {
      return current.name.text;
    }
  }
  return null;
}

/** The class or interface that owns a member declaration, by its declared name. */
export function ownerOf(declaration: ts.Node): string | null {
  for (
    let current: ts.Node | undefined = declaration.parent;
    current;
    current = current.parent
  ) {
    if (
      (ts.isClassDeclaration(current) ||
        ts.isInterfaceDeclaration(current) ||
        ts.isClassExpression(current)) &&
      current.name !== undefined
    ) {
      return current.name.text;
    }
    if (ts.isSourceFile(current) || ts.isModuleBlock(current)) return null;
  }
  return null;
}

export function memberName(declaration: ts.Node): string | null {
  const name = (declaration as { name?: ts.Node }).name;
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return null;
}

/** A readable name for the declaration enclosing a node, e.g. `Service.send`. */
export function enclosingSymbol(node: ts.Node): string | null {
  const names: string[] = [];
  for (
    let current: ts.Node | undefined = node;
    current;
    current = current.parent
  ) {
    let name: string | null = null;
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isClassDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isClassExpression(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      name = current.name !== undefined ? memberName(current) : null;
    } else if (ts.isConstructorDeclaration(current)) {
      name = "constructor";
    } else if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      current.parent !== undefined &&
      (ts.isVariableDeclaration(current.parent) ||
        ts.isPropertyAssignment(current.parent) ||
        ts.isPropertyDeclaration(current.parent)) &&
      ts.isIdentifier(current.parent.name)
    ) {
      name = current.parent.name.text;
    }
    if (name !== null) names.unshift(name);
  }
  return names.length === 0 ? null : names.join(".");
}

export type DeclaredResolution =
  | {
      readonly ok: true;
      readonly node: FunctionNode;
      readonly file: ts.SourceFile;
    }
  | {
      readonly ok: false;
      readonly problem:
        | "declared_file_not_in_scan"
        | "declared_export_not_found"
        | "declared_export_not_a_function";
    };

/**
 * Resolve `{ path, export }` through the module's export table. Re-exports and
 * aliases are followed by the checker; a local function that merely has the
 * same name in another file is never matched.
 */
export function resolveDeclaredSymbol(
  checker: ts.TypeChecker,
  program: ts.Program,
  reader: RepositoryReader,
  analysable: ReadonlySet<string>,
  declared: DeclaredSymbol,
): DeclaredResolution {
  const file = program.getSourceFile(absoluteIn(reader.root, declared.path));
  if (file === undefined || !analysable.has(file.fileName)) {
    return { ok: false, problem: "declared_file_not_in_scan" };
  }
  // A CommonJS JavaScript file has no symbol "at" its location, but the
  // binder still gives the file a module symbol holding its exports.
  const moduleSymbol =
    checker.getSymbolAtLocation(file) ??
    (file as unknown as { symbol?: ts.Symbol }).symbol;
  const exports =
    moduleSymbol === undefined ? [] : checker.getExportsOfModule(moduleSymbol);
  let exported = exports.find((symbol) => symbol.name === declared.export);
  if (exported === undefined && moduleSymbol !== undefined) {
    // CommonJS `module.exports = { ... }` is an `export=` whose members are
    // the exported names.
    const assignment =
      exports.find((symbol) => symbol.name === "export=") ??
      moduleSymbol.exports?.get("export=" as ts.__String);
    exported =
      assignment === undefined
        ? undefined
        : checker.getTypeOfSymbol(assignment).getProperty(declared.export);
  }
  if (exported === undefined) {
    return { ok: false, problem: "declared_export_not_found" };
  }
  const node = functionOfSymbol(checker, exported);
  if (node === null) {
    return { ok: false, problem: "declared_export_not_a_function" };
  }
  return { ok: true, node, file: node.getSourceFile() };
}

/** The declaration a call resolves to, following aliases for functions. */
export function calledDeclaration(
  checker: ts.TypeChecker,
  call: ts.CallExpression | ts.NewExpression,
): ts.Declaration | undefined {
  const signature = checker.getResolvedSignature(call);
  const declaration = signature?.getDeclaration() as ts.Declaration | undefined;
  if (declaration !== undefined && !ts.isJSDocSignature(declaration)) {
    return declaration;
  }
  return undefined;
}

/** True for `any` (including unresolved error types). */
export function isAnyType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Any) !== 0;
}

/** The static text of a string-like expression, when the checker knows it. */
export function literalText(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): string | null {
  if (ts.isStringLiteralLike(expression)) return expression.text;
  const type = checker.getTypeAtLocation(expression);
  return type.isStringLiteral() ? type.value : null;
}

/** Member access path of a callee: `a.b.c(...)` → ["a", "b", "c"]. */
export function calleePath(expression: ts.Expression): string[] | null {
  const parts: string[] = [];
  let current: ts.Expression = expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    } else if (ts.isIdentifier(current)) {
      parts.unshift(current.text);
      return parts;
    } else if (
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
    } else if (current.kind === ts.SyntaxKind.ThisKeyword) {
      parts.unshift("this");
      return parts;
    } else {
      return parts.length === 0 ? null : parts;
    }
  }
}

/** Conservatively refuse object initializers with writes, aliases or escapes. */
export function constantObjectUnmodified(
  checker: ts.TypeChecker,
  declaration: ts.VariableDeclaration,
  use: ts.Node,
): boolean {
  const symbol = checker.getSymbolAtLocation(declaration.name);
  const statement = declaration.parent.parent;
  let unsafe =
    ts.isVariableStatement(statement) &&
    (statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ??
      false);
  const visit = (node: ts.Node): void => {
    if (unsafe) return;
    if (
      ts.isIdentifier(node) &&
      node !== declaration.name &&
      checker.getSymbolAtLocation(node) === symbol
    ) {
      let reference: ts.Node = node;
      while (
        reference.parent &&
        (ts.isPropertyAccessExpression(reference.parent) ||
          ts.isElementAccessExpression(reference.parent) ||
          ts.isParenthesizedExpression(reference.parent)) &&
        reference.parent.expression === reference
      )
        reference = reference.parent;
      const parent = reference.parent;
      const write =
        parent &&
        ((ts.isBinaryExpression(parent) &&
          parent.left === reference &&
          parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
          ts.isDeleteExpression(parent) ||
          ts.isPostfixUnaryExpression(parent) ||
          ts.isPrefixUnaryExpression(parent));
      const wholeObjectEscapes =
        reference === node &&
        !(
          parent === use &&
          (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
          parent.arguments?.includes(node)
        );
      if (write || wholeObjectEscapes) unsafe = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.getSourceFile());
  return !unsafe;
}

/**
 * Whether a declaration is in the global scope of a type declaration file:
 * the default library, a script (non-module) `.d.ts`, or a `declare global`
 * block. `@types/node` declares `fetch`, `console` and `Buffer` this way.
 */
export function isGlobalDeclaration(
  program: ts.Program,
  declaration: ts.Node,
): boolean {
  const file = declaration.getSourceFile();
  if (program.isSourceFileDefaultLibrary(file)) return true;
  if (!file.isDeclarationFile) return false;
  for (
    let current: ts.Node | undefined = declaration.parent;
    current !== undefined;
    current = current.parent
  ) {
    if (
      ts.isModuleDeclaration(current) &&
      (current.flags & ts.NodeFlags.GlobalAugmentation) !== 0
    )
      return true;
    if (ts.isModuleDeclaration(current) && ts.isStringLiteral(current.name))
      return false;
    if (ts.isSourceFile(current)) return !ts.isExternalModule(current);
  }
  return false;
}

/** The global name a declaration provides (`fetch`, `WebSocket`), or null. */
export function globalNameOf(
  program: ts.Program,
  declaration: ts.Node,
): string | null {
  if (!isGlobalDeclaration(program, declaration)) return null;
  const named =
    ts.isConstructorDeclaration(declaration) ||
    ts.isConstructSignatureDeclaration(declaration) ||
    ts.isCallSignatureDeclaration(declaration)
      ? (declaration.parent ?? declaration)
      : declaration;
  return memberName(named);
}

/** Type packages whose global declarations behave like the default library. */
export const GLOBAL_TYPE_PACKAGES: readonly string[] = [
  "@types/node",
  "undici-types",
  "@types/web",
  "bun-types",
];
