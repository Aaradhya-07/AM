# Local model catalog

This package persists source snapshots from Anvilmark's Hugging Face and Artificial Analysis adapters in a local SQLite file. Every refresh appends a snapshot, including responses with no observations. It also records one normalized observation per benchmark, benchmark score, model evaluation, or model profile.

The catalog is a source history for model research. Public benchmark and index values do not satisfy a contract's workload quality gate. Model IDs remain scoped to their source; no name-based merge is inferred between Hugging Face and Artificial Analysis.

## Runtime

The package can be imported on the project's existing Node 20 baseline. Opening its SQLite store requires Node 24 or newer and reports a clear error on older versions. It uses Node's built-in `node:sqlite`, so no database server or native dependency is needed. A future deployed service can use these source snapshots as an ingestion boundary without putting database concerns in the contract engine.

## Example

```ts
import { fetchHuggingFaceLeaderboard } from "@anvilmark/adapters";
import {
  huggingFaceLeaderboardSourceKey,
  openModelCatalog,
} from "@anvilmark/model-catalog";

const catalog = await openModelCatalog(".anvilmark/model-catalog.sqlite");
try {
  const fetched = await fetchHuggingFaceLeaderboard("cais/hle");
  catalog.storeSnapshot(fetched);
  const key = huggingFaceLeaderboardSourceKey("cais/hle");
  const latest = catalog.getLatest(key);
  const history = catalog.getHistory(key, { limit: 10 });
  const observations = latest ? catalog.getObservations(latest.id) : [];
} finally {
  catalog.close();
}
```

`getLatest` returns `null` for a missing source. Reads report `fresh` or `stale` using a 24 hour default age, with an overrideable `maxAgeMs`. Future dated data is stale. Latest and history sort by source fetch time, then insertion ID, so a late import of old data does not replace the newest source result.

The stored payload includes only defined adapter result fields. Artificial Analysis usage rights and attribution travel with each snapshot; API keys are never part of the adapter result and are not stored. Keep Artificial Analysis Free API data for internal use with attribution unless you have separate redistribution rights.

Schema version 1 is checked on open. Unknown versions fail instead of silently rewriting data.
