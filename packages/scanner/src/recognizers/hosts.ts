/**
 * Where a provider endpoint goes, from its host name. This is recognizer
 * data: a literal URL in code (an SDK `baseURL`, a `fetch` target) is matched
 * against it, never guessed from variable or package names.
 *
 * A host that matches nothing is reported as unrecognized, not assumed to be
 * any provider.
 */

export interface ProviderHost {
  /** Exact host name, or a suffix starting with `.`. */
  readonly host: string;
  /** Destination provider id as used in contract candidates; null for local runtimes. */
  readonly provider: string | null;
  readonly deployment: "managed_api" | "local";
}

export const PROVIDER_HOSTS: readonly ProviderHost[] = [
  { host: "api.openai.com", provider: "openai", deployment: "managed_api" },
  {
    host: ".openai.azure.com",
    provider: "azure_openai",
    deployment: "managed_api",
  },
  {
    host: ".services.ai.azure.com",
    provider: "azure_openai",
    deployment: "managed_api",
  },
  {
    host: "api.anthropic.com",
    provider: "anthropic",
    deployment: "managed_api",
  },
  {
    host: "generativelanguage.googleapis.com",
    provider: "google",
    deployment: "managed_api",
  },
  { host: "api.groq.com", provider: "groq", deployment: "managed_api" },
  { host: "api.mistral.ai", provider: "mistral", deployment: "managed_api" },
  {
    host: "api.perplexity.ai",
    provider: "perplexity",
    deployment: "managed_api",
  },
  { host: "openrouter.ai", provider: "openrouter", deployment: "managed_api" },
  { host: "api.together.xyz", provider: "together", deployment: "managed_api" },
  { host: "api.together.ai", provider: "together", deployment: "managed_api" },
  { host: "api.deepseek.com", provider: "deepseek", deployment: "managed_api" },
  { host: "api.x.ai", provider: "xai", deployment: "managed_api" },
  {
    host: "api.fireworks.ai",
    provider: "fireworks",
    deployment: "managed_api",
  },
  { host: "api.cohere.com", provider: "cohere", deployment: "managed_api" },
  { host: "api.cohere.ai", provider: "cohere", deployment: "managed_api" },
  { host: "localhost", provider: null, deployment: "local" },
  { host: "127.0.0.1", provider: null, deployment: "local" },
  { host: "0.0.0.0", provider: null, deployment: "local" },
  { host: "[::1]", provider: null, deployment: "local" },
];

/** The host of an absolute http(s)/ws(s) URL prefix, or null when it is not one. */
export function hostOfUrl(text: string): string | null {
  const match = /^(?:https?|wss?):\/\/([^/?#]+)(?:[/?#]|$)/i.exec(text);
  if (match === null) return null;
  const authority = match[1] as string;
  const withoutUser = authority.slice(authority.lastIndexOf("@") + 1);
  const host = withoutUser.startsWith("[")
    ? withoutUser.slice(0, withoutUser.indexOf("]") + 1)
    : (withoutUser.split(":")[0] ?? "");
  return host === "" ? null : host.toLowerCase();
}

export function providerHost(
  hosts: readonly ProviderHost[],
  host: string,
): ProviderHost | null {
  return (
    hosts.find((entry) =>
      entry.host.startsWith(".")
        ? host.endsWith(entry.host)
        : host === entry.host,
    ) ?? null
  );
}
