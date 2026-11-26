export interface SelfHostedModel {
  id: string;
  label: string;
  status: "loaded" | "loading" | "unloaded" | "unknown";
  contextLength?: number;
}

const knownLabels: Readonly<Record<string, string>> = {
  "qwen3.5-9b": "Qwen 3.5 9B",
  "gemma-4-12b": "Gemma 4 12B",
  "gpt-oss-20b": "GPT-OSS 20B",
  "gemma-4-26b-a4b": "Gemma 4 26B A4B",
  "qwen3-coder-30b-a3b": "Qwen 3 Coder 30B",
  "qwen3.8-27b": "Qwen 3.8 27B",
};

const modelIdPattern = /^[\w./:-]{1,120}$/;

export function formatSelfHostedModelLabel(id: string): string {
  const known = knownLabels[id.toLowerCase()];
  if (known) return known;
  const base = id
    .split("/")
    .pop()
    ?.replace(/\.gguf$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return base || id;
}

export function deriveModelsUrl(
  endpoint = process.env.ANVILMARK_PLANNER_ENDPOINT,
  explicitUrl = process.env.ANVILMARK_PLANNER_MODELS_URL,
): string | null {
  const explicit = explicitUrl?.trim();
  if (explicit) return explicit;
  const trimmed = endpoint?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.endsWith("/chat/completions")) {
      parsed.pathname = parsed.pathname.replace(
        /\/chat\/completions$/,
        "/models",
      );
    } else if (parsed.pathname.endsWith("/completions")) {
      parsed.pathname = parsed.pathname.replace(/\/completions$/, "/models");
    } else {
      parsed.pathname = "/v1/models";
    }
    parsed.search = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeStatus(value: unknown): SelfHostedModel["status"] {
  if (value === "loaded" || value === "loading" || value === "unloaded") {
    return value;
  }
  return "unknown";
}

export async function listSelfHostedModels(): Promise<SelfHostedModel[]> {
  const modelsUrl = deriveModelsUrl();
  if (!modelsUrl) return [];

  const preferred = process.env.ANVILMARK_PLANNER_MODEL?.trim() ?? "";
  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    const rawList =
      payload &&
      typeof payload === "object" &&
      "data" in payload &&
      Array.isArray(payload.data)
        ? payload.data
        : [];

    const seen = new Set<string>();
    const discovered: SelfHostedModel[] = [];
    for (const entry of rawList) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as {
        id?: unknown;
        status?: { value?: unknown };
        context_length?: unknown;
        meta?: { n_ctx?: unknown };
      };
      if (typeof record.id !== "string") continue;
      const id = record.id.trim();
      if (!id || !modelIdPattern.test(id) || seen.has(id)) continue;
      seen.add(id);

      const contextLength =
        typeof record.meta?.n_ctx === "number"
          ? record.meta.n_ctx
          : typeof record.context_length === "number"
            ? record.context_length
            : undefined;

      discovered.push({
        id,
        label: formatSelfHostedModelLabel(id),
        status: normalizeStatus(record.status?.value),
        ...(contextLength ? { contextLength } : {}),
      });
    }

    discovered.sort((left, right) => {
      const leftRank =
        left.status === "loaded" ? 0 : left.id === preferred ? 1 : 2;
      const rightRank =
        right.status === "loaded" ? 0 : right.id === preferred ? 1 : 2;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.label.localeCompare(right.label);
    });

    return discovered;
  } catch {
    return [];
  }
}
