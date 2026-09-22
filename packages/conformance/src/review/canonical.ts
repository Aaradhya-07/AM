type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * The canonical JSON that `@anvilmark/project-contract` hashes: keys sorted by
 * UTF-16 code unit, array order kept, `undefined` members dropped. Intended
 * for parsed JSON, where no other value types occur.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value as Json));
}
