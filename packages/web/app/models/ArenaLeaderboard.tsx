"use client";

import { useEffect, useState } from "react";
import type { ArenaLeaderboardPayload, ArenaRating } from "../../lib/arena-db";

function display(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function precision(row: ArenaRating, value: number | null) {
  if (value === null) return "—";
  return row.score_kind === "rating"
    ? Math.round(value).toLocaleString()
    : value.toFixed(3);
}

export function ArenaLeaderboard() {
  const [config, setConfig] = useState("text");
  const [category, setCategory] = useState("overall");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ArenaLeaderboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      config,
      category,
      q: debouncedQuery,
      page: String(page),
    });
    setLoading(true);
    fetch("/api/arena?" + params, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Arena results could not be loaded.");
        return response.json() as Promise<ArenaLeaderboardPayload>;
      })
      .then((next) => {
        setData(next);
        setError(null);
        setLoading(false);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Arena results unavailable.",
        );
        setLoading(false);
      });
    return () => controller.abort();
  }, [config, category, debouncedQuery, page]);

  const rows = data?.rows ?? [];
  const top = rows.slice(0, 10);
  const min = Math.min(...top.map((row) => row.score));
  const max = Math.max(...top.map((row) => row.score));
  const pageCount = data
    ? Math.max(1, Math.ceil(data.total / data.page_size))
    : 1;
  function downloadCsv() {
    if (!data) return;
    const fields = [
      "rank",
      "model_name",
      "organization",
      "score",
      "score_lower",
      "score_upper",
      "score_kind",
      "sample_count",
      "sample_kind",
      "model_license",
      "published_date",
    ] as const;
    const cell = (value: string | number | null) =>
      '"' + String(value ?? "").replaceAll('"', '""') + '"';
    const csv = [
      fields.join(","),
      ...rows.map((row) => fields.map((field) => cell(row[field])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      "model-atlas-arena-" + config + "-" + category + "-page-" + page + ".csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mt-5 space-y-5" aria-label="Arena leaderboard">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
          Independent preference results
        </p>
        <h2 className="mt-2 text-2xl font-semibold">Arena leaderboards</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Browse Arena's current published rankings across text, agents, web
          development, vision, image, video, and other categories. Scores are
          shown with their published confidence intervals and sample counts.
        </p>
        {data && (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-2xl font-semibold">{data.configs.length}</p>
              <p className="text-xs text-slate-500">Leaderboard categories</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-2xl font-semibold">
                {data.total.toLocaleString()}
              </p>
              <p className="text-xs text-slate-500">
                Entries in this selection
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="text-2xl font-semibold">
                {rows[0]?.published_date ?? "—"}
              </p>
              <p className="text-xs text-slate-500">Published by Arena</p>
            </div>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-medium text-slate-600">
            Leaderboard
            <select
              value={config}
              onChange={(event) => {
                setConfig(event.target.value);
                setCategory("overall");
                setPage(1);
              }}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              {(data?.configs ?? [{ config: "text", overall_count: 0 }]).map(
                (entry) => (
                  <option value={entry.config} key={entry.config}>
                    {display(entry.config)}
                    {entry.overall_count
                      ? " (" + entry.overall_count + ")"
                      : ""}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Subcategory
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"
            >
              {(data?.categories ?? [{ category: "overall", count: 0 }]).map(
                (entry) => (
                  <option value={entry.category} key={entry.category}>
                    {display(entry.category)} ({entry.count})
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Search model or organization
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Name or organization"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-blue-600"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
          <span>
            Each leaderboard uses its own scale. Use the interval and sample
            count when comparing nearby ranks.
          </span>
          <button
            onClick={downloadCsv}
            disabled={!rows.length}
            className="font-medium text-blue-700 hover:underline disabled:opacity-40"
          >
            Download this page as CSV
          </button>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {loading && !data && (
        <p
          role="status"
          className="rounded-lg bg-white p-8 text-sm text-slate-600"
        >
          Loading Arena rankings…
        </p>
      )}
      {data && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="bg-slate-100 text-xs text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-3 py-3">Model</th>
                    <th className="px-3 py-3">Organization</th>
                    <th className="px-3 py-3">Score</th>
                    <th className="px-3 py-3">Confidence interval</th>
                    <th className="px-3 py-3">Samples</th>
                    <th className="px-3 py-3">Model license</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-blue-50/60">
                      <td className="px-4 py-3 font-semibold tabular-nums">
                        {row.rank ?? "—"}
                      </td>
                      <td className="px-3 py-3 font-medium">
                        {row.model_name}
                      </td>
                      <td className="px-3 py-3 text-slate-600">
                        {row.organization ?? "—"}
                      </td>
                      <td className="px-3 py-3 font-semibold tabular-nums">
                        {precision(row, row.score)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">
                        {precision(row, row.score_lower)}–
                        {precision(row, row.score_upper)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">
                        {row.sample_count?.toLocaleString() ?? "—"}{" "}
                        {row.sample_kind ?? ""}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600">
                        {row.model_license ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <p className="p-7 text-center text-sm text-slate-500">
                No entries match this selection.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
              <span>
                Page {data.page} of {pageCount} · {data.total.toLocaleString()}{" "}
                entries
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded border border-slate-300 px-3 py-2 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  disabled={page >= pageCount}
                  onClick={() => setPage(page + 1)}
                  className="rounded border border-slate-300 px-3 py-2 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold">
                First 10 on this page
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Bars show relative position within these ten scores; read exact
                values at right.
              </p>
              <div className="mt-5 space-y-3">
                {top.map((row) => (
                  <div key={row.id}>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="truncate" title={row.model_name}>
                        {row.model_name}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {precision(row, row.score)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{
                          width:
                            20 +
                            (80 * (row.score - min)) / (max - min || 1) +
                            "%",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 text-xs leading-5 text-slate-600 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900">
                Source and interpretation
              </h3>
              <p className="mt-2">
                Arena's{" "}
                <a
                  href={data.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 underline"
                >
                  official leaderboard dataset
                </a>{" "}
                is licensed{" "}
                <a
                  href={data.source.license_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-700 underline"
                >
                  CC BY 4.0
                </a>
                . This is an attributed adaptation of its latest published
                split, checked{" "}
                {new Date(data.source.fetched_at).toLocaleString()}.
              </p>
              <p className="mt-2">
                The agent leaderboard is a human preference score. It is not a
                coding task success rate, time per task, or API cost. Scores
                from different Arena leaderboards have different scales and
                should not be compared directly.
              </p>
              <p className="mt-2">
                Arena names are kept as published. They are not automatically
                matched to the provider offers in this catalog.
              </p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
