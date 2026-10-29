"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ModelCatalogPayload,
  ModelOffer,
} from "../../lib/model-catalog-db";
import { CatalogData } from "./CatalogData";
import { ArenaLeaderboard } from "./ArenaLeaderboard";
import { ModelReleases, ReleaseDetail } from "./ModelReleases";

type SortKey =
  | "name"
  | "provider"
  | "max_input_tokens"
  | "input_usd_per_million"
  | "output_usd_per_million";
type View =
  | "directory"
  | "releases"
  | "rankings"
  | "landscape"
  | "compare"
  | "arena"
  | "data";
const PAGE_SIZE = 50;
const registryUrl =
  "https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json";

function money(value: number | null) {
  if (value === null) return "—";
  if (value === 0) return "$0";
  return `$${value < 0.01 ? value.toPrecision(2) : value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function otherPrice(offer: ModelOffer) {
  if (offer.output_usd_per_image !== null)
    return `${money(offer.output_usd_per_image)}/image`;
  if (offer.output_usd_per_second !== null)
    return `${money(offer.output_usd_per_second)}/s output`;
  if (offer.input_usd_per_second !== null)
    return `${money(offer.input_usd_per_second)}/s input`;
  return "—";
}

function tokens(value: number | null) {
  if (value === null) return "—";
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function flag(value: number | null) {
  return value === 1 ? "Yes" : value === 0 ? "No" : "Unknown";
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function snapshotTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

function ModelNav({
  offers,
  view,
  onView,
  onSelect,
}: {
  offers: ModelOffer[];
  view: View;
  onView: (view: View) => void;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const matches = offers
    .filter(
      (offer) =>
        offer.mode === "chat" &&
        `${offer.name} ${offer.provider}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .slice(0, 36);
  const navigate = (next: View) => {
    onView(next);
    setOpen(false);
    document
      .getElementById("catalog-content")
      ?.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <div className="relative z-30 border-b border-slate-200 bg-[#f5f6f7]">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8 lg:px-10">
        <div className="flex items-center gap-8">
          <a
            href="/models"
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold tracking-tight text-white"
          >
            ◈ &nbsp;Model Atlas
          </a>
          <nav
            aria-label="Catalog navigation"
            className="flex flex-wrap items-center gap-1 text-sm"
          >
            <button
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              className={`rounded-full px-3 py-2 ${open || view === "directory" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-200"}`}
            >
              Models <span aria-hidden="true">⌄</span>
            </button>
            <button
              onClick={() => navigate("releases")}
              className={`rounded-full px-3 py-2 ${view === "releases" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-200"}`}
            >
              Releases
            </button>
            <button
              onClick={() => navigate("landscape")}
              className={`rounded-full px-3 py-2 ${view === "landscape" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-200"}`}
            >
              Charts
            </button>
            <button
              onClick={() => navigate("rankings")}
              className={`rounded-full px-3 py-2 ${view === "rankings" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-200"}`}
            >
              Rankings
            </button>
            <button
              onClick={() => navigate("arena")}
              className={`rounded-full px-3 py-2 ${view === "arena" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-200"}`}
            >
              Arena
            </button>
            <button
              onClick={() => navigate("compare")}
              className={`rounded-full px-3 py-2 ${view === "compare" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-200"}`}
            >
              Compare
            </button>
            <button
              onClick={() => navigate("data")}
              className={`rounded-full px-3 py-2 ${view === "data" ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-slate-200"}`}
            >
              Data & method
            </button>
          </nav>
        </div>
        <a
          href="/"
          className="text-xs text-slate-600 underline underline-offset-4 hover:text-slate-950"
        >
          Anvilmark home ↗
        </a>
      </div>
      {open && (
        <div className="absolute left-1/2 top-full w-[min(1400px,calc(100vw-24px))] -translate-x-1/2 rounded-b-2xl border border-slate-200 bg-[#eeeeef] p-4 shadow-2xl sm:p-6">
          <div className="grid gap-5 md:grid-cols-[215px_1fr]">
            <div className="border-b border-slate-300 pb-3 md:border-b-0 md:border-r md:pb-0 md:pr-5">
              <p className="mb-3 text-sm font-semibold">Explore</p>
              <div className="space-y-1 text-sm text-slate-600">
                <button
                  onClick={() => navigate("directory")}
                  className="block w-full rounded-md px-2 py-2 text-left hover:bg-white"
                >
                  All model listings
                </button>
                <button
                  onClick={() => navigate("releases")}
                  className="block w-full rounded-md px-2 py-2 text-left hover:bg-white"
                >
                  Model releases
                </button>
                <button
                  onClick={() => navigate("rankings")}
                  className="block w-full rounded-md px-2 py-2 text-left hover:bg-white"
                >
                  Price & context rankings
                </button>
                <button
                  onClick={() => navigate("landscape")}
                  className="block w-full rounded-md px-2 py-2 text-left hover:bg-white"
                >
                  Price & context chart
                </button>
                <button
                  onClick={() => navigate("compare")}
                  className="block w-full rounded-md px-2 py-2 text-left hover:bg-white"
                >
                  Side by side
                </button>
                <a
                  href="#method"
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-2 py-2 hover:bg-white"
                >
                  Sources & refresh
                </a>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">
                Find a model
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search the catalog"
                  className="mt-1 w-full border-b border-slate-300 bg-transparent px-1 py-2 text-sm outline-none focus:border-slate-900"
                />
              </label>
              <div className="mt-4 grid max-h-[480px] grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {matches.map((offer) => (
                  <button
                    key={offer.id}
                    onClick={() => {
                      onSelect(offer.id);
                      setOpen(false);
                    }}
                    className="truncate rounded-md px-2 py-2 text-left text-sm text-slate-600 hover:bg-white hover:text-slate-950"
                    title={offer.name}
                  >
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-600" />
                    {offer.name}
                  </button>
                ))}
              </div>
              {!matches.length && (
                <p className="py-5 text-sm text-slate-500">
                  No matching models.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function pricePerTask(
  offer: ModelOffer,
  inputTokens: number,
  outputTokens: number,
) {
  if (
    offer.input_usd_per_million === null ||
    offer.output_usd_per_million === null
  )
    return null;
  return (
    (offer.input_usd_per_million * inputTokens +
      offer.output_usd_per_million * outputTokens) /
    1_000_000
  );
}

function SortHead({
  name,
  sort,
  direction,
  onSort,
  children,
}: {
  name: SortKey;
  sort: SortKey;
  direction: 1 | -1;
  onSort: (name: SortKey) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(name)}
      className="inline-flex items-center gap-1 whitespace-nowrap font-medium hover:text-slate-950"
      aria-label={`Sort by ${children}`}
    >
      {children}
      <span className="text-slate-400">
        {sort === name ? (direction === 1 ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

function Rankings({
  offers,
  onSelect,
}: {
  offers: ModelOffer[];
  onSelect: (id: string) => void;
}) {
  const cards: {
    title: string;
    detail: string;
    value: (offer: ModelOffer) => number | null;
    format: (value: number) => string;
    ascending: boolean;
    color: string;
  }[] = [
    {
      title: "Lowest input price",
      detail: "USD per million input tokens · lower is better",
      value: (offer) => offer.input_usd_per_million,
      format: money,
      ascending: true,
      color: "#2563eb",
    },
    {
      title: "Lowest output price",
      detail: "USD per million output tokens · lower is better",
      value: (offer) => offer.output_usd_per_million,
      format: money,
      ascending: true,
      color: "#7c3aed",
    },
    {
      title: "Largest context",
      detail: "Maximum input tokens · higher is better",
      value: (offer) => offer.max_input_tokens,
      format: tokens,
      ascending: false,
      color: "#059669",
    },
  ];
  return (
    <section className="mt-5" aria-label="Model offer rankings">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Price and context rankings</h2>
        <p className="mt-1 text-sm text-slate-600">
          Calculated from the currently filtered provider listings. These are
          catalog facts, not quality rankings.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {cards.map((card) => {
          const rows = offers
            .filter(
              (offer) => offer.mode === "chat" && card.value(offer) !== null,
            )
            .sort(
              (a, b) =>
                (card.value(a)! - card.value(b)!) * (card.ascending ? 1 : -1) ||
                a.name.localeCompare(b.name),
            )
            .slice(0, 12);
          const max = Math.max(...rows.map((offer) => card.value(offer)!), 1);
          return (
            <div
              key={card.title}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span
                  className="mt-1 h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: card.color }}
                />
                <div>
                  <h3 className="text-lg font-semibold">{card.title}</h3>
                  <p className="text-xs text-slate-500">{card.detail}</p>
                </div>
              </div>
              <ol className="mt-6 space-y-4">
                {rows.map((offer, index) => (
                  <li
                    key={offer.id}
                    className="grid grid-cols-[20px_1fr_auto] items-start gap-x-2 gap-y-1 text-xs"
                  >
                    <span className="text-slate-400">{index + 1}</span>
                    <button
                      onClick={() => onSelect(offer.id)}
                      title={offer.name}
                      className="min-w-0 truncate text-left font-medium text-slate-800 hover:text-blue-700 hover:underline"
                    >
                      {offer.name}
                    </button>
                    <span className="tabular-nums font-semibold">
                      {card.format(card.value(offer)!)}
                    </span>
                    <div className="col-start-2 col-end-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          backgroundColor: card.color,
                          width: `${Math.max(2, (card.value(offer)! / max) * 100)}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
              {!rows.length && (
                <p className="mt-5 text-sm text-slate-500">
                  No offers have this value.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Zero price reflects the registry listing; it is not a guarantee of free
        access. Open a listing to inspect its source.
      </p>
    </section>
  );
}

function Landscape({
  offers,
  onSelect,
}: {
  offers: ModelOffer[];
  onSelect: (id: string) => void;
}) {
  const [priceMetric, setPriceMetric] = useState<
    "input_usd_per_million" | "output_usd_per_million"
  >("input_usd_per_million");
  const [capacityMetric, setCapacityMetric] = useState<
    "max_input_tokens" | "max_output_tokens"
  >("max_input_tokens");
  const [showFrontier, setShowFrontier] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const points = useMemo(
    () =>
      offers.filter(
        (offer) =>
          offer.mode === "chat" &&
          offer[priceMetric] !== null &&
          offer[priceMetric] >= 0 &&
          offer[capacityMetric] !== null &&
          offer[capacityMetric] > 0,
      ),
    [offers, priceMetric, capacityMetric],
  );
  const price = (offer: ModelOffer) => offer[priceMetric] as number;
  const capacity = (offer: ModelOffer) => offer[capacityMetric] as number;
  const xValues = points.map((offer) => Math.log10(price(offer) + 0.001));
  const yValues = points.map((offer) => Math.log10(capacity(offer)));
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  const x = (value: number) =>
    62 + ((Math.log10(value + 0.001) - minX) / (maxX - minX || 1)) * 728;
  const y = (value: number) =>
    310 - ((Math.log10(value) - minY) / (maxY - minY || 1)) * 265;
  const coordinates = points.map((offer) => ({
    offer,
    x: x(price(offer)),
    y: y(capacity(offer)),
  }));
  const frontierIds = useMemo(() => {
    if (!showFrontier) return new Set<string>();
    const sorted = [...points].sort(
      (a, b) => price(a) - price(b) || capacity(b) - capacity(a),
    );
    const result = new Set<string>();
    let greatestCapacity = -1;
    for (const offer of sorted) {
      if (capacity(offer) > greatestCapacity) {
        result.add(offer.id);
        greatestCapacity = capacity(offer);
      }
    }
    return result;
  }, [points, priceMetric, capacityMetric, showFrontier]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 840, 370);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 840, 370);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(62, 45, 728, 265);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    for (let tick = 0; tick <= 4; tick++) {
      ctx.beginPath();
      ctx.moveTo(62, 45 + tick * 66.25);
      ctx.lineTo(790, 45 + tick * 66.25);
      ctx.moveTo(62 + tick * 182, 45);
      ctx.lineTo(62 + tick * 182, 310);
      ctx.stroke();
    }
    for (const point of coordinates) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle =
        point.offer.reasoning === 1
          ? "rgba(37,99,235,0.42)"
          : "rgba(100,116,139,0.36)";
      ctx.fill();
    }
    if (showFrontier) {
      for (const point of coordinates) {
        if (!frontierIds.has(point.offer.id)) continue;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = "#d97706";
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#475569";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      priceMetric === "input_usd_per_million"
        ? "Input price, USD per million tokens →"
        : "Output price, USD per million tokens →",
      426,
      352,
    );
    ctx.save();
    ctx.translate(18, 180);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(
      capacityMetric === "max_input_tokens"
        ? "Context window, tokens →"
        : "Maximum output, tokens →",
      0,
      0,
    );
    ctx.restore();
    if (points.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(money(Math.min(...points.map(price))), 62, 330);
      ctx.textAlign = "right";
      ctx.fillText(money(Math.max(...points.map(price))), 790, 330);
      ctx.fillText(tokens(Math.max(...points.map(capacity))), 54, 48);
    }
  }, [
    coordinates,
    points,
    priceMetric,
    capacityMetric,
    showFrontier,
    frontierIds,
  ]);

  function choosePoint(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = ((event.clientX - rect.left) * 840) / rect.width;
    const clickY = ((event.clientY - rect.top) * 370) / rect.height;
    let nearest: ModelOffer | null = null;
    let distance = 100;
    for (const point of coordinates) {
      const current = (point.x - clickX) ** 2 + (point.y - clickY) ** 2;
      if (current < distance) {
        nearest = point.offer;
        distance = current;
      }
    }
    if (nearest) onSelect(nearest.id);
  }

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = "model-atlas-price-context.png";
    anchor.click();
  }

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-label="Cost and context landscape"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">
            Cost and capacity landscape
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Each dot is a chat model offer. Click a dot for its listing. Lower
            price and larger capacity appear toward the upper left.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
          {points.length.toLocaleString()} offers with both values
        </span>
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">
          Price axis
          <select
            value={priceMetric}
            onChange={(event) =>
              setPriceMetric(event.target.value as typeof priceMetric)
            }
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="input_usd_per_million">Input $/M tokens</option>
            <option value="output_usd_per_million">Output $/M tokens</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Capacity axis
          <select
            value={capacityMetric}
            onChange={(event) =>
              setCapacityMetric(event.target.value as typeof capacityMetric)
            }
            className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="max_input_tokens">Context window</option>
            <option value="max_output_tokens">Maximum output</option>
          </select>
        </label>
        <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700">
          <input
            type="checkbox"
            checked={showFrontier}
            onChange={(event) => setShowFrontier(event.target.checked)}
            className="accent-amber-600"
          />
          Highlight price-capacity frontier
        </label>
        <button
          onClick={downloadPng}
          disabled={!points.length}
          className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Download PNG
        </button>
      </div>
      {points.length ? (
        <div className="mt-4 overflow-x-auto">
          <canvas
            ref={canvasRef}
            width={1680}
            height={740}
            onClick={choosePoint}
            role="img"
            aria-label="Interactive scatter chart of model price versus token capacity"
            className="min-w-[620px] w-full cursor-crosshair"
          />
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-500">
          No chat offers in the current filter have both values.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-600">
        <span>
          <span className="mr-1 text-blue-600">●</span>Reasoning support
          recorded
        </span>
        <span>
          <span className="mr-1 text-slate-500">●</span>Other or unknown
        </span>
        {showFrontier && (
          <span>
            <span className="mr-1 text-amber-600">●</span>Price-capacity
            frontier
          </span>
        )}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Both axes use a logarithmic scale. Frontier points are not dominated on
        the two selected axes; this does not measure model quality. Prices and
        limits are source listings, and unknown values are omitted from the
        chart.
      </p>
    </section>
  );
}

function Detail({
  offer,
  fetchedAt,
  sourceName,
  sourceUrl,
  onRelease,
  close,
}: {
  offer: ModelOffer;
  fetchedAt: string;
  sourceName: string;
  sourceUrl: string;
  onRelease: (id: string) => void;
  close: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);
  const facts = [
    ["Provider", label(offer.provider)],
    ["Offer status", offer.status ?? "Not marked"],
    ["Type", label(offer.mode)],
    ["Input price / 1M tokens", money(offer.input_usd_per_million)],
    ["Output price / 1M tokens", money(offer.output_usd_per_million)],
    ["Cached input / 1M tokens", money(offer.cache_read_usd_per_million)],
    [
      "Image generation",
      offer.output_usd_per_image === null
        ? "—"
        : `${money(offer.output_usd_per_image)} per image`,
    ],
    [
      "Audio/video input",
      offer.input_usd_per_second === null
        ? "—"
        : `${money(offer.input_usd_per_second)} per second`,
    ],
    [
      "Audio/video output",
      offer.output_usd_per_second === null
        ? "—"
        : `${money(offer.output_usd_per_second)} per second`,
    ],
    ["Input context", tokens(offer.max_input_tokens)],
    ["Maximum output", tokens(offer.max_output_tokens)],
    ["Tools", flag(offer.tools)],
    ["Vision", flag(offer.vision)],
    ["Reasoning", flag(offer.reasoning)],
    ["Audio input", flag(offer.audio_input)],
    ["Audio output", flag(offer.audio_output)],
    ["Deprecation date", offer.deprecation_date ?? "Not recorded"],
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
        aria-label={`${offer.name} details`}
        onClick={(event) => event.stopPropagation()}
        className="h-full w-full max-w-xl overflow-y-auto bg-white px-5 py-6 text-slate-900 shadow-2xl sm:px-8"
      >
        <div className="flex justify-between gap-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Model offer
          </span>
          <button
            autoFocus
            onClick={close}
            className="rounded-md border border-slate-200 px-3 py-1 text-sm hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <h2 className="mt-5 break-words text-2xl font-semibold">
          {offer.name}
        </h2>
        <p className="mt-2 break-all font-mono text-xs text-slate-500">
          {offer.id}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Catalog source: {sourceName}
        </p>
        <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-950">
          This is one provider listing. Prices, context, and supported features
          may vary between providers and can change after the latest catalog
          refresh.
        </p>
        <dl className="mt-6 divide-y divide-slate-100 border-y border-slate-100">
          {facts.map(([key, value]) => (
            <div key={key} className="grid grid-cols-2 gap-3 py-3 text-sm">
              <dt className="text-slate-500">{key}</dt>
              <dd className="break-words font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <h3 className="mt-7 font-semibold">Evidence and freshness</h3>
        <p className="mt-2 text-sm text-slate-600">
          Registry checked{" "}
          {fetchedAt
            ? new Date(fetchedAt).toLocaleString()
            : "at an unknown time"}
          . Individual upstream facts may be older; the registry does not
          provide a timestamp for each field.
        </p>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {offer.canonical_model_id && (
            <button
              onClick={() => onRelease(offer.canonical_model_id!)}
              className="text-left text-blue-700 underline underline-offset-2"
            >
              Open underlying model release →
            </button>
          )}
          <a
            href={`/models?model=${encodeURIComponent(offer.id)}`}
            className="text-blue-700 underline underline-offset-2"
          >
            Permanent link to this listing
          </a>
          <a
            href={offer.source_url ?? sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline underline-offset-2"
          >
            {offer.source_url
              ? "Open upstream source"
              : "Open registry record source"}{" "}
            ↗
          </a>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline underline-offset-2"
          >
            Open {sourceName} registry ↗
          </a>
        </div>
        <h3 className="mt-8 font-semibold">Independent measurements</h3>
        <p className="mt-2 text-sm text-slate-600">
          Intelligence, output speed, and latency have no licensed measurement
          for this offer in this catalog. Anvilmark does not fill those gaps
          with guesses.
        </p>
      </aside>
    </div>
  );
}

export function ModelExplorer({
  initialCatalog,
}: {
  initialCatalog: ModelCatalogPayload;
}) {
  const [payload] = useState<ModelCatalogPayload>(initialCatalog);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [sourceId, setSourceId] = useState("all");
  const [mode, setMode] = useState("chat");
  const [status, setStatus] = useState("current");
  const [feature, setFeature] = useState("all");
  const [maxInputPrice, setMaxInputPrice] = useState("");
  const [minContext, setMinContext] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>("directory");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [taskInputTokens, setTaskInputTokens] = useState(10_000);
  const [taskOutputTokens, setTaskOutputTokens] = useState(2_000);

  useEffect(() => {
    const linkedModel = new URLSearchParams(window.location.search).get(
      "model",
    );
    if (linkedModel) setDetailId(linkedModel);
    const linkedRelease = new URLSearchParams(window.location.search).get(
      "release",
    );
    if (linkedRelease) {
      setReleaseId(linkedRelease);
      setView("releases");
    }
  }, []);

  const offers = payload.offers;
  const releases = payload.releases;
  const providers = useMemo(
    () => [...new Set(offers.map((offer) => offer.provider))].sort(),
    [offers],
  );
  const modes = useMemo(
    () => [...new Set(offers.map((offer) => offer.mode))].sort(),
    [offers],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const maxPrice = maxInputPrice === "" ? null : Number(maxInputPrice);
    const context = minContext === "" ? null : Number(minContext);
    const today = new Date().toISOString().slice(0, 10);
    return offers
      .filter((offer) => {
        if (
          q &&
          !`${offer.name} ${offer.provider} ${offer.id}`
            .toLowerCase()
            .includes(q)
        )
          return false;
        if (provider !== "all" && offer.provider !== provider) return false;
        if (sourceId !== "all" && offer.source_id !== sourceId) return false;
        if (mode !== "all" && offer.mode !== mode) return false;
        const deprecated =
          offer.status === "deprecated" ||
          Boolean(offer.deprecation_date && offer.deprecation_date < today);
        if (status === "current" && deprecated) return false;
        if (status === "deprecated" && !deprecated) return false;
        if (
          feature !== "all" &&
          offer[feature as "tools" | "vision" | "reasoning" | "audio_input"] !==
            1
        )
          return false;
        if (
          maxPrice !== null &&
          (offer.input_usd_per_million === null ||
            offer.input_usd_per_million > maxPrice)
        )
          return false;
        if (
          context !== null &&
          (offer.max_input_tokens === null || offer.max_input_tokens < context)
        )
          return false;
        return true;
      })
      .sort((a, b) => {
        const av = a[sort],
          bv = b[sort];
        if (av === null) return 1;
        if (bv === null) return -1;
        const order =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return order * direction || a.id.localeCompare(b.id);
      });
  }, [
    offers,
    query,
    provider,
    sourceId,
    mode,
    status,
    feature,
    maxInputPrice,
    minContext,
    sort,
    direction,
  ]);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const detail = offers.find((offer) => offer.id === detailId);
  const releaseDetail = releases.find((release) => release.id === releaseId);
  const selected = compareIds
    .map((id) => offers.find((offer) => offer.id === id))
    .filter((offer): offer is ModelOffer => Boolean(offer));
  const priced = offers.filter(
    (offer) =>
      offer.input_usd_per_million !== null &&
      offer.output_usd_per_million !== null,
  ).length;
  function chooseSort(key: SortKey) {
    if (sort === key) setDirection(direction === 1 ? -1 : 1);
    else {
      setSort(key);
      setDirection(key === "name" || key === "provider" ? 1 : -1);
    }
    setPage(1);
  }
  function toggleCompare(id: string) {
    setCompareIds((items) =>
      items.includes(id)
        ? items.filter((item) => item !== id)
        : items.length < 4
          ? [...items, id]
          : items,
    );
  }
  function openDetail(id: string) {
    setReleaseId(null);
    setDetailId(id);
    const url = new URL(window.location.href);
    url.searchParams.delete("release");
    url.searchParams.set("model", id);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  function closeDetail() {
    setDetailId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("model");
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  function openRelease(id: string) {
    setDetailId(null);
    setReleaseId(id);
    setView("releases");
    const url = new URL(window.location.href);
    url.searchParams.delete("model");
    url.searchParams.set("release", id);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  function closeRelease() {
    setReleaseId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("release");
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }
  function resetPage() {
    setPage(1);
  }
  function downloadCsv() {
    const columns = [
      "id",
      "source_id",
      "canonical_model_id",
      "provider",
      "status",
      "mode",
      "max_input_tokens",
      "max_output_tokens",
      "input_usd_per_million",
      "output_usd_per_million",
      "cache_read_usd_per_million",
      "output_usd_per_image",
      "input_usd_per_second",
      "output_usd_per_second",
      "tools",
      "vision",
      "reasoning",
      "deprecation_date",
      "source_url",
    ] as const;
    const cell = (value: string | number | null) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [
      columns.join(","),
      ...filtered.map((offer) =>
        columns.map((key) => cell(offer[key])).join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "model-atlas-offers.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="model-atlas min-h-screen bg-slate-50 text-slate-900">
      <ModelNav
        offers={offers}
        view={view}
        onView={setView}
        onSelect={openDetail}
      />
      <header className="border-b border-slate-200 bg-[#f5f6f7]">
        <div className="mx-auto max-w-[1500px] px-5 pb-7 pt-10 sm:px-8 lg:px-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-700">
            Independent model directory
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Find the right model offer
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
            Compare provider listings, underlying releases, and independent
            Arena rankings. Open any entry for its source and limitations.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-2xl font-semibold">
                {payload ? offers.length.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-slate-500">Provider listings</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-2xl font-semibold">
                {payload ? providers.length : "—"}
              </p>
              <p className="text-xs text-slate-500">Provider types</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-2xl font-semibold">
                {payload ? priced.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-slate-500">
                Listings with input and output pricing
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-2xl font-semibold">
                {payload ? releases.length.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-slate-500">
                Underlying model releases
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-2xl font-semibold">
                {payload ? payload.arena_rating_count.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-slate-500">Arena rating records</p>
            </div>
          </div>
          {payload && (
            <p className="mt-3 text-xs text-slate-500">
              Sources checked{" "}
              {payload.sources[0]?.fetched_at
                ? snapshotTime(payload.sources[0].fetched_at)
                : "at an unknown time"}{" "}
              · LiteLLM and Models.dev (MIT), Arena (CC BY 4.0). Prices and
              rankings can change independently of this snapshot.
            </p>
          )}
        </div>
      </header>
      <main
        id="catalog-content"
        className="mx-auto max-w-[1500px] px-5 pb-24 pt-7 sm:px-8 lg:px-10"
      >
        {(
          <>
            <div
              className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-200"
              role="tablist"
              aria-label="Catalog views"
            >
              {(
                [
                  "directory",
                  "releases",
                  "rankings",
                  "landscape",
                  "compare",
                  "arena",
                  "data",
                ] as const
              ).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={view === tab}
                  onClick={() => setView(tab)}
                  className={`border-b-2 px-4 py-3 text-sm font-medium ${view === tab ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
                >
                  {tab === "compare"
                    ? `Compare (${selected.length})`
                    : label(tab)}
                </button>
              ))}
            </div>
            {view !== "releases" && view !== "arena" && view !== "data" && (
              <section
                aria-label="Filter model listings"
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr]">
                  <label className="text-xs font-medium text-slate-600">
                    Search
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        resetPage();
                      }}
                      placeholder="Model or provider"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-blue-600"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Provider
                    <select
                      value={provider}
                      onChange={(event) => {
                        setProvider(event.target.value);
                        resetPage();
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm"
                    >
                      <option value="all">All providers</option>
                      {providers.map((name) => (
                        <option key={name} value={name}>
                          {label(name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Data source
                    <select
                      value={sourceId}
                      onChange={(event) => {
                        setSourceId(event.target.value);
                        resetPage();
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm"
                    >
                      <option value="all">Both sources</option>
                      <option value="modelsdev_offers">Models.dev</option>
                      <option value="litellm">LiteLLM</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Model type
                    <select
                      value={mode}
                      onChange={(event) => {
                        setMode(event.target.value);
                        resetPage();
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm"
                    >
                      <option value="all">All types</option>
                      {modes.map((name) => (
                        <option key={name} value={name}>
                          {label(name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Status
                    <select
                      value={status}
                      onChange={(event) => {
                        setStatus(event.target.value);
                        resetPage();
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm"
                    >
                      <option value="current">Current or unmarked</option>
                      <option value="all">All</option>
                      <option value="deprecated">Deprecated</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Capability
                    <select
                      value={feature}
                      onChange={(event) => {
                        setFeature(event.target.value);
                        resetPage();
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm"
                    >
                      <option value="all">Any</option>
                      <option value="tools">Tools</option>
                      <option value="vision">Vision</option>
                      <option value="reasoning">Reasoning</option>
                      <option value="audio_input">Audio input</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Max input $/M
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={maxInputPrice}
                      onChange={(event) => {
                        setMaxInputPrice(event.target.value);
                        resetPage();
                      }}
                      placeholder="No limit"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-blue-600"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Min context
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={minContext}
                      onChange={(event) => {
                        setMinContext(event.target.value);
                        resetPage();
                      }}
                      placeholder="Tokens"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2.5 text-sm outline-blue-600"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-600">
                    <strong>{filtered.length.toLocaleString()}</strong> matches.
                    Unknown values are excluded when a numeric limit is set.
                  </p>
                  <div className="flex gap-4">
                    <button
                      onClick={downloadCsv}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Download filtered CSV
                    </button>
                    <button
                      onClick={() => {
                        setQuery("");
                        setProvider("all");
                        setSourceId("all");
                        setMode("chat");
                        setStatus("current");
                        setFeature("all");
                        setMaxInputPrice("");
                        setMinContext("");
                        setPage(1);
                      }}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      Reset filters
                    </button>
                  </div>
                </div>
              </section>
            )}
            {view === "releases" && (
              <ModelReleases releases={releases} onOpen={openRelease} />
            )}
            {view === "data" && <CatalogData catalog={payload} />}
            {view === "arena" && <ArenaLeaderboard />}
            {view === "rankings" && (
              <Rankings offers={filtered} onSelect={openDetail} />
            )}
            {view === "landscape" && (
              <div className="mt-5">
                <Landscape offers={filtered} onSelect={openDetail} />
              </div>
            )}
            {view === "directory" && (
              <section
                className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                aria-label="Model directory"
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1130px] border-collapse text-left text-sm">
                    <thead className="bg-slate-100 text-xs text-slate-600">
                      <tr>
                        <th className="w-10 px-4 py-3">
                          <span className="sr-only">Compare</span>
                        </th>
                        <th className="px-3 py-3">
                          <SortHead
                            name="name"
                            sort={sort}
                            direction={direction}
                            onSort={chooseSort}
                          >
                            Model listing
                          </SortHead>
                        </th>
                        <th className="px-3 py-3">
                          <SortHead
                            name="provider"
                            sort={sort}
                            direction={direction}
                            onSort={chooseSort}
                          >
                            Provider
                          </SortHead>
                        </th>
                        <th className="px-3 py-3">
                          <SortHead
                            name="max_input_tokens"
                            sort={sort}
                            direction={direction}
                            onSort={chooseSort}
                          >
                            Context
                          </SortHead>
                        </th>
                        <th className="px-3 py-3">
                          <SortHead
                            name="input_usd_per_million"
                            sort={sort}
                            direction={direction}
                            onSort={chooseSort}
                          >
                            Input $/M
                          </SortHead>
                        </th>
                        <th className="px-3 py-3">
                          <SortHead
                            name="output_usd_per_million"
                            sort={sort}
                            direction={direction}
                            onSort={chooseSort}
                          >
                            Output $/M
                          </SortHead>
                        </th>
                        <th className="px-3 py-3">Tools</th>
                        <th className="px-3 py-3">Image / audio / video</th>
                        <th className="px-3 py-3">Vision</th>
                        <th className="px-3 py-3">Reasoning</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visible.map((offer) => (
                        <tr key={offer.id} className="hover:bg-blue-50/60">
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              aria-label={`Compare ${offer.name}`}
                              checked={compareIds.includes(offer.id)}
                              onChange={() => toggleCompare(offer.id)}
                              disabled={
                                !compareIds.includes(offer.id) &&
                                compareIds.length >= 4
                              }
                              className="accent-blue-600"
                            />
                          </td>
                          <td className="max-w-[350px] px-3 py-3">
                            <button
                              onClick={() => openDetail(offer.id)}
                              className="break-all text-left font-medium text-blue-800 hover:underline"
                            >
                              {offer.name}
                            </button>
                            <p className="mt-1 text-[11px] text-slate-400">
                              {label(offer.mode)} ·{" "}
                              {offer.source_id === "litellm"
                                ? "LiteLLM"
                                : "Models.dev"}
                              {offer.status ? ` · ${offer.status}` : ""}
                            </p>
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {label(offer.provider)}
                          </td>
                          <td className="px-3 py-3 tabular-nums">
                            {tokens(offer.max_input_tokens)}
                          </td>
                          <td className="px-3 py-3 tabular-nums">
                            {money(offer.input_usd_per_million)}
                          </td>
                          <td className="px-3 py-3 tabular-nums">
                            {money(offer.output_usd_per_million)}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {flag(offer.tools)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap tabular-nums text-slate-600">
                            {otherPrice(offer)}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {flag(offer.vision)}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {flag(offer.reasoning)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!visible.length && (
                  <p className="p-8 text-center text-sm text-slate-500">
                    No listings match these filters.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
                  <p>
                    Showing {filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0}–
                    {Math.min(page * PAGE_SIZE, filtered.length)} of{" "}
                    {filtered.length.toLocaleString()}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage(page - 1)}
                      className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <span>
                      Page {page} of {pages}
                    </span>
                    <button
                      disabled={page >= pages}
                      onClick={() => setPage(page + 1)}
                      className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </section>
            )}
            {view === "compare" && (
              <section
                className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                aria-label="Compare selected models"
              >
                <h2 className="text-xl font-semibold">Side by side</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Choose up to four provider listings in the directory.
                </p>
                <div className="mt-5 flex flex-wrap gap-3 rounded-lg bg-slate-50 p-4">
                  <label className="text-xs font-medium text-slate-600">
                    Input tokens per task
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={taskInputTokens}
                      onChange={(event) =>
                        setTaskInputTokens(
                          Math.max(0, Number(event.target.value)),
                        )
                      }
                      className="mt-1 block w-40 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Output tokens per task
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={taskOutputTokens}
                      onChange={(event) =>
                        setTaskOutputTokens(
                          Math.max(0, Number(event.target.value)),
                        )
                      }
                      className="mt-1 block w-40 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                {selected.length ? (
                  <div className="mt-5 overflow-x-auto">
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead>
                        <tr>
                          <th className="w-40 border-b px-3 py-3 text-slate-500">
                            Measure
                          </th>
                          {selected.map((offer) => (
                            <th
                              key={offer.id}
                              className="min-w-44 border-b px-3 py-3 align-top"
                            >
                              <button
                                onClick={() => openDetail(offer.id)}
                                className="break-all text-left font-semibold text-blue-700 hover:underline"
                              >
                                {offer.name}
                              </button>
                              <p className="text-xs font-normal text-slate-500">
                                {label(offer.provider)}
                              </p>
                              <button
                                onClick={() => toggleCompare(offer.id)}
                                className="mt-2 text-xs font-normal text-slate-500 underline"
                              >
                                Remove
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          [
                            "Input $/M",
                            (offer: ModelOffer) =>
                              money(offer.input_usd_per_million),
                          ],
                          [
                            "Output $/M",
                            (offer: ModelOffer) =>
                              money(offer.output_usd_per_million),
                          ],
                          [
                            "Task cost estimate",
                            (offer: ModelOffer) =>
                              money(
                                pricePerTask(
                                  offer,
                                  taskInputTokens,
                                  taskOutputTokens,
                                ),
                              ),
                          ],
                          [
                            "Other unit price",
                            (offer: ModelOffer) => otherPrice(offer),
                          ],
                          [
                            "Context",
                            (offer: ModelOffer) =>
                              tokens(offer.max_input_tokens),
                          ],
                          [
                            "Max output",
                            (offer: ModelOffer) =>
                              tokens(offer.max_output_tokens),
                          ],
                          ["Tools", (offer: ModelOffer) => flag(offer.tools)],
                          ["Vision", (offer: ModelOffer) => flag(offer.vision)],
                          [
                            "Reasoning",
                            (offer: ModelOffer) => flag(offer.reasoning),
                          ],
                        ].map(([name, value]) => (
                          <tr
                            key={name as string}
                            className="border-b border-slate-100"
                          >
                            <th className="px-3 py-3 font-medium text-slate-600">
                              {name as string}
                            </th>
                            {selected.map((offer) => (
                              <td
                                key={offer.id}
                                className="px-3 py-3 tabular-nums"
                              >
                                {(value as (offer: ModelOffer) => string)(
                                  offer,
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-4 text-xs text-slate-500">
                      Task cost uses the input and output token amounts above,
                      without caching, tool charges, or tax. It is a scenario
                      estimate, not a benchmark.
                    </p>
                  </div>
                ) : (
                  <p className="mt-7 rounded-lg bg-slate-50 p-6 text-sm text-slate-500">
                    No listings selected yet. Use the checkboxes in the
                    directory.
                  </p>
                )}
              </section>
            )}
            {view !== "data" && view !== "arena" && (
              <section
                id="method"
                className="mt-7 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600"
              >
                <h2 className="font-semibold text-slate-900">
                  What this catalog measures
                </h2>
                <p className="mt-2">
                  LiteLLM and Models.dev record provider offer prices, limits,
                  and capabilities. Models.dev also records underlying model
                  releases and source-linked benchmark claims. These claims are
                  not normalized independent measurements. Intelligence, speed,
                  and latency rankings need a suitable licensed source or
                  Anvilmark measurements. Unknown capability flags are not
                  treated as unsupported.
                </p>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                  {payload.sources.map((source) => (
                    <span key={source.id}>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 underline"
                      >
                        {source.id === "litellm"
                          ? "LiteLLM"
                          : source.id === "arena"
                            ? "Arena leaderboards"
                            : source.id === "modelsdev_releases"
                              ? "Models.dev releases"
                              : "Models.dev offers"}
                      </a>{" "}
                      ·{" "}
                      <a
                        href={source.license_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-700 underline"
                      >
                        {source.license} license
                      </a>
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      {detail && payload && (
        <Detail
          offer={detail}
          fetchedAt={
            payload.sources.find((source) => source.id === detail.source_id)
              ?.fetched_at ??
            payload.sources[0]?.fetched_at ??
            ""
          }
          sourceName={detail.source_id === "litellm" ? "LiteLLM" : "Models.dev"}
          sourceUrl={
            payload.sources.find((source) => source.id === detail.source_id)
              ?.url ?? registryUrl
          }
          onRelease={openRelease}
          close={closeDetail}
        />
      )}
      {releaseDetail && (
        <ReleaseDetail
          release={releaseDetail}
          offers={offers}
          onOffer={openDetail}
          close={closeRelease}
        />
      )}
    </div>
  );
}
