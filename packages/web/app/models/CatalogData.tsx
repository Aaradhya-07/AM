"use client";

import type {
  ModelCatalogPayload,
  ModelOffer,
} from "../../lib/model-catalog-db";

const sourceTitle: Record<string, string> = {
  arena: "Arena leaderboard dataset",
  litellm: "LiteLLM pricing registry",
  modelsdev_offers: "Models.dev provider offers",
  modelsdev_releases: "Models.dev model releases",
};

function countWhere(
  offers: ModelOffer[],
  predicate: (offer: ModelOffer) => boolean,
) {
  return offers.reduce((count, offer) => count + Number(predicate(offer)), 0);
}

export function CatalogData({ catalog }: { catalog: ModelCatalogPayload }) {
  const { offers, releases, sources } = catalog;
  const benchmarkCount = releases.reduce(
    (count, release) => count + release.benchmarks.length,
    0,
  );
  const checks = [
    {
      name: "Input token price",
      count: countWhere(
        offers,
        (offer) => offer.input_usd_per_million !== null,
      ),
    },
    {
      name: "Output token price",
      count: countWhere(
        offers,
        (offer) => offer.output_usd_per_million !== null,
      ),
    },
    {
      name: "Context window",
      count: countWhere(offers, (offer) => offer.max_input_tokens !== null),
    },
    {
      name: "Maximum output",
      count: countWhere(offers, (offer) => offer.max_output_tokens !== null),
    },
    {
      name: "Tool support",
      count: countWhere(offers, (offer) => offer.tools !== null),
    },
    {
      name: "Reasoning support",
      count: countWhere(offers, (offer) => offer.reasoning !== null),
    },
    {
      name: "Explicit release link",
      count: countWhere(offers, (offer) => offer.canonical_model_id !== null),
    },
  ];
  const types = [...new Set(offers.map((offer) => offer.mode))]
    .map((mode) => ({
      mode,
      count: countWhere(offers, (offer) => offer.mode === mode),
    }))
    .sort((a, b) => b.count - a.count);
  return (
    <section className="mt-5 space-y-5" aria-label="Catalog data health">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
          Data health
        </p>
        <h2 className="mt-2 text-2xl font-semibold">What is in the catalog</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Every number below comes from the bundled database snapshot. A
          provider offer is a listing served by one source. An underlying
          release is a separate model identity; offers are linked only when
          Models.dev supplies an explicit canonical ID.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-2xl font-semibold">
              {offers.length.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">Attributed provider offers</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-2xl font-semibold">
              {releases.length.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">Underlying model releases</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-2xl font-semibold">
              {benchmarkCount.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">
              Source linked benchmark claims
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-2xl font-semibold">
              {releases
                .filter((release) => release.open_weights === 1)
                .length.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">Open weight releases</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-2xl font-semibold">
              {catalog.arena_rating_count.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">Arena rating records</p>
          </div>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Field coverage</h3>
          <p className="mt-1 text-xs text-slate-500">
            Known values among all provider offers. Missing does not mean
            unsupported.
          </p>
          <div className="mt-5 space-y-4">
            {checks.map((check) => {
              const percent = Math.round(
                (check.count / Math.max(offers.length, 1)) * 100,
              );
              return (
                <div key={check.name}>
                  <div className="flex justify-between gap-2 text-xs">
                    <span>{check.name}</span>
                    <span className="tabular-nums text-slate-500">
                      {check.count.toLocaleString()} · {percent}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: percent + "%" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Listing types</h3>
          <p className="mt-1 text-xs text-slate-500">
            Source provided or derived from output modality.
          </p>
          <div className="mt-5 space-y-4">
            {types.map((type) => {
              const percent = Math.round(
                (type.count / Math.max(offers.length, 1)) * 100,
              );
              return (
                <div key={type.mode}>
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="capitalize">
                      {type.mode.replaceAll("_", " ")}
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {type.count.toLocaleString()} · {percent}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-slate-700"
                      style={{ width: percent + "%" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Sources and freshness</h3>
        <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {sources.map((source) => {
            const count =
              source.id === "modelsdev_releases"
                ? releases.length
                : source.id === "arena"
                  ? catalog.arena_rating_count
                  : countWhere(
                      offers,
                      (offer) => offer.source_id === source.id,
                    );
            return (
              <div
                key={source.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <h4 className="font-semibold">
                  {sourceTitle[source.id] ?? source.id}
                </h4>
                <p className="mt-1 text-2xl font-semibold">
                  {count.toLocaleString()}{" "}
                  <span className="text-xs font-normal text-slate-500">
                    records
                  </span>
                </p>
                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Checked</dt>
                    <dd className="text-right">
                      {new Date(source.fetched_at).toLocaleString()}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-500">Snapshot hash</dt>
                    <dd className="font-mono">{source.sha256.slice(0, 12)}…</dd>
                  </div>
                </dl>
                <div className="mt-4 flex gap-4 text-xs">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline"
                  >
                    Source ↗
                  </a>
                  <a
                    href={source.license_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 underline"
                  >
                    {source.license} license ↗
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">
          How updates arrive
        </h3>
        <ol className="mt-3 grid gap-3 md:grid-cols-3">
          <li className="rounded-lg bg-slate-50 p-4">
            <strong className="text-slate-900">1. Fetch</strong>
            <p className="mt-1 text-xs leading-5">
              A daily job downloads the three public sources and records source
              hashes and check times.
            </p>
          </li>
          <li className="rounded-lg bg-slate-50 p-4">
            <strong className="text-slate-900">2. Validate</strong>
            <p className="mt-1 text-xs leading-5">
              The import preserves IDs and units, checks database integrity, and
              excludes direct Artificial Analysis derived records.
            </p>
          </li>
          <li className="rounded-lg bg-slate-50 p-4">
            <strong className="text-slate-900">3. Review</strong>
            <p className="mt-1 text-xs leading-5">
              Changed snapshots are proposed in a pull request. The site reads
              the approved bundled snapshot.
            </p>
          </li>
        </ol>
        <p className="mt-4 text-xs leading-5">
          Arena supplies independent human preference ratings. This catalog
          still does not measure output speed, latency, or coding task success,
          time, and cost. Reported release benchmark claims retain source links
          and are not treated as a comparable leaderboard.{" "}
          <a
            href="https://artificialanalysiscdn.com/legal/ProDataPlatformTerms.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            Artificial Analysis data terms ↗
          </a>
        </p>
      </div>
    </section>
  );
}
