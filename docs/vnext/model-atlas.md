# Model Atlas: catalog architecture and reference findings

## Product direction

`/models` is a separate, light research workbench. It prioritizes search, sortable comparisons, filters, charts, model and release detail, source links, and export. The old three fictional cards and local JSON upload page were removed.

The [Artificial Analysis models page](https://artificialanalysis.ai/models) informed the interaction inventory: searchable model navigation, category pages, model details, benchmark charts, chart controls, provider comparisons, and dense leaderboards. Its [coding agent page](https://artificialanalysis.ai/agents/coding-agents) separates score, task time, and task cost. Its [model leaderboard](https://artificialanalysis.ai/leaderboards/models) offers cross-metric table filtering. These are product patterns, not a source of data or copied assets.

The [Artificial Analysis API documentation](https://artificialanalysis.ai/api-reference) describes benchmark, speed, and pricing fields, but its current [Data Platform Terms](https://artificialanalysiscdn.com/legal/ProDataPlatformTerms.pdf) restrict use of its data in a competing public model-selection product. We therefore do not scrape, import, or republish that data. Intelligence, speed, latency, and coding-agent benchmark fields remain unmeasured until Anvilmark has its own results or another suitable licensed source.

Artificial Analysis publishes its methodology and exposes API data, but its private ingestion schedule and internal database design are not public. The likely pattern of recurring benchmarks and source refresh is an inference from its published fields and charts, not a verified description of its infrastructure.

## Database decision

The public directory uses **SQLite as a versioned read-only snapshot** on Node.js 24 or newer. The complete current database is `packages/web/data/models.sqlite`; it is bundled with the web server. This is a deliberate fit for thousands of mostly read-only listings: no shared database service or credentials are required, reads are indexed, and a refresh can be built atomically then reviewed as a pull request. SQLite is not intended to hold concurrent user edits or private account overlays. Those remain separate from this public snapshot.

| Table                | Purpose                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog_sources`    | Source URL, license, fetch time, content hash, and transform version.                                                                                                  |
| `providers`          | Provider identifier and display name.                                                                                                                                  |
| `model_releases`     | Models.dev canonical release ID, creator, family, date, open-weight status, modalities, and context.                                                                   |
| `model_benchmarks`   | Reported score, metric, variant, and original source URL attached to a release. These are not normalized or independently verified.                                    |
| `model_offers`       | Exact source offer ID, optional explicit canonical release ID, provider, modality, token/image/second prices, context, feature flags, upstream link, and raw row.      |
| `offer_metrics`      | Extensible independent metric observations with metric name, unit, source, and measurement date. Empty until a metric can be assigned to an exact offer.               |
| `arena_source_files` | Arena latest-split Parquet URL, hash, and size for each leaderboard configuration.                                                                                     |
| `arena_ratings`      | Arena model name, category, score, interval, samples, rank, and publication date. These remain separate from offers because name matching is not a safe identity join. |

The database separates a **provider offer** from its underlying **model release**. Models.dev's explicit `canonical_model_id` creates exact links where available. LiteLLM offers remain unlinked until identities are reviewed. We do not merge similarly named records. Per-account rates, residency, and agent compatibility need a private overlay rather than publication in this database.

## Source and refresh

The catalog combines [LiteLLM's model price and context registry](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) with the complete [Models.dev provider offers and model releases](https://github.com/anomalyco/models.dev/blob/dev/README.md), including its decision model type. Both repositories use MIT licenses ([LiteLLM](https://github.com/BerriAI/litellm/blob/main/LICENSE), [Models.dev](https://github.com/anomalyco/models.dev/blob/dev/LICENSE)); notices are included beside the database. The snapshot holds **13,000+ offers**, **600+ releases**, and **1,000+ source-linked benchmark records**; exact totals change with the feeds and appear on the page. Direct Artificial Analysis derived records are excluded, including from retained raw rows. The two sources retain separate provenance and exact source IDs. An offer appearing in both sources remains two attributed rows, not a silently combined record.

Source fields are preserved, absent values stay unknown, LiteLLM token prices are converted to USD per million tokens, and its listed per-image and per-second prices retain their source units. Models.dev chat prices are already USD per million tokens. Its image/audio/video cost structures are not presented as text-token prices; those entries stay unknown in the public token-price columns. Some upstream entries may lag provider documentation; the UI exposes the snapshot time and upstream link for review.

The independent leaderboard comes from [Arena's official leaderboard dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The included [attribution notice](../../packages/web/data/ARENA-NOTICE.txt) records the adaptation. The importer reads every `latest` Parquet configuration, including text, agent, vision, web development, image, video, and their subcategories. It stores source file hashes and published dates. The current snapshot has **30,000+ rating rows**. Arena scores and model names are not silently joined to provider offers. Arena agent scores measure human preference; they are not coding task success, time, or cost.

Run `node packages/web/scripts/refresh-model-catalog.mjs` from the repository root to download, validate, and atomically replace the SQLite snapshot. `--input path/to/litellm.json`, `--modelsdev-offers-input path/to/api.json`, `--modelsdev-releases-input path/to/models.json`, and `--arena-meta-input path/to/parquet-list.json` support local source inputs; individual Arena files accept `--arena-<config>-input path/to/file.parquet`. The script skips unchanged source hashes, checks database integrity, and rejects implausibly small imports. `.github/workflows/refresh-model-catalog.yml` checks daily and opens or updates a pull request when the sources change. Publishing new data therefore goes through review. The site reads the bundled snapshot; it does not fetch upstream feeds on every page visit.

## Present capabilities and boundaries

- Search across 13,000+ attributed provider listings, filter provider, mode, deprecation, capability, context, and price; sort and page through the directory.
- Browse 600+ underlying releases by name and open-weight status; inspect dates, modalities, exact-linked provider offers, and source-linked benchmark claims.
- Browse 24 Arena leaderboards and subcategories with ranks, scores, confidence intervals, sample counts, search, pagination, and CSV export.
- Inspect source freshness, snapshot hashes, listing types, and field coverage in the Data & method view.
- Compare up to four provider offers with adjustable token counts and a transparent task-cost estimate.
- Explore input/output token price against context/output limits in a canvas chart that can draw the full filtered set, highlight the two-axis price-capacity frontier, and export a PNG. Browse filtered price and context rankings and download the filtered catalog as CSV.
- Inspect each listing's source, snapshot date, unknown fields, deprecation note, and permanent link.
- Arena supplies independent human-preference rankings. The catalog still has no independently measured output speed, latency, or coding-agent task success/time/cost. The schema accepts such measurements when Anvilmark can produce or publish them legitimately. Models.dev's reported benchmark claims are shown only on release detail with their source links; they are not ranked as comparable results.

Future scale decisions should follow measured demand. When the data becomes actively edited by multiple users or needs high write concurrency, move the same source/offer/metric model to PostgreSQL; the current tens of thousands of read-mostly rows do not need that operational dependency.
