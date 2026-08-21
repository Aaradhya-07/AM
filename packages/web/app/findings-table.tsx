import type { AuditResult } from "@anvilmark/contract";

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function FindingsTable({ result }: { result: AuditResult }) {
  return (
    <div className="overflow-x-auto border border-sand bg-white">
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-graphite text-canvas">
          <tr>
            <th className="p-3 font-medium">Finding</th>
            <th className="p-3 font-medium">Category</th>
            <th className="p-3 font-medium">Current</th>
            <th className="p-3 font-medium">Projected</th>
            <th className="p-3 font-medium">Monthly savings</th>
            <th className="p-3 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {result.findings.map((finding) => (
            <tr className="border-t border-sand" key={finding.id}>
              <td className="p-3">
                <div className="font-semibold text-graphite">
                  {finding.title}
                </div>
                <div className="mt-1 text-xs text-steel">
                  {finding.filePath ?? "No source location"}
                  {finding.lineNumber === null ? "" : `:${finding.lineNumber}`}
                </div>
              </td>
              <td className="p-3 text-steel">{finding.category}</td>
              <td className="p-3">{formatUsd(finding.currentMonthlyUsd)}</td>
              <td className="p-3">{formatUsd(finding.projectedMonthlyUsd)}</td>
              <td className="p-3 font-semibold text-gold">
                {formatUsd(finding.savingsMonthlyUsd)} ({finding.savingsPercent}
                %)
              </td>
              <td className="p-3 text-steel">{finding.confidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
