import {
  BOUNDARY_RECOGNIZERS,
  PROVIDER_RECOGNIZERS,
  UNSUPPORTED_AI_SDKS,
} from "./builtin.js";
import type {
  BoundaryRecognizer,
  ModelFactory,
  OperationKind,
  ProviderOperation,
  ProviderRecognizer,
  UnsupportedSdkList,
} from "./types.js";

export * from "./types.js";
export * from "./builtin.js";
export * from "./hosts.js";

/** The recognizers one scan uses. */
export interface RecognizerSet {
  readonly providers: readonly ProviderRecognizer[];
  readonly boundaries: readonly BoundaryRecognizer[];
  readonly unsupported: UnsupportedSdkList;
}

export function defaultRecognizers(): RecognizerSet {
  return {
    providers: PROVIDER_RECOGNIZERS,
    boundaries: BOUNDARY_RECOGNIZERS,
    unsupported: UNSUPPORTED_AI_SDKS,
  };
}

/**
 * Restrict provider recognizers to the ids a configuration names. Boundary
 * recognizers are always on: turning one off would silently turn a known
 * unknown into nothing.
 */
export function selectRecognizers(
  base: RecognizerSet,
  ids: readonly string[] | null,
): { readonly set: RecognizerSet; readonly unknownIds: readonly string[] } {
  if (ids === null) return { set: base, unknownIds: [] };
  const known = new Set(base.providers.map((entry) => entry.id));
  return {
    set: {
      ...base,
      providers: base.providers.filter((entry) => ids.includes(entry.id)),
    },
    unknownIds: ids.filter((id) => !known.has(id)).sort(),
  };
}

export function providerForPackage(
  set: RecognizerSet,
  packageName: string | null,
): ProviderRecognizer | null {
  if (packageName === null) return null;
  return (
    set.providers.find((entry) => entry.packages.includes(packageName)) ?? null
  );
}

export function isUnsupportedSdk(
  set: RecognizerSet,
  packageName: string | null,
): boolean {
  if (packageName === null) return false;
  if (set.unsupported.packages.includes(packageName)) return true;
  const scope = packageName.startsWith("@") ? packageName.split("/")[0] : null;
  return scope !== null && scope !== undefined
    ? set.unsupported.scopes.includes(scope)
    : false;
}

export function boundaryFor(
  set: RecognizerSet,
  where: {
    readonly packageName: string | null;
    readonly ambientModule: string | null;
    readonly global: string | null;
  },
): BoundaryRecognizer | null {
  for (const recognizer of set.boundaries) {
    if (
      (where.packageName !== null &&
        recognizer.packages.includes(where.packageName)) ||
      (where.ambientModule !== null &&
        recognizer.ambientModules.includes(where.ambientModule)) ||
      (where.global !== null && recognizer.globals.includes(where.global))
    ) {
      return recognizer;
    }
  }
  return null;
}

/**
 * An explicitly listed operation. A class member matches by owner and
 * member; a module-level function (no owner) matches only operations that
 * list no owners.
 */
export function findOperation(
  recognizer: ProviderRecognizer,
  owner: string | null,
  member: string,
): ProviderOperation | null {
  return (
    recognizer.operations.find(
      (operation) =>
        operation.member === member &&
        (owner === null
          ? operation.owners.length === 0
          : operation.owners.includes(owner)),
    ) ?? null
  );
}

function camel(segment: string): string {
  return segment.replace(/-([a-z0-9])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

/**
 * The operation for a method declared under a recognizer's resource path,
 * e.g. `resources/beta/vector-stores/files.d.ts` + `create` →
 * `beta.vectorStores.files.create`. Returns null outside the resource path.
 */
export function resourceOperation(
  recognizer: ProviderRecognizer,
  pathInPackage: string,
  member: string,
  parameterNames: readonly string[],
): ProviderOperation | null {
  const methods = recognizer.resourceMethods;
  if (methods === undefined || !pathInPackage.startsWith(methods.pathPrefix))
    return null;
  if (methods.excludeMembers.includes(member) || member.startsWith("_"))
    return null;
  const segments = pathInPackage
    .slice(methods.pathPrefix.length)
    .replace(/\.d\.[cm]?ts$/, "")
    .split("/")
    .filter((segment) => segment !== "");
  if (segments.at(-1) === "index") segments.pop();
  if (
    segments.length >= 2 &&
    segments[segments.length - 1] === segments[segments.length - 2]
  )
    segments.pop();
  if (segments.length === 0) return null;
  const id = [...segments.map(camel), member].join(".");
  const match = methods.kinds.find((entry) =>
    new RegExp(entry.resource).test(id),
  );
  const kind: OperationKind = match?.kind ?? methods.defaultKind;
  const optionsIndex = parameterNames.findIndex((name) =>
    methods.optionsParameters.includes(name),
  );
  const sent = parameterNames
    .map((_, index) => index)
    .filter((index) => index !== optionsIndex);
  const payload =
    sent.find((index) =>
      ["body", "params", "query"].includes(parameterNames[index] ?? ""),
    ) ??
    sent.at(-1) ??
    0;
  return {
    id,
    owners: [],
    member,
    kind,
    payloadArgument: payload,
    sentArguments: sent.filter((index) => index !== payload),
    ...(optionsIndex === -1
      ? {}
      : {
          requestOptions: {
            argument: optionsIndex,
            bodyOverride: "body",
            sentProperties: ["headers", "query", "idempotencyKey"],
            localProperties: ["timeout", "maxRetries", "signal", "stream"],
          },
        }),
    modelProperty: match?.modelProperty ?? null,
    callPath: id.split("."),
  };
}

/** The model factory a package provides (Vercel AI SDK providers), if any. */
export function modelFactoryFor(
  set: RecognizerSet,
  packageName: string | null,
): { recognizer: ProviderRecognizer; factory: ModelFactory } | null {
  if (packageName === null) return null;
  for (const recognizer of set.providers) {
    const factory = recognizer.modelFactories?.find(
      (entry) => entry.package === packageName,
    );
    if (factory !== undefined) return { recognizer, factory };
  }
  return null;
}

/** Path of a file inside its npm package (`resources/chat/completions.d.ts`). */
export function pathInPackage(fileName: string): string | null {
  const parts = fileName.split(/[\\/]/);
  const index = parts.lastIndexOf("node_modules");
  if (index === -1) return null;
  const skip = parts[index + 1]?.startsWith("@") ? 3 : 2;
  const rest = parts.slice(index + skip);
  // Packages publish declarations at the root or under dist/ or src/.
  while (rest[0] === "dist" || rest[0] === "src" || rest[0] === "types")
    rest.shift();
  return rest.join("/");
}

export function recognizerVersions(
  set: RecognizerSet,
): { id: string; version: string; kind: string }[] {
  return [
    ...set.providers.map((entry) => ({
      id: entry.id,
      version: entry.version,
      kind: "provider",
    })),
    ...set.boundaries.map((entry) => ({
      id: entry.id,
      version: entry.version,
      kind: `boundary:${entry.boundary}`,
    })),
    {
      id: set.unsupported.id,
      version: set.unsupported.version,
      kind: "unsupported_sdks",
    },
  ].sort((left, right) => (left.id < right.id ? -1 : 1));
}
