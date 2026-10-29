"use client";

import { useEffect, useMemo, useState } from "react";
import type { ModelOffer, ModelRelease } from "../../lib/model-catalog-db";

function compact(value: number | null) {
  return value === null
    ? "Unknown"
    : Intl.NumberFormat("en", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
}

export function ModelReleases({
  releases,
  onOpen,
}: {
  releases: ModelRelease[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [weights, setWeights] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = useMemo(
    () =>
      releases.filter((release) => {
        if (
          query &&
          !`${release.name} ${release.id} ${release.family ?? ""} ${release.description ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
          return false;
        if (weights === "open" && release.open_weights !== 1) return false;
        if (weights === "closed" && release.open_weights !== 0) return false;
        return true;
      }),
    [releases, query, weights],
  );
  const pageSize = 30;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <section className="mt-5" aria-label="Model releases">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Underlying model releases</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              These records describe a model independently of its provider
              offers. Release facts and benchmark claims come from Models.dev;
              each benchmark retains its original source link.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            {filtered.length.toLocaleString()} releases
          </span>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <label className="min-w-64 flex-1 text-xs font-medium text-slate-600">
            Search releases
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Name, family, description"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-blue-600"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Weights
            <select
              value={weights}
              onChange={(event) => {
                setWeights(event.target.value);
                setPage(1);
              }}
              className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              <option value="all">All</option>
              <option value="open">Open weights</option>
              <option value="closed">Closed weights</option>
            </select>
          </label>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((release) => (
          <button
            key={release.id}
            onClick={() => onOpen(release.id)}
            className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-900">{release.name}</h3>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500">
                  {release.id}
                </p>
                {release.model_type && (
                  <p className="mt-1 text-[11px] font-medium capitalize text-blue-700">
                    {release.model_type} model
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${release.open_weights === 1 ? "bg-green-50 text-green-800" : "bg-slate-100 text-slate-600"}`}
              >
                {release.open_weights === 1
                  ? "Open weights"
                  : release.open_weights === 0
                    ? "Closed weights"
                    : "Weights unknown"}
              </span>
            </div>
            {release.description && (
              <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-600">
                {release.description}
              </p>
            )}
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
              <div>
                <p className="text-slate-500">Released</p>
                <p className="mt-1 font-medium">
                  {release.release_date ?? "Unknown"}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Context</p>
                <p className="mt-1 font-medium">
                  {compact(release.context_tokens)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Benchmarks</p>
                <p className="mt-1 font-medium">{release.benchmarks.length}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
      {!visible.length && (
        <p className="mt-5 rounded-xl border border-slate-200 bg-white p-7 text-center text-sm text-slate-500">
          No releases match these filters.
        </p>
      )}
      <div className="mt-4 flex items-center justify-between text-xs text-slate-600">
        <span>
          Page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <button
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
            className="rounded border border-slate-300 px-3 py-2 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
            className="rounded border border-slate-300 px-3 py-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

export function ReleaseDetail({
  release,
  offers,
  onOffer,
  close,
}: {
  release: ModelRelease;
  offers: ModelOffer[];
  onOffer: (id: string) => void;
  close: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  const linkedOffers = offers.filter(
    (offer) => offer.canonical_model_id === release.id,
  );
  const facts = [
    ["Model type", release.model_type ?? "Generative"],
    ["Creator", release.creator],
    ["Family", release.family ?? "Unknown"],
    ["Released", release.release_date ?? "Unknown"],
    ["Last updated", release.last_updated ?? "Unknown"],
    [
      "Weights",
      release.open_weights === 1
        ? "Open"
        : release.open_weights === 0
          ? "Closed"
          : "Unknown",
    ],
    ["Weight license", release.weight_license ?? "Unknown"],
    ["Context", compact(release.context_tokens)],
    ["Max output", compact(release.max_output_tokens)],
    ["Input modalities", release.input_modalities.join(", ") || "Unknown"],
    ["Output modalities", release.output_modalities.join(", ") || "Unknown"],
  ];
  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-slate-950/45"
      role="presentation"
      onClick={close}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${release.name} release details`}
        onClick={(event) => event.stopPropagation()}
        className="h-full w-full max-w-2xl overflow-y-auto bg-white px-5 py-6 text-slate-900 shadow-2xl sm:px-8"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Model release
          </span>
          <button
            autoFocus
            onClick={close}
            className="rounded border border-slate-200 px-3 py-1 text-sm"
          >
            Close
          </button>
        </div>
        <h2 className="mt-5 text-2xl font-semibold">{release.name}</h2>
        <p className="mt-1 break-all font-mono text-xs text-slate-500">
          {release.id}
        </p>
        {release.description && (
          <p className="mt-4 text-sm leading-6 text-slate-700">
            {release.description}
          </p>
        )}
        <dl className="mt-6 divide-y divide-slate-100 border-y border-slate-100">
          {facts.map(([key, value]) => (
            <div key={key} className="grid grid-cols-2 gap-3 py-2.5 text-sm">
              <dt className="text-slate-500">{key}</dt>
              <dd className="break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-7 font-semibold">
          Provider offers ({linkedOffers.length})
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Only offers carrying this exact canonical model ID are linked.
        </p>
        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200">
          {linkedOffers.length ? (
            linkedOffers.map((offer) => (
              <button
                key={offer.id}
                onClick={() => onOffer(offer.id)}
                className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-blue-50"
              >
                <span className="truncate text-blue-700">
                  {offer.provider}: {offer.name}
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  {offer.input_usd_per_million === null
                    ? "Price unknown"
                    : `$${offer.input_usd_per_million}/M input`}
                </span>
              </button>
            ))
          ) : (
            <p className="p-4 text-sm text-slate-500">
              No exact offer link is recorded.
            </p>
          )}
        </div>
        <h3 className="mt-7 font-semibold">
          Reported benchmark results ({release.benchmarks.length})
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          These are claims recorded by Models.dev from linked upstream sources.
          Tasks, versions, and evaluation settings differ, so the scores are not
          normalized or ranked here.
        </p>
        <div className="mt-3 space-y-2">
          {release.benchmarks.map((benchmark, index) => (
            <div
              key={`${benchmark.name}-${index}`}
              className="rounded-lg border border-slate-200 p-3 text-sm"
            >
              <div className="flex justify-between gap-3">
                <span className="font-medium">
                  {benchmark.name}
                  {benchmark.variant ? ` · ${benchmark.variant}` : ""}
                </span>
                <span className="shrink-0 tabular-nums">
                  {benchmark.score} {benchmark.metric ?? ""}
                </span>
              </div>
              {benchmark.source_url && (
                <a
                  href={benchmark.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs text-blue-700 underline"
                >
                  Original source ↗
                </a>
              )}
            </div>
          ))}
        </div>
        <div className="mt-7 flex flex-col gap-2 text-sm">
          <a
            href={`/models?release=${encodeURIComponent(release.id)}`}
            className="text-blue-700 underline"
          >
            Permanent release link
          </a>
          {release.source_url && (
            <a
              href={release.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline"
            >
              Model source ↗
            </a>
          )}
          <a
            href="https://models.dev/models.json"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            Models.dev registry ↗
          </a>
        </div>
      </aside>
    </div>
  );
}
