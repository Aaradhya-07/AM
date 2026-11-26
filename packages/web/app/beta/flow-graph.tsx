"use client";

import type { ArchitectureDriftReport } from "../../lib/bridge-client";
import type { GeneratedPlan } from "../../lib/planner";
import styles from "./beta.module.css";

function normalizeNodeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/._-]+/g, " ")
    .trim();
}

function flowHasDriftWarning(
  flow: GeneratedPlan["flows"][number],
  driftReport?: ArchitectureDriftReport | null,
): boolean {
  if (!driftReport || driftReport.items.length === 0) return false;
  const fFrom = normalizeNodeToken(flow.from);
  const fTo = normalizeNodeToken(flow.to);
  return driftReport.items.some((item) => {
    const dFrom = normalizeNodeToken(item.from);
    const dTo = normalizeNodeToken(item.to);
    return (
      (dFrom && fFrom && (dFrom.includes(fFrom) || fFrom.includes(dFrom))) ||
      (dTo && fTo && (dTo.includes(fTo) || fTo.includes(dTo)))
    );
  });
}

function formatDriftKindLabel(
  kind: ArchitectureDriftReport["items"][number]["kind"],
): string {
  switch (kind) {
    case "undeclared_flow":
      return "Undeclared flow";
    case "missing_planned_flow":
      return "Missing planned flow";
    case "boundary_bypass":
      return "Boundary bypass";
    case "unapproved_ai_sdk":
      return "Unapproved AI SDK";
  }
}

export function FlowGraph({
  flows,
  driftReport,
  onRefreshDrift,
}: {
  flows: GeneratedPlan["flows"];
  driftReport?: ArchitectureDriftReport | null | undefined;
  onRefreshDrift?: (() => void) | undefined;
}) {
  const hasDriftItems = Boolean(driftReport && driftReport.items.length > 0);
  if (!flows.length && !hasDriftItems) return null;

  return (
    <div
      className={styles.flowGraph}
      role="region"
      aria-label="Data flows and trust boundaries diagram"
    >
      <div className={styles.flowGraphHeader}>
        <div className={styles.flowGraphTitleGroup}>
          <h4>Data flows &amp; trust boundaries</h4>
          <span className={styles.flowGraphCount}>
            {flows.length} {flows.length === 1 ? "flow" : "flows"}
          </span>
        </div>

        <div className={styles.flowGraphRadarActions}>
          {driftReport && (
            <span
              className={`${styles.driftStatusBadge} ${
                driftReport.status === "aligned"
                  ? styles.driftStatusAligned
                  : driftReport.status === "drifted"
                    ? styles.driftStatusDrifted
                    : styles.driftStatusIdle
              }`}
              data-drift-status={driftReport.status}
            >
              {driftReport.status === "aligned"
                ? `Drift radar: Aligned ✓ (${driftReport.observedEdgesCount} scanned edges)`
                : driftReport.status === "drifted"
                  ? `Drift radar: ${driftReport.items.length} ${driftReport.items.length === 1 ? "finding" : "findings"}`
                  : "Drift radar: Apply plan to activate"}
            </span>
          )}
          {onRefreshDrift && (
            <button
              type="button"
              className={styles.miniCopyBtn}
              onClick={onRefreshDrift}
            >
              Rescan drift
            </button>
          )}
        </div>
      </div>

      {flows.length > 0 && (
        <ol className={styles.flowDiagramList}>
          {flows.map((flow, index) => {
            const drifted = flowHasDriftWarning(flow, driftReport);
            return (
              <li
                className={`${styles.flowEdgeCard} ${drifted ? styles.flowEdgeDrifted : ""}`}
                key={`${flow.from}-${flow.to}-${index}`}
                data-drifted={drifted ? "true" : undefined}
              >
                <div className={`${styles.flowNode} ${styles.flowNodeSource}`}>
                  <span className={styles.flowNodeKind}>
                    <i aria-hidden="true" /> Source
                  </span>
                  <strong>{flow.from}</strong>
                </div>

                <div className={styles.flowConnector}>
                  <span className={styles.flowDataLabel}>{flow.data}</span>

                  <svg
                    className={styles.flowArrowHorizontal}
                    viewBox="0 0 180 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <line
                      x1="4"
                      y1="12"
                      x2="164"
                      y2="12"
                      stroke={drifted ? "#e57373" : "#554b68"}
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                    />
                    <circle
                      cx="88"
                      cy="12"
                      r="4"
                      fill="#181621"
                      stroke={drifted ? "#f29b94" : "#eac6a6"}
                      strokeWidth="1.5"
                    />
                    <path
                      d="M158 6.5L168 12L158 17.5"
                      stroke={drifted ? "#f29b94" : "#eac6a6"}
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>

                  <svg
                    className={styles.flowArrowVertical}
                    viewBox="0 0 24 38"
                    fill="none"
                    aria-hidden="true"
                  >
                    <line
                      x1="12"
                      y1="3"
                      x2="12"
                      y2="30"
                      stroke={drifted ? "#e57373" : "#554b68"}
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    <circle
                      cx="12"
                      cy="15"
                      r="3.5"
                      fill="#181621"
                      stroke={drifted ? "#f29b94" : "#eac6a6"}
                      strokeWidth="1.4"
                    />
                    <path
                      d="M7 25L12 33L17 25"
                      stroke={drifted ? "#f29b94" : "#eac6a6"}
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>

                  <span className={styles.flowBoundaryBadge}>
                    <svg
                      aria-hidden="true"
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M8 1.8 13 3.7v3.8c0 3.2-2.1 5.6-5 6.7-2.9-1.1-5-3.5-5-6.7V3.7L8 1.8Z" />
                    </svg>
                    <span>{flow.boundary}</span>
                  </span>
                </div>

                <div className={`${styles.flowNode} ${styles.flowNodeTarget}`}>
                  <span className={styles.flowNodeKind}>
                    <i aria-hidden="true" /> Target
                  </span>
                  <strong>{flow.to}</strong>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {driftReport && driftReport.items.length > 0 && (
        <div
          className={styles.driftRadarList}
          role="region"
          aria-label="Architecture drift findings"
        >
          <div className={styles.driftRadarHeader}>
            <strong>Observed repository drift findings</strong>
            <small>
              Scanned {driftReport.scannedAt.slice(0, 19).replace("T", " ")}
            </small>
          </div>
          <ul>
            {driftReport.items.map((item, idx) => (
              <li
                key={`${item.kind}-${item.from}-${item.to}-${idx}`}
                className={`${styles.driftFindingItem} ${
                  item.severity === "error"
                    ? styles.driftFindingError
                    : item.severity === "warning"
                      ? styles.driftFindingWarning
                      : styles.driftFindingInfo
                }`}
              >
                <div className={styles.driftFindingTop}>
                  <span className={styles.driftKindPill}>
                    {formatDriftKindLabel(item.kind)}
                  </span>
                  <strong>
                    {item.from} → {item.to}
                  </strong>
                  {item.boundary && (
                    <span className={styles.driftBoundaryText}>
                      ({item.boundary})
                    </span>
                  )}
                </div>
                <p>{item.detail}</p>
                {item.evidencePaths.length > 0 && (
                  <div className={styles.driftEvidenceRow}>
                    {item.evidencePaths.map((evPath) => (
                      <code key={evPath}>{evPath}</code>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
