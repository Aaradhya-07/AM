import type { ProviderHost } from "./hosts.js";

/**
 * Recognizers carry all provider and library knowledge. The analysis stages
 * never mention a provider by name; they ask recognizers whether a
 * compiler-resolved declaration belongs to something they know.
 *
 * A declaration matches only by where the compiler resolved it: the package
 * that contains the declaration file, its path inside that package, the class
 * or interface that owns the member, and the member name. Text at the call
 * site — an import alias, a local variable name, a comment, a string — never
 * matches.
 */

/**
 * What an operation sends to the provider.
 *
 * - `inference` and `embedding` invoke a model;
 * - `data_upload` sends files or documents to be stored by the provider;
 * - `management` reads or changes provider-side resources (assistants,
 *   vector stores, sessions) and may still carry user content.
 */
export type OperationKind =
  "inference" | "embedding" | "data_upload" | "management";

export interface ProviderOperation {
  /** Stable operation id, e.g. `chat.completions.create`. */
  readonly id: string;
  /**
   * Owning class/interface names as they appear in the package's
   * declarations. Empty for a module-level function (e.g. `streamText`).
   */
  readonly owners: readonly string[];
  readonly member: string;
  readonly kind: OperationKind;
  /** The argument that carries the request payload sent to the provider. */
  readonly payloadArgument: number;
  /** Further arguments transmitted as-is (path parameters, URLs). */
  readonly sentArguments?: readonly number[];
  /** Additional request-input mapping, never a blanket "all arguments sent". */
  readonly requestOptions?: {
    readonly argument: number;
    readonly bodyOverride: string;
    readonly sentProperties: readonly string[];
    readonly localProperties: readonly string[];
  };
  /** Property of the payload naming the model, if the operation has one. */
  readonly modelProperty: string | null;
  /**
   * How the model property is written: a string (`model: "gpt-4o"`) or a
   * provider factory call (`model: openai("gpt-4o")`, Vercel AI SDK).
   */
  readonly modelValue?: "string" | "provider_factory";
  /**
   * The member path an unresolved (`any`) call would have, used only to flag
   * a POSSIBLE operation as an unknown — never to claim a call.
   */
  readonly callPath: readonly string[];
}

/**
 * Operations derived from an SDK's resource classes rather than listed one by
 * one: any method declared under `pathPrefix` in the package, except the
 * listed members. Its id is the resource path plus the member
 * (`beta/vector-stores/files.d.ts` + `create` → `beta.vectorStores.files.create`).
 * Parameters named in `optionsParameters` are local request options; every
 * other parameter is sent.
 */
export interface ResourceMethods {
  readonly pathPrefix: string;
  readonly excludeMembers: readonly string[];
  readonly optionsParameters: readonly string[];
  /** First matching entry wins; `resource` is a regular expression source over the derived operation id. */
  readonly kinds: readonly {
    readonly resource: string;
    readonly kind: OperationKind;
    readonly modelProperty: string | null;
  }[];
  readonly defaultKind: OperationKind;
}

export interface ModelFactory {
  readonly package: string;
  /** Destination provider; null when it is configured at run time (e.g. OpenAI-compatible). */
  readonly provider: string | null;
  readonly deployment: "managed_api" | "local";
  readonly defaultHost: string | null;
  /** Factory constructors whose first argument may set the endpoint. */
  readonly create: readonly string[];
  readonly endpointOptions: readonly string[];
  /** Constructors that always need a configured endpoint (never "default"). */
  readonly endpointRequired?: boolean;
}

export interface ProviderRecognizer {
  readonly kind: "provider";
  readonly id: string;
  readonly version: string;
  /** The SDK vendor. The destination provider is resolved from the endpoint. */
  readonly provider: string;
  /**
   * Where the SDK's default endpoint runs. `managed_api`: a remote provider;
   * `local`: a runtime on this machine by default. An endpoint option set in
   * code is resolved separately, because it can change either.
   */
  readonly defaultDeployment: "managed_api" | "local";
  /** The default endpoint host, when the SDK has one. */
  readonly defaultHost: string | null;
  /** The destination provider of the default endpoint. */
  readonly defaultProvider: string | null;
  readonly packages: readonly string[];
  readonly clients: readonly {
    readonly owners: readonly string[];
    /** Constructor option names that select the endpoint. */
    readonly endpointOptions: readonly string[];
    /** Clients whose endpoint is always configured (e.g. Azure): never "default". */
    readonly endpointRequired?: boolean;
    /** Destination provider for this client class when it differs from the recognizer's. */
    readonly provider?: string;
  }[];
  readonly operations: readonly ProviderOperation[];
  readonly resourceMethods?: ResourceMethods;
  /** Vercel AI SDK style providers: a factory call returns a model bound to a provider. */
  readonly modelFactories?: readonly ModelFactory[];
  /**
   * HTTP functions recognized as provider calls when their URL is a literal
   * (or a template with a literal origin) whose host is in `hosts`.
   */
  readonly http?: {
    readonly globals: readonly string[];
    readonly hosts: readonly ProviderHost[];
  };
  /** Conventional environment variable NAMES; values are never read. */
  readonly environmentVariables: readonly string[];
  /** What the recognizer was written against, for the README and artifact. */
  readonly basis: string;
}

export type BoundaryKind =
  "queue" | "database" | "event" | "network" | "process";

/**
 * A library the flow model does not follow: data handed to it, and data it
 * hands back (including through callbacks), becomes an explicit unknown.
 */
export interface BoundaryRecognizer {
  readonly kind: "boundary";
  readonly id: string;
  readonly version: string;
  readonly boundary: BoundaryKind;
  /** npm packages whose declarations mark the boundary. */
  readonly packages: readonly string[];
  /** Ambient module names (e.g. `node:events`) declared by type packages. */
  readonly ambientModules: readonly string[];
  /** Global functions and classes (e.g. `fetch`), from the default library or global type declarations. */
  readonly globals: readonly string[];
}

/** AI SDKs that exist but have no recognizer: calls into them are unknowns. */
export interface UnsupportedSdkList {
  readonly kind: "unsupported_sdks";
  readonly id: string;
  readonly version: string;
  readonly packages: readonly string[];
  readonly scopes: readonly string[];
}

export type Recognizer =
  BoundaryRecognizer | ProviderRecognizer | UnsupportedSdkList;
