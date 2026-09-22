import ts from "typescript";

import { classifyValue } from "@anvilmark/project-contract";

import type { RepositoryReader } from "./boundary.js";
import type { Span } from "./model.js";
import { compareSpans } from "./model.js";
import { spanOf } from "./program.js";
import type { CompilerSetup } from "./program.js";
import type {
  ModelFactory,
  OperationKind,
  ProviderOperation,
  ProviderRecognizer,
  RecognizerSet,
} from "./recognizers/index.js";
import {
  PROVIDER_HOSTS,
  findOperation,
  hostOfUrl,
  isUnsupportedSdk,
  modelFactoryFor,
  pathInPackage,
  providerForPackage,
  providerHost,
  resourceOperation,
} from "./recognizers/index.js";
import {
  calledDeclaration,
  constantObjectUnmodified,
  calleePath,
  enclosingSymbol,
  globalNameOf,
  isAnyType,
  literalText,
  memberName,
  ownerOf,
  packageOfFile,
  resolveAlias,
} from "./symbols.js";

/**
 * Semantic stage: compiler-resolved provider facts.
 *
 * - A client instantiation is a `new` expression whose class the checker
 *   resolves into a recognized package, or a call to a recognized model
 *   factory constructor (`createOpenAI(...)`).
 * - A provider call is a call whose resolved declaration is a recognized
 *   operation: a listed member, a method of an SDK resource class, a Vercel
 *   AI SDK function, or the global `fetch` with a literal URL whose host is a
 *   known AI provider. Aliased imports, re-exports, and stored member
 *   references resolve to the same declaration; a local class or function
 *   with the same name does not.
 * - Every provider call carries its endpoint: the default SDK endpoint, a
 *   literal host (mapped to a provider by host name, never by variable name),
 *   an endpoint chosen at run time, or an unlinked client.
 * - Strings, comments and template text are never inspected for providers;
 *   only URL literals passed to an endpoint option or `fetch` are read, and
 *   only for their host and path.
 * - Calls the checker cannot resolve are not provider calls. When they look
 *   like a recognized operation, or their receiver is selected at run time
 *   between providers, they become explicit unknowns.
 */

export type EndpointSelection =
  "default" | "literal_override" | "runtime_selected" | "unlinked";

export interface Endpoint {
  readonly selection: EndpointSelection;
  /** The host, when default or literal. */
  readonly host: string | null;
  /** Destination provider id; null when unknown, unrecognized or a local runtime of unknown kind. */
  readonly provider: string | null;
  readonly deployment: "managed_api" | "local" | null;
}

export type ClientLinkage =
  "client" | "clients" | "repository_uniform" | "factory" | "http" | "unlinked";

export interface ClientFact {
  readonly node: ts.NewExpression | ts.CallExpression;
  readonly span: Span;
  readonly symbol: string | null;
  readonly recognizer: ProviderRecognizer;
  readonly owner: string;
  readonly endpoint: Endpoint;
}

export type ModelReference =
  | { readonly kind: "literal"; readonly value: string }
  | { readonly kind: "redacted_suspected_secret" }
  | { readonly kind: "runtime_selected" }
  | { readonly kind: "absent" };

export interface ProviderCallFact {
  readonly node: ts.CallExpression;
  readonly span: Span;
  readonly symbol: string | null;
  readonly recognizer: ProviderRecognizer;
  readonly operation: ProviderOperation;
  readonly owner: string | null;
  readonly model: ModelReference;
  readonly client: ClientFact | null;
  readonly endpoint: Endpoint;
  readonly linkage: ClientLinkage;
}

export interface SemanticUnknown {
  readonly reason:
    | "unsupported_provider_sdk"
    | "possible_provider_operation_unresolved"
    | "runtime_selected_provider";
  readonly span: Span;
  readonly symbol: string | null;
  /** Package or recognizer ids involved; never source text. */
  readonly detail: readonly string[];
}

export interface EnvironmentVariableFact {
  readonly name: string;
  readonly span: Span;
}

export interface SemanticFacts {
  readonly clients: readonly ClientFact[];
  readonly calls: readonly ProviderCallFact[];
  readonly unknowns: readonly SemanticUnknown[];
  readonly environment: readonly EnvironmentVariableFact[];
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const UNLINKED: Endpoint = {
  selection: "unlinked",
  host: null,
  provider: null,
  deployment: null,
};

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function constInitializer(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): ts.Expression | null {
  if (!ts.isIdentifier(expression)) return null;
  const declaration = resolveAlias(
    checker,
    checker.getSymbolAtLocation(expression),
  )?.valueDeclaration;
  if (
    declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  )
    return unwrap(declaration.initializer);
  return null;
}

function objectLiteralFor(
  checker: ts.TypeChecker,
  expression: ts.Expression | undefined,
  use: ts.Node,
): ts.ObjectLiteralExpression | null {
  if (expression === undefined) return null;
  const inner = unwrap(expression);
  if (ts.isObjectLiteralExpression(inner)) return inner;
  if (ts.isIdentifier(inner)) {
    const declaration = resolveAlias(
      checker,
      checker.getSymbolAtLocation(inner),
    )?.valueDeclaration;
    if (
      declaration !== undefined &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer !== undefined &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const initializer = unwrap(declaration.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) return null;
      // `const` freezes the variable binding, not its object. Until a
      // call-site property analysis proves otherwise, aliases, escapes and
      // writes make the initializer unsuitable as a literal observation.
      return constantObjectUnmodified(checker, declaration, use)
        ? initializer
        : null;
    }
  }
  return null;
}

type PropertyLookup =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly value: ts.Expression | null };

function propertyOf(
  literal: ts.ObjectLiteralExpression,
  name: string,
): PropertyLookup {
  let found: PropertyLookup = { kind: "absent" };
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) {
      found = { kind: "present", value: null };
    } else if (
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)) &&
      memberName(property) === name
    ) {
      found = {
        kind: "present",
        value: ts.isPropertyAssignment(property)
          ? property.initializer
          : property.name,
      };
    } else if (
      ts.isPropertyAssignment(property) &&
      ts.isComputedPropertyName(property.name)
    ) {
      found = { kind: "present", value: null };
    }
  }
  return found;
}

function modelText(text: string): ModelReference {
  return classifyValue(text, "model").isSecret ||
    !/^[\w.:/@+-]{1,128}$/.test(text)
    ? { kind: "redacted_suspected_secret" }
    : { kind: "literal", value: text };
}

/** URL strings an expression can hold, when every one is statically known up to its path. */
function urlPrefixes(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  depth = 0,
): string[] | null {
  const inner = unwrap(expression);
  if (depth > 4) return null;
  const text = literalText(checker, inner);
  if (text !== null) return [text];
  if (ts.isTemplateExpression(inner)) return [inner.head.text];
  if (ts.isConditionalExpression(inner)) {
    const left = urlPrefixes(checker, inner.whenTrue, depth + 1);
    const right = urlPrefixes(checker, inner.whenFalse, depth + 1);
    return left === null || right === null ? null : [...left, ...right];
  }
  if (
    ts.isBinaryExpression(inner) &&
    inner.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return urlPrefixes(checker, inner.left, depth + 1);
  const initializer = constInitializer(checker, inner);
  return initializer === null
    ? null
    : urlPrefixes(checker, initializer, depth + 1);
}

/** The endpoint a literal URL option selects. */
function endpointForUrl(host: string, localProvider: string | null): Endpoint {
  const known = providerHost(PROVIDER_HOSTS, host);
  if (known === null)
    return {
      selection: "literal_override",
      host,
      provider: null,
      deployment: null,
    };
  return {
    selection: "literal_override",
    host,
    provider: known.deployment === "local" ? localProvider : known.provider,
    deployment: known.deployment,
  };
}

function endpointFromOptions(
  checker: ts.TypeChecker,
  argument: ts.Expression | undefined,
  use: ts.Node,
  options: readonly string[],
  defaults: Endpoint,
  required: boolean,
  localProvider: string | null,
): Endpoint {
  const runtime: Endpoint = {
    selection: "runtime_selected",
    host: null,
    provider: required ? defaults.provider : null,
    deployment: null,
  };
  if (argument === undefined) return required ? runtime : defaults;
  const literal = objectLiteralFor(checker, argument, use);
  if (literal === null) {
    const type = checker.getTypeAtLocation(argument);
    return options.some((option) => type.getProperty(option) !== undefined)
      ? runtime
      : required
        ? runtime
        : defaults;
  }
  let chosen: Endpoint | null = null;
  for (const option of options) {
    const property = propertyOf(literal, option);
    if (property.kind === "absent") continue;
    if (property.value === null) return runtime;
    const prefixes = urlPrefixes(checker, property.value);
    const hosts =
      prefixes === null ? null : prefixes.map((prefix) => hostOfUrl(prefix));
    if (hosts === null || hosts.some((host) => host === null)) return runtime;
    const distinct = [...new Set(hosts as string[])];
    if (distinct.length !== 1) return runtime;
    chosen = endpointForUrl(distinct[0] as string, localProvider);
  }
  if (chosen !== null) return chosen;
  return required ? runtime : defaults;
}

function sameEndpoint(left: Endpoint, right: Endpoint): boolean {
  return (
    left.selection === right.selection &&
    left.host === right.host &&
    left.provider === right.provider &&
    left.deployment === right.deployment
  );
}

/** One endpoint for several possible clients: the same, or chosen at run time. */
function combineEndpoints(endpoints: readonly Endpoint[]): Endpoint {
  const first = endpoints[0];
  if (first === undefined) return UNLINKED;
  if (endpoints.every((entry) => sameEndpoint(entry, first))) return first;
  const providers = new Set(endpoints.map((entry) => entry.provider));
  const deployments = new Set(endpoints.map((entry) => entry.deployment));
  return {
    selection: "runtime_selected",
    host: null,
    provider: providers.size === 1 ? (first.provider ?? null) : null,
    deployment: deployments.size === 1 ? (first.deployment ?? null) : null,
  };
}

function operationKindForPath(path: string): OperationKind {
  if (/\/embeddings\b/.test(path)) return "embedding";
  if (/\/(files|uploads)\b/.test(path)) return "data_upload";
  if (
    /\/(chat\/completions|completions|responses|messages|audio|images|moderations)\b|:(stream)?generateContent\b/i.test(
      path,
    )
  )
    return "inference";
  return "management";
}

function classDeclarationOfNew(
  checker: ts.TypeChecker,
  node: ts.NewExpression,
): ts.Declaration | undefined {
  const declaration = calledDeclaration(checker, node);
  if (declaration !== undefined) return declaration;
  const symbol = resolveAlias(
    checker,
    checker.getSymbolAtLocation(node.expression),
  );
  return symbol?.declarations?.find(
    (entry) => ts.isClassDeclaration(entry) || ts.isInterfaceDeclaration(entry),
  );
}

/** The provider recognizers a (possibly union) type's members come from. */
function providersOfType(
  recognizers: RecognizerSet,
  type: ts.Type,
): { providers: Set<string>; other: boolean } {
  const providers = new Set<string>();
  let other = false;
  const members = type.isUnion() ? type.types : [type];
  for (const member of members) {
    if ((member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0) {
      continue;
    }
    const declaration = (member.getSymbol() ?? member.aliasSymbol)
      ?.declarations?.[0];
    const provider = providerForPackage(
      recognizers,
      declaration === undefined
        ? null
        : packageOfFile(declaration.getSourceFile().fileName),
    );
    if (provider !== null) providers.add(provider.id);
    else other = true;
  }
  return { providers, other };
}

function parameterNames(declaration: ts.Declaration): string[] {
  const parameters = (
    declaration as { parameters?: ts.NodeArray<ts.ParameterDeclaration> }
  ).parameters;
  return (parameters ?? []).map((parameter) =>
    ts.isIdentifier(parameter.name) ? parameter.name.text : "",
  );
}

export function analyzeSemantics(
  setup: CompilerSetup,
  reader: RepositoryReader,
  recognizers: RecognizerSet,
): SemanticFacts {
  const { checker, program } = setup;
  const clients: ClientFact[] = [];
  const clientByNode = new Map<ts.Node, ClientFact>();
  const calls: ProviderCallFact[] = [];
  const unknowns: SemanticUnknown[] = [];
  const environment: EnvironmentVariableFact[] = [];
  const files = program
    .getSourceFiles()
    .filter((file) => setup.analysable.has(file.fileName));
  const httpRecognizers = recognizers.providers.filter(
    (entry) => entry.http !== undefined,
  );

  const importsRecognizedPackage = (file: ts.SourceFile): string[] => {
    const found = new Set<string>();
    const visit = (node: ts.Node) => {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        specifier = node.arguments[0];
      }
      if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
        const provider = recognizers.providers.find((entry) =>
          entry.packages.includes(specifier.text),
        );
        if (provider !== undefined) found.add(provider.id);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return [...found].sort();
  };

  const clientDefaults = (
    recognizer: ProviderRecognizer,
    client: ProviderRecognizer["clients"][number],
  ): Endpoint => ({
    selection: "default",
    host: recognizer.defaultHost,
    provider: client.provider ?? recognizer.defaultProvider,
    deployment: recognizer.defaultDeployment,
  });

  const factoryDefaults = (factory: ModelFactory): Endpoint => ({
    selection: "default",
    host: factory.defaultHost,
    provider: factory.provider,
    deployment: factory.deployment,
  });

  // Pass 1: client instantiations and model factory constructors.
  for (const file of files) {
    const path = reader.relative(file.fileName);
    const visit = (node: ts.Node) => {
      if (ts.isNewExpression(node)) {
        const declaration = classDeclarationOfNew(checker, node);
        const provider =
          declaration === undefined
            ? null
            : providerForPackage(
                recognizers,
                packageOfFile(declaration.getSourceFile().fileName),
              );
        const owner =
          declaration === undefined
            ? null
            : ts.isClassDeclaration(declaration) ||
                ts.isInterfaceDeclaration(declaration)
              ? (declaration.name?.text ?? null)
              : ownerOf(declaration);
        const client =
          provider === null || owner === null
            ? undefined
            : provider.clients.find((entry) => entry.owners.includes(owner));
        if (provider !== null && owner !== null && client !== undefined) {
          const fact: ClientFact = {
            node,
            span: spanOf(node, file, path),
            symbol: enclosingSymbol(node),
            recognizer: provider,
            owner,
            endpoint: endpointFromOptions(
              checker,
              node.arguments?.[0],
              node,
              client.endpointOptions,
              clientDefaults(provider, client),
              client.endpointRequired === true,
              provider.defaultDeployment === "local"
                ? provider.defaultProvider
                : null,
            ),
          };
          clients.push(fact);
          clientByNode.set(node, fact);
        } else if (declaration !== undefined) {
          const constructedPackage = packageOfFile(
            declaration.getSourceFile().fileName,
          );
          if (isUnsupportedSdk(recognizers, constructedPackage)) {
            unknowns.push({
              reason: "unsupported_provider_sdk",
              span: spanOf(node, file, path),
              symbol: enclosingSymbol(node),
              detail: [constructedPackage as string],
            });
          }
        }
      } else if (ts.isCallExpression(node)) {
        const declaration = calledDeclaration(checker, node);
        const packageName =
          declaration === undefined
            ? null
            : packageOfFile(declaration.getSourceFile().fileName);
        const found = modelFactoryFor(recognizers, packageName);
        const member =
          declaration === undefined ? null : memberName(declaration);
        if (
          found !== null &&
          member !== null &&
          found.factory.create.includes(member)
        ) {
          const fact: ClientFact = {
            node,
            span: spanOf(node, file, path),
            symbol: enclosingSymbol(node),
            recognizer: found.recognizer,
            owner: member,
            endpoint: endpointFromOptions(
              checker,
              node.arguments[0],
              node,
              found.factory.endpointOptions,
              factoryDefaults(found.factory),
              found.factory.endpointRequired === true,
              found.factory.deployment === "local"
                ? found.factory.provider
                : null,
            ),
          };
          clients.push(fact);
          clientByNode.set(node, fact);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  // Assignments to each symbol, found once per scanned file.
  const assignments = new Map<ts.Symbol, ts.Expression[]>();
  for (const file of files) {
    const visit = (node: ts.Node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const target = unwrap(node.left);
        const symbol = ts.isPropertyAccessExpression(target)
          ? checker.getSymbolAtLocation(target.name)
          : ts.isIdentifier(target)
            ? checker.getSymbolAtLocation(target)
            : undefined;
        if (symbol !== undefined)
          assignments.set(symbol, [
            ...(assignments.get(symbol) ?? []),
            node.right,
          ]);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  /** Clients an expression can hold: `null` when any possible value is not a client. */
  const clientsOf = (
    expression: ts.Expression,
    seen: Set<ts.Symbol>,
  ): ClientFact[] | null => {
    const inner = unwrap(expression);
    const direct = clientByNode.get(inner);
    if (direct !== undefined) return [direct];
    if (ts.isConditionalExpression(inner)) {
      const left = clientsOf(inner.whenTrue, seen);
      const right = clientsOf(inner.whenFalse, seen);
      return left === null || right === null ? null : [...left, ...right];
    }
    let symbol: ts.Symbol | undefined;
    if (ts.isIdentifier(inner)) symbol = checker.getSymbolAtLocation(inner);
    else if (
      ts.isPropertyAccessExpression(inner) &&
      inner.expression.kind === ts.SyntaxKind.ThisKeyword
    )
      symbol = checker.getSymbolAtLocation(inner.name);
    symbol = resolveAlias(checker, symbol);
    if (symbol === undefined || seen.has(symbol)) return null;
    seen.add(symbol);
    const sources: ts.Expression[] = [...(assignments.get(symbol) ?? [])];
    for (const declaration of symbol.declarations ?? []) {
      if (
        (ts.isVariableDeclaration(declaration) ||
          ts.isPropertyDeclaration(declaration)) &&
        declaration.initializer !== undefined
      )
        sources.push(declaration.initializer);
      else if (
        ts.isParameter(declaration) ||
        ts.isBindingElement(declaration) ||
        (!setup.analysable.has(declaration.getSourceFile().fileName) &&
          !ts.isVariableDeclaration(declaration) &&
          !ts.isPropertyDeclaration(declaration))
      )
        return null;
    }
    if (sources.length === 0) return null;
    const found: ClientFact[] = [];
    for (const source of sources) {
      const result = clientsOf(source, seen);
      if (result === null) return null;
      found.push(...result);
    }
    return found;
  };

  /** Endpoint of an SDK method call, from the client its receiver holds. */
  const linkReceiver = (
    receiverRoot: ts.Expression,
    recognizer: ProviderRecognizer,
  ): {
    client: ClientFact | null;
    endpoint: Endpoint;
    linkage: ClientLinkage;
  } => {
    // A client instance exported by the SDK package itself (`import ollama
    // from "ollama"`) uses the SDK's default endpoint.
    const rootSymbol = ts.isIdentifier(unwrap(receiverRoot))
      ? resolveAlias(checker, checker.getSymbolAtLocation(unwrap(receiverRoot)))
      : undefined;
    const rootDeclaration = rootSymbol?.valueDeclaration;
    if (
      rootDeclaration !== undefined &&
      recognizer.packages.includes(
        packageOfFile(rootDeclaration.getSourceFile().fileName) ?? "",
      ) &&
      recognizer.clients[0] !== undefined
    ) {
      return {
        client: null,
        endpoint: clientDefaults(recognizer, recognizer.clients[0]),
        linkage: "client",
      };
    }
    const linked = clientsOf(receiverRoot, new Set());
    if (linked !== null && linked.length > 0) {
      return {
        client: linked.length === 1 ? (linked[0] as ClientFact) : null,
        endpoint: combineEndpoints(linked.map((entry) => entry.endpoint)),
        linkage: linked.length === 1 ? "client" : "clients",
      };
    }
    const all = clients.filter((entry) => entry.recognizer === recognizer);
    if (all.length > 0) {
      const combined = combineEndpoints(all.map((entry) => entry.endpoint));
      if (combined.selection !== "runtime_selected")
        return {
          client: null,
          endpoint: combined,
          linkage: "repository_uniform",
        };
    }
    return { client: null, endpoint: UNLINKED, linkage: "unlinked" };
  };

  /** A Vercel AI SDK `model:` value: `openai("gpt-4o")`, `provider.chat("x")`. */
  const factoryModel = (
    value: ts.Expression | null,
  ): { model: ModelReference; endpoint: Endpoint; linkage: ClientLinkage } => {
    const runtime = {
      model: { kind: "runtime_selected" } as ModelReference,
      endpoint: UNLINKED,
      linkage: "unlinked" as ClientLinkage,
    };
    if (value === null) return runtime;
    let inner = unwrap(value);
    const initializer = constInitializer(checker, inner);
    if (initializer !== null) inner = initializer;
    if (!ts.isCallExpression(inner)) return runtime;
    const declaration = calledDeclaration(checker, inner);
    const packageName =
      declaration === undefined
        ? null
        : packageOfFile(declaration.getSourceFile().fileName);
    const found = modelFactoryFor(recognizers, packageName);
    if (found === null) return runtime;
    const argument = inner.arguments[0];
    const text = argument === undefined ? null : literalText(checker, argument);
    const model: ModelReference =
      text === null ? { kind: "runtime_selected" } : modelText(text);
    let root: ts.Expression = inner.expression;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    root = unwrap(root);
    const defaults = factoryDefaults(found.factory);
    if (ts.isIdentifier(root)) {
      const symbol = resolveAlias(checker, checker.getSymbolAtLocation(root));
      const rootDeclaration = symbol?.valueDeclaration;
      if (
        rootDeclaration !== undefined &&
        packageOfFile(rootDeclaration.getSourceFile().fileName) ===
          found.factory.package
      )
        return {
          model,
          endpoint:
            found.factory.endpointRequired === true
              ? { ...defaults, selection: "runtime_selected", host: null }
              : defaults,
          linkage: "factory",
        };
      const linked = clientsOf(root, new Set());
      if (linked !== null && linked.length > 0)
        return {
          model,
          endpoint: combineEndpoints(linked.map((entry) => entry.endpoint)),
          linkage: "factory",
        };
    } else if (ts.isCallExpression(root)) {
      const direct = clientByNode.get(root);
      if (direct !== undefined)
        return { model, endpoint: direct.endpoint, linkage: "factory" };
    }
    return { model, endpoint: UNLINKED, linkage: "unlinked" };
  };

  const modelReference = (
    operation: ProviderOperation,
    call: ts.CallExpression,
  ): ModelReference => {
    if (operation.modelProperty === null) return { kind: "absent" };
    let payload = call.arguments[operation.payloadArgument];
    const optionsMapping = operation.requestOptions;
    const options =
      optionsMapping === undefined
        ? undefined
        : call.arguments[optionsMapping.argument];
    if (optionsMapping !== undefined && options !== undefined) {
      const literal = objectLiteralFor(checker, options, call);
      if (literal === null) return { kind: "runtime_selected" };
      for (const property of literal.properties) {
        const name = memberName(property);
        if (
          name === null ||
          ![
            optionsMapping.bodyOverride,
            ...optionsMapping.sentProperties,
            ...optionsMapping.localProperties,
          ].includes(name)
        )
          return { kind: "runtime_selected" };
      }
      const override = propertyOf(literal, optionsMapping.bodyOverride);
      if (override.kind === "present") {
        if (override.value === null) return { kind: "runtime_selected" };
        payload = override.value;
      }
    }
    const literal = objectLiteralFor(checker, payload, call);
    if (literal === null) {
      return payload === undefined
        ? { kind: "absent" }
        : { kind: "runtime_selected" };
    }
    const property = propertyOf(literal, operation.modelProperty);
    if (property.kind === "absent") return { kind: "absent" };
    const text =
      property.value === null ? null : literalText(checker, property.value);
    return text === null ? { kind: "runtime_selected" } : modelText(text);
  };

  /** The model named in a `fetch` request body built with `JSON.stringify({ model })`. */
  const httpModel = (call: ts.CallExpression): ModelReference => {
    const init = call.arguments[1];
    if (init === undefined) return { kind: "absent" };
    const literal = objectLiteralFor(checker, init, call);
    if (literal === null) return { kind: "runtime_selected" };
    const body = propertyOf(literal, "body");
    if (body.kind === "absent") return { kind: "absent" };
    if (body.value === null) return { kind: "runtime_selected" };
    let value = unwrap(body.value);
    const initializer = constInitializer(checker, value);
    if (initializer !== null) value = initializer;
    if (!ts.isCallExpression(value)) return { kind: "runtime_selected" };
    const declaration = calledDeclaration(checker, value);
    if (
      declaration === undefined ||
      memberName(declaration) !== "stringify" ||
      globalNameOf(program, declaration.parent ?? declaration) !== "JSON"
    )
      return { kind: "runtime_selected" };
    const payload = objectLiteralFor(checker, value.arguments[0], value);
    if (payload === null) return { kind: "runtime_selected" };
    const model = propertyOf(payload, "model");
    if (model.kind === "absent") return { kind: "absent" };
    const text =
      model.value === null ? null : literalText(checker, model.value);
    return text === null ? { kind: "runtime_selected" } : modelText(text);
  };

  /** A global `fetch` to a literal AI provider URL, as a provider call. */
  const httpCall = (
    node: ts.CallExpression,
    declaration: ts.Declaration,
    span: Span,
    symbol: string | null,
  ): ProviderCallFact | null => {
    const name = globalNameOf(program, declaration);
    if (name === null) return null;
    const recognizer = httpRecognizers.find((entry) =>
      entry.http?.globals.includes(name),
    );
    const base = recognizer?.operations[0];
    const argument = node.arguments[0];
    if (
      recognizer === undefined ||
      base === undefined ||
      argument === undefined
    )
      return null;
    const prefixes = urlPrefixes(checker, argument);
    if (prefixes === null) return null;
    const hosts = prefixes.map((prefix) => hostOfUrl(prefix));
    if (hosts.some((host) => host === null)) return null;
    const known = hosts.map((host) =>
      providerHost(recognizer.http?.hosts ?? [], host as string),
    );
    if (known.some((entry) => entry === null)) return null;
    const providers = new Set(known.map((entry) => entry?.provider ?? null));
    const distinctHosts = [...new Set(hosts as string[])];
    const paths = prefixes.map((prefix) =>
      prefix.replace(/^[a-z]+:\/\/[^/?#]*/i, ""),
    );
    const kinds = [...new Set(paths.map(operationKindForPath))];
    const operation: ProviderOperation = {
      ...base,
      kind: kinds.length === 1 ? (kinds[0] as OperationKind) : "management",
    };
    return {
      node,
      span,
      symbol,
      recognizer,
      operation,
      owner: null,
      model: httpModel(node),
      client: null,
      endpoint: {
        selection: "literal_override",
        host: distinctHosts.length === 1 ? (distinctHosts[0] as string) : null,
        provider: providers.size === 1 ? ([...providers][0] ?? null) : null,
        deployment: "managed_api",
      },
      linkage: "http",
    };
  };

  // Pass 2: calls and environment variable names.
  for (const file of files) {
    const path = reader.relative(file.fileName);
    let fileProviders: string[] | null = null;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind !== ts.SyntaxKind.ImportKeyword
      ) {
        const declaration = calledDeclaration(checker, node);
        const packageName =
          declaration === undefined
            ? null
            : packageOfFile(declaration.getSourceFile().fileName);
        const provider = providerForPackage(recognizers, packageName);
        const span = spanOf(node, file, path);
        const symbol = enclosingSymbol(node);
        if (declaration !== undefined && provider !== null) {
          const owner = ownerOf(declaration);
          const member = memberName(declaration);
          const inPackage = pathInPackage(declaration.getSourceFile().fileName);
          const operation =
            member === null
              ? null
              : ((inPackage === null
                  ? null
                  : resourceOperation(
                      provider,
                      inPackage,
                      member,
                      parameterNames(declaration),
                    )) ?? findOperation(provider, owner, member));
          if (
            operation !== null &&
            (owner !== null || operation.owners.length === 0)
          ) {
            let linked: {
              client: ClientFact | null;
              endpoint: Endpoint;
              linkage: ClientLinkage;
              model?: ModelReference;
            };
            if (operation.modelValue === "provider_factory") {
              const payload = objectLiteralFor(
                checker,
                node.arguments[operation.payloadArgument],
                node,
              );
              const property =
                payload === null || operation.modelProperty === null
                  ? null
                  : propertyOf(payload, operation.modelProperty);
              const resolved = factoryModel(
                property === null || property.kind === "absent"
                  ? null
                  : property.value,
              );
              linked = { client: null, ...resolved };
            } else {
              let root: ts.Expression = node.expression;
              while (
                ts.isPropertyAccessExpression(root) &&
                !(
                  ts.isPropertyAccessExpression(root) &&
                  root.expression.kind === ts.SyntaxKind.ThisKeyword
                )
              ) {
                root = root.expression;
              }
              linked = linkReceiver(root, provider);
            }
            calls.push({
              node,
              span,
              symbol,
              recognizer: provider,
              operation,
              owner,
              model: linked.model ?? modelReference(operation, node),
              client: linked.client,
              endpoint: linked.endpoint,
              linkage: linked.linkage,
            });
          }
        } else if (declaration !== undefined && httpRecognizers.length > 0) {
          const http = httpCall(node, declaration, span, symbol);
          if (http !== null) calls.push(http);
          else if (isUnsupportedSdk(recognizers, packageName)) {
            unknowns.push({
              reason: "unsupported_provider_sdk",
              span,
              symbol,
              detail: [packageName as string],
            });
          }
        } else if (
          declaration !== undefined &&
          isUnsupportedSdk(recognizers, packageName)
        ) {
          unknowns.push({
            reason: "unsupported_provider_sdk",
            span,
            symbol,
            detail: [packageName as string],
          });
        } else if (declaration === undefined) {
          const receiver = ts.isPropertyAccessExpression(node.expression)
            ? node.expression.expression
            : null;
          let runtimeSelected = false;
          if (receiver !== null) {
            let root: ts.Expression = receiver;
            const candidates: ts.Expression[] = [receiver];
            while (ts.isPropertyAccessExpression(root)) {
              root = root.expression;
              candidates.push(root);
            }
            for (const candidate of candidates) {
              const { providers, other } = providersOfType(
                recognizers,
                checker.getTypeAtLocation(candidate),
              );
              if (providers.size >= 2 || (providers.size === 1 && other)) {
                unknowns.push({
                  reason: "runtime_selected_provider",
                  span,
                  symbol,
                  detail: [...providers].sort(),
                });
                runtimeSelected = true;
                break;
              }
            }
          }
          if (
            !runtimeSelected &&
            isAnyType(checker.getTypeAtLocation(node.expression))
          ) {
            const callee = calleePath(node.expression);
            if (callee !== null) {
              fileProviders ??= importsRecognizedPackage(file);
              const matches = recognizers.providers
                .filter((recognizer) =>
                  recognizer.operations.some((operation) => {
                    const tail = callee.slice(-operation.callPath.length);
                    const full =
                      operation.callPath.length >= 2 &&
                      tail.length === operation.callPath.length &&
                      tail.every(
                        (part, index) => part === operation.callPath[index],
                      );
                    const member =
                      fileProviders?.includes(recognizer.id) === true &&
                      callee[callee.length - 1] === operation.member;
                    return full || member;
                  }),
                )
                .map((recognizer) => recognizer.id);
              if (matches.length > 0) {
                unknowns.push({
                  reason: "possible_provider_operation_unresolved",
                  span,
                  symbol,
                  detail: matches.sort(),
                });
              }
            }
          }
        }
      }
      if (
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)
      ) {
        const target = node.expression;
        const isProcessEnv =
          ts.isPropertyAccessExpression(target) &&
          target.name.text === "env" &&
          ((ts.isIdentifier(target.expression) &&
            target.expression.text === "process") ||
            ts.isMetaProperty(target.expression));
        if (isProcessEnv) {
          const name = ts.isPropertyAccessExpression(node)
            ? node.name.text
            : ts.isStringLiteralLike(node.argumentExpression)
              ? node.argumentExpression.text
              : null;
          if (name !== null && ENV_NAME.test(name)) {
            environment.push({ name, span: spanOf(node, file, path) });
          }
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer !== undefined
      ) {
        const initializer = unwrap(node.initializer);
        if (
          ts.isPropertyAccessExpression(initializer) &&
          initializer.name.text === "env" &&
          ((ts.isIdentifier(initializer.expression) &&
            initializer.expression.text === "process") ||
            ts.isMetaProperty(initializer.expression))
        ) {
          for (const element of node.name.elements) {
            const name =
              element.propertyName !== undefined
                ? memberName({
                    name: element.propertyName,
                  } as unknown as ts.Node)
                : ts.isIdentifier(element.name)
                  ? element.name.text
                  : null;
            if (name !== null && ENV_NAME.test(name)) {
              environment.push({ name, span: spanOf(element, file, path) });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  return {
    clients: clients.sort((left, right) => compareSpans(left.span, right.span)),
    calls: calls.sort((left, right) => compareSpans(left.span, right.span)),
    unknowns: unknowns.sort(
      (left, right) =>
        compareSpans(left.span, right.span) ||
        (left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0),
    ),
    environment: environment.sort(
      (left, right) =>
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
        compareSpans(left.span, right.span),
    ),
  };
}
