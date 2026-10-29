# Local model catalog

This package persists source snapshots from Anvilmark's Hugging Face and Artificial Analysis adapters in a local SQLite file. Every refresh appends a snapshot, including responses with no observations. It also records one normalized observation per benchmark, benchmark score, model evaluation, or model profile.

The catalog is a source history for model research. Public benchmark and index values do not satisfy a contract's workload quality gate. Model IDs remain scoped to their source; no name-based merge is inferred between Hugging Face and Artificial Analysis.

The separate `DevelopmentConfigurationCatalog` stores append-only snapshots of exact coding-agent, model, and deployment offers in `.anvilmark/development/configurations.sqlite`. Provider, complete processing-region set, billing, and capability claims each carry a source reference, observation time, and expiry. A plan pins a snapshot hash. The selector treats missing, expired, research-only, or superseded hard facts as unknown. Importing a labeled claim does not independently verify its source.

The website's [model explorer](../web/app/models/page.tsx) opens a `development catalog list --json` export locally in the browser. It verifies hashes and displays source details without uploading account-specific facts. The [larger catalog design](../../docs/vnext/model-knowledge-catalog.md) describes the ingestion and public publishing path beyond this local slice.

The separate `DevelopmentEvidenceCatalog` stores a metadata-only index of coding-agent run outcomes in `.anvilmark/development/development-evidence.sqlite`. The development CLI rebuilds that index from archived task plans, runs, and exact reviews. It matches architecture part, task kind, language set, risk, configured agent/model identity, and exact configuration snapshot. Schema version 1 outcome indexes migrate to version 2 on open. A plan can explicitly reference a source-scoped model ID in the public research catalog; `development recommend --catalog-db FILE` shows the mapped source observations without treating them as a coding-task quality gate. A configured model remains distinct from a tool-reported served model.

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

Each store checks its schema version on open. Unknown versions fail instead of silently rewriting data.
