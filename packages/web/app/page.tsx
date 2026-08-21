import { loadFixture } from "@anvilmark/contract";

import { FindingsTable } from "./findings-table";

export default async function HomePage() {
  const result = await loadFixture("saas-support");

  return (
    <main className="min-h-screen bg-canvas p-6 text-graphite md:p-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 border-l-4 border-gold pl-5">
          <p className="mb-2 text-xs uppercase tracking-[0.24em] text-steel">
            Fixture audit · schema {result.schemaVersion}
          </p>
          <h1 className="m-0 text-3xl font-semibold">Anvilmark findings</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-steel">
            Contract-backed placeholder data. No recommendation or
            cost-calculation logic is running yet.
          </p>
        </div>

        <section className="mb-6 grid gap-3 sm:grid-cols-3">
          <Metric
            label="Current monthly"
            value={result.totalCurrentMonthlyUsd}
          />
          <Metric
            label="Projected monthly"
            value={result.totalProjectedMonthlyUsd}
          />
          <Metric
            label="Potential savings"
            value={result.totalSavingsMonthlyUsd}
            accent
          />
        </section>

        <FindingsTable result={result} />
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="border border-sand bg-white p-4">
      <div className="text-xs uppercase tracking-wider text-steel">{label}</div>
      <div
        className={`mt-2 text-2xl font-semibold ${accent ? "text-gold" : ""}`}
      >
        ${value.toLocaleString("en-US")}
      </div>
    </div>
  );
}
