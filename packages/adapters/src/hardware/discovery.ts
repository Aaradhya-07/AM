import { withAbort } from "./bounded.js";
import { sanitizeText } from "../sanitize.js";
import { request } from "node:http";

export interface EndpointInventory {
  endpoint: string;
  kind: "ollama_installed" | "ollama_loaded" | "openai_compatible_listing";
  status:
    | "available"
    | "empty"
    | "unreachable"
    | "timed_out"
    | "authentication_required"
    | "redirect_refused"
    | "malformed"
    | "too_large"
    | "http_error"
    | "cancelled";
  models: string[];
  caveat: string;
}
const PORTS = [11434, 8000, 8080, 8001, 1234];
export const DISCOVERY_ENDPOINTS = ["127.0.0.1", "[::1]"].flatMap((host) =>
  PORTS.flatMap((port) =>
    port === 11434
      ? [`http://${host}:${port}/api/tags`, `http://${host}:${port}/api/ps`]
      : [`http://${host}:${port}/v1/models`],
  ),
);
export type InventoryFetch = (
  url: string,
  signal: AbortSignal,
) => Promise<{ status: number; body: string }>;
/** node:http uses no ambient proxy and never follows redirects. Destinations are fixed literal loopback. */
export const fetchInventory: InventoryFetch = (url, signal) =>
  new Promise((resolve, reject) => {
    if (!DISCOVERY_ENDPOINTS.includes(url)) {
      reject(new Error("destination_denied"));
      return;
    }
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const req = request(
      url,
      { method: "GET", headers: { Accept: "application/json" }, signal },
      (response) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_048_576) {
            req.destroy(new Error("too_large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        response.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
export async function discoverLocalModels(
  options: {
    signal?: AbortSignal;
    fetch?: InventoryFetch;
    timeoutMs?: number;
  } = {},
): Promise<EndpointInventory[]> {
  const timeout = options.timeoutMs ?? 5000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 5000)
    throw new Error("Discovery total deadline must be 1–5000 ms");
  const total = new AbortController();
  const timer = setTimeout(() => total.abort(), timeout);
  const signal = options.signal
    ? AbortSignal.any([total.signal, options.signal])
    : total.signal;
  const results: EndpointInventory[] = [];
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (next < DISCOVERY_ENDPOINTS.length) {
          const endpoint = DISCOVERY_ENDPOINTS[next++]!;
          const perRequest = new AbortController();
          const requestTimer = setTimeout(
            () => perRequest.abort(),
            Math.min(2000, timeout),
          );
          const limited = AbortSignal.any([signal, perRequest.signal]);
          const item: EndpointInventory = {
            endpoint,
            kind: endpoint.endsWith("/api/tags")
              ? "ollama_installed"
              : endpoint.endsWith("/api/ps")
                ? "ollama_loaded"
                : "openai_compatible_listing",
            status: "unreachable",
            models: [],
            caveat:
              "An inventory response does not prove local execution, artifact identity, readiness, GPU placement, or available memory.",
          };
          try {
            if (limited.aborted) throw new Error("cancelled");
            const response = await withAbort(
              (options.fetch ?? fetchInventory)(endpoint, limited),
              limited,
            );
            if (response.status === 401 || response.status === 403)
              item.status = "authentication_required";
            else if (response.status >= 300 && response.status < 400)
              item.status = "redirect_refused";
            else if (response.status !== 200) item.status = "http_error";
            else if (Buffer.byteLength(response.body) > 1_048_576)
              item.status = "too_large";
            else {
              const body = JSON.parse(response.body) as Record<string, unknown>;
              const rows =
                item.kind === "openai_compatible_listing"
                  ? body.data
                  : body.models;
              if (!Array.isArray(rows) || rows.length > 256)
                throw new Error("malformed");
              item.models = rows.map((row) => {
                if (typeof row !== "object" || row === null)
                  throw new Error("malformed");
                const id =
                  item.kind === "openai_compatible_listing" ? row.id : row.name;
                if (
                  typeof id !== "string" ||
                  id.length < 1 ||
                  id.length > 256 ||
                  Array.from(id).some((ch) => ch.charCodeAt(0) < 32)
                )
                  throw new Error("malformed");
                return sanitizeText(id).text;
              });
              item.status = item.models.length ? "available" : "empty";
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : "";
            item.status = options.signal?.aborted
              ? "cancelled"
              : limited.aborted
                ? "timed_out"
                : reason === "too_large"
                  ? "too_large"
                  : reason === "malformed" || error instanceof SyntaxError
                    ? "malformed"
                    : "unreachable";
          } finally {
            clearTimeout(requestTimer);
            results.push(item);
          }
        }
      }),
    );
  } finally {
    clearTimeout(timer);
  }
  return results.sort((a, b) => (a.endpoint < b.endpoint ? -1 : 1));
}
